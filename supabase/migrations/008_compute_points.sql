-- Migration: 008_compute_points
-- Pure scoring function: compute_points(ph, pa, gh, ga) (REQ-5.2, REQ-5.3).
--
-- This is the SQL mirror of the TypeScript function computePoints() in
-- lib/scoring.ts (ADR-7). Both implementations MUST be kept in sync.
-- Any change to the scoring logic must be applied to BOTH files.
--
-- Rules:
--   - Exact score (ph = gh AND pa = ga)            → 2 points
--   - Correct outcome only (sign(ph-pa)=sign(gh-ga)) → 1 point
--   - Wrong outcome                                 → 0 points
--
-- sign() collapses the three outcomes elegantly:
--   sign(x) = 1 (home win), 0 (draw), -1 (away win)
--   Exact match implies correct outcome — no double-counting edge case.
--
-- Marked IMMUTABLE: given identical inputs, always returns identical output;
-- no side effects, no table/sequence reads. This allows Postgres to inline
-- the function in queries and use it safely in functional indexes if needed.

create or replace function public.compute_points(
  ph smallint,   -- predicted home goals
  pa smallint,   -- predicted away goals
  gh smallint,   -- actual home goals
  ga smallint    -- actual away goals
)
returns smallint
language sql
immutable
as $$
  select case
    -- Exact score: outcome is automatically correct (REQ-5.3, REQ-5.5)
    when ph = gh and pa = ga then 2::smallint
    -- Correct outcome only (sign of goal difference matches) (REQ-5.2)
    when sign(ph::int - pa::int) = sign(gh::int - ga::int) then 1::smallint
    -- Wrong outcome (REQ-5.4)
    else 0::smallint
  end;
$$;

comment on function public.compute_points(smallint, smallint, smallint, smallint) is
  'Scoring logic: 2=exact score, 1=correct outcome only, 0=wrong outcome. '
  'IMMUTABLE mirror of lib/scoring.ts computePoints(). (REQ-5.2, REQ-5.3, ADR-7)';
