/**
 * `liveHit.ts` — the provisional, arrival-order verdict a hit gets the
 * instant it lands. Property tests carry the timing invariants (per the
 * project's testing rules); a handful of examples pin the tie-break and the
 * kind boundary in plain numbers.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAPPED_PADS, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { claimKey, judgeLiveHit, ON_TIME_FRACTION } from './liveHit.ts'

/** Every field `judgeLiveHit` never reads gets a placeholder value. */
function makePlan(
  pads: readonly { readonly pad: MappedDrumPad; readonly expectedMs: readonly number[] }[],
  windowMs = 50,
): GrooveRunPlan {
  return {
    grooveId: 'test-groove',
    title: 'Test groove',
    bpm: 80,
    beatMs: 750,
    barMs: 3000,
    countInBars: 1,
    countInBeats: 4,
    gradedBars: 2,
    gradedMs: 6000,
    subdivisionMs: windowMs * 4,
    windowMs,
    toleranceMs: windowMs,
    // Straight fixture throughout: nominal instants equal the swung ones,
    // same rule `plan.ts` applies when `swingPercent === 50`.
    pads: pads.map(({ pad, expectedMs }) => ({ pad, loopTicks: [], expectedMs, expectedNominalMs: expectedMs })),
    unisonPairs: [],
    swingPercent: 50,
  }
}

const mappedPad = fc.constantFrom(...MAPPED_PADS)
/** Spacing wide enough that no two instants' windows can ever overlap at the fixed windowMs=50 used throughout. */
const SPACING = 500

/** A sorted, distinct, non-empty set of instants at multiples of `SPACING`. */
const instantSteps = fc
  .uniqueArray(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 6 })
  .map((steps) => [...steps].sort((a, b) => a - b))

