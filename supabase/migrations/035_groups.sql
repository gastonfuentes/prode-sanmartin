-- Migration: 035_groups
--
-- Lightweight multi-tenancy: "groups of friends".
--
-- What this adds:
--   * public.groups         — named pools with an invite code
--   * public.group_members  — 1-to-1 user→group assignment (unique(user_id))
--   * allowed_emails.group_id — which group an invited email belongs to
--   * Helper RPCs: current_user_group_id(), join_group(), admin_create_group(),
--     admin_list_groups()
--   * Rewrites: is_allowed(), handle_new_user() — no more hard P0001 gate,
--     group membership auto-assigned on signup
--   * 5 read RPCs scoped to the caller's group: leaderboard(), leaderboard_overall(),
--     leaderboard_knockout(), list_participants(), round_predictions()
--   * RLS on groups + group_members; profiles SELECT policy tightened to same-group
--
-- Zero-downtime ordering rationale:
--   1. Extension (pgcrypto) — must exist before gen_random_bytes() calls below.
--   2. Tables (groups, group_members, allowed_emails column) — schema before data.
--   3. Default group + backfill — all existing profiles/emails assigned BEFORE
--      is_allowed() is rewritten; once the new is_allowed() lands, every existing
--      user already has group membership, so access is never interrupted.
--   4. current_user_group_id() — must exist before any RPC that calls it.
--   5. is_allowed() rewrite — now uses current_user_group_id().
--   6. handle_new_user() rewrite — drops the hard P0001 whitelist gate, auto-assigns
--      group on signup.
--   7. Read RPC rewrites — scoped to group via current_user_group_id().
--   8. RLS policies — added last so the functions they reference already exist.
--
-- Known limitation:
--   * Leaderboard RPCs filter to the caller's group via an INNER join on
--     group_members. An admin who calls these RPCs sees only their own group's
--     standings. admin_round_predictions() (mig 020) is intentionally NOT touched —
--     it stays global for admin export/review purposes.

-- ─── A. pgcrypto extension ───────────────────────────────────────────────────
--
-- gen_random_bytes() is used by admin_create_group() to generate invite codes.
-- Not enabled in mig 001 (which only enabled pg_cron and pg_net).

create extension if not exists pgcrypto;

-- ─── B. Tables ───────────────────────────────────────────────────────────────

create table public.groups (
  id         bigint generated always as identity primary key,
  name       text   not null,
  invite_code text  not null unique,
  created_at timestamptz not null default now()
);

comment on table public.groups is
  'Named pools of friends. Each pool has a unique invite code for joining.';

create table public.group_members (
  id        bigint generated always as identity primary key,
  group_id  bigint not null references public.groups(id)  on delete cascade,
  user_id   uuid   not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (user_id)
);

comment on table public.group_members is
  'Maps a user to exactly one group (unique on user_id).';

create index group_members_group_id_idx on public.group_members(group_id);

alter table public.allowed_emails
  add column group_id bigint references public.groups(id) on delete set null;

comment on column public.allowed_emails.group_id is
  'Which group this invited email belongs to. NULL = no group yet (migrated pre-groups emails).';

-- ─── C. Default group + backfill ─────────────────────────────────────────────
--
-- Must run BEFORE is_allowed() rewrite so every existing user has group membership.

with g as (
  insert into public.groups (name, invite_code)
  values ('San Martín', 'sanmartin')
  returning id
)
insert into public.group_members (group_id, user_id)
select g.id, p.id
from g
cross join public.profiles p
on conflict (user_id) do nothing;

update public.allowed_emails
set group_id = (select id from public.groups where invite_code = 'sanmartin')
where group_id is null;

-- ─── D. current_user_group_id() ──────────────────────────────────────────────
--
-- Returns the group the caller belongs to. Used by every group-scoped RPC and
-- by RLS policies. Returns NULL if the caller has no group membership.

create or replace function public.current_user_group_id()
returns bigint
language sql
security definer set search_path = public
stable
as $$
  select gm.group_id
  from public.group_members gm
  where gm.user_id = auth.uid();
$$;

comment on function public.current_user_group_id() is
  'Returns the group_id of the calling user, or NULL if they have no membership. '
  'SECURITY DEFINER — reads group_members bypassing RLS. Used by group-scoped RPCs '
  'and RLS policies.';

