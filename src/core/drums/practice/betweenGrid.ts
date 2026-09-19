/**
 * The "between grid" band (roadmap DR-07 between-grid, DR-08/DR-11).
 *
 * `plan.ts` caps the match window at half a subdivision (`windowMs = min(
 * toleranceMs, subdivisionMs / 2)`), so on any pad whose grid cell is wider
 * than twice the tolerance — an eighth-note hi-hat under ~150 bpm, a quarter
 * on the money beat, the reading trainer's level-1 half-note/whole-bar grids
 * — there is a band of offsets that sits beyond the strict window but still
 * closer to the instant it answers than to the next grid step. A learner who
 * lands there consistently is neither matched nor a whole-step slip: every
 * `gradeGrooveRun`/`runSlipSteps` verdict reads them as "missed, extra", and
 * the generic "every stroke landed outside its window" sentence tells them
 * the PATTERN is wrong, when really the pattern and the entry are both
 * right — the hands are simply sitting late (or early) by less than a grid
 * step. This module names that band, for one pad's own strokes.
 *
 * Split out of `grade.ts` (which is at its own line budget) rather than
 * inlined there.
 */
import { pair, SLIP_COVERAGE } from './matchCount.ts'

/** The fewest strokes a between-grid band can be named from. Below this, "most of your strokes" would be a guess dressed as a diagnosis. */
export const BETWEEN_GRID_MIN_STROKES = 2

export type LooseOffset = {
  /** Mean of the offending offsets. Positive means late, negative means early. */
  readonly meanOffsetMs: number
  /** How many strokes `meanOffsetMs` was computed over. */
  readonly strokes: number
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Names a pad's own between-grid band, or `undefined` when there is no band
 * to name — either because the strict window already covers half the grid
 * cell (nothing can be "between"), or because too few of this pad's strokes
 * actually sit in the band to call it a pattern.
 *
 * `cellMs` is `plan.ts`'s `nominalSubdivisionMs` — the plan's own nominal
 * (straight) grid cell — NEVER a swung gap: swing can shrink one instant's
 * neighbouring gap unevenly, and "half the nominal cell" is what stays the
 * widest window that still assigns every stroke to its nearest NOTATED grid
 * position, whatever swing did to the ms in between.
 *
 * ## Why this is only an approximation
 *
 * The strict grade (`pair(expectedMs, hitsMs, windowMs)`, run per pad in
 * `grade.ts`) is a single greedy nearest-first pass. Re-pairing at the wider
 * `cellMs / 2` window here is a SEPARATE pass, and greedy nearest-first
 * matching is not guaranteed to agree stroke-for-stroke with the strict
 * pass's own assignment once the window changes — in principle a hit this
 * wider pass assigns to instant N is one the strict pass would have left
 * unmatched while assigning a different hit to N instead. That is acceptable
 * here because this function only ever feeds a DIAGNOSIS sentence, never a
 * grade: nothing it returns changes `matched`, `missed`, `extra`, `steady`,
 * or any other field a learner's score depends on (see `grade.ts`'s own
 * doc on `GroovePadResult.looseOffsetMs`).
 */
