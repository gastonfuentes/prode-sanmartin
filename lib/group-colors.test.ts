/**
 * Unit tests for lib/group-colors.ts — pure group → appearance mapping.
 *
 * TDD-first (RED before implementation). No DB, no React — just the mapping.
 */

import { describe, it, expect } from "vitest";
import { getGroupAppearance } from "./group-colors";

describe("getGroupAppearance", () => {
  it("returns null for nullish or blank input", () => {
    expect(getGroupAppearance(null)).toBeNull();
    expect(getGroupAppearance(undefined)).toBeNull();
    expect(getGroupAppearance("")).toBeNull();
    expect(getGroupAppearance("   ")).toBeNull();
  });

  it("translates the 'Group X' label to the Spanish 'Grupo X'", () => {
    expect(getGroupAppearance("Group A")?.label).toBe("Grupo A");
    expect(getGroupAppearance("Group L")?.label).toBe("Grupo L");
  });

  it("assigns a distinct palette to each group", () => {
    const a = getGroupAppearance("Group A")!;
    const b = getGroupAppearance("Group B")!;
    expect(a.badge).not.toBe(b.badge);
    expect(a.bar).not.toBe(b.bar);
    expect(a.softBg).not.toBe(b.softBg);
  });

  it("returns full, non-interpolated Tailwind classes (purge-safe)", () => {
    const a = getGroupAppearance("Group A")!;
    expect(a.badge).toContain("bg-indigo-50");
    expect(a.badge).toContain("text-indigo-700");
    expect(a.bar).toBe("border-l-indigo-500");
    expect(a.softBg).toBe("bg-indigo-50/60");
  });

  it("covers all 12 World Cup groups A–L with a non-fallback palette", () => {
    for (const letter of "ABCDEFGHIJKL") {
      const appearance = getGroupAppearance(`Group ${letter}`)!;
      expect(appearance.bar).not.toBe("border-l-gray-300");
      // Each group exposes a soft, very-light tinted background (purge-safe)
      expect(appearance.softBg).toMatch(/^bg-[a-z]+-50\/60$/);
    }
  });

  it("falls back to neutral styling for an unknown group token", () => {
    const z = getGroupAppearance("Group Z")!;
    expect(z.bar).toBe("border-l-gray-300");
    expect(z.label).toBe("Grupo Z");
  });
});
