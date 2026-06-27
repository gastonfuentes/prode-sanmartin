/**
 * Root page — auth check + current-round redirect.
 *
 * - Authenticated users → resolve current round → redirect to /rounds/[id]
 * - Unauthenticated users → redirect to /login
 *
 * This page sits OUTSIDE the (app) route group so the root URL / is handled
 * here. The (app)/layout.tsx guard protects /rounds/[id] and other app pages.
 *
 * TASK-29 — REQ-3: directs users to the active prediction round.
 */

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { selectCurrentRound } from "@/lib/rounds";
import type { RoundSummary } from "@/lib/rounds";

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Users without a group are directed to the onboarding page.
  // Admins always have a group assigned (migration 035), so this never
  // catches them. The rpc returns null when the user has no group yet.
  const { data: groupId } = await supabase.rpc("current_user_group_id");
  if (!groupId) {
    redirect("/join");
  }

  // Authenticated: resolve the current round
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, name, api_round, first_kickoff, locks_at, status, stage")
    // Only active rounds are redirect targets. A round hidden by the admin must
    // not be the post-login destination — even for admins, who bypass the RLS
    // visibility filter and would otherwise still land on the hidden round.
    .eq("is_active", true)
    .order("first_kickoff", { ascending: true });

  let summaries: RoundSummary[] = (rounds ?? []) as RoundSummary[];

  // A knockout round's round-level locks_at is only its EARLIEST match, so it
  // can't tell selectCurrentRound that later matches are still open. Compute
  // per-round openness: a KO round is "current-eligible" only while it has a
  // decided fixture whose lock has not passed.
  const knockoutRoundIds = summaries
    .filter((r) => r.stage === "knockout")
    .map((r) => r.id);

  if (knockoutRoundIds.length > 0) {
    const { data: openFixtures } = await supabase
      .from("fixtures")
      .select("round_id")
      .in("round_id", knockoutRoundIds)
      .eq("teams_decided", true)
      .gt("locks_at", new Date().toISOString());

    const openRoundIds = new Set(
      (openFixtures ?? []).map((f) => f.round_id as number)
    );
    summaries = summaries.map((r) =>
      r.stage === "knockout"
        ? { ...r, has_open_fixture: openRoundIds.has(r.id) }
        : r
    );
  }

  const current = summaries.length
    ? selectCurrentRound(summaries, new Date())
    : null;

  if (!current) {
    // No rounds seeded yet — show a brief holding page
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md text-center">
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Prode San Martín</h1>
          <p className="text-sm text-gray-500">
            Todavía no hay fechas disponibles. Volvé pronto.
          </p>
        </div>
      </main>
    );
  }

  redirect(`/rounds/${current.id}`);
}
