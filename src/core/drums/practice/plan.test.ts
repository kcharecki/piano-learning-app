import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeGrooveScore } from '@core/drums/model/groove.ts'
import {
  ghostFunkBar,
  moneyBeat,
  moneyBeatOpenHat,
  quarterNoteRock,
  referenceGrooves,
} from '@core/drums/model/referenceGrooves.ts'
import { MAX_BPM, MIN_BPM, planGrooveRun, subdivisionTicks } from './plan.ts'

/**
 * The instants and the window. Every literal here is worked out from the
 * tempo by hand rather than read back from the module under test: at 80 bpm a
 * quarter is 750 ms, an eighth 375 ms, a 4/4 bar 3000 ms.
 */

const padPlan = (score: Parameters<typeof planGrooveRun>[0], bpm: number, pad: string) =>
  planGrooveRun(score, bpm).pads.find((p) => p.pad === pad)

describe('subdivisionTicks', () => {
  it('is the smallest gap between two distinct notated instants, over the whole score', () => {
    expect(subdivisionTicks(quarterNoteRock())).toBe(480)
    expect(subdivisionTicks(moneyBeat())).toBe(240)
    expect(subdivisionTicks(moneyBeatOpenHat())).toBe(240)
    expect(subdivisionTicks(ghostFunkBar())).toBe(120)
  })

  it('counts the wrap back into the next loop, because a groove is a loop', () => {
    // Notes on 1 and 2 only: the widest gap inside the bar is 1440 ticks, but
    // the learner plays straight on into the next bar, where beat 1 arrives
    // 960 ticks after beat 2. That wrap is the real grid.
    const score = makeGrooveScore({
      id: 'front-loaded',
      measureCount: 1,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 480 },
        { pad: 'snare', tick: 480, durationTicks: 480 },
      ],
    })
    expect(subdivisionTicks(score)).toBe(480)
  })

  it('falls back to the whole loop when the score has a single distinct instant', () => {
    const score = makeGrooveScore({
      id: 'one-hit',
      measureCount: 1,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 480 },
        { pad: 'snare', tick: 0, durationTicks: 480 },
      ],
    })
    expect(subdivisionTicks(score)).toBe(1920)
  })
})

