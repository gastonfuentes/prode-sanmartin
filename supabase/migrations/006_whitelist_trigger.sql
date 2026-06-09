-- Migration: 006_whitelist_trigger
-- Server-side email whitelist gate on auth.users (REQ-1.2, REQ-1.3, REQ-1.5).
--
-- Why a DB trigger instead of a Next.js middleware or Supabase auth hook:
--   - Auth hook (before-user-created) requires an Edge Function + hook config +
--     deploy overhead — justified for large user bases, overkill for ~10 friends.
--   - Next.js middleware runs AFTER the Supabase user row is created in auth.users;
--     blocking there would leave orphaned rows and is not the trust boundary.
--   - The AFTER INSERT trigger on auth.users fires INSIDE the auth insert transaction.
--     If the function raises, the entire transaction rolls back — the user row is
--     NEVER committed. Zero cleanup required, zero bypass surface. (ADR-2)
--
-- Behavior:
--   1. Convert the new user's email to lowercase for case-insensitive comparison.
--   2. If the email is NOT in public.allowed_emails → RAISE EXCEPTION (P0001).
--      The auth transaction rolls back; Supabase surfaces this as a 422/signup error.
--   3. If the email IS in the list → INSERT a row into public.profiles.
--      display_name defaults to the Google full_name meta field, falling back to
--      the local part of the email address (before "@").
--
-- Security:
--   SECURITY DEFINER so the function reads allowed_emails as the owner, bypassing
--   any future RLS restrictions on that table without granting broad privileges.
--   set search_path = public prevents search_path injection attacks.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Whitelist check (case-insensitive). allowed_emails stores lowercased emails.
  if not exists (
    select 1
    from public.allowed_emails
    where email = lower(new.email)
  ) then
    raise exception 'Email % is not authorized to access this application', new.email
      using errcode = 'P0001';
  end if;

  -- Provision the public profile row linked 1:1 to auth.users.
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    )
  );

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: gates signup against the allowed_emails whitelist '
  'and provisions a profile row. Rejects non-listed emails with P0001. (REQ-1.2, REQ-1.3, REQ-1.5)';

create trigger trg_handle_new_user
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
