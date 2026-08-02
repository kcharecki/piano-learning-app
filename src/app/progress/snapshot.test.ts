/**
 * Round-trip tests for `snapshot.ts`: seed the stores, gather a snapshot,
 * clear the stores, apply the snapshot back, and assert each store is back
 * to what it was — except for the fields `ProgressSnapshot`'s own contract
 * cannot carry (see the module comment on `assessments` and `repertoire`),
 * where the assertion is instead on exactly what recoverably round-trips.
 */
import { useProgressStore, type StoredAssessment } from '@app/state/progressStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import {
  MIN_LEVEL as SIGHT_READING_MIN_LEVEL,
  MAX_LEVEL as SIGHT_READING_MAX_LEVEL,
} from '@core/sightreading/adaptive.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import { FakeClock } from '@test/fakes.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { gatherProgressSnapshot, applyProgressSnapshot, SIGHT_READING_LEVEL_KEY } from './snapshot.ts'

function resetStores(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useSightReadingStore.setState({ level: SIGHT_READING_MIN_LEVEL, history: [] })
}

beforeEach(resetStores)

const practiceEntry: PracticeEntry = {
  id: 'pe-1',
  startedAt: 1_000,
  endedAt: 1_500,
  kind: 'repertoire',
  itemName: 'Minuet in G',
  itemId: 'score-1',
  tempoBpm: 90,
  accuracy: 0.87,
  note: 'felt good',
}

const card: Card = {
  id: 'staff-to-key-64',
  due: 5_000,
  intervalDays: 3,
  ease: 2.5,
  reps: 4,
  lapses: 1,
  introducedAt: 100,
}

const sightReadingRecord: SightReadingRecord = {
  pieceId: 'sr-piece-1',
  readAt: 2_000,
  accuracy: 0.82,
  level: 2,
}

const assessment: StoredAssessment = {
  id: 'assess-1',
  scoreId: 'score-1',
  scoreTitle: 'Minuet in G',
  at: 3_000,
  result: {
    scoreId: 'score-1',
    accuracy: 0.93,
    timingConsistency: 0.8,
    meanAbsDeviationMs: 12,
    tempoBpm: 100,
    measures: [
      {
        measureIndex: 0,
        expected: 4,
        correct: 4,
        wrongPitch: 0,
        missed: 0,
        extra: 0,
        accuracy: 1,
        meanAbsDeviationMs: 5,
      },
    ],
    counts: { correct: 4, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt: 3_000,
  },
}

function seedStores(): void {
  useProgressStore.getState().addPracticeEntry(practiceEntry)
  useProgressStore.getState().addAssessment(assessment)
  useFlashcardStore.getState().upsertCard(card)
  useSightReadingStore.getState().setLevel(4)
  useSightReadingStore.getState().addRecord(sightReadingRecord)
}

describe('gatherProgressSnapshot', () => {
  it('stamps exportedAt from the injected DateSource, never a real clock', () => {
    const clock = new FakeClock(42_000)
    const snapshot = gatherProgressSnapshot(clock)
    expect(snapshot.exportedAt).toBe(42_000)
    expect(snapshot.version).toBe(1)
  })

  it('always reports repertoire as empty — no store persists one yet', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(0))
    expect(snapshot.repertoire).toEqual([])
  })

  it('reports the sight-reading level under the sight-reading track key, and no others', () => {
    useSightReadingStore.getState().setLevel(3)
    const snapshot = gatherProgressSnapshot(new FakeClock(0))
    expect(snapshot.levels).toEqual({ [SIGHT_READING_LEVEL_KEY]: 3 })
  })
})

describe('gather -> clear -> apply round trip', () => {
  it('restores practiceEntries, srsCards, sightReadingHistory and the sight-reading level exactly', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(9_999))

    resetStores()
    expect(useProgressStore.getState().practiceEntries).toEqual([])
    expect(useFlashcardStore.getState().cardsById).toEqual({})
    expect(useSightReadingStore.getState().history).toEqual([])

    applyProgressSnapshot(snapshot)

    expect(useProgressStore.getState().practiceEntries).toEqual([practiceEntry])
    expect(useFlashcardStore.getState().cardsById).toEqual({ [card.id]: card })
    expect(useSightReadingStore.getState().history).toEqual([sightReadingRecord])
    expect(useSightReadingStore.getState().level).toBe(4)
  })

  it('restores an assessment\'s recoverable fields (id, at, accuracy, scoreId, scoreTitle) — not the full AssessmentResult', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(0))

    resetStores()
    applyProgressSnapshot(snapshot)

    const restored = useProgressStore.getState().assessments
    expect(restored).toHaveLength(1)
    const [got] = restored as [StoredAssessment]
    expect(got.id).toBe(assessment.id)
    expect(got.at).toBe(assessment.at)
    expect(got.scoreId).toBe(assessment.scoreId)
    expect(got.scoreTitle).toBe(assessment.scoreTitle)
    expect(got.result.accuracy).toBe(assessment.result.accuracy)
    // NOT preserved by StoredAssessmentLike's structural minimum — documented
    // in the module comment. Fabricated as the non-flattering placeholder (0),
    // never the maximum, so a restored assessment can never pass a timing
    // threshold it has no evidence for.
    expect(got.result.timingConsistency).toBe(0)
    expect(got.result.counts).toEqual({ correct: 0, wrongPitch: 0, missed: 0, extra: 0 })
    expect(got.result.measures).toEqual([])
  })

  it('falls back to the sight-reading MIN_LEVEL when a snapshot carries no sight-reading level', () => {
    const snapshot = gatherProgressSnapshot(new FakeClock(0))
    const noLevels = { ...snapshot, levels: {} }
    // Move the store off MIN_LEVEL first, so the assertion below distinguishes
    // "reset to MIN_LEVEL" from "left alone".
    useSightReadingStore.getState().setLevel(4)

    applyProgressSnapshot(noLevels)

    expect(useSightReadingStore.getState().level).toBe(SIGHT_READING_MIN_LEVEL)
  })

  it('clamps an out-of-range restored sight-reading level to MAX_LEVEL, instead of persisting an invalid one', () => {
    const snapshot = gatherProgressSnapshot(new FakeClock(0))
    const outOfRange = { ...snapshot, levels: { [SIGHT_READING_LEVEL_KEY]: 7 } }

    applyProgressSnapshot(outOfRange)

    expect(useSightReadingStore.getState().level).toBe(SIGHT_READING_MAX_LEVEL)
  })

  it('REPLACES rather than merges: pre-existing store contents do not survive an apply', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(0))

    // Seed something ELSE into the stores before applying — it must not survive.
    useProgressStore.getState().addPracticeEntry({ ...practiceEntry, id: 'other-entry' })
    useFlashcardStore.getState().upsertCard({ ...card, id: 'other-card' })

    applyProgressSnapshot(snapshot)

    expect(useProgressStore.getState().practiceEntries).toEqual([practiceEntry])
    expect(useFlashcardStore.getState().cardsById).toEqual({ [card.id]: card })
  })
})
