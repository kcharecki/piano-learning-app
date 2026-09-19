import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jazzRideDrills } from '@core/drums/coordination/jazzRide.ts'
import { ghostFunkBar, moneyBeat, moneyBeatOpenHat, referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { swungTick } from '@core/drums/model/swing.ts'
import { defaultVelocityForClass, velocityClassOf } from '@core/drums/model/velocity.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { EIGHTH, ticks } from '@core/shared/units.ts'
import { generateReadingExercise } from '@core/drums/reading/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import { padLooseOffset } from './betweenGrid.ts'
import { padDynamics } from './dynamics.ts'
import { gradeGrooveRun, MAX_SLIP_STEPS, worstUnisonGap, type GroovePadResult, type GrooveHit } from './grade.ts'
import { matchCountAt, pair } from './matchCount.ts'
import { padDisplacementSteps } from './padDisplacement.ts'
import { MAX_BPM, MIN_BPM, planGrooveRun, type GroovePadPlan, type GrooveRunPlan, type SwingContext } from './plan.ts'
import { shiftedExpectedMs } from './slipShift.ts'

/**
 * The money beat at 80 bpm, graded over two bars: 16 closed hi-hats, 4 kicks,
 * 4 snares, a 375 ms grid and a 100 ms window. Every case below is built by
 * deforming a perfect run of it, so what each case is testing is exactly the
 * deformation and nothing else.
 */
const plan = (): GrooveRunPlan => planGrooveRun(moneyBeat(), 80)

/** A run played exactly as written, then bent by `offset` (which may vary per hit). */
function play(
  runPlan: GrooveRunPlan,
  offset: (pad: MappedDrumPad, index: number) => number = () => 0,
): GrooveHit[] {
  return runPlan.pads.flatMap((padPlan) =>
    padPlan.expectedMs.map((ms, index) => ({
      pad: padPlan.pad,
      ms: ms + offset(padPlan.pad, index),
    })),
  )
}

const row = (result: ReturnType<typeof gradeGrooveRun>, pad: MappedDrumPad) =>
  result.pads.find((p) => p.pad === pad)

/** Like `play`, but each instant's PAD can be substituted (the articulation slip). Timing is always exact. */
function playWithSwap(
  runPlan: GrooveRunPlan,
  swap: (pad: MappedDrumPad, index: number) => MappedDrumPad,
): GrooveHit[] {
  return runPlan.pads.flatMap((padPlan) =>
    padPlan.expectedMs.map((ms, index) => ({ pad: swap(padPlan.pad, index), ms })),
  )
}

describe('gradeGrooveRun', () => {
  it('grades a run played as written as steady, every stroke accounted for', () => {
    const result = gradeGrooveRun(plan(), play(plan()))
    expect(result.steady).toBe(true)
    expect(result.totalHits).toBe(24)
    expect(row(result, 'hhClosed')).toMatchObject({ expected: 16, matched: 16, missed: 0, extra: 0 })
    expect(row(result, 'snare')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
    expect(row(result, 'kick')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
    expect(row(result, 'hhClosed')?.meanOffsetMs).toBeCloseTo(0, 9)
    expect(row(result, 'hhClosed')?.spreadMs).toBeCloseTo(0, 9)
  })

  /**
   * The latency argument, and the single most important property of this
   * grader. A constant delay is what a laptop adds between the pad and the
   * measurement; it moves every mean by the same amount and cannot touch a
   * pad's spread, its drift, or the gap between two pads. So it must not
   * change the verdict.
   */
  it('calls a run that is uniformly late steady, and reports the lateness it measured', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 55))
    expect(result.steady).toBe(true)
    for (const pad of ['hhClosed', 'snare', 'kick'] as const) {
      expect(row(result, pad)?.meanOffsetMs).toBeCloseTo(55, 9)
      expect(row(result, pad)?.spreadMs).toBeCloseTo(0, 9)
    }
  })

  it('is verdict-invariant under any constant offset inside the window', () => {
    fc.assert(
      fc.property(fc.integer({ min: -99, max: 99 }), (latency) => {
        const result = gradeGrooveRun(plan(), play(plan(), () => latency))
        expect(result.steady).toBe(true)
        expect(result.slipSteps).toBeUndefined()
      }),
    )
  })

  it('names the limbs that failed and leaves the one that did not alone', () => {
    // The same 24 instants and the same per-pad counts as a correct run, with
    // snare and kick trading places.
    const swapped = play(plan()).map((hit) => ({
      pad: hit.pad === 'snare' ? ('kick' as const) : hit.pad === 'kick' ? ('snare' as const) : hit.pad,
      ms: hit.ms,
    }))
    const result = gradeGrooveRun(plan(), swapped)

    expect(result.steady).toBe(false)
    expect(result.totalHits).toBe(24)
    expect(row(result, 'snare')).toMatchObject({ expected: 4, matched: 0, missed: 4, extra: 4 })
    expect(row(result, 'kick')).toMatchObject({ expected: 4, matched: 0, missed: 4, extra: 4 })
    expect(row(result, 'hhClosed')).toMatchObject({ matched: 16, missed: 0, extra: 0 })
  })

  /**
   * T.17.3. Two limbs that are equal and opposite distances from the grid are
   * a hand problem, not a clock problem. Claiming a phase slip here would tell
   * a learner who swapped their limbs that they were playing the right pattern
   * in the wrong place.
   */
  it('does not call a limb swap a phase slip, because the two limbs disagree about the shift', () => {
    const swapped = play(plan()).map((hit) => ({
      pad: hit.pad === 'snare' ? ('kick' as const) : hit.pad === 'kick' ? ('snare' as const) : hit.pad,
      ms: hit.ms,
    }))
    expect(gradeGrooveRun(plan(), swapped).slipSteps).toBeUndefined()
  })

  it('calls a whole-pattern displacement by its grid position, in whole subdivisions', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 375))
    expect(result.slipSteps).toBe(1)
    const early = gradeGrooveRun(plan(), play(plan(), () => -750))
    expect(early.slipSteps).toBe(-2)
  })

  /**
   * T.17.3 again, the other half. 120 ms at 80 bpm is not a grid position:
   * it is not a subdivision, not two of them, and not any number of them. The
   * first attempt reported it as "two steps of the pattern behind the click"
   * because a shifted match beat a zero baseline. Here it is simply late
   * enough to miss, and nothing is claimed about the grid.
   */
  it('claims nothing about the grid for a lag that is not a grid position', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 120))
    expect(result.slipSteps).toBeUndefined()
    expect(row(result, 'hhClosed')).toMatchObject({ matched: 0, missed: 16, extra: 16 })
  })

  /**
   * And a whole sixteenth against an eighth-note grid: half a subdivision, so
   * every stroke misses and no shift recovers it. The first attempt reported
   * this displacement as "3 ms late".
   */
  it('reports a half-subdivision displacement as missed, not as a few milliseconds late', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 187.5))
    expect(result.slipSteps).toBeUndefined()
    expect(row(result, 'hhClosed')?.matched).toBe(0)
    expect(row(result, 'hhClosed')?.meanOffsetMs).toBeUndefined()
    expect(result.steady).toBe(false)
  })

  /**
   * DR-07. `runSlipSteps` no longer skips swung scores: it shifts in NOMINAL
   * tick space by the NOMINAL grid cell (`padPlan.expectedNominalTicks[i] +
   * step * plan.nominalSubdivisionTicks`) and re-swings with `swungTick`
   * before comparing — see `slipShift.ts`. This plays jazz-ride drill 3
   * ("comp on the & of 2", swingPercent 67) at 120 bpm with every instant
   * struck at the SWUNG position of (its own nominal tick + one nominal
   * eighth), built with `swungTick`/`plan.msPerTick` here, not typed by hand.
   *
   * The result is `slipSteps === 1`, exactly the nominal grid-step the
   * strokes were shifted by: `plan.nominalSubdivisionTicks` is 240 ticks (one
   * straight eighth — `note.tick` itself, never swung), so "one nominal
   * eighth late, then swung" IS candidate step 1 by construction, and every
   * instant on every played pad lands there — asserted below by sweeping
   * every candidate step and confirming 1 is the unique, unanimous,
   * full-coverage winner, not a number typed in from outside the test.
   * `plan.subdivisionTicks` (158 ticks — the score's smallest SWUNG gap,
   * `subdivisionTicks(score)`, `plan.ts`) is asserted too, only to show it is
   * NOT the cell this pass uses: 158 is not a multiple of 240, so stepping by
   * it instead (the pre-fix-of-the-fix bug) would land off the true swung
   * position — see `does not call a flat (old-formula) offset` below for the
   * concrete miss.
   */
  it('calls a jazz-ride whole-pattern displacement by its grid position on the nominal grid (DR-07)', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    expect(jazzPlan.swingPercent).toBe(67)
    // The shift cell is the NOMINAL grid (240 ticks, one straight eighth),
    // never the swung `subdivisionTicks` (158) — 158 is the smallest gap
    // between two SWUNG instants, not a grid step any note was ever written
    // at, and stepping by it would land a "one grid-step late" candidate off
    // the note's true swung position (see `slipShift.ts`'s module doc).
    expect(jazzPlan.nominalSubdivisionTicks).toBe(240)
    expect(jazzPlan.subdivisionTicks).toBe(158)
    expect(jazzPlan.windowMs).toBeCloseTo(82.29, 2)

    /** Every expected instant struck at the swung position of (nominal tick + `eighthShift` nominal eighths). */
    const playSwungShift = (eighthShift: number): GrooveHit[] =>
      jazzPlan.pads.flatMap((padPlan) =>
        padPlan.expectedNominalTicks.map((nominalTick) => ({
          pad: padPlan.pad,
          ms:
            (swungTick(
              ticks(nominalTick + eighthShift * EIGHTH),
              jazzPlan.swing.percent,
              jazzPlan.swing.unit,
              jazzPlan.swing.measureTicks,
              jazzPlan.swing.beats,
              jazzPlan.swing.beatType,
            ) as number) * jazzPlan.msPerTick,
        })),
      )

    // Confirm the "1, not some alias" reading independently of
    // `gradeGrooveRun`, by sweeping every candidate step `runSlipSteps` tries
    // (-4..4) and counting how many of the late-shifted hits each one
    // recovers, per pad, shifting by the NOMINAL cell (`nominalSubdivisionTicks`).
    const lateHits = playSwungShift(1)
    for (const padPlan of jazzPlan.pads) {
      const hits = lateHits.filter((h) => h.pad === padPlan.pad).map((h) => h.ms)
      const counts = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((step) => ({
        step,
        count: shiftedExpectedMs(
          padPlan.expectedNominalTicks,
          step,
          jazzPlan.nominalSubdivisionTicks,
          jazzPlan.swing,
          jazzPlan.msPerTick,
        ).filter((instant) => hits.some((h) => Math.abs(h - instant) <= jazzPlan.windowMs)).length,
      }))
      const best = counts.reduce((a, b) => (b.count > a.count ? b : a))
      expect(best.step).toBe(1)
      expect(best.count).toBe(padPlan.expectedNominalTicks.length) // unanimous, full coverage
    }

    const late = gradeGrooveRun(jazzPlan, lateHits)
    expect(late.slipSteps).toBe(1)

    // On time: every stroke matches its own instant, so there is no
    // displacement to report.
    const onTime = gradeGrooveRun(jazzPlan, play(jazzPlan))
    expect(onTime.slipSteps).toBeUndefined()

    // One nominal eighth EARLY: every pad's best candidate is unanimously -1
    // under the nominal-cell shift (rideBow, hhPedal and snare all recover
    // every one of their own instants at step -1 — no aliasing, no
    // disagreement), so `runSlipSteps` reports the displacement cleanly.
    const early = gradeGrooveRun(jazzPlan, playSwungShift(-1))
    expect(early.slipSteps).toBe(-1)
  })

  /**
   * A flat millisecond shift (the OLD, pre-DR-07 mental model: "one
   * subdivision late" means "add a constant number of ms to every swung
   * instant") is not a grid displacement on a swung score at all, and must
   * not be read as any whole step. Under the nominal-cell shift, every pad
   * matches 0 of its own instants at every candidate step -2..2 (ties across
   * the board), so `runSlipSteps` correctly returns `undefined` rather than
   * naming a step. Concretely, for `rideBow`'s third instant (nominal tick
   * 720): the swung expected instant, the true one-nominal-eighth-late
   * candidate, and where the flat-shifted hit actually lands are three
   * different points, computed here from the plan and `swungTick` (never
   * typed): the hit sits `diffMs` from the candidate, further than
   * `jazzPlan.windowMs` can reach.
   */
  it('does not call a flat (old-formula) offset "one subdivision" on a swung score', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    const flatOneEighthMs = EIGHTH * jazzPlan.msPerTick

    const rideBow = jazzPlan.pads.find((p) => p.pad === 'rideBow')
    expect(rideBow).toBeDefined()
    if (rideBow === undefined) return
    const nominalTick = rideBow.expectedNominalTicks[2]
    const expectedMs = rideBow.expectedMs[2]
    expect(nominalTick).toBeDefined()
    expect(expectedMs).toBeDefined()
    if (nominalTick === undefined || expectedMs === undefined) return
    const swingArgs = [jazzPlan.swing.percent, jazzPlan.swing.unit, jazzPlan.swing.measureTicks, jazzPlan.swing.beats, jazzPlan.swing.beatType] as const
    const swungExpectedMs = (swungTick(ticks(nominalTick), ...swingArgs) as number) * jazzPlan.msPerTick
    const candidateMs =
      (swungTick(ticks(nominalTick + jazzPlan.nominalSubdivisionTicks), ...swingArgs) as number) * jazzPlan.msPerTick
    const hitMs = expectedMs + flatOneEighthMs
    const diffMs = Math.abs(hitMs - candidateMs)
    // Swing really moved this instant off its own nominal position — not just
    // "differs from the candidate", which would hold for any nonzero shift
    // regardless of swing.
    expect(swungExpectedMs).not.toBe(nominalTick * jazzPlan.msPerTick)
    expect(diffMs).toBeGreaterThan(jazzPlan.windowMs) // the flat shift misses the true candidate's window

    const result = gradeGrooveRun(jazzPlan, play(jazzPlan, () => flatOneEighthMs))
    expect(result.slipSteps).toBeUndefined()
  })

  it('fails a run whose strokes scatter about their own mean', () => {
    const result = gradeGrooveRun(plan(), play(plan(), (_pad, i) => (i % 2 === 0 ? -70 : 70)))
    expect(result.steady).toBe(false)
    expect(row(result, 'hhClosed')?.spreadMs ?? 0).toBeGreaterThan(result.limits.spreadMs)
  })

  /**
   * T.17.7. A limb walking steadily away from the click has a spread that sits
   * comfortably inside the budget — it is the drift that gives it away. A gate
   * that is only a run-long average cannot see this at all.
   */
  it('fails a limb that walks away from the click even when its spread is inside the budget', () => {
    const result = gradeGrooveRun(plan(), play(plan(), (pad, i) => (pad === 'hhClosed' ? i * 6.5 : 0)))
    const hats = row(result, 'hhClosed')
    expect(hats?.matched).toBe(16)
    expect(hats?.spreadMs ?? 0).toBeLessThan(result.limits.spreadMs)
    expect(Math.abs(hats?.driftMs ?? 0)).toBeGreaterThan(result.limits.driftMs)
    expect(result.steady).toBe(false)
  })

  /**
   * T.17.2. The score puts the kick under the hi-hat on beat 1; it never puts
   * the kick with the snare. So a kick that arrives late relative to the hat
   * is a flam the app can name, and the kick-to-snare distance is a
   * coincidence it must not.
   */
  it('measures the gap only between limbs the score writes on one instant', () => {
    const result = gradeGrooveRun(plan(), play(plan(), (pad) => (pad === 'kick' ? 60 : 0)))
    const named = result.unison.map((gap) => gap.pads.join('+'))
    expect(named).toContain('hhClosed+kick')
    expect(named).toContain('hhClosed+snare')
    expect(named).not.toContain('kick+snare')

    const worst = worstUnisonGap(result)
    expect(worst?.pads).toEqual(['hhClosed', 'kick'])
    expect(worst?.gapMs).toBeCloseTo(60, 6)
    expect(result.steady).toBe(false)
  })

  it('reports no flam when every limb sits together, however late they all are', () => {
    expect(worstUnisonGap(gradeGrooveRun(plan(), play(plan(), () => 80)))).toBeUndefined()
  })

  /**
   * T.17.8. Nothing registering at all is a rig problem — the wrong key, a
   * pad that never received the press — and it looks nothing like a run where
   * every stroke landed in the wrong place. The grader keeps the two apart by
   * counting hits, not matches.
   */
  it('distinguishes a silent run from a run where nothing matched', () => {
    const silent = gradeGrooveRun(plan(), [])
    expect(silent.totalHits).toBe(0)
    expect(silent.steady).toBe(false)

    const allWrong = gradeGrooveRun(plan(), play(plan(), () => 900))
    expect(allWrong.totalHits).toBe(24)
    expect(allWrong.pads.every((p) => p.matched === 0)).toBe(true)
    expect(allWrong.steady).toBe(false)
  })

  it('gives a pad the groove never asks for its own row rather than dropping it', () => {
    const result = gradeGrooveRun(plan(), [...play(plan()), { pad: 'crash1', ms: 100 }])
    expect(row(result, 'crash1')).toMatchObject({ expected: 0, hits: 1, matched: 0, extra: 1 })
    expect(result.steady).toBe(false)
  })

  /**
   * T.17.1 at the grading level: the window Ghost Funk's kick is graded on
   * comes from the score's sixteenth grid, so straight quarters played against
   * a notated "1 a 3 a" cannot come back whole.
   */
  it('does not let straight quarters pass as a syncopated kick part', () => {
    const funk = planGrooveRun(ghostFunkBar(), 80)
    const quarters = [0, 750, 1500, 2250, 3000, 3750, 4500, 5250].map((ms) => ({
      pad: 'kick' as const,
      ms,
    }))
    const kick = row(gradeGrooveRun(funk, quarters), 'kick')
    expect(kick?.expected).toBe(8)
    expect(kick?.matched).toBeLessThan(8)
    expect(kick?.extra).toBeGreaterThan(0)
  })

  it('never matches one hit to two instants, or one instant to two hits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ padIndex: fc.integer({ min: 0, max: 2 }), ms: fc.integer({ min: -500, max: 6500 }) }), {
          maxLength: 40,
        }),
        (raw) => {
          const runPlan = plan()
          const hits = raw.flatMap(({ padIndex, ms }) => {
            const padPlan = runPlan.pads[padIndex]
            return padPlan === undefined ? [] : [{ pad: padPlan.pad, ms }]
          })
          const result = gradeGrooveRun(runPlan, hits)
          for (const padRow of result.pads) {
            expect(padRow.matched).toBeLessThanOrEqual(padRow.expected)
            expect(padRow.matched).toBeLessThanOrEqual(padRow.hits)
            expect(padRow.missed + padRow.matched).toBe(padRow.expected)
            expect(padRow.extra + padRow.matched).toBe(padRow.hits)
          }
          expect(result.pads.reduce((sum, p) => sum + p.hits, 0)).toBe(hits.length)
        },
      ),
    )
  })

  /**
   * Window-boundary mutant: the distance check in `pair()` is `distance >
   * windowMs`, i.e. exactly `windowMs` late still matches. A mutant that
   * tightens this to `>=` would turn every one of these into a miss.
   */
  it('matches a hit exactly windowMs late (pins the strict `>` in the window check)', () => {
    const runPlan = plan()
    const result = gradeGrooveRun(runPlan, play(runPlan, () => runPlan.windowMs))
    expect(result.pads.every((p) => p.matched === p.expected)).toBe(true)
    expect(result.pads.every((p) => p.missed === 0)).toBe(true)
  })

  /**
   * Greedy tie-break: `expected` is time-ordered, so when one hit sits at the
   * exact midpoint between two adjacent instants, the earlier instant is
   * processed first and claims it — the later instant is left missed. This is
   * the documented, current behaviour (see the one-line comment in `pair()`);
   * it is not a search, just iteration order, but it is worth pinning.
   */
  it('gives a hit at the exact midpoint between two adjacent instants to the earlier one', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80, { toleranceMs: 1000 })
    const hhClosed = runPlan.pads.find((p) => p.pad === 'hhClosed')
    expect(hhClosed).toBeDefined()
    if (hhClosed === undefined) return
    const [first, second] = hhClosed.expectedMs
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return
    const midpoint = (first + second) / 2

    const hits = [
      ...play(runPlan).filter((hit) => !(hit.pad === 'hhClosed' && (hit.ms === first || hit.ms === second))),
      { pad: 'hhClosed' as const, ms: midpoint },
    ]
    const result = gradeGrooveRun(runPlan, hits)
    const hats = row(result, 'hhClosed')
    // One of the two instants (the earlier) is matched by the midpoint hit,
    // the other is missed — and the SIGN of the resulting mean offset (every
    // other hhClosed hit lands exactly on time) tells us which: positive
    // means the earlier instant (midpoint - first > 0) claimed it.
    expect(hats?.matched).toBe(hhClosed.expectedMs.length - 1)
    expect(hats?.missed).toBe(1)
    expect(hats?.meanOffsetMs).toBeCloseTo((midpoint - first) / (hhClosed.expectedMs.length - 1), 9)
  })
})

