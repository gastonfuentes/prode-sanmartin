/**
 * Pure builder for the WhatsApp share text of a single fixture.
 *
 * Produces a plain-text block listing every participant's prediction for one
 * match so a user can share it in the WhatsApp group. No React, no DB — the
 * caller passes already-fetched picks (from the round_predictions RPC, which is
 * only populated after the round locks).
 */

export interface SharePick {
  display_name: string | null;
  pred_home: number;
  pred_away: number;
  points: number;
}

export interface SharePredictionsInput {
  homeTeam: string;
  awayTeam: string;
  roundLabel: string;
  isFinished: boolean;
  goalsHome: number | null;
  goalsAway: number | null;
  picks: SharePick[];
}

/**
 * Builds the share message. Picks are rendered in the order received — the
 * caller decides the sort.
 */
export function buildSharePredictionsText({
  homeTeam,
  awayTeam,
  roundLabel,
  isFinished,
  goalsHome,
  goalsAway,
  picks,
}: SharePredictionsInput): string {
  const lines: string[] = [`⚽ ${roundLabel} — ${homeTeam} vs ${awayTeam}`];

  if (isFinished && goalsHome !== null && goalsAway !== null) {
    lines.push(`Resultado: ${goalsHome} - ${goalsAway}`);
  }

  lines.push("Pronósticos:");

  for (const pick of picks) {
    const name = pick.display_name?.trim() || "Sin nombre";
    lines.push(`• ${name}: ${pick.pred_home} - ${pick.pred_away}`);
  }

  return lines.join("\n");
}
