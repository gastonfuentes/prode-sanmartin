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
  /**
   * Per-event season info. `slug` is the RELIABLE knockout-round identifier
   * ("round-of-32" | "round-of-16" | "quarterfinals" | "semifinals" |
   * "3rd-place-match" | "final"). Group-stage events do not carry a knockout
   * slug. NOTE: leagues[0].season.type.name always reports "Group Stage" even on
   * knockout dates — do NOT use it; the per-event slug is the source of truth.
   */
  season?: {
    slug?: string;
    type?: number;
  };
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
  /**
   * Round key the caller resolves to round_id after upserting rounds.
   * Group: "Matchday N". Knockout: the ESPN season slug ("round-of-32", etc).
   */
  api_round: string;
  /**
   * Knockout only: true when both teams are real World Cup nations (bettable),
   * false while either side is a placeholder ("Round of 16 3 Winner", "Third
   * Place Group …"). Always true for group fixtures.
   */
  teams_decided: boolean;
  /** Group only — 1 | 2 | 3. Omitted for knockout fixtures. */
  matchday?: number;
}

/** A row ready for upsert into public.rounds (keyed by api_round). */
export interface RoundRow {
  api_round: string; // group: "Matchday 1"; knockout: ESPN slug "round-of-32"
  name: string; // same as api_round (display label derived in lib/rounds.ts)
  stage: "group" | "knockout";
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
      stage: "group" as const,
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
      api_round: `Matchday ${matchday}`,
      teams_decided: true, // group teams are always known
      matchday,
    });
  }

  return { fixtures, rounds };
}

// ─── Knockout stage ───────────────────────────────────────────────────────────

/**
 * ESPN season slugs for the World Cup knockout rounds, in bracket order.
 * `event.season.slug` is the reliable per-event round identifier (mig 032).
 */
export const KNOCKOUT_SLUGS = [
  "round-of-32",
  "round-of-16",
  "quarterfinals",
  "semifinals",
  "3rd-place-match",
  "final",
] as const;

const KNOCKOUT_SLUG_SET = new Set<string>(KNOCKOUT_SLUGS);

/** Classifies an event as 'knockout' (by its season slug) or 'group'. */
export function classifyStage(event: EspnEvent): "group" | "knockout" {
  const slug = event.season?.slug;
  return slug && KNOCKOUT_SLUG_SET.has(slug) ? "knockout" : "group";
}

/**
 * Splits events into group vs knockout. Group events must be partitioned out
 * BEFORE assignMatchdays() — that function counts per-team appearances (=3 for
 * the group stage) and would assign nonsense matchdays to knockout events.
 */
export function partitionByStage(events: EspnEvent[]): {
  group: EspnEvent[];
  knockout: EspnEvent[];
} {
  const group: EspnEvent[] = [];
  const knockout: EspnEvent[] = [];
  for (const ev of events) {
    if (classifyStage(ev) === "knockout") knockout.push(ev);
    else group.push(ev);
  }
  return { group, knockout };
}

/**
 * Fail-safe boundary between the group stage and the knockout stage.
 *
 * The WC-2026 group stage ends June 27; the Round of 32 starts June 28. We pick
 * NOON UTC on June 28 because it sits AFTER the latest possible group kickoff
 * (a late US-evening June 27 game lands around 04:00 UTC on June 28) and BEFORE
 * the June 28 afternoon Round-of-32 slot. So any GROUP-classified event past this
 * instant is almost certainly a knockout match whose season.slug ESPN failed to
 * provide.
 */
export const GROUP_STAGE_END_MS = Date.UTC(2026, 5, 28, 12, 0, 0);

/**
 * Defensive guard for the single biggest external assumption of the feature:
 * that ESPN carries a knockout season.slug on every knockout event. classifyStage
 * silently routes a slug-less event to the GROUP bucket — where it would be fed to
 * assignMatchdays AND hardcoded teams_decided:true, i.e. become an immediately
 * bettable group fixture, bypassing progressive habilitation.
 *
 * This splits out any group-classified event whose kickoff is in the knockout
 * window. Dropping it means a slug regression fails SAFE (the match is simply
 * absent until ESPN fixes the slug on a later sync) instead of fails OPEN (a bogus
 * bettable match). Group-stage events (all before the boundary) are unaffected.
 */
export function dropStrayKnockout(groupEvents: EspnEvent[]): {
  group: EspnEvent[];
  dropped: EspnEvent[];
} {
  const group: EspnEvent[] = [];
  const dropped: EspnEvent[] = [];
  for (const ev of groupEvents) {
    const kickoffMs = Date.parse(ev.date);
    if (Number.isFinite(kickoffMs) && kickoffMs >= GROUP_STAGE_END_MS) {
      dropped.push(ev);
    } else {
      group.push(ev);
    }
  }
  return { group, dropped };
}

/**
 * A knockout team is "real" (decided) when its ESPN id is one of the 48 World
 * Cup nations (the keys of the standings group map). Placeholder competitors
 * like "Round of 16 3 Winner" / "Third Place Group C/E/F/H" carry synthetic ids
 * absent from that set — robust without parsing display strings.
 */
export function isRealCountry(teamId: string, countrySet: Set<string>): boolean {
  return countrySet.has(teamId);
}

/**
 * Maps knockout ESPN events to DB row shapes, mirroring mapToFixtureRows but for
 * the knockout stage: round key = season slug, group_label is always null, and
 * teams_decided is computed from the country set (both sides must be real
 * nations). Rounds are returned in bracket order.
 *
 * NOTE: fixtures.round_id is resolved by the caller (via api_round), and
 * fixtures.locks_at is set by the set_fixture_locks_at DB trigger — not here.
 */
export function mapKnockoutFixtureRows(
  events: EspnEvent[],
  countrySet: Set<string>
): { fixtures: FixtureRow[]; rounds: RoundRow[] } {
  const roundSlugs = new Set<string>();
  const fixtures: FixtureRow[] = [];

  for (const event of events) {
    const comp = event.competitions[0];
    if (!comp) continue;

    const slug = event.season?.slug;
    if (!slug || !KNOCKOUT_SLUG_SET.has(slug)) continue;

    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const completed = comp.status.type.completed;
    const teamsDecided =
      isRealCountry(home.team.id, countrySet) &&
      isRealCountry(away.team.id, countrySet);

    roundSlugs.add(slug);
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
      group_label: null, // knockout matches belong to no group
      api_round: slug,
      teams_decided: teamsDecided,
    });
  }

  const rounds: RoundRow[] = [...roundSlugs]
    .sort((a, b) => KNOCKOUT_SLUGS.indexOf(a as never) - KNOCKOUT_SLUGS.indexOf(b as never))
    .map((slug) => ({ api_round: slug, name: slug, stage: "knockout" as const }));

  return { fixtures, rounds };
}
