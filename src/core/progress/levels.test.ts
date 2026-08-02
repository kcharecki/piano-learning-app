import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CurriculumLevel, ExitCheck, ExitCriterion, Track } from '@core/curriculum/types.ts'
import { MAX_LEVEL, MIN_LEVEL, TRACKS } from '@core/curriculum/types.ts'
import {
  advance,
  canAdvance,
  evaluateCriterion,
  initialLevelState,
  setLevel,
  trackProgress,
  type LevelState,
  type ProgressEvidence,
} from './levels.ts'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const emptyEvidence: ProgressEvidence = {
  assessments: {},
  bestAssessmentAccuracy: 0,
  sightReadingLevel: 0,
  sightReadingAccuracy: 0,
  theoryRetention: 0,
  earTrainingLevel: 0,
  techniqueBpm: {},
}

const criterion = (id: string, track: Track, check: ExitCheck): ExitCriterion => ({
  id,
  track,
  description: id,
  check,
})

/** A curriculum level with one criterion per track, for property tests. */
const levelWith = (criteria: readonly ExitCriterion[], number = 1): CurriculumLevel => ({
  number,
  title: `Level ${number}`,
  units: [],
  exitCriteria: criteria,
})

// ---------------------------------------------------------------------------
// initialLevelState
// ---------------------------------------------------------------------------

