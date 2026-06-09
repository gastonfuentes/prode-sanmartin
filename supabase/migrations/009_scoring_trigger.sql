-- Migration: 009_scoring_trigger
-- Automatic point calculation when a fixture reaches FT status (REQ-5.1, REQ-5.7).
--
-- The trigger fires AFTER INSERT OR UPDATE on public.fixtures.
-- It recomputes predictions.points for all predictions on the fixture when:
--   1. NEW.status = 'FT'
--   2. goals_home and goals_away are both non-null (result is complete)
--   3. The status has changed TO 'FT' from a non-FT state, OR it is an INSERT.
--      Condition: (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'FT')
--      This makes scoring idempotent: re-syncing an already-FT fixture with the
--      same result does NOT fire a spurious batch update. If the sync re-upserts
--      the same row unchanged, OLD.status = 'FT' already and the trigger skips.
--
-- Why AFTER (not BEFORE):
--   The update target is predictions, not fixtures. AFTER ensures the new
--   fixture row is visible to compute_points before we read it.
--
-- Why AFTER INSERT as well as UPDATE:
--   Defensive — if the sync Edge Function ever inserts a fixture directly as FT
--   (e.g. historical data load), scoring fires immediately. In normal operation
--   the sync upserts, so INSERT path is unlikely but safe.
--
-- Dependencies: requires migration 008 (compute_points function).

create or replace function public.score_fixture()
returns trigger
language plpgsql
as $$
begin
  -- Only act when the fixture just transitioned to a confirmed final result.
  if new.status = 'FT'
     and new.goals_home is not null
     and new.goals_away is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'FT')
  then
    update public.predictions
    set
      points     = public.compute_points(pred_home, pred_away, new.goals_home, new.goals_away),
      updated_at = now()
    where fixture_id = new.id;
  end if;

  return new;
end;
$$;

comment on function public.score_fixture() is
  'AFTER INSERT OR UPDATE trigger on fixtures: recomputes predictions.points when a '
  'fixture transitions to FT. Idempotent — skips if already scored with same result. '
  'Calls compute_points() (migration 008). (REQ-5.1, REQ-5.7, ADR-4)';

create trigger trg_score_fixture
  after insert or update on public.fixtures
  for each row
  execute function public.score_fixture();