grant execute on function public.current_user_group_id() to authenticated;

-- ─── E. join_group(p_code) ───────────────────────────────────────────────────
--
-- Lets an authenticated user join a group by invite code. Idempotent if the
-- caller is already in the target group. Raises P0002 if they belong to a
-- DIFFERENT group (re-assignment not allowed — contact an admin).

create or replace function public.join_group(p_code text)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  v_code  text   := lower(trim(p_code));
  v_group bigint;
  v_existing bigint;
begin
  if auth.uid() is null then
    raise exception 'No autenticado'
      using errcode = 'P0001';
  end if;

  select id into v_group
  from public.groups
  where lower(invite_code) = v_code;

  if v_group is null then
    raise exception 'Código inválido'
      using errcode = 'P0001';
  end if;

  -- Check if caller is already in any group.
  select gm.group_id into v_existing
  from public.group_members gm
  where gm.user_id = auth.uid();

  if v_existing is not null then
    if v_existing = v_group then
      return v_group;  -- idempotent: already in this group
    else
      raise exception 'Ya pertenecés a otro grupo'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_group, auth.uid());

  return v_group;
end;
$$;

comment on function public.join_group(text) is
  'Join a group by invite code. Idempotent if already in the target group. '
  'Raises P0001 for unauthenticated callers or invalid codes, P0002 if the '
  'caller already belongs to a different group.';

grant execute on function public.join_group(text) to authenticated;

-- ─── F. admin_create_group(p_name) ───────────────────────────────────────────
--
-- Creates a new group with a randomly generated 8-char invite code. Retries on
-- the rare chance of a unique_violation on invite_code.

