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

/**
 * Builds the user-facing message for a completed knockout calendar sync.
 *
 * The calendar sync re-pulls the whole bracket; what the admin cares about is how
 * many knockout matches now have real teams (i.e. are bettable). So we report the
 * decided/total split rather than a raw "updated" count:
 *
 *   total 0           -> "No hay partidos de eliminatorias todavía"
 *   decided >= total  -> "Eliminatorias al día: N partidos habilitados"
 *   else              -> "D de N partidos de eliminatorias habilitados"
 *
 * `decided` counts fixtures whose teams are resolved; `total` is all knockout
 * fixtures. `decided` is clamped to total for the "al día" wording.
 */
export function formatCalendarSyncResult(decided: number, total: number): string {
  if (total <= 0) {
    return "No hay partidos de eliminatorias todavía";
  }
  if (decided >= total) {
    return `Eliminatorias al día: ${total} partidos habilitados`;
  }
  return `${Math.max(decided, 0)} de ${total} partidos de eliminatorias habilitados`;
}
