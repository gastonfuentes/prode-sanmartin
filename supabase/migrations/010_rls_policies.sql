-- Migration: 010_rls_policies
-- Row Level Security for all user-facing tables (REQ-1.5, REQ-3.4, REQ-6.8).
--
-- Design principles (ADR-3):
--   - Every table has RLS enabled. Default: no access unless a policy grants it.
--   - predictions: OWNER-ONLY for SELECT/INSERT/UPDATE. No DELETE (predictions
--     are immutable once placed; only editable before lock via UPDATE).
--   - rounds + fixtures: readable by any authenticated user; no direct writes
--     (the sync Edge Function uses the service role which bypasses RLS).
--   - allowed_emails: NO client-readable policy. Clients cannot inspect the
--     whitelist. Only SECURITY DEFINER functions (handle_new_user, leaderboard,
--     round_predictions) can read it via their owner role.
--   - profiles: owner-readable for own row. Also readable by any authenticated
--     user for display_name in the leaderboard — but NO sensitive data is
--     exposed (the profiles table only holds id, email, display_name, created_at).
--     A broad "authenticated can read display_name" policy is acceptable here;
--     the leaderboard SECURITY DEFINER function will be used for aggregation
--     anyway, but direct profile reads (e.g. showing your own name) are needed.
--
-- profiles access decision:
--   Policy: any authenticated user can SELECT profiles.
--   Rationale: profiles only contains display_name (public info in a game among
--   friends). Restricting it to owner-only would block the leaderboard page
--   from showing names via RSC queries. The SECURITY DEFINER leaderboard()
--   function aggregates points; but the UI may also need a lightweight profile
--   lookup. Keeping it fully readable by authenticated users is appropriate
--   for a closed game of ~10 friends. If privacy needs change, this policy
--   can be restricted and the leaderboard() SECURITY DEFINER function handles
--   the cross-user name resolution.

-- ─── profiles ───────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

-- Any authenticated user can read profiles (display_name is public game info).
create policy profiles_select_authenticated on public.profiles
  for select
  using (auth.role() = 'authenticated');

-- Only the profile owner can update their own row (e.g. change display_name).
create policy profiles_update_own on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- INSERT is handled exclusively by the handle_new_user SECURITY DEFINER trigger,
-- which runs as the function owner (bypasses RLS). No client INSERT policy.

-- ─── predictions ────────────────────────────────────────────────────────────

alter table public.predictions enable row level security;

-- Users can only read their OWN predictions (REQ-3.5, ADR-3).
-- Cross-user reads of predictions happen only through round_predictions()
-- SECURITY DEFINER function, which gates on locks_at (privacy, REQ-6.8).
create policy predictions_select_own on public.predictions
  for select
  using (auth.uid() = user_id);

-- Users can only insert predictions for themselves.
create policy predictions_insert_own on public.predictions
  for insert
  with check (auth.uid() = user_id);

-- Users can only update their own predictions (before lock — enforced by trigger).
create policy predictions_update_own on public.predictions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No DELETE policy: predictions cannot be deleted by users.

-- ─── rounds ─────────────────────────────────────────────────────────────────

alter table public.rounds enable row level security;

-- All authenticated users can read rounds (needed to display fixtures, lock state).
create policy rounds_select_authenticated on public.rounds
  for select
  using (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE policies: rounds are written only by the service role
-- (sync Edge Function), which bypasses RLS entirely. This prevents any client
-- from creating or modifying rounds directly, even with an authenticated JWT.

-- ─── fixtures ───────────────────────────────────────────────────────────────

alter table public.fixtures enable row level security;

-- All authenticated users can read fixtures.
create policy fixtures_select_authenticated on public.fixtures
  for select
  using (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE policies: same as rounds — service role only.

-- ─── allowed_emails ─────────────────────────────────────────────────────────

alter table public.allowed_emails enable row level security;

-- No SELECT policy for clients. The whitelist is not readable by any authenticated
-- or anonymous user via PostgREST. SECURITY DEFINER functions (handle_new_user,
-- leaderboard) read it as the function owner, bypassing RLS.
-- This prevents users from enumerating who is on the whitelist.
