/**
 * Round page — RSC.
 *
 * Fetches (fast path, blocking — these gate the fixtures the user came to see):
 *   1. Round metadata (name, api_round, locks_at)
 *   2. Fixtures for this round (ordered by kickoff)
 *   3. The authenticated user's predictions for those fixtures (RLS-scoped)
 *   4. All participants' predictions for the round (per-fixture privacy gate)
 *
 * The heavy window-function queries (participants + the three leaderboards) live
 * in <RoundSidePanel>, streamed via <Suspense> so the fixtures paint first and
 * Posiciones + Participantes fill in after (no 8-query barrier on navigation).
 *
 * Derives the locked state from now() >= round.locks_at (REQ-3.3 — authoritative
 * lock is server time, NOT the status column).
 *
 * Layout: two-column on md+. Left: fixture list + prediction form (wrapped in
 * <SwipeNavigator> for mobile swipe between rounds). Right: streamed panel with
 * Posiciones + Participantes. On mobile the panel stacks below.
 *
 * TASK-30 — REQ-2.1–2.4, REQ-3.3, REQ-6.1–6.8.
 */

import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isRoundLocked } from "@/lib/scoring";
import { roundLabelFromApiRound, adjacentRoundIds } from "@/lib/rounds";
import { PredictionForm } from "@/components/prediction-form";
import { RoundsNav } from "@/components/rounds-nav";
import { SwipeNavigator } from "@/components/swipe-navigator";
import {
  RoundSidePanel,
  RoundSidePanelSkeleton,
} from "@/components/round-side-panel";
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
    .select("id, name, api_round, locks_at, first_kickoff, status, stage")
    .eq("id", roundId)
    .single();

  if (roundError || !round) {
    // A non-admin requesting a hidden round gets zero rows under RLS (same shape
    // as a nonexistent round). Redirect to / — the root page resolves the
    // current active round and sends them there. Admins bypass RLS and load the
    // round normally, so they never reach this branch for a hidden round.
    redirect("/");
  }

  const now = new Date();
  const isKnockout = round.stage === "knockout";

  // Group rounds use a single round-level lock. Knockout rounds lock PER MATCH
  // (see per-fixture decided/locked below), so the round-level banner is hidden
  // for them and openness is decided card by card.
  const roundLocked =
    round.locks_at !== null && isRoundLocked(now, new Date(round.locks_at));

  // Spanish round label derived from api_round at the display layer only —
  // do NOT modify api_round in the DB (it is the sync grouping key).
  const roundLabel = roundLabelFromApiRound(round.api_round);

  // Fast path: fixtures, all rounds (for the nav), and round predictions. The
  // leaderboards + participants are streamed separately in <RoundSidePanel>.
  const [fixturesResult, roundsResult, roundPredictionsResult] =
    await Promise.all([
      supabase
        .from("fixtures")
        .select(
          "id, home_team, away_team, home_logo, away_logo, group_label, kickoff, goals_home, goals_away, status, teams_decided, locks_at"
        )
        .eq("round_id", roundId)
        .order("kickoff", { ascending: true }),

      supabase
        .from("rounds")
        .select("id, api_round, first_kickoff, locks_at, is_active")
        .order("first_kickoff", { ascending: true }),

      // All participants' predictions for this round. The RPC enforces the
      // post-lock privacy gate PER FIXTURE (zero rows for a match before its lock),
      // so still-open knockout matches never leak.
      supabase.rpc("round_predictions", { p_round_id: roundId }),
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
    points: number;
  }> = [];

  if (fixtureIds.length > 0) {
    const { data: preds } = await supabase
      .from("predictions")
      .select("fixture_id, pred_home, pred_away, points")
      .in("fixture_id", fixtureIds);

    predictions = preds ?? [];
  }

  const allRounds = (roundsResult.data ?? []) as Array<{
    id: number;
    api_round: string;
    first_kickoff: string | null;
    locks_at: string | null;
    is_active: boolean;
  }>;

  // Previous/next round for mobile swipe. The navigable set mirrors the nav's
  // clickable pills: visible (is_active) rounds plus the one being viewed (an
  // admin may be on a hidden round). allRounds is already ordered by kickoff.
  const navigableRoundIds = allRounds
    .filter((r) => r.is_active || r.id === roundId)
    .map((r) => r.id);
  const { prevId: prevRoundId, nextId: nextRoundId } = adjacentRoundIds(
    navigableRoundIds,
    roundId
  );

  // Per-fixture lock + decided state. Group fixtures: decided always true, locked
  // = round-level lock. Knockout fixtures: decided = teams_decided, locked = the
  // per-match lock (fixtures.locks_at). The DB enforces both regardless; this is UX.
  const enrichedFixtures = fixtures.map((f) => {
    const decided = isKnockout ? f.teams_decided === true : true;
    const locked = isKnockout
      ? f.locks_at !== null && isRoundLocked(now, new Date(f.locks_at))
      : roundLocked;
    return { ...f, decided, locked };
  });

  // Group all participants' predictions by fixture (post-lock only). Sorted by
  // display_name for a stable view; the share text reuses this order.
  const roundPredictions = (roundPredictionsResult.data ?? []) as Array<{
    display_name: string | null;
    fixture_id: number;
    pred_home: number;
    pred_away: number;
    points: number;
  }>;
  const othersByFixture: Record<
    number,
    Array<{
      display_name: string | null;
      pred_home: number;
      pred_away: number;
      points: number;
    }>
  > = {};
  for (const p of roundPredictions) {
    (othersByFixture[p.fixture_id] ??= []).push({
      display_name: p.display_name,
      pred_home: p.pred_home,
      pred_away: p.pred_away,
      points: p.points,
    });
  }
  for (const id of Object.keys(othersByFixture)) {
    othersByFixture[Number(id)].sort((a, b) =>
      (a.display_name ?? "").localeCompare(b.display_name ?? "", "es")
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start md:gap-x-8">
      {/* ── Round header — col 1 / row 1 on md, so the right panel can start
          aligned with the first fixture card (row 2), not with this header. */}
      <div className="md:col-start-1 md:row-start-1">
        <RoundsNav rounds={allRounds} activeRoundId={roundId} />
        <h1 className="text-2xl font-bold text-gray-900">{roundLabel}</h1>
        {isKnockout ? (
          <p className="mt-1 text-sm text-gray-500">
            Eliminatorias · cada partido cierra 10 minutos antes de empezar.
          </p>
        ) : roundLocked ? (
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

      {/* ── LEFT COLUMN: fixtures + prediction form — col 1 / row 2 ──────────
          Wrapped in SwipeNavigator so mobile users can swipe between rounds. */}
      <div className="min-w-0 md:col-start-1 md:row-start-2">
        <SwipeNavigator prevRoundId={prevRoundId} nextRoundId={nextRoundId}>
          {fixtures.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">
              No hay partidos programados para esta fecha.
            </div>
          ) : (
            <PredictionForm
              roundId={roundId}
              roundLabel={roundLabel}
              fixtures={enrichedFixtures}
              predictions={predictions}
              othersByFixture={othersByFixture}
              isLocked={isKnockout ? false : roundLocked}
              submitAction={submitPredictions}
            />
          )}
        </SwipeNavigator>
      </div>

      {/* ── RIGHT PANEL: Posiciones + Participantes — col 2 / row 2, so it
          lines up with the top of the first fixture card. Streamed via
          <Suspense> so the heavy leaderboards never block the fixtures. ──── */}
      <aside className="space-y-6 md:col-start-2 md:row-start-2">
        <Suspense fallback={<RoundSidePanelSkeleton />}>
          <RoundSidePanel roundId={roundId} isKnockout={isKnockout} />
        </Suspense>
      </aside>
    </div>
  );
}
