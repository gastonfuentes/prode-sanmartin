"use client";

/**
 * SyncCalendarButton — Client Component.
 *
 * Lets the admin manually trigger the CALENDAR sync (the same one pg_cron runs
 * daily at 06:00 UTC) to habilitate knockout matches on demand: when a previous
 * round finishes, ESPN assigns the real teams to the next cross, and this pulls
 * them so the match flips from "Equipos por definir" to bettable.
 *
 * The shared cron secret stays server-side — this button only invokes the
 * triggerCalendarSync server action, which attaches the secret and calls the
 * Edge Function. After a run it shows a transient status line with how many
 * knockout matches now have teams.
 */

import { useState, useTransition } from "react";
import { triggerCalendarSync } from "@/app/(app)/admin/actions";
import { formatCalendarSyncResult } from "@/lib/admin-sync";

type Status =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function SyncCalendarButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function runSync() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await triggerCalendarSync();
      if (result.ok) {
        setStatus({
          kind: "ok",
          message: formatCalendarSyncResult(result.decided, result.total),
        });
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
        {isPending ? "Actualizando…" : "Actualizar eliminatorias"}
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
