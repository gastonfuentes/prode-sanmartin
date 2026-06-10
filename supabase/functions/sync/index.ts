/**
 * Edge Function: sync
 *
 * Two modes triggered via query param or JSON body:
 *   ?mode=calendar  — fetch the full group-stage schedule (once per day, seeds fixtures)
 *   ?mode=results   — fetch current matches, write FT results (triggers scoring)
 *
 * Authorization (two independent layers):
 *   1. Supabase gateway (verify_jwt): the caller passes a valid JWT — the project
 *      anon key — in the `Authorization: Bearer` header. pg_cron reads it from
 *      Supabase Vault (name 'anon_key').
 *   2. App-level: the caller passes the shared secret in the `x-cron-secret` header.
 *      The secret is set as an Edge secret (`supabase secrets set CRON_TOKEN=<value>`,
 *      read here via Deno.env) AND stored in Vault as 'cron_token' (read by pg_cron).
 *      The two values MUST match. We compare x-cron-secret, NOT the Authorization
 *      header, so the gateway's JWT check and our app check stay independent.
 *
 * Data source: ESPN unofficial API (no key required).
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *
 * Pure mapping logic (assignMatchdays, mapToFixtureRows, filterCompleted) lives in
 * ./espn.ts (no Deno-only imports) — co-located so the Supabase bundler uploads it,
 * and unit-tested with Vitest (see espn.test.ts).
 *
 * NOT unit-tested (Deno glue rationale):
 *   This file contains Deno.serve, fetch, and @supabase/supabase-js writes — all
 *   require a running Deno runtime and a live Supabase connection. Mocking them in
 *   Vitest would not test the actual I/O contract and would be maintenance burden
 *   for a 2-day MVP. The pure mapping logic (the only non-trivial logic) IS tested.
 *   Integration verification: deploy → invoke manually → check DB rows.
 */

// Deno / edge-runtime std imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assignMatchdays,
  filterCompleted,
  mapToFixtureRows,
  type EspnEvent,
  type EspnScoreboardResponse,
} from "./espn.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

/** WC 2026 group stage date range (inclusive). */
const WC_DATE_RANGE = "20260611-20260628";

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── Auth: verify the shared cron secret (x-cron-secret header) ──────────────
  // The Supabase gateway already validated the Authorization JWT (anon key) before
  // this code runs. Here we enforce the app-level secret independently, so a leaked
  // anon key alone cannot trigger a sync.
  const cronToken = Deno.env.get("CRON_TOKEN");
  if (!cronToken) {
    return new Response("CRON_TOKEN secret not configured", { status: 500 });
  }

  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided !== cronToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Parse mode ─────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  let mode = url.searchParams.get("mode");

  if (!mode && req.method === "POST") {
    try {
      const body = await req.json();
      mode = body?.mode ?? null;
    } catch {
      // not JSON — fall through to default
    }
  }

  if (mode !== "calendar" && mode !== "results") {
    return new Response('mode must be "calendar" or "results"', {
      status: 400,
    });
  }

  // ── Supabase client (service role — bypasses RLS for sync writes) ──────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    if (mode === "calendar") {
      return await runCalendar(supabase);
    } else {
      return await runResults(supabase);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] unhandled error:", message);
    return new Response(`Internal error: ${message}`, { status: 500 });
  }
});

// ─── Calendar mode ────────────────────────────────────────────────────────────

/**
 * Calendar mode: fetch the full WC 2026 group stage schedule in one API call,
 * derive matchdays, upsert rounds + fixtures, then recompute each round's
 * first_kickoff (which triggers locks_at via the set_round_locks_at DB trigger).
 *
 * Idempotent: upserts use ON CONFLICT DO UPDATE so re-running is safe.
 */
