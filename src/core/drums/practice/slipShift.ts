/**
 * `shiftedExpectedMs` — the pure shift-and-re-swing step `grade.ts`'s
 * whole-pattern-displacement pass (`runSlipSteps`) needs, split out so that
 * pass can stay an orchestration function and this stays a one-purpose helper
 * with its own property tests (roadmap DR-07).
 *
 * ## Why a nominal-tick shift by the NOMINAL cell, not a millisecond shift
 *
 * `runSlipSteps` tests "did the learner play this pattern N grid-steps
 * early/late" by re-matching hits against the expected instants moved by
 * `step` grid-steps. On a STRAIGHT score that is just `instant + step *
 * cellMs` — a constant, because the grid is uniform. On a SWUNG score it is
 * not: swing bends the grid, so the shift has to happen in NOMINAL tick space
 * — before swing bends anything — and only then get swung and converted to
 * ms: `swungTick(nominalTick + step * nominalSubdivisionTicks, …) *
 * msPerTick`.
 *
 * The cell has to be the NOMINAL grid step (`GrooveRunPlan.
 * nominalSubdivisionTicks` — the smallest gap between two distinct notated
 * instants on the STRAIGHT, unswung grid), not the SWUNG one
 * (`subdivisionTicks`, which only sizes the match window). Swinging can pack a
 * whole nominal grid step down unevenly: a jazz-ride bar's nominal eighths sit
 * 240 ticks apart, but 67%-swing compresses a swung pair to 322/158. Stepping
 * by 158 (the swung gap) and re-swinging asks "where does the note 158 ticks
 * of SWUNG grid away land" — a question with no notation behind it, since no
 * note was ever written 158 nominal ticks from another. It lands close to,
 * but not on, the true "one grid-step late" position (240 nominal ticks away,
 * which swings to 322 — not 316 = 2×158), and the match window is wide enough
 * to swallow the few remaining ticks, so it silently reports the wrong
 * displacement. Stepping by the NOMINAL cell and re-swinging each candidate
 * asks the right question: "if every note had been written `step` grid-steps
 * later, where would swing have put it" — which is what a note actually
 * written there would do.
 *
 * On a straight score `swungTick` is the identity (see that function's own
 * doc on `swingPercent === 50`) and `nominalSubdivisionTicks ===
 * subdivisionTicks`, so this collapses to exactly the old constant-offset
 * formula — the property test in `slipShift.test.ts` checks that equivalence
 * directly.
 */
import { swungTick } from '@core/drums/model/swing.ts'
import { ticks } from '@core/shared/units.ts'
import type { SwingContext } from './plan.ts'

/**
 * `expectedNominalTicks` (absolute nominal ticks from the window opening),
 * each shifted by `step` nominal grid-steps (`nominalSubdivisionTicks` —
 * `GrooveRunPlan.nominalSubdivisionTicks`, never the swung `subdivisionTicks`)
 * and re-swung, then converted to ms. Ascending. When `swing.percent === 50`
 * this equals
 * `expectedNominalTicks.map(t => (t + step * nominalSubdivisionTicks) * msPerTick)`
 * exactly, because `swungTick` is the identity when straight.
 */
export function shiftedExpectedMs(
  expectedNominalTicks: readonly number[],
  step: number,
  nominalSubdivisionTicks: number,
  swing: SwingContext,
  msPerTick: number,
): readonly number[] {
  return expectedNominalTicks
    .map(
      (nominalTick) =>
        (swungTick(
          ticks(nominalTick + step * nominalSubdivisionTicks),
          swing.percent,
          swing.unit,
          swing.measureTicks,
          swing.beats,
          swing.beatType,
        ) as number) * msPerTick,
    )
    .slice()
    .sort((a, b) => a - b)
}
