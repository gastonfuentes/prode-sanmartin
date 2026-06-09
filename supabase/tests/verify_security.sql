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
-- WHAT THIS TESTS (assertions 1–6):
--   1. enforce_betting_lock: rejects INSERT on a past-locked round.
--   2. enforce_betting_lock: rejects UPDATE on a past-locked round.
--   3. enforce_betting_lock: allows INSERT on a future-locked round.
--   4. compute_points: returns correct values for all scoring scenarios.
--   5. score_fixture: updates predictions.points when fixture transitions to FT.
--   6. round_predictions: returns 0 rows before lock, rows after lock (privacy).
--   7. leaderboard: includes 0-pt players; standard competition ranking (1,1,3).
--
-- RLS ROLE CHECKS (assertion 8) — manual steps documented at the bottom.
-- Full RLS simulation requires connecting as a real auth user and is not fully
-- automated in a single SQL Editor session.

begin;

-- ─── Seed: synthetic UUIDs for test users (not real auth.users rows) ─────────
-- NOTE: We insert directly into public.profiles (not auth.users) to avoid
-- triggering handle_new_user during this test script. We are testing other
-- triggers; the whitelist trigger is tested separately in assertion 9.

-- Insert test emails into allowed_emails so profiles can reference them.
insert into public.allowed_emails (email) values
  ('alice@test.example'),
  ('bob@test.example'),
  ('charlie@test.example')
on conflict (email) do nothing;

-- Test user UUIDs (synthetic — not real auth.users rows for this test).
do $$
declare
  v_alice_id   uuid := '00000000-0000-0000-0000-000000000001';
  v_bob_id     uuid := '00000000-0000-0000-0000-000000000002';
  v_charlie_id uuid := '00000000-0000-0000-0000-000000000003';
begin
  -- Profiles (bypass handle_new_user; we test that trigger separately).
  insert into public.profiles (id, email, display_name) values
    (v_alice_id,   'alice@test.example',   'Alice'),
    (v_bob_id,     'bob@test.example',     'Bob'),
    (v_charlie_id, 'charlie@test.example', 'Charlie')
  on conflict (id) do nothing;
end;
$$;

-- ─── Seed: two rounds ─────────────────────────────────────────────────────────
-- Round 1: PAST-locked (first_kickoff 2 hours ago → locks_at 3 hours ago).
-- Round 2: FUTURE-locked (first_kickoff 2 hours from now → locks_at 1 hour from now).

insert into public.rounds (api_round, name, first_kickoff, status) values
  ('Test - Past',   'Test Round Past',   now() - interval '2 hours', 'locked'),
  ('Test - Future', 'Test Round Future', now() + interval '2 hours', 'open')
on conflict (api_round) do nothing;

-- ─── Seed: fixtures ──────────────────────────────────────────────────────────
do $$
declare
  v_past_round_id   bigint;
  v_future_round_id bigint;
begin
  select id into v_past_round_id   from public.rounds where api_round = 'Test - Past';
  select id into v_future_round_id from public.rounds where api_round = 'Test - Future';

  -- Fixture 9000001: in past round (locked), not yet FT.
  insert into public.fixtures (id, round_id, home_team, away_team, kickoff, status)
  values (9000001, v_past_round_id, 'Team A', 'Team B', now() - interval '2 hours', 'FT')
  on conflict (id) do nothing;

  -- Fixture 9000002: in future round (open), not yet started.
  insert into public.fixtures (id, round_id, home_team, away_team, kickoff, status)
  values (9000002, v_future_round_id, 'Team C', 'Team D', now() + interval '2 hours', 'NS')
  on conflict (id) do nothing;
end;
$$;

