/**
 * Pure admin-export logic.
 *
 * No DB calls, no Next.js imports — testable with Vitest. Transforms the rows
 * returned by the admin_round_predictions() SECURITY DEFINER RPC into:
 *   1. A CSV document (Excel/Sheets friendly) — buildPredictionsCsv.
 *   2. A single-player, single-round card view model for the PNG export —
 *      buildPlayerCard.
 *
 * Privacy note: the RPC is the gate. It returns rows ONLY for an admin caller
 * and ONLY for locked rounds (now() >= locks_at). This module assumes the rows
 * it receives are already authorized — it does no access control itself.
 */

import { roundLabelFromApiRound } from "./rounds";

// ── AdminPredictionRow ───────────────────────────────────────────────────────

/**
 * One row as returned by the admin_round_predictions() RPC (snake_case to match
 * the Postgres column names). One row per (player, fixture) pair.
 */
export interface AdminPredictionRow {
  round_id: number;
  api_round: string;
  user_id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  fixture_id: number;
  home_team: string;
  away_team: string;
  kickoff: string;
  pred_home: number;
  pred_away: number;
  goals_home: number | null;
  goals_away: number | null;
  points: number;
}

const NO_NAME = "(sin nombre)";

// ── escapeCsvField ───────────────────────────────────────────────────────────

/**
 * Escapes a single CSV field per RFC 4180: fields containing a comma, double
 * quote, CR or LF are wrapped in double quotes, and embedded quotes are doubled.
 * Numbers are stringified as-is (they never need quoting).
 */
export function escapeCsvField(value: string | number): string {
  let s = String(value);
  // Mitigate CSV formula/DDE injection: a cell starting with =, +, -, @ (or a
  // control char) is evaluated as a formula by Excel/Sheets. Prefix with an
  // apostrophe so the value is shown as literal text. (Numbers never match.)
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── formatScore / formatResult ───────────────────────────────────────────────

/** Formats a prediction as "home-away" (both values are always present). */
function formatScore(home: number, away: number): string {
  return `${home}-${away}`;
}

/**
 * Formats the actual match result as "home-away", or "" when the fixture has
 * not finished yet (goals are NULL until FT).
 */
export function formatResult(
  goalsHome: number | null,
  goalsAway: number | null
): string {
  if (goalsHome === null || goalsAway === null) return "";
  return `${goalsHome}-${goalsAway}`;
}

// ── buildPredictionsCsv ──────────────────────────────────────────────────────

const CSV_HEADER = [
  "Fecha",
  "Jugador",
  "Email",
  "Partido",
  "Pronóstico",
  "Resultado",
  "Puntos",
];

/**
 * Builds the full CSV document from RPC rows.
 *
 * - Prepends a UTF-8 BOM (﻿) so Excel renders accents (á, ó, …) correctly.
 * - Uses CRLF line endings (Excel's expectation).
 * - Preserves input row order (the RPC orders by round, player, kickoff).
 *
 * Columns: Fecha | Jugador | Email | Partido | Pronóstico | Resultado | Puntos
 */
export function buildPredictionsCsv(rows: AdminPredictionRow[]): string {
  const lines = [CSV_HEADER.join(",")];

  for (const r of rows) {
    const fields = [
      roundLabelFromApiRound(r.api_round),
      r.display_name ?? NO_NAME,
      r.email,
      `${r.home_team} vs ${r.away_team}`,
      formatScore(r.pred_home, r.pred_away),
      formatResult(r.goals_home, r.goals_away),
      r.points,
    ];
    lines.push(fields.map(escapeCsvField).join(","));
  }

  return "﻿" + lines.join("\r\n");
}

// ── buildPlayerCard ──────────────────────────────────────────────────────────

export interface PlayerCardRow {
  match: string;
  prediction: string;
  result: string;
  points: number;
}

export interface PlayerCardModel {
  playerName: string;
  avatarUrl: string | null;
  roundLabel: string;
  rows: PlayerCardRow[];
  totalPoints: number;
  exactCount: number;
}

/**
 * Builds the view model for one player's PNG card for a single round.
 *
 * Assumes every row belongs to the SAME player and the SAME round — the image
 * route filters the RPC result before calling this. Identity (name, avatar,
 * round label) is taken from the first row. Returns null when there are no rows.
 */
export function buildPlayerCard(
  rows: AdminPredictionRow[]
): PlayerCardModel | null {
  if (rows.length === 0) return null;

  const first = rows[0];
  const cardRows: PlayerCardRow[] = rows.map((r) => ({
    match: `${r.home_team} vs ${r.away_team}`,
    prediction: formatScore(r.pred_home, r.pred_away),
    result: formatResult(r.goals_home, r.goals_away),
    points: r.points,
  }));

  return {
    playerName: first.display_name ?? NO_NAME,
    avatarUrl: first.avatar_url,
    roundLabel: roundLabelFromApiRound(first.api_round),
    rows: cardRows,
    totalPoints: rows.reduce((sum, r) => sum + r.points, 0),
    exactCount: rows.filter((r) => r.points === 2).length,
  };
}
