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

-- Result collector (temp table, discarded on rollback; SELECTed before then).
create temp table _verify (id serial primary key, assertion text, result text, detail text);

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
  v := public.compute_points(2::smallint,1::smallint,2::smallint,1::smallint);
  insert into _verify (assertion, result, detail)
    values ('4a. exact 2-1 vs 2-1 -> 2', case when v=2 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(1::smallint,0::smallint,3::smallint,0::smallint);
  insert into _verify (assertion, result, detail)
    values ('4b. outcome only (home win) -> 1', case when v=1 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(0::smallint,0::smallint,1::smallint,1::smallint);
  insert into _verify (assertion, result, detail)
    values ('4c. outcome only (draw) -> 1', case when v=1 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(1::smallint,1::smallint,1::smallint,1::smallint);
  insert into _verify (assertion, result, detail)
    values ('4d. exact draw 1-1 -> 2', case when v=2 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(0::smallint,1::smallint,2::smallint,0::smallint);
  insert into _verify (assertion, result, detail)
    values ('4e. wrong outcome -> 0', case when v=0 then 'PASS' else 'FAIL' end, format('got %s', v));
  v := public.compute_points(0::smallint,0::smallint,0::smallint,0::smallint);
  insert into _verify (assertion, result, detail)
    values ('4f. exact 0-0 -> 2', case when v=2 then 'PASS' else 'FAIL' end, format('got %s', v));
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

  insert into _verify (assertion, result, detail)
    values ('5. score_fixture sets points after lock',
            case when v_points = 2 then 'PASS' else 'FAIL' end,
            format('Charlie points = %s (expected 2)', v_points));
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
do $$
declare
  v_past_round_id bigint;
  v_rec           record;
  v_charlie_rank  bigint;
  v_charlie_pts   bigint;
  v_alice_rank    bigint;
  v_bob_rank      bigint;
begin
  select id into v_past_round_id from public.rounds where api_round = 'Test - Past';

  for v_rec in select * from public.leaderboard(v_past_round_id) order by rank loop
    insert into _verify (assertion, result, detail)
      values ('7. leaderboard row', 'INFO',
              format('rank=%s name=%s pts=%s exact=%s',
                     v_rec.rank, v_rec.display_name, v_rec.total_points, v_rec.exact_count));
  end loop;

  select rank, total_points into v_charlie_rank, v_charlie_pts
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

-- ─── RESULTS: returned to the client BEFORE the rollback discards the seeds ──
select id, assertion, result, detail from _verify order by id;

rollback;
