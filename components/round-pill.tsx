/**
 * RoundPill — client pill for the round switcher.
 *
 * Wraps a Next.js <Link> and reads useLinkStatus() (Next 15.3+) so the pill the
 * user just tapped reacts INSTANTLY — it adopts the active (indigo) look and
 * shows a small spinner while the destination round is still loading on the
 * server. Without this, a server round-trip leaves the tapped pill inert for a
 * couple of seconds (the "frozen" feeling).
 *
 * useLinkStatus must run inside the <Link> subtree, hence the inner component.
 * Both visual states keep an equal-width border so toggling never jiggles the
 * pill by 1px.
 */

"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";

interface RoundPillProps {
  id: number;
  label: string;
  isActive: boolean;
}

function PillInner({ label, isActive }: { label: string; isActive: boolean }) {
  const { pending } = useLinkStatus();
  // Highlight when already active OR optimistically while navigating to it.
  const highlighted = isActive || pending;

  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        highlighted
          ? "border-transparent bg-indigo-600 text-white shadow-sm"
          : "border-gray-300 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
      {pending && (
        <svg
          className="h-3 w-3 animate-spin text-white/90"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
    </span>
  );
}

export function RoundPill({ id, label, isActive }: RoundPillProps) {
  return (
    <Link
      href={`/rounds/${id}`}
      aria-current={isActive ? "page" : undefined}
      className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <PillInner label={label} isActive={isActive} />
    </Link>
  );
}
