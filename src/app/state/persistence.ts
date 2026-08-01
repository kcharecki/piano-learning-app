/**
 * Session persistence over the `Store` port (roadmap 1.23, REQ-3.10.4/4.3).
 *
 * Nothing here touches IndexedDB directly — it reads and writes through the
 * `Store` port, so it is exercised in tests with an in-memory fake and the
 * real zustand score store, never a browser database.
 *
 * Two halves:
 *  - `restoreSession` runs once at startup: read the saved session, validate
 *    it defensively (a corrupt save must never crash the app), and apply it.
 *  - `startPersisting` subscribes to the score store and writes the session
 *    back on every change that matters (the loaded score, the practice
 *    settings) — never on MIDI-device state or import errors, which are not
 *    session state.
 */
import type { Hand, Score } from '@core/notation/score.ts'
import type { Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { MAX_TEMPO_SCALE, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import {
  useScoreStore,
  type PracticeSettings,
  type ScoreStoreState,
} from '@app/state/scoreStore.ts'

/** Collection + key the whole session lives under. */
export const SESSION_COLLECTION = COLLECTIONS.settings
export const SESSION_KEY = 'session'

export type PersistedSession = {
  readonly score: Score
  readonly sourceName: string
  readonly musicXml: string | undefined
  readonly settings: PracticeSettings
}

// --------------------------------------------------------------- validation

function isHand(value: unknown): value is Hand {
  return value === 'left' || value === 'right'
}

function isValidLoop(value: unknown): value is LoopRange | undefined {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null) return false
  const loop = value as Record<string, unknown>
  return (
    typeof loop.startTick === 'number' &&
    Number.isFinite(loop.startTick) &&
    loop.startTick >= 0 &&
    typeof loop.endTick === 'number' &&
    Number.isFinite(loop.endTick) &&
    loop.endTick > loop.startTick
  )
}

function isValidSettings(value: unknown): value is PracticeSettings {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.tempoScale === 'number' &&
    Number.isFinite(s.tempoScale) &&
    s.tempoScale >= MIN_TEMPO_SCALE &&
    s.tempoScale <= MAX_TEMPO_SCALE &&
    Array.isArray(s.activeHands) &&
    s.activeHands.every(isHand) &&
    typeof s.metronomeEnabled === 'boolean' &&
    isValidLoop(s.loop)
  )
}

/**
 * Structural validation only — deliberately not `validateScore`, which enforces
 * invariants a parser must guarantee (sort order, tie shape, and so on). Those
 * can only be violated by a programmer error in code that wrote the save, not
 * by a learner's browser storage getting corrupted, and re-deriving them here
 * would make a save written by an older, stricter version of the score model
 * unreadable. What DOES vary with storage corruption — wrong types, truncated
 * writes, a manually edited IndexedDB entry — is exactly what this checks.
 */
function isValidScore(value: unknown): value is Score {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  if (!Array.isArray(s.notes)) return false
  if (typeof s.meta !== 'object' || s.meta === null) return false
  if (typeof (s.meta as Record<string, unknown>).title !== 'string') return false
  if (!Array.isArray(s.measures)) return false
  if (!Array.isArray(s.tempos)) return false
  if (!Array.isArray(s.staves)) return false
  return Number.isFinite(s.maxNoteDurationTicks)
}

function isValidSession(value: unknown): value is PersistedSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isValidScore(v.score)) return false
  if (typeof v.sourceName !== 'string') return false
  if (v.musicXml !== undefined && typeof v.musicXml !== 'string') return false
  return isValidSettings(v.settings)
}

// ----------------------------------------------------------------- restore

/**
 * While `true`, `startPersisting`'s subscriber ignores store changes: the four
 * setters `restoreSession` calls below would otherwise each be seen as a fresh
 * "session changed, write it back" event and re-save the exact bytes just
 * read. Zustand's `set` notifies subscribers synchronously, so toggling this
 * around the synchronous block of setter calls is enough — nothing async ever
 * runs while it is `true`.
 */
let applyingRestoredSession = false

/**
 * Reads the saved session and applies it to the score store. Never throws and
 * never rejects: a store error or malformed/partial saved data resolves to
 * `false` and leaves the app on its defaults, because a learner who cannot
 * start the app has lost more than a learner who lost their settings.
 */
