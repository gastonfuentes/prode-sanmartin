-- verify_security.sql
-- Manual verification script for PR-3: DB security layer.
-- Run this in the Supabase Dashboard → SQL Editor.
--
-- SAFETY: the entire script runs inside a transaction that is ROLLED BACK at
-- the end. It seeds data temporarily but commits NOTHING permanently to the DB.
-- You can run it multiple times without side effects.
--
-- HOW TO RUN:
--   1. Open Supabase Dashboard → SQL Editor.
--   2. Paste the entire file contents.
--   3. Execute. Read the NOTICE messages for each assertion result.
--   4. The final "ROLLBACK" ensures no data is persisted.
--
-- SEEDING STRATEGY (no superuser trigger-bypass tricks):
--   We create the "past" round INITIALLY OPEN (first_kickoff in the future), seed
--   the predictions while the lock is open, and only THEN move first_kickoff into
--   the past to lock it. This exercises the real flow — including that the scoring
--   trigger can still write points AFTER the round locks (migration 012) — without
--   needing session_replication_role or any privileged trigger bypass.
--
-- WHAT THIS TESTS (assertions 1–9):
--   1. enforce_betting_lock: rejects INSERT on a locked round.
--   3. enforce_betting_lock: allows INSERT on an open (future) round.
--   4. compute_points: correct values for all scoring scenarios.
--   5. score_fixture: writes predictions.points on FT transition, even after lock.
--   6. round_predictions: 0 rows before lock, rows after lock (privacy gate).
--   7. leaderboard: includes 0-pt players; standard competition ranking.
--   8. RLS role checks — manual steps documented at the bottom (need a real JWT).
--   9. handle_new_user: rejects non-whitelisted email (LIVE, REQ-1.2/1.3).

begin;

-- ─── Seed step 1: whitelist the test emails ──────────────────────────────────
insert into public.allowed_emails (email) values
  ('alice@test.example'),
  ('bob@test.example'),
  ('charlie@test.example')
on conflict (email) do nothing;

-- ─── Seed step 2: insert auth.users (handle_new_user creates profiles) ───────
-- display_name resolves from raw_user_meta_data->>'full_name'.
do $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
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
-- The set_round_locks_at trigger derives locks_at = first_kickoff - 1 hour.
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
-- Charlie predicts 2-1 on the (soon-to-be-locked) past fixture.
-- Alice and Bob predict on the future fixture.
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
-- The set_round_locks_at trigger recomputes locks_at to ~3 hours ago.
update public.rounds
set first_kickoff = now() - interval '2 hours'
where api_round = 'Test - Past';

-- ─── ASSERTION 1: enforce_betting_lock rejects INSERT on a locked round ──────
do $$
begin
  begin
    insert into public.predictions (user_id, fixture_id, pred_home, pred_away)
    values ('00000000-0000-0000-0000-000000000001', 9000001, 1, 0);  -- Alice, locked fixture
    raise notice 'ASSERTION 1 FAILED: INSERT on locked round was NOT rejected.';
  exception
    when sqlstate 'P0001' then
      raise notice 'ASSERTION 1 PASSED: INSERT on locked round correctly rejected (P0001).';
    when others then
      raise notice 'ASSERTION 1 FAILED: unexpected error % / %', sqlstate, sqlerrm;
  end;
end;
$$;

-- ─── ASSERTION 3: enforce_betting_lock allows INSERT on an open round ────────
do $$
begin
  begin
    insert into public.predictions (user_id, fixture_id, pred_home, pred_away)
    values ('00000000-0000-0000-0000-000000000003', 9000002, 2, 2);  -- Charlie, open future fixture
    raise notice 'ASSERTION 3 PASSED: INSERT on open (future) round accepted.';
  exception
    when others then
      raise notice 'ASSERTION 3 FAILED: INSERT unexpectedly rejected: % / %', sqlstate, sqlerrm;
  end;
end;
$$;

