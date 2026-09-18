import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { moneyBeat, moneyBeatOpenHat } from '@core/drums/model/referenceGrooves.ts'
import { mutePads, mutedPadPlans } from './mute.ts'
import { planGrooveRun, type GrooveRunPlan } from './plan.ts'

/** Every field of `GrooveRunPlan` that is NOT pad-bearing — see the module comment on `plan.ts`. */
const TIMING_FIELDS = [
  'grooveId',
  'title',
  'bpm',
  'beatMs',
  'barMs',
  'countInBars',
  'countInBeats',
  'gradedBars',
  'gradedMs',
  'subdivisionMs',
  'windowMs',
  'toleranceMs',
] as const satisfies readonly (keyof GrooveRunPlan)[]

const PLANS: readonly [string, GrooveRunPlan][] = [
  ['moneyBeat', planGrooveRun(moneyBeat(), 80)],
  ['moneyBeatOpenHat', planGrooveRun(moneyBeatOpenHat(), 80)],
]

describe('mutePads', () => {
  for (const [name, plan] of PLANS) {
    describe(name, () => {
      it('returns the same reference when nothing is muted', () => {
        expect(mutePads(plan, new Set())).toBe(plan)
      })

      it('drops muted pads from every pad-bearing field, leaves timing byte-identical, for any proper subset', () => {
        const allPads = plan.pads.map((padPlan) => padPlan.pad)
        fc.assert(
          fc.property(
            fc.subarray(allPads, { maxLength: allPads.length - 1 }),
            (mutedList: readonly MappedDrumPad[]) => {
              const muted = new Set(mutedList)
              const result = mutePads(plan, muted)

              // `pads`: no result entry names a muted pad...
              for (const padPlan of result.pads) {
                expect(muted.has(padPlan.pad)).toBe(false)
              }
              // ...and every plan entry that was NOT muted is present, byte-for-byte.
              for (const padPlan of plan.pads) {
                if (muted.has(padPlan.pad)) continue
                expect(result.pads).toContainEqual(padPlan)
              }
              // Nothing else snuck in or was dropped: the count matches a
              // plain loop over the ORIGINAL list, counted independently of
              // whatever expression `mutePads` itself filters with.
              let mutedCount = 0
              for (const padPlan of plan.pads) {
                if (muted.has(padPlan.pad)) mutedCount += 1
              }
              expect(result.pads.length).toBe(plan.pads.length - mutedCount)

              // `unisonPairs`: no surviving pair names a muted pad...
              for (const [a, b] of result.unisonPairs) {
                expect(muted.has(a) || muted.has(b)).toBe(false)
              }
              // ...and every plan pair naming neither is present.
              for (const pair of plan.unisonPairs) {
                const [a, b] = pair
                if (muted.has(a) || muted.has(b)) continue
                expect(result.unisonPairs).toContainEqual(pair)
              }

              // Every timing field is the SAME value (and, being primitives, `toBe` proves
              // "byte-identical" more strongly than a deep-equal would).
              for (const field of TIMING_FIELDS) {
                expect(result[field]).toBe(plan[field])
              }
            },
          ),
        )
      })

      it('throws when every pad in the plan would be muted', () => {
        const muted = new Set(plan.pads.map((padPlan) => padPlan.pad))
        expect(() => mutePads(plan, muted)).toThrow(/Invariant violated/)
      })
    })
  }
})

describe('mutedPadPlans', () => {
  for (const [name, plan] of PLANS) {
    it(`returns exactly the removed entries, in plan order (${name})`, () => {
      const allPads = plan.pads.map((padPlan) => padPlan.pad)
      fc.assert(
        fc.property(fc.subarray(allPads), (mutedList: readonly MappedDrumPad[]) => {
          const muted = new Set(mutedList)
          const result = mutedPadPlans(plan, muted)

          // Every returned entry names a muted pad...
          for (const padPlan of result) {
            expect(muted.has(padPlan.pad)).toBe(true)
          }
          // ...and every plan entry that IS muted is returned, byte-for-byte.
          for (const padPlan of plan.pads) {
            if (!muted.has(padPlan.pad)) continue
            expect(result).toContainEqual(padPlan)
          }
          // The order follows `plan.pads`'s own order: each returned entry's
          // index in `plan.pads` (found independently, by `findIndex`) is
          // strictly increasing across the result.
          let lastIndex = -1
          for (const padPlan of result) {
            const index = plan.pads.findIndex((p) => p.pad === padPlan.pad)
            expect(index).toBeGreaterThan(lastIndex)
            lastIndex = index
          }
        }),
      )
    })
  }
})
