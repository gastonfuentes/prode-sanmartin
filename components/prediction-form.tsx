"use client";

/**
 * PredictionForm — Client Component.
 *
 * Renders a form for all fixtures in a round. Each fixture has two score
 * inputs (home and away). On submit, calls the server action submitPredictions.
 *
 * When the round is locked (isLocked=true), renders read-only state:
 * - Inputs are disabled (visual lock indicator)
 * - A "Predictions locked" banner is shown
 * - Submit button is hidden
 *
 * REQ-3.3: the DB enforces the lock server-side regardless; this is UX only.
 * If a submission races the lock, the server action catches P0001 and returns
 * a "round locked" error which is shown here.
 *
 * TASK-30 — REQ-2.1–2.4, REQ-3.3.
 */

import { useState, useTransition } from "react";
import { buildFormState, buildSubmitPayload } from "@/lib/predictions-form";
import type { SubmitPredictionsResult } from "@/app/(app)/rounds/[id]/actions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fixture {
  id: number;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  group_label: string | null;
  kickoff: string;
}

interface ExistingPrediction {
  fixture_id: number;
  pred_home: number;
  pred_away: number;
}

interface PredictionFormProps {
  roundId: number;
  fixtures: Fixture[];
  predictions: ExistingPrediction[];
  isLocked: boolean;
  submitAction: (
    roundId: number,
    entries: Array<{ fixtureId: number; home: string; away: string }>
  ) => Promise<SubmitPredictionsResult>;
}

// ── PredictionForm ────────────────────────────────────────────────────────────

export function PredictionForm({
  roundId,
  fixtures,
  predictions,
  isLocked,
  submitAction,
}: PredictionFormProps) {
  const [formState, setFormState] = useState(() =>
    buildFormState(fixtures, predictions)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleChange(
    fixtureId: number,
    field: "home" | "away",
    value: string
  ) {
    setSubmitSuccess(false);
    setSubmitError(null);
    setFormState((prev) => ({
      ...prev,
      [fixtureId]: { ...prev[fixtureId], [field]: value },
    }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Build a per-fixture lookup so we can include team names in error messages
    const fixtureById = new Map(fixtures.map((f) => [f.id, f]));

    const entries = fixtures.map((f) => ({
      fixtureId: f.id,
      home: formState[f.id]?.home ?? "",
      away: formState[f.id]?.away ?? "",
    }));

    // Client-side classification — partial saves are allowed (REQ-2.1).
    // Empty fixtures are skipped; half-filled ones block the submit.
    const payload = buildSubmitPayload(entries);

    if (!payload.ok) {
      switch (payload.kind) {
        case "nothingToSubmit":
          setSubmitError("Ingresá al menos un pronóstico antes de guardar.");
          return;

        case "incomplete": {
          const names = payload.fixtureIds
            .map((id) => {
              const f = fixtureById.get(id);
              return f ? `${f.home_team} vs ${f.away_team}` : `partido ${id}`;
            })
            .join(", ");
          setSubmitError(
            `Completá ambos resultados o dejá los dos vacíos: ${names}`
          );
          return;
        }

        case "invalid": {
          const f = fixtureById.get(payload.fixtureId);
          const label = f
            ? `${f.home_team} vs ${f.away_team}`
            : `partido ${payload.fixtureId}`;
          setSubmitError(`${label}: ${payload.error}`);
          return;
        }
      }
    }

    startTransition(async () => {
      const result = await submitAction(roundId, entries);
      if (result.ok) {
        setSubmitSuccess(true);
        setSubmitError(null);
      } else {
        setSubmitError(result.error);
        setSubmitSuccess(false);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Lock banner */}
      {isLocked && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          Esta fecha está cerrada. Ya no se aceptan pronósticos.
        </div>
      )}

      {/* Success banner */}
      {submitSuccess && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800"
        >
          Pronósticos guardados.
        </div>
      )}

      {/* Error banner */}
      {submitError && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {submitError}
        </div>
      )}

      <div className="space-y-3">
        {fixtures.map((fixture) => {
          const entry = formState[fixture.id] ?? { home: "", away: "" };
          const kickoff = new Date(fixture.kickoff);
          const kickoffLabel = kickoff.toLocaleString("es-AR", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Argentina/Buenos_Aires",
            timeZoneName: "short",
          });

          return (
            <div
              key={fixture.id}
              className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm"
            >
              {/* Card header: kickoff time + group badge */}
              <div className="mb-3 flex items-center justify-center gap-2">
                <p className="text-xs text-gray-400">{kickoffLabel}</p>
                {fixture.group_label && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {fixture.group_label}
                  </span>
                )}
              </div>

              {/* Teams + score inputs */}
              <div className="flex items-center justify-center gap-3">
                {/* Home team */}
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                  <span className="truncate text-sm font-medium text-gray-800">
                    {fixture.home_team}
                  </span>
                  {fixture.home_logo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fixture.home_logo}
                      alt={fixture.home_team}
                      width={20}
                      height={20}
                      loading="lazy"
                      className="h-5 w-5 shrink-0 object-contain"
                    />
                  )}
                </div>

                {/* Score inputs */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    step={1}
                    value={entry.home}
                    onChange={(e) =>
                      handleChange(fixture.id, "home", e.target.value)
                    }
                    disabled={isLocked || isPending}
                    aria-label={`Goles predichos para ${fixture.home_team}`}
                    className="h-10 w-12 rounded-lg border border-gray-300 bg-white text-center text-lg font-bold text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  <span className="text-lg font-bold text-gray-400">–</span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    step={1}
                    value={entry.away}
                    onChange={(e) =>
                      handleChange(fixture.id, "away", e.target.value)
                    }
                    disabled={isLocked || isPending}
                    aria-label={`Goles predichos para ${fixture.away_team}`}
                    className="h-10 w-12 rounded-lg border border-gray-300 bg-white text-center text-lg font-bold text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>

                {/* Away team */}
                <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5">
                  {fixture.away_logo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fixture.away_logo}
                      alt={fixture.away_team}
                      width={20}
                      height={20}
                      loading="lazy"
                      className="h-5 w-5 shrink-0 object-contain"
                    />
                  )}
                  <span className="truncate text-sm font-medium text-gray-800">
                    {fixture.away_team}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit — hidden when locked */}
      {!isLocked && (
        <div className="mt-6">
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}
    </form>
  );
}