describe('judgeLiveHit', () => {
  it('always names the pad it was asked to judge', () => {
    fc.assert(
      fc.property(mappedPad, fc.integer({ min: -2000, max: 2000 }), (pad, ms) => {
        const plan = makePlan([{ pad, expectedMs: [0, SPACING, 2 * SPACING] }])
        const verdict = judgeLiveHit(plan, pad, ms, new Set())
        expect(verdict.pad).toBe(pad)
      }),
    )
  })

  it('when not extra, keeps the offset within the window and consistent with the claimed instant', () => {
    fc.assert(
      fc.property(
        mappedPad,
        instantSteps,
        fc.integer({ min: -3000, max: 13_000 }),
        (pad, steps, ms) => {
          const expectedMs = steps.map((step) => step * SPACING)
          const plan = makePlan([{ pad, expectedMs }])
          const verdict = judgeLiveHit(plan, pad, ms, new Set())
          if (verdict.kind === 'extra') return
          const { instantIndex, offsetMs } = verdict
          if (instantIndex === undefined || offsetMs === undefined) {
            throw new Error('a non-extra verdict must carry both an index and an offset')
          }
          expect(Math.abs(offsetMs)).toBeLessThanOrEqual(plan.windowMs)
          const instant = expectedMs[instantIndex]
          if (instant === undefined) throw new Error('instantIndex out of range')
          expect(ms - instant).toBe(offsetMs)
        },
      ),
    )
  })

  it('a hit exactly on an expected instant, with nothing claimed, reads as on time with offset 0 at that index', () => {
    fc.assert(
      fc.property(mappedPad, instantSteps, fc.nat(), (pad, steps, rawIndex) => {
        const expectedMs = steps.map((step) => step * SPACING)
        const index = rawIndex % expectedMs.length
        const plan = makePlan([{ pad, expectedMs }])
        const ms = expectedMs[index] as number
        const verdict = judgeLiveHit(plan, pad, ms, new Set())
        expect(verdict.kind).toBe('on-time')
        expect(verdict.offsetMs).toBe(0)
        expect(verdict.instantIndex).toBe(index)
      }),
    )
  })

  it('after claiming the returned instant, judging the same ms again never returns that index', () => {
    fc.assert(
      fc.property(
        mappedPad,
        instantSteps,
        fc.integer({ min: -3000, max: 13_000 }),
        (pad, steps, ms) => {
          const expectedMs = steps.map((step) => step * SPACING)
          const plan = makePlan([{ pad, expectedMs }])
          const first = judgeLiveHit(plan, pad, ms, new Set())
          if (first.kind === 'extra' || first.instantIndex === undefined) return
          const claimed = new Set([claimKey(pad, first.instantIndex)])
          const second = judgeLiveHit(plan, pad, ms, claimed)
          expect(second.instantIndex).not.toBe(first.instantIndex)
        },
      ),
    )
  })

  it('a hit further than windowMs from every instant on the pad reads as extra', () => {
    fc.assert(
      fc.property(mappedPad, instantSteps, (pad, steps) => {
        const expectedMs = steps.map((step) => step * SPACING)
        const plan = makePlan([{ pad, expectedMs }])
        // Every instant is >= 0, so this lands strictly further than windowMs
        // from all of them regardless of what `steps` picked.
        const ms = -(plan.windowMs + 1)
        const verdict = judgeLiveHit(plan, pad, ms, new Set())
        expect(verdict.kind).toBe('extra')
        expect(verdict.offsetMs).toBeUndefined()
        expect(verdict.instantIndex).toBeUndefined()
      }),
    )
  })

  it('a pad the plan does not use reads as extra, whatever ms it is struck at', () => {
    fc.assert(
      fc.property(
        mappedPad,
        mappedPad,
        fc.integer({ min: -1000, max: 1000 }),
        (planPad, hitPad, ms) => {
          fc.pre(planPad !== hitPad)
          const plan = makePlan([{ pad: planPad, expectedMs: [0, SPACING, 2 * SPACING] }])
          const verdict = judgeLiveHit(plan, hitPad, ms, new Set())
          expect(verdict.kind).toBe('extra')
        },
      ),
    )
  })

  it('ties go to the earlier instant', () => {
    // windowMs=60: a hit at ms=50 is 50 away from instant 0 and 50 away from
    // instant 100 — a genuine tie, both within the window.
    const plan = makePlan([{ pad: 'snare', expectedMs: [0, 100] }], 60)
    const verdict = judgeLiveHit(plan, 'snare', 50, new Set())
    expect(verdict.instantIndex).toBe(0)
  })

  /**
   * Nearest, not first-in-window: with two instants inside one plan, a hit
   * at ms=70 is 70 away from instant 0 — OUTSIDE the 60ms window, so instant
   * 0 is not even a candidate — and 30 away from instant 100, well inside
   * it. The nearest (and only) candidate wins, not whichever instant the
   * scan happens to reach first.
   */
  it('picks the nearest instant within the window, not the first one scanned', () => {
    const plan = makePlan([{ pad: 'snare', expectedMs: [0, 100] }], 60)
    const verdict = judgeLiveHit(plan, 'snare', 70, new Set())
    expect(verdict.instantIndex).toBe(1)
    expect(verdict.offsetMs).toBe(-30)
    expect(verdict.kind).toBe('early')
  })

  it('reads the ON_TIME_FRACTION boundary correctly: at the threshold is on time, one ms past is early or late', () => {
    const plan = makePlan([{ pad: 'kick', expectedMs: [1000] }], 100)
    const threshold = ON_TIME_FRACTION * plan.windowMs // 25ms

    expect(judgeLiveHit(plan, 'kick', 1000 + threshold, new Set()).kind).toBe('on-time')
    expect(judgeLiveHit(plan, 'kick', 1000 - threshold, new Set()).kind).toBe('on-time')
    expect(judgeLiveHit(plan, 'kick', 1000 + threshold + 1, new Set()).kind).toBe('late')
    expect(judgeLiveHit(plan, 'kick', 1000 - threshold - 1, new Set()).kind).toBe('early')
  })

  it('the window is inclusive, matching grade.ts’s own pair()', () => {
    const plan = makePlan([{ pad: 'kick', expectedMs: [1000] }], 100)
    const verdict = judgeLiveHit(plan, 'kick', 1100, new Set())
    expect(verdict.kind).toBe('late')
    expect(verdict.offsetMs).toBe(100)
    // One ms further is outside it.
    expect(judgeLiveHit(plan, 'kick', 1101, new Set()).kind).toBe('extra')
  })

  // The learner reads this number on screen ("on time" vs "early"/"late"),
  // so pin the constant itself, not just its effect on a boundary.
  it('ON_TIME_FRACTION is 0.25', () => {
    expect(ON_TIME_FRACTION).toBe(0.25)
  })

  it('claimKey is stable and distinguishes pad and index', () => {
    expect(claimKey('snare', 2)).toBe(claimKey('snare', 2))
    expect(claimKey('snare', 2)).not.toBe(claimKey('snare', 3))
    expect(claimKey('snare', 2)).not.toBe(claimKey('kick', 2))
  })
})
