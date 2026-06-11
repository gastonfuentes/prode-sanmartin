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
    /** Flag/crest URL from the scoreboard endpoint. May be absent for some teams. */
    logo?: string;
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

// ─── ESPN Standings API types ─────────────────────────────────────────────────
// Used to build a teamId → groupName map.
// Endpoint: https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026
// Response shape: { children: [ { name: "Group A", standings: { entries: [ { team: { id, displayName } } ] } } ] }
// Note: standings entries use team.logos[] (array with href), but we only need team.id here.

export interface EspnStandingsEntry {
  team: {
    id: string;
    displayName: string;
  };
}

export interface EspnStandingsGroup {
  name: string; // e.g. "Group A"
  standings: {
    entries: EspnStandingsEntry[];
  };
}

export interface EspnStandingsResponse {
  children: EspnStandingsGroup[];
}

// ─── Output row types (match the DB schema in 004_rounds_fixtures.sql) ────────

/**
 * A row ready for upsert into public.fixtures.
 * `id` is the ESPN event id cast to a number (fits in bigint).
 * `matchday` is a 1-based integer (1, 2, or 3) used by the caller to
 *   look up the round_id after rounds are upserted first.
 * `home_logo` / `away_logo`: flag/crest URLs from the ESPN scoreboard (null if absent).
 * `group_label`: group name from the standings map (e.g. "Group A"), null if not found.
 */
export interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  kickoff: string;
  goals_home: number | null;
  goals_away: number | null;
  status: string; // "NS" | "FT"
  group_label: string | null;
  matchday: number; // 1 | 2 | 3 — caller resolves to round_id
}

/** A row ready for upsert into public.rounds (keyed by api_round). */
export interface RoundRow {
  api_round: string; // e.g. "Matchday 1"
  name: string; // same as api_round for display
}

// ─── buildTeamGroupMap ────────────────────────────────────────────────────────

/**
 * Builds a Map from ESPN team id to group name from the WC standings response.
 *
 * Matching by team.id (not displayName) is intentional — avoids name-variant
 * mismatches (e.g. "USA" vs "United States"). Both the scoreboard and standings
 * endpoints share the same stable numeric team ids.
 *
 * @param response - The full standings response (children[] of groups).
 * @returns Map<teamId: string, groupName: string>
 */
export function buildTeamGroupMap(
  response: EspnStandingsResponse
): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of response.children) {
    const groupName = group.name;
    for (const entry of group.standings.entries) {
      const id = entry.team.id;
      if (id) {
        map.set(id, groupName);
      }
    }
  }
  return map;
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
 * Logos: populated from each competitor's team.logo field (null if absent).
 * Group label: resolved via the optional groupMap (teamId → groupName).
 *   Uses the home team's id first; falls back to the away team's id.
 *   Null if neither team is found or no groupMap is provided.
 *
 * NOTE: fixtures.round_id is NOT set here — the caller (Deno glue in index.ts)
 * must resolve matchday → round_id after upserting rounds into the DB.
 */
export function mapToFixtureRows(
  events: EspnEvent[],
  matchdays: Map<string, number>,
  groupMap?: Map<string, string>
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

    // Resolve group label: home team id first, fall back to away team id
    const groupLabel = groupMap
      ? (groupMap.get(home.team.id) ?? groupMap.get(away.team.id) ?? null)
      : null;

    fixtures.push({
      id: parseInt(event.id, 10),
      home_team: home.team.displayName,
      away_team: away.team.displayName,
      home_logo: home.team.logo ?? null,
      away_logo: away.team.logo ?? null,
      kickoff: event.date,
      goals_home: completed ? parseInt(home.score, 10) : null,
      goals_away: completed ? parseInt(away.score, 10) : null,
      status: completed ? "FT" : "NS",
      group_label: groupLabel,
      matchday,
    });
  }

  return { fixtures, rounds };
}

// ─── partitionByExistingIds ───────────────────────────────────────────────────

/**
 * Splits result-update rows into the ones whose id already exists in `fixtures`
 * (safe to UPDATE) and the ones that don't (must be ignored — results mode must
 * never INSERT a partial row).
 *
 * CRITICAL: `fixtures.id` is a Postgres `bigint`, and supabase-js/PostgREST
 * serialize bigint as a STRING to avoid JS number precision loss. So the id
 * coming back from `.select("id")` is a string ("736261"), while the id we build
 * from ESPN via parseInt is a number (736261). Comparing them directly with a
 * Set would never match. We normalise BOTH sides to strings before comparing.
 *
 * @param rows           update rows ({ id: number, ... }) built from ESPN
 * @param existingIdRows rows from `select("id").in("id", ...)` — id is a string
 *                       (bigint) or number; both are handled
 */
export function partitionByExistingIds<T extends { id: number }>(
  rows: T[],
  existingIdRows: Array<{ id: number | string }>
): { known: T[]; skipped: T[] } {
  const existing = new Set(existingIdRows.map((r) => String(r.id)));
  const known: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    if (existing.has(String(row.id))) known.push(row);
    else skipped.push(row);
  }
  return { known, skipped };
}
