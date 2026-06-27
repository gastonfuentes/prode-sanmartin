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
  buildTeamGroupMap,
  dropStrayKnockout,
  filterCompleted,
  mapKnockoutFixtureRows,
  mapToFixtureRows,
  partitionByStage,
  type EspnEvent,
  type EspnScoreboardResponse,
  type EspnStandingsResponse,
} from "./espn.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const ESPN_STANDINGS =
  "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";

/** WC 2026 full tournament date range (inclusive): group stage (Jun 11–27) plus
 *  the knockout stage through the final (~Jul 19). Fetched in chunked windows
 *  (see fetchEspnCalendar) so a single large range cannot exceed any ESPN cap. */
const WC_CALENDAR_START = "20260611";
const WC_CALENDAR_END = "20260719";
/** Max span per ESPN scoreboard call when chunking the calendar window. */
const WC_CALENDAR_WINDOW_DAYS = 10;

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
 * Calendar mode: fetch the full WC 2026 schedule (group + knockout) in chunked
 * windows, split it by stage, derive group matchdays / knockout rounds, upsert
 * rounds + fixtures, then recompute each round's first_kickoff (which triggers
 * locks_at via the set_round_locks_at DB trigger).
 *
 * Knockout specifics:
 *   - Round key is the ESPN season slug ("round-of-32", …); rounds carry
 *     stage = 'knockout'.
 *   - teams_decided is computed from the 48 World Cup nation ids. It is MONOTONIC:
 *     we never downgrade an already-decided match to undecided (a knockout match's
 *     teams never un-resolve, and it protects against a degraded standings fetch).
 *   - fixtures.locks_at is set by the set_fixture_locks_at DB trigger on upsert.
 *
 * Idempotent: upserts use ON CONFLICT DO UPDATE so re-running is safe. As ESPN
 * resolves a bracket, the next run flips placeholder teams to real nations and
 * teams_decided false → true.
 */
