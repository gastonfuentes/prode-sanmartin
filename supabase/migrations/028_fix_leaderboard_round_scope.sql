-- Migration: 028_fix_leaderboard_round_scope
--
-- BUGFIX: public.leaderboard(p_round_id) summed points across ALL rounds, not
-- just the requested one — making "Posiciones — Fecha actual" identical to the
-- cumulative "General" leaderboard.
--
-- Root cause (introduced in migration 018):
--   from profiles pr
--   left join predictions p on p.user_id = pr.id          -- no round filter
--   left join fixtures   f on f.id = p.fixture_id
--                        and f.round_id = p_round_id        -- only nulls f.*
--   ...
--   coalesce(sum(p.points), 0) as total_points
--
-- The round predicate lived on the fixtures join, so a prediction from another
-- round merely produced NULL f.* columns — its row (and its points) survived
-- into sum(p.points). The function therefore behaved like leaderboard_overall().
--
-- Fix: scope predictions to the round's fixtures by reordering the joins
-- (profiles -> fixtures-of-round -> predictions). sum(p.points) now counts only
-- predictions for fixtures in p_round_id.
--
-- Behaviour preserved:
--   - All whitelisted players included (0-pt rows for non-participants) — REQ-6.5
--     (LEFT JOINs keep every profile; players with no round prediction → 0).
--   - Standard competition ranking (1,1,3) via rank() OVER.
--   - exact_count semantics (count of 2-pt hits) — now correctly round-scoped.
--   - A round with no fixtures / no FT results → every player at 0.
--
-- Signature is unchanged, so CREATE OR REPLACE preserves the existing
-- GRANT EXECUTE ... TO authenticated (re-granted below to match repo convention).
-- leaderboard_overall() is correct and left untouched.

create or replace function public.leaderboard(p_round_id bigint)
returns table (
  id           uuid,
  rank         bigint,
  display_name text,
  avatar_url   text,
  total_points bigint,
  exact_count  bigint
)
language sql
security definer set search_path = public
as $$
  select
    pr.id,
    rank() over (order by coalesce(sum(p.points), 0) desc) as rank,
    pr.display_name,
    pr.avatar_url,
    coalesce(sum(p.points), 0)                             as total_points,
    count(*) filter (where p.points = 2)                   as exact_count
  from public.profiles pr
  left join public.fixtures f
         on f.round_id = p_round_id
  left join public.predictions p
         on p.user_id = pr.id
        and p.fixture_id = f.id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard(bigint) is
  'Returns per-player points, standard-competition rank, and avatar for the given round. '
  'Points are scoped to fixtures in p_round_id (mig 028 fix — previously summed all rounds). '
  'Includes all whitelisted players (0-pt rows for non-participants — REQ-6.5). '
  'SECURITY DEFINER — reads across all profiles/predictions without exposing rows. '
  '(REQ-6.3 – REQ-6.5, ADR-3)';

grant execute on function public.leaderboard(bigint) to authenticated;
