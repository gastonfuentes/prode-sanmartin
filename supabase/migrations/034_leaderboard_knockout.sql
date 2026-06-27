-- Migration: 034_leaderboard_knockout
--
-- Knockout-only leaderboard. The existing leaderboard_overall() (mig 029) has no
-- stage filter, so it automatically becomes the GRAND TOTAL (group + knockout) the
-- moment knockout predictions exist — kept as-is. This adds the separate knockout
-- table requested by the players.
--
-- Same shape/contract as leaderboard_overall(): one row per whitelisted player,
-- standard-competition rank (1,1,3), 0-pt rows preserved for non-participants
-- (REQ-6.5). exact_count uses points >= 2 (knockout exact = 3, mig 029).
--
-- IMPORTANT — only knockout points may count. The rounds join carries the
-- stage = 'knockout' predicate (so non-participants keep their 0-pt rows), but the
-- aggregates are FILTERED on `r.id is not null`: a player's group-stage predictions
-- join to a NULL rounds row here and must not leak into the knockout total/rank.

create or replace function public.leaderboard_knockout()
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
    rank() over (
      order by coalesce(sum(p.points) filter (where r.id is not null), 0) desc
    )                                                                  as rank,
    pr.display_name,
    pr.avatar_url,
    coalesce(sum(p.points) filter (where r.id is not null), 0)         as total_points,
    count(*) filter (where r.id is not null and p.points >= 2)         as exact_count
  from public.profiles pr
  left join public.predictions p on p.user_id = pr.id
  left join public.fixtures    f on f.id = p.fixture_id
  left join public.rounds      r on r.id = f.round_id and r.stage = 'knockout'
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard_knockout() is
  'Knockout-stage standings for every whitelisted player. Sums only points from '
  'predictions whose fixture belongs to a stage=''knockout'' round (filtered on the '
  'rounds left join), keeping 0-pt rows for non-participants. exact_count counts '
  'points >= 2. Same shape as leaderboard_overall(). SECURITY DEFINER. (mig 034)';

grant execute on function public.leaderboard_knockout() to authenticated;
