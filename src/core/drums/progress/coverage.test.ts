import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { grooveCoverage, rudimentCoverage, type CoverageItem } from './coverage.ts'

const library: readonly CoverageItem[] = [
  { id: 'quarter-note-rock', title: 'Quarter-Note Rock' },
  { id: 'money-beat', title: 'Money Beat' },
  { id: 'money-beat-open-hat', title: 'Money Beat (Open Hat)' },
]

describe('grooveCoverage', () => {
  it('reports everything unplayed when there are no attempts', () => {
    const c = grooveCoverage(library, [])
    expect(c).toEqual({
      total: 3,
      played: 0,
      steady: 0,
      neverPlayed: library,
      playedNotSteady: [],
    })
  })

  it('counts a groove with one steady attempt as played and steady', () => {
    const c = grooveCoverage(library, [{ grooveId: 'money-beat', steady: true }])
    expect(c.played).toBe(1)
    expect(c.steady).toBe(1)
    expect(c.neverPlayed).toEqual([library[0], library[2]])
    expect(c.playedNotSteady).toEqual([])
  })

  it('counts a groove with only unsteady attempts as played but not steady', () => {
    const c = grooveCoverage(library, [
      { grooveId: 'money-beat', steady: false },
      { grooveId: 'money-beat', steady: false },
    ])
    expect(c.played).toBe(1)
    expect(c.steady).toBe(0)
    expect(c.neverPlayed).toEqual([library[0], library[2]])
    expect(c.playedNotSteady).toEqual([library[1]])
  })

  it('a groove with a mix of steady and unsteady attempts counts as steady', () => {
    const c = grooveCoverage(library, [
      { grooveId: 'money-beat', steady: false },
      { grooveId: 'money-beat', steady: true },
    ])
    expect(c.steady).toBe(1)
    expect(c.playedNotSteady).toEqual([])
  })

  it('ignores attempts on ids that name no library groove', () => {
    const c = grooveCoverage(library, [{ grooveId: 'ghost-funk-bar', steady: true }])
    expect(c).toEqual({
      total: 3,
      played: 0,
      steady: 0,
      neverPlayed: library,
      playedNotSteady: [],
    })
  })

  it('reports full coverage when every groove has a steady attempt', () => {
    const c = grooveCoverage(library, library.map((item) => ({ grooveId: item.id, steady: true })))
    expect(c).toEqual({ total: 3, played: 3, steady: 3, neverPlayed: [], playedNotSteady: [] })
  })

  it('preserves library order in both lists regardless of attempt order', () => {
    const reordered: readonly CoverageItem[] = [library[2]!, library[0]!, library[1]!]
    const c = grooveCoverage(reordered, [{ grooveId: 'money-beat', steady: false }])
    expect(c.neverPlayed).toEqual([library[2], library[0]])
    expect(c.playedNotSteady).toEqual([library[1]])
  })

  it('property: played + neverPlayed.length === total, steady <= played, lists are disjoint and ordered, no foreign ids appear', () => {
    const idArb = fc.constantFrom(...library.map((l) => l.id), 'ghost-funk-bar', 'coordination-1')
    const attemptArb = fc.record({ grooveId: idArb, steady: fc.boolean() })

    fc.assert(
      fc.property(fc.array(attemptArb, { minLength: 0, maxLength: 30 }), (attempts) => {
        const c = grooveCoverage(library, attempts)

        expect(c.played + c.neverPlayed.length).toBe(c.total)
        expect(c.steady).toBeLessThanOrEqual(c.played)

        const neverIds = c.neverPlayed.map((i) => i.id)
        const notSteadyIds = c.playedNotSteady.map((i) => i.id)
        expect(neverIds.filter((id) => notSteadyIds.includes(id))).toEqual([])

        const libraryIds = library.map((l) => l.id)
        for (const id of [...neverIds, ...notSteadyIds]) {
          expect(libraryIds).toContain(id)
        }

        // Both lists preserve library order: their positions in `libraryIds`
        // must be strictly increasing.
        for (const ids of [neverIds, notSteadyIds]) {
          const positions = ids.map((id) => libraryIds.indexOf(id))
          for (let i = 1; i < positions.length; i += 1) {
            expect(positions[i]).toBeGreaterThan(positions[i - 1]!)
          }
        }
      }),
    )
  })
})

describe('rudimentCoverage', () => {
  const rudiments: readonly CoverageItem[] = [
    { id: 'single-stroke-roll', title: 'Single Stroke Roll' },
    { id: 'double-stroke-open-roll', title: 'Double Stroke Open Roll' },
    { id: 'five-stroke-roll', title: 'Five Stroke Roll' },
    { id: 'single-paradiddle', title: 'Single Paradiddle' },
  ]

  it('reports everything unstarted when there are no records', () => {
    const c = rudimentCoverage(rudiments, {})
    expect(c.total).toBe(4)
    expect(c.started).toBe(0)
    expect(c.nextUp).toEqual(rudiments.slice(0, 3))
  })

  it('excludes started rudiments from nextUp and counts them as started', () => {
    const c = rudimentCoverage(rudiments, { 'single-stroke-roll': { bestCleanBpm: 100 } })
    expect(c.started).toBe(1)
    expect(c.nextUp).toEqual([rudiments[1], rudiments[2], rudiments[3]])
  })

  it('caps nextUp at n', () => {
    const c = rudimentCoverage(rudiments, {}, 2)
    expect(c.nextUp).toEqual(rudiments.slice(0, 2))
  })

  it('returns fewer than n when there are not enough unstarted rudiments left', () => {
    const c = rudimentCoverage(rudiments, {
      'single-stroke-roll': {},
      'double-stroke-open-roll': {},
      'five-stroke-roll': {},
    })
    expect(c.nextUp).toEqual([rudiments[3]])
  })

  it('returns no nextUp when everything is started', () => {
    const records = Object.fromEntries(rudiments.map((r) => [r.id, {}]))
    const c = rudimentCoverage(rudiments, records)
    expect(c.started).toBe(4)
    expect(c.nextUp).toEqual([])
  })

  it('ignores records for ids that name no rudiment', () => {
    const c = rudimentCoverage(rudiments, { ghost: {} })
    expect(c.started).toBe(0)
    expect(c.nextUp).toEqual(rudiments.slice(0, 3))
  })

  it('property: started + unstarted === total, and nextUp.length === min(n, unstarted)', () => {
    const idArb = fc.constantFrom(...rudiments.map((r) => r.id))
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { minLength: 0, maxLength: rudiments.length }),
        fc.integer({ min: 0, max: 6 }),
        (startedIds, n) => {
          const records: Record<string, unknown> = {}
          for (const id of startedIds) records[id] = {}

          const c = rudimentCoverage(rudiments, records, n)
          const unstarted = rudiments.length - c.started

          expect(c.started + unstarted).toBe(c.total)
          expect(c.nextUp.length).toBe(Math.min(n, unstarted))
        },
      ),
    )
  })
})
