/**
 * RoundSidePanel — streamed async Server Component.
 *
 * Holds the four window-function-heavy queries (list_participants + the three
 * leaderboards) that used to block the whole round page. By fetching them HERE,
 * inside its own async component, page.tsx can wrap it in <Suspense> so the
 * fixtures render immediately and Posiciones + Participantes stream in after.
 *
 * Renders the exact same markup the round page's <aside> used before the split.
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ParticipantsList } from "./participants-list";
import { StandingsTable } from "./standings-table";

interface LeaderboardRow {
  id: string;
  rank: number;
  display_name: string | null;
  avatar_url: string | null;
  total_points: number;
}

interface ParticipantRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  active: boolean;
}

export async function RoundSidePanel({
  roundId,
  isKnockout,
}: {
  roundId: number;
  isKnockout: boolean;
}) {
  const supabase = await createServerSupabaseClient();

  const [
    profilesResult,
    leaderboardRoundResult,
    leaderboardOverallResult,
    leaderboardKnockoutResult,
  ] = await Promise.all([
    supabase.rpc("list_participants"),
    supabase.rpc("leaderboard", { p_round_id: roundId }),
    supabase.rpc("leaderboard_overall"),
    // Knockout-only standings (grand total stays in leaderboard_overall).
    supabase.rpc("leaderboard_knockout"),
  ]);

  const profiles = (profilesResult.data ?? []) as ParticipantRow[];
  const leaderboardRound = (leaderboardRoundResult.data ?? []) as LeaderboardRow[];
  const leaderboardOverall = (leaderboardOverallResult.data ??
    []) as LeaderboardRow[];
  const leaderboardKnockout = (leaderboardKnockoutResult.data ??
    []) as LeaderboardRow[];

  return (
    <>
      {/* Posiciones */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Posiciones</h2>
        <div className="space-y-5">
          {/* Per-competition table, by stage: a knockout round's own standings
              are practically identical to the aggregate knockout table, so show
              only one. Group rounds keep "Fecha actual" (this round). */}
          {isKnockout ? (
            <StandingsTable title="Eliminatorias" rows={leaderboardKnockout} />
          ) : (
            <StandingsTable title="Fecha actual" rows={leaderboardRound} />
          )}
          <StandingsTable title="General" rows={leaderboardOverall} />
        </div>
      </div>

      {/* Participantes */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Participantes
        </h2>
        <ParticipantsList profiles={profiles} />
      </div>
    </>
  );
}

/**
 * Fallback shown while RoundSidePanel streams. Matches the panel's two-card
 * shape so the layout doesn't shift when the real data lands.
 */
export function RoundSidePanelSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
        <div className="mb-4 h-4 w-24 rounded bg-gray-200" />
        <div className="space-y-2">
          <div className="h-6 w-full rounded bg-gray-100" />
          <div className="h-6 w-full rounded bg-gray-100" />
          <div className="h-6 w-full rounded bg-gray-100" />
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
        <div className="mb-3 h-4 w-28 rounded bg-gray-200" />
        <div className="space-y-2">
          <div className="h-6 w-full rounded bg-gray-100" />
          <div className="h-6 w-full rounded bg-gray-100" />
        </div>
      </div>
    </div>
  );
}