describe('initialLevelState', () => {
  it('starts every track at MIN_LEVEL, none overridden', () => {
    const state = initialLevelState()
    for (const track of TRACKS) {
      expect(state.levels[track]).toBe(MIN_LEVEL)
      expect(state.overridden[track]).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// evaluateCriterion — one worked example per ExitCheck variant, including
// just-below and just-at threshold.
// ---------------------------------------------------------------------------

describe('evaluateCriterion — assessment', () => {
  it('reads bestAssessmentAccuracy when no pieceId is given', () => {
    const c = criterion('a1', 'playing', { kind: 'assessment', minAccuracy: 0.8 })
    const justBelow = evaluateCriterion(c, { ...emptyEvidence, bestAssessmentAccuracy: 0.79 })
    expect(justBelow.met).toBe(false)
    expect(justBelow.progress).toBeCloseTo(0.79 / 0.8, 5)

    const justAt = evaluateCriterion(c, { ...emptyEvidence, bestAssessmentAccuracy: 0.8 })
    expect(justAt.met).toBe(true)
    expect(justAt.progress).toBe(1)
  })

  it('reads the named piece accuracy when pieceId is given, 0 if missing', () => {
    const c = criterion('a2', 'playing', {
      kind: 'assessment',
      minAccuracy: 0.9,
      pieceId: 'minuet-in-g',
    })
    const missing = evaluateCriterion(c, emptyEvidence)
    expect(missing.met).toBe(false)
    expect(missing.progress).toBe(0)

    const justBelow = evaluateCriterion(c, {
      ...emptyEvidence,
      assessments: { 'minuet-in-g': 0.89 },
      bestAssessmentAccuracy: 0.99, // must be ignored — pieceId takes precedence
    })
    expect(justBelow.met).toBe(false)

    const justAt = evaluateCriterion(c, { ...emptyEvidence, assessments: { 'minuet-in-g': 0.9 } })
    expect(justAt.met).toBe(true)
    expect(justAt.progress).toBe(1)
  })
})

describe('evaluateCriterion — sight-reading', () => {
  const c = criterion('sr1', 'sight-reading', {
    kind: 'sight-reading',
    minLevel: 3,
    minAccuracy: 0.85,
  })

  it('requires both level and accuracy to clear', () => {
    const levelOnly = evaluateCriterion(c, {
      ...emptyEvidence,
      sightReadingLevel: 3,
      sightReadingAccuracy: 0.5,
    })
    expect(levelOnly.met).toBe(false)

    const accuracyOnly = evaluateCriterion(c, {
      ...emptyEvidence,
      sightReadingLevel: 1,
      sightReadingAccuracy: 0.9,
    })
    expect(accuracyOnly.met).toBe(false)
  })

  it('just below vs just at the accuracy threshold', () => {
    const justBelow = evaluateCriterion(c, {
      ...emptyEvidence,
      sightReadingLevel: 3,
      sightReadingAccuracy: 0.84,
    })
    expect(justBelow.met).toBe(false)

    const justAt = evaluateCriterion(c, {
      ...emptyEvidence,
      sightReadingLevel: 3,
      sightReadingAccuracy: 0.85,
    })
    expect(justAt.met).toBe(true)
    expect(justAt.progress).toBe(1)
  })
})

describe('evaluateCriterion — theory-quiz', () => {
  const c = criterion('t1', 'theory', { kind: 'theory-quiz', minRetention: 0.75 })

  it('just below vs just at threshold', () => {
    const justBelow = evaluateCriterion(c, { ...emptyEvidence, theoryRetention: 0.74 })
    expect(justBelow.met).toBe(false)
    expect(justBelow.progress).toBeLessThan(1)

    const justAt = evaluateCriterion(c, { ...emptyEvidence, theoryRetention: 0.75 })
    expect(justAt.met).toBe(true)
    expect(justAt.progress).toBe(1)
  })
})

describe('evaluateCriterion — ear-training', () => {
  const c = criterion('e1', 'theory', { kind: 'ear-training', minLevel: 2 })

  it('just below vs just at threshold', () => {
    const justBelow = evaluateCriterion(c, { ...emptyEvidence, earTrainingLevel: 1 })
    expect(justBelow.met).toBe(false)

    const justAt = evaluateCriterion(c, { ...emptyEvidence, earTrainingLevel: 2 })
    expect(justAt.met).toBe(true)
    expect(justAt.progress).toBe(1)
  })
})

describe('evaluateCriterion — technique', () => {
  const c = criterion('tech1', 'playing', {
    kind: 'technique',
    drillId: 'scales-c-major',
    minBpm: 120,
  })

  it('missing drill evidence reads as 0, never a pass', () => {
    const missing = evaluateCriterion(c, emptyEvidence)
    expect(missing.met).toBe(false)
    expect(missing.progress).toBe(0)
  })

  it('just below vs just at threshold', () => {
    const justBelow = evaluateCriterion(c, {
      ...emptyEvidence,
      techniqueBpm: { 'scales-c-major': 119 },
    })
    expect(justBelow.met).toBe(false)

    const justAt = evaluateCriterion(c, {
      ...emptyEvidence,
      techniqueBpm: { 'scales-c-major': 120 },
    })
    expect(justAt.met).toBe(true)
    expect(justAt.progress).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// met === true  <=>  progress === 1 : no contradiction, across every variant
// ---------------------------------------------------------------------------

describe('evaluateCriterion — met/progress agreement', () => {
  const checkArb: fc.Arbitrary<ExitCheck> = fc.oneof(
    fc.record({
      kind: fc.constant('assessment' as const),
      minAccuracy: fc.float({ min: 0, max: 1, noNaN: true }),
    }),
    fc.record({
      kind: fc.constant('assessment' as const),
      minAccuracy: fc.float({ min: 0, max: 1, noNaN: true }),
      pieceId: fc.constantFrom('p1', 'p2'),
    }),
    fc.record({
      kind: fc.constant('sight-reading' as const),
      minLevel: fc.integer({ min: 1, max: 5 }),
      minAccuracy: fc.float({ min: 0, max: 1, noNaN: true }),
    }),
    fc.record({
      kind: fc.constant('theory-quiz' as const),
      minRetention: fc.float({ min: 0, max: 1, noNaN: true }),
    }),
    fc.record({
      kind: fc.constant('ear-training' as const),
      minLevel: fc.integer({ min: 1, max: 5 }),
    }),
    fc.record({
      kind: fc.constant('technique' as const),
      drillId: fc.constant('d1'),
      minBpm: fc.float({ min: 1, max: 240, noNaN: true }),
    }),
  )

  const evidenceArb: fc.Arbitrary<ProgressEvidence> = fc.record({
    assessments: fc.dictionary(fc.constantFrom('p1', 'p2'), fc.float({ min: 0, max: 1, noNaN: true })),
    bestAssessmentAccuracy: fc.float({ min: 0, max: 1, noNaN: true }),
    sightReadingLevel: fc.integer({ min: 0, max: 5 }),
    sightReadingAccuracy: fc.float({ min: 0, max: 1, noNaN: true }),
    theoryRetention: fc.float({ min: 0, max: 1, noNaN: true }),
    earTrainingLevel: fc.integer({ min: 0, max: 5 }),
    techniqueBpm: fc.dictionary(fc.constant('d1'), fc.float({ min: 0, max: 240, noNaN: true })),
  })

  it('progress is exactly 1 iff met is true, and always within [0,1]', () => {
    fc.assert(
      fc.property(checkArb, evidenceArb, (check, evidence) => {
        const status = evaluateCriterion(criterion('x', 'playing', check), evidence)
        expect(status.progress).toBeGreaterThanOrEqual(0)
        expect(status.progress).toBeLessThanOrEqual(1)
        expect(status.progress === 1).toBe(status.met)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// setLevel — REQ-2.3, always wins, clamps to [MIN_LEVEL, MAX_LEVEL]
// ---------------------------------------------------------------------------

describe('setLevel', () => {
  it('sets the level regardless of evidence and marks the track overridden', () => {
    const state = setLevel(initialLevelState(), 'theory', 4)
    expect(state.levels.theory).toBe(4)
    expect(state.overridden.theory).toBe(true)
  })

  it('leaves other tracks untouched', () => {
    const state = setLevel(initialLevelState(), 'playing', 3)
    expect(state.levels['sight-reading']).toBe(MIN_LEVEL)
    expect(state.overridden['sight-reading']).toBe(false)
  })

  it('clamps below MIN_LEVEL and above MAX_LEVEL', () => {
    const low = setLevel(initialLevelState(), 'playing', 0)
    expect(low.levels.playing).toBe(MIN_LEVEL)

    const high = setLevel(initialLevelState(), 'playing', 99)
    expect(high.levels.playing).toBe(MAX_LEVEL)
  })

  it('property: always lands within [MIN_LEVEL, MAX_LEVEL], never errs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TRACKS),
        fc.integer({ min: -100, max: 100 }),
        (track, levelNumber) => {
          const state = setLevel(initialLevelState(), track, levelNumber)
          expect(state.levels[track]).toBeGreaterThanOrEqual(MIN_LEVEL)
          expect(state.levels[track]).toBeLessThanOrEqual(MAX_LEVEL)
          expect(state.overridden[track]).toBe(true)
        },
      ),
    )
  })

  it('does not mutate the input state', () => {
    const before = initialLevelState()
    const snapshot = { levels: { ...before.levels }, overridden: { ...before.overridden } }
    setLevel(before, 'playing', 5)
    expect(before.levels).toEqual(snapshot.levels)
    expect(before.overridden).toEqual(snapshot.overridden)
  })
})

// ---------------------------------------------------------------------------
// advance — REQ-2.2, moves by exactly one when every criterion is met, is a
// no-op otherwise. Property-tested over arbitrary criteria sets.
// ---------------------------------------------------------------------------

describe('advance', () => {
  const track: Track = 'playing'
  const metCriterion = criterion('c-met', track, { kind: 'assessment', minAccuracy: 0.5 })
  const unmetCriterion = criterion('c-unmet', track, { kind: 'assessment', minAccuracy: 0.99 })
  const evidenceMeetingBoth: ProgressEvidence = { ...emptyEvidence, bestAssessmentAccuracy: 1 }
  const evidenceMeetingNeither: ProgressEvidence = { ...emptyEvidence, bestAssessmentAccuracy: 0 }

  it('is a no-op when a criterion is unmet', () => {
    const level = levelWith([metCriterion, unmetCriterion])
    const state = initialLevelState()
    const next = advance(state, level, track, evidenceMeetingNeither)
    expect(next).toEqual(state)
  })

  it('moves by exactly one when all criteria are met', () => {
    const level = levelWith([metCriterion])
    const state = initialLevelState()
    const next = advance(state, level, track, evidenceMeetingBoth)
    expect(next.levels[track]).toBe(state.levels[track] + 1)
    // every other track and the overridden map are untouched
    expect(next.overridden).toEqual(state.overridden)
    for (const other of TRACKS) {
      if (other !== track) expect(next.levels[other]).toBe(state.levels[other])
    }
  })

  it('never exceeds MAX_LEVEL even when already at the top, and is an identity no-op', () => {
    const state = { ...initialLevelState(), levels: { ...initialLevelState().levels, [track]: MAX_LEVEL } }
    const level = levelWith([metCriterion], MAX_LEVEL)
    const next = advance(state, level, track, evidenceMeetingBoth)
    expect(next.levels[track]).toBe(MAX_LEVEL)
    expect(next).toBe(state)
  })

  it('never moves an overridden track, even when every criterion is met', () => {
    const level = levelWith([metCriterion])
    const overriddenState = setLevel(initialLevelState(), track, 2)
    const next = advance(overriddenState, level, track, evidenceMeetingBoth)
    expect(next).toBe(overriddenState)
    expect(next.levels[track]).toBe(2)
  })

  it('property: no-op whenever any criterion is unmet; moves by exactly one (clamped) when all are met', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: MIN_LEVEL, max: MAX_LEVEL }),
        (metFlags, start) => {
          const criteria = metFlags.map((met, i) =>
            criterion(`c${i}`, track, {
              kind: 'assessment',
              minAccuracy: met ? 0 : 1,
              pieceId: `p${i}`,
            }),
          )
          const level = levelWith(criteria, start)
          const assessments: Record<string, number> = {}
          for (let i = 0; i < metFlags.length; i++) {
            // 1 clears a 0 threshold (met); 0 never clears a 1 threshold (unmet)
            assessments[`p${i}`] = metFlags[i] === true ? 1 : 0
          }
          const evidence: ProgressEvidence = { ...emptyEvidence, assessments }
          const state = { ...initialLevelState(), levels: { ...initialLevelState().levels, [track]: start } }
          const next = advance(state, level, track, evidence)
          const allMet = metFlags.every(Boolean)
          const expected = allMet && start < MAX_LEVEL ? start + 1 : start
          expect(next.levels[track]).toBe(expected)
        },
      ),
    )
  })

  it('does not mutate the input state', () => {
    const level = levelWith([metCriterion])
    const state = initialLevelState()
    const snapshot = { levels: { ...state.levels }, overridden: { ...state.overridden } }
    advance(state, level, track, evidenceMeetingBoth)
    expect(state.levels).toEqual(snapshot.levels)
    expect(state.overridden).toEqual(snapshot.overridden)
  })
})

// ---------------------------------------------------------------------------
// trackProgress / canAdvance
// ---------------------------------------------------------------------------

describe('trackProgress', () => {
  it('only returns criteria for the requested track', () => {
    const level = levelWith([
      criterion('p1', 'playing', { kind: 'assessment', minAccuracy: 0.5 }),
      criterion('t1', 'theory', { kind: 'theory-quiz', minRetention: 0.5 }),
    ])
    const statuses = trackProgress(initialLevelState(), level, 'playing', emptyEvidence)
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.criterion.id).toBe('p1')
  })
})

describe('canAdvance', () => {
  it('is true only when every criterion for the track is met', () => {
    const level = levelWith([
      criterion('c1', 'playing', { kind: 'assessment', minAccuracy: 0.5 }),
      criterion('c2', 'playing', { kind: 'assessment', minAccuracy: 0.9 }),
    ])
    const partial: ProgressEvidence = { ...emptyEvidence, bestAssessmentAccuracy: 0.6 }
    const full: ProgressEvidence = { ...emptyEvidence, bestAssessmentAccuracy: 0.95 }
    const state = initialLevelState()
    expect(canAdvance(state, level, 'playing', partial)).toBe(false)
    expect(canAdvance(state, level, 'playing', full)).toBe(true)
  })

  it('is false (never vacuously true) when the track has no criteria at this level', () => {
    const level = levelWith([])
    expect(canAdvance(initialLevelState(), level, 'playing', emptyEvidence)).toBe(false)
  })

  it('throws when the level does not match the state\'s current level for that track', () => {
    const level = levelWith([criterion('c1', 'playing', { kind: 'assessment', minAccuracy: 0.5 })], 3)
    expect(() => canAdvance(initialLevelState(), level, 'playing', emptyEvidence)).toThrow()
  })
})

describe('ratioProgress via evaluateCriterion — NaN evidence', () => {
  it('treats NaN evidence as unmet with zero progress, never NaN', () => {
    const c = criterion('nan1', 'theory', { kind: 'theory-quiz', minRetention: 0.75 })
    const status = evaluateCriterion(c, { ...emptyEvidence, theoryRetention: NaN })
    expect(status.met).toBe(false)
    expect(status.progress).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// pure — inputs and their nested collections are never mutated
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('setLevel and advance never share array/object identity with mutated fields', () => {
    const state: LevelState = initialLevelState()
    const level = levelWith([criterion('c1', 'playing', { kind: 'assessment', minAccuracy: 0 })])
    const afterAdvance = advance(state, level, 'playing', emptyEvidence)
    expect(afterAdvance).not.toBe(state)
    expect(afterAdvance.levels).not.toBe(state.levels)

    const afterSet = setLevel(state, 'theory', 3)
    expect(afterSet).not.toBe(state)
    expect(afterSet.levels).not.toBe(state.levels)
    expect(afterSet.overridden).not.toBe(state.overridden)
  })
})
