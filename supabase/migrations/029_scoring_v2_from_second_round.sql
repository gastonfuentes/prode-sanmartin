-- Migration: 029_scoring_v2_from_second_round
--
-- Scoring rule change requested by the players: starting from the SECOND
-- matchday ("fecha"), an exact-score hit is worth 3 points instead of 2.
-- The correct-outcome-only hit stays at 1 point. Max per match: 2 → 3.
--
--   Round                         | exact | outcome | wrong
--   ------------------------------|-------|---------|------
--   First round (earliest fecha)  |   2   |    1    |   0   (unchanged)
--   Every other round (fecha 2+)  |   3   |    1    |   0   (new)
--
-- "First round" is defined CHRONOLOGICALLY: the round with the earliest
-- first_kickoff (id as tiebreak). This is robust to round naming — it works
-- for "Matchday N" group-stage rounds and for any later knockout rounds whose
-- names carry no number.
--
-- WHY the matchday awareness lives in the trigger (not compute_points):
--   compute_points() only receives the four goal values; it cannot know which
--   round a prediction belongs to. The trigger fires on the fixtures table and
--   DOES have round_id, so it decides the exact-points value and passes it in.
--
-- COUPLING (ADR-7): the TypeScript mirror lib/scoring.ts computePoints() gains
-- the same exactPoints parameter and MUST stay in sync with this file.
--
-- Supersedes: 008 (compute_points), 009 (score_fixture), 018/028 (leaderboard
-- exact_count filter). Old migration files are left untouched (immutable history).

-- ─── 1. Parametrize compute_points with the exact-hit value ──────────────────
--
-- The 4-arg version is dropped and replaced by a 5-arg version. No DEFAULT on
-- exact_points: the only caller is score_fixture() and it must be explicit.
-- Function-to-function references resolve at runtime in Postgres (no hard DROP
-- dependency), so replacing the signature does not require touching the trigger
-- first.

drop function if exists public.compute_points(smallint, smallint, smallint, smallint);

create function public.compute_points(
  ph           smallint,   -- predicted home goals
  pa           smallint,   -- predicted away goals
  gh           smallint,   -- actual home goals
  ga           smallint,   -- actual away goals
  exact_points smallint    -- points awarded for an exact score (2 or 3)
)
returns smallint
language sql
immutable
as $$
  select case
    -- Exact score: outcome is automatically correct (REQ-5.3, REQ-5.5)
    when ph = gh and pa = ga then exact_points
    -- Correct outcome only (sign of goal difference matches) (REQ-5.2)
    when sign(ph::int - pa::int) = sign(gh::int - ga::int) then 1::smallint
    -- Wrong outcome (REQ-5.4)
    else 0::smallint
  end;
$$;

comment on function public.compute_points(smallint, smallint, smallint, smallint, smallint) is
  'Scoring logic: exact_points=exact score, 1=correct outcome only, 0=wrong outcome. '
  'exact_points is 2 for the first round and 3 from the second round onward (mig 029). '
  'IMMUTABLE mirror of lib/scoring.ts computePoints(). (REQ-5.2, REQ-5.3, ADR-7)';

-- ─── 2. Round-aware scoring trigger ──────────────────────────────────────────
--
-- Same firing condition as migration 009 (FT transition, idempotent). The only
-- change: it resolves the exact-points value from the fixture's round position
-- and passes it into compute_points().

create or replace function public.score_fixture()
returns trigger
language plpgsql
as $$
declare
  v_exact smallint;
begin
  -- Only act when the fixture just transitioned to a confirmed final result.
  if new.status = 'FT'
     and new.goals_home is not null
     and new.goals_away is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'FT')
  then
    -- 2 points for an exact hit only on the earliest round; 3 from fecha 2 on.
    v_exact := case
      when new.round_id = (
        select id from public.rounds
        order by first_kickoff asc nulls last, id asc
        limit 1
      ) then 2::smallint
      else 3::smallint
    end;

    update public.predictions
    set
      points     = public.compute_points(pred_home, pred_away, new.goals_home, new.goals_away, v_exact),
      updated_at = now()
    where fixture_id = new.id;
  end if;

  return new;
end;
$$;

