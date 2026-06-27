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
import { SyncResultsButton } from "@/components/admin/sync-results-button";
import { SyncCalendarButton } from "@/components/admin/sync-calendar-button";
import { RoundActiveToggle } from "@/components/admin/round-active-toggle";

// The calendar sync (triggered by SyncCalendarButton → triggerCalendarSync) chains
// several ESPN fetches and can exceed the default serverless limit; give the route
// room so the server action can await the Edge Function response.
export const maxDuration = 60;

interface AllRoundRow {
  id: number;
  api_round: string;
  first_kickoff: string | null;
  locks_at: string | null;
  is_active: boolean;
}

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

  // Admins bypass the RLS visibility filter, so this returns hidden rounds too.
  const { data: allRoundsData } = await supabase
    .from("rounds")
    .select("id, api_round, first_kickoff, locks_at, is_active")
    .order("first_kickoff", { ascending: true });

  const allRounds = (allRoundsData ?? []) as AllRoundRow[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel de administración</h1>
          <p className="mt-1 text-sm text-gray-500">
            Apuestas de todos los participantes en las fechas ya cerradas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncCalendarButton />
          <SyncResultsButton />
          <Link
            href="/admin/users"
            className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Usuarios
          </Link>
          <Link
            href="/admin/groups"
            className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Grupos
          </Link>
          <a
            href="/admin/export"
            download
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Descargar CSV (todas las fechas)
          </a>
        </div>
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

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Gestionar fechas</h2>
        <p className="mt-1 text-sm text-gray-500">
          Las fechas ocultas no son visibles para los participantes.
        </p>
      </div>

      {allRounds.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          Todavía no hay fechas disponibles.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {allRounds.map((round) => (
            <li
              key={round.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {roundLabelFromApiRound(round.api_round)}
                </span>
                {!round.is_active && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Oculta
                  </span>
                )}
              </div>
              <RoundActiveToggle
                roundId={round.id}
                active={round.is_active}
                label={roundLabelFromApiRound(round.api_round)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
