/**
 * One round-trip suite per persisted collection: write it through
 * `startPersisting`, read it back through `restoreSession`, and prove a
 * corrupt payload degrades to that slice's empty state without taking its
 * siblings down with it.
 *
 * Split out of `persistence.test.ts`, which keeps the engine itself — the
 * restore/subscribe/flush machinery and the failures that belong to no single
 * collection. The shared fixtures are in `persistenceHarness.ts`.
 */
import { SINGLE_NOTE } from '@test/fixtures.ts'
import { midi, millis, ticks } from '@core/shared/units.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { Recording } from '@core/practice/recorder.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { initialLevelState, type LevelState } from '@core/progress/levels.ts'
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarSessionState } from '@core/eartraining/session.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DRUMS_HISTORY_COLLECTION,
  DRUMS_HISTORY_KEY,
  EAR_TRAINING_COLLECTION,
  EAR_TRAINING_KEY,
  FLASHCARDS_COLLECTION,
  FLASHCARDS_KEY,
  LEVELS_COLLECTION,
  LEVELS_KEY,
  PRACTICE_LOG_COLLECTION,
  PRACTICE_LOG_KEY,
  PROGRESS_COLLECTION,
  PROGRESS_KEY,
  RECORDINGS_COLLECTION,
  RECORDINGS_KEY,
  REPERTOIRE_COLLECTION,
  REPERTOIRE_KEY,
  restoreSession,
  SESSION_COLLECTION,
  SESSION_KEY,
  SIGHT_READING_COLLECTION,
  SIGHT_READING_KEY,
  TECHNIQUE_COLLECTION,
  TECHNIQUE_KEY,
  type PersistedAssessments,
  type PersistedDrumsHistory,
  type PersistedEarTraining,
  type PersistedFlashcards,
  type PersistedLevelState,
  type PersistedPracticeLog,
  type PersistedRecordings,
  type PersistedRepertoire,
  type PersistedSightReadingHistory,
  type PersistedTechniqueHistory,
} from './persistence.ts'
import { useScoreStore } from './scoreStore.ts'
import { useSightReadingStore } from './sightReadingStore.ts'
import { useFlashcardStore } from './flashcardStore.ts'
import type { AssessmentResult } from '@core/practice/assessment.ts'
import { useProgressStore, type StoredAssessment } from './progressStore.ts'
import { useTechniqueStore } from './techniqueStore.ts'
import { useDrumsHistoryStore } from './drumsHistoryStore.ts'
import { useRepertoireStore, MAX_STORED_REPERTOIRE_PIECES } from './repertoireStore.ts'
import { useLevelStore } from './levelStore.ts'
import { useEarTrainingStore } from './earTrainingStore.ts'
import {
  CountingStore,
  flush,
  persist,
  resetStore,
  teardownPersisters,
  ThrowingStore,
} from './persistenceHarness.ts'
import { MemoryStore } from '@test/fakes.ts'