comment on function public.score_fixture() is
  'AFTER INSERT OR UPDATE trigger on fixtures: recomputes predictions.points when a '
  'fixture transitions to FT. Exact hit = 2 pts on the earliest round, 3 pts from the '
  'second round onward (mig 029). Idempotent — skips if already scored with same result. '
  '(REQ-5.1, REQ-5.7, ADR-4)';

-- Trigger trg_score_fixture (migration 009) stays bound to score_fixture();
-- replacing the function body above is enough.

-- ─── 3. Backfill: recompute every already-scored prediction ──────────────────
--
-- Makes the stored points consistent with the new rule regardless of when each
-- fixture was scored. The earliest round keeps exact=2; all later rounds get
-- exact=3. Idempotent — re-running yields the same values.

update public.predictions p
set
  points = public.compute_points(
    p.pred_home, p.pred_away, f.goals_home, f.goals_away,
    case
      when f.round_id = (
        select id from public.rounds
        order by first_kickoff asc nulls last, id asc
        limit 1
      ) then 2::smallint
      else 3::smallint
    end
  ),
  updated_at = now()
from public.fixtures f
where p.fixture_id = f.id
  and f.status = 'FT'
  and f.goals_home is not null
  and f.goals_away is not null;

-- ─── 4. Leaderboard: count exact hits as points >= 2 ─────────────────────────
--
-- exact_count previously used `points = 2`. With fecha 2+ exact hits scoring 3,
-- that filter would silently miss them. `points >= 2` captures an exact hit in
-- both regimes (0=wrong, 1=outcome-only, 2 or 3=exact). Signatures unchanged.

create or replace function public.leaderboard(p_round_id bigint)
returns table (
  id           uuid,
  rank         bigint,
  display_name text,
  avatar_url   text,
  total_points bigint,
  exact_count  bigint
)
language sql
security definer set search_path = public
as $$
  select
    pr.id,
    rank() over (order by coalesce(sum(p.points), 0) desc) as rank,
    pr.display_name,
    pr.avatar_url,
    coalesce(sum(p.points), 0)                             as total_points,
    count(*) filter (where p.points >= 2)                  as exact_count
  from public.profiles pr
  left join public.fixtures f
         on f.round_id = p_round_id
  left join public.predictions p
         on p.user_id = pr.id
        and p.fixture_id = f.id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard(bigint) is
  'Returns per-player points, standard-competition rank, and avatar for the given round. '
  'Points scoped to fixtures in p_round_id (mig 028). exact_count counts hits with '
  'points >= 2 — exact is 2 pts on fecha 1, 3 pts from fecha 2 (mig 029). '
  'Includes all whitelisted players (0-pt rows for non-participants — REQ-6.5). '
  'SECURITY DEFINER. (REQ-6.3 – REQ-6.5, ADR-3)';

grant execute on function public.leaderboard(bigint) to authenticated;

create or replace function public.leaderboard_overall()
returns table (
  id           uuid,
  rank         bigint,
  display_name text,
  avatar_url   text,
  total_points bigint,
  exact_count  bigint
)
language sql
security definer set search_path = public
as $$
  select
    pr.id,
    rank() over (order by coalesce(sum(p.points), 0) desc) as rank,
    pr.display_name,
    pr.avatar_url,
    coalesce(sum(p.points), 0)            as total_points,
    count(*) filter (where p.points >= 2) as exact_count
  from public.profiles pr
  left join public.predictions p on p.user_id = pr.id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard_overall() is
  'Returns cumulative (all-round) standings for every whitelisted player. '
  'exact_count counts hits with points >= 2 (exact = 2 pts fecha 1, 3 pts fecha 2+, mig 029). '
  'Same shape as leaderboard(p_round_id). SECURITY DEFINER. (REQ-6.3 – REQ-6.5, ADR-3)';

grant execute on function public.leaderboard_overall() to authenticated;

-- ─── 5. Update the materialized-column documentation ─────────────────────────

comment on column public.predictions.points is
  'Materialized by score_fixture trigger when fixture reaches FT. '
  '0=pending/wrong, 1=correct outcome, 2=exact score (first round), '
  '3=exact score (second round onward, mig 029).';