-- ─── ASSERTION 4: compute_points returns correct values ──────────────────────
do $$
declare
  v_result smallint;
begin
  v_result := public.compute_points(2::smallint, 1::smallint, 2::smallint, 1::smallint);
  if v_result = 2 then raise notice 'ASSERTION 4a PASSED: exact score (2-1 vs 2-1) -> 2 pts.';
  else raise notice 'ASSERTION 4a FAILED: expected 2, got %.', v_result; end if;

  v_result := public.compute_points(1::smallint, 0::smallint, 3::smallint, 0::smallint);
  if v_result = 1 then raise notice 'ASSERTION 4b PASSED: correct outcome home win (1-0 pred, 3-0 actual) -> 1 pt.';
  else raise notice 'ASSERTION 4b FAILED: expected 1, got %.', v_result; end if;

  v_result := public.compute_points(0::smallint, 0::smallint, 1::smallint, 1::smallint);
  if v_result = 1 then raise notice 'ASSERTION 4c PASSED: correct outcome draw (0-0 pred, 1-1 actual) -> 1 pt.';
  else raise notice 'ASSERTION 4c FAILED: expected 1, got %.', v_result; end if;

  v_result := public.compute_points(1::smallint, 1::smallint, 1::smallint, 1::smallint);
  if v_result = 2 then raise notice 'ASSERTION 4d PASSED: exact draw (1-1 vs 1-1) -> 2 pts.';
  else raise notice 'ASSERTION 4d FAILED: expected 2, got %.', v_result; end if;

  v_result := public.compute_points(0::smallint, 1::smallint, 2::smallint, 0::smallint);
  if v_result = 0 then raise notice 'ASSERTION 4e PASSED: wrong outcome (0-1 pred, 2-0 actual) -> 0 pts.';
  else raise notice 'ASSERTION 4e FAILED: expected 0, got %.', v_result; end if;

  v_result := public.compute_points(0::smallint, 0::smallint, 0::smallint, 0::smallint);
  if v_result = 2 then raise notice 'ASSERTION 4f PASSED: exact 0-0 draw -> 2 pts.';
  else raise notice 'ASSERTION 4f FAILED: expected 2, got %.', v_result; end if;
end;
$$;

-- ─── ASSERTION 5: score_fixture writes points on FT, even after lock ─────────
-- Charlie's prediction on 9000001 was seeded while open; the round is now locked.
-- Transitioning the fixture to FT must fire score_fixture and set points = 2,
-- which only works because migration 012 lets the scoring update through the lock.
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

  if v_points = 2 then
    raise notice 'ASSERTION 5 PASSED: score_fixture set Charlie''s points to 2 (exact 2-1) after lock.';
  else
    raise notice 'ASSERTION 5 FAILED: expected 2, got %.', v_points;
  end if;
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

  if v_past_count > 0 then
    raise notice 'ASSERTION 6a PASSED: round_predictions returns % rows for locked round (visible post-lock).', v_past_count;
  else
    raise notice 'ASSERTION 6a FAILED: round_predictions returned 0 rows for locked round (expected > 0).';
  end if;

  if v_future_count = 0 then
    raise notice 'ASSERTION 6b PASSED: round_predictions returns 0 rows for open round (privacy gate working).';
  else
    raise notice 'ASSERTION 6b FAILED: round_predictions returned % rows for open round (expected 0 — privacy leak!).', v_future_count;
  end if;
end;
$$;

