/**
 * Admin home — RSC.
 *
 * Lists the rounds that are already LOCKED (now() >= locks_at). Only locked
 * rounds are shown because predictions are only viewable/exportable post-lock
 * (the same privacy rule the rest of the app enforces). Each round links to its
 * detail page; a top action downloads a CSV of every locked round at once.
 *
 * Admin access is enforced by app/(app)/admin/layout.tsx.
 */

import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { roundLabelFromApiRound } from "@/lib/rounds";

const LOCK_DATE_FMT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
  timeZoneName: "short",
};

export default async function AdminHomePage() {
  const supabase = await createServerSupabaseClient();
  const nowIso = new Date().toISOString();

  // Locked rounds only: locks_at <= now. NULL locks_at (unseeded) is excluded
  // by the comparison. Most recent first.
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, api_round, locks_at")
    .lte("locks_at", nowIso)
    .order("locks_at", { ascending: false });

  const lockedRounds = rounds ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel de administración</h1>
          <p className="mt-1 text-sm text-gray-500">
            Apuestas de todos los participantes en las fechas ya cerradas.
          </p>
        </div>
        <a
          href="/admin/export"
          download
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          Descargar CSV (todas las fechas)
        </a>
      </div>

      {lockedRounds.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          Todavía no hay fechas cerradas. Cuando una fecha cierre vas a poder ver
          y descargar las apuestas acá.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {lockedRounds.map((round) => (
            <li key={round.id}>
              <Link
                href={`/admin/rounds/${round.id}`}
                className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
              >
                <div>
                  <span className="text-sm font-semibold text-gray-900">
                    {roundLabelFromApiRound(round.api_round)}
                  </span>
                  {round.locks_at && (
                    <p className="mt-0.5 text-xs text-gray-400">
                      Cerró el{" "}
                      {new Date(round.locks_at).toLocaleString("es-AR", LOCK_DATE_FMT)}
                    </p>
                  )}
                </div>
                <span aria-hidden className="text-gray-300">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
