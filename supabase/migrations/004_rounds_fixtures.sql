-- Migration: 004_rounds_fixtures
-- Create the rounds and fixtures tables (REQ-3.1, REQ-4.4).
--
-- rounds: one row per matchday/group-stage round.
--   api_round   -> API-Football "round" field (e.g. "Group Stage - 1"); used as
--                  idempotent grouping key by the sync Edge Function.
--   first_kickoff -> min(fixtures.kickoff) for this round; updated by the sync
--                    after each calendar upsert batch.
--   locks_at    -> STORED GENERATED column = first_kickoff - 1 hour (REQ-3.1).
--                  Cannot drift; computed once at write time, stored on disk.
--                  NULL when first_kickoff is NULL (no fixtures seeded yet).
--   status      -> denormalized convenience for UI/cron. Authoritative lock check
--                  is always `now() >= locks_at`, never status alone.
--
-- fixtures: one row per match.
--   id          -> API-Football fixture id (natural PK; idempotent upserts).
--   goals_*     -> NULL until the match reaches FT status (REQ-4.3, REQ-4.4).
--   status      -> API short status: NS (not started), 1H, HT, 2H, FT, etc.
--   home_logo / away_logo -> optional team badge URL from API-Football.

create table public.rounds (
  id            bigint        primary key generated always as identity,
  api_round     text          not null unique,
  name          text          not null,
  first_kickoff timestamptz,
  locks_at      timestamptz
    generated always as (first_kickoff - interval '1 hour') stored,
  status        public.round_status not null default 'open',
  created_at    timestamptz   not null default now()
);

comment on table  public.rounds                is 'One row per matchday group-stage round.';
comment on column public.rounds.api_round      is 'API-Football round field, e.g. "Group Stage - 1". Idempotent grouping key.';
comment on column public.rounds.first_kickoff  is 'min(kickoff) across fixtures in this round. Set/updated by sync Edge Function.';
comment on column public.rounds.locks_at       is 'STORED GENERATED: first_kickoff - 1 hour. Authoritative lock boundary (REQ-3.1).';
comment on column public.rounds.status         is 'Denormalized convenience. Authoritative lock = now() >= locks_at, not status.';

create table public.fixtures (
  id          bigint      primary key,
  round_id    bigint      not null references public.rounds(id) on delete cascade,
  home_team   text        not null,
  away_team   text        not null,
  home_logo   text,
  away_logo   text,
  kickoff     timestamptz not null,
  goals_home  smallint,
  goals_away  smallint,
  status      text        not null default 'NS',
  updated_at  timestamptz not null default now()
);

comment on table  public.fixtures            is 'One row per match. PK = API-Football fixture id for idempotent upserts.';
comment on column public.fixtures.id         is 'API-Football fixture id. Natural PK — no surrogate needed.';
comment on column public.fixtures.goals_home is 'NULL until fixture reaches FT. Written by sync Edge Function (REQ-4.4).';
comment on column public.fixtures.goals_away is 'NULL until fixture reaches FT. Written by sync Edge Function (REQ-4.4).';
comment on column public.fixtures.status     is 'API-Football short status: NS, 1H, HT, 2H, ET, PEN, FT, etc.';

create index on public.fixtures (round_id);
