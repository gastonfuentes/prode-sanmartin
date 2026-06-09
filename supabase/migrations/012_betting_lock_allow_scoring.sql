-- Migration: 012_betting_lock_allow_scoring
-- Fix a trigger-interaction bug between enforce_betting_lock and score_fixture.
--
-- Bug (found via verify_security.sql against the live DB):
--   When a fixture transitions to FT, score_fixture() runs
--     UPDATE predictions SET points = compute_points(...) WHERE fixture_id = ...
--   That UPDATE fires the BEFORE UPDATE trigger enforce_betting_lock(). Because
--   the match has finished, the round is long past locks_at, so the lock trigger
--   rejected the update with P0001 — making it IMPOSSIBLE for the system to ever
--   write points after a round closes. Scoring could never run.
--
-- Root cause:
--   enforce_betting_lock was too broad. The betting lock must protect the
--   player's PICKS (pred_home, pred_away), NOT the system-managed points column.
--   Points are written by score_fixture AFTER the round locks, by design.
--
-- Fix:
--   On UPDATE, skip the lock check when the prediction values are unchanged
--   (i.e. only points / updated_at changed). INSERTs and pick edits are still
--   fully enforced. (ADR-1)
--
-- NOTE (follow-up security item): RLS currently lets a user UPDATE their own
--   prediction row, which includes the points column. A malicious client could
--   PATCH points directly via PostgREST. This is tracked separately and should
--   be closed by revoking column-level UPDATE(points) from authenticated/anon
--   so only the service role / scoring path can write points.

create or replace function public.enforce_betting_lock()
returns trigger
language plpgsql
as $$
declare
  v_locks_at timestamptz;
begin
  -- Allow system-managed updates that do NOT change the player's picks
  -- (e.g. score_fixture writing points after the round has locked).
  if tg_op = 'UPDATE'
     and new.pred_home is not distinct from old.pred_home
     and new.pred_away is not distinct from old.pred_away then
    return new;
  end if;

  select r.locks_at
    into v_locks_at
  from public.fixtures f
  join public.rounds r on r.id = f.round_id
  where f.id = new.fixture_id;

  -- Reject if locks_at is null (round not yet configured with a first kickoff).
  if v_locks_at is null then
    raise exception 'Round is not yet open for predictions (locks_at is not set)'
      using errcode = 'P0001';
  end if;

  -- Reject if we are at or past the lock boundary (T-60 is CLOSED, REQ-3.3).
  if now() >= v_locks_at then
    raise exception 'Round is locked: predictions closed at %', v_locks_at
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_betting_lock() is
  'BEFORE INSERT OR UPDATE trigger on predictions: rejects pick changes (insert, '
  'or update of pred_home/pred_away) when the round''s locks_at has passed or is '
  'null. Allows system point updates after lock (unchanged picks). Server-side '
  'guard — cannot be bypassed via REST. (REQ-3.3, REQ-3.4, ADR-1)';
