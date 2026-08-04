/**
 * Session persistence over the `Store` port (roadmap 1.23/1.24/2.24,
 * REQ-3.10.4/4.3, REQ-3.4.3/3.4.6, REQ-3.9.4, REQ-3.3.4/3.9.2/3.9.5).
 *
 * Nothing here touches IndexedDB directly — it reads and writes through the
 * `Store` port, so it is exercised in tests with an in-memory fake and the
 * real zustand stores, never a browser database.
 *
 * Eleven independent slices are persisted, each following the same shape
 * (validate → `restoreSlice` on the way in, `createWriteQueue` +  a
 * `subscribe` on the way out):
 *  - the score session (`useScoreStore`) — the original roadmap-1.23 slice.
 *  - the sight-reading level + retirement history (`useSightReadingStore`).
 *    Without this, REQ-3.4.3's "once read, retired forever" resets on every
 *    reload (the pool refills), and REQ-3.4.6's level adaptation can never
 *    accumulate past whatever a single page life manages.
 *  - the SRS flashcard state (`useFlashcardStore`, REQ-3.9.4). Without this
 *    every card, ease factor and due date is lost on reload.
 *  - the score annotations (`useAnnotationStore`, roadmap 4.8, REQ-3.2.6) —
 *    every score's highlights/notes, keyed by score id.
 *  - stored assessment results, MIDI recordings and the practice log
 *    (`useProgressStore`, roadmap 2.24, REQ-3.3.4/3.9.2/3.9.5) — three
 *    further collections on the SAME store, each restored and persisted
 *    independently via `hydrate`'s partial-state contract (see that store's
 *    module comment), because each has its own validation and can fail
 *    without disturbing the other two.
 *  - the technique drill tempo history (`useTechniqueStore`, roadmap 4.4b,
 *    REQ-3.7.2/3.7.3). Without this, REQ-3.7.3's per-drill clean-tempo
 *    history — "currently clean at ♩=88" — resets to nothing on every reload.
 *  - the repertoire library (`useRepertoireStore`, roadmap 2.33,
 *    REQ-3.8.2/3.8.3/3.8.4). `COLLECTIONS.repertoire` was declared but written
 *    by nothing — without this slice a learner's curated piece list, statuses
 *    and practice history would die on every page reload.
 *  - the per-track level state (`useLevelStore`, roadmap 2.36, REQ-2.1–2.3).
 *    Reuses `COLLECTIONS.settings` under its own key rather than a new
 *    collection (no IndexedDB migration for this slice). Without this, a
 *    manual override (REQ-2.3) or any advancement (REQ-2.2) resets to level 1
 *    on every reload.
 *  - the ear-training session (`useEarTrainingStore`, roadmap 3.11,
 *    REQ-3.6.3): the shared `EarSessionState` (per-kind levels, SRS cards,
 *    id -> kind map, attempt log) plus the generated-item cache `itemsById`.
 *    Without this, REQ-3.6.3's adapted difficulty — a learner strong on
 *    intervals but weak on dictation — resets to level 1 on every reload,
 *    exactly like the sight-reading slice above but per drill kind instead of
 *    per track.
 *
 * Each slice's write queue is fully independent — its own (collection, key)
 * pair, its own in-flight `put` — so a slow write to one can never block or
 * reorder a write to another. Note that the score session and the level
 * state share `COLLECTIONS.settings` and are separated by key alone, so
 * those two keys must never converge. `startPersisting` just wires up all
 * ten and returns one combined unsubscribe.
 *
 * CALL ORDER IS MANDATORY, for every slice: `await restoreSession(store)`
 * must resolve before `startPersisting(store)` is called. Subscribing first
 * races each slice's in-flight `get` against any early write that happens
 * before restore lands (for example a caller auto-loading a sample score) —
 * IndexedDB serialises transactions, so that write can commit first and the
 * subsequent read then returns the wrong (or no) saved value, silently
 * discarding it.
 */
