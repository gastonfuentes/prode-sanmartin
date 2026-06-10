/**
 * Unit tests for lib/rounds.ts pure functions.
 *
 * These are TDD-first tests (RED before implementation).
 * RSC data fetching and DB interaction are NOT tested here — only pure logic.
 *
 * Tested functions:
 *   - selectCurrentRound: given a list of rounds + now, return the "current" one.
 *
 * Current-round selection rule (from design ADR-6 + spec REQ-3):
 *   1. Among rounds where now < locks_at (still open): pick the one with the
 *      earliest first_kickoff (the next upcoming round).
 *   2. If all rounds are locked (now >= locks_at for every round): pick the one
 *      with the latest first_kickoff (most recently played, most relevant).
 *   3. If the list is empty: return null.
 *   4. Rounds with null locks_at (no fixtures seeded) are treated as open
 *      (locks_at = null → not yet lockable → treated as far future).
 */

import { describe, it, expect } from "vitest";
import { selectCurrentRound } from "./rounds";

// ── helpers ────────────────────────────────────────────────────────────────

function makeRound(
  id: number,
  firstKickoff: string | null,
  locksAt: string | null
) {
  return {
    id,
    name: `Round ${id}`,
    api_round: `Group Stage - ${id}`,
    first_kickoff: firstKickoff,
    locks_at: locksAt,
    status: "open" as const,
  };
}

const T = "2026-06-15T18:00:00Z"; // reference "now"
const NOW = new Date(T);

// Round helpers relative to NOW:
// Locked = locks_at <= NOW
// Open   = locks_at > NOW
const lockedLocksAt = "2026-06-15T16:00:00Z"; // 2 hours ago
const openLocksAt = "2026-06-16T14:00:00Z"; // tomorrow

// ── selectCurrentRound ──────────────────────────────────────────────────────

describe("selectCurrentRound", () => {
  it("returns null for an empty array", () => {
    expect(selectCurrentRound([], NOW)).toBeNull();
  });

  it("returns the only round when there is one (open)", () => {
    const r1 = makeRound(1, "2026-06-16T15:00:00Z", openLocksAt);
    expect(selectCurrentRound([r1], NOW)).toEqual(r1);
  });

  it("returns the only round when there is one (locked)", () => {
    const r1 = makeRound(1, "2026-06-15T15:00:00Z", lockedLocksAt);
    expect(selectCurrentRound([r1], NOW)).toEqual(r1);
  });

  it("picks the earliest-kickoff open round when multiple are open", () => {
    const r1 = makeRound(1, "2026-06-20T15:00:00Z", "2026-06-20T14:00:00Z");
    const r2 = makeRound(2, "2026-06-17T15:00:00Z", "2026-06-17T14:00:00Z");
    const r3 = makeRound(3, "2026-06-25T15:00:00Z", "2026-06-25T14:00:00Z");
    expect(selectCurrentRound([r1, r2, r3], NOW)).toEqual(r2);
  });

  it("picks the latest-kickoff round when all are locked", () => {
    const r1 = makeRound(1, "2026-06-11T15:00:00Z", "2026-06-11T14:00:00Z");
    const r2 = makeRound(2, "2026-06-13T15:00:00Z", "2026-06-13T14:00:00Z");
    const r3 = makeRound(3, "2026-06-14T15:00:00Z", "2026-06-14T14:00:00Z");
    expect(selectCurrentRound([r1, r2, r3], NOW)).toEqual(r3);
  });

  it("prefers open round over locked round", () => {
    const locked = makeRound(1, "2026-06-14T15:00:00Z", lockedLocksAt);
    const open = makeRound(2, "2026-06-20T15:00:00Z", openLocksAt);
    expect(selectCurrentRound([locked, open], NOW)).toEqual(open);
  });

  it("treats null locks_at as open (no fixtures seeded yet)", () => {
    const r1 = makeRound(1, null, null);
    const r2 = makeRound(2, "2026-06-20T15:00:00Z", openLocksAt);
    // Both open; r2 has an earlier kickoff than r1 (null treated as Infinity)
    expect(selectCurrentRound([r1, r2], NOW)).toEqual(r2);
  });

  it("returns the null-locks_at round if it is the only open one and others are locked", () => {
    const locked = makeRound(1, "2026-06-14T15:00:00Z", lockedLocksAt);
    const unseeded = makeRound(2, null, null);
    expect(selectCurrentRound([locked, unseeded], NOW)).toEqual(unseeded);
  });

  it("order of input array does not affect result (open rounds)", () => {
    const r1 = makeRound(1, "2026-06-25T15:00:00Z", "2026-06-25T14:00:00Z");
    const r2 = makeRound(2, "2026-06-17T15:00:00Z", "2026-06-17T14:00:00Z");
    expect(selectCurrentRound([r1, r2], NOW)).toEqual(r2);
    expect(selectCurrentRound([r2, r1], NOW)).toEqual(r2);
  });

  it("order of input array does not affect result (all locked)", () => {
    const r1 = makeRound(1, "2026-06-11T15:00:00Z", "2026-06-11T14:00:00Z");
    const r3 = makeRound(3, "2026-06-14T15:00:00Z", "2026-06-14T14:00:00Z");
    expect(selectCurrentRound([r1, r3], NOW)).toEqual(r3);
    expect(selectCurrentRound([r3, r1], NOW)).toEqual(r3);
  });

  it("exactly at lock boundary (now === locks_at) the round is locked", () => {
    // locks_at === NOW → isRoundLocked = true → should fall into "all locked" path
    const r1 = makeRound(1, "2026-06-15T19:00:00Z", T); // locks_at === NOW exactly
    expect(selectCurrentRound([r1], NOW)).toEqual(r1); // still returns it (only round)
  });

  it("one locked one exactly-at-boundary: prefers the one with later kickoff", () => {
    const r1 = makeRound(1, "2026-06-11T15:00:00Z", "2026-06-11T14:00:00Z"); // locked long ago
    const r2 = makeRound(2, "2026-06-15T19:00:00Z", T); // locked just now
    // Both locked → latest kickoff wins → r2
    expect(selectCurrentRound([r1, r2], NOW)).toEqual(r2);
  });
});
