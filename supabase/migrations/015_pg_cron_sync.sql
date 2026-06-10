-- Migration: 015_pg_cron_sync
-- Schedule the sync Edge Function via pg_cron + pg_net (TASK-27).
--
-- Prerequisites (verify in Supabase Dashboard → Database → Extensions before applying):
--   - pg_cron  : enables cron.schedule()
--   - pg_net   : enables net.http_post() for async HTTP calls
-- Both are available on Supabase Free tier.
--
-- Secret setup (run BEFORE applying this migration via supabase db push):
--   supabase secrets set CRON_TOKEN=<your-random-secret>
--
-- The cron jobs read the secret via current_setting('app.cron_token').
-- That setting is injected at runtime by the pg_cron worker when the job runs.
-- The Edge Function verifies the token in the Authorization header.
--
-- Edge Function URL pattern: https://<project-ref>.supabase.co/functions/v1/sync
-- Replace <project-ref> with wnojevehvksljrhorpiz (us-west-2 project ref).
--
-- ADR-5: one Edge Function with two modes, scheduled by pg_cron via pg_net.
--        ~13 requests/day total — well under the ESPN unofficial API's soft limit.

-- ─── Extensions ───────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ─── Helper: update_round_first_kickoff ───────────────────────────────────────
-- Called by the Edge Function (calendar mode) after fixture upserts to recompute
-- each round's first_kickoff. The set_round_locks_at trigger (migration 004)
-- fires automatically when first_kickoff changes, so locks_at stays in sync.
--
-- SECURITY DEFINER: the Edge Function uses the service role, which already bypasses
-- RLS, but SECURITY DEFINER here ensures the function always runs as the owner
-- (postgres) when called from any context.

create or replace function public.update_round_first_kickoff(p_round_id bigint)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.rounds
  set first_kickoff = (
    select min(kickoff)
    from public.fixtures
    where round_id = p_round_id
  )
  where id = p_round_id;
end;
$$;

comment on function public.update_round_first_kickoff(bigint) is
  'Recomputes rounds.first_kickoff = min(fixtures.kickoff) for the given round. '
  'Called by the sync Edge Function after a calendar-mode upsert batch. '
  'The set_round_locks_at trigger fires automatically on first_kickoff change. '
  '(ADR-5, TASK-27)';

-- ─── pg_cron: calendar sync (once per day at 06:00 UTC) ───────────────────────
-- Fetches the full group-stage schedule and upserts fixtures + rounds.
-- Runs daily so any ESPN corrections are picked up automatically.
-- The function reads CRON_TOKEN from app.cron_token (set by Supabase secrets).

select cron.schedule(
  'sync-calendar',
  '0 6 * * *',
  $$
    select extensions.net.http_post(
      url     := 'https://wnojevehvksljrhorpiz.supabase.co/functions/v1/sync?mode=calendar',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_token', true)
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ─── pg_cron: results sync (every 2 hours) ────────────────────────────────────
-- Polls for completed fixtures and writes FT goals to trigger scoring.
-- The Edge Function has an internal guard: it skips the ESPN API call if
-- there are no non-FT fixtures whose kickoff was > 100 minutes ago, so on
-- match-free days this is a lightweight DB query only (no outbound HTTP).
-- Cadence: ~12 calls/day + 1 calendar = ~13 req/day total (< 100 implicit limit).

select cron.schedule(
  'sync-results',
  '0 */2 * * *',
  $$
    select extensions.net.http_post(
      url     := 'https://wnojevehvksljrhorpiz.supabase.co/functions/v1/sync?mode=results',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_token', true)
      ),
      body    := '{}'::jsonb
    );
  $$
);
