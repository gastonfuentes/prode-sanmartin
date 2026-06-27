/**
 * Round route loading skeleton.
 *
 * Next.js renders this INSTANTLY when navigating to /rounds/[id] (App Router
 * streams it while the RSC runs its queries). Without a loading.tsx the previous
 * page stays frozen on screen until every server query resolves — the "tildada"
 * the switcher used to show. This skeleton mirrors page.tsx's grid so the swap
 * to real content lands in place with no layout jump.
 */

function Pill() {
  return <div className="h-8 w-20 shrink-0 rounded-full bg-gray-200" />;
}

function FixtureCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 h-3 w-16 rounded bg-gray-100" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-gray-200" />
          <div className="h-4 w-24 rounded bg-gray-200" />
        </div>
        <div className="h-9 w-20 rounded bg-gray-100" />
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-7 w-7 rounded-full bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start md:gap-x-8">
      {/* Header — nav pills + title */}
      <div className="md:col-start-1 md:row-start-1">
        <div className="-mx-1 mb-4 flex gap-2 overflow-hidden px-1 pb-1">
          <Pill />
          <Pill />
          <Pill />
          <Pill />
          <Pill />
        </div>
        <div className="h-8 w-40 rounded bg-gray-200" />
        <div className="mt-2 h-4 w-64 rounded bg-gray-100" />
      </div>

      {/* Left column — fixture cards */}
      <div className="min-w-0 space-y-3 md:col-start-1 md:row-start-2">
        <FixtureCardSkeleton />
        <FixtureCardSkeleton />
        <FixtureCardSkeleton />
      </div>

      {/* Right panel — Posiciones + Participantes */}
      <aside className="space-y-6 md:col-start-2 md:row-start-2">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <div className="mb-4 h-4 w-24 rounded bg-gray-200" />
          <div className="space-y-2">
            <div className="h-6 w-full rounded bg-gray-100" />
            <div className="h-6 w-full rounded bg-gray-100" />
            <div className="h-6 w-full rounded bg-gray-100" />
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
          <div className="mb-3 h-4 w-28 rounded bg-gray-200" />
          <div className="space-y-2">
            <div className="h-6 w-full rounded bg-gray-100" />
            <div className="h-6 w-full rounded bg-gray-100" />
          </div>
        </div>
      </aside>
    </div>
  );
}
