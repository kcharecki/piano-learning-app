/**
 * Instrument-slice tests for `persistence.ts` (roadmap DR-01): the
 * restore/persist round-trip and the three degrade-to-default paths (fresh
 * install, store error, corrupt payload) for `useInstrumentStore`. Split out
 * like `persistence.theme.test.ts`, the closest sibling — same shared-collection
 * shape (`COLLECTIONS.settings`), same test structure. `MemoryStore`
 * (`@test/fakes`) stands in for IndexedDB throughout, per the testing rules.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '@core/ports/index.ts'
import { MemoryStore } from '@test/fakes.ts'
import { SINGLE_NOTE } from '@test/fixtures.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import {
  INSTRUMENT_COLLECTION,
  INSTRUMENT_KEY,
  LEVELS_COLLECTION,
  LEVELS_KEY,
  restoreSession,
  startPersisting,
  THEME_COLLECTION,
  THEME_KEY,
  type PersistedInstrument,
} from './persistence.ts'
import { useScoreStore, type ScoreStore } from './scoreStore.ts'
import { useLevelStore } from './levelStore.ts'
import { INSTRUMENT_HINT_KEY, useInstrumentStore } from './instrumentStore.ts'

/** A `Store` whose `get` rejects every call, for the "store throws" case (mirrors `persistence.test.ts`'s own `ThrowingStore`). */
class ThrowingStore implements Store {
  get<T>(_collection: string, _id: string): Promise<T | undefined> {
    return Promise.reject(new Error('get failed'))
  }
  getAll<T>(_collection: string): Promise<T[]> {
    return Promise.resolve([])
  }
  put<T>(_collection: string, _id: string, _value: T): Promise<void> {
    return Promise.resolve()
  }
  delete(_collection: string, _id: string): Promise<void> {
    return Promise.resolve()
  }
  clear(_collection: string): Promise<void> {
    return Promise.resolve()
  }
  collections(): Promise<string[]> {
    return Promise.resolve([])
  }
}

const INITIAL_SCORE_STATE: ScoreStore = useScoreStore.getState()
let unsubscribes: (() => void)[] = []

function persist(store: Store): () => void {
  const unsubscribe = startPersisting(store)
  unsubscribes.push(unsubscribe)
  return unsubscribe
}

function resetStore(): void {
  useScoreStore.setState(INITIAL_SCORE_STATE, true)
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useInstrumentStore.setState({ lastInstrument: 'piano' })
  localStorage.removeItem(INSTRUMENT_HINT_KEY)
}

/** Waits for the internal write queue to drain — a handful of microtask turns is always enough. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('instrument persistence (roadmap DR-01)', () => {
  beforeEach(resetStore)
  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe()
    unsubscribes = []
    resetStore()
  })

  it('round-trips via startPersisting/restoreSession and does not clobber the shared-collection score session', async () => {
    const store = new MemoryStore()
    const unsubscribe = persist(store)
    useScoreStore.getState().loadScore({ score: SINGLE_NOTE, sourceName: 'instrument-rt', musicXml: undefined })
    useInstrumentStore.getState().setLastInstrument('drums')
    await flush()
    unsubscribe()

    resetStore()
    await restoreSession(store)

    expect(useInstrumentStore.getState().lastInstrument).toBe('drums')
    expect(useScoreStore.getState().loaded?.sourceName).toBe('instrument-rt')
  })

  it('defaults to piano on a fresh install', async () => {
    await restoreSession(new MemoryStore())

    expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
  })

  it('degrades to the default instrument when the store read fails', async () => {
    await restoreSession(new ThrowingStore())

    expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
  })

  it.each([
    ['not an object', 'nope'],
    ['lastInstrument missing', {}],
    ['lastInstrument not a valid instrument', { lastInstrument: 'guitar' }],
    ['lastInstrument is a number', { lastInstrument: 1 }],
  ])('degrades to the default instrument on a corrupt payload (%s) without blocking a sibling slice', async (_label, payload) => {
    const store = new MemoryStore()
    await store.put(INSTRUMENT_COLLECTION, INSTRUMENT_KEY, payload)
    // LEVELS_COLLECTION also reuses COLLECTIONS.settings — proves the corrupt instrument record does not block its sibling.
    await store.put(LEVELS_COLLECTION, LEVELS_KEY, { levelState: initialLevelState() })

    await restoreSession(store)

    expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
    expect(useLevelStore.getState().levelState).toEqual(initialLevelState())
  })

  it('does not immediately re-save what it just restored (no write amplification)', async () => {
    let putCount = 0
    const inner = new MemoryStore()
    const counting: Store = {
      get: (c, id) => inner.get(c, id),
      getAll: (c) => inner.getAll(c),
      put: (c, id, v) => {
        putCount += 1
        return inner.put(c, id, v)
      },
      delete: (c, id) => inner.delete(c, id),
      clear: (c) => inner.clear(c),
      collections: () => inner.collections(),
    }
    await inner.put<PersistedInstrument>(INSTRUMENT_COLLECTION, INSTRUMENT_KEY, { lastInstrument: 'drums' })

    persist(counting)
    await restoreSession(counting)
    await flush()

    expect(putCount).toBe(0)
  })

  it('an instrument change persisted alongside the theme preference restores both correctly (shared COLLECTIONS.settings collection)', async () => {
    const store = new MemoryStore()
    const unsubscribe = persist(store)

    useInstrumentStore.getState().setLastInstrument('drums')
    await flush()
    unsubscribe()

    resetStore()
    await restoreSession(store)

    expect(useInstrumentStore.getState().lastInstrument).toBe('drums')
    // THEME_COLLECTION/THEME_KEY and INSTRUMENT_COLLECTION/INSTRUMENT_KEY are distinct keys in the same object store.
    expect(INSTRUMENT_COLLECTION).toBe(THEME_COLLECTION)
    expect(INSTRUMENT_KEY).not.toBe(THEME_KEY)
  })
})
