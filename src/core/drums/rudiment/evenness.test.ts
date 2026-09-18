import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  isEvenEnough,
  MIN_EVENNESS_STROKES,
  RUDIMENT_CLEAN_EVENNESS,
  rudimentEvenness,
} from './evenness.ts'

/** Cumulative onsets from a starting point and a list of positive gaps. */
function onsetsFromGaps(start: number, gaps: readonly number[]): number[] {
  const out: number[] = [start]
  let t = start
  for (const g of gaps) {
    t += g
    out.push(t)
  }
  return out
}

describe('rudimentEvenness', () => {
  it('is 1 for a perfectly even run', () => {
    expect(rudimentEvenness([0, 125, 250, 375, 500])).toBe(1)
  })

  it('is well under the clean bar when one gap is doubled at 125ms spacing', () => {
    // gaps: 125, 125, 250, 125 — one gap doubled against a 125ms pattern.
    const onsets = onsetsFromGaps(0, [125, 125, 250, 125])
    const score = rudimentEvenness(onsets)
    expect(score).toBeLessThan(RUDIMENT_CLEAN_EVENNESS - 0.1)
    expect(isEvenEnough(score)).toBe(false)
  })

  it('MIN_EVENNESS_STROKES is the count below which evennessOf has no gap to judge', () => {
    expect(MIN_EVENNESS_STROKES).toBe(3)
    expect(rudimentEvenness([0, 250])).toBe(1)
  })

  it('is 1 for fewer than three onsets', () => {
    expect(rudimentEvenness([])).toBe(1)
    expect(rudimentEvenness([0])).toBe(1)
    expect(rudimentEvenness([0, 500])).toBe(1)
  })

  it('property: any evenly spaced run of 3+ onsets scores 1 and is even enough', () => {
    // Integer gaps, not doubles: summing identical doubles repeatedly can
    // drift by float epsilon (e.g. 0.30000000000000004-style error), which
    // would fail this exact-1 assertion for a run that is, mathematically,
    // perfectly even — a rounding artifact of the test's own fixture, not a
    // real unevenness `rudimentEvenness` should report.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 3, max: 40 }),
        (gap, count) => {
          const onsets = onsetsFromGaps(
            0,
            Array.from({ length: count - 1 }, () => gap),
          )
          const score = rudimentEvenness(onsets)
          expect(score).toBe(1)
          expect(isEvenEnough(score)).toBe(true)
        },
      ),
    )
  })

  it('property: scaling every onset by a constant >= 1 leaves the score unchanged once the median gap is at or above 500ms', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 500, max: 4000 }), { minLength: 2, maxLength: 20 }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        (gaps, factor) => {
          // Non-degeneracy: an uneven run, so a constant-1 stub cannot pass.
          fc.pre(new Set(gaps).size > 1)
          const onsets = onsetsFromGaps(0, gaps)
          const scaled = onsets.map((t) => t * factor)
          const original = rudimentEvenness(onsets)
          const rescaled = rudimentEvenness(scaled)
          expect(original).toBeLessThan(1)
          expect(Math.abs(original - rescaled)).toBeLessThan(1e-9)
        },
      ),
    )
  })
})

describe('isEvenEnough', () => {
  it('is true at and above the clean threshold, false below it', () => {
    expect(isEvenEnough(RUDIMENT_CLEAN_EVENNESS)).toBe(true)
    expect(isEvenEnough(1)).toBe(true)
    expect(isEvenEnough(RUDIMENT_CLEAN_EVENNESS - 0.01)).toBe(false)
  })
})
