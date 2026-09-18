import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TREND_RUNS, TREND_FLAT_MS, grooveTrends } from './trend.ts'
import type { GrooveAttemptLike, GrooveAttemptPadLike } from './grooveBests.ts'

function withOffset(offsetMs: number): readonly GrooveAttemptPadLike[] {
  return [{ pad: 'kick', expected: 1, matched: 1, meanOffsetMs: offsetMs }]
}

function attempt(overrides: Partial<GrooveAttemptLike> & { grooveId: string }): GrooveAttemptLike {
  return {
    grooveTitle: 'Money Beat',
    bpm: 90,
    at: 1,
    steady: true,
    ...overrides,
  }
}

/** Builds a newest-first attempts array from oldest-to-newest offsets, at = index+1 oldest to newest. */
function series(grooveId: string, offsetsOldestFirst: readonly number[]): readonly GrooveAttemptLike[] {
  return offsetsOldestFirst
    .map((offset, i) =>
      attempt({ grooveId, at: i + 1, pads: withOffset(offset) }),
    )
    .reverse() // newest-first
}

describe('grooveTrends', () => {
  it('reports tightening for a clearly tightening series', () => {
    const [trend] = grooveTrends(series('g', [30, 25, 20, 10]))
    expect(trend?.direction).toBe('tightening')
    expect(trend?.points.map((p) => p.worstAbsOffsetMs)).toEqual([30, 25, 20, 10])
  })

  it('reports loosening for the reverse series', () => {
    const [trend] = grooveTrends(series('g', [10, 20, 25, 30]))
    expect(trend?.direction).toBe('loosening')
  })

  it('reports flat for a constant series', () => {
    const [trend] = grooveTrends(series('g', [15, 15, 15, 15]))
    expect(trend?.direction).toBe('flat')
  })

  it('reports unknown with only three points', () => {
    const [trend] = grooveTrends(series('g', [30, 20, 10]))
    expect(trend?.direction).toBe('unknown')
    expect(trend?.points).toHaveLength(3)
  })

  it('ignores pads with no qualifying hits when computing worstAbsOffsetMs', () => {
    const attempts: readonly GrooveAttemptLike[] = [
      attempt({
        grooveId: 'g',
        at: 1,
        pads: [
          { pad: 'kick', expected: 1, matched: 0, meanOffsetMs: 999 },
          { pad: 'snare', expected: 1, matched: 1 },
          { pad: 'tomHigh', expected: 1, matched: 1, meanOffsetMs: 7 },
        ],
      }),
    ]
    const [trend] = grooveTrends(attempts)
    expect(trend?.points[0]?.worstAbsOffsetMs).toBe(7)
  })

  it('a point with no qualifying pad at all has an undefined worstAbsOffsetMs', () => {
    const attempts: readonly GrooveAttemptLike[] = [attempt({ grooveId: 'g', at: 1 })]
    const [trend] = grooveTrends(attempts)
    expect(trend?.points[0]?.worstAbsOffsetMs).toBeUndefined()
  })

  it('keeps only the newest n attempts of a groove, oldest-first, by at', () => {
    const attempts: readonly GrooveAttemptLike[] = [
      attempt({ grooveId: 'g', at: 5, pads: withOffset(5) }),
      attempt({ grooveId: 'g', at: 4, pads: withOffset(4) }),
      attempt({ grooveId: 'g', at: 3, pads: withOffset(3) }),
      attempt({ grooveId: 'g', at: 2, pads: withOffset(2) }),
      attempt({ grooveId: 'g', at: 1, pads: withOffset(1) }),
    ]
    const [trend] = grooveTrends(attempts, 3)
    expect(trend?.points.map((p) => p.at)).toEqual([3, 4, 5])
  })

  it('grooveTitle is read from the most recent attempt', () => {
    const attempts: readonly GrooveAttemptLike[] = [
      attempt({ grooveId: 'g', grooveTitle: 'New Name', at: 2 }),
      attempt({ grooveId: 'g', grooveTitle: 'Old Name', at: 1 }),
    ]
    const [trend] = grooveTrends(attempts)
    expect(trend?.grooveTitle).toBe('New Name')
  })

  it('steadyCount counts steady points among the kept attempts', () => {
    const attempts: readonly GrooveAttemptLike[] = [
      attempt({ grooveId: 'g', at: 3, steady: true }),
      attempt({ grooveId: 'g', at: 2, steady: true }),
      attempt({ grooveId: 'g', at: 1, steady: false }),
    ]
    const [trend] = grooveTrends(attempts)
    expect(trend?.steadyCount).toBe(2)
  })

  it('sorts groove rows by the most recent attempt at desc', () => {
    const rows = grooveTrends([
      attempt({ grooveId: 'a', at: 1 }),
      attempt({ grooveId: 'b', at: 3 }),
      attempt({ grooveId: 'a', at: 2 }),
    ])
    expect(rows.map((r) => r.grooveId)).toEqual(['b', 'a'])
  })

  it('a series within TREND_FLAT_MS of itself stays flat', () => {
    const [trend] = grooveTrends(series('g', [10, 10, 10, 10 + TREND_FLAT_MS]))
    expect(trend?.direction).toBe('flat')
  })

  it('property: points.length never exceeds n', () => {
    const attemptArb = fc.record({
      grooveId: fc.constantFrom('a', 'b'),
      grooveTitle: fc.constant('T'),
      bpm: fc.constant(90),
      at: fc.integer({ min: 0, max: 1_000_000 }),
      steady: fc.boolean(),
    })
    fc.assert(
      fc.property(
        fc.array(attemptArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 15 }),
        (attempts, n) => {
          const rows = grooveTrends(attempts, n)
          for (const row of rows) expect(row.points.length).toBeLessThanOrEqual(n)
        },
      ),
    )
  })

  it('property: points are strictly non-decreasing in at when input is sorted newest-first', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('a', 'b'),
        fc.uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 15 }),
        (grooveId, ats, n) => {
          const sortedDesc = [...ats].sort((x, y) => y - x)
          const attempts: GrooveAttemptLike[] = sortedDesc.map((at) =>
            attempt({ grooveId, at, steady: true }),
          )
          const rows = grooveTrends(attempts, n)
          for (const row of rows) {
            for (let i = 1; i < row.points.length; i++) {
              expect(row.points[i]!.at).toBeGreaterThanOrEqual(row.points[i - 1]!.at)
            }
          }
        },
      ),
    )
  })

  it('property: steadyCount equals an independently counted number of steady points', () => {
    const attemptArb = fc.record({
      grooveId: fc.constantFrom('a', 'b'),
      grooveTitle: fc.constant('T'),
      bpm: fc.constant(90),
      at: fc.integer({ min: 0, max: 1_000_000 }),
      steady: fc.boolean(),
    })
    fc.assert(
      fc.property(
        fc.array(attemptArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 15 }),
        (attempts, n) => {
          const rows = grooveTrends(attempts, n)
          for (const row of rows) {
            const independentCount = row.points.reduce((c, p) => (p.steady ? c + 1 : c), 0)
            expect(row.steadyCount).toBe(independentCount)
          }
        },
      ),
    )
  })

  it('property: every groove id in the input appears exactly once in the output', () => {
    const attemptArb = fc.record({
      grooveId: fc.constantFrom('a', 'b', 'c'),
      grooveTitle: fc.constant('T'),
      bpm: fc.constant(90),
      at: fc.integer({ min: 0, max: 1_000_000 }),
      steady: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(attemptArb, { minLength: 0, maxLength: 30 }), (attempts) => {
        const rows = grooveTrends(attempts)
        const expectedIds = new Set(attempts.map((a) => a.grooveId))
        expect(new Set(rows.map((r) => r.grooveId))).toEqual(expectedIds)
        expect(rows).toHaveLength(expectedIds.size)
      }),
    )
  })

  it('property: direction is unknown whenever fewer than 4 points carry an offset', () => {
    const padArb = fc.option(
      fc.record({
        pad: fc.constant('kick' as const),
        expected: fc.constant(1),
        matched: fc.integer({ min: 0, max: 5 }),
        meanOffsetMs: fc.integer({ min: -100, max: 100 }),
      }),
      { nil: undefined },
    )
    const attemptArb = fc.record({
      grooveId: fc.constant('g'),
      grooveTitle: fc.constant('T'),
      bpm: fc.constant(90),
      at: fc.integer({ min: 0, max: 1_000_000 }),
      steady: fc.boolean(),
      pads: padArb.map((p) => (p === undefined ? [] : [p])),
    })
    fc.assert(
      fc.property(fc.array(attemptArb, { minLength: 0, maxLength: 10 }), (attempts) => {
        const [trend] = grooveTrends(attempts as GrooveAttemptLike[], DEFAULT_TREND_RUNS)
        if (trend === undefined) return
        const withOffsetCount = trend.points.filter((p) => p.worstAbsOffsetMs !== undefined).length
        if (withOffsetCount < 4) expect(trend.direction).toBe('unknown')
      }),
    )
  })
})
