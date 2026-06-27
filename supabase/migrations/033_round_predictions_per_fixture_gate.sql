-- Migration: 033_round_predictions_per_fixture_gate
--
-- Fix a pre-lock leak that the knockout stage (mig 032) introduces into
-- round_predictions() (defined in mig 011).
--
-- round_predictions() reveals every player's picks for a round, gated by
-- `now() >= r.locks_at` — the round-level lock. For group rounds that is correct:
-- all matches of a round lock together. For a KNOCKOUT round, the matches lock
-- individually (fixtures.locks_at, mig 032), but rounds.locks_at is only the
-- EARLIEST match's lock. So once the first knockout match of a phase kicks off,
-- the round-level gate opens and the RPC would expose predictions for matches
-- LATER in the same phase that are still open for betting — letting players copy
-- each other before those matches lock.
--
-- Fix: gate per-fixture. coalesce(f.locks_at, r.locks_at) uses the per-match lock
-- for knockout fixtures and falls back to the round lock for group fixtures
-- (f.locks_at is NULL there), so group behavior is byte-for-byte identical.
--
-- Signature unchanged → the grant from mig 026 (to authenticated) is preserved by
-- create or replace.
--
-- NOTE (follow-up): admin_round_predictions (mig 020) has the same round-level
-- gate. It is admin-only export, lower priority — tracked separately.

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
    and now() >= coalesce(f.locks_at, r.locks_at);  -- per-fixture gate (mig 033)
$$;

comment on function public.round_predictions(bigint) is
  'Returns all players'' predictions for a round, gated PER FIXTURE: a pick is '
  'revealed only once that match is locked (now() >= coalesce(fixtures.locks_at, '
  'rounds.locks_at)). Group fixtures fall back to the round lock (identical to '
  'mig 011); knockout fixtures use their own lock so still-open matches never leak. '
  'SECURITY DEFINER. (mig 033, supersedes mig 011 gate)';
