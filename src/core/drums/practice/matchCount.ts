/**
 * Nearest-first matching between notated instants and hit ms (roadmap DR-07
 * tail, review round 2). Split out of `grade.ts` so that module and
 * `padDisplacement.ts` can both depend on this arithmetic without depending
 * on EACH OTHER: before this split, `grade.ts` defined `matchCountAt` and
 * exported it for `padDisplacement.ts` to import, while `grade.ts` itself
 * imported `padDisplacementSteps` from `padDisplacement.ts` — a real import
 * cycle. It never broke (both `pair`/`matchCountAt` and `padDisplacementSteps`
 * are hoisted function declarations, never read at module-evaluation time),
 * but a cycle that only works by accident of hoisting is a trap for the next
 * change, so the shared arithmetic gets its own module instead.
 */

/**
 * One matched (or slip-reassigned) stroke: the notated instant it answers,
 * and how far off the hit landed. Carrying `instant` alongside `offset` — not
 * just the bare number — is what lets a pad's offsets be put back into
 * instant order after `grade.ts`'s articulation-slip pass has appended some
 * out of order (see `applyArticulationSlips` and `sortedOffsets` there).
 */
export type OffsetSample = {
  readonly instant: number
  readonly offset: number
  /**
   * DR-07 tail: index of `instant` in the `expected` array `pair()` was
   * called with. Lets a caller (e.g. `grade.ts`'s dynamics wiring) look a
   * matched hit's own data (velocity, notated dynamics) back up by position,
   * without re-pairing.
   */
  readonly expectedIndex: number
  /**
   * DR-07 tail: index of the matched hit in the `hits` array `pair()` was
   * called with. Exact (integer) — deliberately not reconstructed from
   * `instant + offset`, since float round-trip is not guaranteed bit-exact.
   */
  readonly hitIndex: number
}

/**
 * How many subdivisions either side `runSlipSteps`/`padDisplacementSteps`
 * will look for a displaced pattern. Lives here (review round 3, item 2),
 * not in `grade.ts`, alongside `SLIP_COVERAGE`: `grade.ts` re-exports both so
 * existing importers are unaffected, and `padDisplacement.ts` imports them
 * from here directly instead of from `grade.ts` — the point of the whole
 * move, since a value import from `grade.ts` would put the import cycle
 * `matchCount.ts` was created to remove right back in a different shape.
 */
export const MAX_SLIP_STEPS = 4

/**
 * A displacement is only claimed if it explains this much of what it is
 * asked about — the whole run for `grade.ts`'s `runSlipSteps`, one pad's own
 * expected instants (scaled, floored at 2) for `padDisplacement.ts`'s
 * `padDisplacementSteps`. One shared number, so the two never drift apart.
 */
export const SLIP_COVERAGE = 0.75

export type Pairing = {
  readonly offsets: readonly OffsetSample[]
  readonly matched: number
  /** `expected` instants that found no hit within `windowMs`, in input order. */
  readonly unmatchedExpected: readonly number[]
  /** `hits` that were not claimed by any instant, in input order. */
  readonly unmatchedHits: readonly number[]
}

/**
 * Nearest-first assignment of `hits` to `expected` inside `windowMs`. Optimal
 * because `plan.ts` caps the window at half a subdivision, so no two notated
 * instants for one pad have overlapping windows — a hit falls inside at most
 * one instant's window, and greedy nearest-first assignment is the correct
 * (not just convenient) matching. Also reports what was left over on each
 * side, which `grade.ts`'s articulation-slip pass re-pairs across a sibling
 * pad.
 */
export function pair(expected: readonly number[], hits: readonly number[], windowMs: number): Pairing {
  const taken = new Array<boolean>(hits.length).fill(false)
  const offsets: OffsetSample[] = []
  const unmatchedExpected: number[] = []
  // `expected` is time-ordered, so a hit equidistant between two adjacent
  // instants is claimed by whichever instant is processed first: the earlier one.
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex++) {
    const instant = expected[expectedIndex]
    if (instant === undefined) continue
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < hits.length; i++) {
      if (taken[i] === true) continue
      const hit = hits[i]
      if (hit === undefined) continue
      const distance = Math.abs(hit - instant)
      if (distance > windowMs) continue
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    if (bestIndex < 0) {
      unmatchedExpected.push(instant)
      continue
    }
    taken[bestIndex] = true
    offsets.push({ instant, offset: (hits[bestIndex] ?? 0) - instant, expectedIndex, hitIndex: bestIndex })
  }
  const unmatchedHits = hits.filter((_, i) => taken[i] !== true)
  return { offsets, matched: offsets.length, unmatchedExpected, unmatchedHits }
}

/**
 * How many of (already-shifted) `expected` find a hit. Counting only — no
 * assignment kept. Used by `grade.ts`'s `runSlipSteps` (whole-pattern
 * displacement) and `padDisplacement.ts`'s `padDisplacementSteps` (per-pad
 * displacement) — the same question, asked over a different scope each time.
 */
export function matchCountAt(expected: readonly number[], hits: readonly number[], windowMs: number): number {
  return pair(expected, hits, windowMs).matched
}
