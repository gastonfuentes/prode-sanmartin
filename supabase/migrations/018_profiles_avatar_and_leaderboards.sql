-- Migration: 018_profiles_avatar_and_leaderboards
--
-- 1. Add avatar_url column to public.profiles.
-- 2. Update handle_new_user() to capture avatar_url from Google OAuth metadata.
--    The whitelist gate and P0001 raise are PRESERVED exactly.
-- 3. Backfill avatar_url for existing profiles from auth.users metadata.
-- 4. Recreate public.leaderboard(p_round_id) — adds id (uuid) and avatar_url to
--    the return shape. DROP + CREATE because the signature changes.
-- 5. Create public.leaderboard_overall() — cumulative group-stage standings with
--    the same shape as leaderboard(p_round_id).
-- 6. Grant EXECUTE to authenticated on both leaderboard functions (mirrors 011).

-- ─── 1. Add avatar_url to profiles ──────────────────────────────────────────

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'Google-provided profile photo URL from raw_user_meta_data (avatar_url or picture). '
  'Nullable — populated on signup and backfilled for existing users.';

-- ─── 2. Update handle_new_user() — add avatar_url to INSERT ─────────────────
--
-- ONLY the INSERT statement changes: avatar_url is added as a new column.
-- The whitelist gate (allowed_emails check + P0001 raise) is PRESERVED exactly.
-- SECURITY DEFINER and search_path are unchanged.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Whitelist check (case-insensitive). allowed_emails stores lowercased emails.
  -- PRESERVED EXACTLY — do not touch this block.
  if not exists (
    select 1
    from public.allowed_emails
    where email = lower(new.email)
  ) then
    raise exception 'Email % is not authorized to access this application', new.email
      using errcode = 'P0001';
  end if;

  -- Provision the public profile row linked 1:1 to auth.users.
  -- avatar_url is captured from Google OAuth metadata (avatar_url or picture key).
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  );

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: gates signup against the allowed_emails whitelist '
  'and provisions a profile row including avatar_url from Google OAuth metadata. '
  'Rejects non-listed emails with P0001. (REQ-1.2, REQ-1.3, REQ-1.5)';

-- ─── 3. Backfill avatar_url for existing profiles ────────────────────────────
--
-- Sets avatar_url for profiles that already exist (users who signed up before
-- this migration). Coalesces avatar_url then picture from Google metadata.
-- Safe to re-run — overwrites with the same value.

update public.profiles p
set avatar_url = coalesce(
  u.raw_user_meta_data ->> 'avatar_url',
  u.raw_user_meta_data ->> 'picture'
)
from auth.users u
where u.id = p.id
  and p.avatar_url is null;

-- ─── 4. Recreate leaderboard(p_round_id) with id + avatar_url ────────────────
--
-- The return signature CHANGES (adds id uuid and avatar_url text), so we must
-- DROP the existing function before re-creating it with the new signature.
--
-- Behaviour preserved:
--   - Standard competition ranking (1,1,3) via rank() OVER.
--   - All whitelisted players included (0-pt rows for non-participants) — REQ-6.5.
--   - Filters to the specified round only.
--
-- New columns in the return set:
--   id         uuid   — auth user id (for avatar lookup)
--   avatar_url text   — Google profile photo URL (nullable)

drop function if exists public.leaderboard(bigint);

create function public.leaderboard(p_round_id bigint)
returns table (
  id           uuid,
  rank         bigint,
  display_name text,
  avatar_url   text,
  total_points bigint,
  exact_count  bigint
)
language sql
security definer set search_path = public
as $$
  select
    pr.id,
    rank() over (order by coalesce(sum(p.points), 0) desc) as rank,
    pr.display_name,
    pr.avatar_url,
    coalesce(sum(p.points), 0)                             as total_points,
    count(*) filter (where p.points = 2)                   as exact_count
  from public.profiles pr
  left join public.predictions p
         on p.user_id = pr.id
  left join public.fixtures f
         on f.id = p.fixture_id
        and f.round_id = p_round_id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard(bigint) is
  'Returns per-player points, standard-competition rank, and avatar for the given round. '
  'Includes all whitelisted players (0-pt rows for non-participants — REQ-6.5). '
  'SECURITY DEFINER — reads across all profiles/predictions without exposing rows. '
  '(REQ-6.3 – REQ-6.5, ADR-3)';

grant execute on function public.leaderboard(bigint) to authenticated;

-- ─── 5. Create leaderboard_overall() — cumulative group-stage standings ──────
--
-- Returns total_points = sum of points across ALL fixtures in ALL rounds.
-- Same return shape as leaderboard(p_round_id) so the UI component is reusable.
-- Standard competition ranking, 0-pt players included (REQ-6.5).

create or replace function public.leaderboard_overall()
returns table (
  id           uuid,
  rank         bigint,
  display_name text,
  avatar_url   text,
  total_points bigint,
  exact_count  bigint
)
language sql
security definer set search_path = public
as $$
  select
    pr.id,
    rank() over (order by coalesce(sum(p.points), 0) desc) as rank,
    pr.display_name,
    pr.avatar_url,
    coalesce(sum(p.points), 0)  as total_points,
    count(*) filter (where p.points = 2) as exact_count
  from public.profiles pr
  left join public.predictions p on p.user_id = pr.id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard_overall() is
  'Returns cumulative (all-round) standings for every whitelisted player. '
  'Same shape as leaderboard(p_round_id) — reuses the standings UI component. '
  'SECURITY DEFINER — aggregates across all users without exposing raw rows. '
  '(REQ-6.3 – REQ-6.5, ADR-3)';

grant execute on function public.leaderboard_overall() to authenticated;