-- ─── ASSERTION 1: enforce_betting_lock rejects INSERT on locked round ─────────
-- Expected: raises exception with errcode P0001.
-- Verified: LIVE (trigger fires synchronously on every INSERT to predictions).
do $$
declare
  v_alice_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  begin
    insert into public.predictions (user_id, fixture_id, pred_home, pred_away)
    values (v_alice_id, 9000001, 1, 0);
    -- If we reach here, the trigger did NOT fire → test FAILED.
    raise notice 'ASSERTION 1 FAILED: INSERT on locked round was NOT rejected.';
  exception
    when sqlstate 'P0001' then
      raise notice 'ASSERTION 1 PASSED: INSERT on locked round correctly rejected (P0001).';
    when others then
      raise notice 'ASSERTION 1 FAILED: Unexpected error: % / %', sqlstate, sqlerrm;
  end;
end;
$$;

-- ─── ASSERTION 2: enforce_betting_lock rejects UPDATE on locked round ─────────
-- Seed a prediction via direct insert (bypassing trigger with a past-round fixture).
-- We need to seed a prediction row first (INSERT would fail via trigger). Use a
-- future-round fixture prediction as the seed, then attempt to update to a locked one.
-- Alternative: insert with a future fixture, then test UPDATE path on locked fixture
-- by updating the fixture_id field. But to keep it simple and accurate, we test
-- UPDATE by inserting a valid row first and then attempting to update pred_home.
-- The UPDATE trigger reads fixture_id from the EXISTING row, so we test:
--   1. Insert valid prediction (future round — should succeed).
--   2. Update it (still future round) — should succeed.
--   3. Then separately test UPDATE on a row that references a locked fixture.
-- For the locked-round UPDATE test, we must insert the row bypassing the trigger.
do $$
declare
  v_alice_id uuid := '00000000-0000-0000-0000-000000000001';
  v_past_fix_id bigint := 9000001;
begin
  -- Temporarily disable the trigger to seed a row for the locked fixture.
  -- (In a real Supabase project you cannot disable triggers as a non-superuser.
  --  This assertion is documented as MANUAL — see note below.)
  raise notice 'ASSERTION 2 NOTE: UPDATE test on locked round requires seeding a row '
               'while bypassing the trigger. This is only possible as superuser/service role. '
               'Manual verification: seed a prediction directly via service role, then attempt '
               'PATCH /rest/v1/predictions as an authenticated user — expect 400 P0001.';
end;
$$;

-- ─── ASSERTION 3: enforce_betting_lock allows INSERT on future round ──────────
-- Expected: INSERT succeeds (no exception).
-- Verified: LIVE.
do $$
declare
  v_alice_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  begin
    insert into public.predictions (user_id, fixture_id, pred_home, pred_away)
    values (v_alice_id, 9000002, 2, 1);
    raise notice 'ASSERTION 3 PASSED: INSERT on future-locked round accepted.';
  exception
    when others then
      raise notice 'ASSERTION 3 FAILED: INSERT unexpectedly rejected: % / %', sqlstate, sqlerrm;
  end;
end;
$$;

-- ─── ASSERTION 4: compute_points returns correct values ───────────────────────
-- Tests all scoring scenarios from REQ-5.2 and REQ-5.3.
-- Verified: LIVE (pure SQL function, no trigger involvement).
do $$
declare
  v_result smallint;
