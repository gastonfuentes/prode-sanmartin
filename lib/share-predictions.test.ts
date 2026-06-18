/**
 * Unit tests for lib/share-predictions.ts — pure WhatsApp share-text builder.
 *
 * TDD-first (RED before implementation). No DB, no React — just the text format.
 * The text lists ALL participants' predictions for a single fixture so a user can
 * share them in the WhatsApp group.
 */

import { describe, it, expect } from "vitest";
import { buildSharePredictionsText } from "./share-predictions";

const basePicks = [
  { display_name: "Ana", pred_home: 1, pred_away: 1, points: 0 },
  { display_name: "Juan", pred_home: 2, pred_away: 1, points: 0 },
];

describe("buildSharePredictionsText", () => {
  it("includes the round label and the matchup in the header", () => {
    const text = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: false,
      goalsHome: null,
      goalsAway: null,
      picks: basePicks,
    });

    expect(text).toContain("Fecha 2");
    expect(text).toContain("Argentina");
    expect(text).toContain("Brasil");
  });

  it("renders one line per participant with their score", () => {
    const text = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: false,
      goalsHome: null,
      goalsAway: null,
      picks: basePicks,
    });

    expect(text).toContain("Ana: 1 - 1");
    expect(text).toContain("Juan: 2 - 1");
  });

  it("preserves the order of the picks it receives", () => {
    const text = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: false,
      goalsHome: null,
      goalsAway: null,
      picks: basePicks,
    });

    expect(text.indexOf("Ana")).toBeLessThan(text.indexOf("Juan"));
  });

  it("includes the final result only when the fixture is finished", () => {
    const pending = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: false,
      goalsHome: null,
      goalsAway: null,
      picks: basePicks,
    });
    expect(pending).not.toContain("Resultado");

    const finished = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: true,
      goalsHome: 2,
      goalsAway: 0,
      picks: basePicks,
    });
    expect(finished).toContain("Resultado: 2 - 0");
  });

  it("falls back to 'Sin nombre' for a null display name", () => {
    const text = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: false,
      goalsHome: null,
      goalsAway: null,
      picks: [{ display_name: null, pred_home: 0, pred_away: 0, points: 0 }],
    });

    expect(text).toContain("Sin nombre: 0 - 0");
  });

  it("handles an empty picks list without throwing", () => {
    const text = buildSharePredictionsText({
      homeTeam: "Argentina",
      awayTeam: "Brasil",
      roundLabel: "Fecha 2",
      isFinished: false,
      goalsHome: null,
      goalsAway: null,
      picks: [],
    });

    expect(typeof text).toBe("string");
    expect(text).toContain("Argentina");
    expect(text).toContain("Brasil");
  });
});