/**
 * T.33: playing the right instant with the wrong hi-hat articulation used to
 * grade as two independent failures (a miss on the expected pad, an extra on
 * the played one) and named neither. This pass reconciles the two into one
 * `slipped` count and one `articulation` entry, without ever touching a hit
 * that was already correctly matched.
 */
describe('gradeGrooveRun: articulation slip pass', () => {
  it('names a hat played closed throughout as one slip per instant, not a miss and an extra', () => {
    // Mutant killed: a stub that never runs the slip pass at all — it would
    // report hhOpen as "missed: loops, slipped: 0" and hhClosed as
    // "extra: loops", instead of moving the discrepancy into `slipped`.
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const hits = play(runPlan).map((hit) => (hit.pad === 'hhOpen' ? { pad: 'hhClosed' as const, ms: hit.ms } : hit))
    const result = gradeGrooveRun(runPlan, hits)

    const openExpected = runPlan.pads.find((p) => p.pad === 'hhOpen')?.expectedMs.length ?? 0
    expect(openExpected).toBeGreaterThan(0) // sanity: the groove does write an open hat

    expect(row(result, 'hhOpen')).toMatchObject({ matched: 0, missed: 0, slipped: openExpected })
    expect(row(result, 'hhClosed')).toMatchObject({ extra: 0 })
    expect(result.articulation).toEqual([{ expected: 'hhOpen', played: 'hhClosed', count: openExpected }])
    expect(result.steady).toBe(false)

    // Every other row is fully matched — the slip pass never touches a pad
    // outside the sibling pair.
    for (const p of ['kick', 'snare'] as const) {
      expect(row(result, p)).toMatchObject({ missed: 0, extra: 0, slipped: 0 })
    }
  })

  it('names the reverse mixup too: the hat played open where the score writes closed', () => {
    // Mutant killed: a slip pass hard-coded to only the (hhOpen, hhClosed)
    // direction and never its reverse — it would leave this run's hhClosed
    // row "missed: 2" and hhOpen "extra: 2" with an empty `articulation`.
    const runPlan = planGrooveRun(moneyBeat(), 80) // moneyBeat never notates hhOpen
    const hits = playWithSwap(runPlan, (pad, index) => (pad === 'hhClosed' && index % 8 === 7 ? 'hhOpen' : pad))
    const result = gradeGrooveRun(runPlan, hits)

    expect(row(result, 'hhClosed')).toMatchObject({ expected: 16, matched: 14, missed: 0, slipped: 2 })
    expect(row(result, 'hhOpen')).toMatchObject({ expected: 0, hits: 0, matched: 0, extra: 0, slipped: 0 })
    expect(result.articulation).toEqual([{ expected: 'hhClosed', played: 'hhOpen', count: 2 }])
    expect(result.steady).toBe(false)
  })

  it('respects the match window: a closed hit outside the missed open instant stays a plain miss and a plain extra', () => {
    // Mutant killed: a slip pass that ignores `windowMs` and pairs by
    // nearest-anything — it would call this a slip even though the extra
    // hit lands well outside the open instant's own tolerance.
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const openPlan = runPlan.pads.find((p) => p.pad === 'hhOpen')
    expect(openPlan).toBeDefined()
    if (openPlan === undefined) return
    const openMs = openPlan.expectedMs[0]
    expect(openMs).toBeDefined()
    if (openMs === undefined) return

    expect(runPlan.windowMs).toBeLessThan(150)
    const hits = [
      ...play(runPlan).filter((hit) => !(hit.pad === 'hhOpen' && hit.ms === openMs)),
      { pad: 'hhClosed' as const, ms: openMs + 150 },
    ]
    const result = gradeGrooveRun(runPlan, hits)

    expect(row(result, 'hhOpen')).toMatchObject({ matched: 1, missed: 1, slipped: 0 })
    expect(row(result, 'hhClosed')).toMatchObject({ extra: 1, slipped: 0 })
    expect(result.articulation).toEqual([])
  })

  it('never steals a correctly played open hit: a nearby extra closed hit is just extra', () => {
    // Mutant killed: a slip pass that matches against ALL of a pad's hits
    // instead of only its still-unmatched extras — it would let the extra
    // closed hit "steal" the already-matched open hit's slot.
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const openPlan = runPlan.pads.find((p) => p.pad === 'hhOpen')
    expect(openPlan).toBeDefined()
    if (openPlan === undefined) return
    const openMs = openPlan.expectedMs[0]
    expect(openMs).toBeDefined()
    if (openMs === undefined) return

    const hits = [...play(runPlan), { pad: 'hhClosed' as const, ms: openMs + 20 }]
    const result = gradeGrooveRun(runPlan, hits)

    expect(row(result, 'hhOpen')).toMatchObject({ matched: openPlan.expectedMs.length, slipped: 0 })
    expect(row(result, 'hhClosed')).toMatchObject({ extra: 1, slipped: 0 })
    expect(result.articulation).toEqual([])
  })

  it('property: expected = matched + missed + slipped on every row, articulation sums to slipped, and a hit set with no hi-hat pad never slips', () => {
    const grooveArb = fc.constantFrom(...referenceGrooves())
    const hitArb = fc.record({
      pad: fc.constantFrom<MappedDrumPad>('kick', 'snare', 'hhClosed', 'hhOpen', 'tomHigh'),
      ms: fc.integer({ min: -200, max: 6500 }),
    })
    fc.assert(
      fc.property(grooveArb, fc.array(hitArb, { maxLength: 30 }), (score, rawHits) => {
        const runPlan = planGrooveRun(score, 80)
        const result = gradeGrooveRun(runPlan, rawHits)

        for (const padRow of result.pads) {
          expect(padRow.expected).toBe(padRow.matched + padRow.missed + padRow.slipped)
        }

        const slippedByExpectedPad = new Map<MappedDrumPad, number>()
        for (const entry of result.articulation) {
          slippedByExpectedPad.set(entry.expected, (slippedByExpectedPad.get(entry.expected) ?? 0) + entry.count)
        }
        for (const padRow of result.pads) {
          expect(padRow.slipped).toBe(slippedByExpectedPad.get(padRow.pad) ?? 0)
        }

        const hasHiHatHit = rawHits.some((h) => h.pad === 'hhOpen' || h.pad === 'hhClosed')
        if (!hasHiHatHit) {
          expect(result.articulation).toEqual([])
          for (const padRow of result.pads) expect(padRow.slipped).toBe(0)
        }
      }),
    )
  })

  // worstUnisonGap and runSlipSteps are exercised by the pre-existing tests
  // above (e.g. "measures the gap only between limbs the score writes on one
  // instant" and "calls a whole-pattern displacement by its grid position");
  // none of them touch a sibling-articulation pad, so they are this task's
  // "unaffected" regression proof rather than new tests.

  /**
   * Regression for the bug where a slipped-in offset, appended at the END of
   * `offsets` regardless of which instant it answers, corrupted `drift()`'s
   * positional first-half/second-half split. hhClosed plays its first four
   * instants (0..3) on the OPEN hat instead — a slip on each — and every
   * instant (slipped or not) carries an offset of `i * 6.5`, a clean walk.
   * With offsets sorted back to instant order the two arithmetic halves are
   * off by exactly `8 * 6.5 = 52`ms; the pre-fix code (slip offsets tacked on
   * the tail) averaged this walk against itself and read 0.
   */
  it('sorts a slipped-in offset back into instant order before computing drift (regression, T.33 x T.17.7)', () => {
    const runPlan = plan() // moneyBeat at 80bpm: hhClosed has 16 expected instants
    const hhClosedPlan = runPlan.pads.find((p) => p.pad === 'hhClosed')
    expect(hhClosedPlan).toBeDefined()
    if (hhClosedPlan === undefined) return
    expect(hhClosedPlan.expectedMs.length).toBe(16)

    const hhHits = hhClosedPlan.expectedMs.map((ms, i) => ({
      pad: i < 4 ? ('hhOpen' as const) : ('hhClosed' as const),
      ms: ms + i * 6.5,
    }))
    const hits = [...play(runPlan).filter((h) => h.pad !== 'hhClosed'), ...hhHits]
    const result = gradeGrooveRun(runPlan, hits)

    const hats = row(result, 'hhClosed')
    expect(hats?.matched).toBe(12)
    expect(hats?.slipped).toBe(4)
    expect(result.articulation).toEqual([{ expected: 'hhClosed', played: 'hhOpen', count: 4 }])
    expect(hats?.driftMs).toBeCloseTo(52, 9)
    expect(result.steady).toBe(false)
  })

  /**
   * Pins the order `applyArticulationSlips` pushes entries in: the direction
   * whose EXPECTED pad is the sibling pair's first element (`hhOpen`) before
   * the reverse — a mutant swapping the two directions in the array would
   * flip this. Built so BOTH directions fire in the same run: one closed
   * instant played open, and both open instants played closed.
   */
  it('orders articulation slips expected-hhOpen-first, then the reverse (pins the direction order)', () => {
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80) // 14 hhClosed, 2 hhOpen expected (2 graded bars)
    const hits = playWithSwap(runPlan, (pad, index) => {
      if (pad === 'hhClosed' && index === 0) return 'hhOpen'
      if (pad === 'hhOpen') return 'hhClosed'
      return pad
    })
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.articulation).toEqual([
      { expected: 'hhOpen', played: 'hhClosed', count: 2 },
      { expected: 'hhClosed', played: 'hhOpen', count: 1 },
    ])
  })

  /**
   * Window-boundary mutant in the SLIP pass's own call to `pair()`: a
   * distance of exactly `windowMs` still slips, not just misses+extras.
   */
  it('slips a hit exactly windowMs from the missed instant (pins the strict `>` in the slip pass)', () => {
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const openPlan = runPlan.pads.find((p) => p.pad === 'hhOpen')
    expect(openPlan).toBeDefined()
    if (openPlan === undefined) return
    const openMs = openPlan.expectedMs[0]
    expect(openMs).toBeDefined()
    if (openMs === undefined) return

    const hits = [
      ...play(runPlan).filter((hit) => !(hit.pad === 'hhOpen' && hit.ms === openMs)),
      { pad: 'hhClosed' as const, ms: openMs + runPlan.windowMs },
    ]
    const result = gradeGrooveRun(runPlan, hits)

    // Only the FIRST loop's open instant was removed and replaced by the
    // boundary hit; the second loop's hhOpen instant is still genuinely
    // played, so it stays matched.
    expect(row(result, 'hhOpen')).toMatchObject({ matched: 1, missed: 0, slipped: 1 })
    expect(result.articulation).toEqual([{ expected: 'hhOpen', played: 'hhClosed', count: 1 }])
  })
})

