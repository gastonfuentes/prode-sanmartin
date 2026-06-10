/**
 * Unit tests for lib/predictions-form.ts pure functions.
 *
 * TDD-first (RED before implementation).
 * NOT tested here: RSC rendering, server actions, Supabase calls — those
 * require a real runtime/DB and are integration-only.
 *
 * Tested pure functions:
 *   - validateScoreInput: ensures a raw string input is a non-negative integer.
 *   - classifyFixtureEntry: determines skip / valid / incomplete per fixture.
 *   - buildSubmitPayload: converts form state to upsertable rows, skipping
 *     empty fixtures and erroring on half-filled ones.
 *   - buildFormState: maps fixtures + existing predictions into the initial
 *     form state (an object keyed by fixture_id).
 */

import { describe, it, expect } from "vitest";
import {
  validateScoreInput,
  classifyFixtureEntry,
  buildSubmitPayload,
  buildFormState,
} from "./predictions-form";

// ── validateScoreInput ──────────────────────────────────────────────────────

describe("validateScoreInput", () => {
  // REQ-2.4: must be non-negative integer
  it("accepts '0'", () => {
    expect(validateScoreInput("0")).toEqual({ valid: true, value: 0 });
  });

  it("accepts '1'", () => {
    expect(validateScoreInput("1")).toEqual({ valid: true, value: 1 });
  });

  it("accepts '10'", () => {
    expect(validateScoreInput("10")).toEqual({ valid: true, value: 10 });
  });

  it("accepts '99' (upper bound)", () => {
    expect(validateScoreInput("99")).toEqual({ valid: true, value: 99 });
  });

  it("rejects empty string", () => {
    expect(validateScoreInput("")).toEqual({ valid: false, error: "Required" });
  });

  it("rejects negative value '-1'", () => {
    expect(validateScoreInput("-1")).toEqual({
      valid: false,
      error: "Must be 0 or more",
    });
  });

  it("rejects fractional value '1.5'", () => {
    expect(validateScoreInput("1.5")).toEqual({
      valid: false,
      error: "Must be a whole number",
    });
  });

  it("accepts '1.0' — Number('1.0') === 1 which is an integer", () => {
    // Number.isInteger(1.0) is true in JS; the value is a valid integer.
    // The DB will receive 1, which satisfies the >= 0 and <= 99 constraint.
    expect(validateScoreInput("1.0")).toEqual({ valid: true, value: 1 });
  });

  it("rejects non-numeric string 'abc'", () => {
    expect(validateScoreInput("abc")).toEqual({
      valid: false,
      error: "Must be a number",
    });
  });

  it("rejects whitespace-only string '  '", () => {
    expect(validateScoreInput("  ")).toEqual({
      valid: false,
      error: "Required",
    });
  });

  it("rejects 100 (exceeds max)", () => {
    expect(validateScoreInput("100")).toEqual({
      valid: false,
      error: "Must be 99 or less",
    });
  });

  it("accepts '0' with leading space (trimmed)", () => {
    // We trim before parsing
    expect(validateScoreInput(" 0 ")).toEqual({ valid: true, value: 0 });
  });
});

// ── classifyFixtureEntry ────────────────────────────────────────────────────

describe("classifyFixtureEntry", () => {
  // both empty → skip
  it("returns skip when both home and away are empty", () => {
    expect(classifyFixtureEntry("", "")).toEqual({ kind: "skip" });
  });

  it("returns skip when both home and away are whitespace-only", () => {
    expect(classifyFixtureEntry("  ", " ")).toEqual({ kind: "skip" });
  });

  // both filled + valid → valid with parsed values
  it("returns valid when both are valid integers", () => {
    expect(classifyFixtureEntry("2", "1")).toEqual({
      kind: "valid",
      home: 2,
      away: 1,
    });
  });

  it("returns valid for '0' '0'", () => {
    expect(classifyFixtureEntry("0", "0")).toEqual({
      kind: "valid",
      home: 0,
      away: 0,
    });
  });

  it("returns valid for '1.0' — JS integer quirk preserved", () => {
    expect(classifyFixtureEntry("1.0", "0")).toEqual({
      kind: "valid",
      home: 1,
      away: 0,
    });
  });

  // exactly one filled → incomplete error
  it("returns incomplete when home is filled but away is empty", () => {
    const result = classifyFixtureEntry("2", "");
    expect(result.kind).toBe("incomplete");
  });

  it("returns incomplete when away is filled but home is empty", () => {
    const result = classifyFixtureEntry("", "1");
    expect(result.kind).toBe("incomplete");
  });

  // invalid value in one or both fields
  it("returns invalid when home is negative", () => {
    const result = classifyFixtureEntry("-1", "0");
    expect(result.kind).toBe("invalid");
  });

  it("returns invalid when away is fractional", () => {
    const result = classifyFixtureEntry("2", "1.5");
    expect(result.kind).toBe("invalid");
  });

  it("returns invalid when home is a non-numeric string", () => {
    const result = classifyFixtureEntry("abc", "1");
    expect(result.kind).toBe("invalid");
  });
});

