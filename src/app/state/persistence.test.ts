import type { Store } from '@core/ports/index.ts'
import { C_MAJOR_SCALE_RH, SINGLE_NOTE } from '@test/fixtures.ts'
import { MemoryStore } from '@test/fakes.ts'
import { ticks } from '@core/shared/units.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FLASHCARDS_COLLECTION,
  FLASHCARDS_KEY,
  restoreSession,
  SESSION_COLLECTION,
  SESSION_KEY,
  SIGHT_READING_COLLECTION,
  SIGHT_READING_KEY,
  startPersisting,
  type PersistedFlashcards,
  type PersistedSession,
  type PersistedSightReadingHistory,
} from './persistence.ts'
import { useScoreStore, type ScoreStore } from './scoreStore.ts'
import { useSightReadingStore } from './sightReadingStore.ts'
import { useFlashcardStore } from './flashcardStore.ts'

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
})

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
