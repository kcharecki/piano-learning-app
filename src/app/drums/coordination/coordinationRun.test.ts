import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { moneyBeat } from '@core/drums/model/referenceGrooves.ts'
import { singleKickPermutations } from '@core/drums/coordination/permutations.ts'
import { layerStack } from '@core/drums/coordination/layers.ts'
import { advance, drillSteps } from './coordinationRun.ts'

describe('drillSteps', () => {
  it('layers mode maps layerStack(groove) 1:1', () => {
    const groove = moneyBeat()
    const steps = drillSteps('layers', groove)
    const stack = layerStack(groove)
    expect(steps).toHaveLength(stack.length)
    steps.forEach((step, i) => {
      expect(step.index).toBe(stack[i]?.index)
      expect(step.count).toBe(stack[i]?.count)
      expect(step.title).toBe(stack[i]?.score.title)
      expect(step.score).toEqual(stack[i]?.score)
    })
  })

  it('kicks mode returns the 16 single-kick permutation drills, ignoring the groove', () => {
    const steps = drillSteps('kicks', moneyBeat())
    const drills = singleKickPermutations()
    expect(steps).toHaveLength(16)
    steps.forEach((step, i) => {
      expect(step.count).toBe(16)
      expect(step.index).toBe(i)
      expect(step.title).toBe(drills[i]?.score.title)
    })

    // A different groove changes nothing about the kicks list.
    const other = drillSteps('kicks', moneyBeat())
    expect(other.map((s) => s.title)).toEqual(steps.map((s) => s.title))
  })
})

describe('advance', () => {
  it('a steady pass moves to the next step and raises unlocked to match', () => {
    expect(advance({ index: 0, unlocked: 0 }, true, 5)).toEqual({ index: 1, unlocked: 1 })
  })

  it('an unsteady pass changes nothing', () => {
    expect(advance({ index: 2, unlocked: 3 }, false, 5)).toEqual({ index: 2, unlocked: 3 })
  })

  it('caps index at count - 1: a steady pass on the last step does not overflow', () => {
    expect(advance({ index: 4, unlocked: 4 }, true, 5)).toEqual({ index: 4, unlocked: 4 })
  })

  it('never lowers unlocked: selecting an earlier step and passing it again does not regress progress', () => {
    expect(advance({ index: 1, unlocked: 4 }, true, 5)).toEqual({ index: 2, unlocked: 4 })
  })

  it('is a no-op for a non-positive count', () => {
    expect(advance({ index: 0, unlocked: 0 }, true, 0)).toEqual({ index: 0, unlocked: 0 })
  })

  it('property: unlocked never decreases and index stays within [0, count-1]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 21 }),
        (index, unlocked, steady, count) => {
          const state = {
            index: Math.min(index, count - 1),
            unlocked: Math.min(unlocked, count - 1),
          }
          const next = advance(state, steady, count)
          expect(next.unlocked).toBeGreaterThanOrEqual(state.unlocked)
          expect(next.index).toBeGreaterThanOrEqual(0)
          expect(next.index).toBeLessThanOrEqual(count - 1)
        },
      ),
    )
  })
})
