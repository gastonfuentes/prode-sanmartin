/**
 * Pure ESPN API mapping functions for the sync Edge Function.
 *
 * NO Deno-only imports here. This module is tested with Vitest.
 * The Deno glue (Deno.serve, fetch, Supabase client writes) lives in
 * supabase/functions/sync/index.ts and imports from this module via a
 * relative path.
 *
 * See TASK-25 (calendar mode) and TASK-26 (results mode).
 */

// ─── ESPN API types (only the fields we use) ─────────────────────────────────

export interface EspnCompetitor {
  homeAway: "home" | "away";
  score: string;
  team: {
    id: string;
    displayName: string;
  };
}

export interface EspnCompetition {
  id: string;
  status: {
    type: {
      completed: boolean;
      state: string; // "pre" | "in" | "post"
    };
  };
  competitors: EspnCompetitor[];
}

export interface EspnEvent {
  id: string;
  date: string; // ISO kickoff, e.g. "2026-06-11T19:00Z"
  name: string;
  uid: string;
  competitions: EspnCompetition[];
}

export interface EspnScoreboardResponse {
  events: EspnEvent[];
}

// ─── Output row types (match the DB schema in 004_rounds_fixtures.sql) ────────

/**
 * A row ready for upsert into public.fixtures.
 * `id` is the ESPN event id cast to a number (fits in bigint).
 * `matchday` is a 1-based integer (1, 2, or 3) used by the caller to
 *   look up the round_id after rounds are upserted first.
 */
export interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  kickoff: string;
  goals_home: number | null;
  goals_away: number | null;
  status: string; // "NS" | "FT"
  matchday: number; // 1 | 2 | 3 — caller resolves to round_id
}

/** A row ready for upsert into public.rounds (keyed by api_round). */
export interface RoundRow {
  api_round: string; // e.g. "Matchday 1"
  name: string; // same as api_round for display
}

// ─── assignMatchdays ──────────────────────────────────────────────────────────

/**
 * Assigns a matchday number (1, 2, or 3) to each ESPN event id.
 *
 * Strategy: sort events by date ascending, then for each match track how many
 * times each team has appeared so far. The matchday for a match is the game
 * count for either team after processing (both teams increment together, so
 * they always agree for valid WC group-stage data).
 *
 * This is deterministic and produces clean 24/24/24 splits for WC 2026.
 *
 * @param events - All ESPN events for the date range (unsorted is OK).
 * @returns A Map from event.id → matchday (1 | 2 | 3).
 */
export function assignMatchdays(events: EspnEvent[]): Map<string, number> {
  // Sort by date, then by id for stability within the same timestamp
  const sorted = [...events].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    return dateCmp !== 0 ? dateCmp : a.id.localeCompare(b.id);
  });

  const teamGameCount = new Map<string, number>();
  const result = new Map<string, number>();

  for (const event of sorted) {
    const comp = event.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === "home")?.team
      .displayName;
    const away = comp.competitors.find((c) => c.homeAway === "away")?.team
      .displayName;

    if (!home || !away) continue;

    const homeCount = (teamGameCount.get(home) ?? 0) + 1;
    const awayCount = (teamGameCount.get(away) ?? 0) + 1;
    // Both should agree for valid WC data; take the max as a safety fallback
    const matchday = Math.max(homeCount, awayCount);

    teamGameCount.set(home, homeCount);
    teamGameCount.set(away, awayCount);
    result.set(event.id, matchday);
  }

  return result;
}

// ─── filterCompleted ─────────────────────────────────────────────────────────

/**
 * Returns only events where competitions[0].status.type.completed === true.
 * Used in results mode to find FT matches.
 *
 * Decision: use `completed` flag, not `state === "post"`, because `completed`
 * is the field explicitly documented as the FT signal (obs #65).
 */
export function filterCompleted(events: EspnEvent[]): EspnEvent[] {
  return events.filter(
    (ev) => ev.competitions[0]?.status.type.completed === true
  );
}

// ─── mapToFixtureRows ─────────────────────────────────────────────────────────

/**
 * Maps ESPN events + matchday assignments to DB row shapes.
 *
 * Returns:
 *   - `rounds`: unique RoundRow per matchday (upsert these FIRST so round_id exists)
 *   - `fixtures`: one FixtureRow per event (upsert after rounds)
 *
 * Goals are mapped only for completed events (completed === true). For
 * non-completed events goals_home / goals_away are null and status is "NS".
 *
 * NOTE: fixtures.round_id is NOT set here — the caller (Deno glue in index.ts)
 * must resolve matchday → round_id after upserting rounds into the DB.
 */
export function mapToFixtureRows(
  events: EspnEvent[],
  matchdays: Map<string, number>
): { fixtures: FixtureRow[]; rounds: RoundRow[] } {
  // Build unique rounds
  const roundSet = new Set<number>();
  for (const matchday of matchdays.values()) {
    roundSet.add(matchday);
  }
  const rounds: RoundRow[] = Array.from(roundSet)
    .sort((a, b) => a - b)
    .map((md) => ({
      api_round: `Matchday ${md}`,
      name: `Matchday ${md}`,
    }));

  // Map fixtures
  const fixtures: FixtureRow[] = [];
  for (const event of events) {
    const comp = event.competitions[0];
    if (!comp) continue;

    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const matchday = matchdays.get(event.id);
    if (matchday === undefined) continue;

    const completed = comp.status.type.completed;

    fixtures.push({
      id: parseInt(event.id, 10),
      home_team: home.team.displayName,
      away_team: away.team.displayName,
      kickoff: event.date,
      goals_home: completed ? parseInt(home.score, 10) : null,
      goals_away: completed ? parseInt(away.score, 10) : null,
      status: completed ? "FT" : "NS",
      matchday,
    });
  }

  return { fixtures, rounds };
}
