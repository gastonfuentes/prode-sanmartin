-- verify_security.sql
-- Manual verification script for PR-3: DB security layer.
-- Run this in the Supabase Dashboard → SQL Editor.
--
-- OUTPUT: this script returns a RESULT TABLE (assertion, result, detail) so the
-- SQL Editor displays each check as a row. The Supabase SQL Editor does NOT show
-- RAISE NOTICE messages, so all results are collected into a temp table and
-- SELECTed at the end, just before ROLLBACK.
--
-- SAFETY: the entire script runs inside a transaction that is ROLLED BACK at the
-- end. It seeds data temporarily but commits NOTHING permanently. The final
-- SELECT returns its rows to the client BEFORE the rollback discards the seeds,
-- so you still see the results. Re-runnable with no side effects.
--
-- SEEDING STRATEGY (no superuser trigger-bypass tricks):
--   The "past" round is created INITIALLY OPEN (first_kickoff in the future). We
--   seed predictions while the lock is open, then move first_kickoff into the
--   past to lock it. This exercises the real flow — including that the scoring
--   trigger still writes points AFTER lock (migration 012) — without privileged
--   trigger bypass.

begin;

-- Result collector. A REGULAR table in public (not temp): the Supabase SQL
-- Editor resets search_path between statements, which drops pg_temp and makes
-- unqualified temp tables unresolvable in later DO blocks. A public table is
-- always on the search_path. It is still discarded by the ROLLBACK at the end,
-- so nothing is persisted.
drop table if exists public._verify;
create table public._verify (id serial primary key, assertion text, result text, detail text);

-- ─── Seed step 1: whitelist the test emails ──────────────────────────────────
insert into public.allowed_emails (email) values
  ('alice@test.example'), ('bob@test.example'), ('charlie@test.example')
on conflict (email) do nothing;

