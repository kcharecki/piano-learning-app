/**
 * `progressStore` (roadmap 2.24) — state only, three independent capped
 * newest-first lists.
 */
import type { AssessmentResult } from '@core/practice/assessment.ts'
import type { Recording } from '@core/practice/recorder.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { midi, millis } from '@core/shared/units.ts'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_STORED_ASSESSMENTS,
  MAX_STORED_PRACTICE_ENTRIES,
  MAX_STORED_RECORDINGS,
  useProgressStore,
  type StoredAssessment,
} from './progressStore.ts'

function resetStore(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
}

afterEach(resetStore)

function assessmentResult(overrides: Partial<AssessmentResult> = {}): AssessmentResult {
  return {
    scoreId: 'score-a',
    accuracy: 1,
    timingConsistency: 1,
    meanAbsDeviationMs: 0,
    tempoBpm: 120,
    measures: [],
    counts: { correct: 3, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt: 1000,
    ...overrides,
  }
}

function storedAssessment(id: string, at = 1000): StoredAssessment {
  return {
    id,
    scoreId: 'score-a',
    scoreTitle: 'Test Score',
    at,
    result: assessmentResult({ completedAt: at }),
  }
}

function recording(id: string): Recording {
  return {
    id,
    recordedAt: 1000,
    durationMs: 150,
    events: [{ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }],
  }
}

function practiceEntry(id: string): PracticeEntry {
  return {
    id,
    startedAt: 1000,
    endedAt: 2000,
    kind: 'repertoire',
    itemName: 'Test Piece',
  }
}

describe('useProgressStore', () => {
  it('starts empty', () => {
    expect(useProgressStore.getState().assessments).toEqual([])
    expect(useProgressStore.getState().recordings).toEqual([])
    expect(useProgressStore.getState().practiceEntries).toEqual([])
  })

  it('addAssessment prepends, newest first', () => {
    const a = storedAssessment('a')
    const b = storedAssessment('b')
    useProgressStore.getState().addAssessment(a)
    useProgressStore.getState().addAssessment(b)

    expect(useProgressStore.getState().assessments).toEqual([b, a])
  })

  it('addAssessment evicts the oldest entry once past MAX_STORED_ASSESSMENTS', () => {
    for (let i = 0; i < MAX_STORED_ASSESSMENTS + 1; i++) {
      useProgressStore.getState().addAssessment(storedAssessment(`a${i}`))
    }

    const assessments = useProgressStore.getState().assessments
    expect(assessments).toHaveLength(MAX_STORED_ASSESSMENTS)
    // Newest first: the very last one added is at the front...
    expect(assessments[0]?.id).toBe(`a${MAX_STORED_ASSESSMENTS}`)
    // ...and the oldest (id "a0") was evicted, not just the count trimmed.
    expect(assessments.some((a) => a.id === 'a0')).toBe(false)
  })

  it('addRecording prepends, newest first, and evicts past MAX_STORED_RECORDINGS', () => {
    for (let i = 0; i < MAX_STORED_RECORDINGS + 1; i++) {
      useProgressStore.getState().addRecording(recording(`r${i}`))
    }

    const recordings = useProgressStore.getState().recordings
    expect(recordings).toHaveLength(MAX_STORED_RECORDINGS)
    expect(recordings[0]?.id).toBe(`r${MAX_STORED_RECORDINGS}`)
    expect(recordings.some((r) => r.id === 'r0')).toBe(false)
  })

  it('addPracticeEntry prepends, newest first, and evicts past MAX_STORED_PRACTICE_ENTRIES', () => {
    for (let i = 0; i < MAX_STORED_PRACTICE_ENTRIES + 1; i++) {
      useProgressStore.getState().addPracticeEntry(practiceEntry(`p${i}`))
    }

    const entries = useProgressStore.getState().practiceEntries
    expect(entries).toHaveLength(MAX_STORED_PRACTICE_ENTRIES)
    expect(entries[0]?.id).toBe(`p${MAX_STORED_PRACTICE_ENTRIES}`)
    expect(entries.some((e) => e.id === 'p0')).toBe(false)
  })

  // Kills a mutant that has `hydrate` reset the collections it was not given
  // (or merge/append into an existing collection instead of replacing it):
  // `persistence.ts` restores each of the three collections independently and
  // must be able to apply one without disturbing the other two.
  it('hydrate replaces only the collections it is given, leaving the others untouched', () => {
    useProgressStore.getState().addAssessment(storedAssessment('a'))
    useProgressStore.getState().addRecording(recording('r'))
    useProgressStore.getState().addPracticeEntry(practiceEntry('p'))

    const newAssessment = storedAssessment('hydrated')
    useProgressStore.getState().hydrate({ assessments: [newAssessment] })

    expect(useProgressStore.getState().assessments).toEqual([newAssessment])
    // Untouched by the partial hydrate:
    expect(useProgressStore.getState().recordings.map((r) => r.id)).toEqual(['r'])
    expect(useProgressStore.getState().practiceEntries.map((p) => p.id)).toEqual(['p'])
  })

  it('hydrate replaces wholesale, not append, when given a collection', () => {
    useProgressStore.getState().addRecording(recording('old'))

    useProgressStore.getState().hydrate({ recordings: [recording('new')] })

    expect(useProgressStore.getState().recordings.map((r) => r.id)).toEqual(['new'])
  })
})
