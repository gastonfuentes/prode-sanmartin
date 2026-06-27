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
 * Knockout rounds store their ESPN season slug in api_round (see
 * supabase/functions/sync/espn.ts). Map each to its Spanish display label.
 */
const KNOCKOUT_LABELS: Record<string, string> = {
  "round-of-32": "16avos",
  "round-of-16": "Octavos",
  quarterfinals: "Cuartos",
  semifinals: "Semis",
  "3rd-place-match": "3er puesto",
  final: "Final",
};

/**
 * Derives the Spanish display label from the api_round string.
 *
 * Knockout rounds use the ESPN slug ("round-of-32" → "16avos", "final" → "Final").
 * Group-stage rounds use "Matchday N" (and the legacy "Group Stage - N"): we
 * extract the trailing integer and return "Fecha N". Falls back to the raw string
 * when neither a knockout slug nor a trailing number is found.
 *
 * Pure function — no DB calls, no side effects. Used at the DISPLAY layer.
 * Do NOT change api_round values in the DB; derive the label here.
 */
export function roundLabelFromApiRound(apiRound: string): string {
  const knockout = KNOCKOUT_LABELS[apiRound];
  if (knockout) {
    return knockout;
  }
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
  /** 'group' (default) or 'knockout'. Optional — only the page needs it. */
  stage?: "group" | "knockout";
  /**
   * Whether this round still has a bettable match. The caller computes it for
   * KNOCKOUT rounds (whose round-level locks_at is only the EARLIEST match, so it
   * can't tell that later matches are still open). When defined it overrides the
   * round-level lock in selectCurrentRound; left undefined for group rounds.
   */
  has_open_fixture?: boolean;
}

// ── selectCurrentRound ──────────────────────────────────────────────────────

/**
 * Given an array of rounds and the current time, returns the "current" round
 * according to the selection rule above.
 *
 * Returns null if the array is empty.
 */
/**
 * Whether a round is still "open" for the purpose of current-round selection.
 *
 * Knockout rounds (or any round the caller annotated with has_open_fixture) use
 * per-fixture openness, because their round-level locks_at is only the earliest
 * match's lock and would wrongly mark the whole phase closed while later matches
 * are still bettable. Group rounds leave has_open_fixture undefined and fall back
 * to the round-level lock (unchanged behavior).
 */
function isRoundOpen(round: RoundSummary, now: Date): boolean {
  if (round.has_open_fixture !== undefined) {
    return round.has_open_fixture;
  }
  return (
    round.locks_at === null || !isRoundLocked(now, new Date(round.locks_at))
  );
}

export function selectCurrentRound(
  rounds: RoundSummary[],
  now: Date
): RoundSummary | null {
  if (rounds.length === 0) return null;

  // Partition into open and locked
  const open: RoundSummary[] = [];
  const locked: RoundSummary[] = [];

  for (const round of rounds) {
    if (isRoundOpen(round, now)) {
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

// ── adjacentRoundIds ─────────────────────────────────────────────────────────

/**
 * Given the navigable round ids in display order (ascending first_kickoff) and
 * the id currently being viewed, returns the previous/next round ids for
 * swipe navigation.
 *
 * `null` on either side means there is no round to go to (current id is at an
 * edge, not in the list, or the list is too short). Neighbours follow ARRAY
 * order, not id magnitude — the caller passes ids already sorted by kickoff,
 * which need not be ascending by id.
 *
 * Pure function — no DB calls, no side effects.
 */
export function adjacentRoundIds(
  orderedRoundIds: number[],
  currentId: number
): { prevId: number | null; nextId: number | null } {
  const index = orderedRoundIds.indexOf(currentId);
  if (index === -1) {
    return { prevId: null, nextId: null };
  }
  return {
    prevId: index > 0 ? orderedRoundIds[index - 1] : null,
    nextId: index < orderedRoundIds.length - 1 ? orderedRoundIds[index + 1] : null,
  };
}
