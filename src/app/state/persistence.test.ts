import type { Store } from '@core/ports/index.ts'
import { C_MAJOR_SCALE_RH, SINGLE_NOTE } from '@test/fixtures.ts'
import { MemoryStore } from '@test/fakes.ts'
import { midi, millis, ticks } from '@core/shared/units.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { AssessmentResult } from '@core/practice/assessment.ts'
import type { Recording } from '@core/practice/recorder.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { initialLevelState, type LevelState } from '@core/progress/levels.ts'
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarSessionState } from '@core/eartraining/session.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
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
  startPersisting,
  TECHNIQUE_COLLECTION,
  TECHNIQUE_KEY,
  type PersistedAssessments,
  type PersistedEarTraining,
  type PersistedFlashcards,
  type PersistedLevelState,
  type PersistedPracticeLog,
  type PersistedRecordings,
  type PersistedRepertoire,
  type PersistedSession,
  type PersistedSightReadingHistory,
  type PersistedTechniqueHistory,
} from './persistence.ts'
import { useScoreStore, type ScoreStore } from './scoreStore.ts'
import { useSightReadingStore } from './sightReadingStore.ts'
import { useFlashcardStore } from './flashcardStore.ts'
import { useProgressStore, type StoredAssessment } from './progressStore.ts'
import { useTechniqueStore } from './techniqueStore.ts'
import { useRepertoireStore, MAX_STORED_REPERTOIRE_PIECES } from './repertoireStore.ts'
import { useLevelStore } from './levelStore.ts'
import { useEarTrainingStore } from './earTrainingStore.ts'

const INITIAL_STATE: ScoreStore = useScoreStore.getState()

let unsubscribes: (() => void)[] = []

/**
 * Tracks a subscription so it is torn down in `afterEach` even on assertion
 * failure — `useScoreStore` is module-global, so a leaked subscriber from one
 * test keeps firing (and writing) during every later test. Zustand's
 * unsubscribe is idempotent, so tests that also want to unsubscribe early
 * (to assert writes stop) may still call the returned function themselves.
 */
function persist(store: Store): () => void {
  const unsubscribe = startPersisting(store)
  unsubscribes.push(unsubscribe)
  return unsubscribe
}

function resetStore(): void {
  useScoreStore.setState(INITIAL_STATE, true)
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useTechniqueStore.setState({ attempts: [] })
  useRepertoireStore.setState({ pieces: [] })
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
}

/** Waits for the internal write queue to drain: a handful of microtask turns is always enough. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A `Store` whose `get`/`put` reject every call, for the "store throws" cases. */
class ThrowingStore implements Store {
  private readonly failGet: boolean
  private readonly failPut: boolean

  // Explicit fields, not constructor parameter properties: `erasableSyntaxOnly`
  // is on, so parameter properties are a compile error here.
  constructor(failGet = false, failPut = false) {
    this.failGet = failGet
    this.failPut = failPut
  }

  get<T>(): Promise<T | undefined> {
    if (this.failGet) return Promise.reject(new Error('get failed'))
    return Promise.resolve(undefined)
  }

  getAll<T>(): Promise<T[]> {
    return Promise.resolve([])
  }

  put<T>(_collection: string, _id: string, _value: T): Promise<void> {
    if (this.failPut) return Promise.reject(new Error('put failed'))
    return Promise.resolve()
  }

  delete(): Promise<void> {
    return Promise.resolve()
  }

  clear(): Promise<void> {
    return Promise.resolve()
  }

  collections(): Promise<string[]> {
    return Promise.resolve([])
  }
}

/**
 * A `Store` whose `put` only resolves when the test tells it to, so a test can
 * observe exactly how many writes were issued and in what order they landed.
 */
class DeferredStore implements Store {
  private readonly data = new Map<string, Map<string, unknown>>()
  readonly puts: { collection: string; id: string; value: unknown }[] = []
  private readonly resolvers: (() => void)[] = []

  private collection(name: string): Map<string, unknown> {
    let c = this.data.get(name)
    if (!c) {
      c = new Map()
      this.data.set(name, c)
    }
    return c
  }

  get<T>(collection: string, id: string): Promise<T | undefined> {
    return Promise.resolve(this.collection(collection).get(id) as T | undefined)
  }

  getAll<T>(collection: string): Promise<T[]> {
    return Promise.resolve([...this.collection(collection).values()] as T[])
  }

  put<T>(collection: string, id: string, value: T): Promise<void> {
    this.puts.push({ collection, id, value })
    return new Promise((resolve) => {
      this.resolvers.push(() => {
        this.collection(collection).set(id, value)
        resolve()
      })
    })
  }

  delete(): Promise<void> {
    return Promise.resolve()
  }

