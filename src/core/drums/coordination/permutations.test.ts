import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import { scriptedRng } from '@test/fakes.ts'
import {
  SIXTEENTH_TICKS,
  singleKickPermutations,
  slotName,
  syncopationWeight,
  twoKickPermutations,
  type SixteenthSlot,
} from './permutations.ts'

describe('slotName', () => {
  it('names every slot in the beat/e/&/a vocabulary', () => {
    expect(slotName(0)).toBe('1')
    expect(slotName(1)).toBe('1e')
    expect(slotName(2)).toBe('1&')
    expect(slotName(3)).toBe('1a')
    expect(slotName(4)).toBe('2')
    expect(slotName(15)).toBe('4a')
  })
})

describe('syncopationWeight', () => {
  it('scores downbeats easiest, then "&", then "e"/"a"', () => {
    expect(syncopationWeight(0)).toBe(0)
    expect(syncopationWeight(2)).toBe(1)
    expect(syncopationWeight(1)).toBe(2)
    expect(syncopationWeight(3)).toBe(2)
  })

  it('adds 0.5 for the second half of the bar', () => {
    expect(syncopationWeight(0)).toBe(0)
    expect(syncopationWeight(8)).toBe(0.5)
    expect(syncopationWeight(2)).toBe(1)
    expect(syncopationWeight(10)).toBe(1.5)
  })

  it('gives no extra weight for landing in unison with the snare (slots 4 and 12)', () => {
    expect(syncopationWeight(4)).toBe(0)
    expect(syncopationWeight(12)).toBe(0.5) // downbeat base 0, plus the second-half-of-bar 0.5
  })
})

