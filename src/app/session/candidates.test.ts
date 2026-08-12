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

  // roadmap 4.10, M4 acceptance Defect 1b (docs/m4-acceptance-2026-08-12.md):
  // a fresh install has no loaded score AND an empty repertoire library (the
  // library is never auto-seeded from the graded catalogue — see
  // repertoire-seed.spec.ts), so the lesson segment used to plan "0 min" on
  // exactly the profile Today (the app's default screen) actually shows.
  it('lesson segment falls back to the curriculum\'s first lesson on a cold profile (no score, no repertoire)', () => {
    const result = sessionCandidates({ sightReadingLevel: 1, loadedScore: undefined })

    expect(result.lesson).toHaveLength(1)
    expect(result.lesson[0]?.kind).toBe('play')
    expect(result.lesson[0]?.title).toMatch(/^Lesson: /)
  })

  it('lesson segment offers the loaded score when one is loaded, even with repertoire pieces present', () => {
    const result = sessionCandidates({
      sightReadingLevel: 1,
      loadedScore: loadedScore('Twinkle Twinkle'),
      repertoirePieces: [{ id: 'minuet-in-g', title: 'Minuet in G' }],
    })

    expect(result.lesson).toHaveLength(1)
    expect(result.lesson[0]?.kind).toBe('repertoire')
    expect(result.lesson[0]?.title).toContain('Twinkle Twinkle')
  })

  it('lesson segment falls back to the first repertoire piece when no score is loaded but the library is not empty', () => {
    const result = sessionCandidates({
      sightReadingLevel: 1,
      loadedScore: undefined,
      repertoirePieces: [
        { id: 'minuet-in-g', title: 'Minuet in G' },
        { id: 'fur-elise', title: 'Für Elise' },
      ],
    })

    expect(result.lesson).toHaveLength(1)
    expect(result.lesson[0]?.kind).toBe('repertoire')
    expect(result.lesson[0]?.title).toContain('Minuet in G')
    expect(result.lesson[0]?.title).not.toContain('Für Elise')
  })

  it('lesson segment never returns empty, whatever state is supplied', () => {
    const cold = sessionCandidates({ sightReadingLevel: 1, loadedScore: undefined })
    const withRepertoire = sessionCandidates({
      sightReadingLevel: 1,
      loadedScore: undefined,
      repertoirePieces: [{ id: 'x', title: 'X' }],
    })
    const withScore = sessionCandidates({
      sightReadingLevel: 1,
      loadedScore: loadedScore('Y'),
    })
    expect(cold.lesson.length).toBeGreaterThan(0)
    expect(withRepertoire.lesson.length).toBeGreaterThan(0)
    expect(withScore.lesson.length).toBeGreaterThan(0)
  })
})
