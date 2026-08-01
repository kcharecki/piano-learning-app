/**
 * Inverse of `measureRange` (score.ts): given a tick range, which measures it
 * covers. Split into its own file because `score.ts` sits at the eslint
 * `max-lines` cap (500) — see the roadmap 2.11 task notes.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import type { Measure, Score } from '@core/notation/score.ts'
import type { Ticks } from '@core/shared/units.ts'

/** Greatest measure index whose `startTick <= tick`, clamped into `[0, measures.length - 1]`. */
function clampedMeasureIndex(measures: readonly Measure[], tick: number): number {
  let lo = 0
  let hi = measures.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (at(measures, mid).startTick <= tick) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * Inverse of `measureRange`: which measures a tick range covers.
 * `startMeasure` is the measure containing `range.startTick`; `endMeasure` is the
 * measure containing the last tick INSIDE the range (i.e. `endTick - 1`), so
 * `measureRange`/`measuresInRange` round-trip. Both are clamped into
 * [0, score.measures.length - 1]; a degenerate or empty range yields
 * `startMeasure === endMeasure`.
 */
export function measuresInRange(
  score: Score,
  range: { readonly startTick: Ticks; readonly endTick: Ticks },
): { readonly startMeasure: number; readonly endMeasure: number } {
  invariant(score.measures.length > 0, 'measuresInRange: score has no measures')
  const startMeasure = clampedMeasureIndex(score.measures, range.startTick)
  const lastTickInside = range.endTick - 1
  const endMeasure =
    lastTickInside < range.startTick
      ? startMeasure
      : clampedMeasureIndex(score.measures, lastTickInside)
  return { startMeasure, endMeasure }
}