import type { Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { useScoreStore, type ScoreStoreState } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useAnnotationStore } from '@app/state/annotationStore.ts'
import {
  useProgressStore,
  MAX_STORED_ASSESSMENTS,
  MAX_STORED_RECORDINGS,
  MAX_STORED_PRACTICE_ENTRIES,
} from '@app/state/progressStore.ts'
import { useRepertoireStore, MAX_STORED_REPERTOIRE_PIECES } from '@app/state/repertoireStore.ts'
import { useTechniqueStore, MAX_STORED_TECHNIQUE_ATTEMPTS } from '@app/state/techniqueStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import {
  isValidAnnotations,
  isValidAssessments,
  isValidEarTraining,
  isValidFlashcards,
  isValidLevelState,
  isValidPracticeLog,
  isValidRecordings,
  isValidRepertoire,
  isValidSession,
  isValidSightReadingHistory,
  isValidTechniqueHistory,
  type PersistedAnnotations,
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
} from '@app/state/persistedShapes.ts'

// The persisted shapes moved to `persistedShapes.ts` (this file outgrew the
// 500-line limit); re-exported here so every existing importer — and every
// test — keeps its single, obvious import site for "what persistence deals in".
export type {
  PersistedAnnotations,
  PersistedAssessments,
  PersistedEarTraining,
  PersistedFlashcards,
  PersistedLevelState,
  PersistedPracticeLog,
  PersistedRecordings,
  PersistedRepertoire,
  PersistedSession,
  PersistedSightReadingHistory,
  PersistedTechniqueHistory,
} from '@app/state/persistedShapes.ts'

/** Collection + key the score session lives under. */
export const SESSION_COLLECTION = COLLECTIONS.settings
export const SESSION_KEY = 'session'

/** Collection + key the sight-reading level + retirement history live under. */
export const SIGHT_READING_COLLECTION = COLLECTIONS.sightReadingHistory
export const SIGHT_READING_KEY = 'sightReadingHistory'

/** Collection + key the SRS flashcard state lives under. */
export const FLASHCARDS_COLLECTION = COLLECTIONS.srsCards
export const FLASHCARDS_KEY = 'srsCards'

export const ANNOTATIONS_COLLECTION = COLLECTIONS.annotations
export const ANNOTATIONS_KEY = 'annotations'

/** Collection + key the stored assessment results live under (roadmap 2.24, REQ-3.3.4). */
export const PROGRESS_COLLECTION = COLLECTIONS.progress
export const PROGRESS_KEY = 'assessments'

/** Collection + key the stored recordings live under (roadmap 2.24, REQ-3.9.2). */
export const RECORDINGS_COLLECTION = COLLECTIONS.recordings
export const RECORDINGS_KEY = 'recordings'

/** Collection + key the practice log lives under (roadmap 2.24, REQ-3.9.5). */
export const PRACTICE_LOG_COLLECTION = COLLECTIONS.practiceLog
export const PRACTICE_LOG_KEY = 'practiceLog'

/** Collection + key the technique drill tempo history lives under (roadmap 4.4b, REQ-3.7.2/3.7.3). */
export const TECHNIQUE_COLLECTION = COLLECTIONS.techniqueHistory
export const TECHNIQUE_KEY = 'techniqueHistory'

/** Collection + key the repertoire library lives under (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4). */
export const REPERTOIRE_COLLECTION = COLLECTIONS.repertoire
export const REPERTOIRE_KEY = 'repertoire'

/**
 * Collection + key the per-track level state lives under (roadmap 2.36,
 * REQ-2.1–2.3). Reuses `COLLECTIONS.settings` under a distinct key rather than
 * declaring a new collection — see the module comment.
 */
export const LEVELS_COLLECTION = COLLECTIONS.settings
export const LEVELS_KEY = 'levelState'

