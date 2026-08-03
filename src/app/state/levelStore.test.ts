/**
 * levelStore (roadmap 2.36, REQ-2.1–2.3) — a plain state container, tested
 * the same way `techniqueStore.test.ts`/`repertoireStore.test.ts` test their
 * own stores: this is a thin pass-through, so these tests prove the
 * delegation reaches core (clamping, per-track independence, the
 * overridden-blocks-advance rule) and the `hydrate` contract.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { initialLevelState, type ProgressEvidence } from '@core/progress/levels.ts'
import { MAX_LEVEL, MIN_LEVEL, type CurriculumLevel } from '@core/curriculum/types.ts'
import { useLevelStore } from './levelStore.ts'

function resetStore(): void {
  useLevelStore.setState({ levelState: initialLevelState() })
}

afterEach(resetStore)

function evidence(overrides: Partial<ProgressEvidence> = {}): ProgressEvidence {
  return {
    assessments: {},
    bestAssessmentAccuracy: 0,
    sightReadingLevel: 0,
    sightReadingAccuracy: 0,
    theoryRetention: 0,
    earTrainingLevel: 0,
    techniqueBpm: {},
    ...overrides,
  }
}

/** A level whose single `playing` exit criterion is met by `PASSING_EVIDENCE`. */
const PLAYING_LEVEL: CurriculumLevel = {
  number: MIN_LEVEL,
  title: 'Level 1',
  units: [],
  exitCriteria: [
    {
      id: 'crit-1',
      track: 'playing',
      description: 'Play the piece at 90% accuracy',
      check: { kind: 'assessment', minAccuracy: 0.9 },
    },
  ],
}

const PASSING_EVIDENCE = evidence({ bestAssessmentAccuracy: 0.95 })

describe('levelStore', () => {
  it('setTrackLevel marks that track overridden and leaves the other two alone', () => {
    useLevelStore.getState().setTrackLevel('theory', 3)

    const { levels, overridden } = useLevelStore.getState().levelState
    expect(levels.theory).toBe(3)
    expect(overridden.theory).toBe(true)
    expect(levels.playing).toBe(MIN_LEVEL)
    expect(overridden.playing).toBe(false)
    expect(levels['sight-reading']).toBe(MIN_LEVEL)
    expect(overridden['sight-reading']).toBe(false)
  })

  it('setTrackLevel clamps a level above MAX_LEVEL to MAX_LEVEL', () => {
    useLevelStore.getState().setTrackLevel('playing', 99)

    expect(useLevelStore.getState().levelState.levels.playing).toBe(MAX_LEVEL)
  })

  it('setTrackLevel clamps a level below MIN_LEVEL to MIN_LEVEL', () => {
    useLevelStore.getState().setTrackLevel('playing', -5)

    expect(useLevelStore.getState().levelState.levels.playing).toBe(MIN_LEVEL)
  })

  it('advanceTrack moves a non-overridden track that meets its exit criteria', () => {
    useLevelStore.getState().advanceTrack(PLAYING_LEVEL, 'playing', PASSING_EVIDENCE)

    expect(useLevelStore.getState().levelState.levels.playing).toBe(MIN_LEVEL + 1)
  })

  it('advanceTrack is a no-op on an overridden track even when criteria are met', () => {
    useLevelStore.getState().setTrackLevel('playing', MIN_LEVEL)
    const beforeAdvance = useLevelStore.getState().levelState

    useLevelStore.getState().advanceTrack(PLAYING_LEVEL, 'playing', PASSING_EVIDENCE)

    expect(useLevelStore.getState().levelState).toBe(beforeAdvance)
    expect(useLevelStore.getState().levelState.levels.playing).toBe(MIN_LEVEL)
  })

  it('advanceTrack is a no-op (not a throw) when level.number does not match the current level', () => {
    const mismatchedLevel: CurriculumLevel = { ...PLAYING_LEVEL, number: MIN_LEVEL + 1 }
    const beforeAdvance = useLevelStore.getState().levelState

    expect(() =>
      useLevelStore.getState().advanceTrack(mismatchedLevel, 'playing', PASSING_EVIDENCE),
    ).not.toThrow()
    expect(useLevelStore.getState().levelState).toBe(beforeAdvance)
  })

  it('hydrate replaces the whole state', () => {
    useLevelStore.getState().setTrackLevel('theory', 4)

    const replacement = {
      levels: { playing: 5, 'sight-reading': 2, theory: 1 },
      overridden: { playing: false, 'sight-reading': true, theory: false },
    }
    useLevelStore.getState().hydrate({ levelState: replacement })

    expect(useLevelStore.getState().levelState).toEqual(replacement)
  })
})
