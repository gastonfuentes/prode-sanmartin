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
import { buildFormState } from "@/lib/predictions-form";
import { validateScoreInput } from "@/lib/predictions-form";
import type { SubmitPredictionsResult } from "@/app/(app)/rounds/[id]/actions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fixture {
  id: number;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
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

    // Client-side validation before the network round-trip
    for (const fixture of fixtures) {
      const entry = formState[fixture.id];
      const homeV = validateScoreInput(entry?.home ?? "");
      const awayV = validateScoreInput(entry?.away ?? "");
      if (!homeV.valid) {
        setSubmitError(
          `${fixture.home_team} score: ${homeV.error}`
        );
        return;
      }
      if (!awayV.valid) {
        setSubmitError(
          `${fixture.away_team} score: ${awayV.error}`
        );
        return;
      }
    }

    const entries = fixtures.map((f) => ({
      fixtureId: f.id,
      home: formState[f.id]?.home ?? "",
      away: formState[f.id]?.away ?? "",
    }));

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
          Predictions are locked for this round. Good luck!
        </div>
      )}

      {/* Success banner */}
      {submitSuccess && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800"
        >
          Predictions saved successfully.
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
          const kickoffLabel = kickoff.toLocaleString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
          });

          return (
            <div
              key={fixture.id}
              className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm"
            >
              {/* Kickoff time */}
              <p className="mb-3 text-center text-xs text-gray-400">
                {kickoffLabel}
              </p>

              {/* Teams + score inputs */}
              <div className="flex items-center justify-center gap-3">
                {/* Home team */}
                <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
                  {fixture.home_logo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fixture.home_logo}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 object-contain"
                    />
                  )}
                  <span className="truncate text-sm font-medium text-gray-800">
                    {fixture.home_team}
                  </span>
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
                    aria-label={`${fixture.home_team} predicted goals`}
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
                    aria-label={`${fixture.away_team} predicted goals`}
                    className="h-10 w-12 rounded-lg border border-gray-300 bg-white text-center text-lg font-bold text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>

                {/* Away team */}
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  {fixture.away_logo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fixture.away_logo}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 object-contain"
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
            {isPending ? "Saving…" : "Save predictions"}
          </button>
        </div>
      )}
    </form>
  );
}