describe('runSlipSteps on a swung plan (DR-07 properties)', () => {
  const MAX_SLIP_STEPS = 4
  const SLIP_COVERAGE = 0.75

  /** Nearest-first match count — an INDEPENDENT re-implementation of `grade.ts`'s own `pair`, not a call into it. */
  function matchCount(expected: readonly number[], hits: readonly number[], windowMs: number): number {
    const taken = new Array<boolean>(hits.length).fill(false)
    let matched = 0
    for (const instant of expected) {
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
      if (bestIndex < 0) continue
      taken[bestIndex] = true
      matched++
    }
    return matched
  }

  /**
   * The OLD (pre-DR-07) whole-pattern-displacement search — `expected + step
   * * subdivisionMs`, a constant ms offset — re-implemented independently
   * here so the property below can compare `gradeGrooveRun`'s real output
   * against it, rather than against a hand-typed number.
   */
  function oldConstantOffsetSlipSteps(
    runPlan: GrooveRunPlan,
    hitsByPad: ReadonlyMap<MappedDrumPad, readonly number[]>,
  ): number | undefined {
    const steps = [...Array(MAX_SLIP_STEPS * 2 + 1).keys()].map((i) => i - MAX_SLIP_STEPS)
    const totals = new Map<number, number>(steps.map((step) => [step, 0]))
    let expectedTotal = 0
    let agreed: number | undefined
    let first = true
    for (const padPlan of runPlan.pads) {
      const hits = hitsByPad.get(padPlan.pad) ?? []
      expectedTotal += padPlan.expectedMs.length
      const counts = steps.map((step) => ({
        step,
        count: matchCount(
          padPlan.expectedMs.map((ms) => ms + step * runPlan.subdivisionMs),
          hits,
          runPlan.windowMs,
        ),
      }))
      for (const { step, count } of counts) totals.set(step, (totals.get(step) ?? 0) + count)
      if (hits.length === 0) continue
      const best = counts.reduce((a, b) => (b.count > a.count ? b : a))
      const tied = counts.filter((c) => c.count === best.count).length > 1
      if (tied) return undefined
      if (first) {
        agreed = best.step
        first = false
      } else if (agreed !== best.step) {
        return undefined
      }
    }
    if (agreed === undefined || agreed === 0) return undefined
    const atAgreed = totals.get(agreed) ?? 0
    if (atAgreed <= (totals.get(0) ?? 0)) return undefined
    if (atAgreed < expectedTotal * SLIP_COVERAGE) return undefined
    return agreed
  }

  /**
   * DR-07's central regression proof: on a STRAIGHT score `shiftedExpectedMs`
   * is provably identical to the old constant-offset formula (`swungTick` is
   * the identity at `swingPercent === 50`, `slipShift.test.ts`'s own property
   * checks that directly) — so `gradeGrooveRun`'s `slipSteps` on any straight
   * groove, at any tempo, for any random hit set, must still match the OLD
   * behaviour exactly. `oldConstantOffsetSlipSteps` above is that old
   * behaviour, re-implemented independently rather than imported, so this is
   * a real cross-check and not a tautology against the refactor.
   */
  it('property: on straight reference grooves, slipSteps agrees with the old constant-offset search, for random hits at random tempos', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves()),
        fc.integer({ min: 40, max: 200 }),
        fc.array(
          fc.record({
            pad: fc.constantFrom<MappedDrumPad>('kick', 'snare', 'hhClosed', 'hhOpen', 'tomHigh'),
            ms: fc.integer({ min: -500, max: 6500 }),
          }),
          { maxLength: 30 },
        ),
        (score, bpm, rawHits) => {
          const runPlan = planGrooveRun(score, bpm)
          expect(runPlan.swingPercent).toBe(50)
          const hits: GrooveHit[] = rawHits.map(({ pad, ms }) => ({ pad, ms }))
          const result = gradeGrooveRun(runPlan, hits)

          const hitsByPad = new Map<MappedDrumPad, number[]>()
          for (const hit of hits) {
            const list = hitsByPad.get(hit.pad) ?? []
            list.push(hit.ms)
            hitsByPad.set(hit.pad, list)
          }
          for (const list of hitsByPad.values()) list.sort((a, b) => a - b)

          expect(result.slipSteps).toBe(oldConstantOffsetSlipSteps(runPlan, hitsByPad))
        },
      ),
    )
  })

  /**
   * No double-count. `pair`'s `taken` bookkeeping already stops one hit
   * claiming two instants WITHIN a single candidate step's match; what this
   * checks is the structural precondition that makes that matching correct
   * rather than merely non-crashing — no two elements of any candidate
   * shift's own list are close enough for their windows to overlap. The
   * tightest case is eighth-swing at 67%: a pair's second cell sits at
   * `swungTick(EIGHTH, 67, 'eighth', …)` ticks into the pair, so the next
   * pair's first cell (at `2 * EIGHTH`) is only `2 * EIGHTH -
   * swungTick(EIGHTH, …)` ticks further on — 158 ticks, computed here from
   * `swungTick` directly, not typed by hand — and `windowMs` must stay under
   * half of that at every tempo the trainer allows.
   */
  it('no double-count: windowMs stays under half the tightest swung gap, so no two elements of any candidate shift can share a hit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...jazzRideDrills()),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -4, max: 4 }),
        (drill, bpm, step) => {
          const jazzPlan = planGrooveRun(drill.score, bpm)

          const pairSpan = EIGHTH * 2
          const swungSecondCellOffset = swungTick(
            ticks(EIGHTH),
            67,
            'eighth',
            jazzPlan.swing.measureTicks,
            jazzPlan.swing.beats,
            jazzPlan.swing.beatType,
          ) as number
          const smallestGapTicks = pairSpan - swungSecondCellOffset
          expect(smallestGapTicks).toBe(158)
          // `windowMs` is `min(toleranceMs, subdivisionMs / 2)` (`plan.ts`) — a
          // CAP, so it reaches exactly half the smallest gap when the score's
          // own tolerance is not the tighter bound (this score's smallest gap
          // IS 158 ticks, so `subdivisionMs / 2` and this independently-derived
          // half-gap coincide exactly at some tempos). Never strictly wider.
          expect(jazzPlan.windowMs).toBeLessThanOrEqual((smallestGapTicks * jazzPlan.msPerTick) / 2)

          // And directly, for this plan's own candidate shift at this step —
          // shifted by the NOMINAL cell (`nominalSubdivisionTicks`), the same
          // cell `runSlipSteps` actually uses (DR-07 root-cause fix; the
          // SWUNG `subdivisionTicks` above only sizes the window, it is never
          // the shift cell) — no two adjacent elements are closer than
          // 2 * windowMs to each other, on any played pad: the guarantee that
          // makes one greedy pass over `pair` correct rather than
          // order-dependent.
          for (const padPlan of jazzPlan.pads) {
            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              jazzPlan.nominalSubdivisionTicks,
              jazzPlan.swing,
              jazzPlan.msPerTick,
            )
            for (let i = 1; i < shifted.length; i++) {
              const gap = (shifted[i] as number) - (shifted[i - 1] as number)
              // `>=` up to float slop: both sides are ms computed by multiplying
              // the same tick-domain quantities in a different order, so exact
              // equality can differ in the last bit.
              expect(gap).toBeGreaterThanOrEqual(2 * jazzPlan.windowMs - 1e-9)
            }
          }
        },
      ),
    )
  })
})

