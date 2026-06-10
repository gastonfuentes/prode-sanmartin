/**
 * Round page — RSC.
 *
 * Fetches:
 *   1. Round metadata (name, api_round, locks_at)
 *   2. Fixtures for this round (ordered by kickoff)
 *   3. The authenticated user's predictions for those fixtures (RLS-scoped)
 *   4. All profiles (for Participantes panel)
 *   5. Leaderboard for this round and overall (for Posiciones panel)
 *
 * Derives the locked state from now() >= round.locks_at (REQ-3.3 — authoritative
 * lock is server time, NOT the status column).
 *
 * Layout: two-column on md+. Left: fixture list + prediction form. Right: panel
 * with Participantes + Posiciones sections. On mobile the panel stacks below.
 *
 * TASK-30 — REQ-2.1–2.4, REQ-3.3, REQ-6.1–6.8.
 */

import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isRoundLocked } from "@/lib/scoring";
import { roundLabelFromApiRound } from "@/lib/rounds";
import { PredictionForm } from "@/components/prediction-form";
import { ParticipantsList } from "@/components/participants-list";
import { StandingsTable } from "@/components/standings-table";
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
    .select("id, name, api_round, locks_at, first_kickoff, status")
    .eq("id", roundId)
    .single();

  if (roundError || !round) {
    notFound();
  }

  // Derive authoritative lock state from server time + locks_at
  const locked =
    round.locks_at !== null &&
    isRoundLocked(new Date(), new Date(round.locks_at));

  // Spanish round label derived from api_round at the display layer only —
  // do NOT modify api_round in the DB (it is the sync grouping key).
  const roundLabel = roundLabelFromApiRound(round.api_round);

  // Fetch fixtures, profiles, and leaderboard data in parallel
  const [
    fixturesResult,
    profilesResult,
    leaderboardRoundResult,
    leaderboardOverallResult,
  ] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        "id, home_team, away_team, home_logo, away_logo, group_label, kickoff, goals_home, goals_away, status"
      )
      .eq("round_id", roundId)
      .order("kickoff", { ascending: true }),

    supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .order("display_name", { ascending: true }),

    supabase.rpc("leaderboard", { p_round_id: roundId }),

    supabase.rpc("leaderboard_overall"),
  ]);

  const { data: fixtures, error: fixturesError } = fixturesResult;

  if (fixturesError || !fixtures) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        Error al cargar los partidos. Por favor refrescá la página.
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

  const profiles = profilesResult.data ?? [];
  const leaderboardRound = (leaderboardRoundResult.data ?? []) as Array<{
    id: string;
    rank: number;
    display_name: string | null;
    avatar_url: string | null;
    total_points: number;
  }>;
  const leaderboardOverall = (leaderboardOverallResult.data ?? []) as Array<{
    id: string;
    rank: number;
    display_name: string | null;
    avatar_url: string | null;
    total_points: number;
  }>;

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      {/* ── LEFT COLUMN: fixtures + prediction form ─────────────────────── */}
      <div className="min-w-0 flex-1">
        {/* Round header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{roundLabel}</h1>
          {locked ? (
            <p className="mt-1 text-sm text-amber-700">
              Esta fecha está cerrada. Ya no se aceptan pronósticos.
            </p>
          ) : (
            round.locks_at && (
              <p className="mt-1 text-sm text-gray-500">
                Los pronósticos cierran el{" "}
                <time dateTime={round.locks_at}>
                  {new Date(round.locks_at).toLocaleString("es-AR", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Argentina/Buenos_Aires",
                    timeZoneName: "short",
                  })}
                </time>
              </p>
            )
          )}
        </div>

        {fixtures.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            No hay partidos programados para esta fecha.
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

      {/* ── RIGHT PANEL: Participantes + Posiciones ──────────────────────── */}
      <aside className="w-full shrink-0 space-y-6 md:w-64">
        {/* Participantes */}
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Participantes
          </h2>
          <ParticipantsList profiles={profiles} />
        </div>

        {/* Posiciones */}
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Posiciones
          </h2>
          <div className="space-y-5">
            <StandingsTable
              title="Fecha actual"
              rows={leaderboardRound}
            />
            <StandingsTable
              title="General"
              rows={leaderboardOverall}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