/**
 * Collection + key the ear-training session (per-kind levels, SRS cards, id ->
 * kind map, attempt log, item cache) lives under (roadmap 3.11, REQ-3.6.3).
 * Reuses `COLLECTIONS.settings` under its own key — same reasoning as
 * `LEVELS_COLLECTION` above: no IndexedDB migration for this slice.
 */
export const EAR_TRAINING_COLLECTION = COLLECTIONS.settings
export const EAR_TRAINING_KEY = 'earTraining'

// ----------------------------------------------------------------- restore

/**
 * While one of these is `true`, the matching `persistXxx` subscriber below
 * ignores store changes: `restoreSlice` applying a restored value would
 * otherwise be seen as a fresh "changed, write it back" event and re-save the
 * exact bytes just read. One flag per slice, not a single shared flag,
 * because the eleven restores are independent of each other. Zustand's `set`
 * notifies subscribers synchronously, so toggling a flag around the
 * synchronous `apply()` call below is enough — nothing async ever runs while
 * it is `true`.
 */
let applyingRestoredScoreSession = false
let applyingRestoredSightReadingHistory = false
let applyingRestoredFlashcards = false
let applyingRestoredAnnotations = false
let applyingRestoredAssessments = false
let applyingRestoredRecordings = false
let applyingRestoredPracticeLog = false
let applyingRestoredTechniqueHistory = false
let applyingRestoredRepertoire = false
let applyingRestoredLevels = false
let applyingRestoredEarTraining = false

/**
 * Reads `key` from `collection`, validates it, and — only if valid — applies
 * it with `setGuard` held `true` for the (synchronous) duration of `apply`.
 * Never throws: a store error, a `isValid` that itself throws, or an invalid
 * payload all resolve to `false` and leave the caller's state on its
 * defaults, because a learner who cannot start the app has lost more than a
 * learner who lost their saved state. The `get` and `isValid` call share one
 * `try` deliberately — a throwing validator must degrade exactly like a
 * throwing store, not escape uncaught and abort every OTHER slice's restore
 * behind it (see `restoreSession`'s "each independent" contract).
 */
async function restoreSlice<T>(
  store: Store,
  collection: string,
  key: string,
  isValid: (value: unknown) => value is T,
  setGuard: (guarding: boolean) => void,
  apply: (value: T) => void,
): Promise<boolean> {
  let raw: T
  try {
    const value = await store.get<unknown>(collection, key)
    if (!isValid(value)) return false
    raw = value
  } catch {
    return false
  }
  setGuard(true)
  try {
    apply(raw)
  } finally {
    setGuard(false)
  }
  return true
}

/**
 * Restores all eleven persisted slices (see the module comment for the full
 * list). Each is validated and applied independently, so a corrupt or
 * missing slice never prevents the others from restoring. Returns whether
 * the SCORE session specifically was restored, the original roadmap-1.23
 * contract this app's callers and tests rely on.
 */