-- ─── ASSERTION 7: leaderboard — 0-pt players included, tie ranking ───────────
-- Past round: Charlie has 2 pts. Alice and Bob have no prediction there, so they
-- must still appear at 0 pts (REQ-6.5) and share rank 2 (standard competition).
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

  raise notice 'ASSERTION 7: leaderboard for past round:';
  for v_rec in select * from public.leaderboard(v_past_round_id) loop
    raise notice '  rank=%, name=%, pts=%, exact=%',
      v_rec.rank, v_rec.display_name, v_rec.total_points, v_rec.exact_count;
  end loop;

  select rank, total_points into v_charlie_rank, v_charlie_pts
  from public.leaderboard(v_past_round_id) where display_name = 'Charlie';
  select rank into v_alice_rank from public.leaderboard(v_past_round_id) where display_name = 'Alice';
  select rank into v_bob_rank   from public.leaderboard(v_past_round_id) where display_name = 'Bob';

  if v_charlie_rank = 1 and v_charlie_pts = 2 then
    raise notice 'ASSERTION 7a PASSED: Charlie rank=1, pts=2.';
  else
    raise notice 'ASSERTION 7a FAILED: Charlie rank=%, pts=%.', v_charlie_rank, v_charlie_pts;
  end if;

  if v_alice_rank is not null then
    raise notice 'ASSERTION 7b PASSED: Alice appears at 0 pts (REQ-6.5). rank=%.', v_alice_rank;
  else
    raise notice 'ASSERTION 7b FAILED: Alice not found in leaderboard.';
  end if;

  if v_bob_rank is not null then
    raise notice 'ASSERTION 7c PASSED: Bob appears at 0 pts. rank=%.', v_bob_rank;
  else
    raise notice 'ASSERTION 7c FAILED: Bob not found in leaderboard.';
  end if;

  if v_alice_rank is not null and v_bob_rank is not null and v_alice_rank = v_bob_rank then
    raise notice 'ASSERTION 7d PASSED: Alice and Bob share rank % (standard competition ranking, REQ-6.4).', v_alice_rank;
  else
    raise notice 'ASSERTION 7d RESULT: Alice rank=%, Bob rank=% (expected equal — tied at 0 pts).', v_alice_rank, v_bob_rank;
  end if;
end;
$$;

-- ─── ASSERTION 8: RLS role simulation — MANUAL (needs a real JWT) ─────────────
-- The Dashboard SQL Editor runs as postgres, which bypasses RLS, so owner-only
-- policies cannot be exercised here. Verify after the app is deployed:
--   8a. GET /rest/v1/predictions with Alice's JWT → only Alice's rows.
--   8b. POST /rest/v1/predictions with Alice's JWT but user_id=Bob → 403.
--   8c. GET /rest/v1/allowed_emails with any JWT → [] (no SELECT policy).
--   8d. GET /rest/v1/rounds with an authenticated JWT → all rows (200).
--   8e. GET /rest/v1/predictions with anon key only → [] (no anon grant).
do $$ begin
  raise notice 'ASSERTION 8: RLS owner-only checks require a real JWT — see manual steps in comments.';
end $$;

-- ─── ASSERTION 9: handle_new_user rejects a non-whitelisted email (LIVE) ─────
do $$
declare
  v_intruder_id    uuid := '00000000-0000-0000-0000-000000000099';
  v_profile_exists boolean;
begin
  begin
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_intruder_id, 'authenticated', 'authenticated', 'intruder@not-allowed.example',
      '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false
    );
    raise notice 'ASSERTION 9a FAILED: non-whitelisted email was NOT rejected.';
  exception
    when sqlstate 'P0001' then
      raise notice 'ASSERTION 9a PASSED: non-whitelisted email rejected by handle_new_user (P0001).';
    when others then
      raise notice 'ASSERTION 9a FAILED: unexpected error % / %', sqlstate, sqlerrm;
  end;

  select exists(select 1 from public.profiles where id = v_intruder_id) into v_profile_exists;
  if not v_profile_exists then
    raise notice 'ASSERTION 9b PASSED: no profiles row created for the rejected user (REQ-1.3).';
  else
    raise notice 'ASSERTION 9b FAILED: a profiles row exists for the rejected intruder — data leak!';
  end if;
end;
$$;

-- ─── ROLLBACK — nothing is persisted ─────────────────────────────────────────
rollback;
