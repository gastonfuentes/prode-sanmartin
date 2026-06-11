"use client";

/**
 * UserRowActions — Client Component.
 *
 * Per-row action on the admin users list:
 *   - active user   -> "Quitar acceso" with an inline two-click confirmation
 *                      (destructive: it ejects the user on their next request).
 *   - inactive user -> "Reactivar" (single click; restores access + history).
 *
 * The caller's own row is disabled (the RPC also blocks it with P0002). On
 * success the page revalidates and the row re-renders in its new state.
 */

import { useState, useTransition } from "react";
import { addAllowedEmail, revokeAccess } from "@/app/(app)/admin/users/actions";

interface UserRowActionsProps {
  email: string;
  active: boolean;
  isSelf: boolean;
}

export function UserRowActions({ email, active, isSelf }: UserRowActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeAccess(email);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  function runReactivate() {
    setError(null);
    startTransition(async () => {
      const result = await addAllowedEmail(email);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  if (!active) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={runReactivate}
          disabled={isPending}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Reactivando…" : "Reactivar"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">¿Confirmar?</span>
          <button
            type="button"
            onClick={runRevoke}
            disabled={isPending}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Quitando…" : "Sí, quitar"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={isSelf}
          title={isSelf ? "No podés quitarte el acceso a vos mismo" : undefined}
          className="text-sm font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-gray-300"
        >
          Quitar acceso
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
