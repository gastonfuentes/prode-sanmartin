/**
 * Unit tests for lib/admin-export.ts pure functions.
 *
 * TDD-first (RED before implementation). These cover the admin export logic:
 * CSV serialization and the per-player image-card view model. No DB calls and
 * no Next.js imports — only pure transformations of rows returned by the
 * admin_round_predictions() RPC.
 *
 * Tested functions:
 *   - escapeCsvField:  RFC-4180-style field quoting/escaping
 *   - formatResult:    null-safe "h-a" or "" for unplayed fixtures
 *   - buildPredictionsCsv: full CSV (BOM + header + rows) from RPC rows
 *   - buildPlayerCard: single-player/single-round card model for the PNG
 */

import { describe, it, expect } from "vitest";
import {
  escapeCsvField,
  formatResult,
  buildPredictionsCsv,
  buildPlayerCard,
  type AdminPredictionRow,
} from "./admin-export";

// ── fixtures ──────────────────────────────────────────────────────────────

function makeRow(over: Partial<AdminPredictionRow> = {}): AdminPredictionRow {
  return {
    round_id: 1,
    api_round: "Group Stage - 1",
    user_id: "u-1",
    display_name: "Gastón Fuentes",
    email: "gaston@example.com",
    avatar_url: null,
    fixture_id: 10,
    home_team: "Argentina",
    away_team: "Brasil",
    kickoff: "2026-06-15T19:00:00Z",
    pred_home: 2,
    pred_away: 1,
    goals_home: 2,
    goals_away: 1,
    points: 2,
    ...over,
  };
}

// ── escapeCsvField ──────────────────────────────────────────────────────────

describe("escapeCsvField", () => {
  it("leaves a plain value untouched", () => {
    expect(escapeCsvField("Argentina")).toBe("Argentina");
  });

  it("wraps a value containing a comma in double quotes", () => {
    expect(escapeCsvField("Fuentes, Gastón")).toBe('"Fuentes, Gastón"');
  });

  it("doubles embedded quotes and wraps the field", () => {
    expect(escapeCsvField('El "Diez"')).toBe('"El ""Diez"""');
  });

  it("wraps a value containing a newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("stringifies numbers", () => {
    expect(escapeCsvField(2)).toBe("2");
    expect(escapeCsvField(0)).toBe("0");
  });

  it("neutralizes formula-injection prefixes (= + - @) with a leading apostrophe", () => {
    expect(escapeCsvField("=HYPERLINK")).toBe("'=HYPERLINK");
    expect(escapeCsvField("+1")).toBe("'+1");
    expect(escapeCsvField("-cmd")).toBe("'-cmd");
    expect(escapeCsvField("@SUM")).toBe("'@SUM");
  });

  it("still quotes a formula value that also contains a quote", () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
});

// ── formatResult ──────────────────────────────────────────────────────────

describe("formatResult", () => {
  it("formats a played result as 'h-a'", () => {
    expect(formatResult(3, 0)).toBe("3-0");
  });

  it("returns empty string when either goal is null (unplayed)", () => {
    expect(formatResult(null, null)).toBe("");
    expect(formatResult(1, null)).toBe("");
    expect(formatResult(null, 1)).toBe("");
  });
});

// ── buildPredictionsCsv ─────────────────────────────────────────────────────

describe("buildPredictionsCsv", () => {
  it("prepends a UTF-8 BOM so Excel reads accents correctly", () => {
    const csv = buildPredictionsCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("emits the Spanish header row", () => {
    const csv = buildPredictionsCsv([]);
    const firstLine = csv.replace(/^﻿/, "").split("\r\n")[0];
    expect(firstLine).toBe(
      "Fecha,Jugador,Email,Partido,Pronóstico,Resultado,Puntos"
    );
  });

  it("serializes a row with the round label, match, prediction and result", () => {
    const csv = buildPredictionsCsv([makeRow()]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[1]).toBe(
      "Fecha 1,Gastón Fuentes,gaston@example.com,Argentina vs Brasil,2-1,2-1,2"
    );
  });

  it("leaves the Resultado column empty for an unplayed fixture", () => {
    const csv = buildPredictionsCsv([
      makeRow({ goals_home: null, goals_away: null, points: 0 }),
    ]);
    const cols = csv.replace(/^﻿/, "").split("\r\n")[1].split(",");
    // ...,Pronóstico,Resultado,Puntos  → Resultado is the 6th column (index 5)
    expect(cols[5]).toBe("");
    expect(cols[6]).toBe("0");
  });

  it("escapes a player name that contains a comma", () => {
    const csv = buildPredictionsCsv([
      makeRow({ display_name: "Fuentes, Gastón" }),
    ]);
    expect(csv).toContain('"Fuentes, Gastón"');
  });

  it("falls back to a placeholder when display_name is null", () => {
    const csv = buildPredictionsCsv([makeRow({ display_name: null })]);
    const cols = csv.replace(/^﻿/, "").split("\r\n")[1].split(",");
    expect(cols[1]).toBe("(sin nombre)");
  });

  it("preserves input row order and emits one line per row", () => {
    const csv = buildPredictionsCsv([
      makeRow({ fixture_id: 1, home_team: "A", away_team: "B" }),
      makeRow({ fixture_id: 2, home_team: "C", away_team: "D" }),
    ]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain("A vs B");
    expect(lines[2]).toContain("C vs D");
  });
});

// ── buildPlayerCard ─────────────────────────────────────────────────────────

describe("buildPlayerCard", () => {
  it("returns null when there are no rows", () => {
    expect(buildPlayerCard([])).toBeNull();
  });

  it("derives player identity, round label and avatar from the first row", () => {
    const card = buildPlayerCard([makeRow({ avatar_url: "http://x/a.png" })]);
    expect(card?.playerName).toBe("Gastón Fuentes");
    expect(card?.roundLabel).toBe("Fecha 1");
    expect(card?.avatarUrl).toBe("http://x/a.png");
  });

  it("maps each fixture into match/prediction/result/points", () => {
    const card = buildPlayerCard([makeRow()]);
    expect(card?.rows).toEqual([
      { match: "Argentina vs Brasil", prediction: "2-1", result: "2-1", points: 2 },
    ]);
  });

  it("sums total points and counts exact hits (points >= 2: fecha 1 = 2, fecha 2+ = 3)", () => {
    const card = buildPlayerCard([
      makeRow({ fixture_id: 1, points: 2 }), // exact, fecha 1
      makeRow({ fixture_id: 2, points: 1 }), // outcome only
      makeRow({ fixture_id: 3, points: 3 }), // exact, fecha 2+
      makeRow({ fixture_id: 4, points: 0 }), // wrong
    ]);
    expect(card?.totalPoints).toBe(6);
    expect(card?.exactCount).toBe(2);
  });

  it("falls back to a placeholder name when display_name is null", () => {
    const card = buildPlayerCard([makeRow({ display_name: null })]);
    expect(card?.playerName).toBe("(sin nombre)");
  });
});
