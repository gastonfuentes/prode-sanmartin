-- Migration: 019_seed_allowed_emails_friends
-- Add friends to the email whitelist (REQ-1.2) so they can register via Google.
-- Emails are stored lowercase to match the handle_new_user trigger, which compares
-- lower(NEW.email) against this table. Idempotent: re-running is a no-op.

insert into public.allowed_emails (email) values
  ('rodrigo.f.zalazar@gmail.com'),
  ('ocjulionicolas@gmail.com'),
  ('marianofernandezalazar@gmail.com')
on conflict (email) do nothing;
