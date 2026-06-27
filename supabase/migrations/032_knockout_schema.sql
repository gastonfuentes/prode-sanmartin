-- Migration: 032_knockout_schema
--
-- Knockout (single-elimination) stage support. The group stage runs as N rounds
-- with a single round-level lock (rounds.locks_at = first_kickoff - 10 min). The
-- knockout stage needs two things the group model does not provide:
--
--   1. A way to tell group rounds apart from knockout rounds, so leaderboards and
--      lock policy can branch on it. -> rounds.stage.
--   2. A PER-MATCH lock, because the matches of one knockout phase (e.g. Round of
--      16) are played on different days; a single round-level lock would close
--      betting on later matches the moment the first one kicks off.
--      -> fixtures.locks_at, maintained per-fixture for knockout only.
--
-- Progressive habilitation is automatic via the ESPN sync: a knockout fixture is
-- only bettable once it has REAL teams (both team ids belong to the 48 World Cup
-- nations). The sync sets fixtures.teams_decided accordingly; placeholders like
-- "Round of 16 3 Winner" / "Third Place Group C/E/F/H" stay teams_decided = false
-- and reject predictions until the bracket resolves.
--
-- Scoring is UNCHANGED: score_fixture() (mig 029) already gives exact = 3 to every
-- round that is not the chronologically-first one, so knockout rounds score 1 / 3
-- with no change here.

-- ─── 1. rounds.stage ──────────────────────────────────────────────────────────

alter table public.rounds
  add column stage text not null default 'group'
    check (stage in ('group', 'knockout'));

comment on column public.rounds.stage is
  'Tournament stage: ''group'' (default) or ''knockout''. Drives leaderboard '
  'separation (leaderboard_knockout, mig 034) and lock policy (group = round-level '
  'rounds.locks_at; knockout = per-match fixtures.locks_at). Set by the sync (mig 032).';

-- ─── 2. fixtures.teams_decided + fixtures.locks_at ──────────────────────────────

alter table public.fixtures
  add column teams_decided boolean not null default true;

comment on column public.fixtures.teams_decided is
  'Knockout only: true when both teams are real World Cup nations (bettable), false '
  'while either side is an ESPN placeholder ("Round of 16 3 Winner", "Third Place '
  'Group …"). Group fixtures stay true (default). Set by the sync; gates predictions '
  'in enforce_betting_lock (mig 032).';

alter table public.fixtures
  add column locks_at timestamptz;

comment on column public.fixtures.locks_at is
  'Per-match lock boundary = kickoff - 10 min, maintained by set_fixture_locks_at '
  'ONLY for knockout fixtures. NULL for group fixtures (they use rounds.locks_at). '
  'Authoritative per-match lock for knockout (mig 032).';

-- ─── 3. set_fixture_locks_at trigger ────────────────────────────────────────────
--
-- Mirrors set_round_locks_at (mig 004/027): (timestamptz - interval) is not
-- IMMUTABLE, so a trigger (not a GENERATED column) keeps the DB as source of truth
-- with the "cannot drift" guarantee. Only knockout fixtures get a per-match lock;
-- group fixtures keep locks_at NULL and rely on rounds.locks_at. The round row is
-- upserted before its fixtures by the sync, so rounds.stage is available here.

create or replace function public.set_fixture_locks_at()
returns trigger
language plpgsql
as $$
declare
  v_stage text;
begin
  select stage into v_stage from public.rounds where id = new.round_id;

  new.locks_at := case
    when v_stage = 'knockout' and new.kickoff is not null
      then new.kickoff - interval '10 minutes'
    else null
  end;

  return new;
end;
$$;

create trigger trg_set_fixture_locks_at
  before insert or update of kickoff, round_id on public.fixtures
  for each row
  execute function public.set_fixture_locks_at();

-- ─── 4. enforce_betting_lock: branch on stage ───────────────────────────────────
--
-- Supersedes mig 012. The "skip when picks unchanged" guard (mig 012) is preserved
-- VERBATIM at the top so score_fixture can still write points after lock. New: when
-- the fixture's round is knockout, enforce the per-match lock (teams_decided +
-- fixtures.locks_at) instead of the round-level lock. Group stage is unchanged.
-- All rejections keep errcode P0001 so the actions.ts catch keeps working.

create or replace function public.enforce_betting_lock()
returns trigger
language plpgsql
as $$
declare
  v_stage         text;
  v_round_locks   timestamptz;
  v_fixture_locks timestamptz;
  v_decided       boolean;
begin
  -- Allow system-managed updates that do NOT change the player's picks
  -- (e.g. score_fixture writing points after the round/match has locked).
  if tg_op = 'UPDATE'
     and new.pred_home is not distinct from old.pred_home
     and new.pred_away is not distinct from old.pred_away then
    return new;
  end if;

  select r.stage, r.locks_at, f.locks_at, f.teams_decided
    into v_stage, v_round_locks, v_fixture_locks, v_decided
  from public.fixtures f
  join public.rounds r on r.id = f.round_id
  where f.id = new.fixture_id;

  if v_stage = 'knockout' then
    -- Knockout: teams must be decided, then the per-match lock applies.
    if not coalesce(v_decided, false) then
      raise exception 'Match teams are not decided yet: predictions are locked'
        using errcode = 'P0001';
    end if;
    if v_fixture_locks is null then
      raise exception 'Match is not yet open for predictions (locks_at is not set)'
        using errcode = 'P0001';
    end if;
    if now() >= v_fixture_locks then
      raise exception 'Match is locked: predictions closed at %', v_fixture_locks
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Group stage: round-level lock (unchanged from mig 012).
  if v_round_locks is null then
    raise exception 'Round is not yet open for predictions (locks_at is not set)'
      using errcode = 'P0001';
  end if;
  if now() >= v_round_locks then
    raise exception 'Round is locked: predictions closed at %', v_round_locks
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_betting_lock() is
  'BEFORE INSERT OR UPDATE trigger on predictions. Group rounds: rejects pick '
  'changes when rounds.locks_at has passed or is null. Knockout rounds: rejects '
  'when teams are undecided or now() >= fixtures.locks_at (per-match). Allows '
  'system point updates after lock (unchanged picks). errcode P0001. (mig 032)';
