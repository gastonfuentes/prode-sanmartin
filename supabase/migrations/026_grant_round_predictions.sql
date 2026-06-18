-- Migration: 026_grant_round_predictions
-- Grant EXECUTE on round_predictions(bigint) to authenticated.
--
-- Background: round_predictions (migration 011) is a SECURITY DEFINER function
-- that returns every player's predictions for a round, but ONLY after the round
-- locks (now() >= locks_at) — the privacy gate that prevents pre-lock copying.
--
-- Until now this RPC was never called from the client, so it lacked the explicit
-- EXECUTE grant that the other client-facing RPCs have (leaderboard — 018,
-- list_participants — 025, admin_round_predictions — 020). The new per-fixture
-- "ver pronósticos de los demás" feature calls it from the round page, so make
-- the grant explicit and consistent instead of relying on the default PUBLIC
-- privilege.

grant execute on function public.round_predictions(bigint) to authenticated;
