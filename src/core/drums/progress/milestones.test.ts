import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { milestones, type MilestoneId, type MilestonesInput } from './milestones.ts'

const MILESTONE_IDS: readonly MilestoneId[] = [
  'first-steady-run',
  'money-beat-100',
  'ten-steady-runs',
  'all-library-grooves-steady',
  'first-rudiment-at-target',
  'tier-1-complete',
]

function attempt(
  grooveId: string,
  at: number,
  steady: boolean,
  bpm = 90,
): MilestonesInput['attempts'][number] {
  return { grooveId, bpm, at, steady }
}

const EMPTY_INPUT: MilestonesInput = {
  attempts: [],
  rudimentRecords: {},
  rudiments: [],
  library: [],
}

function reachedAtOf(id: MilestoneId, rows: ReturnType<typeof milestones>): number | undefined {
  return rows.find((r) => r.id === id)?.reachedAt
}

describe('milestones', () => {
  it('outputs all six, in fixed order, none reached, when everything is empty', () => {
    const rows = milestones(EMPTY_INPUT)
    expect(rows.map((r) => r.id)).toEqual(MILESTONE_IDS)
    for (const row of rows) expect(row.reachedAt).toBeUndefined()
  })

  describe('first-steady-run', () => {
    it('is reached at the earliest steady attempt, newest-first input', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        attempts: [attempt('money-beat', 30, true), attempt('money-beat', 10, true), attempt('money-beat', 20, false)],
      })
      expect(reachedAtOf('first-steady-run', rows)).toBe(10)
    })

    it('is not reached with no steady attempts', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: [attempt('money-beat', 10, false)] })
      expect(reachedAtOf('first-steady-run', rows)).toBeUndefined()
    })

    it('counts a groove not in the library', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        attempts: [attempt('practice-pad', 10, true)],
        library: [{ id: 'money-beat' }],
      })
      expect(reachedAtOf('first-steady-run', rows)).toBe(10)
    })
  })

  describe('money-beat-100', () => {
    it('is reached by a steady money-beat attempt at or above 100 bpm', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: [attempt('money-beat', 10, true, 100)] })
      expect(reachedAtOf('money-beat-100', rows)).toBe(10)
    })

    it('is reached exactly at 100 bpm', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: [attempt('money-beat', 10, true, 100)] })
      expect(reachedAtOf('money-beat-100', rows)).toBe(10)
    })

    it('is not reached below 100 bpm', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: [attempt('money-beat', 10, true, 99)] })
      expect(reachedAtOf('money-beat-100', rows)).toBeUndefined()
    })

    it('is not reached by a non-steady attempt at 100+ bpm (exclusion trap)', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: [attempt('money-beat', 10, false, 120)] })
      expect(reachedAtOf('money-beat-100', rows)).toBeUndefined()
    })

    it('is not reached by a different groove at 100+ bpm', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: [attempt('quarter-note-rock', 10, true, 120)] })
      expect(reachedAtOf('money-beat-100', rows)).toBeUndefined()
    })

    it('takes the earliest qualifying attempt when several qualify', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        attempts: [attempt('money-beat', 30, true, 110), attempt('money-beat', 15, true, 100)],
      })
      expect(reachedAtOf('money-beat-100', rows)).toBe(15)
    })
  })

  describe('ten-steady-runs', () => {
    function steadyAttemptsAt(times: readonly number[]): MilestonesInput['attempts'] {
      return times.map((at) => attempt('money-beat', at, true))
    }

    it('is not reached with 9 steady attempts', () => {
      const rows = milestones({ ...EMPTY_INPUT, attempts: steadyAttemptsAt([9, 8, 7, 6, 5, 4, 3, 2, 1]) })
      expect(reachedAtOf('ten-steady-runs', rows)).toBeUndefined()
    })

    it('is reached at the 10th steady attempt in chronological order, given newest-first input', () => {
      // Newest first (as the history store holds them): at 10 is the most
      // recent, at 1 the oldest — the 10th chronologically is `at: 10`.
      const times = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      const rows = milestones({ ...EMPTY_INPUT, attempts: steadyAttemptsAt(times) })
      expect(reachedAtOf('ten-steady-runs', rows)).toBe(10)
    })

    it('an 11th steady attempt does not move reachedAt off the 10th chronologically', () => {
      const times = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      const rows = milestones({ ...EMPTY_INPUT, attempts: steadyAttemptsAt(times) })
      expect(reachedAtOf('ten-steady-runs', rows)).toBe(10)
    })

    it('non-steady attempts do not count toward the 10 (exclusion trap)', () => {
      const attempts = [
        ...steadyAttemptsAt([9, 8, 7, 6, 5, 4, 3, 2, 1]),
        attempt('money-beat', 100, false),
        attempt('money-beat', 99, false),
      ]
      const rows = milestones({ ...EMPTY_INPUT, attempts })
      expect(reachedAtOf('ten-steady-runs', rows)).toBeUndefined()
    })
  })

  describe('all-library-grooves-steady', () => {
    const library = [{ id: 'a' }, { id: 'b' }]

    it('is not reached until every library groove has a steady attempt', () => {
      const rows = milestones({ ...EMPTY_INPUT, library, attempts: [attempt('a', 1, true)] })
      expect(reachedAtOf('all-library-grooves-steady', rows)).toBeUndefined()
    })

    it('is reached at the latest of each groove’s first steady attempt', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        library,
        attempts: [attempt('a', 5, true), attempt('a', 1, true), attempt('b', 20, true)],
      })
      expect(reachedAtOf('all-library-grooves-steady', rows)).toBe(20)
    })

    it('a steady attempt on a groove outside the library never satisfies it', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        library,
        attempts: [attempt('a', 1, true), attempt('practice-pad', 2, true)],
      })
      expect(reachedAtOf('all-library-grooves-steady', rows)).toBeUndefined()
    })

    it('is not reached when the library is empty', () => {
      const rows = milestones({ ...EMPTY_INPUT, library: [], attempts: [] })
      expect(reachedAtOf('all-library-grooves-steady', rows)).toBeUndefined()
    })
  })

  describe('first-rudiment-at-target', () => {
    const rudiments = [{ id: 'a', tier: 1, bpmBand: { target: 100 } }]

    it('is reached when a record meets its rudiment’s target', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        rudiments,
        rudimentRecords: { a: { bestCleanBpm: 100, at: 42 } },
      })
      expect(reachedAtOf('first-rudiment-at-target', rows)).toBe(42)
    })

    it('is not reached below target', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        rudiments,
        rudimentRecords: { a: { bestCleanBpm: 99, at: 42 } },
      })
      expect(reachedAtOf('first-rudiment-at-target', rows)).toBeUndefined()
    })

    it('ignores a record for an id that names no rudiment', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        rudiments,
        rudimentRecords: { ghost: { bestCleanBpm: 999, at: 42 } },
      })
      expect(reachedAtOf('first-rudiment-at-target', rows)).toBeUndefined()
    })
  })

  describe('tier-1-complete', () => {
    const rudiments = [
      { id: 'a', tier: 1, bpmBand: { target: 100 } },
      { id: 'b', tier: 1, bpmBand: { target: 100 } },
      { id: 'c', tier: 2, bpmBand: { target: 100 } },
    ]

    it('is not reached until every tier-1 rudiment is at target', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        rudiments,
        rudimentRecords: { a: { bestCleanBpm: 100, at: 1 } },
      })
      expect(reachedAtOf('tier-1-complete', rows)).toBeUndefined()
    })

    it('is reached at the latest of the tier-1 records once all are at target, ignoring other tiers', () => {
      const rows = milestones({
        ...EMPTY_INPUT,
        rudiments,
        rudimentRecords: {
          a: { bestCleanBpm: 100, at: 5 },
          b: { bestCleanBpm: 100, at: 9 },
          // tier 2's `c` has no record at all, and must not block tier 1.
        },
      })
      expect(reachedAtOf('tier-1-complete', rows)).toBe(9)
    })

    it('is not reached when there are no tier-1 rudiments', () => {
      const rows = milestones({ ...EMPTY_INPUT, rudiments: [{ id: 'c', tier: 2, bpmBand: { target: 100 } }] })
      expect(reachedAtOf('tier-1-complete', rows)).toBeUndefined()
    })
  })

  describe('properties', () => {
    const attemptArb = fc.record({
      grooveId: fc.constantFrom('money-beat', 'quarter-note-rock', 'practice-pad'),
      bpm: fc.integer({ min: 40, max: 200 }),
      at: fc.integer({ min: 0, max: 1_000_000 }),
      steady: fc.boolean(),
    })

    it('always outputs exactly the six ids, in fixed order', () => {
      fc.assert(
        fc.property(fc.array(attemptArb), (attempts) => {
          const rows = milestones({ ...EMPTY_INPUT, attempts })
          expect(rows.map((r) => r.id)).toEqual(MILESTONE_IDS)
        }),
      )
    })

    it('ten-steady-runs is reached iff there are at least 10 steady attempts', () => {
      fc.assert(
        fc.property(fc.array(attemptArb, { maxLength: 30 }), (attempts) => {
          const rows = milestones({ ...EMPTY_INPUT, attempts })
          const steadyCount = attempts.filter((a) => a.steady).length
          const reached = reachedAtOf('ten-steady-runs', rows) !== undefined
          expect(reached).toBe(steadyCount >= 10)
        }),
      )
    })

    it('adding a non-steady attempt never changes any reachedAt', () => {
      fc.assert(
        fc.property(fc.array(attemptArb), attemptArb, (attempts, extra) => {
          const nonSteadyExtra = { ...extra, steady: false }
          const before = milestones({ ...EMPTY_INPUT, attempts })
          const after = milestones({ ...EMPTY_INPUT, attempts: [...attempts, nonSteadyExtra] })
          expect(after.map((r) => r.reachedAt)).toEqual(before.map((r) => r.reachedAt))
        }),
      )
    })
  })
})
