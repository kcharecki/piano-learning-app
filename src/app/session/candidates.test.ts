import { describe, expect, it } from 'vitest'
import { makeScore } from '@core/notation/score.ts'
import type { LoadedScore } from '@app/state/scoreStore.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import type { DrillKind } from '@app/drills/useFlashcardDrill.ts'
import { WARMUP_EXERCISE } from '@content/curriculum/warmups.ts'
import { sessionCandidates } from './candidates.ts'

function loadedScore(sourceName: string): LoadedScore {
  return {
    score: makeScore({ id: 'test-score', measures: [{}], notes: [], tempos: [{ tick: 0, bpm: 120 }] }),
    sourceName,
    musicXml: undefined,
  }
}

describe('sessionCandidates', () => {
  it('always offers exactly the one fixed warm-up exercise, unconditionally (roadmap 5.45)', () => {
    const withNothingLoaded = sessionCandidates({ sightReadingLevel: 1, loadedScore: undefined })
    const withScoreLoaded = sessionCandidates({
      sightReadingLevel: 4,
      loadedScore: loadedScore('Twinkle Twinkle'),
      techniqueLevel: 3,
    })
    expect(withNothingLoaded.warmup).toEqual([WARMUP_EXERCISE])
    expect(withScoreLoaded.warmup).toEqual([WARMUP_EXERCISE])
  })

  it('offers the level\'s real technique drills, each carrying the id the screen opens', () => {
    // Before roadmap 4.4a this segment was deliberately empty, because no
    // screen could open a technique exercise. Now it must carry the drill id
    // through, or the Technique screen has nothing to select.
    for (const level of [0, 1, 3, 5, 99]) {
      const result = sessionCandidates({
        sightReadingLevel: 1,
        loadedScore: undefined,
        techniqueLevel: level,
      })
      expect(result.technique.length).toBeGreaterThan(0)
      for (const exercise of result.technique) {
        expect(exercise.kind).toBe('technique')
        expect(typeof exercise.params?.drillId).toBe('string')
        expect(techniqueDrillById(String(exercise.params?.drillId))).toBeDefined()
      }
    }
  })

  it('defaults the technique level to level 1 when none is given', () => {
    const withDefault = sessionCandidates({ sightReadingLevel: 3, loadedScore: undefined })
    const explicit = sessionCandidates({
      sightReadingLevel: 3,
      loadedScore: undefined,
      techniqueLevel: 1,
    })
    expect(withDefault.technique).toEqual(explicit.technique)
  })

  it('offers exactly one sight-reading candidate, pointing at the current level', () => {
    const result = sessionCandidates({ sightReadingLevel: 4, loadedScore: undefined })

    expect(result['sight-reading']).toHaveLength(1)
    expect(result['sight-reading'][0]?.kind).toBe('sight-read')
    expect(result['sight-reading'][0]?.params?.level).toBe(4)
  })

  it('clamps an out-of-range sight-reading level before using it as the sight-reading candidate level', () => {
    const tooLow = sessionCandidates({ sightReadingLevel: 0, loadedScore: undefined })
    const tooHigh = sessionCandidates({ sightReadingLevel: 99, loadedScore: undefined })

    expect(tooLow['sight-reading'][0]?.params?.level).toBe(1)
    // Sight reading's own ladder (roadmap 5.11) tops out at 6, independently
    // of the curriculum's separate 1..5 playing/theory tracks.
    expect(tooHigh['sight-reading'][0]?.params?.level).toBe(6)
  })

  it('offers both flashcard decks FlashcardScreen can actually open for the theory-ear segment', () => {
    const result = sessionCandidates({ sightReadingLevel: 1, loadedScore: undefined })

    expect(result['theory-ear']).toHaveLength(2)
    // The screen can actually open exactly these two kinds — see `DrillKind`.
    const openableKinds: DrillKind[] = ['staff-to-key', 'interval-on-staff']
    for (const exercise of result['theory-ear']) {
      expect(exercise.kind).toBe('theory-quiz')
      expect(openableKinds).toContain(exercise.params?.drillKind)
    }
    const drillKinds = result['theory-ear'].map((exercise) => exercise.params?.drillKind)
    expect(drillKinds).toEqual(expect.arrayContaining(openableKinds))
  })

  it('lesson segment is empty when no score is loaded', () => {
    const result = sessionCandidates({ sightReadingLevel: 1, loadedScore: undefined })
    expect(result.lesson).toEqual([])
  })

  it('lesson segment offers the loaded score when one is loaded', () => {
    const result = sessionCandidates({
      sightReadingLevel: 1,
      loadedScore: loadedScore('Twinkle Twinkle'),
    })

    expect(result.lesson).toHaveLength(1)
    expect(result.lesson[0]?.kind).toBe('repertoire')
    expect(result.lesson[0]?.title).toContain('Twinkle Twinkle')
  })
})
