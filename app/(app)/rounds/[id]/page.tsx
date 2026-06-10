/**
 * Round page — RSC.
 *
 * Fetches:
 *   1. Round metadata (name, locks_at)
 *   2. Fixtures for this round (ordered by kickoff)
 *   3. The authenticated user's predictions for those fixtures (RLS-scoped)
 *
 * Derives the locked state from now() >= round.locks_at (REQ-3.3 — authoritative
 * lock is server time, NOT the status column).
 *
 * Renders:
 *   - PredictionForm (open state) — editable score inputs for each fixture
 *   - PredictionForm (locked state) — read-only view with "locked" banner
 *
 * The (app) layout already ensures the user is authenticated.
 *
 * TASK-30 — REQ-2.1–2.4, REQ-3.3.
 */

import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isRoundLocked } from "@/lib/scoring";
import { PredictionForm } from "@/components/prediction-form";
import { submitPredictions } from "./actions";

interface RoundPageProps {
  params: Promise<{ id: string }>;
}

export default async function RoundPage({ params }: RoundPageProps) {
  const { id } = await params;
  const roundId = Number(id);

  if (!Number.isFinite(roundId) || roundId <= 0) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();

  // Fetch round metadata
  const { data: round, error: roundError } = await supabase
    .from("rounds")
    .select("id, name, locks_at, first_kickoff, status")
    .eq("id", roundId)
    .single();

  if (roundError || !round) {
    notFound();
  }

  // Derive authoritative lock state from server time + locks_at
  const locked =
    round.locks_at !== null &&
    isRoundLocked(new Date(), new Date(round.locks_at));

  // Fetch fixtures for this round, ordered by kickoff
  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select(
      "id, home_team, away_team, home_logo, away_logo, group_label, kickoff, goals_home, goals_away, status"
    )
    .eq("round_id", roundId)
    .order("kickoff", { ascending: true });

  if (fixturesError || !fixtures) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        Failed to load fixtures. Please refresh.
      </div>
    );
  }

  // Fetch user's existing predictions for these fixtures (RLS returns only own rows)
  const fixtureIds = fixtures.map((f) => f.id);
  let predictions: Array<{
    fixture_id: number;
    pred_home: number;
    pred_away: number;
  }> = [];

  if (fixtureIds.length > 0) {
    const { data: preds } = await supabase
      .from("predictions")
      .select("fixture_id, pred_home, pred_away")
      .in("fixture_id", fixtureIds);

    predictions = preds ?? [];
  }

  return (
    <div>
      {/* Round header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{round.name}</h1>
        {locked ? (
          <p className="mt-1 text-sm text-amber-700">
            This round is locked — no more changes accepted.
          </p>
        ) : (
          round.locks_at && (
            <p className="mt-1 text-sm text-gray-500">
              Predictions close{" "}
              <time dateTime={round.locks_at}>
                {new Date(round.locks_at).toLocaleString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "UTC",
                  timeZoneName: "short",
                })}
              </time>
            </p>
          )
        )}
      </div>

      {fixtures.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-500">
          No fixtures scheduled for this round yet.
        </div>
      ) : (
        <PredictionForm
          roundId={roundId}
          fixtures={fixtures}
          predictions={predictions}
          isLocked={locked}
          submitAction={submitPredictions}
        />
      )}
    </div>
  );
}