describe('persistence: saved collections', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    teardownPersisters()
  })

  describe('sight-reading history persistence (roadmap 1.24, REQ-3.4.3/3.4.6)', () => {
    const RECORD_A: SightReadingRecord = { pieceId: 'a', readAt: 100, accuracy: 0.9, level: 1 }
    const RECORD_B: SightReadingRecord = { pieceId: 'b', readAt: 200, accuracy: 0.5, level: 2 }

    it('round-trips level and history via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useSightReadingStore.getState().setLevel(3)
      useSightReadingStore.getState().addRecord(RECORD_A)
      useSightReadingStore.getState().addRecord(RECORD_B)
      await flush()
      unsubscribe()

      resetStore()
      expect(useSightReadingStore.getState().level).toBe(MIN_LEVEL)
      expect(useSightReadingStore.getState().history).toEqual([])

      const restored = await restoreSession(store)
      expect(restored).toBe(false) // no score session was ever saved in this test
      expect(useSightReadingStore.getState().level).toBe(3)
      expect(useSightReadingStore.getState().history).toEqual([RECORD_A, RECORD_B])
    })

    it.each([
      ['not an object', 'nope'],
      ['level missing', { history: [] }],
      ['level not finite', { level: Number.NaN, history: [] }],
      ['level below MIN_LEVEL', { level: 0, history: [] }],
      ['history not an array', { level: 1, history: 'nope' }],
      [
        'history has a malformed record',
        { level: 1, history: [{ pieceId: 'a', readAt: 100, accuracy: 0.9 }] },
      ],
    ])('degrades to the default level/history on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(SIGHT_READING_COLLECTION, SIGHT_READING_KEY, payload)

      await restoreSession(store)

      expect(useSightReadingStore.getState().level).toBe(MIN_LEVEL)
      expect(useSightReadingStore.getState().history).toEqual([])
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedSightReadingHistory = { level: 2, history: [RECORD_A] }
      await store.put(SIGHT_READING_COLLECTION, SIGHT_READING_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('flashcard SRS persistence (roadmap 1.24, REQ-3.9.4)', () => {
    const CARD_A: Card = {
      id: 'staff-to-key-60',
      due: 100,
      intervalDays: 1,
      ease: 2.5,
      reps: 1,
      lapses: 0,
      introducedAt: 0,
    }

    it('round-trips cardsById via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useFlashcardStore.getState().upsertCard(CARD_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useFlashcardStore.getState().cardsById).toEqual({})

      await restoreSession(store)
      expect(useFlashcardStore.getState().cardsById).toEqual({ [CARD_A.id]: CARD_A })
    })

    it.each([
      ['not an object', 'nope'],
      ['cardsById missing', {}],
      ['cardsById not an object', { cardsById: 'nope' }],
      ['a card missing a required field', { cardsById: { x: { id: 'x', due: 1 } } }],
      [
        'a card with a non-finite field',
        { cardsById: { x: { ...CARD_A, ease: Number.NaN } } },
      ],
    ])('degrades to an empty cardsById on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(FLASHCARDS_COLLECTION, FLASHCARDS_KEY, payload)

      await restoreSession(store)

      expect(useFlashcardStore.getState().cardsById).toEqual({})
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedFlashcards = { cardsById: { [CARD_A.id]: CARD_A } }
      await store.put(FLASHCARDS_COLLECTION, FLASHCARDS_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('assessment results persistence (roadmap 2.24, REQ-3.3.4)', () => {
    const ASSESSMENT_A: StoredAssessment = storedAssessment('assess-1')

    it('round-trips assessments via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useProgressStore.getState().addAssessment(ASSESSMENT_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useProgressStore.getState().assessments).toEqual([])

      await restoreSession(store)
      expect(useProgressStore.getState().assessments).toEqual([ASSESSMENT_A])
    })

    it.each([
      ['not an object', 'nope'],
      ['assessments missing', {}],
      ['assessments not an array', { assessments: 'nope' }],
      [
        'an assessment missing a required field',
        { assessments: [{ id: 'x', scoreId: 'x', scoreTitle: 'x' }] },
      ],
      [
        "an assessment's result with a non-finite accuracy",
        {
          assessments: [
            { ...ASSESSMENT_A, result: { ...ASSESSMENT_A.result, accuracy: Number.NaN } },
          ],
        },
      ],
      [
        "an assessment's result with a malformed measure",
        {
          assessments: [
            {
              ...ASSESSMENT_A,
              result: { ...ASSESSMENT_A.result, measures: [{ measureIndex: 0 }] },
            },
          ],
        },
      ],
    ])('degrades to an empty assessments list on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(PROGRESS_COLLECTION, PROGRESS_KEY, payload)
      // A sibling collection with a VALID payload, to prove the corrupt
      // assessments collection does not prevent it from restoring — kills a
      // mutant that hardwires the validator to `false` or shares one guard
      // flag across all three collections.
      const recording: Recording = {
        id: 'sibling-rec',
        recordedAt: 1,
        durationMs: 10,
        events: [],
      }
      await store.put(RECORDINGS_COLLECTION, RECORDINGS_KEY, { recordings: [recording] })

      await restoreSession(store)

      expect(useProgressStore.getState().assessments).toEqual([])
      expect(useProgressStore.getState().recordings).toEqual([recording])
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedAssessments = { assessments: [ASSESSMENT_A] }
      await store.put(PROGRESS_COLLECTION, PROGRESS_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('recordings persistence (roadmap 2.24, REQ-3.9.2)', () => {
    const RECORDING_A: Recording = {
      id: 'rec-1',
      recordedAt: 1000,
      durationMs: 150,
      events: [
        { type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) },
        { type: 'noteOff', note: midi(60), time: millis(150) },
      ],
    }

    it('round-trips recordings via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useProgressStore.getState().addRecording(RECORDING_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useProgressStore.getState().recordings).toEqual([])

      await restoreSession(store)
      expect(useProgressStore.getState().recordings).toEqual([RECORDING_A])
    })

    it.each([
      ['not an object', 'nope'],
      ['recordings missing', {}],
      ['recordings not an array', { recordings: 'nope' }],
      [
        'a recording missing durationMs',
        { recordings: [{ id: 'x', recordedAt: 1, events: [] }] },
      ],
      [
        'a recording with an event of an unrecognised type',
        { recordings: [{ ...RECORDING_A, events: [{ type: 'pedal', time: 0 }] }] },
      ],
      [
        'a recording with a noteOn event missing velocity',
        {
          recordings: [
            { ...RECORDING_A, events: [{ type: 'noteOn', note: 60, time: 0 }] },
          ],
        },
      ],
    ])('degrades to an empty recordings list on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(RECORDINGS_COLLECTION, RECORDINGS_KEY, payload)
      // A sibling collection with a VALID payload, to prove the corrupt
      // recordings collection does not prevent it from restoring — see the
      // assessments suite's identical comment above.
      const entry: PracticeEntry = {
        id: 'sibling-pe',
        startedAt: 1,
        endedAt: 2,
        kind: 'technique',
        itemName: 'Sibling',
      }
      await store.put(PRACTICE_LOG_COLLECTION, PRACTICE_LOG_KEY, { practiceEntries: [entry] })

      await restoreSession(store)

      expect(useProgressStore.getState().recordings).toEqual([])
      expect(useProgressStore.getState().practiceEntries).toEqual([entry])
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedRecordings = { recordings: [RECORDING_A] }
      await store.put(RECORDINGS_COLLECTION, RECORDINGS_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('practice log persistence (roadmap 2.24, REQ-3.9.5)', () => {
    const ENTRY_A: PracticeEntry = {
      id: 'pe-1',
      startedAt: 1000,
      endedAt: 2000,
      kind: 'repertoire',
      itemName: 'Test Piece',
    }

    it('round-trips practiceEntries via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useProgressStore.getState().addPracticeEntry(ENTRY_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useProgressStore.getState().practiceEntries).toEqual([])

      await restoreSession(store)
      expect(useProgressStore.getState().practiceEntries).toEqual([ENTRY_A])
    })

    it.each([
      ['not an object', 'nope'],
      ['practiceEntries missing', {}],
      ['practiceEntries not an array', { practiceEntries: 'nope' }],
      [
        'an entry with an invalid kind',
        { practiceEntries: [{ ...ENTRY_A, kind: 'not-a-kind' }] },
      ],
      ['an entry missing itemName', { practiceEntries: [{ ...ENTRY_A, itemName: undefined }] }],
      [
        'an entry with a non-finite endedAt',
        { practiceEntries: [{ ...ENTRY_A, endedAt: Number.NaN }] },
      ],
    ])(
      'degrades to an empty practiceEntries list on a corrupt payload: %s',
      async (_label, payload) => {
        const store = new MemoryStore()
        await store.put(PRACTICE_LOG_COLLECTION, PRACTICE_LOG_KEY, payload)
        // A sibling collection with a VALID payload, to prove the corrupt
        // practiceEntries collection does not prevent it from restoring —
        // see the assessments suite's identical comment above.
        const assessment = storedAssessment('sibling-assess')
        await store.put(PROGRESS_COLLECTION, PROGRESS_KEY, { assessments: [assessment] })

        await restoreSession(store)

        expect(useProgressStore.getState().practiceEntries).toEqual([])
        expect(useProgressStore.getState().assessments).toEqual([assessment])
      },
    )

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedPracticeLog = { practiceEntries: [ENTRY_A] }
      await store.put(PRACTICE_LOG_COLLECTION, PRACTICE_LOG_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('technique drill history persistence (roadmap 4.4b, REQ-3.7.2/3.7.3)', () => {
    const ATTEMPT_A: TechniqueAttempt = {
      drillId: 'scale-c-major-2oct-hands-together',
      at: 1000,
      bpm: 84,
      evenness: 0.9,
      accuracy: 1,
      clean: true,
    }

    it('round-trips attempts via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useTechniqueStore.getState().addAttempt(ATTEMPT_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useTechniqueStore.getState().attempts).toEqual([])

      await restoreSession(store)
      expect(useTechniqueStore.getState().attempts).toEqual([ATTEMPT_A])
    })

    it.each([
      ['not an object', 'nope'],
      ['attempts missing', {}],
      ['attempts not an array', { attempts: 'nope' }],
      [
        'an attempt missing a required field',
        { attempts: [{ drillId: 'x', at: 1, bpm: 80, evenness: 1 }] },
      ],
      ['an attempt with a non-finite bpm', { attempts: [{ ...ATTEMPT_A, bpm: Number.NaN }] }],
      ['an attempt with a non-boolean clean', { attempts: [{ ...ATTEMPT_A, clean: 'yes' }] }],
    ])('degrades to an empty attempts list on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(TECHNIQUE_COLLECTION, TECHNIQUE_KEY, payload)
      // A sibling collection with a VALID payload, to prove the corrupt
      // technique collection does not prevent it from restoring — see the
      // assessments suite's identical comment above.
      const entry: PracticeEntry = {
        id: 'sibling-pe-2',
        startedAt: 1,
        endedAt: 2,
        kind: 'technique',
        itemName: 'Sibling',
      }
      await store.put(PRACTICE_LOG_COLLECTION, PRACTICE_LOG_KEY, { practiceEntries: [entry] })

      await restoreSession(store)

      expect(useTechniqueStore.getState().attempts).toEqual([])
      expect(useProgressStore.getState().practiceEntries).toEqual([entry])
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedTechniqueHistory = { attempts: [ATTEMPT_A] }
      await store.put(TECHNIQUE_COLLECTION, TECHNIQUE_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('groove trainer history persistence (roadmap DR-09)', () => {
    const ATTEMPT_A: DrumsGrooveAttempt = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bpm: 80,
      repeats: 4,
      at: 1000,
      clean: true,
      pads: [],
    }

    it('round-trips attempts via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useDrumsHistoryStore.getState().addAttempt(ATTEMPT_A)
      await flush()
      unsubscribe()

      useDrumsHistoryStore.setState({ attempts: [] })
      expect(useDrumsHistoryStore.getState().attempts).toEqual([])

      await restoreSession(store)
      expect(useDrumsHistoryStore.getState().attempts).toEqual([ATTEMPT_A])
    })

    it.each([
      ['not an object', 'nope'],
      ['attempts missing', {}],
      ['attempts not an array', { attempts: 'nope' }],
      [
        'an attempt missing a required field',
        { attempts: [{ grooveId: 'x', grooveTitle: 'X', bpm: 80, repeats: 4, at: 1, pads: [] }] },
      ],
      ['an attempt with a non-finite bpm', { attempts: [{ ...ATTEMPT_A, bpm: Number.NaN }] }],
      ['an attempt with a non-boolean clean', { attempts: [{ ...ATTEMPT_A, clean: 'yes' }] }],
    ])('degrades to an empty attempts list on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(DRUMS_HISTORY_COLLECTION, DRUMS_HISTORY_KEY, payload)
      // A sibling collection with a VALID payload, to prove the corrupt
      // drums-history collection does not prevent it from restoring — see
      // the technique suite's identical comment above.
      const entry: PracticeEntry = {
        id: 'sibling-pe-drums',
        startedAt: 1,
        endedAt: 2,
        kind: 'technique',
        itemName: 'Sibling',
      }
      await store.put(PRACTICE_LOG_COLLECTION, PRACTICE_LOG_KEY, { practiceEntries: [entry] })

      await restoreSession(store)

      expect(useDrumsHistoryStore.getState().attempts).toEqual([])
      expect(useProgressStore.getState().practiceEntries).toEqual([entry])
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedDrumsHistory = { attempts: [ATTEMPT_A] }
      await store.put(DRUMS_HISTORY_COLLECTION, DRUMS_HISTORY_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('repertoire library persistence (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4)', () => {
    const PIECE_A: RepertoirePiece = {
      id: 'piece-1',
      title: 'Minuet in G',
      composer: 'Petzold',
      level: 2,
      status: 'learning',
      sessions: [],
      bestAccuracy: 0,
      notes: '',
    }

    it('round-trips a repertoire library via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useRepertoireStore.getState().addPiece(PIECE_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useRepertoireStore.getState().pieces).toEqual([])

      await restoreSession(store)
      expect(useRepertoireStore.getState().pieces).toEqual([PIECE_A])
    })

    it.each([
      ['not an object', 'nope'],
      ['pieces missing', {}],
      ['pieces not an array', { pieces: 'nope' }],
      [
        'a piece with a status that is not a valid RepertoireStatus',
        { pieces: [{ ...PIECE_A, status: 'abandoned' }] },
      ],
      [
        'a piece missing a required field',
        { pieces: [{ id: 'x', title: 'X', level: 1 }] },
      ],
    ])('degrades to an empty repertoire list on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(REPERTOIRE_COLLECTION, REPERTOIRE_KEY, payload)
      // A sibling collection with a VALID payload, to prove the corrupt
      // repertoire collection does not prevent it from restoring — see the
      // technique suite's identical comment above.
      const entry: PracticeEntry = {
        id: 'sibling-pe-3',
        startedAt: 1,
        endedAt: 2,
        kind: 'technique',
        itemName: 'Sibling',
      }
      await store.put(PRACTICE_LOG_COLLECTION, PRACTICE_LOG_KEY, { practiceEntries: [entry] })

      await restoreSession(store)

      expect(useRepertoireStore.getState().pieces).toEqual([])
      expect(useProgressStore.getState().practiceEntries).toEqual([entry])
    })

    it('truncates a stored library longer than MAX_STORED_REPERTOIRE_PIECES on restore', async () => {
      const store = new MemoryStore()
      const oversized: readonly RepertoirePiece[] = Array.from(
        { length: MAX_STORED_REPERTOIRE_PIECES + 5 },
        (_, i) => ({ ...PIECE_A, id: `piece-${i}` }),
      )
      await store.put(REPERTOIRE_COLLECTION, REPERTOIRE_KEY, { pieces: oversized })

      await restoreSession(store)

      expect(useRepertoireStore.getState().pieces).toHaveLength(MAX_STORED_REPERTOIRE_PIECES)
      expect(useRepertoireStore.getState().pieces).toEqual(
        oversized.slice(0, MAX_STORED_REPERTOIRE_PIECES),
      )
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedRepertoire = { pieces: [PIECE_A] }
      await store.put(REPERTOIRE_COLLECTION, REPERTOIRE_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('level state persistence (roadmap 2.36, REQ-2.1-2.3)', () => {
    const OVERRIDDEN_STATE: LevelState = {
      levels: { playing: 3, 'sight-reading': 1, theory: 2 },
      overridden: { playing: true, 'sight-reading': false, theory: false },
    }

    it('round-trips levelState via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useLevelStore.getState().setTrackLevel('playing', 3)
      useLevelStore.getState().setTrackLevel('theory', 2)
      await flush()
      unsubscribe()

      resetStore()
      expect(useLevelStore.getState().levelState).toEqual(initialLevelState())

      const restored = await restoreSession(store)
      expect(restored).toBe(false) // no score session was ever saved in this test
      expect(useLevelStore.getState().levelState).toEqual({
        levels: { playing: 3, 'sight-reading': 1, theory: 2 },
        overridden: { playing: true, 'sight-reading': false, theory: true },
      })
      // The stored-state path: a record was found and applied, and the
      // restore attempt is still marked complete (see the "nothing stored"
      // and "store throws" cases below for the other two paths that must
      // reach the same `true`).
      expect(useLevelStore.getState().hydrated).toBe(true)
    })

    it('marks the level slice hydrated even when nothing was ever stored (fresh install)', async () => {
      const store = new MemoryStore()
      expect(useLevelStore.getState().hydrated).toBe(false)

      await restoreSession(store)

      expect(useLevelStore.getState().levelState).toEqual(initialLevelState())
      expect(useLevelStore.getState().hydrated).toBe(true)
    })

    it('marks the level slice hydrated even when the store read fails', async () => {
      const store = new ThrowingStore(true)
      expect(useLevelStore.getState().hydrated).toBe(false)

      await restoreSession(store)

      expect(useLevelStore.getState().levelState).toEqual(initialLevelState())
      expect(useLevelStore.getState().hydrated).toBe(true)
    })

    it.each([
      ['not an object', 'nope'],
      ['levelState missing', {}],
      ['levelState not an object', { levelState: 'nope' }],
      [
        'levels missing a track',
        { levelState: { levels: { playing: 1, theory: 1 }, overridden: OVERRIDDEN_STATE.overridden } },
      ],
      [
        'levels has a non-integer level',
        {
          levelState: {
            levels: { ...OVERRIDDEN_STATE.levels, playing: 1.5 },
            overridden: OVERRIDDEN_STATE.overridden,
          },
        },
      ],
      [
        'levels has a level below MIN_LEVEL',
        {
          levelState: {
            levels: { ...OVERRIDDEN_STATE.levels, playing: 0 },
            overridden: OVERRIDDEN_STATE.overridden,
          },
        },
      ],
      [
        'levels has a level above MAX_LEVEL',
        {
          levelState: {
            levels: { ...OVERRIDDEN_STATE.levels, playing: 6 },
            overridden: OVERRIDDEN_STATE.overridden,
          },
        },
      ],
      [
        'overridden missing a track',
        { levelState: { levels: OVERRIDDEN_STATE.levels, overridden: { playing: true, theory: false } } },
      ],
      [
        'overridden has a non-boolean value',
        {
          levelState: {
            levels: OVERRIDDEN_STATE.levels,
            overridden: { ...OVERRIDDEN_STATE.overridden, playing: 'yes' },
          },
        },
      ],
      [
        'levels has an extra, unknown track key',
        {
          levelState: {
            levels: { ...OVERRIDDEN_STATE.levels, extra: 1 },
            overridden: OVERRIDDEN_STATE.overridden,
          },
        },
      ],
    ])('degrades to the initial level state on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(LEVELS_COLLECTION, LEVELS_KEY, payload)
      // A sibling collection with a VALID payload, to prove the corrupt level
      // state does not prevent it from restoring — see the assessments
      // suite's identical comment above. LEVELS_COLLECTION reuses
      // COLLECTIONS.settings, so the sibling here is the score session, which
      // shares that same collection under a different key.
      await store.put(SESSION_COLLECTION, SESSION_KEY, {
        score: {
          id: 'x',
          meta: { title: 'x', composer: 'x' },
          measures: [],
          notes: [],
          tempos: [],
          staves: [],
          maxNoteDurationTicks: 0,
        },
        sourceName: 'x',
        musicXml: undefined,
        settings: {
          tempoScale: 1,
          activeHands: ['left', 'right'],
          metronomeEnabled: false,
          loop: undefined,
        },
      })

      await restoreSession(store)

      expect(useLevelStore.getState().levelState).toEqual(initialLevelState())
      expect(useScoreStore.getState().loaded?.sourceName).toBe('x')
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedLevelState = { levelState: OVERRIDDEN_STATE }
      await store.put(LEVELS_COLLECTION, LEVELS_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })

    it('a level change does not clobber the score session sharing the same collection', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useScoreStore.getState().loadScore({
        score: SINGLE_NOTE,
        sourceName: 'shared-collection-score',
        musicXml: undefined,
      })
      useLevelStore.getState().setTrackLevel('playing', 3)
      await flush()
      unsubscribe()

      resetStore()
      await restoreSession(store)

      expect(useScoreStore.getState().loaded?.sourceName).toBe('shared-collection-score')
      expect(useLevelStore.getState().levelState.levels.playing).toBe(3)
    })
  })

  // The theme slice's own restore/persist/corrupt-payload tests live in the
  // sibling `persistence.theme.test.ts` file, not here — this file was
  // already close to the 1400-line `max-lines` cap (eslint), so a new slice's
  // full test suite gets its own co-located file rather than pushing this
  // one over, mirroring `persistedShapes.test.ts`'s split for `isValidEarTraining`.

  describe('ear-training persistence (roadmap 3.11, REQ-3.6.3)', () => {
    const CARD_A: Card = {
      id: 'interval-melodic:48:55:asc',
      due: 100,
      intervalDays: 1,
      ease: 2.5,
      reps: 1,
      lapses: 0,
      introducedAt: 0,
    }

    const ITEM_A: EarItem = {
      id: 'interval-melodic:48:55:asc',
      kind: 'interval-melodic',
      prompt: {
        id: 'interval-melodic:48:55:asc',
        meta: { title: '', composer: '' },
        measures: [],
        notes: [],
        tempos: [],
        staves: [],
        maxNoteDurationTicks: ticks(0),
      },
      answerKey: 'P5',
      level: 3,
    }

    /**
     * This is the test that fails without a `hydrate` action wired into
     * `persistence.ts`: a raised per-kind level, an SRS card and a cached
     * item all have to survive a reset -> restore round trip, or the
     * "adaptive" difficulty in REQ-3.6.3 is adaptive for exactly one page
     * life.
     */
    it('round-trips a raised level, an SRS card and a cached item via startPersisting / restoreSession', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      const attempt = { itemId: ITEM_A.id, kind: ITEM_A.kind, accuracy: 1, at: 100, level: 2 }
      const raisedSession: EarSessionState = {
        ...emptyEarSession(),
        levels: { ...emptyEarSession().levels, 'interval-melodic': 3 },
        attempts: [attempt],
        cards: [CARD_A],
        kinds: { [ITEM_A.id]: ITEM_A.kind },
      }
      useEarTrainingStore.getState().setSession(raisedSession)
      useEarTrainingStore.getState().rememberItem(ITEM_A)
      await flush()
      unsubscribe()

      resetStore()
      expect(useEarTrainingStore.getState().session).toEqual(emptyEarSession())
      expect(useEarTrainingStore.getState().itemsById).toEqual({})

      const restored = await restoreSession(store)
      expect(restored).toBe(false) // no score session was ever saved in this test
      expect(useEarTrainingStore.getState().session.levels['interval-melodic']).toBe(3)
      expect(useEarTrainingStore.getState().session.cards).toEqual([CARD_A])
      expect(useEarTrainingStore.getState().session.attempts).toEqual([attempt])
      expect(useEarTrainingStore.getState().itemsById).toEqual({ [ITEM_A.id]: ITEM_A })
    })

    it.each([
      ['not an object', 'nope'],
      ['session missing', { itemsById: {} }],
      ['itemsById missing', { session: emptyEarSession() }],
      [
        'session.levels missing a kind',
        { session: { ...emptyEarSession(), levels: { 'interval-melodic': 1 } }, itemsById: {} },
      ],
      [
        'session.cards has a malformed card',
        {
          session: { ...emptyEarSession(), cards: [{ ...CARD_A, ease: Number.NaN }] },
          itemsById: {},
        },
      ],
      [
        'itemsById has an item missing prompt',
        { session: emptyEarSession(), itemsById: { a: { ...ITEM_A, prompt: undefined } } },
      ],
    ])('degrades to an empty ear-training session on a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(EAR_TRAINING_COLLECTION, EAR_TRAINING_KEY, payload)

      await restoreSession(store)

      expect(useEarTrainingStore.getState().session).toEqual(emptyEarSession())
      expect(useEarTrainingStore.getState().itemsById).toEqual({})
    })

    it('does not immediately re-save what it just restored (guard flag holds, no write amplification)', async () => {
      const store = new CountingStore()
      const saved: PersistedEarTraining = {
        session: { ...emptyEarSession(), cards: [CARD_A], kinds: { [ITEM_A.id]: ITEM_A.kind } },
        itemsById: { [ITEM_A.id]: ITEM_A },
      }
      await store.put(EAR_TRAINING_COLLECTION, EAR_TRAINING_KEY, saved)
      store.putCount = 0

      persist(store)
      await restoreSession(store)
      await flush()

      expect(store.putCount).toBe(0)
    })

    it(
      'an ear-training change does not clobber the level state sharing the same collection',
      async () => {
        const store = new MemoryStore()
        const unsubscribe = persist(store)

        useLevelStore.getState().setTrackLevel('playing', 3)
        useEarTrainingStore.getState().rememberItem(ITEM_A)
        await flush()
        unsubscribe()

        resetStore()
        await restoreSession(store)

        expect(useLevelStore.getState().levelState.levels.playing).toBe(3)
        expect(useEarTrainingStore.getState().itemsById).toEqual({ [ITEM_A.id]: ITEM_A })
      },
    )
  })
})

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

function storedAssessment(id: string): StoredAssessment {
  return {
    id,
    scoreId: 'score-a',
    scoreTitle: 'Test Score',
    at: 1000,
    result: assessmentResult(),
  }
}