/**
 * Amber, review round 3: `effectiveStep`'s non-zero branch (`grade.ts`) feeds
 * `shiftedExpectedMs`'s OUTPUT straight into `pair()`, then reads
 * `expectedDynamicsByPad` — built from the pad's ORIGINAL, unshifted
 * `expectedNominalTicks`, in that array's own order — off the `expectedIndex`
 * `pair()` hands back. That is only correct if `shiftedExpectedMs`'s output
 * stays index-for-index with its INPUT order despite the `.sort()` inside it
 * (`slipShift.ts`): shift every input tick by the same step and re-swing it,
 * and the result must still line up one-to-one with the input it came from,
 * or `pair()`'s `expectedIndex` would silently point at the wrong pad
 * instant's notated dynamics class. `slipShift.test.ts` is not mine to add
 * to this round, so this pins the same guarantee from `grade.ts`'s own side:
 * shifting must never need the trailing sort to do anything at all, on a
 * real plan's own (already tick-ascending) `expectedNominalTicks`.
 */
describe('shiftedExpectedMs stays index-for-index with its input order (amber, review round 3)', () => {
  it('property: shifting+re-swinging never reorders a real plan\'s own expectedNominalTicks, across grooves, drills and steps', () => {
    const scores = [...referenceGrooves(), ...jazzRideDrills().map((drill) => drill.score)]
    fc.assert(
      fc.property(
        fc.constantFrom(...scores),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -6, max: 6 }),
        (score, bpm, step) => {
          const runPlan = planGrooveRun(score, bpm)
          for (const padPlan of runPlan.pads) {
            if (padPlan.expectedNominalTicks.length === 0) continue
            // `expectedNominalTicks` comes straight off the score in
            // ascending-tick order (`plan.ts`) — confirmed here rather than
            // assumed, since the property below is meaningless on an input
            // that was not already ordered.
            for (let i = 1; i < padPlan.expectedNominalTicks.length; i++) {
              expect(padPlan.expectedNominalTicks[i]).toBeGreaterThan(
                padPlan.expectedNominalTicks[i - 1] as number,
              )
            }

            // The independent oracle: shift and re-swing each tick in place,
            // in the INPUT's own order, with no sort at all.
            const unsorted = padPlan.expectedNominalTicks.map(
              (nominalTick) =>
                (swungTick(
                  ticks(nominalTick + step * runPlan.nominalSubdivisionTicks),
                  runPlan.swing.percent,
                  runPlan.swing.unit,
                  runPlan.swing.measureTicks,
                  runPlan.swing.beats,
                  runPlan.swing.beatType,
                ) as number) * runPlan.msPerTick,
            )

            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
            )
            // If this ever fails, `shiftedExpectedMs`'s trailing sort moved
            // at least one element relative to the input it came from — the
            // exact failure mode `effectiveStep`'s dynamics pairing above
            // depends on never happening.
            expect(shifted).toEqual(unsorted)
          }
        },
      ),
      { seed: 20260919, numRuns: 200 },
    )
  })
})

