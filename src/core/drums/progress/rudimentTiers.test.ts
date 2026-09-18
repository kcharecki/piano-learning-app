import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { tierCompletion, type RudimentRecord } from './rudimentTiers.ts'
import type { Rudiment, RudimentTier } from '@core/drums/rudiment/types.ts'

function makeRudiment(id: string, tier: RudimentTier, target: number): Rudiment {
  return {
    id,
    pasNumber: 1,
    name: id,
    tier,
    family: 'roll',
    patternTicks: 480,
    strokes: [],
    bpmBand: { start: 60, target },
    transfer: 'test fixture',
  }
}

function record(bestCleanBpm: number): RudimentRecord {
  return { bestCleanBpm, lastBpm: bestCleanBpm, at: 1 }
}

describe('tierCompletion', () => {
  it('returns one row per tier, 1..4, even when the curriculum is empty', () => {
    const rows = tierCompletion([], {})
    expect(rows.map((r) => r.tier)).toEqual([1, 2, 3, 4])
    for (const row of rows) {
      expect(row).toEqual({ tier: row.tier, total: 0, started: 0, atTarget: 0 })
    }
  })

  it('counts started and atTarget from records, below-target counts as started only', () => {
    const rudiments = [
      makeRudiment('a', 1, 100),
      makeRudiment('b', 1, 100),
      makeRudiment('c', 1, 100),
    ]
    const records = {
      a: record(100), // exactly at target -> atTarget
      b: record(80), // below target -> started only
      // c has no record -> neither
    }
    const rows = tierCompletion(rudiments, records)
    const tier1 = rows.find((r) => r.tier === 1)
    expect(tier1).toEqual({ tier: 1, total: 3, started: 2, atTarget: 1 })
  })

  it('a record exactly equal to the target counts as atTarget', () => {
    const rudiments = [makeRudiment('a', 1, 120)]
    const rows = tierCompletion(rudiments, { a: record(120) })
    expect(rows.find((r) => r.tier === 1)?.atTarget).toBe(1)
  })

  it('ignores records for ids that name no rudiment', () => {
    const rudiments = [makeRudiment('a', 1, 100)]
    const rows = tierCompletion(rudiments, { ghost: record(999) })
    expect(rows.find((r) => r.tier === 1)).toEqual({ tier: 1, total: 1, started: 0, atTarget: 0 })
  })

  it('sums total across tiers to rudiments.length', () => {
    const rudiments = [
      makeRudiment('a', 1, 100),
      makeRudiment('b', 2, 100),
      makeRudiment('c', 2, 100),
      makeRudiment('d', 4, 100),
    ]
    const rows = tierCompletion(rudiments, {})
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(rudiments.length)
  })

  it('property: 0 <= atTarget <= started <= total, and totals sum to rudiments.length', () => {
    const rudimentArb = fc
      .record({
        id: fc.uuid(),
        tier: fc.constantFrom<RudimentTier>(1, 2, 3, 4),
        target: fc.integer({ min: 40, max: 200 }),
      })
      .map(({ id, tier, target }) => makeRudiment(id, tier, target))

    fc.assert(
      fc.property(
        fc.uniqueArray(rudimentArb, { selector: (r) => r.id }),
        fc.dictionary(fc.uuid(), fc.integer({ min: 0, max: 300 })),
        (rudiments, bpmById) => {
          // Build records only for a subset of the rudiments' own ids, plus
          // whatever unrelated ids `bpmById` happened to generate (those
          // exercise the "ignores unknown ids" branch for free).
          const records: Record<string, RudimentRecord> = {}
          for (const [id, bpm] of Object.entries(bpmById)) {
            records[id] = record(bpm)
          }
          for (const rudiment of rudiments) {
            if (rudiment.id in bpmById) records[rudiment.id] = record(bpmById[rudiment.id] ?? 0)
          }

          const rows = tierCompletion(rudiments, records)
          expect(rows.map((r) => r.tier)).toEqual([1, 2, 3, 4])
          for (const row of rows) {
            expect(row.atTarget).toBeGreaterThanOrEqual(0)
            expect(row.atTarget).toBeLessThanOrEqual(row.started)
            expect(row.started).toBeLessThanOrEqual(row.total)
          }
          expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(rudiments.length)
        },
      ),
    )
  })
})
