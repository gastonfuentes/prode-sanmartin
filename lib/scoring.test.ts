import { describe, it, expect } from "vitest";
import { outcome, computePoints, computeLocksAt, isRoundLocked } from "./scoring";

// ─── outcome ────────────────────────────────────────────────────────────────

describe("outcome", () => {
  it("returns HOME when home goals > away goals", () => {
    expect(outcome(3, 1)).toBe("HOME");
  });

  it("returns HOME for 1-0", () => {
    expect(outcome(1, 0)).toBe("HOME");
  });

  it("returns DRAW when home goals === away goals", () => {
    expect(outcome(0, 0)).toBe("DRAW");
  });

  it("returns DRAW for 1-1", () => {
    expect(outcome(1, 1)).toBe("DRAW");
  });

  it("returns DRAW for 2-2", () => {
    expect(outcome(2, 2)).toBe("DRAW");
  });

  it("returns AWAY when home goals < away goals", () => {
    expect(outcome(0, 2)).toBe("AWAY");
  });

  it("returns AWAY for 1-3", () => {
    expect(outcome(1, 3)).toBe("AWAY");
  });
});

// ─── computePoints ──────────────────────────────────────────────────────────

describe("computePoints", () => {
  // REQ-5.3: exact score = 2 pts
  it("returns 2 for exact home-win score match", () => {
    expect(computePoints(2, 1, 2, 1)).toBe(2);
  });

  it("returns 2 for exact draw prediction (1-1)", () => {
    expect(computePoints(1, 1, 1, 1)).toBe(2);
  });

  it("returns 2 for exact 0-0 prediction", () => {
    expect(computePoints(0, 0, 0, 0)).toBe(2);
  });

  it("returns 2 for exact away-win score match", () => {
    expect(computePoints(0, 2, 0, 2)).toBe(2);
  });

  // REQ-5.2: correct outcome only = 1 pt
  it("returns 1 for correct home-win outcome but wrong score", () => {
    // predicted 1-0, actual 3-0 → both home wins
    expect(computePoints(1, 0, 3, 0)).toBe(1);
  });

  it("returns 1 for correct draw outcome but wrong score", () => {
    // predicted 0-0, actual 1-1 → both draws
    expect(computePoints(0, 0, 1, 1)).toBe(1);
  });

  it("returns 1 for correct away-win outcome but wrong score", () => {
    // predicted 0-1, actual 0-3 → both away wins
    expect(computePoints(0, 1, 0, 3)).toBe(1);
  });

  // REQ-5.4: wrong outcome = 0 pts
  it("returns 0 for wrong outcome (predicted home win, actual away win)", () => {
    expect(computePoints(2, 0, 0, 1)).toBe(0);
  });

  it("returns 0 for wrong outcome (predicted draw, actual home win)", () => {
    expect(computePoints(1, 1, 2, 0)).toBe(0);
  });

  it("returns 0 for wrong outcome (predicted away win, actual home win)", () => {
    expect(computePoints(0, 1, 2, 0)).toBe(0);
  });

  // spec scenario: correct outcome only — away win, score wrong
  it("returns 1 for correct away-win outcome — spec scenario", () => {
    // predicted away=2, actual away=2 home=0 (away win, different home score from 1 pred)
    expect(computePoints(1, 2, 0, 2)).toBe(1);
  });
});

// ─── computeLocksAt ─────────────────────────────────────────────────────────

describe("computeLocksAt", () => {
  it("returns firstKickoff minus 10 minutes", () => {
    const kickoff = new Date("2026-06-15T18:00:00Z");
    const expected = new Date("2026-06-15T17:50:00Z");
    expect(computeLocksAt(kickoff)).toEqual(expected);
  });

  it("result is exactly firstKickoff - 600000 ms", () => {
    const kickoff = new Date("2026-06-20T21:00:00Z");
    const locksAt = computeLocksAt(kickoff);
    expect(locksAt.getTime()).toBe(kickoff.getTime() - 600_000);
  });

  it("does not mutate the input Date", () => {
    const kickoff = new Date("2026-06-15T18:00:00Z");
    const originalTime = kickoff.getTime();
    computeLocksAt(kickoff);
    expect(kickoff.getTime()).toBe(originalTime);
  });

  it("handles a midnight boundary (00:00 UTC)", () => {
    const kickoff = new Date("2026-06-16T00:05:00Z");
    const expected = new Date("2026-06-15T23:55:00Z");
    expect(computeLocksAt(kickoff)).toEqual(expected);
  });

  it("handles a DST-adjacent timestamp (UTC is always consistent)", () => {
    // Using UTC timestamps so DST doesn't apply — computeLocksAt works in ms
    const kickoff = new Date("2026-03-29T15:00:00Z"); // DST change day in Europe
    const locksAt = computeLocksAt(kickoff);
    expect(locksAt.getTime()).toBe(kickoff.getTime() - 600_000);
  });
});

// ─── isRoundLocked ──────────────────────────────────────────────────────────

describe("isRoundLocked", () => {
  const locksAt = new Date("2026-06-15T17:00:00Z");

  // REQ-3.2: before lock → open
  it("returns false when now is 1 second before locksAt", () => {
    const now = new Date(locksAt.getTime() - 1000);
    expect(isRoundLocked(now, locksAt)).toBe(false);
  });

  it("returns false when now is 90 minutes before locksAt", () => {
    const now = new Date(locksAt.getTime() - 90 * 60 * 1000);
    expect(isRoundLocked(now, locksAt)).toBe(false);
  });

  // REQ-3.3: at lock boundary → CLOSED (T-60 is CLOSED confirmed)
  it("returns true when now is exactly equal to locksAt", () => {
    expect(isRoundLocked(locksAt, locksAt)).toBe(true);
  });

  // REQ-3.3: after lock → closed
  it("returns true when now is 1 second after locksAt", () => {
    const now = new Date(locksAt.getTime() + 1000);
    expect(isRoundLocked(now, locksAt)).toBe(true);
  });

  it("returns true when now is well past locksAt (during match)", () => {
    const now = new Date(locksAt.getTime() + 3 * 60 * 60 * 1000);
    expect(isRoundLocked(now, locksAt)).toBe(true);
  });
});