/**
 * DR-07 tail: `GroovePadResult.displacementSteps` was added and
 * `gradeGrooveRun` now fills it for every pad, but `runSlipSteps` itself is
 * untouched — this describe block is the proof that `slipSteps` really is
 * still exactly what it was before this slice, and separately that the two
 * passes (whole-pattern and per-pad) agree with each other in the one case
 * where they trivially must: every played pad displaced by the identical
 * step.
 */
describe('gradeGrooveRun: slipSteps unchanged by adding pads[].displacementSteps (DR-07 tail)', () => {
  /**
   * `runSlipSteps` (`grade.ts`) re-implemented independently here, the same
   * way `oldConstantOffsetSlipSteps` above re-implements the PRE-DR-07
   * formula — generalized with `shiftedExpectedMs` so it also covers swung
   * scores, since `runSlipSteps` itself already is. `runSlipSteps` is not
   * exported and this slice does not change it or export it; duplicating its
   * body here (rather than trusting the production function unmodified by
   * inspection) is what lets the property below be a real regression check
   * instead of a tautology.
   */
  function referenceRunSlipSteps(
    padPlans: readonly GroovePadPlan[],
    windowMs: number,
    nominalSubdivisionTicks: number,
    swing: SwingContext,
    msPerTick: number,
    hitsByPad: ReadonlyMap<MappedDrumPad, readonly number[]>,
  ): number | undefined {
    const REFERENCE_SLIP_COVERAGE = 0.75
    const steps = [...Array(MAX_SLIP_STEPS * 2 + 1).keys()].map((i) => i - MAX_SLIP_STEPS)
    const totals = new Map<number, number>(steps.map((step) => [step, 0]))
    let expectedTotal = 0
    let agreed: number | undefined
    let first = true
    for (const padPlan of padPlans) {
      const hits = hitsByPad.get(padPlan.pad) ?? []
      expectedTotal += padPlan.expectedMs.length
      const counts = steps.map((step) => ({
        step,
        count: matchCountAt(
          shiftedExpectedMs(padPlan.expectedNominalTicks, step, nominalSubdivisionTicks, swing, msPerTick),
          hits,
          windowMs,
        ),
      }))
      for (const { step, count } of counts) totals.set(step, (totals.get(step) ?? 0) + count)
      if (hits.length === 0) continue
      const best = counts.reduce((a, b) => (b.count > a.count ? b : a))
      const tied = counts.filter((c) => c.count === best.count).length > 1
      if (tied) return undefined
      if (first) {
        agreed = best.step
        first = false
      } else if (agreed !== best.step) {
        return undefined
      }
    }
    if (agreed === undefined || agreed === 0) return undefined
    const atAgreed = totals.get(agreed) ?? 0
    if (atAgreed <= (totals.get(0) ?? 0)) return undefined
    if (atAgreed < expectedTotal * REFERENCE_SLIP_COVERAGE) return undefined
    return agreed
  }

  /**
   * Review round 2, AMBER #5: the previous version of this property drew hits
   * from `fc.integer({ min: -500, max: 6500 })` — ms values with no relation
   * to the plan's own grid at all — and a reviewer's probe found it never
   * produced a DEFINED `slipSteps` in 2000 runs. An equivalence property
   * whose generator only ever visits one side of the branch it is meant to
   * check proves that side and nothing else.
   *
   * Hits are now built FROM the plan: every pad's own expected instants,
   * shifted by one shared nominal `step` (`shiftedExpectedMs` — the same
   * shift-then-reswing helper `runSlipSteps` itself uses) and re-swung, so
   * the backbone of every generated run is a clean whole-pattern
   * displacement. Realistic imperfection is layered on top: each shifted hit
   * has roughly a 25% chance of being dropped entirely (missed strokes —
   * `SLIP_COVERAGE` is 0.75, so this sits right at the coverage boundary and
   * generates plenty of cases on both sides of it), a surviving hit is
   * jittered by up to half the match window either way (still-on-time
   * playing, never enough to fall out of its own window), and a handful of
   * unrelated extra hits are thrown in (stray strokes, or noise that can tie
   * a pad's own vote and push the whole run to `undefined`). `step === 0` and
   * heavy drop/jitter luck both still reach `undefined` plenty of the time,
   * so this generator exercises both branches, not just the defined one —
   * confirmed below by the counter assertion, not by inspection.
   */
  it('property: slipSteps matches an independent re-implementation of runSlipSteps, on straight AND swung scores, for near-clean displaced hits at random tempos', () => {
    const scores = [...referenceGrooves(), ...jazzRideDrills().map((drill) => drill.score)]
    const DROP_PERCENT = 25
    let definedCount = 0
    let undefinedCount = 0
    fc.assert(
      fc.property(
        fc.constantFrom(...scores),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -MAX_SLIP_STEPS, max: MAX_SLIP_STEPS }),
        // A pool of per-hit rolls, consumed in order as pads/instants are
        // walked below — sized generously so no plan's hit count can exhaust it.
        fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 200, maxLength: 200 }),
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 200, maxLength: 200 }),
        fc.array(fc.integer({ min: 0, max: 8000 }), { minLength: 5, maxLength: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (score, bpm, step, dropRolls, jitterRolls, extraMsPool, extraCount) => {
          const runPlan = planGrooveRun(score, bpm)
          let rollIndex = 0
          const hits: GrooveHit[] = []
          for (const padPlan of runPlan.pads) {
            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
            )
            for (const shiftedMs of shifted) {
              const dropRoll = dropRolls[rollIndex % dropRolls.length] ?? 0
              const jitterRoll = jitterRolls[rollIndex % jitterRolls.length] ?? 0
              rollIndex++
              if (dropRoll < DROP_PERCENT) continue
              // Scaled into +/- half the match window, so a surviving hit
              // never jitters out of the step it was built to land on.
              const jitterMs = (jitterRoll / 1000) * (runPlan.windowMs / 2)
              hits.push({ pad: padPlan.pad, ms: shiftedMs + jitterMs })
            }
          }
          for (let e = 0; e < extraCount; e++) {
            const extraPad = runPlan.pads[e % runPlan.pads.length]?.pad
            if (extraPad === undefined) continue
            hits.push({ pad: extraPad, ms: extraMsPool[e % extraMsPool.length] ?? 0 })
          }

          const result = gradeGrooveRun(runPlan, hits)

          const hitsByPad = new Map<MappedDrumPad, number[]>()
          for (const hit of hits) {
            const list = hitsByPad.get(hit.pad) ?? []
            list.push(hit.ms)
            hitsByPad.set(hit.pad, list)
          }
          for (const list of hitsByPad.values()) list.sort((a, b) => a - b)

          const expected = referenceRunSlipSteps(
            runPlan.pads,
            runPlan.windowMs,
            runPlan.nominalSubdivisionTicks,
            runPlan.swing,
            runPlan.msPerTick,
            hitsByPad,
          )
          if (expected === undefined) undefinedCount++
          else definedCount++
          expect(result.slipSteps).toBe(expected)
        },
        // Review round 3: `definedCount`/`undefinedCount` are counts over a
        // RANDOM run, so without a fixed seed the two assertions below are
        // themselves flaky (mean ~7.9 defined per 100 runs at the default
        // unseeded run count, per review — rare but nonzero chance of 0).
        // Seed and run count fixed so the counters are deterministic; the
        // equivalence check itself (`expect(result.slipSteps).toBe(expected)`)
        // is unchanged and still runs against whatever fast-check generates.
      ),
      { seed: 20260919, numRuns: 100 },
    )
    // The regression this property exists to catch (AMBER #5): a generator
    // that only ever hits one branch of the equivalence it is checking.
    expect(definedCount).toBeGreaterThan(0)
    expect(undefinedCount).toBeGreaterThan(0)
  })

  /**
   * Consistency between the two passes in the one case where they must
   * agree: every played pad's own hits pick out the SAME whole-grid step, so
   * the whole-pattern vote (`slipSteps`) and every played pad's own
   * `displacementSteps` name that same step.
   */
  it('example: when every played pad shares one displacementSteps k, slipSteps equals k too', () => {
    const runPlan = plan()
    const k = 1
    const hits = play(runPlan, () => k * runPlan.nominalSubdivisionMs)
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBe(k)
    for (const padRow of result.pads) {
      if (padRow.hits === 0) continue
      expect(padRow.displacementSteps).toBe(k)
    }
  })
})

