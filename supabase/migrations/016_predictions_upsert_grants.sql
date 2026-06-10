-- Migration: 016_predictions_upsert_grants
-- Fix: client prediction upsert failed with 42501 "permission denied for table
-- predictions".
--
-- Root cause:
--   The client writes predictions with an INSERT ... ON CONFLICT (user_id,
--   fixture_id) DO UPDATE (supabase-js .upsert). The generated DO UPDATE clause
--   re-sets every column in the payload, including the conflict-target columns
--   user_id and fixture_id. Migration 013 narrowed UPDATE to
--   (pred_home, pred_away, updated_at) only — so updating user_id / fixture_id is
--   denied, and ON CONFLICT DO UPDATE requires UPDATE privilege even when the row
--   is actually inserted (no conflict).
--
-- Fix:
--   Grant UPDATE on the two conflict-target columns. This is safe and does NOT
--   weaken the anti-cheat from migration 013:
--     - `points` is still NOT granted to clients (only service_role / owner / the
--       score_fixture trigger may write it).
--     - RLS WITH CHECK (auth.uid() = user_id) still prevents a user from setting
--       user_id to anyone else; the upsert only re-sets these columns to their
--       own existing values.

grant update (user_id, fixture_id)
  on public.predictions
  to authenticated;
