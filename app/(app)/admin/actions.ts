"use server";

/**
 * Server actions for the admin home dashboard.
 *
 * triggerResultsSync lets an admin fire the SAME results sync the pg_cron job
 * runs every 2 hours (migration 015) — for when a match just finished and the
 * admin doesn't want to wait for the next scheduled run.
 *
 * SECURITY: the sync Edge Function is protected by the shared CRON_TOKEN
 * (x-cron-secret header). That secret MUST stay server-side — it lives in the
 * Vercel env (process.env.CRON_TOKEN) and never reaches the browser. The client
 * button only invokes this action; the server attaches the secret. This mirrors
 * the two-layer auth the cron uses (anon-key JWT for the gateway + cron secret
 * for the app check). See supabase/functions/sync/index.ts.
 *
 * The call is idempotent: re-running over an already-FT fixture writes the same
 * goals and the score_fixture trigger only fires on the FT transition, so points
 * are never double-counted (same guarantee the cron relies on).
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type SyncActionResult =
  | { ok: true; updated: number }
  | { ok: false; error: string };

/**
 * Invokes the sync Edge Function in results mode and returns how many fixtures
 * were written to FT on this run (0 when nothing finished yet or the function's
 * internal guard skipped the ESPN call).
 */
export async function triggerResultsSync(): Promise<SyncActionResult> {
  const supabase = await createServerSupabaseClient();

  // Belt-and-suspenders: the /admin layout guard already enforces admin, but the
  // action is independently callable, so re-check here. Fails closed.
  const isAdmin = await isCurrentUserAdmin(supabase);
  if (!isAdmin) {
    return { ok: false, error: "No tenés permisos para realizar esta acción." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const cronToken = process.env.CRON_TOKEN;

  if (!supabaseUrl || !anonKey || !cronToken) {
    // Misconfiguration, not a user error — surface a friendly message but keep
    // the real cause in the server log for the admin to fix.
    console.error(
      "[admin/sync] missing env: " +
        [
          !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
          !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          !cronToken && "CRON_TOKEN",
        ]
          .filter(Boolean)
          .join(", ")
    );
    return {
      ok: false,
      error: "La actualización no está configurada. Avisá al administrador.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/sync?mode=results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Layer 1: anon-key JWT passes the Supabase gateway (verify_jwt).
        Authorization: `Bearer ${anonKey}`,
        // Layer 2: app-level shared secret the Edge Function compares.
        "x-cron-secret": cronToken,
      },
      body: "{}",
      cache: "no-store",
    });
  } catch (err) {
    console.error("[admin/sync] fetch failed:", err);
    return {
      ok: false,
      error: "No se pudo contactar el servicio de actualización. Probá de nuevo.",
    };
  }

  if (!response.ok) {
    console.error(
      `[admin/sync] edge function returned ${response.status} ${response.statusText}`
    );
    return {
      ok: false,
      error: "La actualización falló. Probá de nuevo en un momento.",
    };
  }

  // Response shapes (sync/index.ts runResults):
  //   { ok, mode, updated: N }                 -> N fixtures written to FT
  //   { ok, mode, updated: 0 }                 -> nothing finished yet
  //   { ok, mode, skipped: true, reason }      -> guard: no pending fixtures
  let updated = 0;
  try {
    const data = (await response.json()) as { updated?: number };
    updated = typeof data.updated === "number" ? data.updated : 0;
  } catch {
    // Non-JSON body on a 200 is unexpected; treat as "nothing updated".
    updated = 0;
  }

  // New FT results change standings/points across the app — refresh cached views.
  if (updated > 0) {
    revalidatePath("/", "layout");
  }

  return { ok: true, updated };
}
