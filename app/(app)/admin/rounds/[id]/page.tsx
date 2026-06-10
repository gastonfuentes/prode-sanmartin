/**
 * Admin round detail — RSC.
 *
 * Shows every participant's predictions for ONE locked round. Data comes from
 * the admin_round_predictions() RPC, which gates on is_admin() AND post-lock
 * (now() >= locks_at) at the database layer. Rows are grouped per player and
 * rendered with buildPlayerCard (the same view model used by the PNG export).
 *
 * Per round the admin can: download a CSV of this round, and download a PNG
 * card per player. Pre-lock rounds show a "not closed yet" notice and no data.
 *
 * Admin access is enforced by app/(app)/admin/layout.tsx.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { roundLabelFromApiRound } from "@/lib/rounds";
import { isRoundLocked } from "@/lib/scoring";
import { buildPlayerCard, type AdminPredictionRow } from "@/lib/admin-export";

interface AdminRoundPageProps {
  params: Promise<{ id: string }>;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default async function AdminRoundPage({ params }: AdminRoundPageProps) {
  const { id } = await params;
  const roundId = Number(id);

  if (!Number.isFinite(roundId) || roundId <= 0) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();

  const { data: round, error: roundError } = await supabase
    .from("rounds")
    .select("id, api_round, locks_at")
    .eq("id", roundId)
    .single();

  if (roundError || !round) {
    notFound();
  }

  const roundLabel = roundLabelFromApiRound(round.api_round);
  const locked =
    round.locks_at !== null &&
    isRoundLocked(new Date(), new Date(round.locks_at));

  // Group predictions per player. The RPC returns zero rows pre-lock or for
  // non-admins (defense in depth — the layout already gated admin access).
  let players: Array<{ userId: string; rows: AdminPredictionRow[] }> = [];

  if (locked) {
    const { data } = await supabase.rpc("admin_round_predictions", {
      p_round_id: roundId,
    });
    const rows = (data ?? []) as AdminPredictionRow[];

    const byPlayer = new Map<string, AdminPredictionRow[]>();
    for (const row of rows) {
      const arr = byPlayer.get(row.user_id) ?? [];
      arr.push(row);
      byPlayer.set(row.user_id, arr);
    }
    players = [...byPlayer.entries()].map(([userId, playerRows]) => ({
      userId,
      rows: playerRows,
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin"
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ← Panel
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{roundLabel}</h1>
        </div>
        {locked && players.length > 0 && (
          <a
            href={`/admin/export?round=${roundId}`}
            download
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Descargar CSV (esta fecha)
          </a>
        )}
      </div>

      {!locked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-12 text-center text-sm text-amber-800">
          Esta fecha todavía no cerró. Vas a poder ver y descargar las apuestas
          una vez que cierre.
        </div>
      ) : players.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          Nadie cargó pronósticos en esta fecha.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {players.map(({ userId, rows }) => {
            const card = buildPlayerCard(rows);
            if (!card) return null;
            return (
              <section
                key={userId}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {card.avatarUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={card.avatarUrl}
                        alt={card.playerName}
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                        {getInitials(card.playerName)}
                      </span>
                    )}
                    <span className="truncate text-sm font-semibold text-gray-900">
                      {card.playerName}
                    </span>
                  </div>
                  <a
                    href={`/admin/image/${roundId}/${userId}`}
                    download
                    className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Descargar imagen
                  </a>
                </header>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400">
                      <th className="px-4 py-1.5 text-left font-medium">Partido</th>
                      <th className="py-1.5 text-center font-medium">Pron.</th>
                      <th className="py-1.5 text-center font-medium">Result.</th>
                      <th className="px-4 py-1.5 text-right font-medium">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-1.5 text-gray-800">{r.match}</td>
                        <td className="py-1.5 text-center font-medium text-gray-900">
                          {r.prediction}
                        </td>
                        <td className="py-1.5 text-center text-gray-500">
                          {r.result || "—"}
                        </td>
                        <td className="px-4 py-1.5 text-right font-semibold text-gray-900">
                          {r.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <footer className="border-t border-gray-100 px-4 py-2 text-right text-xs text-gray-500">
                  Total: <span className="font-semibold text-gray-900">{card.totalPoints} pts</span>
                  {" · "}
                  {card.exactCount} exactos
                </footer>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
