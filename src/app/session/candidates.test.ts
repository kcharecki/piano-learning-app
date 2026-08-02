import { describe, expect, it } from 'vitest'
import { makeScore } from '@core/notation/score.ts'
import type { LoadedScore } from '@app/state/scoreStore.ts'
import { sessionCandidates } from './candidates.ts'

function loadedScore(sourceName: string): LoadedScore {
  return {
    score: makeScore({ id: 'test-score', measures: [{}], notes: [], tempos: [{ tick: 0, bpm: 120 }] }),
    sourceName,
    musicXml: undefined,
  }
}

describe('sessionCandidates', () => {
  it('technique candidates are always empty — no technique screen exists to open one', () => {
    for (const level of [0, 1, 3, 5, 99]) {
      const result = sessionCandidates({ sightReadingLevel: level, loadedScore: undefined })
      expect(result.technique).toEqual([])
    }
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
    expect(tooHigh['sight-reading'][0]?.params?.level).toBe(5)
  })

  it('offers exactly the one reachable flashcard deck for the theory-ear segment', () => {
    const result = sessionCandidates({ sightReadingLevel: 1, loadedScore: undefined })

    expect(result['theory-ear']).toHaveLength(1)
    expect(result['theory-ear'][0]?.kind).toBe('theory-quiz')
    expect(result['theory-ear'][0]?.params?.drillKind).toBe('staff-to-key')
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