describe('singleKickPermutations', () => {
  const drills = singleKickPermutations()

  it('has exactly 16 drills, one per slot, each slot covered exactly once', () => {
    expect(drills).toHaveLength(16)
    const slots = drills.flatMap((d) => [...d.slots])
    expect([...slots].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })

  it('is sorted by (syncopationWeight asc, slot asc)', () => {
    for (let i = 1; i < drills.length; i++) {
      const prevSlot = drills[i - 1]?.slots[0]
      const currSlot = drills[i]?.slots[0]
      expect(prevSlot).toBeDefined()
      expect(currSlot).toBeDefined()
      const prevWeight = syncopationWeight(prevSlot as number)
      const currWeight = syncopationWeight(currSlot as number)
      expect(
        prevWeight < currWeight || (prevWeight === currWeight && (prevSlot as number) < (currSlot as number)),
      ).toBe(true)
    }
  })

  it('every drill has hi-hat every eighth, snare on 2 and 4, and one kick at the slot tick', () => {
    for (const drill of drills) {
      const hats = drill.score.notes.filter((n) => n.pad === 'hhClosed')
      const snares = drill.score.notes.filter((n) => n.pad === 'snare')
      const kicks = drill.score.notes.filter((n) => n.pad === 'kick')
      expect(hats.map((n) => n.tick as number)).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680])
      expect(snares.map((n) => n.tick as number)).toEqual([480, 1440])
      expect(kicks).toHaveLength(1)
      expect(kicks[0]?.tick as number).toBe((drill.slots[0] as number) * SIXTEENTH_TICKS)
    }
  })

  it('titles read "Kick on <slotName>"', () => {
    for (const drill of drills) {
      expect(drill.score.title).toBe(`Kick on ${slotName(drill.slots[0] as number)}`)
    }
  })

  it('property: every drill plans without throwing at 80 bpm and has at least one kick note', () => {
    for (const drill of drills) {
      expect(() => planGrooveRun(drill.score, 80)).not.toThrow()
      expect(drill.score.notes.filter((n) => n.pad === 'kick').length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('twoKickPermutations', () => {
  /** `(weight asc, a asc, b asc)` — the same order the contract sorts by. */
  function pairOrderKey(slots: readonly SixteenthSlot[]): [number, number, number] {
    const [a, b] = slots as [number, number]
    return [syncopationWeight(a) + syncopationWeight(b), a, b]
  }

  function expectSorted(drills: readonly { slots: readonly SixteenthSlot[] }[]): void {
    for (let i = 1; i < drills.length; i++) {
      const prev = pairOrderKey((drills[i - 1] as { slots: readonly SixteenthSlot[] }).slots)
      const curr = pairOrderKey((drills[i] as { slots: readonly SixteenthSlot[] }).slots)
      const isLess =
        prev[0] < curr[0] ||
        (prev[0] === curr[0] && (prev[1] < curr[1] || (prev[1] === curr[1] && prev[2] < curr[2])))
      expect(isLess).toBe(true)
    }
  }

  it('returns [] for count <= 0', () => {
    expect(twoKickPermutations(scriptedRng([0]), 0)).toEqual([])
    expect(twoKickPermutations(scriptedRng([0]), -3)).toEqual([])
  })

  it('count 1 with a known script draws the lightest pair, [0, 4]', () => {
    // randomInt(rng, 0, 119) with next()=0.0 -> 0: the shuffle picks index 0
    // of ALL_PAIRS unchanged, which is the globally lightest pair (weight 0).
    const drills = twoKickPermutations(scriptedRng([0.0, 0.5]), 1)
    expect(drills).toHaveLength(1)
    expect(drills[0]?.slots).toEqual([0, 4])
  })

  it('titles read "Kick on <a> and <b>"', () => {
    const drills = twoKickPermutations(scriptedRng([0.0, 0.5]), 1)
    expect(drills[0]?.score.title).toBe('Kick on 1 and 2')
  })

  it('count 12 with the same script also starts with the lightest pair', () => {
    const drills = twoKickPermutations(scriptedRng([0.0, 0.5]), 12)
    expect(drills).toHaveLength(12)
    expect(drills[0]?.score.title).toBe('Kick on 1 and 2')
  })

  it('count 120 returns all 120 pairs, each distinct, sorted by (weight, a, b)', () => {
    const drills = twoKickPermutations(scriptedRng([0.1, 0.9, 0.3, 0.6, 0.4]), 120)
    expect(drills).toHaveLength(120)
    const keys = new Set(drills.map((d) => d.slots.join(',')))
    expect(keys.size).toBe(120)
    expectSorted(drills)
  })

  it('count 500 clamps to 120', () => {
    const drills = twoKickPermutations(scriptedRng([0.1, 0.9, 0.3]), 500)
    expect(drills).toHaveLength(120)
  })

  it('is deterministic for a scripted rng', () => {
    const a = twoKickPermutations(scriptedRng([0.1, 0.9, 0.3]), 3)
    const b = twoKickPermutations(scriptedRng([0.1, 0.9, 0.3]), 3)
    expect(a).toEqual(b)
  })

  it('a degenerate rng that always returns 0.0 still returns 12 distinct pairs', () => {
    const drills = twoKickPermutations(scriptedRng([0.0]), 12)
    expect(drills).toHaveLength(12)
    expect(new Set(drills.map((d) => d.slots.join(','))).size).toBe(12)
  })

  it('a degenerate rng that always returns 0.999 still returns 12 distinct pairs', () => {
    const drills = twoKickPermutations(scriptedRng([0.999]), 12)
    expect(drills).toHaveLength(12)
    expect(new Set(drills.map((d) => d.slots.join(','))).size).toBe(12)
  })

  it('property: distinct sorted slots, distinct pairs, correct order and length, and every drill plans', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 40 }),
        (script, count) => {
          const drills = twoKickPermutations(scriptedRng(script), count)
          expect(drills).toHaveLength(Math.min(count, 120))
          for (const drill of drills) {
            expect(drill.slots.length).toBe(2)
            const [a, b] = drill.slots
            expect(a).toBeLessThan(b as number)
            expect(() => planGrooveRun(drill.score, 80)).not.toThrow()
            expect(drill.score.notes.filter((n) => n.pad === 'kick').length).toBeGreaterThanOrEqual(1)
          }
          const keys = new Set(drills.map((d) => d.slots.join(',')))
          expect(keys.size).toBe(drills.length)
          expectSorted(drills)
        },
      ),
    )
  })
})
