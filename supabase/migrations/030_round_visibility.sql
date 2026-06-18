-- Migration: 030_round_visibility
--
-- Admin-controlled round visibility ("disable a fecha"). The admin can hide an
-- upcoming round (e.g. fecha 3) so it disappears for regular players, then
-- re-enable it from the /admin panel.
--
-- Adds rounds.is_active (default true). When false, a round is hidden from
-- non-admins EVERYWHERE at once via the rounds SELECT RLS policy:
--   - it stops being the post-login redirect target (the root-page query no
--     longer returns it, so selectCurrentRound falls back to the next active),
--   - it disappears from the RoundsNav pill list,
--   - direct access to /rounds/{id} returns zero rows → the page redirects to /.
--
-- Admins still see every round (is_admin() branch in the policy) so they can
-- toggle it back on.
--
-- WHY at the RLS layer (not per-query app filtering): a single policy covers
-- every PostgREST read of rounds — no query can forget the filter and leak a
-- hidden round. The SECURITY DEFINER functions that JOIN rounds
-- (round_predictions, admin_round_predictions, leaderboard, list_participants)
-- and the row triggers (enforce_betting_lock, score_fixture) run as the function
-- owner and BYPASS RLS, so scoring / leaderboards / lock enforcement are
-- unaffected by this policy change.

-- ─── is_active column ────────────────────────────────────────────────────────

alter table public.rounds
  add column is_active boolean not null default true;

comment on column public.rounds.is_active is
  'Admin visibility flag. false = hidden from non-admins (not a redirect target, '
  'not in nav, /rounds/{id} redirects to the active round). Admins always see it '
  'via is_admin() in the rounds SELECT policy. Default true so existing rounds '
  'stay visible. Toggled by admin_set_round_active() (mig 030).';

-- ─── rounds SELECT policy (replace mig 010 rounds_select_authenticated) ───────
-- Old: any authenticated user reads ALL rounds.
-- New: any authenticated user reads ACTIVE rounds; admins read all.
-- Postgres short-circuits is_active OR is_admin(), so for the common case
-- (active round) is_admin() is never evaluated.

drop policy if exists rounds_select_authenticated on public.rounds;

create policy rounds_select_visible on public.rounds
  for select
  using (
    auth.role() = 'authenticated'
    and (is_active or public.is_admin())
  );

-- INSERT/UPDATE/DELETE policies remain intentionally absent: rounds are written
-- only by the service role (sync Edge Function) and by admin_set_round_active()
-- below (SECURITY DEFINER), both of which bypass RLS.

-- ─── admin_set_round_active(p_round_id, p_active) ────────────────────────────
-- Admin-only toggle for rounds.is_active. Mirrors the admin_* pattern (mig 020):
-- is_admin() gate raising P0001 for non-admins, SECURITY DEFINER + fixed
-- search_path. NOT marked stable — it writes a row.

create or replace function public.admin_set_round_active(
  p_round_id bigint,
  p_active   boolean
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  if p_round_id is null or p_active is null then
    raise exception 'Invalid input: round id and active flag are required'
      using errcode = 'P0001';
  end if;

  update public.rounds
  set is_active = p_active
  where id = p_round_id;

  if not found then
    raise exception 'Round % not found', p_round_id
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.admin_set_round_active(bigint, boolean) is
  'Admin-only: set rounds.is_active for one round (show/hide a fecha). Raises '
  'P0001 for non-admins, null input, or unknown round. SECURITY DEFINER — '
  'bypasses the no-client-write rule on rounds (mig 030).';

grant execute on function public.admin_set_round_active(bigint, boolean) to authenticated;
