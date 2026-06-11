-- Migration: 024_admin_user_management
-- Admin-managed user access from the dashboard: list / add / revoke.
--
-- Until now, granting a friend access meant hand-writing a seed migration
-- (XXX_seed_allowed_emails_friends.sql) and running `supabase db push`. This
-- moves that to the existing /admin dashboard via four SECURITY DEFINER RPCs.
--
-- Model: public.allowed_emails IS the source of truth for "who has access". It
-- gates BOTH first-time signup (handle_new_user, migration 006) AND ongoing
-- access (is_allowed(), checked by app/(app)/layout.tsx).
--   add / reactivate -> insert into allowed_emails
--   revoke (baja)     -> delete from allowed_emails ONLY
--
-- Why revoke does NOT delete the user: the handle_new_user trigger only fires on
-- the FIRST auth.users INSERT, so removing the email does not, by itself, eject
-- an already-registered user — that is what is_allowed() (re-checked per request)
-- is for. Keeping auth.users/profiles/predictions intact means a revoked user's
-- predictions and standings position are PRESERVED (soft "baja"), and we never
-- touch the auth schema (no special privileges required).
--
-- All RPCs are gated on is_admin() (migration 020) and raise on violation:
--   P0001 -> not an admin / invalid input
--   P0002 -> cannot revoke yourself
--   P0003 -> cannot revoke another admin
-- Emails are normalized lower(trim(...)) to match the whitelist compare
-- (handle_new_user, migration 006) and the lowercase seed convention.

-- ─── is_allowed() ──────────────────────────────────────────────────────────────
-- Ongoing-access gate for the CALLER. True when the caller's profile email is in
-- allowed_emails, OR the caller is an admin (an admin can never lock themselves
-- out). SECURITY DEFINER so it can read allowed_emails (no client RLS). Consumed
-- by the app shell layout to redirect revoked users to /login.

create or replace function public.is_allowed()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select public.is_admin() or exists (
    select 1
    from public.profiles p
    join public.allowed_emails ae on ae.email = p.email
    where p.id = auth.uid()
  );
$$;

comment on function public.is_allowed() is
  'True when the current user still has access: profile email in allowed_emails '
  'OR is_admin(). SECURITY DEFINER — reads allowed_emails (no client RLS). Used by '
  'the app layout to eject revoked users (soft baja).';

grant execute on function public.is_allowed() to authenticated;

-- ─── admin_list_users() ────────────────────────────────────────────────────────
-- Every email the system knows about, for the dashboard. FULL OUTER JOIN of the
-- whitelist and profiles so we surface BOTH pending invites (in allowed_emails,
-- not yet registered) AND revoked users (registered but no longer whitelisted —
-- so the admin can reactivate them). Gated on is_admin().
--   registered -> a profile exists (the person has logged in at least once)
--   active     -> the email is currently in allowed_emails (has access)
--   is_admin   -> the email is in public.admins (protected from revoke)

create or replace function public.admin_list_users()
returns table (
  email        text,
  display_name text,
  registered   boolean,
  active       boolean,
  is_admin     boolean,
  added_at     timestamptz
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
      coalesce(ae.email, p.email)        as email,
      p.display_name                     as display_name,
      (p.id is not null)                 as registered,
      (ae.email is not null)             as active,
      (adm.email is not null)            as is_admin,
      ae.added_at                        as added_at
    from public.allowed_emails ae
    full outer join public.profiles p on p.email = ae.email
    left join public.admins adm on adm.email = coalesce(ae.email, p.email)
    order by
      (adm.email is not null) desc,                 -- admins first
      (ae.email is not null) desc,                  -- then active users
      coalesce(ae.added_at, p.created_at) asc;      -- then by when they joined
end;
$$;

comment on function public.admin_list_users() is
  'Admin-only listing of all known emails (allowed_emails FULL OUTER JOIN '
  'profiles). Returns registered/active/is_admin flags so the dashboard can show '
  'pending, active, inactive and admin rows. Raises P0001 for non-admins.';

grant execute on function public.admin_list_users() to authenticated;

-- ─── admin_add_allowed_email(p_email) ────────────────────────────────────────
-- Add an email to the whitelist. Idempotent (on conflict do nothing), so it also
-- serves as "reactivate" for a previously revoked user — their existing profile
-- and predictions are untouched, they simply regain access. Gated on is_admin().

create or replace function public.admin_add_allowed_email(p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Invalid email: %', p_email using errcode = 'P0001';
  end if;

  insert into public.allowed_emails (email)
  values (v_email)
  on conflict (email) do nothing;
end;
$$;

comment on function public.admin_add_allowed_email(text) is
  'Admin-only: add an email to allowed_emails (idempotent). Doubles as reactivate '
  'for a revoked user (profile/predictions are preserved). Raises P0001 for '
  'non-admins or invalid input.';

grant execute on function public.admin_add_allowed_email(text) to authenticated;

-- ─── admin_revoke_access(p_email) ────────────────────────────────────────────
-- Soft baja: remove the email from allowed_emails ONLY. Future signups are
-- blocked and is_allowed() starts returning false for them (ejected on next
-- request by the layout). Their auth.users/profiles/predictions are intentionally
-- left intact so their history and standings position survive. Guards live here
-- (the DB is the trust boundary; the UI guard is convenience only).

create or replace function public.admin_revoke_access(p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_email  text := lower(trim(p_email));
  v_caller text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  -- The caller's own email (auth.uid() -> profiles.email), to block self-removal.
  select p.email into v_caller
  from public.profiles p
  where p.id = auth.uid();

  if v_email = v_caller then
    raise exception 'Cannot revoke your own access' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.admins a where a.email = v_email) then
    raise exception 'Cannot revoke an admin' using errcode = 'P0003';
  end if;

  delete from public.allowed_emails where email = v_email;
end;
$$;

comment on function public.admin_revoke_access(text) is
  'Admin-only soft baja: delete the email from allowed_emails only (preserves '
  'profile + predictions). Raises P0002 (self) / P0003 (admin) / P0001 (non-admin).';

grant execute on function public.admin_revoke_access(text) to authenticated;
