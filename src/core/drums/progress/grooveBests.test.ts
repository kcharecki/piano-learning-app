import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  grooveBests,
  limbBias,
  type GrooveAttemptLike,
  type GrooveAttemptPadLike,
} from './grooveBests.ts'
import { MAPPED_PADS, type MappedDrumPad } from '@core/drums/model/pad.ts'

function attempt(overrides: Partial<GrooveAttemptLike> & { grooveId: string }): GrooveAttemptLike {
  return {
    grooveTitle: 'Money Beat',
    bpm: 90,
    at: 1,
    steady: true,
    ...overrides,
  }
}

describe('grooveBests', () => {
  it('returns one row per grooveId, ordered by lastAt desc', () => {
    const rows = grooveBests([
      attempt({ grooveId: 'a', at: 1 }),
      attempt({ grooveId: 'b', at: 3 }),
      attempt({ grooveId: 'a', at: 2 }),
    ])
    expect(rows.map((r) => r.grooveId)).toEqual(['b', 'a'])
  })

  it('bestSteadyBpm is the max bpm over steady attempts only', () => {
    const rows = grooveBests([
      attempt({ grooveId: 'money-beat', bpm: 90, steady: true, at: 1 }),
      attempt({ grooveId: 'money-beat', bpm: 100, steady: true, at: 2 }),
      attempt({ grooveId: 'money-beat', bpm: 120, steady: false, at: 3 }), // exclusion trap
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ grooveId: 'money-beat', bestSteadyBpm: 100, attempts: 3 })
  })

  it('bestSteadyBpm is undefined when no attempt was steady', () => {
    const rows = grooveBests([
      attempt({ grooveId: 'g', steady: false, at: 1 }),
      attempt({ grooveId: 'g', steady: false, at: 2 }),
    ])
    expect(rows[0]?.bestSteadyBpm).toBeUndefined()
  })

  it('grooveTitle is read from the most recent attempt', () => {
    const rows = grooveBests([
      attempt({ grooveId: 'g', grooveTitle: 'Old Name', at: 1 }),
      attempt({ grooveId: 'g', grooveTitle: 'New Name', at: 2 }),
    ])
    expect(rows[0]?.grooveTitle).toBe('New Name')
  })

  it('property: unsteady attempts never set bestSteadyBpm, and bestSteadyBpm never exceeds the max bpm', () => {
    const attemptArb = fc.record({
      grooveId: fc.constantFrom('a', 'b'),
      grooveTitle: fc.constant('T'),
      bpm: fc.integer({ min: 40, max: 300 }),
      at: fc.integer({ min: 0, max: 1_000_000 }),
      steady: fc.boolean(),
    })

    fc.assert(
      fc.property(fc.array(attemptArb, { minLength: 1, maxLength: 30 }), (attempts) => {
        const rows = grooveBests(attempts)
        for (const row of rows) {
          const forGroove = attempts.filter((a) => a.grooveId === row.grooveId)
          const maxBpm = Math.max(...forGroove.map((a) => a.bpm))
          const anySteady = forGroove.some((a) => a.steady)
          if (!anySteady) {
            expect(row.bestSteadyBpm).toBeUndefined()
          } else {
            expect(row.bestSteadyBpm).toBeLessThanOrEqual(maxBpm)
          }
        }
      }),
    )
  })
})

