-- Migration: 027_locks_at_10_minutes
-- Change the betting lock boundary from 1 hour to 10 minutes before the first
-- kickoff (supersedes the interval defined in 004_rounds_fixtures.sql).
--
-- locks_at stays the authoritative lock boundary: enforce_betting_lock() rejects
-- predictions when now() >= rounds.locks_at. Only the offset changes here.

create or replace function public.set_round_locks_at()
returns trigger
language plpgsql
as $$
begin
  new.locks_at := case
    when new.first_kickoff is null then null
    else new.first_kickoff - interval '10 minutes'
  end;
  return new;
end;
$$;

-- Backfill existing rounds. The trigger only fires on insert/update of
-- first_kickoff, so re-touch it to recompute locks_at with the new offset.
-- Setting first_kickoff to itself keeps the DB as the single source of truth.
update public.rounds
set first_kickoff = first_kickoff
where first_kickoff is not null;
