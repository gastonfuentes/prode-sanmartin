-- Migration: 020_admin_export
-- Admin role + cross-user predictions export (POST-LOCK ONLY).
--
-- Adds a server-side admin set (mirrors the allowed_emails pattern: no client
-- SELECT policy) and two SECURITY DEFINER functions:
--   is_admin()                  -> boolean; true when the caller's profile email
--                                  is in public.admins.
--   admin_round_predictions(id) -> all players' predictions for LOCKED rounds,
--                                  gated on is_admin() AND now() >= locks_at.
--
-- Privacy invariant: this NEVER exposes pre-lock predictions. The locks_at gate
-- is the SAME one round_predictions() uses (migration 011, REQ-6.8). Admin status
-- only removes the audience restriction; it does NOT bypass the lock. An admin
-- who also plays cannot see others' picks before placing their own.

-- ─── admins table ────────────────────────────────────────────────────────────

create table public.admins (
  email     text        primary key,
  added_at  timestamptz not null default now()
);

comment on table public.admins is
  'Server-side admin whitelist. Emails here can view/export all players '
  'predictions for LOCKED rounds. Never exposed to clients — read only by '
  'SECURITY DEFINER functions (is_admin, admin_round_predictions).';

alter table public.admins enable row level security;
-- No SELECT/INSERT/UPDATE/DELETE policy: clients cannot read or enumerate admins.
-- Managed by the system owner via migrations / service role only.

-- ─── seed ────────────────────────────────────────────────────────────────────
-- The admin must also be whitelisted to register/log in (allowed_emails gate in
-- handle_new_user). Seed both. Emails lowercase to match the trigger's compare.

insert into public.allowed_emails (email) values
  ('gastonnicolasfuentes@gmail.com')
on conflict (email) do nothing;

insert into public.admins (email) values
  ('gastonnicolasfuentes@gmail.com')
on conflict (email) do nothing;

-- ─── is_admin() ──────────────────────────────────────────────────────────────
-- Resolves admin status from the CALLER (auth.uid()) → profiles.email → admins.
-- Using the profile email (not the JWT claim) is robust: profiles.email is set by
-- handle_new_user as lower(auth email) and always present for a logged-in user.
-- SECURITY DEFINER so it can read public.admins (which has no client RLS).

create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.admins   a on a.email = p.email
    where p.id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True when the current authenticated user is an admin (profile email is in '
  'public.admins). SECURITY DEFINER — reads the admins whitelist which has no '
  'client RLS. Used to gate admin_round_predictions() and the /admin UI.';

grant execute on function public.is_admin() to authenticated;

-- ─── admin_round_predictions(p_round_id) ─────────────────────────────────────
-- Returns every player's predictions for LOCKED rounds, with match + result
-- context for export. Two gates, both mandatory:
--   1. is_admin() must be true  → else raises P0001 (no data leak to non-admins).
--   2. now() >= r.locks_at      → only locked rounds (same privacy rule as
--                                 round_predictions, REQ-6.8). Pre-lock = excluded.
--                                 NULL locks_at (unseeded round) → excluded.
--
-- p_round_id NULL  → all locked rounds (full audit export).
-- p_round_id set   → that round only (still must be locked, else zero rows).
--
-- Ordering: round, player name, kickoff — stable output for CSV and cards.

create or replace function public.admin_round_predictions(p_round_id bigint default null)
returns table (
  round_id     bigint,
  api_round    text,
  user_id      uuid,
  display_name text,
  email        text,
  avatar_url   text,
  fixture_id   bigint,
  home_team    text,
  away_team    text,
  kickoff      timestamptz,
  pred_home    smallint,
  pred_away    smallint,
  goals_home   smallint,
  goals_away   smallint,
  points       smallint
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  return query
    select
      r.id,
      r.api_round,
      pr.id,
      pr.display_name,
      pr.email,
      pr.avatar_url,
      f.id,
      f.home_team,
      f.away_team,
      f.kickoff,
      p.pred_home,
      p.pred_away,
      f.goals_home,
      f.goals_away,
      p.points
    from public.predictions p
    join public.fixtures f  on f.id  = p.fixture_id
    join public.rounds   r  on r.id  = f.round_id
    join public.profiles pr on pr.id = p.user_id
    where now() >= r.locks_at                       -- privacy gate: locked only
      and (p_round_id is null or r.id = p_round_id)
    order by r.id, pr.display_name, f.kickoff;
end;
$$;

comment on function public.admin_round_predictions(bigint) is
  'Admin-only export of all players predictions for LOCKED rounds. Raises P0001 '
  'for non-admins. NULL p_round_id = all locked rounds; otherwise that round only. '
  'Never returns pre-lock predictions (now() >= locks_at gate, REQ-6.8).';

grant execute on function public.admin_round_predictions(bigint) to authenticated;
