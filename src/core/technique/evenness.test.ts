import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  bestCleanBpm,
  evennessOf,
  isClean,
  tempoHistory,
  type TechniqueAttempt,
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

describe('evennessOf', () => {
  it('is 1 for fewer than three onsets — nothing to compare a gap against', () => {
    expect(evennessOf([])).toBe(1)
    expect(evennessOf([0])).toBe(1)
    expect(evennessOf([0, 500])).toBe(1)
  })

  it('is 1 for a perfectly regular run, at any tempo', () => {
    expect(evennessOf([0, 500, 1000, 1500, 2000])).toBe(1)
    expect(evennessOf([0, 250, 500, 750, 1000])).toBe(1)
  })

  it('is strictly less than 1 for an irregular run', () => {
    const score = evennessOf([0, 400, 1000, 1350, 2000])
    expect(score).toBeLessThan(1)
  })

  it('is 0 when onsets coincide (no meaningful median gap)', () => {
    expect(evennessOf([0, 0, 0])).toBe(0)
  })

  it('always stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 0, maxLength: 30 }),
        (onsets) => {
          const score = evennessOf(onsets)
          expect(Number.isFinite(score)).toBe(true)
          expect(score).toBeGreaterThanOrEqual(0)
          expect(score).toBeLessThanOrEqual(1)
        },
      ),
    )
  })

  it('is scale-invariant: playing the same rhythm twice as fast scores the same', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 2000 }), { minLength: 2, maxLength: 20 }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (gaps, factor) => {
          // Non-degeneracy: only exercise runs that are actually uneven, so a
          // constant-1 stub (which trivially satisfies "unchanged") is killed.
          fc.pre(new Set(gaps).size > 1)
          const onsets = onsetsFromGaps(0, gaps)
          const scaled = onsets.map((t) => t * factor)
          const original = evennessOf(onsets)
          const rescaled = evennessOf(scaled)
          expect(original).toBeLessThan(1)
          expect(Math.abs(original - rescaled)).toBeLessThan(1e-9)
        },
      ),
    )
  })

  it('is monotonic: adding jitter never raises the score', () => {
    // Fixed, zero-centred, symmetric jitter shape: for any s > 0 the sorted
    // order of `d` is unchanged (scaling by a positive s preserves order), so
    // the median gap stays exactly G — the 0 entry — for every s. That makes
    // meanRelDeviation(s) = (s / G) * mean(|d|), which is linear and
    // non-decreasing in s, so the score is provably non-increasing in s
    // rather than merely "usually" so.
    const d = [-2, -1, 0, 1, 2]
    fc.assert(
      fc.property(
        fc.double({ min: 30, max: 10000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (gapBase, r1, r2) => {
          const maxAbsD = 2
          const sMax = gapBase / (maxAbsD + 1) // keeps every gap comfortably positive
          const sLo = Math.min(r1, r2) * sMax
          const sHi = Math.max(r1, r2) * sMax
          const onsetsAt = (s: number): number[] =>
            onsetsFromGaps(
              0,
              d.map((di) => gapBase + s * di),
            )
          const lo = evennessOf(onsetsAt(sLo))
          const hi = evennessOf(onsetsAt(sHi))
          expect(hi).toBeLessThanOrEqual(lo + 1e-9)
          // Non-degeneracy: when the jitter amounts genuinely differ and `lo`
          // has not already bottomed out at 0, the scores must genuinely
          // differ too — this kills a constant-1 (or constant-anything) stub,
          // which would otherwise trivially satisfy "hi <= lo".
          // The guard is RELATIVE to the gap, not absolute: the score moves
          // by roughly ((sHi - sLo) / gapBase) * mean(|d|), so an absolute
          // threshold on `s` says nothing about how far the score moved. With
          // gapBase ~4000ms, an absolute 1e-6 difference in `s` shifts the
          // score by ~3e-10 — below the 1e-9 strictness demanded here, which
          // made this property fail roughly one run in twenty.
          if (sHi - sLo > gapBase * 1e-6 && lo > 1e-9) {
            expect(hi).toBeLessThan(lo - 1e-9)
          }
        },
      ),
    )
  })

  it('respects a custom tolerance', () => {
    const onsets = [0, 400, 1000, 1350, 2000]
    const loose = evennessOf(onsets, { tolerance: 5 })
    const tight = evennessOf(onsets, { tolerance: 0.05 })
    expect(loose).toBeGreaterThan(tight)
  })

  it('rejects a non-positive tolerance rather than returning NaN or a false-perfect score', () => {
    expect(() => evennessOf([0, 500, 1000], { tolerance: 0 })).toThrow()
    expect(() => evennessOf([0, 400, 1000, 1350, 2000], { tolerance: -1 })).toThrow()
  })

  it('scores one doubled gap the same regardless of how many other, even, gaps surround it', () => {
    const short = onsetsFromGaps(0, [500, 500, 1000])
    const longRun = onsetsFromGaps(0, [...Array(28).fill(500), 1000])
    expect(evennessOf(short)).toBeCloseTo(evennessOf(longRun), 9)
  })
})

describe('isClean', () => {
  it('requires both evenness and accuracy to clear their thresholds', () => {
    expect(isClean({ evenness: 0.9, accuracy: 1 })).toBe(true)
    expect(isClean({ evenness: 0.5, accuracy: 1 })).toBe(false)
    expect(isClean({ evenness: 0.9, accuracy: 0.5 })).toBe(false)
  })
})

function attempt(overrides: Partial<TechniqueAttempt>): TechniqueAttempt {
  return {
    drillId: 'scale-c-major-2oct-hands-together',
    at: 0,
    bpm: 80,
    evenness: 0.9,
    accuracy: 1,
    clean: true,
    ...overrides,
  }
}

describe('tempoHistory', () => {
  it('keeps only clean attempts for the requested drill, oldest first', () => {
    const attempts: TechniqueAttempt[] = [
      attempt({ drillId: 'a', at: 300, bpm: 90, clean: true }),
      attempt({ drillId: 'a', at: 100, bpm: 80, clean: true }),
      attempt({ drillId: 'a', at: 200, bpm: 85, clean: false }),
      attempt({ drillId: 'b', at: 50, bpm: 200, clean: true }),
    ]
    expect(tempoHistory(attempts, 'a')).toEqual([
      { at: 100, bpm: 80 },
      { at: 300, bpm: 90 },
    ])
  })

  it('is empty when the drill has no clean attempts', () => {
    expect(tempoHistory([attempt({ drillId: 'a', clean: false })], 'a')).toEqual([])
    expect(tempoHistory([], 'a')).toEqual([])
  })
})

describe('bestCleanBpm', () => {
  it('is the highest clean tempo reached', () => {
    const attempts: TechniqueAttempt[] = [
      attempt({ drillId: 'a', at: 1, bpm: 80, clean: true }),
      attempt({ drillId: 'a', at: 2, bpm: 120, clean: true }),
      attempt({ drillId: 'a', at: 3, bpm: 100, clean: true }),
      attempt({ drillId: 'a', at: 4, bpm: 200, clean: false }),
    ]
    expect(bestCleanBpm(attempts, 'a')).toBe(120)
  })

  it('is 0 when the drill has never been played clean', () => {
    expect(bestCleanBpm([attempt({ drillId: 'a', clean: false })], 'a')).toBe(0)
    expect(bestCleanBpm([], 'a')).toBe(0)
  })
})