async function runCalendar(
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  // Fetch scoreboard (fixtures) and standings (group labels) in parallel
  const [events, standingsData] = await Promise.all([
    fetchEspnCalendar(),
    fetchEspnStandings(),
  ]);

  // Build group map (teamId → groupName) — best-effort; falls back to empty map.
  // Its keys are the 48 WC nation ids, used to decide knockout teams.
  const groupMap = standingsData ? buildTeamGroupMap(standingsData) : new Map<string, string>();
  const countrySet = new Set<string>(groupMap.keys());

  // Split by stage BEFORE assignMatchdays (which is group-stage-only logic).
  const { group: rawGroupEvents, knockout: knockoutEvents } = partitionByStage(events);

  // Fail-safe: a knockout event whose ESPN season.slug is missing/renamed would
  // fall into the group bucket and become an immediately bettable group fixture.
  // Drop any group-classified event in the knockout window so it fails safe.
  const { group: groupEvents, dropped: strayKnockout } = dropStrayKnockout(rawGroupEvents);
  for (const ev of strayKnockout) {
    console.warn(
      `[sync] event ${ev.id} classified group but kickoff ${ev.date} is in the knockout window (missing/renamed season.slug?) — skipping to avoid a bogus immediately-bettable group match`
    );
  }

  const matchdays = assignMatchdays(groupEvents);
  const groupMapped = mapToFixtureRows(groupEvents, matchdays, groupMap);
  const knockoutMapped = mapKnockoutFixtureRows(knockoutEvents, countrySet);

  const rounds = [...groupMapped.rounds, ...knockoutMapped.rounds];
  const fixtures = [...groupMapped.fixtures, ...knockoutMapped.fixtures];

  // 1. Upsert rounds (api_round is the unique key; only api_round/name/stage are
  //    written, so admin is_active and first_kickoff/locks_at are left intact)
  const { error: roundsError } = await supabase.from("rounds").upsert(
    rounds,
    { onConflict: "api_round", ignoreDuplicates: false }
  );
  if (roundsError) throw new Error(`rounds upsert: ${roundsError.message}`);

  // 2. Resolve round_id by api_round (unified for group "Matchday N" and KO slugs)
  const { data: roundRows, error: roundFetchError } = await supabase
    .from("rounds")
    .select("id, api_round")
    .in(
      "api_round",
      rounds.map((r) => r.api_round)
    );
  if (roundFetchError)
    throw new Error(`rounds fetch: ${roundFetchError.message}`);

  const roundIdByApiRound = new Map<string, number>();
  for (const row of roundRows ?? []) {
    roundIdByApiRound.set(row.api_round as string, row.id as number);
  }

  // 3. Monotonic teams_decided: read existing values for knockout fixtures so a
  //    degraded standings fetch (or any false recompute) can never downgrade a
  //    match that was already decided.
  const knockoutIds = knockoutMapped.fixtures.map((f) => f.id);
  const existingDecided = new Map<number, boolean>();
  if (knockoutIds.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from("fixtures")
      .select("id, teams_decided")
      .in("id", knockoutIds);
    if (existingError) {
      console.warn(
        `[sync] existing teams_decided fetch failed: ${existingError.message}`
      );
    } else {
      for (const row of existing ?? []) {
        existingDecided.set(row.id as number, row.teams_decided as boolean);
      }
    }
  }

  // 4. Build DB fixture rows with resolved round_id. Explicit columns only —
  //    locks_at is trigger-managed and must not be sent.
  const fixtureRowsWithRound = fixtures
    .map((f) => {
      const round_id = roundIdByApiRound.get(f.api_round);
      if (!round_id) return null;
      const teams_decided = f.teams_decided || (existingDecided.get(f.id) ?? false);
      return {
        id: f.id,
        round_id,
        home_team: f.home_team,
        away_team: f.away_team,
        home_logo: f.home_logo,
        away_logo: f.away_logo,
        kickoff: f.kickoff,
        goals_home: f.goals_home,
        goals_away: f.goals_away,
        status: f.status,
        group_label: f.group_label,
        teams_decided,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // 5. Upsert fixtures (id = ESPN event id, natural PK)
  const { error: fixturesError } = await supabase.from("fixtures").upsert(
    fixtureRowsWithRound,
    { onConflict: "id", ignoreDuplicates: false }
  );
  if (fixturesError)
    throw new Error(`fixtures upsert: ${fixturesError.message}`);

  // 6. Recompute first_kickoff for each round.
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
      knockout_fixtures: knockoutMapped.fixtures.length,
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

  // Results mode must UPDATE existing fixtures — NEVER upsert. supabase-js
  // `upsert` emits INSERT ... ON CONFLICT DO UPDATE, whose candidate INSERT row
  // omits round_id (NOT NULL). Postgres validates NOT NULL on that candidate
  // tuple BEFORE the ON CONFLICT arbiter can route to DO UPDATE, so a partial-
  // column upsert throws `null value in column "round_id"` EVEN WHEN the row
  // already exists. (Confirmed empirically in prod: filtering the ids to only
  // the existing ones still 500'd.) A targeted UPDATE never forms that candidate
  // tuple, so round_id is never written and never at risk.
  //
  // Per-row UPDATE keyed on the ESPN id. `.neq("status", "FT")` keeps the run
  // idempotent and the count honest (already-FT rows match zero rows, so they
  // are not rewritten and not counted), and a completed event whose id was never
  // seeded (e.g. an ESPN event outside our group stage) simply matches nothing —
  // no error, no insert. Per-row errors are collected so one bad row cannot
  // strand the rest; we throw once at the end if any failed.
  let updated = 0;
  const failures: string[] = [];

  for (const u of updates) {
    const { data, error } = await supabase
      .from("fixtures")
      .update({
        goals_home: u.goals_home,
        goals_away: u.goals_away,
        status: u.status,
      })
      .eq("id", u.id)
      .neq("status", "FT")
      .select("id");

    if (error) {
      failures.push(`${u.id}: ${error.message}`);
      continue;
    }
    updated += data?.length ?? 0;
  }

  if (failures.length > 0) {
    throw new Error(`results update: ${failures.join("; ")}`);
  }

  return new Response(
    JSON.stringify({ ok: true, mode: "results", updated }),
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

/**
 * Build inclusive "YYYYMMDD-YYYYMMDD" windows of at most `windowDays` days each,
 * spanning [startYMD, endYMD]. Used to chunk the calendar fetch so a single very
 * wide range can never exceed an ESPN scoreboard cap.
 */
function buildDateWindows(
  startYMD: string,
  endYMD: string,
  windowDays: number
): string[] {
  const parse = (s: string) =>
    new Date(
      Date.UTC(
        parseInt(s.slice(0, 4), 10),
        parseInt(s.slice(4, 6), 10) - 1,
        parseInt(s.slice(6, 8), 10)
      )
    );
  const addDays = (d: Date, n: number) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

  const end = parse(endYMD);
  const windows: string[] = [];
  let cursor = parse(startYMD);

  while (cursor <= end) {
    const winEnd = addDays(cursor, windowDays - 1);
    const clampedEnd = winEnd > end ? end : winEnd;
    windows.push(`${formatDateForEspn(cursor)}-${formatDateForEspn(clampedEnd)}`);
    cursor = addDays(clampedEnd, 1);
  }
  return windows;
}

/**
 * Fetch the entire WC 2026 calendar (group + knockout) in chunked windows and
 * dedupe events by id. Sequential to stay polite to the unofficial ESPN API.
 */
async function fetchEspnCalendar(): Promise<EspnEvent[]> {
  const windows = buildDateWindows(
    WC_CALENDAR_START,
    WC_CALENDAR_END,
    WC_CALENDAR_WINDOW_DAYS
  );
  const byId = new Map<string, EspnEvent>();
  for (const window of windows) {
    const events = await fetchEspnEvents(window);
    for (const ev of events) byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

/**
 * Fetch ESPN WC 2026 standings to build the teamId → groupName map.
 * Returns null on any error so calendar mode degrades gracefully
 * (group_label stays null; logos + fixture data are unaffected).
 */
async function fetchEspnStandings(): Promise<EspnStandingsResponse | null> {
  try {
    const res = await fetch(ESPN_STANDINGS);
    if (!res.ok) {
      console.warn(`[sync] standings fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }
    return (await res.json()) as EspnStandingsResponse;
  } catch (err) {
    console.warn("[sync] standings fetch error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Format a Date as YYYYMMDD for the ESPN dates param. */
function formatDateForEspn(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
