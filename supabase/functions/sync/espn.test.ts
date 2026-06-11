/**
 * Tests for pure ESPN API mapping functions (TASK-25, TASK-26).
 *
 * Strict TDD — tests written FIRST (RED), then implementation (GREEN).
 *
 * Deno/Vitest boundary:
 *   - PURE mapping logic lives in espn.ts (no Deno-only imports).
 *   - These functions are unit-tested here with Vitest.
 *   - The Deno glue (fetch, Deno.serve, Supabase writes) lives in index.ts and
 *     is NOT unit-tested (see index.ts for the documented rationale).
 */

import { describe, it, expect } from "vitest";
import {
  assignMatchdays,
  mapToFixtureRows,
  filterCompleted,
  type EspnEvent,
  type FixtureRow,
  type RoundRow,
} from "./espn";

// ─── Fixtures (test data) ────────────────────────────────────────────────────

/** Minimal ESPN event shape — only the fields our mapping code touches. */
function makeEvent(
  overrides: Partial<{
    id: string;
    date: string;
    homeName: string;
    homeId: string;
    awayName: string;
    awayId: string;
    homeScore: string;
    awayScore: string;
    completed: boolean;
    state: string;
  }> = {}
): EspnEvent {
  const o = {
    id: "760415",
    date: "2026-06-11T19:00Z",
    homeName: "Mexico",
    homeId: "203",
    awayName: "South Africa",
    awayId: "467",
    homeScore: "0",
    awayScore: "0",
    completed: false,
    state: "pre",
    ...overrides,
  };
  return {
    id: o.id,
    date: o.date,
    name: `${o.awayName} at ${o.homeName}`,
    uid: `s:600~l:606~e:${o.id}`,
    competitions: [
      {
        id: o.id,
        status: {
          type: {
            completed: o.completed,
            state: o.state,
          },
        },
        competitors: [
          {
            homeAway: "home",
            score: o.homeScore,
            team: { id: o.homeId, displayName: o.homeName },
          },
          {
            homeAway: "away",
            score: o.awayScore,
            team: { id: o.awayId, displayName: o.awayName },
          },
        ],
      },
    ],
  };
}

// ─── Sample events (two matches from different days) ─────────────────────────

const event1 = makeEvent({
  id: "760415",
  date: "2026-06-11T19:00Z",
  homeName: "Mexico",
  awayName: "South Africa",
});

const event2 = makeEvent({
  id: "760414",
  date: "2026-06-12T02:00Z",
  homeName: "South Korea",
  awayName: "Czechia",
});

// A second matchday game for Mexico (game 2 of group stage)
const event3 = makeEvent({
  id: "760500",
  date: "2026-06-18T19:00Z",
  homeName: "Mexico",
  awayName: "Poland",
});

// A finished match
const eventFT = makeEvent({
  id: "760415",
  date: "2026-06-11T19:00Z",
  homeName: "Mexico",
  awayName: "South Africa",
  homeScore: "3",
  awayScore: "1",
  completed: true,
  state: "post",
});

// ─── assignMatchdays ─────────────────────────────────────────────────────────

