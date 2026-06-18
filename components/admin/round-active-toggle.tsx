"use client";

/**
 * RoundActiveToggle — Client Component.
 *
 * Single-button toggle that calls setRoundActive to flip a round's is_active
 * flag. Active rounds show "Ocultar"; hidden rounds show "Mostrar". Shows a
 * pending state while the transition is in flight and surfaces any server error
 * inline below the button.
 */

import { useState, useTransition } from "react";
import { setRoundActive } from "@/app/(app)/admin/actions";

interface RoundActiveToggleProps {
  roundId: number;
  active: boolean;
  label: string;
}

export function RoundActiveToggle({
  roundId,
  active,
  label,
}: RoundActiveToggleProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = await setRoundActive(roundId, !active);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        title={label}
        className={
          active
            ? "text-sm font-medium text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            : "text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {isPending ? "Guardando…" : active ? "Ocultar" : "Mostrar"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
