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

  // Authenticated: resolve the current round
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, name, api_round, first_kickoff, locks_at, status")
    .order("first_kickoff", { ascending: true });

  const current = rounds ? selectCurrentRound(rounds as RoundSummary[], new Date()) : null;

  if (!current) {
    // No rounds seeded yet — show a brief holding page
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-md text-center">
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Prode San Martín</h1>
          <p className="text-sm text-gray-500">
            No rounds available yet. Check back soon.
          </p>
        </div>
      </main>
    );
  }

  redirect(`/rounds/${current.id}`);
}
