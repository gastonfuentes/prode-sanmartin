"use client";

/**
 * OthersPredictionsModal — Client Component.
 *
 * Shows every participant's prediction for a single fixture and lets the user
 * share them in the WhatsApp group. Data comes from the round_predictions RPC,
 * which only returns rows after the round locks — so this is post-lock only.
 *
 * Tailwind-only overlay (the project has no UI library). Closes on the Cerrar
 * button, an overlay click, or the Escape key.
 */

import { useEffect } from "react";
import {
  buildSharePredictionsText,
  type SharePick,
} from "@/lib/share-predictions";

interface FixtureSummary {
  home_team: string;
  away_team: string;
  goals_home: number | null;
  goals_away: number | null;
  status: string;
}

interface OthersPredictionsModalProps {
  fixture: FixtureSummary;
  picks: SharePick[];
  roundLabel: string;
  onClose: () => void;
}

/** Tailwind classes for the points badge — mirrors the prediction form. */
function pointsBadge(points: number): { label: string; badge: string } {
  if (points >= 2) {
    return { label: `+${points}`, badge: "bg-green-100 text-green-700" };
  }
  if (points === 1) {
    return { label: "+1", badge: "bg-amber-100 text-amber-700" };
  }
  return { label: "0 pts", badge: "bg-gray-100 text-gray-500" };
}

export function OthersPredictionsModal({
  fixture,
  picks,
  roundLabel,
  onClose,
}: OthersPredictionsModalProps) {
  // Close on Escape.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isFinished =
    fixture.status === "FT" &&
    fixture.goals_home !== null &&
    fixture.goals_away !== null;

  function handleShare() {
    const text = buildSharePredictionsText({
      homeTeam: fixture.home_team,
      awayTeam: fixture.away_team,
      roundLabel,
      isFinished,
      goalsHome: fixture.goals_home,
      goalsAway: fixture.goals_away,
      picks,
    });
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pronósticos para ${fixture.home_team} vs ${fixture.away_team}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-base font-bold text-gray-900">
          {fixture.home_team} vs {fixture.away_team}
        </h2>
        {isFinished && (
          <p className="mt-1 text-center text-sm text-gray-500">
            Resultado: {fixture.goals_home} – {fixture.goals_away}
          </p>
        )}

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {picks.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              Nadie pronosticó este partido.
            </p>
          ) : (
            picks.map((p, i) => {
              const badge = pointsBadge(p.points);
              return (
                <div
                  key={`${p.display_name ?? "anon"}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
                >
                  <span className="truncate text-sm text-gray-900">
                    {p.display_name?.trim() || "Sin nombre"}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">
                      {p.pred_home} – {p.pred_away}
                    </span>
                    {isFinished && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.badge}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={handleShare}
            disabled={picks.length === 0}
            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Compartir por WhatsApp
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