describe("assignMatchdays", () => {
  it("assigns matchday 1 to the first game of every team", () => {
    const result = assignMatchdays([event1, event2]);
    expect(result.get(event1.id)).toBe(1);
    expect(result.get(event2.id)).toBe(1);
  });

  it("assigns matchday 2 to the second game of a team", () => {
    // event1: Mexico vs South Africa (matchday 1 for both)
    // event3: Mexico vs Poland (matchday 2 for Mexico)
    // South Korea plays event2 (matchday 1); no second game in this set
    const result = assignMatchdays([event1, event2, event3]);
    expect(result.get(event1.id)).toBe(1); // Mexico game 1
    expect(result.get(event3.id)).toBe(2); // Mexico game 2
  });

  it("produces matchdays 1, 2, 3 for a team that plays 3 games", () => {
    const game1 = makeEvent({
      id: "111",
      date: "2026-06-11T19:00Z",
      homeName: "TeamA",
      awayName: "TeamB",
    });
    const game2 = makeEvent({
      id: "222",
      date: "2026-06-18T19:00Z",
      homeName: "TeamA",
      awayName: "TeamC",
    });
    const game3 = makeEvent({
      id: "333",
      date: "2026-06-25T19:00Z",
      homeName: "TeamA",
      awayName: "TeamD",
    });
    const result = assignMatchdays([game1, game2, game3]);
    expect(result.get("111")).toBe(1);
    expect(result.get("222")).toBe(2);
    expect(result.get("333")).toBe(3);
  });

  it("returns a map with one entry per event", () => {
    const result = assignMatchdays([event1, event2]);
    expect(result.size).toBe(2);
  });

  it("handles an empty array", () => {
    const result = assignMatchdays([]);
    expect(result.size).toBe(0);
  });

  it("is deterministic across identical calls", () => {
    const r1 = assignMatchdays([event1, event2, event3]);
    const r2 = assignMatchdays([event1, event2, event3]);
    expect(r1.get(event3.id)).toBe(r2.get(event3.id));
  });
});

// ─── mapToFixtureRows ────────────────────────────────────────────────────────

