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

import { roundLabelFromApiRound } from "@/lib/rounds";
import { RoundPill } from "./round-pill";

interface RoundsNavRound {
  id: number;
  api_round: string;
  locks_at: string | null;
  is_active: boolean;
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
        const label = roundLabelFromApiRound(round.api_round);

        // Hidden round (is_active === false): only admins ever receive it here,
        // since RLS filters hidden rounds out for everyone else. Render it as a
        // disabled, non-clickable pill so it can't be opened from the nav. The
        // round the user is currently viewing stays a normal pill (below), even
        // if hidden — they are already on it.
        if (!round.is_active && !isActive) {
          return (
            <span
              key={round.id}
              aria-disabled="true"
              title="Fecha oculta"
              className="shrink-0 cursor-not-allowed select-none rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-400"
            >
              {label}
            </span>
          );
        }

        return (
          <RoundPill
            key={round.id}
            id={round.id}
            label={label}
            isActive={isActive}
          />
        );
      })}
    </nav>
  );
}
