/**
 * Pure helper functions for the prediction form.
 *
 * No React, no Supabase — fully testable with Vitest.
 *
 * REQ-2.1 / REQ-2.4: a user MAY submit predictions for ANY fixture in an open
 * round. Partial submission (some fixtures left blank) is explicitly allowed.
 * Goal values must be non-negative integers (0..99).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ScoreValidResult = { valid: true; value: number };
export type ScoreInvalidResult = { valid: false; error: string };
export type ScoreValidation = ScoreValidResult | ScoreInvalidResult;

/** Per-fixture form entry: string values so they bind to <input type="number">. */
export type FixtureFormEntry = { home: string; away: string };

/** Form state keyed by fixture id. */
export type PredictionFormState = Record<number, FixtureFormEntry>;

/**
 * Classification of a single fixture entry when building the submit payload.
 *
 * - skip      — both inputs are empty; user has not predicted this fixture yet
 *               (or deliberately cleared it). No row is submitted; no error.
 * - valid     — both inputs are valid non-negative integers. Include in upsert.
 * - incomplete — exactly ONE of home/away is filled. Validation error.
 * - invalid   — one or both values are present but fail range/type checks.
 */
export type FixtureEntryClassification =
  | { kind: "skip" }
  | { kind: "valid"; home: number; away: number }
  | { kind: "incomplete"; homeError: string | null; awayError: string | null }
  | { kind: "invalid"; homeError: string | null; awayError: string | null };

/** Input shape passed from the form to buildSubmitPayload / server action. */
export type FormEntry = { fixtureId: number; home: string; away: string };

/** Successful payload — rows ready for upsert. */
export type SubmitPayloadOk = {
  ok: true;
  rows: Array<{ fixture_id: number; pred_home: number; pred_away: number }>;
};

/** Error payloads returned when submission cannot proceed. */
export type SubmitPayloadError =
  | { ok: false; kind: "nothingToSubmit" }
  | { ok: false; kind: "incomplete"; fixtureIds: number[] }
  | { ok: false; kind: "invalid"; fixtureId: number; error: string };

export type SubmitPayload = SubmitPayloadOk | SubmitPayloadError;

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

// ── classifyFixtureEntry ─────────────────────────────────────────────────────

/**
 * Classifies a single fixture entry from the form.
 *
 * Rules (REQ-2.1, REQ-2.4):
 *   - Both empty (or whitespace) → skip. Partial predictions are allowed;
 *     empty means "not yet predicted" for this MVP.
 *   - Both present and valid → valid with parsed integers.
 *   - Exactly one present → incomplete (user started but didn't finish).
 *   - Present but failing range/type checks → invalid.
 *
 * NOTE — cleared-to-empty MVP decision:
 *   If a user had an existing prediction and clears BOTH fields, the entry
 *   is classified as "skip" and the existing DB record is NOT deleted.
 *   Deletion is out of spec for the MVP. This is intentional.
 */
export function classifyFixtureEntry(
  rawHome: string,
  rawAway: string
): FixtureEntryClassification {
  const homeEmpty = rawHome.trim() === "";
  const awayEmpty = rawAway.trim() === "";

  // Both empty → skip without error
  if (homeEmpty && awayEmpty) {
    return { kind: "skip" };
  }

  // Exactly one side is empty → incomplete
  if (homeEmpty || awayEmpty) {
    return {
      kind: "incomplete",
      homeError: homeEmpty ? "Required" : null,
      awayError: awayEmpty ? "Required" : null,
    };
  }

  // Both present — validate each
  const homeV = validateScoreInput(rawHome);
  const awayV = validateScoreInput(rawAway);

  if (!homeV.valid || !awayV.valid) {
    return {
      kind: "invalid",
      homeError: homeV.valid ? null : homeV.error,
      awayError: awayV.valid ? null : awayV.error,
    };
  }

  return { kind: "valid", home: homeV.value, away: awayV.value };
}

// ── buildSubmitPayload ───────────────────────────────────────────────────────

/**
 * Converts the raw form entries to a validated upsert payload.
 *
 * Processing order (per fixture):
 *   1. skip     → ignore; do not include in rows.
 *   2. incomplete → collect fixture id; after scanning all, return an error.
 *   3. invalid  → return an error immediately (first invalid wins).
 *   4. valid    → add to rows.
 *
 * After scanning all entries:
 *   - If any incomplete fixtures were found → return incomplete error with ids.
 *   - If rows is empty (all skipped or empty input) → return nothingToSubmit.
 *   - Otherwise → return ok with rows.
 */
export function buildSubmitPayload(entries: FormEntry[]): SubmitPayload {
  const rows: Array<{ fixture_id: number; pred_home: number; pred_away: number }> =
    [];
  const incompleteIds: number[] = [];

  for (const entry of entries) {
    const classification = classifyFixtureEntry(entry.home, entry.away);

    switch (classification.kind) {
      case "skip":
        // Nothing to do — user left this fixture blank intentionally
        break;

      case "valid":
        rows.push({
          fixture_id: entry.fixtureId,
          pred_home: classification.home,
          pred_away: classification.away,
        });
        break;

      case "incomplete":
        incompleteIds.push(entry.fixtureId);
        break;

      case "invalid": {
        const errorMsg =
          classification.homeError ?? classification.awayError ?? "Invalid value";
        return {
          ok: false,
          kind: "invalid",
          fixtureId: entry.fixtureId,
          error: errorMsg,
        };
      }
    }
  }

  // Incomplete entries block the whole submit
  if (incompleteIds.length > 0) {
    return { ok: false, kind: "incomplete", fixtureIds: incompleteIds };
  }

  // All entries were skipped (or input was empty)
  if (rows.length === 0) {
    return { ok: false, kind: "nothingToSubmit" };
  }

  return { ok: true, rows };
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
