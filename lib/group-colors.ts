/**
 * Pure group → visual-appearance mapping.
 *
 * Each World Cup group gets its own colour so the fixture list reads as
 * visually grouped: a soft badge (background + text) and a saturated colour
 * for the card's left accent border.
 *
 * IMPORTANT — Tailwind only generates classes it can find as COMPLETE literal
 * strings in the source. Never build these by interpolation (e.g.
 * `bg-${c}-50`) or the build step purges them. That is why every class is
 * spelled out in full below.
 *
 * No DB calls, no React imports — safe to use from both Server and Client
 * Components, and unit-testable in isolation.
 */

export interface GroupAppearance {
  /** Spanish display label, e.g. "Grupo A". */
  label: string;
  /** Tailwind classes for the group badge (background + text colour). */
  badge: string;
  /** Tailwind class for the card's coloured left accent border. */
  bar: string;
}

// Keyed by group letter. The 2026 World Cup has 12 groups (A–L).
const GROUP_APPEARANCE: Record<string, Omit<GroupAppearance, "label">> = {
  A: { badge: "bg-indigo-50 text-indigo-700", bar: "border-l-indigo-500" },
  B: { badge: "bg-emerald-50 text-emerald-700", bar: "border-l-emerald-500" },
  C: { badge: "bg-amber-50 text-amber-700", bar: "border-l-amber-500" },
  D: { badge: "bg-rose-50 text-rose-700", bar: "border-l-rose-500" },
  E: { badge: "bg-sky-50 text-sky-700", bar: "border-l-sky-500" },
  F: { badge: "bg-fuchsia-50 text-fuchsia-700", bar: "border-l-fuchsia-500" },
  G: { badge: "bg-teal-50 text-teal-700", bar: "border-l-teal-500" },
  H: { badge: "bg-orange-50 text-orange-700", bar: "border-l-orange-500" },
  I: { badge: "bg-lime-50 text-lime-700", bar: "border-l-lime-500" },
  J: { badge: "bg-cyan-50 text-cyan-700", bar: "border-l-cyan-500" },
  K: { badge: "bg-violet-50 text-violet-700", bar: "border-l-violet-500" },
  L: { badge: "bg-pink-50 text-pink-700", bar: "border-l-pink-500" },
};

const FALLBACK: Omit<GroupAppearance, "label"> = {
  badge: "bg-gray-100 text-gray-600",
  bar: "border-l-gray-300",
};

/**
 * Resolves the display label + colour classes for a raw `group_label`
 * (API-Football / ESPN format "Group A"). Returns null when there is no group
 * (knockout fixtures or not-yet-synced rows).
 */
export function getGroupAppearance(
  groupLabel: string | null | undefined
): GroupAppearance | null {
  if (!groupLabel) return null;
  const trimmed = groupLabel.trim();
  if (!trimmed) return null;

  // "Group A" → "Grupo A"; leave any non-matching format untouched.
  const label = trimmed.replace(/^group\b\s*/i, "Grupo ");

  // Colour key: last whitespace-separated token, uppercased ("A".."L").
  const key = trimmed.split(/\s+/).pop()!.toUpperCase();
  const palette = GROUP_APPEARANCE[key] ?? FALLBACK;

  return { label, ...palette };
}
