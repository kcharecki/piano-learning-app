/**
 * Swing at the note level (roadmap DR-15 "jazz ride introduction").
 *
 * `GrooveScore.notes[].tick` is always NOMINAL (straight) — swing is
 * performance metadata, never baked into a note's tick (see that field's own
 * doc comment). `swungTick` is the missing other half of `./grid.ts`'s
 * `subdivisionCellTick`: that function answers "where does grid CELL N sound"
 * for the editor's grid model; this one answers the same question for an
 * already-placed note's tick, which is what `practice/plan.ts` needs to turn
 * a `GrooveScore` into wall-clock instants.
 *
 * The rule mirrors `subdivisionCellTick` exactly — MPC-style pairwise swing,
 * measure-local pairing, only the second (off-beat) cell of a pair moves:
 * `tick` is first reduced to a measure-local offset (`tick mod measureTicks`,
 * pairing restarts at every bar line — see `grid.ts`'s module doc for why
 * that matters). A "cell" is one swing subdivision: 240 ticks for `'eighth'`,
 * 120 for `'sixteenth'`. Cells pair up two at a time from the start of the
 * measure; a tick that is not exactly the second cell of its pair — a
 * downbeat, the first cell of a pair, a triplet tick, or (for an eighth-swing
 * groove) a sixteenth that falls between the eighth-note grid — is returned
 * unchanged. The second cell of a pair moves to `swingPercent`% of the way
 * through the pair's straight-time span, rounded — identical arithmetic to
 * `subdivisionCellTick`, which is what `swing.test.ts`'s property test checks
 * directly, cell by cell.
 *
 * `swingPercent === 50` needs no special case: `round(pairSpan * 50 / 100)`
 * is exactly `pairSpan / 2`, i.e. the cell's own straight offset, so the
 * formula is already the identity at 50 without branching on it.
 */
import { EIGHTH, SIXTEENTH, ticks, type Ticks } from '@core/shared/units.ts'
import type { SwingUnit } from './groove.ts'

/** One swing cell, in ticks, for each `SwingUnit` — `EIGHTH`/`SIXTEENTH` from `@core/shared/units.ts`. */
const SWING_CELL_TICKS: Readonly<Record<SwingUnit, number>> = {
  eighth: EIGHTH,
  sixteenth: SIXTEENTH,
}

/**
 * `tick` (nominal, measure-relative or absolute — pairing is always
 * measure-local, so it makes no difference which) moved to its swung
 * position, or unchanged when straight or when it is not the second cell of
 * a swing pair.
 */
export function swungTick(tick: Ticks, swingPercent: number, swingUnit: SwingUnit, measureTicks: number): Ticks {
  if (measureTicks <= 0) return tick
  const cell = SWING_CELL_TICKS[swingUnit]
  const pairSpan = cell * 2
  const raw = tick as number
  const measureStart = Math.floor(raw / measureTicks) * measureTicks
  const local = raw - measureStart
  // Not on this swing unit's own grid at all (a triplet tick, or a sixteenth
  // inside an eighth-swing groove) — never moved.
  if (local % cell !== 0) return tick
  const pairStart = Math.floor(local / pairSpan) * pairSpan
  const offsetInPair = local - pairStart
  // Only the second cell of a pair (offset === cell) ever moves; the first
  // (offset === 0) sits at its straight position already.
  if (offsetInPair !== cell) return tick
  return ticks(measureStart + pairStart + Math.round((pairSpan * swingPercent) / 100))
}
