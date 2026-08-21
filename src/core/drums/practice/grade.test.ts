import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ghostFunkBar, moneyBeat } from '@core/drums/model/referenceGrooves.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { gradeGrooveRun, worstUnisonGap, type GrooveHit } from './grade.ts'
import { planGrooveRun, type GrooveRunPlan } from './plan.ts'

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
})