export async function restoreSession(store: Store): Promise<boolean> {
  const scoreRestored = await restoreSlice(
    store,
    SESSION_COLLECTION,
    SESSION_KEY,
    isValidSession,
    (guarding) => {
      applyingRestoredScoreSession = guarding
    },
    (session) => {
      const { loadScore, setTempoScale, setActiveHands, setMetronomeEnabled, setLoop } =
        useScoreStore.getState()
      loadScore({
        score: session.score,
        sourceName: session.sourceName,
        musicXml: session.musicXml,
      })
      // ORDER MATTERS since roadmap 2.29 made the tempo scale per-loop: the
      // restored `tempoScale` belongs to the restored LOOP, and `setTempoScale`
      // writes to whichever home is currently in effect. Setting the loop
      // second would file the restored tempo under "no loop" and then read the
      // loop's own (absent, therefore default) scale back out — a session saved
      // at 50% inside a loop came back at 100%. Only the active scale is
      // persisted, not the whole per-loop map, so this is the one moment that
      // association can be re-established.
      setLoop(session.settings.loop)
      setTempoScale(session.settings.tempoScale)
      setActiveHands(session.settings.activeHands)
      setMetronomeEnabled(session.settings.metronomeEnabled)
    },
  )

  await restoreSlice(
    store,
    SIGHT_READING_COLLECTION,
    SIGHT_READING_KEY,
    isValidSightReadingHistory,
    (guarding) => {
      applyingRestoredSightReadingHistory = guarding
    },
    (data) => useSightReadingStore.getState().hydrate(data.level, data.history),
  )

  await restoreSlice(
    store,
    FLASHCARDS_COLLECTION,
    FLASHCARDS_KEY,
    isValidFlashcards,
    (guarding) => {
      applyingRestoredFlashcards = guarding
    },
    (data) => useFlashcardStore.getState().hydrate(data.cardsById),
  )

  await restoreSlice(
    store,
    ANNOTATIONS_COLLECTION,
    ANNOTATIONS_KEY,
    isValidAnnotations,
    (guarding) => {
      applyingRestoredAnnotations = guarding
    },
    (data) => useAnnotationStore.getState().hydrate(data.byScoreId),
  )

  await restoreSlice(
    store,
    PROGRESS_COLLECTION,
    PROGRESS_KEY,
    isValidAssessments,
    (guarding) => {
      applyingRestoredAssessments = guarding
    },
    (data) => useProgressStore.getState().hydrate({ assessments: data.assessments.slice(0, MAX_STORED_ASSESSMENTS) }),
  )

  await restoreSlice(
    store,
    RECORDINGS_COLLECTION,
    RECORDINGS_KEY,
    isValidRecordings,
    (guarding) => {
      applyingRestoredRecordings = guarding
    },
    (data) => useProgressStore.getState().hydrate({ recordings: data.recordings.slice(0, MAX_STORED_RECORDINGS) }),
  )

  await restoreSlice(
    store,
    PRACTICE_LOG_COLLECTION,
    PRACTICE_LOG_KEY,
    isValidPracticeLog,
    (guarding) => {
      applyingRestoredPracticeLog = guarding
    },
    (data) => useProgressStore.getState().hydrate({ practiceEntries: data.practiceEntries.slice(0, MAX_STORED_PRACTICE_ENTRIES) }),
  )

  await restoreSlice(
    store,
    TECHNIQUE_COLLECTION,
    TECHNIQUE_KEY,
    isValidTechniqueHistory,
    (guarding) => {
      applyingRestoredTechniqueHistory = guarding
    },
    (data) =>
      useTechniqueStore
        .getState()
        .hydrate({ attempts: data.attempts.slice(0, MAX_STORED_TECHNIQUE_ATTEMPTS) }),
  )

  await restoreSlice(
    store,
    REPERTOIRE_COLLECTION,
    REPERTOIRE_KEY,
    isValidRepertoire,
    (guarding) => {
      applyingRestoredRepertoire = guarding
    },
    (data) =>
      useRepertoireStore
        .getState()
        .hydrate({ pieces: data.pieces.slice(0, MAX_STORED_REPERTOIRE_PIECES) }),
  )

  await restoreSlice(
    store,
    LEVELS_COLLECTION,
    LEVELS_KEY,
    isValidLevelState,
    (guarding) => {
      applyingRestoredLevels = guarding
    },
    (data) => useLevelStore.getState().hydrate({ levelState: data.levelState }),
  )

  await restoreSlice(
    store,
    EAR_TRAINING_COLLECTION,
    EAR_TRAINING_KEY,
    isValidEarTraining,
    (guarding) => {
      applyingRestoredEarTraining = guarding
    },
    (data) => useEarTrainingStore.getState().hydrate(data.session, data.itemsById),
  )

  return scoreRestored
}

// --------------------------------------------------------------- persisting

