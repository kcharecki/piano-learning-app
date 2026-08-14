/**
 * Theme-slice tests for `persistence.ts` (roadmap UI-05): the restore/persist
 * round-trip, "system" clearing the attribute rather than hardcoding a
 * palette, and the three degrade-to-default paths (fresh install, store
 * error, corrupt payload). Split out of `persistence.test.ts` — that file
 * was already close to its 1400-line `max-lines` cap before this slice
 * existed — mirroring how `persistedShapes.test.ts` already holds
 * `isValidEarTraining`'s own focused suite rather than living in
 * `persistence.test.ts` too. `MemoryStore` (`@test/fakes`) stands in for
 * IndexedDB throughout, per the testing rules.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '@core/ports/index.ts'
import { MemoryStore } from '@test/fakes.ts'
import { SINGLE_NOTE } from '@test/fixtures.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import {
  LEVELS_COLLECTION,
  LEVELS_KEY,
  restoreSession,
  SESSION_COLLECTION,
  SESSION_KEY,
  startPersisting,
  THEME_COLLECTION,
  THEME_KEY,
  type PersistedTheme,
} from './persistence.ts'
import { useScoreStore, type ScoreStore } from './scoreStore.ts'
import { useLevelStore } from './levelStore.ts'
import { useThemeStore } from './themeStore.ts'

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
  useThemeStore.setState({ theme: 'system' })
  document.documentElement.removeAttribute('data-theme')
}

/** Waits for the internal write queue to drain — a handful of microtask turns is always enough. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('theme persistence (roadmap UI-05)', () => {
  beforeEach(resetStore)
  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe()
    unsubscribes = []
    resetStore()
  })

  it('round-trips via startPersisting/restoreSession, applies the attribute for light/dark, and does not clobber the shared-collection score session', async () => {
    const store = new MemoryStore()
    const unsubscribe = persist(store)
    useScoreStore.getState().loadScore({ score: SINGLE_NOTE, sourceName: 'theme-rt', musicXml: undefined })
    useThemeStore.getState().setTheme('light')
    await flush()
    unsubscribe()

    resetStore()
    await restoreSession(store)

    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(useScoreStore.getState().loaded?.sourceName).toBe('theme-rt')
  })

  it('restoring "system" removes the attribute rather than hardcoding a palette', async () => {
    const store = new MemoryStore()
    document.documentElement.setAttribute('data-theme', 'dark') // a prior Dark choice
    await store.put<PersistedTheme>(THEME_COLLECTION, THEME_KEY, { theme: 'system' })

    await restoreSession(store)

    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('defaults to system with no attribute on a fresh install', async () => {
    await restoreSession(new MemoryStore())

    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('degrades to the default theme when the store read fails', async () => {
    await restoreSession(new ThrowingStore())

    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it.each([
    ['not an object', 'nope'],
    ['theme missing', {}],
    ['theme not a valid preference value', { theme: 'blue' }],
    ['theme is a number', { theme: 1 }],
  ])('degrades to the default theme on a corrupt payload (%s) without blocking a sibling slice', async (_label, payload) => {
    const store = new MemoryStore()
    await store.put(THEME_COLLECTION, THEME_KEY, payload)
    // LEVELS_COLLECTION also reuses COLLECTIONS.settings — proves the corrupt theme record does not block its sibling.
    await store.put(LEVELS_COLLECTION, LEVELS_KEY, { levelState: initialLevelState() })

    await restoreSession(store)

    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
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
    await inner.put<PersistedTheme>(THEME_COLLECTION, THEME_KEY, { theme: 'dark' })

    persist(counting)
    await restoreSession(counting)
    await flush()

    expect(putCount).toBe(0)
  })

  it('a theme change persisted alongside the score session restores both correctly (shared COLLECTIONS.settings collection)', async () => {
    const store = new MemoryStore()
    const unsubscribe = persist(store)

    useScoreStore.getState().loadScore({ score: SINGLE_NOTE, sourceName: 'shared', musicXml: undefined })
    useThemeStore.getState().setTheme('dark')
    await flush()
    unsubscribe()

    resetStore()
    await restoreSession(store)

    expect(useScoreStore.getState().loaded?.sourceName).toBe('shared')
    expect(useThemeStore.getState().theme).toBe('dark')
    // SESSION_COLLECTION/SESSION_KEY and THEME_COLLECTION/THEME_KEY are distinct keys in the same object store.
    expect(THEME_COLLECTION).toBe(SESSION_COLLECTION)
    expect(THEME_KEY).not.toBe(SESSION_KEY)
  })
})
