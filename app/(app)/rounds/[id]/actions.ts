"use server";

/**
 * Server actions for the round page prediction form.
 *
 * All actions run server-side; the SSR Supabase client is session-scoped
 * via cookies() — RLS automatically restricts writes to auth.uid().
 *
 * REQ-2.1–2.4, REQ-3.3: partial saves are allowed — empty fixtures are
 * skipped; only fully-filled, valid fixtures are upserted (REQ-2.1).
 *
 * MVP decision — cleared-to-empty: if a user clears both inputs for a
 * fixture they previously predicted, that entry is treated as "skip" and
 * the existing DB record is NOT deleted. Deletion is out of spec for MVP.
 *
 * Upsert target: UNIQUE(user_id, fixture_id)
 *   ON CONFLICT (user_id, fixture_id) DO UPDATE SET pred_home, pred_away
 *
 * The DB trigger enforce_betting_lock raises P0001 when now() >= locks_at.
 * We catch that error code and return a friendly "round locked" message
 * instead of crashing. REQ-3.3 + design note: "never rely on UI alone".
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildSubmitPayload } from "@/lib/predictions-form";
import { revalidatePath } from "next/cache";

export type SubmitPredictionsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Upserts predictions for the fixtures the user chose to fill in a round.
 * Empty fixtures are skipped. Half-filled fixtures return a validation error.
 *
 * @param roundId - The round's DB id (used for revalidatePath).
 * @param entries - Array of { fixtureId, home, away } from the form; may
 *                  include empty strings for fixtures the user left blank.
 */
export async function submitPredictions(
  roundId: number,
  entries: Array<{ fixtureId: number; home: string; away: string }>
): Promise<SubmitPredictionsResult> {
  // Server-side validation — mirrors client, never trusts form data
  const payload = buildSubmitPayload(entries);

  if (!payload.ok) {
    switch (payload.kind) {
      case "nothingToSubmit":
        return { ok: false, error: "Ingresá al menos un pronóstico antes de guardar." };
      case "incomplete":
        return {
          ok: false,
          error: `Completá ambos resultados o dejá los dos vacíos para los partidos: ${payload.fixtureIds.join(", ")}.`,
        };
      case "invalid":
        return {
          ok: false,
          error: `Partido ${payload.fixtureId}: ${payload.error}`,
        };
    }
  }

  const rows = payload.rows;

  const supabase = await createServerSupabaseClient();

  // Verify session (belt-and-suspenders; layout guard already checked)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado." };
  }

  // Build upsert rows with user_id explicitly set (RLS insert check requires
  // auth.uid() = user_id; we set it explicitly so the constraint is satisfied)
  const upsertRows = rows.map((r) => ({
    user_id: user.id,
    fixture_id: r.fixture_id,
    pred_home: r.pred_home,
    pred_away: r.pred_away,
  }));

  const { error } = await supabase
    .from("predictions")
    .upsert(upsertRows, { onConflict: "user_id,fixture_id" });

  if (error) {
    // P0001 is raised by the betting lock trigger (enforce_betting_lock).
    // Surface as a friendly message; do not expose raw DB error text.
    if (
      error.code === "P0001" ||
      error.message?.toLowerCase().includes("locked")
    ) {
      return {
        ok: false,
        error: "Esta fecha está cerrada. Ya no se aceptan pronósticos.",
      };
    }

    // Other DB errors (constraint violations, etc.)
    return { ok: false, error: "Error al guardar los pronósticos. Por favor intentá de nuevo." };
  }

  // Revalidate so the RSC refetches fresh predictions after submit
  revalidatePath(`/rounds/${roundId}`);

  return { ok: true };
}
