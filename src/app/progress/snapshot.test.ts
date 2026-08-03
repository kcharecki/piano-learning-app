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
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import {
  MIN_LEVEL as SIGHT_READING_MIN_LEVEL,
  MAX_LEVEL as SIGHT_READING_MAX_LEVEL,
} from '@core/sightreading/adaptive.ts'
import { MIN_LEVEL as REPERTOIRE_MIN_LEVEL } from '@core/curriculum/types.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { FakeClock } from '@test/fakes.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { gatherProgressSnapshot, applyProgressSnapshot, SIGHT_READING_LEVEL_KEY } from './snapshot.ts'

function resetStores(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useSightReadingStore.setState({ level: SIGHT_READING_MIN_LEVEL, history: [] })
  useTechniqueStore.setState({ attempts: [] })
  useRepertoireStore.setState({ pieces: [] })
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

const techniqueAttempt: TechniqueAttempt = {
  drillId: 'scale-c-major-2oct-hands-together',
  at: 4_000,
  bpm: 84,
  evenness: 0.9,
  accuracy: 1,
  clean: true,
}

const repertoirePieceInput = {
  id: 'piece-1',
  title: 'Fur Elise',
  composer: 'Beethoven',
  level: 3,
}

const repertoireSession = { at: 6_000, minutes: 20, accuracy: 0.8 }

function seedStores(): void {
  useProgressStore.getState().addPracticeEntry(practiceEntry)
  useProgressStore.getState().addAssessment(assessment)
  useFlashcardStore.getState().upsertCard(card)
  useSightReadingStore.getState().setLevel(4)
  useSightReadingStore.getState().addRecord(sightReadingRecord)
  useTechniqueStore.getState().addAttempt(techniqueAttempt)
  useRepertoireStore.getState().addPiece(repertoirePieceInput)
  useRepertoireStore.getState().setStatus(repertoirePieceInput.id, 'maintained')
  useRepertoireStore.getState().recordSession(repertoirePieceInput.id, repertoireSession)
}

describe('gatherProgressSnapshot', () => {
  it('stamps exportedAt from the injected DateSource, never a real clock', () => {
    const clock = new FakeClock(42_000)
    const snapshot = gatherProgressSnapshot(clock)
    expect(snapshot.exportedAt).toBe(42_000)
    expect(snapshot.version).toBe(1)
  })

  it('gathers the repertoire library, projected to id/title/composer/status', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(0))
    expect(snapshot.repertoire).toEqual([
      { id: 'piece-1', title: 'Fur Elise', composer: 'Beethoven', status: 'maintained' },
    ])
  })

  it('reports the sight-reading level under the sight-reading track key, and no others', () => {
    useSightReadingStore.getState().setLevel(3)
    const snapshot = gatherProgressSnapshot(new FakeClock(0))
    expect(snapshot.levels).toEqual({ [SIGHT_READING_LEVEL_KEY]: 3 })
  })
})

describe('gather -> clear -> apply round trip', () => {
  it('restores practiceEntries, srsCards, sightReadingHistory, techniqueAttempts and the sight-reading level exactly', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(9_999))

    resetStores()
    expect(useProgressStore.getState().practiceEntries).toEqual([])
    expect(useFlashcardStore.getState().cardsById).toEqual({})
    expect(useSightReadingStore.getState().history).toEqual([])
    expect(useTechniqueStore.getState().attempts).toEqual([])
    expect(useRepertoireStore.getState().pieces).toEqual([])

    applyProgressSnapshot(snapshot)

    expect(useProgressStore.getState().practiceEntries).toEqual([practiceEntry])
    expect(useFlashcardStore.getState().cardsById).toEqual({ [card.id]: card })
    expect(useSightReadingStore.getState().history).toEqual([sightReadingRecord])
    expect(useSightReadingStore.getState().level).toBe(4)
    expect(useTechniqueStore.getState().attempts).toEqual([techniqueAttempt])
  })

  it('restores a repertoire piece\'s recoverable fields (id, title, composer, status) — not sessions/level/bestAccuracy/notes', () => {
    seedStores()
    const snapshot = gatherProgressSnapshot(new FakeClock(0))

    resetStores()
    applyProgressSnapshot(snapshot)

    const restored = useRepertoireStore.getState().pieces
    expect(restored).toHaveLength(1)
    const [got] = restored as [RepertoirePiece]
    expect(got.id).toBe(repertoirePieceInput.id)
    expect(got.title).toBe(repertoirePieceInput.title)
    expect(got.composer).toBe(repertoirePieceInput.composer)
    expect(got.status).toBe('maintained')
    // NOT preserved by RepertoirePieceLike's structural minimum — documented
    // in the module comment. Fabricated at the curriculum minimum/blank,
    // never a value the piece never actually earned.
    expect(got.level).toBe(REPERTOIRE_MIN_LEVEL)
    expect(got.sessions).toEqual([])
    expect(got.bestAccuracy).toBe(0)
    expect(got.notes).toBe('')
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
