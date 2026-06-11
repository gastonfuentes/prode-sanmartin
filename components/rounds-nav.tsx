/**
 * RoundsNav — presentational round switcher.
 *
 * Renders a horizontal, scrollable row of pills (one per round) so a user can
 * jump to any matchday. The root page only auto-redirects to the round that is
 * open for betting; this nav is the only way to revisit a past round and watch
 * its results come in (see the finished-fixture state in PredictionForm).
 *
 * Server-compatible — just renders <Link>s, no client state. Rounds arrive
 * pre-ordered by first_kickoff (ascending) from the RSC query.
 */

import Link from "next/link";
import { roundLabelFromApiRound } from "@/lib/rounds";

interface RoundsNavRound {
  id: number;
  api_round: string;
  locks_at: string | null;
}

interface RoundsNavProps {
  rounds: RoundsNavRound[];
  activeRoundId: number;
}

export function RoundsNav({ rounds, activeRoundId }: RoundsNavProps) {
  // Nothing to switch between — hide the nav entirely.
  if (rounds.length <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Fechas"
      className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      {rounds.map((round) => {
        const isActive = round.id === activeRoundId;
        return (
          <Link
            key={round.id}
            href={`/rounds/${round.id}`}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-indigo-600 text-white shadow-sm"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {roundLabelFromApiRound(round.api_round)}
          </Link>
        );
      })}
    </nav>
  );
}
