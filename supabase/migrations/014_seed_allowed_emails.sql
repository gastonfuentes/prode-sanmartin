-- Migration: 014_seed_allowed_emails
-- Seed the email whitelist (REQ-1.2). Only these emails may register via Google OAuth.
-- Emails are stored lowercase to match the handle_new_user trigger, which compares
-- lower(NEW.email) against this table. Idempotent: re-running is a no-op.

insert into public.allowed_emails (email) values
  ('gastonnicolasfuentes@gmail.com')
on conflict (email) do nothing;
