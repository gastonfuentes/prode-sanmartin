-- Seed: placeholder emails for the allowed_emails whitelist.
--
-- Replace these 10 entries with the real email addresses of your players
-- before running `supabase db push` or `supabase db reset` against a real project.
--
-- Emails are lowercased here; the handle_new_user trigger (migration 006)
-- also lowercases incoming OAuth email before the lookup — always lowercase here.

insert into public.allowed_emails (email) values
  ('player1@example.com'),
  ('player2@example.com'),
  ('player3@example.com'),
  ('player4@example.com'),
  ('player5@example.com'),
  ('player6@example.com'),
  ('player7@example.com'),
  ('player8@example.com'),
  ('player9@example.com'),
  ('player10@example.com')
on conflict (email) do nothing;
