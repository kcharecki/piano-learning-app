import type { Store } from '@core/ports/index.ts'
import { C_MAJOR_SCALE_RH, SINGLE_NOTE } from '@test/fixtures.ts'
import { MemoryStore } from '@test/fakes.ts'
import { ticks } from '@core/shared/units.ts'
import type { Card } from '@core/srs/scheduler.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FLASHCARDS_COLLECTION,
  FLASHCARDS_KEY,
  LEVELS_COLLECTION,
  LEVELS_KEY,
  restoreSession,
  SESSION_COLLECTION,
  SESSION_KEY,
  type PersistedLevelState,
  type PersistedSession,
} from './persistence.ts'
import { useScoreStore } from './scoreStore.ts'
import { useFlashcardStore } from './flashcardStore.ts'
import { useLevelStore } from './levelStore.ts'
import {
  CountingStore,
  DeferredStore,
  INITIAL_STATE,
  flush,
  persist,
  resetStore,
  teardownPersisters,
  ThrowingStore,
} from './persistenceHarness.ts'

describe('persistence', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    teardownPersisters()
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

  describe('page-hide flush (roadmap follow-up F.2)', () => {
    /** A `Store` whose `put` promises are settled one at a time, by index, either resolved or rejected. */
    class ControllableStore implements Store {
      private readonly inner = new MemoryStore()
      readonly puts: { collection: string; id: string; value: unknown }[] = []
      private readonly resolvers: ((fail: boolean) => void)[] = []

      get<T>(collection: string, id: string): Promise<T | undefined> { return this.inner.get<T>(collection, id) }
      getAll<T>(collection: string): Promise<T[]> { return this.inner.getAll<T>(collection) }
      put<T>(collection: string, id: string, value: T): Promise<void> {
        this.puts.push({ collection, id, value })
        return new Promise((resolve, reject) => {
          this.resolvers.push((fail) => {
            if (fail) { reject(new Error('put failed')); return }
            this.inner.put(collection, id, value).then(resolve).catch(reject)
          })
        })
      }
      delete(collection: string, id: string): Promise<void> { return this.inner.delete(collection, id) }
      clear(collection: string): Promise<void> { return this.inner.clear(collection) }
      collections(): Promise<string[]> { return this.inner.collections() }
      /** Settle the `index`-th `put` call — resolved unless `fail` is `true`. */
      settle(index: number, fail = false): void {
        const resolver = this.resolvers[index]
        if (resolver === undefined) throw new Error(`no put #${index} yet`)
        resolver(fail)
      }
    }

    function setVisibility(state: 'visible' | 'hidden'): void {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    }

    /** Loads a score (issued synchronously as the queue's own in-flight put) and, optionally, a second change. */
    function load(tempoScale?: number): void {
      useScoreStore.getState().loadScore({ score: SINGLE_NOTE, sourceName: 'single.musicxml', musicXml: undefined })
      if (tempoScale !== undefined) useScoreStore.getState().setTempoScale(tempoScale)
    }

    afterEach(() => {
      setVisibility('visible')
    })

    it('pagehide with nothing ever written is a no-op — no put is issued', async () => {
      const store = new CountingStore()
      persist(store)

      window.dispatchEvent(new Event('pagehide'))
      await flush()

      expect(store.putCount).toBe(0)
    })

    it('pagehide with a write already in flight and nothing newer behind it does not issue a duplicate put', async () => {
      const store = new DeferredStore()
      persist(store)

      load()
      // The write above is already synchronously in flight (see the module
      // comment: `store.put`'s underlying request is issued before it ever
      // suspends), so there is nothing NEW for flush to send.
      expect(store.puts).toHaveLength(1)

      window.dispatchEvent(new Event('pagehide'))
      expect(store.puts).toHaveLength(1)

      store.resolvePut(0)
      await flush()
      expect(store.puts).toHaveLength(1)
    })

    it(
      'pagehide flushes a value stuck in `pending` behind an in-flight write — the exact loss this closes ' +
        '(roadmap M4 acceptance Finding 2: an advancement made and then immediately reloaded away)',
      async () => {
        const store = new DeferredStore()
        persist(store)

        // The first write (inside `load`) is now in flight, unresolved. The
        // second change lands in `pending` without a second `put` — the write
        // queue's own defence against write amplification — which is exactly
        // "queued but never sent" if nothing drains it before the page
        // disappears.
        load(0.4)
        expect(store.puts).toHaveLength(1)

        window.dispatchEvent(new Event('pagehide'))
        // Flushed synchronously — no `await` needed to observe the second put.
        expect(store.puts).toHaveLength(2)
        expect((store.puts[1]?.value as PersistedSession).settings.tempoScale).toBe(0.4)

        // The original in-flight write settling afterwards must NOT resend —
        // `flush` already cleared `pending` the instant it sent it.
        store.resolvePut(0)
        await flush()
        expect(store.puts).toHaveLength(2)

        store.resolvePut(1)
        await flush()
        const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
        expect(saved?.settings.tempoScale).toBe(0.4)
      },
    )

    it('visibilitychange only flushes on the transition to hidden, and pagehide right after does not double-write', async () => {
      const store = new DeferredStore()
      persist(store)
      load(0.6)
      expect(store.puts).toHaveLength(1)

      setVisibility('visible') // the default, asserted explicitly for clarity
      document.dispatchEvent(new Event('visibilitychange'))
      expect(store.puts).toHaveLength(1) // still visible: no flush

      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(store.puts).toHaveLength(2)
      expect((store.puts[1]?.value as PersistedSession).settings.tempoScale).toBe(0.6)

      // A `pagehide` for the SAME hide finds `pending` already cleared.
      window.dispatchEvent(new Event('pagehide'))
      expect(store.puts).toHaveLength(2)
    })

    it('a repeated hide/show/hide cycle flushes each new value exactly once, never leaking a duplicate put', async () => {
      const store = new DeferredStore()
      persist(store)

      load(0.2)
      expect(store.puts).toHaveLength(1)
      window.dispatchEvent(new Event('pagehide'))
      expect(store.puts).toHaveLength(2)
      store.resolvePut(0)
      store.resolvePut(1)
      await flush()

      // "Show" again: an ordinary new change (queue is idle, so issued
      // synchronously as usual), then hidden again.
      useScoreStore.getState().setTempoScale(0.9)
      expect(store.puts).toHaveLength(3)
      window.dispatchEvent(new Event('pagehide'))
      // Nothing queued behind THIS write — flush must not duplicate it.
      expect(store.puts).toHaveLength(3)

      store.resolvePut(2)
      await flush()
      const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
      expect(saved?.settings.tempoScale).toBe(0.9)
    })

    it('a flush-issued put that rejects is swallowed and does not wedge the queue for later writes', async () => {
      const store = new ControllableStore()
      persist(store)

      load(0.7) // second change queued behind the in-flight first put
      expect(store.puts).toHaveLength(1)

      expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
      expect(store.puts).toHaveLength(2)

      store.settle(1, true) // flush's own put rejects
      await flush()
      store.settle(0, false) // the original in-flight put finally resolves too
      await flush()

      // The queue recovered: a later change is still written normally.
      useScoreStore.getState().setTempoScale(0.35)
      expect(store.puts).toHaveLength(3)
      store.settle(2, false)
      await flush()
      const saved = await store.get<PersistedSession>(SESSION_COLLECTION, SESSION_KEY)
      expect(saved?.settings.tempoScale).toBe(0.35)
    })

    it('unsubscribe removes both listeners: a pagehide after unsubscribe writes nothing further', async () => {
      const store = new DeferredStore()
      const unsubscribe = persist(store)

      load(0.5) // stuck in pending
      expect(store.puts).toHaveLength(1)

      unsubscribe()
      window.dispatchEvent(new Event('pagehide'))
      expect(store.puts).toHaveLength(1) // no flush after unsubscribe
    })

    it('pagehide flushes every one of the eleven slices independently, not just one', async () => {
      const store = new DeferredStore()
      persist(store)

      load(0.4) // score slice: second change queued behind its in-flight put
      useLevelStore.getState().setTrackLevel('theory', 3) // level slice: issued synchronously (its queue was idle)
      useLevelStore.getState().setTrackLevel('playing', 2) // level slice: queued behind ITS in-flight put
      expect(store.puts).toHaveLength(2) // one in-flight put per independent queue

      window.dispatchEvent(new Event('pagehide'))

      expect(store.puts).toHaveLength(4) // both queues flushed their own pending value
      const scoreFlushed = store.puts[2]?.value as PersistedSession
      const levelFlushed = store.puts[3]?.value as PersistedLevelState
      expect(scoreFlushed.settings.tempoScale).toBe(0.4)
      expect(levelFlushed.levelState.levels.theory).toBe(3)
      expect(levelFlushed.levelState.levels.playing).toBe(2)
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
