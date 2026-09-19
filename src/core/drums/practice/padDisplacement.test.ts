/**
 * `padDisplacementSteps` (roadmap DR-07 tail): the per-pad sibling of
 * `grade.ts`'s `runSlipSteps`, tested the same way `slipShift.test.ts` and
 * `grade.test.ts` test their own displacement logic — every ms figure below
 * is produced by the plan/`swungTick`/`shiftedExpectedMs` machinery inside
 * the test, never typed in from outside it.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jazzRideDrills } from '@core/drums/coordination/jazzRide.ts'
import { moneyBeat, referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { swungTick } from '@core/drums/model/swing.ts'
import { ticks } from '@core/shared/units.ts'
import { MAX_SLIP_STEPS, SLIP_COVERAGE } from './grade.ts'
import { matchCountAt } from './matchCount.ts'
import { padDisplacementSteps } from './padDisplacement.ts'
import { MAX_BPM, MIN_BPM, planGrooveRun } from './plan.ts'
import { shiftedExpectedMs } from './slipShift.ts'

describe('padDisplacementSteps', () => {
  /**
   * The motivating case (DR-07 tail): jazz-ride drill 3 ("comp on the & of
   * 2") at 120 bpm, swingPercent 67. The snare is struck one NOMINAL eighth
   * late on every one of its own instants (built via `swungTick`/
   * `jazzPlan.msPerTick`, mirroring `grade.test.ts`'s own
   * "calls a jazz-ride whole-pattern displacement..." case), while the ride
   * and pedal are played exactly as written. `runSlipSteps` cannot name this
   * (the three pads disagree: ride/pedal vote 0, snare votes 1), but each
   * pad's OWN displacement is unambiguous.
   */
  it('example: jazz-ride drill 3 at 120 bpm, snare one nominal eighth late — snare 1, ride and pedal 0', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    expect(jazzPlan.swingPercent).toBe(67)
    const swingArgs = [
      jazzPlan.swing.percent,
      jazzPlan.swing.unit,
      jazzPlan.swing.measureTicks,
      jazzPlan.swing.beats,
      jazzPlan.swing.beatType,
    ] as const

    const snarePlan = jazzPlan.pads.find((p) => p.pad === 'snare')
    const ridePlan = jazzPlan.pads.find((p) => p.pad === 'rideBow')
    const pedalPlan = jazzPlan.pads.find((p) => p.pad === 'hhPedal')
    expect(snarePlan).toBeDefined()
    expect(ridePlan).toBeDefined()
    expect(pedalPlan).toBeDefined()
    if (snarePlan === undefined || ridePlan === undefined || pedalPlan === undefined) return

    // Every one of the snare's own nominal instants, shifted one nominal
    // eighth (`jazzPlan.nominalSubdivisionTicks`) late and re-swung.
    const snareHits = snarePlan.expectedNominalTicks.map(
      (nominalTick) =>
        (swungTick(ticks(nominalTick + jazzPlan.nominalSubdivisionTicks), ...swingArgs) as number) *
        jazzPlan.msPerTick,
    )

    const snareSteps = padDisplacementSteps(
      snarePlan.expectedNominalTicks,
      snareHits,
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    const rideSteps = padDisplacementSteps(
      ridePlan.expectedNominalTicks,
      ridePlan.expectedMs,
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    const pedalSteps = padDisplacementSteps(
      pedalPlan.expectedNominalTicks,
      pedalPlan.expectedMs,
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )

    expect(snareSteps).toBe(1)
    expect(rideSteps).toBe(0)
    expect(pedalSteps).toBe(0)
  })

  /**
   * Review round 2, RED: the same drill's snare has only 2 expected instants.
   * The OLD `ceil(expected / 2)` rule let ONE matching stroke "prove"
   * displacement while the other instant simply never played — this is that
   * exact shape. The coverage floor computed here from `grade.ts`'s own
   * `SLIP_COVERAGE` (`Math.max(2, Math.ceil(2 * 0.75)) === 2`) means a single
   * match can no longer reach it, so the result is `undefined`: one late
   * stroke and one silence is not evidence of a displaced limb, it is half
   * the evidence a displaced limb would leave.
   */
  it('example: one snare stroke late, the other simply missing — undefined, not a displacement', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    const snarePlan = jazzPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return
    expect(snarePlan.expectedNominalTicks.length).toBe(2)

    const required = Math.max(2, Math.ceil(snarePlan.expectedNominalTicks.length * SLIP_COVERAGE))
    expect(required).toBe(2)

    const swingArgs = [
      jazzPlan.swing.percent,
      jazzPlan.swing.unit,
      jazzPlan.swing.measureTicks,
      jazzPlan.swing.beats,
      jazzPlan.swing.beatType,
    ] as const
    // The pad's first instant, shifted one nominal eighth late and re-swung —
    // the second instant is simply never struck.
    const firstNominalTick = snarePlan.expectedNominalTicks[0]
    expect(firstNominalTick).toBeDefined()
    if (firstNominalTick === undefined) return
    const oneLateHit =
      (swungTick(ticks(firstNominalTick + jazzPlan.nominalSubdivisionTicks), ...swingArgs) as number) *
      jazzPlan.msPerTick

    const result = padDisplacementSteps(
      snarePlan.expectedNominalTicks,
      [oneLateHit],
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    expect(result).toBeUndefined()
  })

  /**
   * The ride's own written pattern repeats a one-nominal-eighth gap in two
   * places (2 -> 2&, and 4 -> 4&: see `RIDE_NOTES` in `jazzRide.ts`), so
   * shifting every ride onset one nominal eighth late can still land some of
   * the shifted onsets back on an UNSHIFTED (step 0) instant of the same
   * pad. Computed directly below (not asserted blind) to show step 0's count
   * really is nonzero here, and that step 1 still strictly beats it because
   * shifting by exactly 1 reproduces every one of the ride's own 12 struck
   * instants, which no other candidate step can match.
   */
  it('example: rideBow one nominal eighth late on every onset, pedal and snare on time — rideBow 1, others 0', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    const swingArgs = [
      jazzPlan.swing.percent,
      jazzPlan.swing.unit,
      jazzPlan.swing.measureTicks,
      jazzPlan.swing.beats,
      jazzPlan.swing.beatType,
    ] as const

    const ridePlan = jazzPlan.pads.find((p) => p.pad === 'rideBow')
    const pedalPlan = jazzPlan.pads.find((p) => p.pad === 'hhPedal')
    const snarePlan = jazzPlan.pads.find((p) => p.pad === 'snare')
    expect(ridePlan).toBeDefined()
    expect(pedalPlan).toBeDefined()
    expect(snarePlan).toBeDefined()
    if (ridePlan === undefined || pedalPlan === undefined || snarePlan === undefined) return

    const rideHits = ridePlan.expectedNominalTicks.map(
      (nominalTick) =>
        (swungTick(ticks(nominalTick + jazzPlan.nominalSubdivisionTicks), ...swingArgs) as number) *
        jazzPlan.msPerTick,
    )

    const countAtStep = (step: number) =>
      matchCountAt(
        shiftedExpectedMs(
          ridePlan.expectedNominalTicks,
          step,
          jazzPlan.nominalSubdivisionTicks,
          jazzPlan.swing,
          jazzPlan.msPerTick,
        ),
        rideHits,
        jazzPlan.windowMs,
      )
    const countAtStepZero = countAtStep(0)
    const countAtStepOne = countAtStep(1)
    expect(countAtStepZero).toBeGreaterThan(0)
    expect(countAtStepOne).toBe(ridePlan.expectedNominalTicks.length)
    expect(countAtStepOne).toBeGreaterThan(countAtStepZero)

    const rideSteps = padDisplacementSteps(
      ridePlan.expectedNominalTicks,
      rideHits,
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    const pedalSteps = padDisplacementSteps(
      pedalPlan.expectedNominalTicks,
      pedalPlan.expectedMs,
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    const snareSteps = padDisplacementSteps(
      snarePlan.expectedNominalTicks,
      snarePlan.expectedMs,
      jazzPlan.windowMs,
      jazzPlan.nominalSubdivisionTicks,
      jazzPlan.swing,
      jazzPlan.msPerTick,
      MAX_SLIP_STEPS,
    )

    expect(rideSteps).toBe(1)
    expect(pedalSteps).toBe(0)
    expect(snareSteps).toBe(0)
  })

  it('example: no hits at all returns undefined', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const snarePlan = runPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return

    const result = padDisplacementSteps(
      snarePlan.expectedNominalTicks,
      [],
      runPlan.windowMs,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    expect(result).toBeUndefined()
  })

  it('example: too few matches at every candidate step returns undefined', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const snarePlan = runPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return

    // A single hit can match at most one candidate step at a time, so no
    // step can reach the coverage floor — computed here from the plan's own
    // expected count and `grade.ts`'s own `SLIP_COVERAGE`, not typed in.
    const required = Math.max(2, Math.ceil(snarePlan.expectedNominalTicks.length * SLIP_COVERAGE))
    expect(required).toBeGreaterThan(1)
    const firstExpectedMs = snarePlan.expectedMs[0]
    expect(firstExpectedMs).toBeDefined()
    if (firstExpectedMs === undefined) return

    const result = padDisplacementSteps(
      snarePlan.expectedNominalTicks,
      [firstExpectedMs],
      runPlan.windowMs,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    expect(result).toBeUndefined()
  })

  /**
   * A deliberate tie: half of this pad's own instants struck one nominal
   * grid-step LATE, the other half struck one grid-step EARLY. Step +1 and
   * step -1 each explain exactly half the hits, and the counts asserted
   * below (computed via `matchCountAt`/`shiftedExpectedMs`, never typed) are
   * equal — neither can be a STRICT maximum, so the result is `undefined`
   * rather than an arbitrary pick of one of the two.
   */
  it('example: a tie between two candidate steps returns undefined', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const snarePlan = runPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return
    const nominalTicks = snarePlan.expectedNominalTicks
    expect(nominalTicks.length).toBe(4)

    const lateHits = shiftedExpectedMs(
      nominalTicks.slice(0, 2),
      1,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
    )
    const earlyHits = shiftedExpectedMs(
      nominalTicks.slice(2, 4),
      -1,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
    )
    const hits = [...lateHits, ...earlyHits].sort((a, b) => a - b)

    const countAt = (step: number) =>
      matchCountAt(
        shiftedExpectedMs(nominalTicks, step, runPlan.nominalSubdivisionTicks, runPlan.swing, runPlan.msPerTick),
        hits,
        runPlan.windowMs,
      )
    const countAtPlusOne = countAt(1)
    const countAtMinusOne = countAt(-1)
    expect(countAtPlusOne).toBe(2)
    expect(countAtMinusOne).toBe(2)
    expect(countAtPlusOne).toBe(countAtMinusOne)

    const result = padDisplacementSteps(
      nominalTicks,
      hits,
      runPlan.windowMs,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    expect(result).toBeUndefined()
  })

  /**
   * The straight case reduces to a constant offset (same argument as
   * `slipShift.ts`'s own module doc and `grade.test.ts`'s equivalent
   * property for `runSlipSteps`): on every reference groove, at every
   * tempo, shifting EVERY pad's own expected instants by the same whole
   * number of nominal grid-steps must give that step back for every pad.
   *
   * Review round 3, item 4: a pad with fewer than 2 expected instants is
   * skipped here — `padDisplacementSteps`' own coverage floor is
   * `Math.max(2, ...)`, so such a pad CORRECTLY returns `undefined` even for
   * a clean, full-coverage shift (one matching stroke can never reach a
   * floor of 2), and asserting `result === step` for it would be asserting
   * the wrong thing. No pad in today's reference grooves or jazz-ride drills
   * actually has fewer than 2 expected instants once `planGrooveRun` repeats
   * the score across its graded bars (verified directly, not assumed) — this
   * guard is defensive against future content, and the dedicated example
   * below covers the shape on its own.
   */
  it('property: on straight reference grooves, hits shifted by a constant number of nominal grid-steps give that step back, for every pad with at least 2 expected instants', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves()),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -4, max: 4 }),
        (score, bpm, step) => {
          const runPlan = planGrooveRun(score, bpm)
          expect(runPlan.swingPercent).toBe(50)
          for (const padPlan of runPlan.pads) {
            if (padPlan.expectedNominalTicks.length < 2) continue
            const hits = padPlan.expectedMs.map((ms) => ms + step * runPlan.nominalSubdivisionMs)
            const result = padDisplacementSteps(
              padPlan.expectedNominalTicks,
              hits,
              runPlan.windowMs,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
              MAX_SLIP_STEPS,
            )
            expect(result).toBe(step)
          }
        },
      ),
    )
  })

  /**
   * Review round 3, item 4: the one-instant edge case the property above
   * deliberately skips, made concrete. A single expected instant can supply
   * at most one match at any candidate step, which can never reach the
   * `Math.max(2, ...)` coverage floor — so even a perfectly clean, fully
   * covered shift returns `undefined`, never the shifted step. Built from a
   * real plan's own snare row (sliced to its first instant), the same way
   * the "too few matches" example above is.
   */
  it('example: a pad with only one expected instant never returns a step, even for a clean shift', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const snarePlan = runPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return
    const oneInstant = snarePlan.expectedNominalTicks.slice(0, 1)
    expect(oneInstant.length).toBe(1)

    const required = Math.max(2, Math.ceil(oneInstant.length * SLIP_COVERAGE))
    expect(required).toBe(2)

    const step = 1
    const hits = shiftedExpectedMs(oneInstant, step, runPlan.nominalSubdivisionTicks, runPlan.swing, runPlan.msPerTick)
    expect(hits.length).toBe(1)

    const result = padDisplacementSteps(
      oneInstant,
      hits,
      runPlan.windowMs,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    expect(result).toBeUndefined()
  })

  /**
   * The swung sibling of the property above (review round 2, item 7): the
   * jazz-ride drills swing at 67%, so a plain `ms + step * nominalSubdivisionMs`
   * offset (which assumes a straight, evenly-spaced grid) would land on the
   * wrong side of a swung pair's uneven split. `shiftedExpectedMs` — the same
   * nominal-shift-then-reswing helper `padDisplacementSteps` itself calls
   * internally, and the one `runSlipSteps`/the motivating jazz-drill-3 example
   * above both use — is what correctly re-derives the swung ms for a shifted
   * NOMINAL tick, so building the hits through it (rather than a bare ms
   * arithmetic) is what makes this property test actually exercise swing
   * instead of accidentally degenerating to the straight case.
   */
  it('property: on swung jazz-ride drills, hits shifted by a constant number of nominal grid-steps give that step back, for every pad with at least 2 expected instants', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...jazzRideDrills()),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -4, max: 4 }),
        (drill, bpm, step) => {
          const runPlan = planGrooveRun(drill.score, bpm)
          expect(runPlan.swingPercent).toBe(67)
          for (const padPlan of runPlan.pads) {
            if (padPlan.expectedNominalTicks.length < 2) continue
            const hits = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
            )
            const result = padDisplacementSteps(
              padPlan.expectedNominalTicks,
              hits,
              runPlan.windowMs,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
              MAX_SLIP_STEPS,
            )
            expect(result).toBe(step)
          }
        },
      ),
    )
  })
})