export async function restoreSession(store: Store): Promise<boolean> {
  let raw: unknown
  try {
    raw = await store.get<unknown>(SESSION_COLLECTION, SESSION_KEY)
  } catch {
    return false
  }
  if (!isValidSession(raw)) return false

  applyingRestoredSession = true
  try {
    const { loadScore, setTempoScale, setActiveHands, setMetronomeEnabled, setLoop } =
      useScoreStore.getState()
    loadScore({ score: raw.score, sourceName: raw.sourceName, musicXml: raw.musicXml })
    setTempoScale(raw.settings.tempoScale)
    setActiveHands(raw.settings.activeHands)
    setMetronomeEnabled(raw.settings.metronomeEnabled)
    setLoop(raw.settings.loop)
  } finally {
    applyingRestoredSession = false
  }
  return true
}

// --------------------------------------------------------------- persisting

function isSessionRelevantChange(state: ScoreStoreState, prev: ScoreStoreState): boolean {
  return state.loaded !== prev.loaded || state.settings !== prev.settings
}

function toSession(state: ScoreStoreState): PersistedSession | undefined {
  if (state.loaded === undefined) return undefined
  return {
    score: state.loaded.score,
    sourceName: state.loaded.sourceName,
    musicXml: state.loaded.musicXml,
    settings: state.settings,
  }
}

/**
 * Subscribes to the score store and writes the session on every change to the
 * loaded score or the practice settings. Returns an unsubscribe function.
 *
 * Writes are last-write-wins WITHOUT relying on the underlying store to keep
 * concurrent `put`s in completion order — a real store's write latency can
 * vary, so an earlier `put` can resolve after a later one. The fix is to never
 * let that race exist: at most one `put` to `SESSION_KEY` is ever in flight.
 * `seq` is bumped on every session-relevant change and stamped onto `pending`
 * alongside it, so `pending` always names both the newest session produced and
 * the sequence number it belongs to. A change that arrives mid-write replaces
 * `pending` — the session it superseded is dropped, never written — instead of
 * starting a second `put`. When the in-flight write settles, the drain loop
 * checks `pending.seq`: if it is still the one that write just sent (nothing
 * queued while it was in flight), draining stops; otherwise it is a genuinely
 * newer session and gets sent next. Either way the store only ever receives
 * writes in the order the sessions were produced, so a `put` that resolves
 * late is, by construction, the one that was started last — there is no
 * completion to drop, because there was never a newer one still in flight
 * behind it. A rejected `put` is swallowed here, never thrown into React.
 *
 * CALL ORDER IS MANDATORY: `await restoreSession(store)` must resolve before
 * `startPersisting(store)` is called. Subscribing first races the in-flight
 * `get` against any `loadScore` call that happens before restore lands (for
 * example a caller auto-loading a sample score) — IndexedDB serialises
 * transactions, so that write can commit first and the subsequent read then
 * returns the wrong session, silently discarding the saved one.
 */
export function startPersisting(store: Store): () => void {
  let pending: { readonly seq: number; readonly session: PersistedSession } | undefined
  let seq = 0
  let draining = false

  const drain = (): void => {
    if (draining) return
    draining = true
    void (async () => {
      while (pending !== undefined) {
        const { seq: sentSeq, session } = pending
        try {
          await store.put(SESSION_COLLECTION, SESSION_KEY, session)
        } catch {
          // Swallowed: a failed save must not crash the practice session.
        }
        // Stop only if nothing newer was queued while this write was in
        // flight; otherwise `pending` now names that newer session and the
        // loop sends it next. Re-read `pending` rather than relying on
        // pre-`await` narrowing: it can be cleared by other code between the
        // `await` starting and resolving.
        const current = pending
        if (current !== undefined && current.seq === sentSeq) pending = undefined
      }
      draining = false
    })()
  }

  const unsubscribe = useScoreStore.subscribe((state, prevState) => {
    if (applyingRestoredSession) return
    if (!isSessionRelevantChange(state, prevState)) return
    const session = toSession(state)
    if (session === undefined) return
    seq += 1
    pending = { seq, session }
    drain()
  })

  return unsubscribe
}