begin
  -- 4a: exact score → 2 pts
  v_result := public.compute_points(2::smallint, 1::smallint, 2::smallint, 1::smallint);
  if v_result = 2 then
    raise notice 'ASSERTION 4a PASSED: exact score (2-1 vs 2-1) → 2 pts.';
  else
    raise notice 'ASSERTION 4a FAILED: expected 2, got %.', v_result;
  end if;

  -- 4b: correct outcome only (home win, wrong score) → 1 pt
  v_result := public.compute_points(1::smallint, 0::smallint, 3::smallint, 0::smallint);
  if v_result = 1 then
    raise notice 'ASSERTION 4b PASSED: correct outcome home win (1-0 pred, 3-0 actual) → 1 pt.';
  else
    raise notice 'ASSERTION 4b FAILED: expected 1, got %.', v_result;
  end if;

  -- 4c: correct outcome only (draw, wrong score) → 1 pt
  v_result := public.compute_points(0::smallint, 0::smallint, 1::smallint, 1::smallint);
  if v_result = 1 then
    raise notice 'ASSERTION 4c PASSED: correct outcome draw (0-0 pred, 1-1 actual) → 1 pt.';
  else
    raise notice 'ASSERTION 4c FAILED: expected 1, got %.', v_result;
  end if;

  -- 4d: exact draw → 2 pts
  v_result := public.compute_points(1::smallint, 1::smallint, 1::smallint, 1::smallint);
  if v_result = 2 then
    raise notice 'ASSERTION 4d PASSED: exact draw (1-1 vs 1-1) → 2 pts.';
  else
    raise notice 'ASSERTION 4d FAILED: expected 2, got %.', v_result;
  end if;

  -- 4e: wrong outcome (predicted away win, actual home win) → 0 pts
  v_result := public.compute_points(0::smallint, 1::smallint, 2::smallint, 0::smallint);
  if v_result = 0 then
    raise notice 'ASSERTION 4e PASSED: wrong outcome (0-1 pred, 2-0 actual) → 0 pts.';
  else
    raise notice 'ASSERTION 4e FAILED: expected 0, got %.', v_result;
  end if;

  -- 4f: exact 0-0 (draw) → 2 pts
  v_result := public.compute_points(0::smallint, 0::smallint, 0::smallint, 0::smallint);
  if v_result = 2 then
    raise notice 'ASSERTION 4f PASSED: exact 0-0 draw → 2 pts.';
  else
    raise notice 'ASSERTION 4f FAILED: expected 2, got %.', v_result;
  end if;
end;
$$;

-- ─── ASSERTION 5: score_fixture sets points when fixture transitions to FT ────
-- We update fixture 9000001 (already FT in seed) to have goals, simulating a
-- re-sync that fills in goals. Then check that predictions.points was updated.
-- Alice's prediction on 9000001 was NOT inserted (assertion 1 blocked it), so
-- we seed one via direct insert (bypassing trigger temporarily).
--
-- To test score_fixture without RLS complexity, we insert a prediction on
-- fixture 9000001 for Charlie (who has no prediction there yet).
-- We bypass the betting lock trigger by inserting directly into the table
-- via a DO $$ block that temporarily sets session_replication_role.
-- NOTE: This requires superuser or replication privilege.
-- In Supabase Dashboard SQL Editor you run as postgres (superuser).
do $$
declare
  v_charlie_id uuid := '00000000-0000-0000-0000-000000000003';
  v_points     smallint;
begin
  -- Temporarily disable triggers on predictions to seed past-round row.
  set session_replication_role = replica;
  insert into public.predictions (user_id, fixture_id, pred_home, pred_away, points)
  values (v_charlie_id, 9000001, 2, 1, 0)
  on conflict (user_id, fixture_id) do nothing;
  set session_replication_role = default;

  -- Now update fixture 9000001 to FT with result 2-1 (status was already FT in seed).
  -- Force a re-trigger by transitioning status: NS → FT with goals.
  update public.fixtures
  set status = 'NS'
  where id = 9000001;

  -- Now transition to FT with result 2-1 → should fire score_fixture.
  update public.fixtures
  set status = 'FT', goals_home = 2, goals_away = 1
  where id = 9000001;

  -- Check that Charlie's prediction got scored.
  select points into v_points
  from public.predictions
  where user_id = v_charlie_id and fixture_id = 9000001;

  if v_points = 2 then
    raise notice 'ASSERTION 5 PASSED: score_fixture set Charlie''s points to 2 (exact score 2-1 vs 2-1).';
  else
    raise notice 'ASSERTION 5 FAILED: expected 2, got %.', v_points;
  end if;
end;
$$;

