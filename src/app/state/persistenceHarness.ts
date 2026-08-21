/**
 * The shared harness behind the two persistence suites: `persistence.test.ts`
 * (the engine — restore, subscribe, degrade, flush) and
 * `persistence.collections.test.ts` (one round-trip suite per saved
 * collection).
 *
 * It lives in its own module because both halves need the same three things
 * and a copy in each would drift: every zustand store reset to factory state
 * between tests (they are module singletons, so a value left behind by one
 * test is a false pass in the next), a `startPersisting` subscription that is
 * always torn down, and a set of `Store` doubles that throw, stall or count
 * on demand. Only fixtures live here — every assertion stays in a `*.test.ts`.
 */
import type { Store } from '@core/ports/index.ts'
import { MemoryStore } from '@test/fakes.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { startPersisting } from './persistence.ts'
import { useScoreStore, type ScoreStore } from './scoreStore.ts'
import { useSightReadingStore } from './sightReadingStore.ts'
import { useFlashcardStore } from './flashcardStore.ts'
import { useProgressStore } from './progressStore.ts'
import { useTechniqueStore } from './techniqueStore.ts'
import { useRepertoireStore } from './repertoireStore.ts'
import { useLevelStore } from './levelStore.ts'
import { useEarTrainingStore } from './earTrainingStore.ts'
import { useThemeStore } from './themeStore.ts'

/** `useScoreStore`'s factory state, captured before any test touched it. */
export const INITIAL_STATE: ScoreStore = useScoreStore.getState()

let unsubscribes: (() => void)[] = []

/**
 * Tracks a subscription so it is torn down in `afterEach` even on assertion
 * failure — `useScoreStore` is module-global, so a leaked subscriber from one
 * test keeps firing (and writing) during every later test. Zustand's
 * unsubscribe is idempotent, so tests that also want to unsubscribe early
 * (to assert writes stop) may still call the returned function themselves.
 */
export function persist(store: Store): () => void {
  const unsubscribe = startPersisting(store)
  unsubscribes.push(unsubscribe)
  return unsubscribe
}

export function resetStore(): void {
  useScoreStore.setState(INITIAL_STATE, true)
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useTechniqueStore.setState({ attempts: [] })
  useRepertoireStore.setState({ pieces: [] })
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
  useThemeStore.setState({ theme: 'system' })
  document.documentElement.removeAttribute('data-theme')
}

/** Waits for the internal write queue to drain: a handful of microtask turns is always enough. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A `Store` whose `get`/`put` reject every call, for the "store throws" cases. */
export class ThrowingStore implements Store {
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
export class DeferredStore implements Store {
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
export class CountingStore implements Store {
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

/** Drops every subscription `persist` handed out — call it from `afterEach`. */
export function teardownPersisters(): void {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes = []
}
