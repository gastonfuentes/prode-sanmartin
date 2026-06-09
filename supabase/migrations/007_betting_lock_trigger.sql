-- Migration: 007_betting_lock_trigger
-- Server-side betting lock enforcement on predictions (REQ-3.3, REQ-3.4).
--
-- Why this MUST be a DB trigger (not a UI or middleware guard):
--   - Supabase exposes every table as a PostgREST endpoint. Any user who has
--     the anon/authenticated JWT can craft a raw POST or PATCH request directly
--     to the REST API, bypassing the React UI entirely.
--   - A server action or middleware check still runs at the application layer,
--     which is not the trust boundary. A race condition, leaked service key, or
--     future admin tool could bypass it.
--   - A BEFORE INSERT OR UPDATE trigger runs atomically inside every write
--     transaction to the predictions table — regardless of origin (UI, REST,
--     SQL editor, migrations). It is the only layer that cannot be bypassed.
--     (ADR-1)
--
-- Logic:
--   1. Look up the round's locks_at via: NEW.fixture_id → fixtures → rounds.
--   2. If locks_at IS NULL (no first_kickoff set yet) → REJECT.
--      Null locks_at means the round is not properly configured; never allow
--      predictions in an uninitialized state.
--   3. If now() >= locks_at → REJECT with errcode P0001.
--      Lock boundary: T−60 is CLOSED (confirmed game rule, ADR-1).
--   4. Otherwise → ALLOW (return NEW).
--
-- The function uses now() (transaction start time, server clock), which is
-- immune to client-side clock manipulation.

create or replace function public.enforce_betting_lock()
returns trigger
language plpgsql
as $$
declare
  v_locks_at timestamptz;
begin
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

  -- Reject if we are at or past the lock boundary (T−60 is CLOSED, REQ-3.3).
  if now() >= v_locks_at then
    raise exception 'Round is locked: predictions closed at %', v_locks_at
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_betting_lock() is
  'BEFORE INSERT OR UPDATE trigger on predictions: rejects writes when the round''s '
  'locks_at has passed or is null. Server-side guard — cannot be bypassed via REST. '
  '(REQ-3.3, REQ-3.4, ADR-1)';

create trigger trg_enforce_betting_lock
  before insert or update on public.predictions
  for each row
  execute function public.enforce_betting_lock();