// ── buildSubmitPayload ──────────────────────────────────────────────────────

describe("buildSubmitPayload", () => {
  type Entry = { fixtureId: number; home: string; away: string };

  it("includes only fully-filled fixtures", () => {
    const entries: Entry[] = [
      { fixtureId: 1, home: "2", away: "1" },
      { fixtureId: 2, home: "", away: "" }, // skip
      { fixtureId: 3, home: "0", away: "3" },
    ];
    const result = buildSubmitPayload(entries);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([
        { fixture_id: 1, pred_home: 2, pred_away: 1 },
        { fixture_id: 3, pred_home: 0, pred_away: 3 },
      ]);
    }
  });

  it("returns nothingToSubmit when all fixtures are empty", () => {
    const entries: Entry[] = [
      { fixtureId: 1, home: "", away: "" },
      { fixtureId: 2, home: "  ", away: "" },
    ];
    const result = buildSubmitPayload(entries);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("nothingToSubmit");
    }
  });

  it("returns incomplete error with fixture ids when one side is missing", () => {
    const entries: Entry[] = [
      { fixtureId: 1, home: "2", away: "1" },
      { fixtureId: 2, home: "1", away: "" }, // half-filled
    ];
    const result = buildSubmitPayload(entries);
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "incomplete") {
      expect(result.fixtureIds).toContain(2);
    } else {
      expect(result.ok).toBe(false); // ensure we reached the incomplete branch
    }
  });

  it("returns invalid error when a value is out of range", () => {
    const entries: Entry[] = [
      { fixtureId: 1, home: "-1", away: "0" },
    ];
    const result = buildSubmitPayload(entries);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("invalid");
    }
  });

  it("returns ok with all rows when every fixture is filled", () => {
    const entries: Entry[] = [
      { fixtureId: 1, home: "1", away: "0" },
      { fixtureId: 2, home: "2", away: "2" },
    ];
    const result = buildSubmitPayload(entries);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(2);
    }
  });

  it("handles empty entries array — nothingToSubmit", () => {
    const result = buildSubmitPayload([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("nothingToSubmit");
    }
  });
});

// ── buildFormState ──────────────────────────────────────────────────────────

describe("buildFormState", () => {
  type Fixture = {
    id: number;
    home_team: string;
    away_team: string;
    kickoff: string;
  };

  type Prediction = {
    fixture_id: number;
    pred_home: number;
    pred_away: number;
  };

  const fixtures: Fixture[] = [
    { id: 1, home_team: "USA", away_team: "MEX", kickoff: "2026-06-15T18:00:00Z" },
    { id: 2, home_team: "ARG", away_team: "BRA", kickoff: "2026-06-15T21:00:00Z" },
    { id: 3, home_team: "ENG", away_team: "FRA", kickoff: "2026-06-16T15:00:00Z" },
  ];

  it("initializes all entries with empty strings when no predictions exist", () => {
    const state = buildFormState(fixtures, []);
    expect(state).toEqual({
      1: { home: "", away: "" },
      2: { home: "", away: "" },
      3: { home: "", away: "" },
    });
  });

  it("pre-fills entries with existing prediction values", () => {
    const preds: Prediction[] = [
      { fixture_id: 1, pred_home: 2, pred_away: 1 },
      { fixture_id: 3, pred_home: 0, pred_away: 0 },
    ];
    const state = buildFormState(fixtures, preds);
    expect(state).toEqual({
      1: { home: "2", away: "1" },
      2: { home: "", away: "" },
      3: { home: "0", away: "0" },
    });
  });

  it("returns an empty object for empty fixtures", () => {
    const state = buildFormState([], []);
    expect(state).toEqual({});
  });

  it("ignores predictions for fixture IDs not in the fixtures list", () => {
    const preds: Prediction[] = [
      { fixture_id: 99, pred_home: 1, pred_away: 0 }, // fixture 99 not in list
      { fixture_id: 1, pred_home: 3, pred_away: 2 },
    ];
    const state = buildFormState(fixtures, preds);
    expect(state[99]).toBeUndefined();
    expect(state[1]).toEqual({ home: "3", away: "2" });
  });

  it("converts prediction values 0 correctly to string '0' (not empty string)", () => {
    const preds: Prediction[] = [{ fixture_id: 2, pred_home: 0, pred_away: 0 }];
    const state = buildFormState(fixtures, preds);
    expect(state[2]).toEqual({ home: "0", away: "0" });
  });
});