/**
 * Writes are last-write-wins WITHOUT relying on the underlying store to keep
 * concurrent `put`s in completion order — a real store's write latency can
 * vary, so an earlier `put` can resolve after a later one. The fix is to
 * never let that race exist: at most one `put` to (`collection`, `key`) is
 * ever in flight. `seq` is bumped on every call and stamped onto `pending`
 * alongside the value, so `pending` always names both the newest value
 * produced and the sequence number it belongs to. A value that arrives
 * mid-write replaces `pending` — the value it superseded is dropped, never
 * written — instead of starting a second `put`. When the in-flight write
 * settles, the drain loop checks `pending.seq`: if it is still the one that
 * write just sent (nothing queued while it was in flight), draining stops;
 * otherwise it is a genuinely newer value and gets sent next. Either way the
 * store only ever receives writes in the order the values were produced, so
 * a `put` that resolves late is, by construction, the one that was started
 * last — there is no completion to drop, because there was never a newer one
 * still in flight behind it. A rejected `put` is swallowed here, never
 * thrown into React.
 */
function createWriteQueue<T>(store: Store, collection: string, key: string): (value: T) => void {
  let pending: { readonly seq: number; readonly value: T } | undefined
  let seq = 0
  let draining = false

  const drain = (): void => {
    if (draining) return
    draining = true
    void (async () => {
      while (pending !== undefined) {
        const { seq: sentSeq, value } = pending
        try {
          await store.put(collection, key, value)
        } catch {
          // Swallowed: a failed save must not crash the practice session.
        }
        // Stop only if nothing newer was queued while this write was in
        // flight; otherwise `pending` now names that newer value and the loop
        // sends it next. Re-read `pending` rather than relying on pre-`await`
        // narrowing: it can be cleared by other code between the `await`
        // starting and resolving.
        const current = pending
        if (current !== undefined && current.seq === sentSeq) pending = undefined
      }
      draining = false
    })()
  }

  return (value: T): void => {
    seq += 1
    pending = { seq, value }
    drain()
  }
}

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
 * loaded score or the practice settings. Never on MIDI-device state or import
 * errors, which are not session state. Returns an unsubscribe function.
 */
function persistScoreSession(store: Store): () => void {
  const write = createWriteQueue<PersistedSession>(store, SESSION_COLLECTION, SESSION_KEY)
  return useScoreStore.subscribe((state, prevState) => {
    if (applyingRestoredScoreSession) return
    if (!isSessionRelevantChange(state, prevState)) return
    const session = toSession(state)
    if (session === undefined) return
    write(session)
  })
}

/** Subscribes to the sight-reading store and writes level + history on every change. */
function persistSightReadingHistory(store: Store): () => void {
  const write = createWriteQueue<PersistedSightReadingHistory>(
    store,
    SIGHT_READING_COLLECTION,
    SIGHT_READING_KEY,
  )
  return useSightReadingStore.subscribe((state, prevState) => {
    if (applyingRestoredSightReadingHistory) return
    if (state.level === prevState.level && state.history === prevState.history) return
    write({ level: state.level, history: state.history })
  })
}

/** Subscribes to the flashcard store and writes `cardsById` on every change. */
/**
 * Subscribes to the annotation store and writes every score's annotations
 * (roadmap 4.8, REQ-3.2.6). `COLLECTIONS.annotations` was the last declared
 * collection nothing wrote.
 */
function persistAnnotations(store: Store): () => void {
  const write = createWriteQueue<PersistedAnnotations>(
    store,
    ANNOTATIONS_COLLECTION,
    ANNOTATIONS_KEY,
  )
  return useAnnotationStore.subscribe((state, prevState) => {
    if (applyingRestoredAnnotations) return
    if (state.byScoreId === prevState.byScoreId) return
    write({ byScoreId: state.byScoreId })
  })
}

function persistFlashcards(store: Store): () => void {
  const write = createWriteQueue<PersistedFlashcards>(store, FLASHCARDS_COLLECTION, FLASHCARDS_KEY)
  return useFlashcardStore.subscribe((state, prevState) => {
    if (applyingRestoredFlashcards) return
    if (state.cardsById === prevState.cardsById) return
    write({ cardsById: state.cardsById })
  })
}