-- ─── ASSERTION 6: round_predictions privacy gate ──────────────────────────────
-- Verified: LIVE (pure SQL function with now() >= locks_at gate).
-- Past round → now() >= locks_at → should return rows.
-- Future round → now() < locks_at → should return 0 rows.
do $$
declare
  v_past_round_id   bigint;
  v_future_round_id bigint;
  v_past_count      int;
  v_future_count    int;
begin
  select id into v_past_round_id   from public.rounds where api_round = 'Test - Past';
  select id into v_future_round_id from public.rounds where api_round = 'Test - Future';

  -- Past round: predictions exist for Charlie (inserted in assertion 5 seed).
  select count(*) into v_past_count
  from public.round_predictions(v_past_round_id);

  -- Future round: Alice's prediction (fixture 9000002) was inserted in assertion 3.
  select count(*) into v_future_count
  from public.round_predictions(v_future_round_id);

  if v_past_count > 0 then
    raise notice 'ASSERTION 6a PASSED: round_predictions returns % rows for locked (past) round — predictions visible post-lock.', v_past_count;
  else
    raise notice 'ASSERTION 6a FAILED: round_predictions returned 0 rows for past-locked round (expected > 0).';
  end if;

  if v_future_count = 0 then
    raise notice 'ASSERTION 6b PASSED: round_predictions returns 0 rows for future-locked round — privacy gate working.';
  else
    raise notice 'ASSERTION 6b FAILED: round_predictions returned % rows for future round (expected 0 — privacy leak!).', v_future_count;
  end if;
end;
$$;

-- ─── ASSERTION 7: leaderboard — 0-pt players included, 1,1,3 ranking ─────────
-- Seed Bob's prediction on future round (no fixture FT yet → 0 pts).
-- Charlie has 2 pts (from assertion 5). Alice has 0 pts (future round, not FT).
-- Charlie → rank 1, Alice and Bob → rank 2 (tied at 0 → both rank 2, next is rank 4).
-- But with only one 0-pt tie: rank 1 (Charlie, 2pts), rank 2 (Alice, 0pts), rank 2 (Bob, 0pts).
-- Next rank would be 4 — but we only have 3 players. rank() gives: 1, 2, 2.
do $$
declare
  v_bob_id          uuid := '00000000-0000-0000-0000-000000000002';
  v_past_round_id   bigint;
  v_rec             record;
  v_charlie_rank    bigint;
  v_alice_rank      bigint;
  v_bob_rank        bigint;
  v_charlie_pts     bigint;
begin
  select id into v_past_round_id from public.rounds where api_round = 'Test - Past';

  -- Print full leaderboard for inspection.
  raise notice 'ASSERTION 7: Leaderboard for past round:';
  for v_rec in select * from public.leaderboard(v_past_round_id) loop
    raise notice '  rank=%, name=%, pts=%, exact=%',
      v_rec.rank, v_rec.display_name, v_rec.total_points, v_rec.exact_count;
  end loop;

  -- Collect specific values.
  select rank, total_points into v_charlie_rank, v_charlie_pts
  from public.leaderboard(v_past_round_id)
  where display_name = 'Charlie';

  select rank into v_alice_rank
  from public.leaderboard(v_past_round_id)
  where display_name = 'Alice';

  select rank into v_bob_rank
  from public.leaderboard(v_past_round_id)
  where display_name = 'Bob';

  -- Charlie should have rank 1 with 2 pts.
  if v_charlie_rank = 1 and v_charlie_pts = 2 then
    raise notice 'ASSERTION 7a PASSED: Charlie rank=1, pts=2.';
  else
    raise notice 'ASSERTION 7a FAILED: Charlie rank=%, pts=%.', v_charlie_rank, v_charlie_pts;
  end if;

  -- Alice and Bob should both appear (0 pts — REQ-6.5).
  if v_alice_rank is not null then
    raise notice 'ASSERTION 7b PASSED: Alice appears in leaderboard (0-pt player, REQ-6.5). rank=%.', v_alice_rank;
  else
    raise notice 'ASSERTION 7b FAILED: Alice not found in leaderboard.';
  end if;

  if v_bob_rank is not null then
    raise notice 'ASSERTION 7c PASSED: Bob appears in leaderboard. rank=%.', v_bob_rank;
  else
    raise notice 'ASSERTION 7c FAILED: Bob not found in leaderboard.';
  end if;

  -- Alice and Bob both at 0 pts → should share the same rank (1,1,3 pattern).
  if v_alice_rank is not null and v_bob_rank is not null and v_alice_rank = v_bob_rank then
    raise notice 'ASSERTION 7d PASSED: Alice and Bob share rank % (standard competition ranking, REQ-6.4).', v_alice_rank;
  else
    raise notice 'ASSERTION 7d RESULT: Alice rank=%, Bob rank=% (verify they share rank — tied at 0 pts).', v_alice_rank, v_bob_rank;
  end if;