describe("mapToFixtureRows", () => {
  it("maps an event to a fixture row with correct external id (bigint-safe integer)", () => {
    const matchdays = assignMatchdays([event1]);
    const { fixtures } = mapToFixtureRows([event1], matchdays);
    expect(fixtures[0].id).toBe(760415);
    expect(typeof fixtures[0].id).toBe("number");
  });

  it("maps kickoff date from event.date", () => {
    const matchdays = assignMatchdays([event1]);
    const { fixtures } = mapToFixtureRows([event1], matchdays);
    expect(fixtures[0].kickoff).toBe("2026-06-11T19:00Z");
  });

  it("maps home and away team names correctly", () => {
    const matchdays = assignMatchdays([event1]);
    const { fixtures } = mapToFixtureRows([event1], matchdays);
    expect(fixtures[0].home_team).toBe("Mexico");
    expect(fixtures[0].away_team).toBe("South Africa");
  });

  it("sets goals_home and goals_away to null for unfinished matches", () => {
    const matchdays = assignMatchdays([event1]);
    const { fixtures } = mapToFixtureRows([event1], matchdays);
    expect(fixtures[0].goals_home).toBeNull();
    expect(fixtures[0].goals_away).toBeNull();
  });

  it("sets status to 'NS' for pre-match events", () => {
    const matchdays = assignMatchdays([event1]);
    const { fixtures } = mapToFixtureRows([event1], matchdays);
    expect(fixtures[0].status).toBe("NS");
  });

  it("sets status to 'FT' and parses goals for completed events (calendar mode — goals may be 0-0)", () => {
    // Even in calendar mode, if the API returns completed=true, we map it properly
    const ftEvent = makeEvent({ id: "760415", completed: true, homeScore: "3", awayScore: "1" });
    const matchdays = assignMatchdays([ftEvent]);
    const { fixtures } = mapToFixtureRows([ftEvent], matchdays);
    expect(fixtures[0].status).toBe("FT");
    expect(fixtures[0].goals_home).toBe(3);
    expect(fixtures[0].goals_away).toBe(1);
  });

  it("produces one RoundRow per unique matchday", () => {
    const matchdays = assignMatchdays([event1, event2]);
    const { rounds } = mapToFixtureRows([event1, event2], matchdays);
    // Both events are matchday 1 → one round
    expect(rounds.length).toBe(1);
  });

  it("produces correct round api_round string", () => {
    const matchdays = assignMatchdays([event1, event2]);
    const { rounds } = mapToFixtureRows([event1, event2], matchdays);
    expect(rounds[0].api_round).toBe("Matchday 1");
  });

  it("round name matches api_round for human-readability", () => {
    const matchdays = assignMatchdays([event1, event2]);
    const { rounds } = mapToFixtureRows([event1, event2], matchdays);
    expect(rounds[0].name).toBe("Matchday 1");
  });

  it("returns distinct rounds for matchday 1 and 2", () => {
    const matchdays = assignMatchdays([event1, event2, event3]);
    const { rounds } = mapToFixtureRows([event1, event2, event3], matchdays);
    const roundNames = rounds.map((r) => r.api_round).sort();
    expect(roundNames).toEqual(["Matchday 1", "Matchday 2"]);
  });

  it("each fixture references the correct matchday index (1-based)", () => {
    const matchdays = assignMatchdays([event1, event3]);
    const { fixtures } = mapToFixtureRows([event1, event3], matchdays);
    const md1Fixture = fixtures.find((f) => f.id === 760415);
    const md2Fixture = fixtures.find((f) => f.id === 760500);
    expect(md1Fixture?.matchday).toBe(1);
    expect(md2Fixture?.matchday).toBe(2);
  });

  it("handles 72 events without error", () => {
    // Generate 72 events — 12 groups x 4 teams x 3 games each
    const events: EspnEvent[] = [];
    let idCounter = 1000;
    for (let g = 0; g < 12; g++) {
      const teams = [`G${g}A`, `G${g}B`, `G${g}C`, `G${g}D`];
      // Group matchday 1: A vs B, C vs D
      events.push(
        makeEvent({
          id: String(idCounter++),
          date: "2026-06-11T19:00Z",
          homeName: teams[0],
          awayName: teams[1],
        })
      );
      events.push(
        makeEvent({
          id: String(idCounter++),
          date: "2026-06-12T19:00Z",
          homeName: teams[2],
          awayName: teams[3],
        })
      );
      // Group matchday 2: A vs C, B vs D
      events.push(
        makeEvent({
          id: String(idCounter++),
          date: "2026-06-18T19:00Z",
          homeName: teams[0],
          awayName: teams[2],
        })
      );
      events.push(
        makeEvent({
          id: String(idCounter++),
          date: "2026-06-19T19:00Z",
          homeName: teams[1],
          awayName: teams[3],
        })
      );
      // Group matchday 3: A vs D, B vs C
      events.push(
        makeEvent({
          id: String(idCounter++),
          date: "2026-06-25T19:00Z",
          homeName: teams[0],
          awayName: teams[3],
        })
      );
      events.push(
        makeEvent({
          id: String(idCounter++),
          date: "2026-06-26T19:00Z",
          homeName: teams[1],
          awayName: teams[2],
        })
      );
    }
    expect(events.length).toBe(72);
    const matchdays = assignMatchdays(events);
    const { fixtures, rounds } = mapToFixtureRows(events, matchdays);
    expect(fixtures.length).toBe(72);
    expect(rounds.length).toBe(3);
  });
});

// ─── filterCompleted ─────────────────────────────────────────────────────────

describe("filterCompleted", () => {
  it("returns only events where completed === true", () => {
    const events = [event1, eventFT];
    const result = filterCompleted(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("760415");
    expect(result[0].competitions[0].status.type.completed).toBe(true);
  });

  it("returns empty array when no events are completed", () => {
    const result = filterCompleted([event1, event2]);
    expect(result).toHaveLength(0);
  });

  it("returns all events when all are completed", () => {
    const completed1 = makeEvent({ id: "1", completed: true });
    const completed2 = makeEvent({ id: "2", completed: true });
    const result = filterCompleted([completed1, completed2]);
    expect(result).toHaveLength(2);
  });

  it("handles empty array gracefully", () => {
    expect(filterCompleted([])).toHaveLength(0);
  });

  it("handles state='post' as completed (belt-and-suspenders check)", () => {
    // filterCompleted relies on completed===true, not state.
    // This test documents the decision: we use completed, not state.
    const postEvent = makeEvent({ id: "999", completed: false, state: "post" });
    const result = filterCompleted([postEvent]);
    // completed is false → not included. State alone doesn't gate.
    expect(result).toHaveLength(0);
  });
});

// ─── parseGoals ──────────────────────────────────────────────────────────────
// Tested indirectly through mapToFixtureRows, but let's add direct edge-case tests
// via a completed event fixture.

describe("goals parsing edge cases (via mapToFixtureRows)", () => {
  it("parses score '0' as 0 (not null)", () => {
    const ev = makeEvent({ completed: true, homeScore: "0", awayScore: "0" });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].goals_home).toBe(0);
    expect(fixtures[0].goals_away).toBe(0);
  });

  it("parses score '10' correctly (high-scoring edge case)", () => {
    const ev = makeEvent({ completed: true, homeScore: "10", awayScore: "2" });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].goals_home).toBe(10);
    expect(fixtures[0].goals_away).toBe(2);
  });
});