describe('limbBias', () => {
  it('weights meanOffsetMs by matched count and sums samples', () => {
    const rows = limbBias([
      attempt({
        grooveId: 'g',
        at: 1,
        pads: [
          { pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 15 },
          { pad: 'snare', expected: 4, matched: 4, meanOffsetMs: -6 },
        ],
      }),
    ])
    const kick = rows.find((r) => r.pad === 'kick')
    const snare = rows.find((r) => r.pad === 'snare')
    expect(kick).toEqual({ pad: 'kick', meanMs: 15, samples: 8 })
    expect(snare).toEqual({ pad: 'snare', meanMs: -6, samples: 4 })
  })

  it('sorts rows by |meanMs| desc', () => {
    const rows = limbBias([
      attempt({
        grooveId: 'g',
        at: 1,
        pads: [
          { pad: 'kick', expected: 1, matched: 1, meanOffsetMs: 2 },
          { pad: 'snare', expected: 1, matched: 1, meanOffsetMs: -20 },
        ],
      }),
    ])
    expect(rows.map((r) => r.pad)).toEqual(['snare', 'kick'])
  })

  it('omits pads with no qualifying hits (no meanOffsetMs, or matched 0)', () => {
    const rows = limbBias([
      attempt({
        grooveId: 'g',
        at: 1,
        pads: [
          { pad: 'kick', expected: 1, matched: 0, meanOffsetMs: 5 },
          { pad: 'snare', expected: 1, matched: 1 },
          { pad: 'tomHigh', expected: 1, matched: 1, meanOffsetMs: 3 },
        ],
      }),
    ])
    expect(rows.map((r) => r.pad)).toEqual(['tomHigh'])
  })

  it('ignores attempts with no pads', () => {
    expect(limbBias([attempt({ grooveId: 'g', at: 1 })])).toEqual([])
  })

  it('an old attempt beyond n does not move meanMs', () => {
    const recent = attempt({
      grooveId: 'g',
      at: 2,
      pads: [{ pad: 'kick', expected: 1, matched: 1, meanOffsetMs: 5 }],
    })
    const ancient = attempt({
      grooveId: 'g',
      at: 1,
      pads: [{ pad: 'kick', expected: 1, matched: 1, meanOffsetMs: 9999 }],
    })
    // Newest-first input, n = 1: only `recent` contributes.
    const rows = limbBias([recent, ancient], 1)
    expect(rows).toEqual([{ pad: 'kick', meanMs: 5, samples: 1 }])
  })

  it('property: meanMs stays within [min, max] of contributing meanOffsetMs, samples equals matched sum, and n limits contribution', () => {
    const padArb = fc.constantFrom(...MAPPED_PADS)
    const padHitArb = fc
      .record({
        pad: padArb,
        expected: fc.integer({ min: 1, max: 20 }),
        matched: fc.integer({ min: 0, max: 20 }),
        meanOffsetMs: fc.option(fc.integer({ min: -200, max: 200 }), { nil: undefined }),
      })
      .map(({ meanOffsetMs, ...rest }): GrooveAttemptPadLike =>
        meanOffsetMs === undefined ? rest : { ...rest, meanOffsetMs },
      )
    const attemptArb = fc.record({
      grooveId: fc.constant('g'),
      grooveTitle: fc.constant('T'),
      bpm: fc.constant(90),
      at: fc.integer({ min: 0, max: 1000 }),
      steady: fc.boolean(),
      pads: fc.array(padHitArb, { maxLength: 6 }),
    })

    fc.assert(
      fc.property(
        fc.array(attemptArb, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 15 }),
        (attempts, n) => {
          const rows = limbBias(attempts, n)
          const considered = attempts.slice(0, n)

          for (const row of rows) {
            const contributions: { offset: number; matched: number }[] = []
            for (const a of considered) {
              for (const p of a.pads) {
                if (p.pad !== row.pad) continue
                if (p.meanOffsetMs === undefined || p.matched <= 0) continue
                contributions.push({ offset: p.meanOffsetMs, matched: p.matched })
              }
            }
            const totalMatched = contributions.reduce((sum, c) => sum + c.matched, 0)
            expect(row.samples).toBe(totalMatched)
            const offsets = contributions.map((c) => c.offset)
            expect(row.meanMs).toBeGreaterThanOrEqual(Math.min(...offsets))
            expect(row.meanMs).toBeLessThanOrEqual(Math.max(...offsets))
          }

          // A pad that never qualifies within the first n attempts must be absent.
          const qualifyingPads = new Set<MappedDrumPad>()
          for (const a of considered) {
            for (const p of a.pads) {
              if (p.meanOffsetMs !== undefined && p.matched > 0) qualifyingPads.add(p.pad)
            }
          }
          expect(rows.every((row) => qualifyingPads.has(row.pad))).toBe(true)
        },
      ),
    )
  })
})
