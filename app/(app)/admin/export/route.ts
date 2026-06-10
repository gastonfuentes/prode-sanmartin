/**
 * CSV export route handler — GET /admin/export[?round=<id>].
 *
 * Returns a CSV of all participants' predictions:
 *   - no `round` param → every locked round (full audit export)
 *   - `round=<id>`     → that round only (still must be locked)
 *
 * Route handlers do NOT inherit the /admin layout guard, so admin status is
 * re-checked here. Data comes from admin_round_predictions(), which itself
 * gates on is_admin() AND post-lock at the DB layer — this is defense in depth.
 */

import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/supabase/admin";
import { buildPredictionsCsv, type AdminPredictionRow } from "@/lib/admin-export";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCurrentUserAdmin(supabase))) {
    return new Response("Forbidden", { status: 403 });
  }

  const roundParam = request.nextUrl.searchParams.get("round");
  let pRoundId: number | null = null;
  if (roundParam !== null) {
    pRoundId = Number(roundParam);
    if (!Number.isFinite(pRoundId) || pRoundId <= 0) {
      return new Response("Bad request", { status: 400 });
    }
  }

  const { data, error } = await supabase.rpc("admin_round_predictions", {
    p_round_id: pRoundId,
  });
  if (error) {
    return new Response("Error generating export", { status: 500 });
  }

  const csv = buildPredictionsCsv((data ?? []) as AdminPredictionRow[]);
  // Use the validated numeric value (not the raw query string) in the header.
  const filename =
    pRoundId !== null ? `apuestas-fecha-${pRoundId}.csv` : "apuestas-todas.csv";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
