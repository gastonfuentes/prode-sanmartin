/**
 * Pure scoring and lock functions for the prediction game.
 *
 * IMPORTANT — ADR-7 COUPLING:
 *   computePoints() is the TypeScript mirror of the SQL function
 *   public.compute_points() defined in supabase/migrations/008_compute_points.sql,
 *   last changed in supabase/migrations/029_scoring_v2_from_second_round.sql.
 *   Both implementations use the same sign()-based logic and MUST be kept in sync.
 *   Any change to the scoring rules must be applied to BOTH files.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type Outcome = "HOME" | "DRAW" | "AWAY";

// ─── outcome ────────────────────────────────────────────────────────────────

/**
 * Derives the match outcome from goals using the sign of (home - away).
 *   sign > 0 → HOME win
 *   sign = 0 → DRAW
 *   sign < 0 → AWAY win
 */
export function outcome(home: number, away: number): Outcome {
  const diff = home - away;
  if (diff > 0) return "HOME";
  if (diff < 0) return "AWAY";
  return "DRAW";
}

// ─── computePoints ──────────────────────────────────────────────────────────

/**
 * Computes points for a single prediction against the actual result.
 *
 * Rules (REQ-5.2, REQ-5.3, REQ-5.4):
 *   - Exact score (both goals match) → exactPoints (2 on fecha 1, 3 from fecha 2)
 *   - Correct outcome only            → 1 pt
 *   - Wrong outcome                   → 0 pts
 *
 * exactPoints is supplied by the caller because the value depends on the round:
 * the SQL trigger passes 2 for the earliest round and 3 from the second round
 * onward (migration 029). Defaults to 2 to preserve the original behaviour.
 */
export function computePoints(
  predHome: number,
  predAway: number,
  goalsHome: number,
  goalsAway: number,
  exactPoints: number = 2
): number {
  if (predHome === goalsHome && predAway === goalsAway) return exactPoints;
  if (outcome(predHome, predAway) === outcome(goalsHome, goalsAway)) return 1;
  return 0;
}

// ─── computeLocksAt ─────────────────────────────────────────────────────────

/**
 * Returns the lock time for a round: exactly 1 hour before the first kickoff.
 *
 * Works in UTC milliseconds — no timezone assumptions.
 * Mirrors the STORED GENERATED column: `first_kickoff - INTERVAL '1 hour'` (REQ-3.1).
 */
export function computeLocksAt(firstKickoff: Date): Date {
  return new Date(firstKickoff.getTime() - 3_600_000);
}

// ─── isRoundLocked ──────────────────────────────────────────────────────────

/**
 * Returns true when the round is locked (no more predictions allowed).
 *
 * Lock boundary: `now >= locksAt` — T−60 is CLOSED (REQ-3.3, confirmed rule).
 * This is the TypeScript mirror of the DB trigger condition:
 *   `if now() >= v_locks_at then raise exception ...`
 */
export function isRoundLocked(now: Date, locksAt: Date): boolean {
  return now.getTime() >= locksAt.getTime();
}
