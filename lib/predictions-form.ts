/**
 * Pure helper functions for the prediction form.
 *
 * No React, no Supabase — fully testable with Vitest.
 *
 * REQ-2.4: goal values must be non-negative integers (0..99).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ScoreValidResult = { valid: true; value: number };
export type ScoreInvalidResult = { valid: false; error: string };
export type ScoreValidation = ScoreValidResult | ScoreInvalidResult;

/** Per-fixture form entry: string values so they bind to <input type="number">. */
export type FixtureFormEntry = { home: string; away: string };

/** Form state keyed by fixture id. */
export type PredictionFormState = Record<number, FixtureFormEntry>;

// ── validateScoreInput ───────────────────────────────────────────────────────

/**
 * Validates a raw string value from a score input field.
 *
 * Rules (REQ-2.4):
 *   - Must not be empty or whitespace-only.
 *   - Must be a finite number.
 *   - Must be a whole number (no decimal part).
 *   - Must be >= 0.
 *   - Must be <= 99 (DB check constraint: pred_home/away <= 99).
 */
export function validateScoreInput(raw: string): ScoreValidation {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { valid: false, error: "Required" };
  }

  const parsed = Number(trimmed);

  if (isNaN(parsed) || !isFinite(parsed)) {
    return { valid: false, error: "Must be a number" };
  }

  if (!Number.isInteger(parsed)) {
    return { valid: false, error: "Must be a whole number" };
  }

  if (parsed < 0) {
    return { valid: false, error: "Must be 0 or more" };
  }

  if (parsed > 99) {
    return { valid: false, error: "Must be 99 or less" };
  }

  return { valid: true, value: parsed };
}

// ── buildFormState ───────────────────────────────────────────────────────────

/**
 * Maps a list of fixtures and the user's existing predictions into the initial
 * PredictionFormState.
 *
 * - Fixtures without an existing prediction get empty string entries ("").
 * - Fixtures WITH a prediction get stringified values (e.g. 0 → "0").
 * - Predictions for fixture IDs not in the fixtures list are ignored.
 */
export function buildFormState(
  fixtures: Array<{ id: number }>,
  predictions: Array<{ fixture_id: number; pred_home: number; pred_away: number }>
): PredictionFormState {
  // Index existing predictions by fixture_id for O(1) lookup
  const predMap = new Map<number, { pred_home: number; pred_away: number }>();
  for (const p of predictions) {
    predMap.set(p.fixture_id, { pred_home: p.pred_home, pred_away: p.pred_away });
  }

  const state: PredictionFormState = {};
  for (const fixture of fixtures) {
    const existing = predMap.get(fixture.id);
    if (existing !== undefined) {
      state[fixture.id] = {
        home: String(existing.pred_home),
        away: String(existing.pred_away),
      };
    } else {
      state[fixture.id] = { home: "", away: "" };
    }
  }

  return state;
}
