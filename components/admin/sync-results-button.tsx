"use client";

/**
 * SyncResultsButton — Client Component.
 *
 * Lets the admin manually trigger the results sync (the same one pg_cron runs
 * every 2 hours) for matches that just finished. The shared cron secret stays
 * server-side: this button only invokes the triggerResultsSync server action,
 * which attaches the secret and calls the Edge Function.
 *
 * After a run it shows a transient status line:
 *   - "3 partidos actualizados"            (success, fixtures written)
 *   - "No hay partidos para actualizar todavía" (nothing finished yet)
 *   - the action's error message           (failure)
 */

import { useState, useTransition } from "react";
import { triggerResultsSync } from "@/app/(app)/admin/actions";
import { formatSyncResult } from "@/lib/admin-sync";

type Status =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function SyncResultsButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function runSync() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await triggerResultsSync();
      if (result.ok) {
        setStatus({ kind: "ok", message: formatSyncResult(result.updated) });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={runSync}
        disabled={isPending}
        className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Actualizando…" : "Actualizar resultados"}
      </button>
      {status.kind === "ok" && (
        <span className="text-xs font-medium text-emerald-600">
          {status.message}
        </span>
      )}
      {status.kind === "error" && (
        <span className="text-xs font-medium text-red-600">
          {status.message}
        </span>
      )}
    </div>
  );
}