/**
 * Roadmap DR-07 tail / DR-03: `GrooveHit.velocity` and `GroovePadResult.dynamics`.
 * The one property that matters most is negative: dynamics grading must never
 * leak into any OTHER field this module has produced since T.17 — a learner's
 * touch should never change whether a run is called steady, matched, or
 * displaced.
 */
describe('gradeGrooveRun: dynamics grading (DR-07 tail / DR-03)', () => {
  it('property: every field except pads[].dynamics is unaffected by hit velocity, for any hit set', () => {
    const grooveArb = fc.constantFrom(...referenceGrooves())
    const hitArb = fc.record({
      pad: fc.constantFrom<MappedDrumPad>('kick', 'snare', 'hhClosed', 'hhOpen', 'tomHigh'),
      ms: fc.integer({ min: -200, max: 6500 }),
      velocity: fc.option(fc.integer({ min: 1, max: 127 }), { nil: undefined }),
    })
    fc.assert(
      fc.property(grooveArb, fc.array(hitArb, { maxLength: 30 }), (score, rawHits) => {
        const runPlan = planGrooveRun(score, 80)
        // `exactOptionalPropertyTypes`: `GrooveHit.velocity` must be OMITTED
        // when absent, never present-with-value-`undefined` — `fc.option`'s
        // `nil: undefined` produces the latter, so build the hit literal
        // conditionally rather than spreading the raw record.
        const withVelocity: GrooveHit[] = rawHits.map(({ pad, ms, velocity }) =>
          velocity === undefined ? { pad, ms } : { pad, ms, velocity },
        )
        const withVelocityResult = gradeGrooveRun(runPlan, withVelocity)
        const withoutVelocity = gradeGrooveRun(
          runPlan,
          rawHits.map(({ pad, ms }) => ({ pad, ms })),
        )
        const strip = (result: ReturnType<typeof gradeGrooveRun>) => ({
          ...result,
          pads: result.pads.map(({ dynamics: _dynamics, ...rest }) => rest),
        })
        expect(strip(withVelocityResult)).toEqual(strip(withoutVelocity))
      }),
    )
  })

  /**
   * Ghost Funk's snare is the fixture this whole feature exists for: 2 accent
   * + 8 ghost notes per bar (`referenceGrooves.ts`), doubled over the default
   * two graded bars. Every hit struck at 96 — a plain, unmodified velocity
   * (`velocityClassOf(96) === 'normal'`, confirmed below rather than assumed)
   * — so every accent/ghost-expected instant classifies 'normal' and is
   * wrong, while the surrounding all-'normal' hi-hat/kick rows grade nothing.
   * Timing is exact throughout, so `steady` is true: dynamics never move it
   * (see `GroovePadResult.dynamics`'s own doc on `grade.ts`).
   */
  it('ghost-funk at exact timing, every hit velocity 96: snare dynamics reproduce the expected counts, all else steady', () => {
    expect(velocityClassOf(96)).toBe('normal')
    const funkPlan = planGrooveRun(ghostFunkBar(), 80)
    const hits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms, velocity: 96 })),
    )
    const result = gradeGrooveRun(funkPlan, hits)
    expect(result.steady).toBe(true)

    const snarePlan = funkPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return
    const expectedGhosts = snarePlan.expectedDynamics.filter((d) => d === 'ghost').length
    const expectedAccents = snarePlan.expectedDynamics.filter((d) => d === 'accent').length
    const expectedNormalsSnare = snarePlan.expectedDynamics.filter((d) => d === 'normal').length
    expect(expectedGhosts).toBeGreaterThan(0)
    expect(expectedAccents).toBeGreaterThan(0)

    expect(row(result, 'snare')?.dynamics).toEqual({
      graded: expectedGhosts + expectedAccents,
      wrong: expectedGhosts + expectedAccents,
      softWanted: expectedGhosts,
      loudWanted: expectedAccents,
      ghostInstants: expectedGhosts,
      accentInstants: expectedAccents,
      unclassified: 0,
      // Velocity 96 ('normal' class) landed on every matched instant,
      // including any plain snare strokes this pattern notates — counted
      // for over-accenting (RED-1) but never loud, since 96 is not the
      // accent class.
      normalInstants: expectedNormalsSnare,
      loudNormals: 0,
    })

    // Ghost Funk never notates accent/ghost on the hi-hat or kick: nothing to
    // grade there — but every one of their own instants IS notated 'normal'
    // and was struck at velocity 96, so `normalInstants` counts all of them
    // (RED-1's field exists precisely so a caller can tell "every plain
    // stroke was played" from "every plain stroke was played LOUD" — see
    // `loudNormals` staying 0 below).
    for (const pad of ['hhClosed', 'kick'] as const) {
      const padPlan = funkPlan.pads.find((p) => p.pad === pad)
      expect(padPlan).toBeDefined()
      if (padPlan === undefined) continue
      const expectedNormals = padPlan.expectedDynamics.filter((d) => d === 'normal').length
      // Guard: this pad's plan really does notate only 'normal' — if a future
      // content change ever added an accent/ghost here, this test's own
      // assumption (nothing to grade on hhClosed/kick) would be silently stale.
      expect(expectedNormals).toBe(padPlan.expectedDynamics.length)
      expect(row(result, pad)?.dynamics).toEqual({
        graded: 0,
        wrong: 0,
        softWanted: 0,
        loudWanted: 0,
        ghostInstants: 0,
        accentInstants: 0,
        unclassified: 0,
        normalInstants: expectedNormals,
        loudNormals: 0,
      })
    }
  })

  it('every stroke played at the velocity its own notated dynamics implies: wrong is 0 on every pad', () => {
    const funkPlan = planGrooveRun(ghostFunkBar(), 80)
    const hits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms, i) => ({
        pad: padPlan.pad,
        ms,
        velocity: defaultVelocityForClass(padPlan.expectedDynamics[i] ?? 'normal'),
      })),
    )
    const result = gradeGrooveRun(funkPlan, hits)
    for (const padRow of result.pads) {
      expect(padRow.dynamics.wrong).toBe(0)
    }
  })

  /**
   * SPEC CHANGE, review round 3 (RED 3): an absent velocity used to classify
   * as 'normal' (wrong against every notated ghost/accent, as this test used
   * to assert). It is now UNCLASSIFIED instead — excluded from
   * graded/ghostInstants/accentInstants/wrong entirely, not merely "wrong" —
   * because the on-screen mouse pad (`hit(pad)`, `useGrooveRun.ts`) gives no
   * velocity at all, and a mouse learner on ghost-funk must not be told their
   * dynamics are wrong when the input device cannot express dynamics in the
   * first place. See `dynamics.ts`'s `padDynamics` doc for the full rule.
   */
  it('an absent velocity is unclassified, not normal — excluded from ghost-funk snare dynamics entirely', () => {
    const funkPlan = planGrooveRun(ghostFunkBar(), 80)
    const hits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) => padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms })))
    const result = gradeGrooveRun(funkPlan, hits)
    const snarePlan = funkPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return
    const expectedGhosts = snarePlan.expectedDynamics.filter((d) => d === 'ghost').length
    const expectedAccents = snarePlan.expectedDynamics.filter((d) => d === 'accent').length
    expect(row(result, 'snare')?.dynamics).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      // Every notated ghost/accent instant matched, none classified —
      // see the SPEC CHANGE note above `it`.
      unclassified: expectedGhosts + expectedAccents,
      // No velocity anywhere -> nothing lands in the normal class either.
      normalInstants: 0,
      loudNormals: 0,
    })
  })

  /**
   * Review round 3, RED 1: the reviewer's exact case. `pair()` at step 0
   * (unshifted) pairs late ghost strokes with neighbouring accent instants
   * once the whole pattern is displaced by whole grid steps — every hit
   * played at its own notated dynamics' default velocity, but +2 steps late,
   * used to come out with a false dynamics complaint on top of the true
   * "pattern sat 2 sixteenths behind" one. `grade.ts` now grades dynamics at
   * each pad's EFFECTIVE shift (`slipSteps` when defined, else that pad's own
   * `displacementSteps`, else 0) rather than always at step 0, so a perfectly
   * (if lately) played pattern must show `wrong: 0` on every pad, and the
   * whole-pattern shift must actually be detected as +2 — asserted directly,
   * not assumed, per the review's own requirement.
   */
  it('example: reviewer\'s case — ghost-funk, every hit at its own notated dynamics, whole pattern +2 steps late: wrong 0 everywhere, slipSteps 2', () => {
    const funkPlan = planGrooveRun(ghostFunkBar(), 80)
    const hits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms, i) => ({
        pad: padPlan.pad,
        ms: ms + 2 * funkPlan.nominalSubdivisionMs,
        velocity: defaultVelocityForClass(padPlan.expectedDynamics[i] ?? 'normal'),
      })),
    )
    const result = gradeGrooveRun(funkPlan, hits)
    expect(result.slipSteps).toBe(2)
    for (const padRow of result.pads) {
      expect(padRow.dynamics.wrong).toBe(0)
    }
  })

  /**
   * Amber, review round 3: the `?? displacementSteps` arm of `effectiveStep`
   * (`grade.ts`: `slipSteps ?? displacementSteps ?? 0`), exercised on its
   * own. Only the snare is displaced, by a whole +2 grid steps, played at its
   * own correct notated dynamics; kick and hi-hat stay exactly on the
   * nominal grid. One pad alone disagreeing with the rest is exactly what
   * denies `runSlipSteps` a whole-pattern vote, so `slipSteps` stays
   * `undefined` — snare's dynamics pairing has nothing to inherit from the
   * run-wide shift and must fall through to its OWN `displacementSteps`
   * instead, which is what actually lets its dynamics grade correctly here.
   */
  it('example: only the snare is shifted +2 (others on grid) — slipSteps undefined, snare displacementSteps 2, its dynamics grade at that shift', () => {
    const funkPlan = planGrooveRun(ghostFunkBar(), 80)
    const snarePlan = funkPlan.pads.find((p) => p.pad === 'snare')
    expect(snarePlan).toBeDefined()
    if (snarePlan === undefined) return
    const expectedGraded = snarePlan.expectedDynamics.filter((d) => d !== 'normal').length
    expect(expectedGraded).toBeGreaterThan(0)

    const hits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) => {
      if (padPlan.pad !== 'snare') return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms }))
      return padPlan.expectedMs.map((ms, i) => ({
        pad: padPlan.pad,
        ms: ms + 2 * funkPlan.nominalSubdivisionMs,
        velocity: defaultVelocityForClass(padPlan.expectedDynamics[i] ?? 'normal'),
      }))
    })
    const result = gradeGrooveRun(funkPlan, hits)
    expect(result.slipSteps).toBeUndefined()
    const snareRow = row(result, 'snare')
    expect(snareRow?.displacementSteps).toBe(2)
    expect(snareRow?.dynamics.wrong).toBe(0)
    expect(snareRow?.dynamics.graded).toBe(expectedGraded)
  })

  /**
   * Review round 3, RED 1: the same +2-steps-late displacement, but every hit
   * struck at a flat 96 (a plain, unmodified "normal" velocity) instead of
   * each instant's own notated dynamics — the companion case to the
   * unshifted version above (`'ghost-funk at exact timing, every hit velocity
   * 96'`). `softWanted` (ghosts played too loud) must come out identical to
   * that unshifted case: the +2 shift only moves WHEN the grader looks for
   * each hit, never WHAT it expected there, since `shiftedExpectedMs` shifts
   * and re-swings the tick grid but never reorders it relative to
   * `expectedDynamics` (`slipShift.ts`).
   */
  it('example: ghost-funk, every hit velocity 96, whole pattern +2 steps late — snare softWanted matches the unshifted all-96 case', () => {
    const funkPlan = planGrooveRun(ghostFunkBar(), 80)
    const unshiftedHits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms, velocity: 96 })),
    )
    const unshiftedResult = gradeGrooveRun(funkPlan, unshiftedHits)
    const unshiftedSoftWanted = row(unshiftedResult, 'snare')?.dynamics.softWanted
    expect(unshiftedSoftWanted).toBeGreaterThan(0)

    const shiftedHits: GrooveHit[] = funkPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + 2 * funkPlan.nominalSubdivisionMs, velocity: 96 })),
    )
    const shiftedResult = gradeGrooveRun(funkPlan, shiftedHits)
    expect(shiftedResult.slipSteps).toBe(2)
    expect(row(shiftedResult, 'snare')?.dynamics.softWanted).toBe(unshiftedSoftWanted)
  })

  /**
   * Review round 3, RED 1: the general property behind both example tests
   * above. For every reference groove and jazz drill, a run played at each
   * instant's own notated-dynamics default velocity, shifted by a whole
   * number of grid steps `k` (still inside the acceptance window — no drop,
   * no jitter, so `slipSteps` is forced to resolve to exactly `k`, never
   * `undefined` or some other step, on every pad that has any hits at all),
   * must grade `wrong: 0` on every pad, whatever `k` turns out to be —
   * computed per run via `result.slipSteps`, never assumed to be `k` outright
   * (a groove with too few pads/instants to clear `SLIP_COVERAGE` could in
   * principle vote for a different step or land on `undefined`; the
   * conditional guards exactly that).
   */
  it('property: a perfectly-played (if displaced) run grades wrong 0 on every pad whenever slipSteps resolves to the shift it was built with', () => {
    const scores = [...referenceGrooves(), ...jazzRideDrills().map((drill) => drill.score)]
    fc.assert(
      fc.property(
        fc.constantFrom(...scores),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -MAX_SLIP_STEPS, max: MAX_SLIP_STEPS }),
        (score, bpm, k) => {
          const runPlan = planGrooveRun(score, bpm)
          const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) => {
            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              k,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
            )
            return shifted.map((ms, i) => ({
              pad: padPlan.pad,
              ms,
              velocity: defaultVelocityForClass(padPlan.expectedDynamics[i] ?? 'normal'),
            }))
          })
          const result = gradeGrooveRun(runPlan, hits)
          if (result.slipSteps !== k) return // not this run's business — see doc above
          for (const padRow of result.pads) {
            if (padRow.hits === 0) continue
            expect(padRow.dynamics.wrong).toBe(0)
          }
        },
      ),
      { seed: 20260919, numRuns: 200 },
    )
  })
})

