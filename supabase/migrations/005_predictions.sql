-- Migration: 005_predictions
-- Create the predictions table (REQ-2.1 - REQ-2.5, REQ-5.1 - REQ-5.7).
--
-- One prediction row per (user, fixture) pair:
--   UNIQUE(user_id, fixture_id) enforces REQ-2.5 at the DB level.
--   The app upserts on this conflict target (ON CONFLICT DO UPDATE).
--
-- Goal values are constrained 0..99 (REQ-2.4):
--   CHECK (pred_home >= 0 AND pred_home <= 99)
--   CHECK (pred_away >= 0 AND pred_away <= 99)
--   (Using 99 as the upper bound — realistic max score for any sport.)
--
-- points: materialized by the score_fixture AFTER UPDATE trigger on fixtures (PR-3).
--   Default 0 (pending); set to 0/1/2 once the fixture reaches FT.
--   Defaults to 0 not NULL so leaderboard SUM is always valid (REQ-6.5).
--
-- Betting lock enforcement is handled by the enforce_betting_lock
-- BEFORE INSERT OR UPDATE trigger on this table (PR-3, migration 007).

create table public.predictions (
  id          bigint      primary key generated always as identity,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  fixture_id  bigint      not null references public.fixtures(id) on delete cascade,
  pred_home   smallint    not null check (pred_home >= 0 and pred_home <= 99),
  pred_away   smallint    not null check (pred_away >= 0 and pred_away <= 99),
  points      smallint    not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, fixture_id)
);

comment on table  public.predictions             is 'One score prediction per user per fixture. Upsert target: UNIQUE(user_id, fixture_id).';
comment on column public.predictions.pred_home   is 'Predicted home goals. 0..99 (REQ-2.4).';
comment on column public.predictions.pred_away   is 'Predicted away goals. 0..99 (REQ-2.4).';
comment on column public.predictions.points      is 'Materialized by score_fixture trigger (migration 009) when fixture reaches FT. 0=pending/wrong, 1=correct outcome, 2=exact score.';

create index on public.predictions (fixture_id);
