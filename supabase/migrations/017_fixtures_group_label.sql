-- Migration: 017_fixtures_group_label
-- Add group_label column to public.fixtures.
--
-- Stores the WC group name (e.g. "Group A") for each fixture, sourced from
-- the ESPN standings endpoint during calendar sync.
-- Nullable: set during calendar sync; null for fixtures seeded before this
-- migration is deployed or when the standings endpoint cannot be reached.
--
-- home_logo and away_logo already exist (migration 004) — not re-added here.

alter table public.fixtures
  add column if not exists group_label text;

comment on column public.fixtures.group_label
  is 'WC group name (e.g. "Group A") resolved from ESPN standings. Populated by calendar sync. Null when not yet synced.';
