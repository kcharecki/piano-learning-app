import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { moneyBeat, moneyBeatOpenHat } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { mutedStrikes, VOICED_VELOCITY } from './mutedVoices.ts'

const PLANS: readonly [string, GrooveRunPlan][] = [
  ['moneyBeat', planGrooveRun(moneyBeat(), 80)],
  ['moneyBeatOpenHat', planGrooveRun(moneyBeatOpenHat(), 80)],
]

describe('VOICED_VELOCITY', () => {
  it('sits under the learner’s own hit velocity and above a ghost', () => {
    expect(VOICED_VELOCITY).toBeLessThan(96)
    expect(VOICED_VELOCITY).toBeGreaterThan(0)
  })
})

describe('mutedStrikes', () => {
  it('is empty for an empty muted set', () => {
    for (const [, plan] of PLANS) {
      expect(mutedStrikes(plan, new Set(), 12_345)).toEqual([])
    }
  })

  it('is one instant per muted pad’s expectedMs, offset by originMs, sorted by instant then pad', () => {
    const [, plan] = PLANS[1] as [string, GrooveRunPlan]
    const originMs = 6000
    const muted = new Set<MappedDrumPad>(['hhClosed', 'kick'])
    const strikes = mutedStrikes(plan, muted, originMs)

    // Every muted pad's every expected instant is present, offset by
    // `originMs` — a plain loop plus `toContainEqual`, not the same
    // filter/flatMap/sort expression `mutedStrikes` itself uses.
    let expectedCount = 0
    for (const padPlan of plan.pads) {
      if (!muted.has(padPlan.pad)) continue
      for (const ms of padPlan.expectedMs) {
        expect(strikes).toContainEqual({ pad: padPlan.pad, atMs: originMs + ms })
        expectedCount += 1
      }
    }
    expect(strikes.length).toBe(expectedCount)

    // Sorted, and never mentions a pad outside the muted set.
    for (let i = 1; i < strikes.length; i++) {
      const prev = strikes[i - 1]
      const curr = strikes[i]
      if (prev === undefined || curr === undefined) continue
      expect(curr.atMs).toBeGreaterThanOrEqual(prev.atMs)
    }
    for (const strike of strikes) {
      expect(muted.has(strike.pad)).toBe(true)
    }
  })

  it('property: the count of instants equals the sum of expectedMs.length over muted pads, for any subset and origin', () => {
    for (const [, plan] of PLANS) {
      const allPads = plan.pads.map((padPlan) => padPlan.pad)
      fc.assert(
        fc.property(
          fc.subarray(allPads),
          fc.integer({ min: -10_000, max: 10_000 }),
          (mutedList: readonly MappedDrumPad[], originMs: number) => {
            const muted = new Set(mutedList)
            const strikes = mutedStrikes(plan, muted, originMs)
            const expectedCount = plan.pads
              .filter((padPlan) => muted.has(padPlan.pad))
              .reduce((sum, padPlan) => sum + padPlan.expectedMs.length, 0)
            expect(strikes.length).toBe(expectedCount)
            for (const strike of strikes) {
              expect(muted.has(strike.pad)).toBe(true)
            }
          },
        ),
      )
    }
  })
})
