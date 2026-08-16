/**
 * Rhythm-value pools for the sight-reading/dictation melody generator, split
 * out of `melody.ts` (roadmap 5.54) so `stepwiseLine.ts` can build real
 * quarter/half-note bars without importing `melody.ts` — which itself
 * imports `generateStepwiseOneDirectionLine` from `stepwiseLine.ts`, so a
 * reverse import would be circular. Both files import this one instead.
 *
 * Flat `[units, weight, units, weight, ...]` pairs, in sixteenth-note units
 * (`GRID` ticks per unit). Every pool except `quarter-half` carries a weight-1
 * single-sixteenth entry so {@link buildBarDurations} can always finish a bar
 * exactly, however the larger values happen to divide it — see `quarter-half`
 * below for why that one pool is the deliberate exception.
 *
 * roadmap 5.53 review (F3/F6/F7): an earlier draft of this table dropped
 * `quarters`' `8` (a half note) to shrink the worst-case notes-per-bar for
 * cadence reachability. That was solving the wrong side of the inequality —
 * the real constraint in `generateMelodicLine` (`melody.ts`) is `bestDist >
 * durations.length * maxLeap`, where `bestDist` is the distance from wherever
 * the melody enters the final bar to the NEAREST tonic occurrence in range
 * (at most a handful of semitones for any of this table's rows), not the
 * full range width. `levelDefaults.test.ts`'s reachability property models
 * that distance directly instead of over-approximating with range width, so
 * this pool is free to keep its half note: `quarters` is learner-pickable at
 * every level via `customization.ts`'s `RHYTHM_OPTIONS`, and a "quarters"
 * bar that can never draw a half note was a needless restriction on it.
 *
 * `quarter-half` (roadmap 5.54): level 1's own default style. Faber Piano
 * Adventures Primer introduces note values quarter -> half -> whole, ALL
 * inside Unit 2 (official Teacher Guide, verified 2026-08-12) — level 1 must
 * therefore engrave quarter and half notes and nothing longer, matching the
 * identical fix roadmap 5.20 already made to the Rhythm drill on the same
 * source. Units are exactly `{4, 8}` (quarter, half) — deliberately no `1`
 * (sixteenth) filler, unlike every other pool here, because the app only
 * ever calls this style with a bar length that is a multiple of 4 sixteenth-
 * note units (4/4 = 16, 3/4 = 12, 6/8 = 12 — see `BAR_UNITS` in
 * `levelDefaults.test.ts`), and `{4, 8}` alone always tiles a multiple of 4
 * exactly (induction: `remaining` starts as a multiple of 4, and every draw
 * subtracts 4 or 8, both multiples of 4, so `remaining` stays a multiple of 4
 * — and is never left at a value neither option can consume — until it hits
 * 0). Adding the usual sixteenth filler here would reintroduce exactly the
 * duration this pool exists to exclude at low but nonzero probability
 * (`pickWeighted` can draw ANY option whose `units <= remaining`, not only
 * one from a value that doesn't evenly divide it) — so if this style is ever
 * reused against a bar length NOT a multiple of 4, `buildBarDurations`'s own
 * invariant fails loudly instead of silently drawing a sixteenth note level 1
 * was never supposed to show.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { pickWeighted, type Rng } from '@core/ports/rng.ts'

export type RhythmStyle =
  | 'whole-half'
  | 'quarter-half'
  | 'quarters'
  | 'eighths'
  | 'dotted'
  | 'syncopated'

/** One bar's worth of sixteenth-note units. `GRID` ticks per unit. */
export const GRID = TICKS_PER_QUARTER / 4

type Pool = readonly number[]
export const RHYTHM_POOLS: Readonly<Record<RhythmStyle, Pool>> = {
  'whole-half': [16, 3, 12, 2, 8, 4, 4, 2, 1, 1],
  'quarter-half': [4, 3, 8, 2],
  quarters: [4, 6, 8, 2, 2, 2, 1, 1],
  eighths: [2, 6, 4, 3, 1, 2],
  dotted: [6, 4, 3, 3, 4, 2, 2, 2, 1, 1],
  syncopated: [3, 4, 1, 3, 2, 3, 4, 1],
}

/**
 * A bar's durations, in sixteenth-note units, drawn from `style`'s pool and
 * guaranteed to sum to exactly `barUnits`. Terminates in at most `barUnits`
 * iterations: every draw removes at least one unit, and (`quarter-half`
 * aside — see the module doc) the pool's weight-1 entry keeps at least one
 * option available whenever `remaining >= 1`.
 */
export function buildBarDurations(barUnits: number, style: RhythmStyle, rng: Rng): readonly number[] {
  const pool = RHYTHM_POOLS[style]
  const out: number[] = []
  let remaining = barUnits
  while (remaining > 0) {
    const options: (readonly [number, number])[] = []
    for (let i = 0; i < pool.length; i += 2) {
      const units = at(pool, i)
      if (units <= remaining) options.push([units, at(pool, i + 1)])
    }
    invariant(
      options.length > 0,
      `buildBarDurations: nothing in the '${style}' pool fits a remainder of ${remaining}`,
    )
    const units = pickWeighted(rng, options)
    out.push(units)
    remaining -= units
  }
  return out
}
