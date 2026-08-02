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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FLASHCARDS_COLLECTION,
  FLASHCARDS_KEY,
  PRACTICE_LOG_COLLECTION,
  PRACTICE_LOG_KEY,
  PROGRESS_COLLECTION,
  PROGRESS_KEY,
  RECORDINGS_COLLECTION,
  RECORDINGS_KEY,
  restoreSession,
  SESSION_COLLECTION,
  SESSION_KEY,
  SIGHT_READING_COLLECTION,
  SIGHT_READING_KEY,
  startPersisting,
  TECHNIQUE_COLLECTION,
  TECHNIQUE_KEY,
  type PersistedAssessments,
  type PersistedFlashcards,
  type PersistedPracticeLog,
  type PersistedRecordings,
  type PersistedSession,
  type PersistedSightReadingHistory,
  type PersistedTechniqueHistory,
} from './persistence.ts'
import { useScoreStore, type ScoreStore } from './scoreStore.ts'
import { useSightReadingStore } from './sightReadingStore.ts'
import { useFlashcardStore } from './flashcardStore.ts'
import { useProgressStore, type StoredAssessment } from './progressStore.ts'
import { useTechniqueStore } from './techniqueStore.ts'

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