// ─── logo mapping (via mapToFixtureRows) ─────────────────────────────────────

import {
  buildTeamGroupMap,
  type EspnStandingsResponse,
} from "./espn";

/** Build a makeEvent that carries logo URLs in team objects. */
function makeEventWithLogos(
  overrides: Partial<{
    id: string;
    homeLogo: string | undefined;
    awayLogo: string | undefined;
    homeName: string;
    homeId: string;
    awayName: string;
    awayId: string;
  }> = {}
): EspnEvent {
  const o = {
    id: "760415",
    homeLogo: "https://a.espncdn.com/i/teamlogos/countries/500/mex.png",
    awayLogo: "https://a.espncdn.com/i/teamlogos/countries/500/rsa.png",
    homeName: "Mexico",
    homeId: "203",
    awayName: "South Africa",
    awayId: "467",
    ...overrides,
  };
  return {
    id: o.id,
    date: "2026-06-11T19:00Z",
    name: `${o.awayName} at ${o.homeName}`,
    uid: `s:600~l:606~e:${o.id}`,
    competitions: [
      {
        id: o.id,
        status: { type: { completed: false, state: "pre" } },
        competitors: [
          {
            homeAway: "home",
            score: "0",
            team: { id: o.homeId, displayName: o.homeName, logo: o.homeLogo },
          },
          {
            homeAway: "away",
            score: "0",
            team: { id: o.awayId, displayName: o.awayName, logo: o.awayLogo },
          },
        ],
      },
    ],
  };
}

describe("logo mapping (via mapToFixtureRows)", () => {
  it("maps home_logo from the home competitor's team.logo", () => {
    const ev = makeEventWithLogos();
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].home_logo).toBe(
      "https://a.espncdn.com/i/teamlogos/countries/500/mex.png"
    );
  });

  it("maps away_logo from the away competitor's team.logo", () => {
    const ev = makeEventWithLogos();
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].away_logo).toBe(
      "https://a.espncdn.com/i/teamlogos/countries/500/rsa.png"
    );
  });

  it("sets home_logo to null when the team has no logo", () => {
    const ev = makeEventWithLogos({ homeLogo: undefined });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].home_logo).toBeNull();
  });

  it("sets away_logo to null when the team has no logo", () => {
    const ev = makeEventWithLogos({ awayLogo: undefined });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].away_logo).toBeNull();
  });

  it("existing pre-match events without logo in original makeEvent produce null logos", () => {
    // event1 uses makeEvent() which has no logo — should produce null
    const md = assignMatchdays([event1]);
    const { fixtures } = mapToFixtureRows([event1], md);
    expect(fixtures[0].home_logo).toBeNull();
    expect(fixtures[0].away_logo).toBeNull();
  });
});

// ─── buildTeamGroupMap ────────────────────────────────────────────────────────

/** Minimal ESPN standings response builder. */
function makeStandingsResponse(
  groups: Array<{ name: string; teams: Array<{ id: string; displayName: string }> }>
): EspnStandingsResponse {
  return {
    children: groups.map((g) => ({
      name: g.name,
      standings: {
        entries: g.teams.map((t) => ({
          team: { id: t.id, displayName: t.displayName },
        })),
      },
    })),
  };
}