/** Subscribes to the progress store and writes `assessments` on every change. */
function persistAssessments(store: Store): () => void {
  const write = createWriteQueue<PersistedAssessments>(store, PROGRESS_COLLECTION, PROGRESS_KEY)
  return useProgressStore.subscribe((state, prevState) => {
    if (applyingRestoredAssessments) return
    if (state.assessments === prevState.assessments) return
    write({ assessments: state.assessments })
  })
}

/** Subscribes to the progress store and writes `recordings` on every change. */
function persistRecordings(store: Store): () => void {
  const write = createWriteQueue<PersistedRecordings>(store, RECORDINGS_COLLECTION, RECORDINGS_KEY)
  return useProgressStore.subscribe((state, prevState) => {
    if (applyingRestoredRecordings) return
    if (state.recordings === prevState.recordings) return
    write({ recordings: state.recordings })
  })
}

/** Subscribes to the progress store and writes `practiceEntries` on every change. */
function persistPracticeLog(store: Store): () => void {
  const write = createWriteQueue<PersistedPracticeLog>(
    store,
    PRACTICE_LOG_COLLECTION,
    PRACTICE_LOG_KEY,
  )
  return useProgressStore.subscribe((state, prevState) => {
    if (applyingRestoredPracticeLog) return
    if (state.practiceEntries === prevState.practiceEntries) return
    write({ practiceEntries: state.practiceEntries })
  })
}

/** Subscribes to the technique store and writes `attempts` on every change. */
function persistTechniqueHistory(store: Store): () => void {
  const write = createWriteQueue<PersistedTechniqueHistory>(
    store,
    TECHNIQUE_COLLECTION,
    TECHNIQUE_KEY,
  )
  return useTechniqueStore.subscribe((state, prevState) => {
    if (applyingRestoredTechniqueHistory) return
    if (state.attempts === prevState.attempts) return
    write({ attempts: state.attempts })
  })
}

/** Subscribes to the repertoire store and writes `pieces` on every change. */
function persistRepertoire(store: Store): () => void {
  const write = createWriteQueue<PersistedRepertoire>(store, REPERTOIRE_COLLECTION, REPERTOIRE_KEY)
  return useRepertoireStore.subscribe((state, prevState) => {
    if (applyingRestoredRepertoire) return
    if (state.pieces === prevState.pieces) return
    write({ pieces: state.pieces })
  })
}

/** Subscribes to the level store and writes `levelState` on every change. */
function persistLevels(store: Store): () => void {
  const write = createWriteQueue<PersistedLevelState>(store, LEVELS_COLLECTION, LEVELS_KEY)
  return useLevelStore.subscribe((state, prevState) => {
    if (applyingRestoredLevels) return
    if (state.levelState === prevState.levelState) return
    write({ levelState: state.levelState })
  })
}

/** Subscribes to the ear-training store and writes `session` + `itemsById` on every change to either. */
function persistEarTraining(store: Store): () => void {
  const write = createWriteQueue<PersistedEarTraining>(store, EAR_TRAINING_COLLECTION, EAR_TRAINING_KEY)
  return useEarTrainingStore.subscribe((state, prevState) => {
    if (applyingRestoredEarTraining) return
    if (state.session === prevState.session && state.itemsById === prevState.itemsById) return
    write({ session: state.session, itemsById: state.itemsById })
  })
}

/**
 * Starts persisting all eleven slices and returns one combined unsubscribe.
 * See the module comment for the mandatory `restoreSession` → `startPersisting`
 * call order.
 */
export function startPersisting(store: Store): () => void {
  const unsubscribers = [
    persistScoreSession(store),
    persistSightReadingHistory(store),
    persistFlashcards(store),
    persistAnnotations(store),
    persistAssessments(store),
    persistRecordings(store),
    persistPracticeLog(store),
    persistTechniqueHistory(store),
    persistRepertoire(store),
    persistLevels(store),
    persistEarTraining(store),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
