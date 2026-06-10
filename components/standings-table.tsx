/**
 * StandingsTable — Server Component.
 *
 * Reusable table for leaderboard data. Accepts a title prop so it can be used
 * for both "Fecha actual" (current round) and "General" (overall cumulative).
 *
 * Renders rank, avatar, display_name, and total_points per row.
 * Avatars use plain <img> (Google-hosted); falls back to initials.
 * 0-point rows are rendered cleanly — they are expected before FT results.
 */

interface LeaderboardRow {
  id: string;
  rank: number;
  display_name: string | null;
  avatar_url: string | null;
  total_points: number;
}

interface StandingsTableProps {
  title: string;
  rows: LeaderboardRow[];
}

// ── Avatar helpers (same logic as ParticipantsList) ───────────────────────────

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ── StandingsTable ────────────────────────────────────────────────────────────

export function StandingsTable({ title, rows }: StandingsTableProps) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">Sin datos disponibles.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="pb-1 text-left font-medium">Pos.</th>
              <th className="pb-1 text-left font-medium">Jugador</th>
              <th className="pb-1 text-right font-medium">Pts.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-gray-50 last:border-0"
              >
                <td className="py-1.5 pr-2 text-xs font-medium text-gray-500">
                  {row.rank}
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    {row.avatar_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={row.avatar_url}
                        alt={row.display_name ?? "Jugador"}
                        width={24}
                        height={24}
                        loading="lazy"
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-label={row.display_name ?? "Jugador"}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700"
                      >
                        {getInitials(row.display_name)}
                      </span>
                    )}
                    <span className="truncate text-sm text-gray-800">
                      {row.display_name ?? "—"}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 text-right font-semibold text-gray-900">
                  {row.total_points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