/**
 * DR-07 between-grid: `GroovePadResult.looseOffsetMs` (roadmap DR-08/DR-11).
 * `padLooseOffset` itself is proven in `betweenGrid.test.ts`; this describe
 * block is about the WIRING in `gradeGrooveRun` — that the field is
 * populated from the right inputs, gated on the right condition, and
 * (the load-bearing claim) that adding it changes nothing else.
 */
describe('gradeGrooveRun: pads[].looseOffsetMs (DR-07 between-grid)', () => {
  /**
   * `referencePadResult` reconstructs every OTHER field of one pad's
   * `GroovePadResult` independently, using only the same pre-existing,
   * exported building blocks `gradeGrooveRun` itself calls for those fields
   * (`pair`, `padDisplacementSteps`, `shiftedExpectedMs`, `padDynamics`) —
   * never by importing or re-running `gradeGrooveRun`'s own private code.
   * Deliberately narrower than `gradeGrooveRun`'s full machinery: it has no
   * articulation-slip pass, so it is only valid for hit sets that cannot
   * trigger one. The property test below guarantees that by construction
   * (see its own doc) rather than by asserting it here.
   */
  function referencePadResult(
    padPlan: GroovePadPlan,
    hits: readonly { readonly ms: number; readonly velocity?: number }[],
    runPlan: GrooveRunPlan,
    slipSteps: number | undefined,
  ): Omit<GroovePadResult, 'looseOffsetMs' | 'slipped'> {
    const sortedHits = [...hits].sort((a, b) => a.ms - b.ms)
    const hitsMs = sortedHits.map((h) => h.ms)
    const { offsets, matched, unmatchedExpected, unmatchedHits } = pair(padPlan.expectedMs, hitsMs, runPlan.windowMs)
    const sortedOffsets = offsets.map((o) => o.offset) // pair()'s own offsets are already instant-ordered
    const meanOf = (values: readonly number[]): number =>
      values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length
    const meanOffsetMs = sortedOffsets.length === 0 ? undefined : meanOf(sortedOffsets)
    const spreadMs =
      sortedOffsets.length === 0
        ? undefined
        : Math.sqrt(meanOf(sortedOffsets.map((v) => (v - meanOf(sortedOffsets)) ** 2)))
    const driftMs =
      sortedOffsets.length < 4
        ? undefined
        : (() => {
            const half = Math.floor(sortedOffsets.length / 2)
            return (
              meanOf(sortedOffsets.slice(sortedOffsets.length - half)) - meanOf(sortedOffsets.slice(0, half))
            )
          })()
    const displacementSteps = padDisplacementSteps(
      padPlan.expectedNominalTicks,
      hitsMs,
      runPlan.windowMs,
      runPlan.nominalSubdivisionTicks,
      runPlan.swing,
      runPlan.msPerTick,
      MAX_SLIP_STEPS,
    )
    const effectiveStep = slipSteps ?? displacementSteps ?? 0
    const dynamicsOffsets =
      effectiveStep === 0
        ? offsets
        : pair(
            shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              effectiveStep,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
            ),
            hitsMs,
            runPlan.windowMs,
          ).offsets
    const dynamics = padDynamics(
      dynamicsOffsets.map((o) => ({ expectedIndex: o.expectedIndex, velocity: sortedHits[o.hitIndex]?.velocity })),
      padPlan.expectedDynamics,
    )
    return {
      pad: padPlan.pad,
      expected: padPlan.expectedMs.length,
      hits: hitsMs.length,
      matched,
      missed: unmatchedExpected.length,
      extra: unmatchedHits.length,
      meanOffsetMs,
      spreadMs,
      driftMs,
      displacementSteps,
      dynamics,
    }
  }

  /**
   * The property the whole slice exists to prove: stripping `looseOffsetMs`
   * off every pad of a real `gradeGrooveRun` result deep-equals the SAME
   * fields built independently via `referencePadResult` above — i.e. every
   * pre-existing field is exactly what the pre-existing public pieces alone
   * would produce, with no trace of the new code.
   *
   * Generated hits never leave their own pad (no stray cross-pad extras),
   * so the articulation-slip pass — which `referencePadResult` does not
   * model — always finds `extraHits` empty on every pad and is a structural
   * no-op (see `applyArticulationSlips`'s own guard clause); `slipped` is
   * therefore always 0 and is asserted so directly rather than reconstructed.
   *
   * This is the STRONGER of the two proofs the contract allows: it does not
   * depend on `git show HEAD`, so it stays valid after this slice is
   * committed and the tree moves on — a HEAD-diff-based check would not.
   */
  it('property: every field but looseOffsetMs matches an independent reconstruction from pair/padDisplacementSteps/padDynamics, over reference grooves, jazz drills, and reading-generated plans (levels 1-7)', () => {
    // `moneyBeatOpenHat` is the one reference groove that carries BOTH
    // hi-hat articulation siblings (`hhOpen` and `hhClosed`) on the same
    // interleaved eighth grid — shifting its hits by a whole nominal step
    // (below) can land an `hhClosed` hit exactly on an `hhOpen` instant's
    // own grid slot, which `applyArticulationSlips` correctly reassigns as
    // a slip. That is real, desired behaviour (covered by its own describe
    // block above), but `referencePadResult` does not model the slip pass,
    // so this property excludes any score `referencePadResult` cannot
    // stand in for — i.e. one where two sibling pads share a score.
    const grooveScores = [...referenceGrooves(), ...jazzRideDrills().map((drill) => drill.score)].filter(
      (score) => !(new Set(score.notes.map((n) => n.pad)).has('hhOpen') && new Set(score.notes.map((n) => n.pad)).has('hhClosed')),
    )
    const readingPlans = ([1, 2, 3, 4, 5, 6, 7] as const).flatMap((level) =>
      [1, 2, 3].map((seed) => {
        const score = generateReadingExercise({ level, measures: 2, id: `dr07-btwn-${level}-${seed}` }, seededRng(seed))
        return { score, bpm: 80, gradedBars: score.measures.length }
      }),
    )
    const DROP_PERCENT = 20
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...grooveScores).map((score) => ({ score, bpm: undefined as number | undefined, gradedBars: undefined as number | undefined })),
          fc.constantFrom(...readingPlans),
        ),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: -MAX_SLIP_STEPS, max: MAX_SLIP_STEPS }),
        fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 200, maxLength: 200 }),
        fc.array(fc.integer({ min: -400, max: 400 }), { minLength: 200, maxLength: 200 }),
        (spec, randomBpm, step, dropRolls, jitterRolls) => {
          const bpm = spec.bpm ?? randomBpm
          const runPlan =
            spec.gradedBars === undefined
              ? planGrooveRun(spec.score, bpm)
              : planGrooveRun(spec.score, bpm, { gradedBars: spec.gradedBars })

          let rollIndex = 0
          const hitsByPad = new Map<MappedDrumPad, { readonly ms: number; readonly velocity?: number }[]>()
          const hits: GrooveHit[] = []
          for (const padPlan of runPlan.pads) {
            const shifted = shiftedExpectedMs(
              padPlan.expectedNominalTicks,
              step,
              runPlan.nominalSubdivisionTicks,
              runPlan.swing,
              runPlan.msPerTick,
            )
            const list = hitsByPad.get(padPlan.pad) ?? []
            for (let i = 0; i < shifted.length; i++) {
              const shiftedMs = shifted[i]
              if (shiftedMs === undefined) continue
              const dropRoll = dropRolls[rollIndex % dropRolls.length] ?? 0
              const jitterRoll = jitterRolls[rollIndex % jitterRolls.length] ?? 0
              rollIndex++
              if (dropRoll < DROP_PERCENT) continue
              const ms = shiftedMs + jitterRoll
              // No `velocity` field at all — dynamics grading must treat it
              // as unclassified, same as a mouse/touch stroke, so `dynamics`
              // is exercised without needing a separate velocity model here.
              list.push({ ms })
              hits.push({ pad: padPlan.pad, ms })
            }
            hitsByPad.set(padPlan.pad, list)
          }

          const result = gradeGrooveRun(runPlan, hits)

          for (const padRow of result.pads) {
            expect(padRow.slipped).toBe(0) // no cross-pad extras were ever generated — see doc above
            const { looseOffsetMs: _looseOffsetMs, slipped: _slipped, ...rest } = padRow
            const padPlan = runPlan.pads.find((p) => p.pad === padRow.pad)
            const reference = referencePadResult(
              padPlan ?? { pad: padRow.pad, loopTicks: [], expectedMs: [], expectedNominalMs: [], expectedNominalTicks: [], expectedDynamics: [] },
              hitsByPad.get(padRow.pad) ?? [],
              runPlan,
              result.slipSteps,
            )
            expect(rest).toEqual(reference)

            // The gate itself: present only when nothing more specific
            // already explains this pad, and only when the underlying
            // `padLooseOffset` call itself agrees.
            const expectedLoose =
              padRow.displacementSteps === undefined && result.slipSteps === undefined
                ? padLooseOffset(
                    padPlan?.expectedMs ?? [],
                    (hitsByPad.get(padRow.pad) ?? []).map((h) => h.ms),
                    runPlan.windowMs,
                    runPlan.nominalSubdivisionMs,
                  )?.meanOffsetMs
                : undefined
            expect(padRow.looseOffsetMs).toBe(expectedLoose)
            expect('looseOffsetMs' in padRow).toBe(expectedLoose !== undefined)
          }
        },
      ),
      { seed: 20260919, numRuns: 150 },
    )
  })

  /**
   * Example: money beat at 100 bpm — a bpm where the hi-hat's eighth cell
   * (`nominalSubdivisionMs`) clears `nominalSubdivisionMs / 2 > windowMs`
   * (asserted below, not assumed), so a between-grid band genuinely exists.
   * Snare plays every one of its (quarter-note) strokes 130 ms late; kick
   * and hi-hat play exactly on time.
   */
  it('example: money beat 100 bpm, snare uniformly +130 ms — snare gets looseOffsetMs, kick/hat do not', () => {
    const runPlan = planGrooveRun(moneyBeat(), 100)
    expect(runPlan.nominalSubdivisionMs / 2).toBeGreaterThan(runPlan.windowMs)

    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: padPlan.pad === 'snare' ? ms + 130 : ms })),
    )
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBeUndefined()

    const snareRow = result.pads.find((p) => p.pad === 'snare')
    const kickRow = result.pads.find((p) => p.pad === 'kick')
    const hatRow = result.pads.find((p) => p.pad === 'hhClosed')

    expect(snareRow?.displacementSteps).toBeUndefined()
    expect(snareRow?.looseOffsetMs).toBeCloseTo(130, 6)
    expect(kickRow).toBeDefined()
    expect(hatRow).toBeDefined()
    if (kickRow !== undefined) expect('looseOffsetMs' in kickRow).toBe(false)
    if (hatRow !== undefined) expect('looseOffsetMs' in hatRow).toBe(false)
  })

  it('example: the whole pattern shifted one nominal step — every pad gets slipSteps, not looseOffsetMs', () => {
    const runPlan = planGrooveRun(moneyBeat(), 100)
    const hits = runPlan.pads.flatMap((padPlan) =>
      shiftedExpectedMs(
        padPlan.expectedNominalTicks,
        1,
        runPlan.nominalSubdivisionTicks,
        runPlan.swing,
        runPlan.msPerTick,
      ).map((ms) => ({ pad: padPlan.pad, ms })),
    )
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBe(1)
    for (const padRow of result.pads) {
      if (padRow.hits === 0) continue
      expect('looseOffsetMs' in padRow).toBe(false)
    }
  })
})