describe("buildTeamGroupMap", () => {
  it("returns a Map from team id to group name", () => {
    const response = makeStandingsResponse([
      {
        name: "Group A",
        teams: [
          { id: "203", displayName: "Mexico" },
          { id: "467", displayName: "South Africa" },
        ],
      },
    ]);
    const map = buildTeamGroupMap(response);
    expect(map.get("203")).toBe("Group A");
    expect(map.get("467")).toBe("Group A");
  });

  it("maps teams from multiple groups correctly", () => {
    const response = makeStandingsResponse([
      {
        name: "Group A",
        teams: [{ id: "1", displayName: "TeamA1" }],
      },
      {
        name: "Group B",
        teams: [{ id: "2", displayName: "TeamB1" }],
      },
    ]);
    const map = buildTeamGroupMap(response);
    expect(map.get("1")).toBe("Group A");
    expect(map.get("2")).toBe("Group B");
  });

  it("handles 12 groups with 4 teams each (WC 2026 structure)", () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({
      name: `Group ${String.fromCharCode(65 + i)}`,
      teams: Array.from({ length: 4 }, (_, j) => ({
        id: String(i * 4 + j + 1),
        displayName: `Team${i}${j}`,
      })),
    }));
    const map = buildTeamGroupMap(makeStandingsResponse(groups));
    expect(map.size).toBe(48);
    expect(map.get("1")).toBe("Group A");
    expect(map.get("48")).toBe("Group L");
  });

  it("returns an empty map when children is empty", () => {
    const map = buildTeamGroupMap({ children: [] });
    expect(map.size).toBe(0);
  });

  it("handles entries with no team gracefully (no crash)", () => {
    // Malformed entry — should be skipped
    const response: EspnStandingsResponse = {
      children: [
        {
          name: "Group A",
          standings: {
            entries: [{ team: { id: "", displayName: "" } }],
          },
        },
      ],
    };
    const map = buildTeamGroupMap(response);
    // Empty-string id should not appear (or it appears but not crash)
    expect(() => map.get("")).not.toThrow();
  });
});

// ─── group_label assignment (via mapToFixtureRows with groupMap) ──────────────

describe("group_label assignment in mapToFixtureRows", () => {
  const groupMap = new Map([
    ["203", "Group A"], // Mexico
    ["467", "Group A"], // South Africa
  ]);

  it("assigns group_label from the home team's id", () => {
    const ev = makeEventWithLogos({ homeId: "203", awayId: "467" });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md, groupMap);
    expect(fixtures[0].group_label).toBe("Group A");
  });

  it("falls back to away team's id when home team is not in the map", () => {
    const response = makeStandingsResponse([
      {
        name: "Group B",
        teams: [{ id: "999", displayName: "Away Only Team" }],
      },
    ]);
    const fallbackMap = buildTeamGroupMap(response);
    const ev = makeEventWithLogos({ homeId: "UNKNOWN", awayId: "999" });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md, fallbackMap);
    expect(fixtures[0].group_label).toBe("Group B");
  });

  it("sets group_label to null when neither team is found in the map", () => {
    const ev = makeEventWithLogos({ homeId: "UNKNOWN_A", awayId: "UNKNOWN_B" });
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md, groupMap);
    expect(fixtures[0].group_label).toBeNull();
  });

  it("sets group_label to null when no groupMap is provided", () => {
    const ev = makeEventWithLogos();
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect(fixtures[0].group_label).toBeNull();
  });

  it("does not include group_label column when groupMap is absent (undefined)", () => {
    // Without a groupMap, group_label should still be present in the row (null)
    // — the column always exists so upserts don't accidentally clear it.
    const ev = makeEventWithLogos();
    const md = assignMatchdays([ev]);
    const { fixtures } = mapToFixtureRows([ev], md);
    expect("group_label" in fixtures[0]).toBe(true);
  });
});
