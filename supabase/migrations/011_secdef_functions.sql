-- Migration: 011_secdef_functions
-- SECURITY DEFINER functions for leaderboard and cross-user predictions access.
-- (REQ-6.3 - REQ-6.5, REQ-6.8, ADR-3)
--
-- Both functions are SECURITY DEFINER: they run as the function owner (a
-- superuser/service role equivalent) and thus bypass RLS on the tables they
-- read. This is intentional — it is the ONLY safe way to aggregate cross-user
-- data without granting clients direct row access.
--
-- set search_path = public on both functions prevents search_path injection.

-- ─── leaderboard(round_id) ──────────────────────────────────────────────────
--
-- Returns one row per whitelisted player with their total points and exact-score
-- count for the given round. Users with zero predictions appear with 0 pts
-- (REQ-6.5). Rankings use standard competition ranking (1,1,3 for ties) (REQ-6.4).
--
-- The base set is ALL rows in public.profiles (every profile corresponds to a
-- whitelisted user — handle_new_user guarantees this). LEFT JOINs to predictions
-- and fixtures ensure 0-pt rows appear.
--
-- Round filter: when p_round_id is not null, only fixtures in that round are
-- counted. Predictions on fixtures in OTHER rounds do not affect this round's
-- tally. The left join correctly handles players who have predictions in other
-- rounds but none in this one (they still appear with 0 pts).
--
-- Standard competition ranking (1,1,3):
--   rank() OVER (ORDER BY total_points DESC) implements this natively in Postgres.
--   Two players tied at the top both get rank=1; the next player gets rank=3.
--   This satisfies REQ-6.4 exactly.
--
-- Returns:
--   rank        bigint  — standard competition rank (1,1,3 on ties)
--   display_name text
--   total_points bigint  — sum of points for this round
--   exact_count bigint  — number of 2-pt (exact score) predictions

create or replace function public.leaderboard(p_round_id bigint)
returns table (
  rank         bigint,
  display_name text,
  total_points bigint,
  exact_count  bigint
)
language sql
security definer set search_path = public
as $$
  select
    rank() over (order by coalesce(sum(p.points), 0) desc) as rank,
    pr.display_name,
    coalesce(sum(p.points), 0)                             as total_points,
    count(*) filter (where p.points = 2)                   as exact_count
  from public.profiles pr
  left join public.predictions p
         on p.user_id = pr.id
  left join public.fixtures f
         on f.id = p.fixture_id
        and f.round_id = p_round_id
  group by pr.id, pr.display_name
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard(bigint) is
  'Returns per-player points and standard-competition rank for the given round. '
  'Includes all whitelisted players (0-pt rows for non-participants). '
  'SECURITY DEFINER — reads across all profiles/predictions without exposing rows. '
  '(REQ-6.3 - REQ-6.5, ADR-3)';

-- ─── round_predictions(round_id) ────────────────────────────────────────────
--
-- Returns all players' predictions for a round — but ONLY after the round is
-- locked (now() >= locks_at). Before lock, returns ZERO rows. (REQ-6.8, ADR-3)
--
-- Privacy design:
--   The owner-only SELECT RLS policy on predictions already prevents player A
--   from directly reading player B's rows via PostgREST. This function is the
--   FEATURE that shows everyone's picks post-lock. It acts as a controlled
--   disclosure: once the round is locked (no more edits possible), revealing
--   all predictions is fair and adds game value (see how others played).
--
--   Before locks_at: the WHERE clause `now() >= r.locks_at` evaluates to false
--   for every row → the function returns zero rows → no leakage regardless of
--   who calls it.
--
--   After locks_at: the WHERE clause passes → all predictions for the round are
--   returned with display names. This is intentionally a full reveal — the game
--   is "prode" (sports prediction pool), and seeing others' picks post-lock is
--   a core feature.
--
-- The caller's own predictions are still visible pre-lock via the owner-only
-- RLS SELECT policy. This function supplements that with the cross-user view.
--
-- Returns one row per (user, fixture) pair for the round, post-lock only.

create or replace function public.round_predictions(p_round_id bigint)
returns table (
  display_name text,
  fixture_id   bigint,
  pred_home    smallint,
  pred_away    smallint,
  points       smallint
)
language sql
security definer set search_path = public
as $$
  select
    pr.display_name,
    p.fixture_id,
    p.pred_home,
    p.pred_away,
    p.points
  from public.predictions p
  join public.fixtures  f  on f.id    = p.fixture_id
  join public.rounds    r  on r.id    = f.round_id
  join public.profiles  pr on pr.id   = p.user_id
  where f.round_id = p_round_id
    and now() >= r.locks_at;   -- privacy gate: zero rows before lock (REQ-6.8)
$$;

comment on function public.round_predictions(bigint) is
  'Returns all players'' predictions for a round, but ONLY after the round is locked '
  '(now() >= locks_at). Returns zero rows before lock — no pre-lock leakage. '
  'SECURITY DEFINER — bypasses owner-only RLS for the controlled post-lock reveal. '
  '(REQ-6.8, ADR-3)';