export function padLooseOffset(
  expectedMs: readonly number[],
  hitsMs: readonly number[],
  windowMs: number,
  cellMs: number,
): LooseOffset | undefined {
  if (expectedMs.length === 0 || hitsMs.length === 0) return undefined
  // Half the nominal cell is the widest window that still assigns a stroke
  // to its nearest grid position. If the strict window already reaches that
  // far, there is no band left between "matched" and "next grid step".
  if (cellMs / 2 <= windowMs) return undefined

  const loose = pair(expectedMs, hitsMs, cellMs / 2)

  // Fix (review — was RED-1): checking only the ENDS is not enough. A stroke
  // train sitting further than half a cell late does not always go
  // unmatched at the first instant — nearest-first `pair` still finds a hit
  // for every OTHER instant, just the NEXT one, at an offset of (shift -
  // cellMs), which is negative. When the learner's first stroke happens to
  // land exactly on time (a false "anchor"), that on-time hit keeps
  // `expected[0]` matched even though the cascade among the REMAINING
  // instants still steals from the previous one throughout: money beat at
  // 100 bpm (cellMs 300, windowMs 100), hi-hat's first stroke on the click,
  // the other 15 uniformly +170 — every instant from the second on pairs to
  // the hit that answered the instant BEFORE it, at a uniform -130, BOTH
  // ends land matched (the last instant inherits the cascade same as any
  // other), and the ends-only check used to read that as "130 ms ahead" when
  // the truth is 170 ms behind. The gap the cascade actually leaves is
  // interior — the second instant has no hit within `cellMs / 2` of itself
  // (its own hit is stolen by nothing; it simply has nowhere to land) — and
  // an ends-only check never looks there.
  //
  // The complete rule: a train read one grid step off necessarily leaves
  // EITHER an unmatched instant somewhere (a stolen or dropped stroke,
  // re-attributed to a neighbour — interior or end, doesn't matter which)
  // OR a hit that overhangs the span (an extra stroke with nowhere honest to
  // land within half a cell of either end). A stream with neither is
  // indistinguishable from the closer reading, so the closer reading is the
  // honest one: every expected instant must find a loose partner, AND no hit
  // may land outside half a cell of either end.
  //
  // (This is also conservative about a genuinely dropped stroke — first,
  // last, OR interior: losing any one stroke now loses the sentence too, not
  // just an end one. A false negative, not a false positive: silence is
  // safer than a diagnosis that could have the sign flipped.)
  if (loose.unmatchedExpected.length > 0) return undefined

  const firstExpected = expectedMs[0]
  const lastExpected = expectedMs[expectedMs.length - 1]
  if (firstExpected === undefined || lastExpected === undefined) return undefined
  const spanLowMs = firstExpected - cellMs / 2
  const spanHighMs = lastExpected + cellMs / 2
  if (hitsMs.some((hit) => hit < spanLowMs || hit > spanHighMs)) return undefined

  // Only the strokes the strict pairing could not have matched — anything
  // inside `windowMs` is already graded as a match, not a between-grid case.
  const between = loose.offsets.filter((offset) => Math.abs(offset.offset) > windowMs)

  const late = between.filter((offset) => offset.offset > 0)
  const early = between.filter((offset) => offset.offset < 0)
  const side = late.length >= early.length ? late : early

  if (side.length < BETWEEN_GRID_MIN_STROKES) return undefined
  if (side.length < Math.ceil(SLIP_COVERAGE * expectedMs.length)) return undefined
  // AMBER-a (review): coverage of what was NOTATED is not enough on its own
  // — a couple of on-band strokes buried in a pile of wild extra hits still
  // cleared the check above. Also require the band to be most of what was
  // actually PLAYED, so "on most strokes" is true of the hits as well as
  // the instants.
  if (side.length * 2 <= hitsMs.length) return undefined

  return { meanOffsetMs: mean(side.map((offset) => offset.offset)), strokes: side.length }
}

/**
 * The number a between-grid sentence prints for `|ms|`, in whole tens, never
 * smaller than what would make "outside the `windowMs` ms window" read as
 * self-contradicting (AMBER-b: a raw 101 ms rounds to "100", which then
 * reads as inside a 100 ms window).
 *
 * Snaps to the nearest ten with a small float tolerance (AMBER-c: at 60 bpm
 * `nominalSubdivisionMs` itself is not an exact multiple of the tick length,
 * so a real +115 ms grade can arrive as `114.99999999999997` — one float
 * epsilon under the x.5 boundary that should round UP to 120 the same way an
 * exact 115 does). The tolerance is added to the ms value itself (not to the
 * quotient) so it only ever rescues a value sitting on that boundary; an
 * ordinary 114.9 still rounds down to 110.
 *
 * Returns the magnitude only — the caller already knows and prints the sign
 * (behind/ahead, late/early).
 */
export function displayOffsetMs(ms: number, windowMs: number): number {
  const roundedTen = Math.round((Math.abs(ms) + 1e-6) / 10) * 10
  return Math.max(roundedTen, Math.round(windowMs) + 10)
}
