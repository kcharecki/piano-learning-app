import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeGrooveScore } from '@core/drums/model/groove.ts'
import { referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { jazzRideDrills } from '@core/drums/coordination/jazzRide.ts'
import { swungTick } from '@core/drums/model/swing.ts'
import { ticks } from '@core/shared/units.ts'
import { MAX_SLIP_STEPS } from './grade.ts'
import { MAX_BPM, MIN_BPM, planGrooveRun } from './plan.ts'
import { shiftedExpectedMs } from './slipShift.ts'

/** `shiftedExpectedMs`, computed by re-implementing nothing: always `swungTick` + a multiply. */
function manualShift(
  expectedNominalTicks: readonly number[],
  step: number,
  subdivisionTicks: number,
  swing: { percent: number; unit: 'eighth' | 'sixteenth'; measureTicks: number; beats: number; beatType: number },
  msPerTick: number,
): readonly number[] {
  return expectedNominalTicks
    .map(
      (t) =>
        (swungTick(
          ticks(t + step * subdivisionTicks),
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

describe('shiftedExpectedMs', () => {
  it('property: on every straight reference groove, at every bpm and every step runSlipSteps actually tries, equals the constant-offset formula (since swungTick is the identity at 50)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves()),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -MAX_SLIP_STEPS, max: MAX_SLIP_STEPS }),
        (score, bpm, step) => {
          const plan = planGrooveRun(score, bpm)
          expect(plan.swingPercent).toBe(50)
          for (const padPlan of plan.pads) {
            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              plan.subdivisionTicks,
              plan.swing,
              plan.msPerTick,
            )
            const constantOffset = padPlan.expectedNominalTicks
              .map((t) => (t + step * plan.subdivisionTicks) * plan.msPerTick)
              .slice()
              .sort((a, b) => a - b)
            expect(shifted.length).toBe(padPlan.expectedNominalTicks.length)
            for (let i = 0; i < shifted.length; i++) {
              expect(shifted[i]).toBeCloseTo(constantOffset[i] as number, 9)
            }
          }
        },
      ),
    )
  })

  it('is always ascending, straight or swung', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves(), ...jazzRideDrills().map((d) => d.score)),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -4, max: 4 }),
        (score, bpm, step) => {
          const plan = planGrooveRun(score, bpm)
          for (const padPlan of plan.pads) {
            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              plan.nominalSubdivisionTicks,
              plan.swing,
              plan.msPerTick,
            )
            for (let i = 1; i < shifted.length; i++) {
              expect(shifted[i]).toBeGreaterThanOrEqual(shifted[i - 1] as number)
            }
          }
        },
      ),
    )
  })

  /**
   * Meters. A swung 3/4 bar of six straight eighths: `swungTick` moves every
   * second cell of a pair (offsets 240, 720, 1200 within the 1440-tick bar,
   * the same pairwise rule `swing.ts` documents), so shifting in nominal-tick
   * space and re-swinging is NOT the same as adding a constant ms offset —
   * pinned here against a direct `swungTick` call, computed in the test, not
   * against a hand-typed number.
   */
  it('meters: a swung 3/4 score re-swings each shifted nominal tick (matches a direct swungTick call, and differs from the constant-offset formula)', () => {
    const score = makeGrooveScore({
      id: 'swung-3-4',
      timeSignature: { beats: 3, beatType: 4 },
      swingPercent: 67,
      swingUnit: 'eighth',
      measureCount: 1,
      notes: [0, 240, 480, 720, 960, 1200].map((tick) => ({
        pad: 'rideBow' as const,
        tick,
        durationTicks: 240,
      })),
    })
    const plan = planGrooveRun(score, 100)
    expect(plan.swingPercent).toBe(67)
    const ride = plan.pads.find((p) => p.pad === 'rideBow')
    expect(ride).toBeDefined()
    if (ride === undefined) return

    for (const step of [-2, -1, 0, 1, 2]) {
      const shifted = shiftedExpectedMs(ride.expectedNominalTicks, step, plan.nominalSubdivisionTicks, plan.swing, plan.msPerTick)
      const manual = manualShift(ride.expectedNominalTicks, step, plan.nominalSubdivisionTicks, plan.swing, plan.msPerTick)
      expect(shifted).toEqual(manual)
    }
    // And at at least one NONZERO step, it disagrees with the constant-offset
    // formula (proof the re-swing is doing real work here, not degenerating to
    // F1's old bug) — searched across steps rather than a hand-picked one,
    // since which particular step lands a shifted tick back on a swinging
    // "second cell" depends on the fixture's own arithmetic. Step 0 is
    // excluded: with the NOMINAL cell, an unshifted instant that itself sits
    // on a swinging "second cell" already disagrees with the constant-offset
    // formula at step 0, which would let this pass without the shift ever
    // doing anything.
    const anyDifference = [-4, -3, -2, -1, 1, 2, 3, 4].some((step) => {
      const shifted = shiftedExpectedMs(ride.expectedNominalTicks, step, plan.nominalSubdivisionTicks, plan.swing, plan.msPerTick)
      const constantOffset = ride.expectedNominalTicks
        .map((t) => (t + step * plan.nominalSubdivisionTicks) * plan.msPerTick)
        .slice()
        .sort((a, b) => a - b)
      return shifted.some((v, i) => Math.abs(v - (constantOffset[i] as number)) > 1e-9)
    })
    expect(anyDifference).toBe(true)
  })

  /**
   * Compound meters are unaffected by swing (`swungTick`'s own guard: `6/8`
   * has `beatType === 8 && beats % 3 === 0`), so even with `swingPercent`
   * above 50, `shiftedExpectedMs` collapses to the constant-offset formula —
   * agreeing with the straight case exactly, computed via the plan's own
   * fields, not typed by hand.
   */
  it('meters: a 6/8 score (compound meter) is untouched by swing, so shiftedExpectedMs agrees with the straight/constant-offset formula', () => {
    const score = makeGrooveScore({
      id: 'swung-6-8-noop',
      timeSignature: { beats: 6, beatType: 8 },
      swingPercent: 67,
      swingUnit: 'eighth',
      measureCount: 1,
      notes: [0, 240, 480, 720, 960, 1200].map((tick) => ({
        pad: 'rideBow' as const,
        tick,
        durationTicks: 240,
      })),
    })
    const plan = planGrooveRun(score, 100)
    expect(plan.swingPercent).toBe(67) // the score is nominally swung; swungTick's compound-meter guard is what neutralises it
    const ride = plan.pads.find((p) => p.pad === 'rideBow')
    expect(ride).toBeDefined()
    if (ride === undefined) return

    for (const step of [-2, -1, 0, 1, 2]) {
      const shifted = shiftedExpectedMs(ride.expectedNominalTicks, step, plan.nominalSubdivisionTicks, plan.swing, plan.msPerTick)
      const constantOffset = ride.expectedNominalTicks
        .map((t) => (t + step * plan.nominalSubdivisionTicks) * plan.msPerTick)
        .slice()
        .sort((a, b) => a - b)
      expect(shifted).toEqual(constantOffset)
    }
  })
})