describe('planGrooveRun', () => {
  it('lays the money beat out at 80 bpm exactly where the ear expects it', () => {
    const plan = planGrooveRun(moneyBeat(), 80)
    expect(plan.beatMs).toBe(750)
    expect(plan.barMs).toBe(3000)
    expect(plan.gradedBars).toBe(2)
    expect(plan.gradedMs).toBe(6000)
    expect(plan.countInBeats).toBe(4)
    expect(plan.subdivisionMs).toBe(375)

    expect(padPlan(moneyBeat(), 80, 'hhClosed')?.expectedMs).toEqual([
      0, 375, 750, 1125, 1500, 1875, 2250, 2625, 3000, 3375, 3750, 4125, 4500, 4875, 5250, 5625,
    ])
    expect(padPlan(moneyBeat(), 80, 'kick')?.expectedMs).toEqual([0, 1500, 3000, 4500])
    expect(padPlan(moneyBeat(), 80, 'snare')?.expectedMs).toEqual([750, 2250, 3750, 5250])
  })

  it('grades the open-hat groove at 70 bpm with the open hat on its own pad', () => {
    const eighth = 60_000 / 70 / 2
    const plan = planGrooveRun(moneyBeatOpenHat(), 70)
    expect(plan.barMs).toBeCloseTo(eighth * 8, 6)

    const closed = plan.pads.find((p) => p.pad === 'hhClosed')
    const open = plan.pads.find((p) => p.pad === 'hhOpen')
    expect(closed?.expectedMs).toHaveLength(14)
    expect(open?.expectedMs).toHaveLength(2)
    expect(open?.expectedMs[0]).toBeCloseTo(7 * eighth, 6)
    expect(open?.expectedMs[1]).toBeCloseTo(15 * eighth, 6)
  })

  it('advertises the stated tolerance when the groove is coarse enough to honour it', () => {
    expect(planGrooveRun(quarterNoteRock(), 80).windowMs).toBe(100)
    expect(planGrooveRun(moneyBeat(), 80).windowMs).toBe(100)
  })

  /**
   * T.17.1, the fault that killed the first attempt at this feature twice.
   * Ghost Funk's kick sits on "1 a 3 a": its OWN smallest gap is 360 ticks, a
   * dotted eighth, 562.5 ms at 80 bpm. A window derived from that let straight
   * quarters grade 8 of 8 against a syncopated part. The window is the score's
   * grid, so the kick gets the same sixteenth-derived window as the hi-hat.
   */
  it('derives the window from the score grid, never from a sparse pad own gaps', () => {
    const plan = planGrooveRun(ghostFunkBar(), 80)
    expect(plan.subdivisionMs).toBe(187.5)
    expect(plan.windowMs).toBe(93.75)

    const kick = plan.pads.find((p) => p.pad === 'kick')
    const kickGaps = (kick?.expectedMs ?? []).slice(1).map((ms, i) => ms - (kick?.expectedMs[i] ?? 0))
    expect(Math.min(...kickGaps)).toBeGreaterThan(plan.windowMs * 4)
  })

  it('names only the pads the score writes on a shared instant as unison pairs', () => {
    const pairs = planGrooveRun(moneyBeat(), 80).unisonPairs.map((pair) => pair.join('+'))
    expect(pairs).toContain('hhClosed+kick')
    expect(pairs).toContain('hhClosed+snare')
    // The money beat never sounds kick and snare together. A flam sentence
    // that names them is describing a coincidence, not the score (T.17.2).
    expect(pairs).not.toContain('kick+snare')
    expect(pairs).not.toContain('snare+kick')
  })

  it('loops a one-bar groove to fill the graded window and stops on the bar line', () => {
    const plan = planGrooveRun(moneyBeat(), 80, { gradedBars: 3 })
    expect(plan.gradedMs).toBe(9000)
    expect(plan.pads.find((p) => p.pad === 'kick')?.expectedMs).toEqual([0, 1500, 3000, 4500, 6000, 7500])
  })

  it('refuses a tempo outside the trainer range', () => {
    expect(() => planGrooveRun(moneyBeat(), MIN_BPM - 1)).toThrow()
    expect(() => planGrooveRun(moneyBeat(), MAX_BPM + 1)).toThrow()
    expect(() => planGrooveRun(moneyBeat(), Number.NaN)).toThrow()
  })

  /**
   * The property `grade.ts` relies on for single-pass matching: no two
   * instants for one pad have overlapping windows. It holds because the
   * window is capped at half the SCORE's subdivision and a pad's own instants
   * are at least a subdivision apart.
   */
  it('never opens a window wide enough for two instants of one pad to share a hit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: referenceGrooves().length - 1 }),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: 10, max: 400 }),
        (index, bpm, toleranceMs) => {
          const score = referenceGrooves()[index]
          if (score === undefined) return
          const plan = planGrooveRun(score, bpm, { toleranceMs })
          expect(plan.windowMs).toBeLessThanOrEqual(plan.subdivisionMs / 2 + 1e-9)
          expect(plan.windowMs).toBeLessThanOrEqual(toleranceMs)
          for (const pad of plan.pads) {
            for (let i = 1; i < pad.expectedMs.length; i++) {
              const gap = (pad.expectedMs[i] ?? 0) - (pad.expectedMs[i - 1] ?? 0)
              expect(gap).toBeGreaterThanOrEqual(plan.windowMs * 2 - 1e-9)
            }
          }
        },
      ),
    )
  })

  it('keeps every expected instant inside the graded window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: referenceGrooves().length - 1 }),
        fc.integer({ min: MIN_BPM, max: MAX_BPM }),
        fc.integer({ min: 1, max: 4 }),
        (index, bpm, gradedBars) => {
          const score = referenceGrooves()[index]
          if (score === undefined) return
          const plan = planGrooveRun(score, bpm, { gradedBars })
          for (const pad of plan.pads) {
            for (const ms of pad.expectedMs) {
              expect(ms).toBeGreaterThanOrEqual(0)
              expect(ms).toBeLessThan(plan.gradedMs)
            }
          }
        },
      ),
    )
  })
})