-- ─── Seed step 2: insert auth.users (handle_new_user creates profiles) ───────
do $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) values
    ('00000000-0000-0000-0000-000000000000',
     '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@test.example',
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Alice"}', false),
    ('00000000-0000-0000-0000-000000000000',
     '00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@test.example',
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Bob"}', false),
    ('00000000-0000-0000-0000-000000000000',
     '00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'charlie@test.example',
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Charlie"}', false);
end;
$$;

-- ─── Seed step 3: two rounds, BOTH initially open (first_kickoff in future) ──
insert into public.rounds (api_round, name, first_kickoff, status) values
  ('Test - Past',   'Test Round Past',   now() + interval '3 hours', 'open'),
  ('Test - Future', 'Test Round Future', now() + interval '2 hours', 'open')
on conflict (api_round) do nothing;

-- ─── Seed step 4: one fixture per round ──────────────────────────────────────
do $$
declare
  v_past_round_id   bigint;
  v_future_round_id bigint;
begin
  select id into v_past_round_id   from public.rounds where api_round = 'Test - Past';
  select id into v_future_round_id from public.rounds where api_round = 'Test - Future';

  insert into public.fixtures (id, round_id, home_team, away_team, kickoff, status)
  values (9000001, v_past_round_id, 'Team A', 'Team B', now() + interval '3 hours', 'NS')
  on conflict (id) do nothing;

  insert into public.fixtures (id, round_id, home_team, away_team, kickoff, status)
  values (9000002, v_future_round_id, 'Team C', 'Team D', now() + interval '2 hours', 'NS')
  on conflict (id) do nothing;
end;
$$;

-- ─── Seed step 5: predictions, while BOTH rounds are still open ──────────────
do $$
begin
  insert into public.predictions (user_id, fixture_id, pred_home, pred_away) values
    ('00000000-0000-0000-0000-000000000003', 9000001, 2, 1),  -- Charlie, past fixture
    ('00000000-0000-0000-0000-000000000001', 9000002, 2, 1),  -- Alice, future fixture
    ('00000000-0000-0000-0000-000000000002', 9000002, 0, 0)   -- Bob, future fixture
  on conflict (user_id, fixture_id) do nothing;
end;
$$;

-- ─── Seed step 6: NOW lock the past round (move first_kickoff into the past) ──
update public.rounds
set first_kickoff = now() - interval '2 hours'
where api_round = 'Test - Past';

-- ─── ASSERTION 1: enforce_betting_lock rejects INSERT on a locked round ──────
do $$
begin
  begin
    insert into public.predictions (user_id, fixture_id, pred_home, pred_away)
    values ('00000000-0000-0000-0000-000000000001', 9000001, 1, 0);
    insert into _verify (assertion, result, detail)
      values ('1. lock rejects insert on locked round', 'FAIL', 'INSERT was NOT rejected');
  exception
    when sqlstate 'P0001' then
      insert into _verify (assertion, result, detail)
        values ('1. lock rejects insert on locked round', 'PASS', 'rejected with P0001');
    when others then
      insert into _verify (assertion, result, detail)
        values ('1. lock rejects insert on locked round', 'FAIL', format('unexpected %s / %s', sqlstate, sqlerrm));
  end;
end;
$$;

-- ─── ASSERTION 3: enforce_betting_lock allows INSERT on an open round ────────
do $$
begin
  begin
    insert into public.predictions (user_id, fixture_id, pred_home, pred_away)
    values ('00000000-0000-0000-0000-000000000003', 9000002, 2, 2);
    insert into _verify (assertion, result, detail)
      values ('3. lock allows insert on open round', 'PASS', 'accepted');
  exception
    when others then
      insert into _verify (assertion, result, detail)
        values ('3. lock allows insert on open round', 'FAIL', format('rejected %s / %s', sqlstate, sqlerrm));
  end;
end;
$$;

-- ─── ASSERTION 4: compute_points returns correct values ──────────────────────
do $$
declare
  v smallint;
begin
  -- compute_points is now 5-arg (mig 029): exact_points is supplied per round.
  -- Fecha-1 scoring (exact_points => 2):
  v := public.compute_points(2::smallint,1::smallint,2::smallint,1::smallint, 2::smallint);
  insert into _verify (assertion, result, detail)
    values ('4a. exact 2-1 vs 2-1 (exact=2) -> 2', case when v=2 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(1::smallint,0::smallint,3::smallint,0::smallint, 2::smallint);
  insert into _verify (assertion, result, detail)
    values ('4b. outcome only (home win) -> 1', case when v=1 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(0::smallint,0::smallint,1::smallint,1::smallint, 2::smallint);
  insert into _verify (assertion, result, detail)
    values ('4c. outcome only (draw) -> 1', case when v=1 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(1::smallint,1::smallint,1::smallint,1::smallint, 2::smallint);
  insert into _verify (assertion, result, detail)
    values ('4d. exact draw 1-1 (exact=2) -> 2', case when v=2 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(0::smallint,1::smallint,2::smallint,0::smallint, 2::smallint);
  insert into _verify (assertion, result, detail)
    values ('4e. wrong outcome -> 0', case when v=0 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(0::smallint,0::smallint,0::smallint,0::smallint, 2::smallint);
  insert into _verify (assertion, result, detail)
    values ('4f. exact 0-0 (exact=2) -> 2', case when v=2 then 'PASS' else 'FAIL' end, format('got %s', v));
  -- Fecha-2+ scoring (exact_points => 3): exact hit worth 3, outcome-only stays 1.
  v := public.compute_points(2::smallint,1::smallint,2::smallint,1::smallint, 3::smallint);
  insert into _verify (assertion, result, detail)
    values ('4g. exact 2-1 vs 2-1 (exact=3) -> 3', case when v=3 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(1::smallint,0::smallint,3::smallint,0::smallint, 3::smallint);
  insert into _verify (assertion, result, detail)
    values ('4h. outcome only (exact=3) -> 1', case when v=1 then 'PASS' else 'FAIL' end, format('got %s', v));
end;
$$;

-- ─── ASSERTION 5: score_fixture writes points on FT, even after lock ─────────
do $$
declare
  v_points smallint;
begin
  update public.fixtures
  set status = 'FT', goals_home = 2, goals_away = 1
  where id = 9000001;

  select points into v_points
  from public.predictions
  where user_id = '00000000-0000-0000-0000-000000000003' and fixture_id = 9000001;

  -- Charlie predicted 2-1, actual 2-1 → exact hit. Worth 2 if 'Test - Past' is
  -- the earliest round, or 3 if real earlier rounds coexist (mig 029). Either
  -- way an exact hit is >= 2, which is what this assertion cares about: the
  -- scoring trigger fires and writes points even after the round locked.
  insert into _verify (assertion, result, detail)
    values ('5. score_fixture sets points after lock',
            case when v_points >= 2 then 'PASS' else 'FAIL' end,
            format('Charlie points = %s (expected exact hit: 2 or 3)', v_points));
end;
$$;

-- ─── ASSERTION 6: round_predictions privacy gate ─────────────────────────────
do $$
declare
  v_past_round_id   bigint;
  v_future_round_id bigint;
  v_past_count      int;
  v_future_count    int;
begin
  select id into v_past_round_id   from public.rounds where api_round = 'Test - Past';
  select id into v_future_round_id from public.rounds where api_round = 'Test - Future';
  select count(*) into v_past_count   from public.round_predictions(v_past_round_id);
  select count(*) into v_future_count from public.round_predictions(v_future_round_id);

  insert into _verify (assertion, result, detail)
    values ('6a. round_predictions visible after lock',
            case when v_past_count > 0 then 'PASS' else 'FAIL' end,
            format('%s rows for locked round', v_past_count));
  insert into _verify (assertion, result, detail)
    values ('6b. round_predictions hidden before lock (privacy)',
            case when v_future_count = 0 then 'PASS' else 'FAIL' end,
            format('%s rows for open round (expected 0)', v_future_count));
end;
$$;

-- ─── ASSERTION 7: leaderboard — 0-pt players included, tie ranking ───────────
-- NOTE (mig 018): leaderboard() now returns id (uuid) and avatar_url (text) in
-- addition to rank, display_name, total_points, exact_count. The assertions
-- still read the same fields — extra columns are silently ignored in record
-- iteration and explicit column selects.
do $$
declare
  v_past_round_id bigint;
  v_rec           record;
  v_charlie_rank  bigint;
  v_charlie_pts   bigint;
  v_alice_rank    bigint;
  v_bob_rank      bigint;
  v_charlie_id    uuid;
begin
  select id into v_past_round_id from public.rounds where api_round = 'Test - Past';

  for v_rec in select * from public.leaderboard(v_past_round_id) order by rank loop
    insert into _verify (assertion, result, detail)
      values ('7. leaderboard row', 'INFO',
              format('rank=%s name=%s pts=%s exact=%s id_present=%s',
                     v_rec.rank, v_rec.display_name, v_rec.total_points,
                     v_rec.exact_count, v_rec.id is not null));
  end loop;

  select rank, total_points, id into v_charlie_rank, v_charlie_pts, v_charlie_id
  from public.leaderboard(v_past_round_id) where display_name = 'Charlie';
  select rank into v_alice_rank from public.leaderboard(v_past_round_id) where display_name = 'Alice';
  select rank into v_bob_rank   from public.leaderboard(v_past_round_id) where display_name = 'Bob';

  insert into _verify (assertion, result, detail)
    values ('7a. Charlie rank=1, pts=2',
            case when v_charlie_rank = 1 and v_charlie_pts = 2 then 'PASS' else 'FAIL' end,
            format('rank=%s pts=%s', v_charlie_rank, v_charlie_pts));
  insert into _verify (assertion, result, detail)
    values ('7b. Alice appears at 0 pts (REQ-6.5)',
            case when v_alice_rank is not null then 'PASS' else 'FAIL' end,
            format('rank=%s', v_alice_rank));
  insert into _verify (assertion, result, detail)
    values ('7c. Bob appears at 0 pts (REQ-6.5)',
            case when v_bob_rank is not null then 'PASS' else 'FAIL' end,
            format('rank=%s', v_bob_rank));
  insert into _verify (assertion, result, detail)
    values ('7d. Alice and Bob share rank (tie, REQ-6.4)',
            case when v_alice_rank is not null and v_alice_rank = v_bob_rank then 'PASS' else 'FAIL' end,
            format('alice=%s bob=%s', v_alice_rank, v_bob_rank));
  -- mig 018: leaderboard() now returns id uuid — verify the column is present
  insert into _verify (assertion, result, detail)
    values ('7e. leaderboard returns id column (mig 018)',
            case when v_charlie_id is not null then 'PASS' else 'FAIL' end,
            format('charlie id = %s', v_charlie_id));
end;
$$;

-- ─── ASSERTION 7f: leaderboard_overall — new cumulative function (mig 018) ───
do $$
declare
  v_row_count int;
  v_has_id    boolean;
begin
  select count(*), bool_and(id is not null)
    into v_row_count, v_has_id
  from public.leaderboard_overall();

  insert into _verify (assertion, result, detail)
    values ('7f. leaderboard_overall returns rows for all players (mig 018)',
            case when v_row_count >= 3 then 'PASS' else 'FAIL' end,
            format('%s rows (expected >= 3)', v_row_count));
  insert into _verify (assertion, result, detail)
    values ('7g. leaderboard_overall returns id column (mig 018)',
            case when v_has_id then 'PASS' else 'FAIL' end,
            'id is not null for all rows');
end;
$$;

-- ─── ASSERTION 8: RLS role simulation — MANUAL (needs a real JWT) ─────────────
insert into _verify (assertion, result, detail) values
  ('8. RLS owner-only checks', 'MANUAL', 'Needs a real auth JWT; SQL Editor runs as postgres (bypasses RLS). Verify via REST after deploy.');

-- ─── ASSERTION 9: handle_new_user rejects a non-whitelisted email (LIVE) ─────
do $$
declare
  v_intruder_id    uuid := '00000000-0000-0000-0000-000000000099';
  v_profile_exists boolean;
begin
  begin
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_intruder_id, 'authenticated', 'authenticated', 'intruder@not-allowed.example',
      '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false
    );
    insert into _verify (assertion, result, detail)
      values ('9a. whitelist rejects non-listed email', 'FAIL', 'intruder was NOT rejected');
  exception
    when sqlstate 'P0001' then
      insert into _verify (assertion, result, detail)
        values ('9a. whitelist rejects non-listed email', 'PASS', 'rejected with P0001');
    when others then
      insert into _verify (assertion, result, detail)
        values ('9a. whitelist rejects non-listed email', 'FAIL', format('unexpected %s / %s', sqlstate, sqlerrm));
  end;

  select exists(select 1 from public.profiles where id = v_intruder_id) into v_profile_exists;
  insert into _verify (assertion, result, detail)
    values ('9b. no profile leaked for rejected user',
            case when not v_profile_exists then 'PASS' else 'FAIL' end,
            case when v_profile_exists then 'profile row exists — leak!' else 'no profile row' end);
end;
$$;

-- ─── ASSERTION 10: points column is not writable by client roles (mig 013) ──
-- Checked via the catalog (has_column_privilege) — deterministic, no role/JWT sim.
do $$
declare
  v_points_upd boolean := has_column_privilege('authenticated', 'public.predictions', 'points', 'UPDATE');
  v_pred_upd   boolean := has_column_privilege('authenticated', 'public.predictions', 'pred_home', 'UPDATE');
begin
  insert into _verify (assertion, result, detail)
    values ('10a. authenticated CANNOT update points',
            case when not v_points_upd then 'PASS' else 'FAIL' end,
            format('has_column_privilege(points,UPDATE) = %s (expected false)', v_points_upd));
  insert into _verify (assertion, result, detail)
    values ('10b. authenticated CAN still update picks',
            case when v_pred_upd then 'PASS' else 'FAIL' end,
            format('has_column_privilege(pred_home,UPDATE) = %s (expected true)', v_pred_upd));
end;
$$;

-- ─── ASSERTION 11: leaderboard(p_round_id) is scoped to its round (mig 028) ──
-- Regression for the cross-round leak: leaderboard() must sum ONLY the round's
-- predictions, not every round. Charlie already has predictions in BOTH rounds
-- (past 9000001 = 2-1, future 9000002 = 2-2 from assertion 3). Until now the
-- future fixture stayed NS (0 pts), hiding the bug. Bring it to FT 2-2 so the
-- future round scores too, then assert the per-round leaderboard stays scoped.
--
--   After future FT 2-2:  Charlie 2-2 -> 2,  Bob 0-0 -> 1 (outcome),  Alice 2-1 -> 0
--   Correct leaderboard(past):  Charlie = 2 (only 9000001),  Bob = 0 (no past pred)
--   Buggy  leaderboard(past):   Charlie = 4 (2+2),           Bob = 1 (leaked future)
--   leaderboard_overall():      Charlie = 4 (cumulative — unaffected by the fix)
do $$
declare
  v_past_round_id    bigint;
  v_charlie_past     bigint;
  v_bob_past         bigint;
  v_charlie_overall  bigint;
begin
  select id into v_past_round_id from public.rounds where api_round = 'Test - Past';

  -- Score the future round so Charlie has non-zero points outside the past round.
  update public.fixtures
  set status = 'FT', goals_home = 2, goals_away = 2
  where id = 9000002;

  select total_points into v_charlie_past
  from public.leaderboard(v_past_round_id) where display_name = 'Charlie';
  select total_points into v_bob_past
  from public.leaderboard(v_past_round_id) where display_name = 'Bob';
  select total_points into v_charlie_overall
  from public.leaderboard_overall() where display_name = 'Charlie';

  insert into _verify (assertion, result, detail)
    values ('11a. leaderboard(past) scoped: Charlie = 2 (not 4)',
            case when v_charlie_past = 2 then 'PASS' else 'FAIL' end,
            format('Charlie past-round pts = %s (expected 2; bug leaks future round -> 4)', v_charlie_past));
  insert into _verify (assertion, result, detail)
    values ('11b. leaderboard(past) excludes other-round points: Bob = 0',
            case when v_bob_past = 0 then 'PASS' else 'FAIL' end,
            format('Bob past-round pts = %s (expected 0; Bob has no past prediction)', v_bob_past));
  insert into _verify (assertion, result, detail)
    values ('11c. leaderboard_overall stays cumulative: Charlie = 4',
            case when v_charlie_overall = 4 then 'PASS' else 'FAIL' end,
            format('Charlie overall pts = %s (expected 4 = past 2 + future 2)', v_charlie_overall));
end;
$$;

-- ─── RESULTS: returned to the client BEFORE the rollback discards the seeds ──
select id, assertion, result, detail from _verify order by id;

rollback;
