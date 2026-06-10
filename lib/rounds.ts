/**
 * Pure round-selection logic.
 *
 * No DB calls, no Next.js imports — testable with Vitest.
 *
 * Current-round selection rule (ADR-6):
 *   1. Find all rounds where now < locks_at (open). null locks_at = treated as
 *      open (no fixtures seeded yet → no lock boundary established).
 *   2. If any open rounds exist: return the one with the earliest first_kickoff
 *      (the next upcoming matchday). null first_kickoff sorts last (Infinity).
 *   3. If all rounds are locked (now >= locks_at): return the one with the
 *      latest first_kickoff (the most recently completed matchday — most
 *      relevant context for users who may still see results/leaderboard).
 */

import { isRoundLocked } from "./scoring";

// ── roundLabelFromApiRound ──────────────────────────────────────────────────

/**
 * Derives the Spanish display label "Fecha N" from the api_round string.
 *
 * The calendar sync writes api_round as "Matchday N" (e.g. "Matchday 3") — see
 * supabase/functions/sync/index.ts. The legacy "Group Stage - N" form is also
 * accepted for forward/backward compatibility. We extract the trailing integer
 * and return "Fecha N", falling back to the raw string when no trailing number
 * is found (knockout rounds or unknown formats — out of v1 scope, but handled
 * gracefully).
 *
 * Pure function — no DB calls, no side effects. Used at the DISPLAY layer.
 * Do NOT change api_round values in the DB; derive the label here.
 */
export function roundLabelFromApiRound(apiRound: string): string {
  const match = apiRound.match(/(\d+)\s*$/);
  if (match) {
    return `Fecha ${match[1]}`;
  }
  return apiRound;
}

// ── RoundSummary ────────────────────────────────────────────────────────────

/**
 * Minimal shape from the rounds table. Matches the Supabase select projection
 * used in RSC data fetches. Kept narrow — only the fields needed for selection.
 */
export interface RoundSummary {
  id: number;
  name: string;
  api_round: string;
  first_kickoff: string | null;
  locks_at: string | null;
  status: "open" | "locked" | "finished";
}

// ── selectCurrentRound ──────────────────────────────────────────────────────

/**
 * Given an array of rounds and the current time, returns the "current" round
 * according to the selection rule above.
 *
 * Returns null if the array is empty.
 */
export function selectCurrentRound(
  rounds: RoundSummary[],
  now: Date
): RoundSummary | null {
  if (rounds.length === 0) return null;

  // Partition into open and locked
  const open: RoundSummary[] = [];
  const locked: RoundSummary[] = [];

  for (const round of rounds) {
    if (
      round.locks_at === null ||
      !isRoundLocked(now, new Date(round.locks_at))
    ) {
      open.push(round);
    } else {
      locked.push(round);
    }
  }

  if (open.length > 0) {
    // Pick the open round with the earliest first_kickoff
    // null first_kickoff sorts last (treated as Infinity)
    return open.reduce((best, r) => {
      const bestTime =
        best.first_kickoff !== null
          ? new Date(best.first_kickoff).getTime()
          : Infinity;
      const rTime =
        r.first_kickoff !== null
          ? new Date(r.first_kickoff).getTime()
          : Infinity;
      return rTime < bestTime ? r : best;
    });
  }

  // All locked — pick the one with the latest first_kickoff
  return locked.reduce((best, r) => {
    const bestTime =
      best.first_kickoff !== null
        ? new Date(best.first_kickoff).getTime()
        : -Infinity;
    const rTime =
      r.first_kickoff !== null
        ? new Date(r.first_kickoff).getTime()
        : -Infinity;
    return rTime > bestTime ? r : best;
  });
}
