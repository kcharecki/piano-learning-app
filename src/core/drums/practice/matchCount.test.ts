/**
 * `pair`/`matchCountAt` (split out of `grade.ts`, review round 2, item 8 —
 * see `matchCount.ts`'s own module doc for why). Every case here was
 * previously only exercised indirectly through `grade.ts`'s and
 * `padDisplacement.ts`'s own tests; this file gives the shared primitive its
 * own direct coverage.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { matchCountAt, pair } from './matchCount.ts'

describe('pair', () => {
  it('matches a hit to its own instant when inside the window', () => {
    const result = pair([100], [104], 10)
    expect(result.matched).toBe(1)
    expect(result.offsets).toEqual([{ instant: 100, offset: 4, expectedIndex: 0, hitIndex: 0 }])
    expect(result.unmatchedExpected).toEqual([])
    expect(result.unmatchedHits).toEqual([])
  })

  it('leaves a hit past the window unmatched on both sides', () => {
    const result = pair([100], [111], 10)
    expect(result.matched).toBe(0)
    expect(result.unmatchedExpected).toEqual([100])
    expect(result.unmatchedHits).toEqual([111])
  })

  it('matches exactly at the window boundary (<=, not <)', () => {
    const result = pair([100], [110], 10)
    expect(result.matched).toBe(1)
    expect(result.offsets).toEqual([{ instant: 100, offset: 10, expectedIndex: 0, hitIndex: 0 }])
  })

  it('does not match one step past the window boundary', () => {
    const result = pair([100], [110.000001], 10)
    expect(result.matched).toBe(0)
  })

  /** Ties broken toward the earlier instant — see `pair`'s own doc comment. */
  it('gives an equidistant hit to the earlier of two adjacent instants', () => {
    const result = pair([100, 120], [110], 15)
    expect(result.offsets).toEqual([{ instant: 100, offset: 10, expectedIndex: 0, hitIndex: 0 }])
    expect(result.unmatchedExpected).toEqual([120])
  })

  it('does not double-claim one hit for two instants', () => {
    const result = pair([100, 102], [101], 10)
    expect(result.matched).toBe(1)
    expect(result.unmatchedExpected.length).toBe(1)
  })

  it('reports every leftover hit and instant, not just the count', () => {
    const result = pair([0, 500], [4, 900], 10)
    expect(result.matched).toBe(1)
    expect(result.unmatchedExpected).toEqual([500])
    expect(result.unmatchedHits).toEqual([900])
  })

  /**
   * DR-07 tail: `expectedIndex`/`hitIndex` are positions in the CALLER's own
   * `expected`/`hits` arrays, not in some filtered/matched-only view — this
   * is what lets `grade.ts` look a matched hit's velocity back up by exact
   * index. Here the match order (instant 500 claims the earlier-indexed hit)
   * differs from array order, so a wrong implementation (e.g. reusing a
   * running counter instead of the real index) would be caught.
   */
  it('gives expectedIndex/hitIndex as exact positions in the input arrays', () => {
    const result = pair([0, 500], [490, 4], 15)
    expect(result.offsets).toEqual([
      { instant: 0, offset: 4, expectedIndex: 0, hitIndex: 1 },
      { instant: 500, offset: -10, expectedIndex: 1, hitIndex: 0 },
    ])
  })
})

describe('matchCountAt', () => {
  it('is exactly pair(...).matched', () => {
    const expected = [0, 240, 480]
    const hits = [5, 235, 900]
    expect(matchCountAt(expected, hits, 20)).toBe(pair(expected, hits, 20).matched)
  })

  it('is zero for no hits and zero for no expected instants', () => {
    expect(matchCountAt([0, 240], [], 20)).toBe(0)
    expect(matchCountAt([], [0, 240], 20)).toBe(0)
  })

  it('property: matched count never exceeds the shorter of expected/hits, for any window', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 20 }),
        fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 20 }),
        fc.integer({ min: 0, max: 200 }),
        (expectedRaw, hits, windowMs) => {
          const expected = [...expectedRaw].sort((a, b) => a - b)
          const count = matchCountAt(expected, hits, windowMs)
          expect(count).toBeLessThanOrEqual(Math.min(expected.length, hits.length))
        },
      ),
    )
  })
})
