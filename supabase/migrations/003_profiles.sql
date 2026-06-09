-- Migration: 003_profiles
-- Create the profiles table: 1:1 with auth.users, holds display info (REQ-1.4).
--
-- id mirrors auth.users(id); ON DELETE CASCADE means that if Supabase removes
-- the user from auth.users the profile row is also removed automatically.
-- Populated by the handle_new_user trigger (PR-3, migration 006) so there is
-- never a profile row without a corresponding auth.users row.

create table public.profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  email        text        not null unique,
  display_name text,
  created_at   timestamptz not null default now()
);

comment on table public.profiles is
  'One row per registered user. Mirrors auth.users(id). '
  'Inserted by the handle_new_user AFTER INSERT trigger on auth.users (migration 006). '
  'display_name is shown on the leaderboard; email is stored lowercase.';
