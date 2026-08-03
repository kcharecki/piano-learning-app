import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { pick, pickWeighted, randomInt, seededRng } from './rng.ts'
import { scriptedRng } from '@test/fakes.ts'

describe('seededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = seededRng(1234)
    const b = seededRng(1234)
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, seededRng(1).next)
    const b = Array.from({ length: 20 }, seededRng(2).next)
    expect(a).not.toEqual(b)
  })

  it('stays within [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = seededRng(seed)
        for (let i = 0; i < 100; i++) {
          const v = rng.next()
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(1)
        }
      }),
      { numRuns: 20 },
    )
  })

  it('spreads roughly uniformly across ten buckets', () => {
    const rng = seededRng(99)
    const buckets = new Array(10).fill(0)
    const n = 10_000
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]++
    for (const count of buckets) {
      // Each bucket should hold ~1000; allow a generous ±30% band so the test is
      // about "not obviously broken", not about a specific PRNG's fine structure.
      expect(count).toBeGreaterThan(700)
      expect(count).toBeLessThan(1300)
    }
  })
})

describe('randomInt', () => {
  it('is inclusive at both ends', () => {
    expect(randomInt(scriptedRng([0]), 1, 6)).toBe(1)
    expect(randomInt(scriptedRng([0.999999]), 1, 6)).toBe(6)
  })

  it('always lands inside the requested range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer(),
        (min, span, seed) => {
          const value = randomInt(seededRng(seed), min, min + span)
          expect(value).toBeGreaterThanOrEqual(min)
          expect(value).toBeLessThanOrEqual(min + span)
          expect(Number.isInteger(value)).toBe(true)
        },
      ),
    )
  })

  it('handles a single-value range', () => {
    expect(randomInt(seededRng(7), 5, 5)).toBe(5)
  })

  it('rejects an inverted range', () => {
    expect(() => randomInt(seededRng(1), 10, 2)).toThrow(RangeError)
  })
})

describe('pick', () => {
  it('selects by index across the array', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(pick(scriptedRng([0]), items)).toBe('a')
    expect(pick(scriptedRng([0.999]), items)).toBe('d')
  })

  it('only ever returns a member of the array', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1 }), fc.integer(), (items, seed) => {
        expect(items).toContain(pick(seededRng(seed), items))
      }),
    )
  })

  it('rejects an empty array', () => {
    expect(() => pick(seededRng(1), [])).toThrow(RangeError)
  })
})

describe('pickWeighted', () => {
  it('respects weight boundaries', () => {
    const items = [
      ['quarter', 3],
      ['eighth', 1],
    ] as const
    // roll < 0.75 -> quarter, else eighth
    expect(pickWeighted(scriptedRng([0.0]), items)).toBe('quarter')
    expect(pickWeighted(scriptedRng([0.74]), items)).toBe('quarter')
    expect(pickWeighted(scriptedRng([0.76]), items)).toBe('eighth')
  })

  it('never picks a zero- or negative-weight item', () => {
    const items = [
      ['never', 0],
      ['also-never', -5],
      ['always', 1],
    ] as const
    const rng = seededRng(42)
    for (let i = 0; i < 200; i++) expect(pickWeighted(rng, items)).toBe('always')
  })

  it('approximates the requested distribution', () => {
    const rng = seededRng(2024)
    const counts = { a: 0, b: 0 }
    for (let i = 0; i < 5000; i++) {
      counts[pickWeighted(rng, [['a', 3] as const, ['b', 1] as const])]++
    }
    expect(counts.a / 5000).toBeCloseTo(0.75, 1)
  })

  it('rejects a set with no positive weight', () => {
    expect(() => pickWeighted(seededRng(1), [['x', 0] as const])).toThrow(RangeError)
    expect(() => pickWeighted(seededRng(1), [])).toThrow(RangeError)
  })
})
