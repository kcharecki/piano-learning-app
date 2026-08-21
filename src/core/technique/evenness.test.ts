import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  bestCleanBpm,
  EVENNESS_REFERENCE_GAP_MS,
  evennessOf,
  isClean,
  tempoHistory,
  tempoSeriesByDrill,
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

  it('is scale-invariant ABOVE the reference gap: the same rhythm slower scores the same', () => {
    // Scale invariance is the right model while the gaps are long enough that
    // a proportional error is what the ear hears. Roadmap T.10 deliberately
    // gives it up BELOW `EVENNESS_REFERENCE_GAP_MS` — see the next property —
    // so this one is now stated over the range where it still holds, rather
    // than over a range where it was actively harmful.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: EVENNESS_REFERENCE_GAP_MS, max: 4000 }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.double({ min: 1, max: 100, noNaN: true }),
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

  it('property: a fixed absolute jitter keeps its verdict when the run is re-notated at a different note value (roadmap T.10)', () => {
    // T.10's proof obligation, verbatim. The learner plays with the SAME
    // absolute unevenness — `deviationMs` of wobble on one gap — and we vary
    // only the note value it is written at. Before the floor, the score fell
    // as the note value shortened and the verdict flipped: the same playing
    // was "clean" in quarters and not in triplets.
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: EVENNESS_REFERENCE_GAP_MS }),
        fc.integer({ min: 60, max: EVENNESS_REFERENCE_GAP_MS }),
        fc.integer({ min: 1, max: 55 }),
        (gapA, gapB, deviationMs) => {
          const run = (gap: number): number[] =>
            onsetsFromGaps(0, [gap, gap, gap + deviationMs, gap, gap])
          const a = evennessOf(run(gapA))
          const b = evennessOf(run(gapB))
          // Non-degeneracy: a real, uneven run, not a stub returning 1.
          expect(a).toBeLessThan(1)
          expect(Math.abs(a - b)).toBeLessThan(1e-9)
          expect(isClean({ evenness: a, accuracy: 1 })).toBe(
            isClean({ evenness: b, accuracy: 1 }),
          )
        },
      ),
    )
  })

  it('the broken triad sequence is judged no more harshly than the same wobble in quarters', () => {
    // The concrete case T.10 was filed for. A learner wobbling 25ms plays the
    // level-1 triad sequence at ♩=60: broken, that is eighth-note triplets at
    // 333.33ms spacing; the same drill's solid form is quarters at 833.33ms.
    // Both must read the same verdict for the same physical wobble.
    const wobble = 25
    const triplets = onsetsFromGaps(0, [1000 / 3, 1000 / 3, 1000 / 3 + wobble, 1000 / 3, 1000 / 3])
    const quarters = onsetsFromGaps(0, [500, 500, 500 + wobble, 500, 500])
    expect(evennessOf(triplets)).toBeCloseTo(evennessOf(quarters), 9)
    expect(isClean({ evenness: evennessOf(triplets), accuracy: 1 })).toBe(true)
  })

  it('above the reference gap a longer note value really is judged more loosely', () => {
    // The other side of the floor, so it cannot be mistaken for "absolute
    // everywhere". At 2000ms spacing the same 25ms wobble is proportionally
    // tiny and scores strictly better than it does at the reference.
    const wobble = 25
    const slow = onsetsFromGaps(0, [2000, 2000, 2000 + wobble, 2000, 2000])
    const reference = onsetsFromGaps(0, [500, 500, 500 + wobble, 500, 500])
    expect(evennessOf(slow)).toBeGreaterThan(evennessOf(reference))
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

describe('tempoSeriesByDrill (roadmap T.14)', () => {
  /** The roadmap's own reproduction: two drills, two targets, two clean runs. */
  const twoDrills: readonly TechniqueAttempt[] = [
    attempt({ drillId: 'triad-sequence-c-major-solid-hands-right', at: 1000, bpm: 72 }),
    attempt({ drillId: 'triad-sequence-c-major-broken-hands-right', at: 2000, bpm: 60 }),
  ]

  it('does not put two drills on one line, which is what made 72 then 60 read as slowing down', () => {
    const series = tempoSeriesByDrill(twoDrills)
    expect(series).toHaveLength(2)
    for (const s of series) {
      expect(s.points).toHaveLength(1)
    }
    // Each drill's own bpm stayed with that drill.
    const byId = Object.fromEntries(series.map((s) => [s.drillId, s.points.map((p) => p.bpm)]))
    expect(byId['triad-sequence-c-major-solid-hands-right']).toEqual([72])
    expect(byId['triad-sequence-c-major-broken-hands-right']).toEqual([60])
  })

  it('puts the drill practised most recently first', () => {
    expect(tempoSeriesByDrill(twoDrills).map((s) => s.drillId)).toEqual([
      'triad-sequence-c-major-broken-hands-right',
      'triad-sequence-c-major-solid-hands-right',
    ])
  })

  it('keeps one drill in time order however the attempts arrived', () => {
    const series = tempoSeriesByDrill([
      attempt({ drillId: 'a', at: 3000, bpm: 90 }),
      attempt({ drillId: 'a', at: 1000, bpm: 70 }),
      attempt({ drillId: 'a', at: 2000, bpm: 80 }),
    ])
    expect(series).toHaveLength(1)
    expect(series[0]?.points.map((p) => p.bpm)).toEqual([70, 80, 90])
    expect(series[0]?.bestBpm).toBe(90)
    expect(series[0]?.lastAt).toBe(3000)
  })

  it('reports the best tempo reached, not the latest one', () => {
    const series = tempoSeriesByDrill([
      attempt({ drillId: 'a', at: 1000, bpm: 96 }),
      attempt({ drillId: 'a', at: 2000, bpm: 60 }),
    ])
    expect(series[0]?.bestBpm).toBe(96)
    expect(series[0]?.points.at(-1)?.bpm).toBe(60)
  })

  it('leaves out drills with no clean attempt rather than drawing an empty line', () => {
    const series = tempoSeriesByDrill([
      attempt({ drillId: 'clean-one', at: 1000, clean: true }),
      attempt({ drillId: 'never-clean', at: 2000, clean: false }),
    ])
    expect(series.map((s) => s.drillId)).toEqual(['clean-one'])
  })

  it('has nothing to say about no attempts at all', () => {
    expect(tempoSeriesByDrill([])).toEqual([])
    expect(tempoSeriesByDrill([attempt({ clean: false })])).toEqual([])
  })

  it('property: every clean attempt lands in exactly one series, under its own drill', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            drillId: fc.constantFrom('a', 'b', 'c'),
            at: fc.integer({ min: 0, max: 10_000 }),
            bpm: fc.integer({ min: 20, max: 300 }),
            clean: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (raw) => {
          const attempts = raw.map((r) => attempt(r))
          const series = tempoSeriesByDrill(attempts)
          const cleanCount = attempts.filter((a) => a.clean).length
          expect(series.reduce((n, s) => n + s.points.length, 0)).toBe(cleanCount)
          // No drill id appears twice, and every point under an id belongs to it.
          expect(new Set(series.map((s) => s.drillId)).size).toBe(series.length)
          for (const s of series) {
            const mine = attempts.filter((a) => a.clean && a.drillId === s.drillId)
            expect(s.points).toHaveLength(mine.length)
            expect(s.bestBpm).toBe(Math.max(...mine.map((a) => a.bpm)))
          }
        },
      ),
    )
  })
})
