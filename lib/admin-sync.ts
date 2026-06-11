/**
 * Pure helpers for the admin manual results-sync button.
 *
 * No React, no fetch, no Supabase — fully testable with Vitest. The server
 * action (app/(app)/admin/actions.ts) owns the I/O (calling the sync Edge
 * Function); this module only turns the resulting count into the Spanish
 * message the dashboard shows.
 */

/**
 * Builds the user-facing message for a completed results sync.
 *
 *   0  -> "No hay partidos para actualizar todavía"
 *   1  -> "1 partido actualizado"
 *   N  -> "N partidos actualizados"
 *
 * `updated` is the number of FT fixtures the Edge Function wrote on this run
 * (0 also covers the guard "skipped" case — nothing finished yet).
 */
export function formatSyncResult(updated: number): string {
  if (updated <= 0) {
    return "No hay partidos para actualizar todavía";
  }
  const noun = updated === 1 ? "partido actualizado" : "partidos actualizados";
  return `${updated} ${noun}`;
}