create or replace function public.admin_create_group(p_name text)
returns table (id bigint, name text, invite_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_name  text := trim(p_name);
  v_code  text;
  v_id    bigint;
  v_name_out text;
  v_code_out text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  if v_name = '' then
    raise exception 'Group name cannot be empty'
      using errcode = 'P0001';
  end if;

  loop
    -- Generate a URL-safe 8-char code from 6 random bytes encoded in base64,
    -- replacing base64 non-alphanumeric chars.
    v_code := lower(
      substr(
        translate(encode(gen_random_bytes(6), 'base64'), '+/=', 'xyz'),
        1, 8
      )
    );

    begin
      insert into public.groups (name, invite_code)
      values (v_name, v_code)
      returning groups.id, groups.name, groups.invite_code
      into v_id, v_name_out, v_code_out;

      exit;  -- success, leave the retry loop
    exception
      when unique_violation then
        -- invite_code collision (extremely rare) — retry
        null;
    end;
  end loop;

  return query select v_id, v_name_out, v_code_out;
end;
$$;

comment on function public.admin_create_group(text) is
  'Admin-only: create a new group with a randomly generated invite code. '
  'Retries on the rare invite_code unique_violation. Raises P0001 for '
  'non-admins or empty names.';

grant execute on function public.admin_create_group(text) to authenticated;

-- ─── G. admin_list_groups() ──────────────────────────────────────────────────
--
-- Returns all groups with member counts for the admin dashboard.

create or replace function public.admin_list_groups()
returns table (
  id           bigint,
  name         text,
  invite_code  text,
  member_count bigint,
  created_at   timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin access required'
      using errcode = 'P0001';
  end if;

  return query
    select
      g.id,
      g.name,
      g.invite_code,
      count(gm.id)  as member_count,
      g.created_at
    from public.groups g
    left join public.group_members gm on gm.group_id = g.id
    group by g.id
    order by g.created_at asc;
end;
$$;

comment on function public.admin_list_groups() is
  'Admin-only: list all groups with member count and metadata. '
  'Raises P0001 for non-admins.';

grant execute on function public.admin_list_groups() to authenticated;

-- ─── H. Rewrite is_allowed() ─────────────────────────────────────────────────
--
-- New logic: a user is allowed when they are an admin OR they belong to a group.
-- This replaces the allowed_emails JOIN approach from mig 024. The allowed_emails
-- table is still used to gate WHICH GROUP a new signup joins (handle_new_user),
-- but is no longer the primary ongoing-access gate.

create or replace function public.is_allowed()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  -- Admin always allowed; any group member is allowed.
  select public.is_admin() or public.current_user_group_id() is not null;
$$;

comment on function public.is_allowed() is
  'True when the caller has access: is_admin() OR belongs to any group. '
  'Supersedes the allowed_emails email-check from mig 024. SECURITY DEFINER. '
  'Used by the app layout to eject users who have no group membership.';

grant execute on function public.is_allowed() to authenticated;

-- ─── I. Rewrite handle_new_user() ────────────────────────────────────────────
--
-- REMOVES the hard P0001 whitelist gate. Any email can now create a Supabase auth
-- user. Access control is enforced AFTER login via is_allowed() (group membership).
--
-- On signup:
--   1. ALWAYS inserts a profile row with the exact display_name/avatar_url logic
--      from mig 018 (latest version).
--   2. Checks allowed_emails for a group_id assignment — if found, inserts a
--      group_members row so the user is immediately allowed post-signup.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_group bigint;
begin
  -- Provision the public profile row linked 1:1 to auth.users.
  -- display_name: Google full_name → email local part (mig 006/018 logic preserved).
  -- avatar_url: Google avatar_url or picture key (mig 018 logic preserved).
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  );

  -- Auto-assign group from allowed_emails if this email was pre-invited to a group.
  select ae.group_id into v_group
  from public.allowed_emails ae
  where ae.email = lower(new.email)
    and ae.group_id is not null
  limit 1;

  if v_group is not null then
    insert into public.group_members (group_id, user_id)
    values (v_group, new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: provisions a profile row with display_name '
  'and avatar_url from Google OAuth metadata (mig 018 logic). No longer raises P0001 '
  'for non-whitelisted emails — access control is now enforced via group membership '
  '(is_allowed()). If the email is in allowed_emails with a group_id, the user is '
  'auto-assigned to that group on signup. (mig 035, supersedes mig 006, mig 018)';

-- trg_handle_new_user (mig 006) stays bound; replacing the body above is enough.

-- ─── J. Rewrite read RPCs — scoped to caller's group ─────────────────────────

-- ── leaderboard(p_round_id) ──────────────────────────────────────────────────
--
-- Identical to mig 029 body, plus an INNER join on group_members so rank()
-- recomputes within the caller's group only. exact_count uses points >= 2 (mig 029).
-- Fixtures joined first (same order as mig 029), then predictions.

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
    count(*) filter (where p.points >= 2)                  as exact_count
  from public.profiles pr
  join public.group_members gm
    on gm.user_id = pr.id
   and gm.group_id = public.current_user_group_id()
  left join public.fixtures f
         on f.round_id = p_round_id
  left join public.predictions p
         on p.user_id = pr.id
        and p.fixture_id = f.id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard(bigint) is
  'Per-player points and rank for the given round, scoped to the caller''s group '
  '(INNER join on group_members). exact_count counts points >= 2 (mig 029). '
  '0-pt rows included for group members who did not predict. SECURITY DEFINER. '
  '(mig 035, supersedes mig 029)';

grant execute on function public.leaderboard(bigint) to authenticated;

-- ── leaderboard_overall() ────────────────────────────────────────────────────
--
-- Cumulative all-round standings scoped to the caller's group.

create or replace function public.leaderboard_overall()
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
    coalesce(sum(p.points), 0)            as total_points,
    count(*) filter (where p.points >= 2) as exact_count
  from public.profiles pr
  join public.group_members gm
    on gm.user_id = pr.id
   and gm.group_id = public.current_user_group_id()
  left join public.predictions p on p.user_id = pr.id
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard_overall() is
  'Cumulative (all-round) standings scoped to the caller''s group. '
  'exact_count counts points >= 2 (mig 029). 0-pt rows included for group members. '
  'SECURITY DEFINER. (mig 035, supersedes mig 029)';

grant execute on function public.leaderboard_overall() to authenticated;

-- ── leaderboard_knockout() ───────────────────────────────────────────────────
--
-- Knockout-only standings scoped to the caller's group (mig 034 body preserved).
-- stage='knockout' filter on the rounds LEFT join is preserved exactly.
-- rank() recomputes within the group.

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
  join public.group_members gm
    on gm.user_id = pr.id
   and gm.group_id = public.current_user_group_id()
  left join public.predictions p on p.user_id = pr.id
  left join public.fixtures    f on f.id = p.fixture_id
  left join public.rounds      r on r.id = f.round_id and r.stage = 'knockout'
  group by pr.id, pr.display_name, pr.avatar_url
  order by total_points desc, pr.display_name;
$$;

comment on function public.leaderboard_knockout() is
  'Knockout-stage standings scoped to the caller''s group. Sums only points from '
  'predictions whose fixture belongs to a stage=''knockout'' round. 0-pt rows '
  'included. exact_count counts points >= 2. SECURITY DEFINER. (mig 035, supersedes mig 034)';

grant execute on function public.leaderboard_knockout() to authenticated;

-- ── list_participants() ──────────────────────────────────────────────────────
--
-- Returns profiles in the caller's group with active flag.
-- Preserves mig 025 semantics (active = in allowed_emails OR admin), adds group scope.

create or replace function public.list_participants()
returns table (
  id           uuid,
  display_name text,
  avatar_url   text,
  active       boolean
)
language sql
security definer set search_path = public
stable
as $$
  select
    pr.id,
    pr.display_name,
    pr.avatar_url,
    (
      exists (select 1 from public.allowed_emails ae where ae.email = pr.email)
      or exists (select 1 from public.admins a where a.email = pr.email)
    ) as active
  from public.profiles pr
  join public.group_members gm
    on gm.user_id = pr.id
   and gm.group_id = public.current_user_group_id()
  order by pr.display_name;
$$;

comment on function public.list_participants() is
  'Profiles in the caller''s group plus an active flag (email in allowed_emails OR admin). '
  'SECURITY DEFINER — reads allowed_emails/admins (no client RLS). (mig 035, supersedes mig 025)';

grant execute on function public.list_participants() to authenticated;

-- ── round_predictions(p_round_id) ────────────────────────────────────────────
--
-- Preserves the per-fixture lock gate from mig 033 exactly.
-- Adds INNER join on group_members so only same-group authors are revealed.

create or replace function public.round_predictions(p_round_id bigint)
returns table (
  display_name text,
  fixture_id   bigint,
  pred_home    smallint,
  pred_away    smallint,
  points       smallint
)
language sql
security definer set search_path = public
as $$
  select
    pr.display_name,
    p.fixture_id,
    p.pred_home,
    p.pred_away,
    p.points
  from public.predictions p
  join public.fixtures  f  on f.id    = p.fixture_id
  join public.rounds    r  on r.id    = f.round_id
  join public.profiles  pr on pr.id   = p.user_id
  join public.group_members gm
    on gm.user_id = p.user_id
   and gm.group_id = public.current_user_group_id()
  where f.round_id = p_round_id
    and now() >= coalesce(f.locks_at, r.locks_at);  -- per-fixture gate (mig 033)
$$;

comment on function public.round_predictions(bigint) is
  'All players'' predictions for a round, gated PER FIXTURE (now() >= coalesce(fixtures.locks_at, '
  'rounds.locks_at)) and scoped to the caller''s group. Group fixtures fall back to the round lock '
  '(mig 033); knockout fixtures use their own lock. SECURITY DEFINER. (mig 035, supersedes mig 033)';

grant execute on function public.round_predictions(bigint) to authenticated;

-- ─── K. RLS policies ─────────────────────────────────────────────────────────

alter table public.groups       enable row level security;
alter table public.group_members enable row level security;

-- groups: a user can see only their own group (or any group if admin).
create policy groups_select_own on public.groups
  for select
  using (id = public.current_user_group_id() or public.is_admin());

-- group_members: a user can see members of their own group (or all if admin).
create policy group_members_select_own on public.group_members
  for select
  using (group_id = public.current_user_group_id() or public.is_admin());

-- profiles: tighten from "any authenticated user" (mig 010) to same-group only.
-- This closes the cross-group display_name/email leak via raw PostgREST queries.
-- Name from mig 010: profiles_select_authenticated.
drop policy if exists profiles_select_authenticated on public.profiles;

create policy profiles_select_same_group on public.profiles
  for select
  using (
    id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.group_members gm
      where gm.user_id = profiles.id
        and gm.group_id = public.current_user_group_id()
    )
  );