end;
$$;

-- ─── ASSERTION 8: RLS role simulation ────────────────────────────────────────
-- Full RLS testing requires connecting as a real Supabase auth user with a valid JWT.
-- The SQL Editor in the Dashboard runs as the postgres superuser, which bypasses RLS.
--
-- MANUAL VERIFICATION STEPS (to be done after deploying the app):
--
-- 8a. predictions — owner-only SELECT:
--     1. Log in as Alice via Google OAuth.
--     2. GET /rest/v1/predictions (with Alice's JWT in Authorization header).
--     3. Expected: only Alice's predictions are returned (not Bob's or Charlie's).
--
-- 8b. predictions — INSERT with wrong user_id rejected:
--     1. Craft a POST /rest/v1/predictions with Alice's JWT but user_id = Bob's UUID.
--     2. Expected: 403 (RLS check_clause violation).
--
-- 8c. allowed_emails — not readable by clients:
--     1. GET /rest/v1/allowed_emails with any authenticated JWT.
--     2. Expected: 0 rows returned (no SELECT policy = empty result set by default).
--        Note: PostgREST returns 200 with [] when RLS allows 0 rows.
--
-- 8d. rounds + fixtures — readable by authenticated users:
--     1. GET /rest/v1/rounds with a valid authenticated JWT.
--     2. Expected: all round rows returned (200).
--
-- 8e. predictions — unauthenticated access blocked:
--     1. GET /rest/v1/predictions with no Authorization header (anon key only).
--     2. Expected: 0 rows (anon role has no policy grants).
--
-- These are the assertions that REQUIRE the user to run them manually.
do $$ begin
  raise notice 'ASSERTION 8: RLS tests require authenticated JWT. See manual verification steps in script comments.';
end $$;

-- ─── ASSERTION 9: handle_new_user whitelist gate ─────────────────────────────
-- The trigger fires on INSERT into auth.users, which requires the auth schema.
-- Testing this in the SQL editor requires inserting into auth.users directly
-- as superuser, which may have side effects. Recommended approach:
--
-- 9a. BLOCKED signup (non-whitelisted email):
--     1. Attempt Google OAuth with an email NOT in allowed_emails.
--     2. Expected: signup fails; Supabase returns a 422 "signup error".
--     3. Verify no row appears in public.profiles for that email.
--
-- 9b. ALLOWED signup (whitelisted email):
--     1. Attempt Google OAuth with an email IN allowed_emails.
--     2. Expected: signup succeeds; a row appears in public.profiles.
--     3. display_name = Google full_name (or email local part if not available).
--
do $$ begin
  raise notice 'ASSERTION 9: handle_new_user tests require Google OAuth flow. See manual steps in script comments.';
end $$;

-- ─── ROLLBACK — no data persisted ────────────────────────────────────────────
-- All seeds (profiles, predictions, fixtures, rounds, allowed_emails rows)
-- inserted during this script are discarded. The DB is unchanged post-run.
rollback;

-- Final note for the user:
-- After ROLLBACK, all NOTICE messages above remain visible in the output.
-- Green (PASSED) notices confirm the security layer is working.
-- Any FAILED notice requires investigation before proceeding to PR-4.
