-- Migration: 001_extensions_enum
-- Enable required PostgreSQL extensions and define the round_status enum.
-- These must exist before any table that references them.
--
-- Extensions: pg_cron (schedule jobs) and pg_net (outbound HTTP from Postgres)
-- Both are available on Supabase free tier under Database > Extensions.
-- See ADR-5 in design.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- round_status: lifecycle of a matchday round.
--   open     -> predictions allowed
--   locked   -> no more predictions (now() >= locks_at); auto-transition by cron
--   finished -> all fixtures FT and scoring done
--
-- The authoritative lock check is always `now() >= locks_at`, not `status`.
-- status is a denormalized convenience for UI/cron only.
create type public.round_status as enum ('open', 'locked', 'finished');
