-- Migration: 002_allowed_emails
-- Create the email whitelist table used to gate user registration (REQ-1.2, REQ-1.6).
--
-- allowed_emails: the set of emails permitted to register.
-- Managed by the system owner only; not exposed to clients via RLS.
-- The whitelist check is enforced by the handle_new_user trigger (PR-3, migration 006).

create table public.allowed_emails (
  email      text        primary key,
  added_at   timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Server-side email whitelist. Only these emails may register via Google OAuth. '
  'Managed by the system owner. Never exposed to clients — read only by SECURITY DEFINER functions.';
