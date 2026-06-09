-- Migration: 013_protect_points_column
-- Defense-in-depth: prevent clients from writing the system-managed points column.
--
-- Problem:
--   RLS lets a user UPDATE their own prediction row (auth.uid() = user_id), and
--   that row includes the `points` column. Combined with migration 012 (which
--   intentionally lets point-only updates through the betting lock), an authenticated
--   user could PATCH /rest/v1/predictions setting points = 999 and cheat the
--   leaderboard. The betting lock does NOT stop this — points are not picks.
--
-- Fix:
--   Use column-level privileges. Revoke table-wide UPDATE from the client roles
--   and grant UPDATE only on the columns a player may legitimately change
--   (their picks + updated_at). `points` is therefore writable ONLY by roles that
--   retain full privileges — i.e. the service_role used by the sync/scoring path
--   (and the table owner). The score_fixture trigger runs in that privileged
--   context, so automated scoring is unaffected.
--
-- Note: INSERT and SELECT privileges are untouched; only UPDATE is narrowed.

revoke update on public.predictions from anon, authenticated;

-- Players may edit their picks (the betting-lock trigger still gates WHEN).
grant update (pred_home, pred_away, updated_at)
  on public.predictions
  to authenticated;

-- anon gets no UPDATE at all — predictions always require an authenticated user.