async function runCalendar(
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const events = await fetchEspnEvents(WC_DATE_RANGE);
  const matchdays = assignMatchdays(events);
  const { fixtures, rounds } = mapToFixtureRows(events, matchdays);

  // 1. Upsert rounds (api_round is the unique key)
  const { error: roundsError } = await supabase.from("rounds").upsert(
    rounds,
    { onConflict: "api_round", ignoreDuplicates: false }
  );
  if (roundsError) throw new Error(`rounds upsert: ${roundsError.message}`);

  // 2. Fetch round id → matchday mapping
  const { data: roundRows, error: roundFetchError } = await supabase
    .from("rounds")
    .select("id, api_round")
    .in(
      "api_round",
      rounds.map((r) => r.api_round)
    );
  if (roundFetchError)
    throw new Error(`rounds fetch: ${roundFetchError.message}`);

  const roundIdByMatchday = new Map<number, number>();
  for (const row of roundRows ?? []) {
    const md = parseInt(row.api_round.replace("Matchday ", ""), 10);
    roundIdByMatchday.set(md, row.id);
  }

  // 3. Build fixture rows with resolved round_id
  const fixtureRowsWithRound = fixtures
    .map((f) => {
      const roundId = roundIdByMatchday.get(f.matchday);
      if (!roundId) return null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { matchday: _matchday, ...rest } = f;
      return { ...rest, round_id: roundId };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // 4. Upsert fixtures (id = ESPN event id, natural PK)
  const { error: fixturesError } = await supabase.from("fixtures").upsert(
    fixtureRowsWithRound,
    { onConflict: "id", ignoreDuplicates: false }
  );
  if (fixturesError)
    throw new Error(`fixtures upsert: ${fixturesError.message}`);

  // 5. Recompute first_kickoff for each round.
  //    The set_round_locks_at trigger fires automatically when first_kickoff changes.
  for (const round of roundRows ?? []) {
    const { error: kickoffError } = await supabase.rpc(
      "update_round_first_kickoff",
      { p_round_id: round.id }
    );
    // If the RPC doesn't exist yet, fall back to a raw SQL approach via the
    // fixtures table. In practice the migration adds this function; log and continue.
    if (kickoffError) {
      console.warn(
        `[sync] update_round_first_kickoff RPC failed for round ${round.id}: ${kickoffError.message}`
      );
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      mode: "calendar",
      events: events.length,
      fixtures: fixtureRowsWithRound.length,
      rounds: roundRows?.length ?? 0,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// ─── Results mode ─────────────────────────────────────────────────────────────

/**
 * Results mode: fetch today's matches from ESPN (filter to recent dates),
 * keep only completed===true events, write goals + FT status.
 *
 * The score_fixture DB trigger fires on each UPDATE and re-scores predictions.
 * Running this multiple times for the same FT fixture is idempotent:
 *   - UPSERT with same goals_home/goals_away/status writes the same values.
 *   - score_fixture only triggers when OLD.status IS DISTINCT FROM 'FT',
 *     so points are not double-counted on repeat runs.
 *
 * Guard: skip the ESPN call entirely when there are no non-FT fixtures whose
 * kickoff was > 100 minutes ago (match likely finished). This avoids burning
 * API calls on match-free days.
 */
async function runResults(
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  // Guard: check if there are any non-FT fixtures that could have finished
  const cutoff = new Date(Date.now() - 100 * 60 * 1000).toISOString();
  const { data: pendingFixtures, error: pendingError } = await supabase
    .from("fixtures")
    .select("id")
    .neq("status", "FT")
    .lt("kickoff", cutoff)
    .limit(1);

  if (pendingError) {
    console.warn("[sync] guard query failed:", pendingError.message);
    // Don't abort — proceed with the API call anyway on guard failure
  } else if (!pendingFixtures || pendingFixtures.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, mode: "results", skipped: true, reason: "no pending fixtures" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch today + yesterday to catch late finishes (use a 2-day window)
  const todayStr = formatDateForEspn(new Date());
  const yesterdayStr = formatDateForEspn(
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
  const dateRange = `${yesterdayStr}-${todayStr}`;

  const events = await fetchEspnEvents(dateRange);
  const completed = filterCompleted(events);

  if (completed.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, mode: "results", updated: 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Build update rows: only set goals + FT status
  const updates = completed.map((ev) => {
    const comp = ev.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    return {
      id: parseInt(ev.id, 10),
      goals_home: parseInt(home?.score ?? "0", 10),
      goals_away: parseInt(away?.score ?? "0", 10),
      status: "FT" as const,
    };
  });

  // Upsert: only updates rows that already exist (from calendar mode).
  // ignoreDuplicates:false → ON CONFLICT DO UPDATE → idempotent.
  const { error: updateError } = await supabase
    .from("fixtures")
    .upsert(updates, { onConflict: "id", ignoreDuplicates: false });

  if (updateError) throw new Error(`results upsert: ${updateError.message}`);

  return new Response(
    JSON.stringify({ ok: true, mode: "results", updated: updates.length }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch ESPN scoreboard events for a date range like "20260611-20260628". */
async function fetchEspnEvents(dates: string): Promise<EspnEvent[]> {
  const res = await fetch(`${ESPN_BASE}?dates=${dates}`);
  if (!res.ok) {
    throw new Error(`ESPN API error: ${res.status} ${res.statusText}`);
  }
  const data: EspnScoreboardResponse = await res.json();
  return data.events ?? [];
}

/** Format a Date as YYYYMMDD for the ESPN dates param. */
function formatDateForEspn(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