  clear(): Promise<void> {
    return Promise.resolve()
  }

  collections(): Promise<string[]> {
    return Promise.resolve([...this.data.keys()])
  }

  /** Resolve the `index`-th `put` call, in whatever order the test chooses. */
  resolvePut(index: number): void {
    const resolver = this.resolvers[index]
    if (resolver === undefined) throw new Error(`no put #${index} yet`)
    resolver()
  }
}

/** Wraps `MemoryStore` and counts `put` calls, for the write-amplification check. */
class CountingStore implements Store {
  private readonly inner = new MemoryStore()
  putCount = 0

  get<T>(collection: string, id: string): Promise<T | undefined> {
    return this.inner.get<T>(collection, id)
  }

  getAll<T>(collection: string): Promise<T[]> {
    return this.inner.getAll<T>(collection)
  }

  put<T>(collection: string, id: string, value: T): Promise<void> {
    this.putCount += 1
    return this.inner.put(collection, id, value)
  }

  delete(collection: string, id: string): Promise<void> {
    return this.inner.delete(collection, id)
  }

  clear(collection: string): Promise<void> {
    return this.inner.clear(collection)
  }

  collections(): Promise<string[]> {
    return this.inner.collections()
  }
}

describe('persistence', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe()
    unsubscribes = []
  })

  describe('restoreSession', () => {
    it('returns false and changes nothing when there is no saved session', async () => {
      const store = new MemoryStore()
      const restored = await restoreSession(store)
      expect(restored).toBe(false)
      expect(useScoreStore.getState().loaded).toBeUndefined()
      expect(useScoreStore.getState().settings).toEqual(INITIAL_STATE.settings)
    })

    it('round-trips the score and all four settings via startPersisting', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useScoreStore.getState().loadScore({
        score: C_MAJOR_SCALE_RH,
        sourceName: 'scale.musicxml',
        musicXml: '<score-partwise/>',
      })
      useScoreStore.getState().setTempoScale(0.5)
      useScoreStore.getState().setActiveHands(['left'])
      useScoreStore.getState().setMetronomeEnabled(true)
      useScoreStore.getState().setLoop({ startTick: ticks(0), endTick: ticks(960) })
      await flush()
      unsubscribe()

      resetStore()
      expect(useScoreStore.getState().loaded).toBeUndefined()

      const restored = await restoreSession(store)
      expect(restored).toBe(true)
      const state = useScoreStore.getState()
      expect(state.loaded).toEqual({
        score: C_MAJOR_SCALE_RH,
        sourceName: 'scale.musicxml',
        musicXml: '<score-partwise/>',
      })
      expect(state.settings).toEqual({
        tempoScale: 0.5,
        activeHands: ['left'],
        metronomeEnabled: true,
        loop: { startTick: 0, endTick: 960 },
      })
    })

    it('never throws and leaves the store on defaults when the store rejects on get', async () => {
      const store = new ThrowingStore(true, false)
      const restored = await restoreSession(store)
      expect(restored).toBe(false)
      expect(useScoreStore.getState().loaded).toBeUndefined()
      expect(useScoreStore.getState().settings).toEqual(INITIAL_STATE.settings)
    })

    it.each([
      [
        'score is not an object',
        { score: 'nope', sourceName: 'x', musicXml: undefined, settings: validSettings() },
      ],
      [
        'score has no notes array',
        { score: { id: 'x' }, sourceName: 'x', musicXml: undefined, settings: validSettings() },
      ],
      [
        'score has no meta.title',
        {
          score: { ...minimalScore(), meta: { composer: 'x' } },
          sourceName: 'x',
          musicXml: undefined,
          settings: validSettings(),
        },
      ],
      [
        'score has no measures array',
        {
          score: { ...minimalScore(), measures: undefined },
          sourceName: 'x',
          musicXml: undefined,
          settings: validSettings(),
        },
      ],
      [
        'tempoScale is not finite',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), tempoScale: Number.NaN },
        },
      ],
      [
        'tempoScale is out of range',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), tempoScale: 99 },
        },
      ],
      [
        'activeHands has an invalid entry',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), activeHands: ['left', 'both'] },
        },
      ],
      [
        'activeHands is not an array',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), activeHands: 'left' },
        },
      ],
      [
        'metronomeEnabled is not a boolean',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), metronomeEnabled: 'yes' },
        },
      ],
      [
        'loop is not an object',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), loop: 'on' },
        },
      ],
      [
        'loop has a negative startTick',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), loop: { startTick: -1, endTick: 10 } },
        },
      ],
      [
        'loop endTick does not exceed startTick',
        {
          score: minimalScore(),
          sourceName: 'x',
          musicXml: undefined,
          settings: { ...validSettings(), loop: { startTick: 5, endTick: 5 } },
        },
      ],
      [
        'sourceName is not a string',
        { score: minimalScore(), sourceName: 42, musicXml: undefined, settings: validSettings() },
      ],
      [
        'musicXml is not a string',
        { score: minimalScore(), sourceName: 'x', musicXml: 7, settings: validSettings() },
      ],
      ['settings missing entirely', { score: minimalScore(), sourceName: 'x', musicXml: undefined }],
    ])('rejects a corrupt payload: %s', async (_label, payload) => {
      const store = new MemoryStore()
      await store.put(SESSION_COLLECTION, SESSION_KEY, payload)
      const restored = await restoreSession(store)
      expect(restored).toBe(false)
      expect(useScoreStore.getState().loaded).toBeUndefined()
      expect(useScoreStore.getState().settings).toEqual(INITIAL_STATE.settings)
    })

    it('does not immediately re-save what it just restored (no write amplification)', async () => {
      const store = new CountingStore()
      const session: PersistedSession = {
        score: SINGLE_NOTE,
        sourceName: 'single.musicxml',
        musicXml: undefined,
        settings: {
          tempoScale: 0.8,
          activeHands: ['left', 'right'],
          metronomeEnabled: false,
          loop: undefined,
        },
      }
      await store.put(SESSION_COLLECTION, SESSION_KEY, session)
      store.putCount = 0 // only writes made from here on are the ones under test

      persist(store)
      const restored = await restoreSession(store)
      expect(restored).toBe(true)
      await flush()

      expect(store.putCount).toBe(0)
    })
  })

  describe('startPersisting', () => {
    it('writes the session on a session-relevant change', async () => {
      const store = new MemoryStore()
      persist(store)

      useScoreStore.getState().loadScore({
        score: SINGLE_NOTE,
        sourceName: 'single.musicxml',
        musicXml: undefined,
      })
      await flush()

      const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
      expect(saved?.score).toEqual(SINGLE_NOTE)
      expect(saved?.sourceName).toBe('single.musicxml')
    })

    it('ignores MIDI-device changes and import errors (no write amplification)', async () => {
      const store = new CountingStore()
      persist(store)

      useScoreStore.getState().loadScore({
        score: SINGLE_NOTE,
        sourceName: 'single.musicxml',
        musicXml: undefined,
      })
      await flush()
      expect(store.putCount).toBe(1)

      useScoreStore.getState().setAvailableMidiDevices([{ id: 'x', name: 'X', manufacturer: 'X' }])
      useScoreStore.getState().selectMidiDevice('x')
      useScoreStore.getState().setImportError('bad file')
      useScoreStore.getState().clearImportError()
      await flush()

      expect(store.putCount).toBe(1)
    })

    it('does nothing before a score is loaded', async () => {
      const store = new MemoryStore()
      persist(store)

      useScoreStore.getState().setTempoScale(0.5)
      await flush()

      expect(await store.get(SESSION_COLLECTION, SESSION_KEY)).toBeUndefined()
    })

    it('recovers after a rejected write instead of wedging the queue', async () => {
      let failNext = true
      class FlakyStore implements Store {
        private readonly inner = new MemoryStore()
        get<T>(collection: string, id: string): Promise<T | undefined> {
          return this.inner.get<T>(collection, id)
        }
        getAll<T>(collection: string): Promise<T[]> {
          return this.inner.getAll<T>(collection)
        }
        put<T>(collection: string, id: string, value: T): Promise<void> {
          if (failNext) {
            failNext = false
            return Promise.reject(new Error('put failed'))
          }
          return this.inner.put(collection, id, value)
        }
        delete(collection: string, id: string): Promise<void> {
          return this.inner.delete(collection, id)
        }
        clear(collection: string): Promise<void> {
          return this.inner.clear(collection)
        }
        collections(): Promise<string[]> {
          return this.inner.collections()
        }
      }
      const store = new FlakyStore()
      persist(store)

      expect(() => {
        useScoreStore.getState().loadScore({
          score: SINGLE_NOTE,
          sourceName: 'single.musicxml',
          musicXml: undefined,
        })
      }).not.toThrow()
      await flush()
      expect(await store.get(SESSION_COLLECTION, SESSION_KEY)).toBeUndefined()

      // The queue must have recovered from the rejection: a later change
      // still gets written.
      useScoreStore.getState().setTempoScale(0.7)
      await flush()
      const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
      expect(saved?.settings.tempoScale).toBe(0.7)
    })

    it(
      'drops a stale write: a change made while a write is in flight replaces it, ' +
        'so the store only ever ends up holding the newest session',
      async () => {
        const store = new DeferredStore()
        persist(store)

        useScoreStore.getState().loadScore({
          score: SINGLE_NOTE,
          sourceName: 'single.musicxml',
          musicXml: undefined,
        })
        // The first write is now in flight (unresolved) — change the session
        // again before releasing it, exactly the race the queue exists for.
        useScoreStore.getState().setTempoScale(0.4)
        useScoreStore.getState().setTempoScale(0.6)
        expect(store.puts).toHaveLength(1)

        store.resolvePut(0)
        await flush()
        // The coalesced second write — carrying the final tempoScale — should
        // have been issued once the first settled, and only once.
        expect(store.puts).toHaveLength(2)
        const second = store.puts[1]?.value as PersistedSession
        expect(second.settings.tempoScale).toBe(0.6)

        store.resolvePut(1)
        await flush()
        const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
        expect(saved?.settings.tempoScale).toBe(0.6)
        // Never landed: the earlier, superseded tempoScale value.
        expect(saved?.settings.tempoScale).not.toBe(0.4)
      },
    )

    it('unsubscribe stops further writes', async () => {
      const store = new MemoryStore()
      const unsubscribe = persist(store)

      useScoreStore.getState().loadScore({
        score: SINGLE_NOTE,
        sourceName: 'single.musicxml',
        musicXml: undefined,
      })
      await flush()
      unsubscribe()

      useScoreStore.getState().setTempoScale(0.3)
      await flush()

      const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
      expect(saved?.settings.tempoScale).toBe(1) // default, unchanged since unsubscribe
    })
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
        kind: 'warmup',
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
        kind: 'warmup',
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
        kind: 'warmup',
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

  describe('restoreSlice: a throwing isValid degrades exactly like a throwing store', () => {
    const SIBLING_CARD: Card = {
      id: 'sibling-card',
      due: 1,
      intervalDays: 1,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      introducedAt: 0,
    }

    /**
     * `get`'s value for `LEVELS_KEY` carries a `levels` object whose every
     * property is a getter that throws — `isValidLevels` (called from
     * `isValidLevelState`) reads `v[track]` for each track, so validating this
     * payload throws instead of returning `false`. Before `restoreSlice` moved
     * `isValid(raw)` inside its own `try` (roadmap review finding 7), that
     * throw was uncaught and rejected `restoreSession`'s whole promise — which
     * `App.tsx`'s `.catch(() => {})` swallows, silently disabling every one of
     * the eleven persisted slices, not just the level state. `FLASHCARDS_KEY`
     * carries an ordinary, valid, sibling payload so this test can prove that
     * did NOT happen.
     */
    class HostileValidatorStore implements Store {
      get<T>(collection: string, id: string): Promise<T | undefined> {
        if (collection === LEVELS_COLLECTION && id === LEVELS_KEY) {
          const evilLevels: Record<string, unknown> = {}
          for (const track of ['playing', 'sight-reading', 'theory']) {
            Object.defineProperty(evilLevels, track, {
              enumerable: true,
              get(): number {
                throw new Error('boom: a hostile getter, not a real value')
              },
            })
          }
          return Promise.resolve({
            levelState: {
              levels: evilLevels,
              overridden: { playing: false, 'sight-reading': false, theory: false },
            },
          } as T)
        }
        if (collection === FLASHCARDS_COLLECTION && id === FLASHCARDS_KEY) {
          return Promise.resolve({ cardsById: { [SIBLING_CARD.id]: SIBLING_CARD } } as T)
        }
        return Promise.resolve(undefined)
      }
      getAll<T>(): Promise<T[]> {
        return Promise.resolve([])
      }
      put<T>(_collection: string, _id: string, _value: T): Promise<void> {
        return Promise.resolve()
      }
      delete(): Promise<void> {
        return Promise.resolve()
      }
      clear(): Promise<void> {
        return Promise.resolve()
      }
      collections(): Promise<string[]> {
        return Promise.resolve([])
      }
    }

    it('does not reject restoreSession, degrades only the throwing slice, and leaves sibling slices to restore normally', async () => {
      const store = new HostileValidatorStore()

      await expect(restoreSession(store)).resolves.toBe(false)

      expect(useLevelStore.getState().levelState).toEqual(initialLevelState())
      expect(useFlashcardStore.getState().cardsById).toEqual({ [SIBLING_CARD.id]: SIBLING_CARD })
    })
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

function validSettings(): PersistedSession['settings'] {
  return {
    tempoScale: 1,
    activeHands: ['left', 'right'],
    metronomeEnabled: false,
    loop: undefined,
  }
}

/** The smallest object that passes `isValidScore` — everything a consumer dereferences. */
function minimalScore(): PersistedSession['score'] {
  return {
    id: 'x',
    meta: { title: 'x', composer: 'x' },
    measures: [],
    notes: [],
    tempos: [],
    staves: [],
    maxNoteDurationTicks: ticks(0),
  }
}
