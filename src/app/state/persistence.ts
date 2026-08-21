/**
 * Session persistence over the `Store` port (roadmap 1.23/1.24/2.24,
 * REQ-3.10.4/4.3, REQ-3.4.3/3.4.6, REQ-3.9.4, REQ-3.3.4/3.9.2/3.9.5).
 *
 * Nothing here touches IndexedDB directly — it reads and writes through the
 * `Store` port, so it is exercised in tests with an in-memory fake and the
 * real zustand stores, never a browser database.
 *
 * Fourteen independent slices are persisted, each following the same shape
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
 *  - the graded groove runs (`useDrumsHistoryStore`, roadmap DR-09). The
 *    drums Groove trainer's whole history: which groove, at what tempo, and
 *    how each pad did. Without this the trainer forgets every run the moment
 *    the tab closes, so a learner can never see that last week's 70 bpm is
 *    this week's 80. Reuses `COLLECTIONS.settings` under its own key.
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
 *  - the theme preference (`useThemeStore`, roadmap UI-05): system/dark/light.
 *    Reuses `COLLECTIONS.settings` under its own key, same as `levelState`/
 *    `earTraining` above. Restored FIRST, ahead of every other slice — see
 *    `restoreSession`'s own comment on why.
 *  - the last-used instrument (`useInstrumentStore`, roadmap DR-01): which of
 *    the two apps — Piano or Drums — the learner opens into. Reuses
 *    `COLLECTIONS.settings` under its own key, same as `theme`/`levelState`/
 *    `earTraining` above. See `instrumentStore.ts`'s own module comment for
 *    why a synchronous localStorage hint ALSO exists alongside this slice —
 *    this restore is the source of truth, the hint only covers the one
 *    render before this async restore lands.
 *
 * Each slice's write queue is fully independent — its own (collection, key)
 * pair, its own in-flight `put` — so a slow write to one can never block or
 * reorder a write to another. Note that the score session and the level
 * state share `COLLECTIONS.settings` and are separated by key alone, so
 * those two keys must never converge. `startPersisting` just wires up all
 * fourteen and returns one combined unsubscribe.
 *
 * CALL ORDER IS MANDATORY, for every slice: `await restoreSession(store)`
 * must resolve before `startPersisting(store)` is called. Subscribing first
 * races each slice's in-flight `get` against any early write that happens
 * before restore lands (for example a caller auto-loading a sample score) —
 * IndexedDB serialises transactions, so that write can commit first and the
 * subsequent read then returns the wrong (or no) saved value, silently
 * discarding it.
 *
 * ## Page-hide flush (roadmap follow-up F.2)
 *
 * `createWriteQueue` keeps at most one `put` in flight per slice and holds
 * any newer value as `pending` until that write settles (see its own doc
 * comment). Nothing previously drained `pending` when the tab went away, so
 * a value that was PRODUCED (a store changed) while an older write for the
 * same slice was still in flight sat in `pending` forever if the page
 * disappeared before the in-flight write settled and the drain loop got
 * back around to sending it — a learner who advanced a level, or logged a
 * practice session, and then closed the tab lost exactly that change.
 * `startPersisting` now registers ONE listener pair — `pagehide`, and
 * `visibilitychange` when `document.visibilityState` becomes `'hidden'` —
 * that calls every slice's `flush()`. `beforeunload` alone is not enough:
 * it does not fire reliably on mobile or when a tab is discarded in the
 * background, and `visibilitychange` is the only one of the three that
 * fires on every backgrounding path (switching apps, closing a phone's
 * screen, a tab going background without ever formally "closing"). Both are
 * wired because they are NOT mutually redundant: a `pagehide`-only reload
 * fires `pagehide` but a background tab kill may only ever see
 * `visibilitychange`, and neither implies the other.
 *
 * `flush()` is a SYNCHRONOUS, best-effort call — never awaited, and it must
 * never be: a page-hide handler that blocked on the write settling would be
 * a synchronous busy-wait, which is worse than the bug it closes (the tab
 * would hang rather than close). What it buys is real: for the real
 * `IdbStore` (`src/adapters/store/idb.ts`), `Store.put` is an `async`
 * function whose body runs SYNCHRONOUSLY up to its own first `await` —
 * `cloneForStorage` runs, then `this.db.put(...)` is called, which
 * synchronously opens a transaction and issues the native
 * `IDBObjectStore.put()` request — before that function suspends and
 * returns a pending promise. So calling `flush()` synchronously, with
 * nothing awaited, is enough to make sure the request for whatever was
 * still sitting in `pending` has actually been ISSUED to the browser before
 * the page can be torn down, instead of dying inside this module having
 * never left it.
 *
 * That is also the honest limit of what this closes. A flush cannot make
 * IndexedDB synchronous: issuing the request is not the same as the
 * browser having committed the underlying transaction, and a transaction
 * the browser kills mid-commit during an abrupt teardown is still lost.
 * This fix closes the "queued but never sent" window — a value that was
 * never even handed to the store — not the "sent but not committed" one,
 * which no amount of listener wiring from inside the page can close.
 *
 * ## Why flushing is safe against the ordering invariant
 *
 * `createWriteQueue`'s whole design leans on ONE guarantee: the store only
 * ever receives writes for a given (collection, key) in the order the
 * values were produced, because at most one `put` is ever in flight and a
 * value produced mid-write replaces `pending` rather than starting a second
 * `put`. `flush()` has to preserve that or a page-hide could commit a STALE
 * value last. It does, for a reason specific to IndexedDB and specific to
 * this moment:
 *
 * - IndexedDB orders `readwrite` transactions against the SAME object store
 *   by CREATION order, not completion order — a transaction opened later
 *   always commits after one opened earlier against the same store, no
 *   matter how their underlying work finishes. `flush()` only ever runs
 *   while an older write for that same slice is genuinely still in flight
 *   (see below), so the `put` it issues is, by construction, created after
 *   the one already in flight — it will commit after it, carrying the
 *   newer value forward, exactly like the ordinary drain loop's next
 *   iteration would have.
 * - The `Store` PORT itself makes no such promise in general — a
 *   hand-written fake, or a future non-IndexedDB adapter, is free to
 *   resolve two `put` calls in whatever order it likes, which is exactly
 *   why the ordinary drain loop above never issues a second `put` while one
 *   is in flight at all. `flush()` is a deliberate, narrow exception to
 *   that caution, acceptable ONLY at page-hide: the alternative is not "the
 *   store's own guarantee is slightly weaker" but "the value is not sent at
 *   all", which is strictly worse for every `Store` implementation, ordered
 *   or not.
 * - `flush()` NEVER issues a `put` for a value that was already sent: it
 *   inspects `pending`, which — by the very invariant above — only ever
 *   holds a value once a DIFFERENT, older write for the same slice is
 *   already in flight (see `createWriteQueue`'s own comment on `write`).
 *   If nothing is queued, `flush()` is a no-op, whether nothing was ever
 *   written, a write is in flight with nothing newer behind it, or an
 *   earlier flush already sent the newest value — `flush()` clears
 *   `pending` itself the moment it sends it, so the drain loop that wakes
 *   up when the older write settles finds nothing left to resend and simply
 *   stops, and a second `flush()` call (e.g. `pagehide` and then
 *   `visibilitychange` firing for the same hide, or two hide/show cycles in
 *   a row) finds nothing left to send either.
 */
import type { Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { createWriteQueue } from '@app/state/writeQueue.ts'
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
import { useDrumsHistoryStore, MAX_STORED_GROOVE_ATTEMPTS } from '@app/state/drumsHistoryStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { useThemeStore } from '@app/state/themeStore.ts'
import { useInstrumentStore } from '@app/state/instrumentStore.ts'
import {
  isValidAnnotations,
  isValidAssessments,
  isValidDrumsGrooveAttempt,
  isValidDrumsHistory,
  isValidFlashcards,
  isValidInstrument,
  isValidLevelState,
  isValidPracticeLog,
  isValidRecordings,
  isValidRepertoire,
  isValidSession,
  isValidSightReadingHistory,
  isValidTechniqueHistory,
  isValidTheme,
  type PersistedAnnotations,
  type PersistedAssessments,
  type PersistedDrumsHistory,
  type PersistedFlashcards,
  type PersistedInstrument,
  type PersistedLevelState,
  type PersistedPracticeLog,
  type PersistedRecordings,
  type PersistedRepertoire,
  type PersistedSession,
  type PersistedSightReadingHistory,
  type PersistedTechniqueHistory,
  type PersistedTheme,
} from '@app/state/persistedShapes.ts'
import { isValidEarTraining, type PersistedEarTraining } from '@app/state/persistedEarShapes.ts'

// The persisted shapes moved to `persistedShapes.ts` (this file outgrew the
// 500-line limit); re-exported here so every existing importer — and every
// test — keeps its single, obvious import site for "what persistence deals in".
export type {
  PersistedAnnotations,
  PersistedAssessments,
  PersistedDrumsHistory,
  PersistedFlashcards,
  PersistedInstrument,
  PersistedLevelState,
  PersistedPracticeLog,
  PersistedRecordings,
  PersistedRepertoire,
  PersistedSession,
  PersistedSightReadingHistory,
  PersistedTechniqueHistory,
  PersistedTheme,
} from '@app/state/persistedShapes.ts'
export type { PersistedEarTraining } from '@app/state/persistedEarShapes.ts'

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

/**
 * Collection + key the graded groove runs live under (roadmap DR-09). Reuses
 * `COLLECTIONS.settings` under its own key rather than declaring a drums
 * object store of its own — same reasoning as `LEVELS_COLLECTION` and the
 * three slices after it: a new key in a store that already exists needs no
 * `DB_VERSION` bump, so a learner's existing database opens unchanged.
 */
export const DRUMS_HISTORY_COLLECTION = COLLECTIONS.settings
export const DRUMS_HISTORY_KEY = 'drumsHistory'

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

/**
 * Collection + key the theme preference lives under (roadmap UI-05). Reuses
 * `COLLECTIONS.settings` under its own key — same reasoning as
 * `LEVELS_COLLECTION`/`EAR_TRAINING_COLLECTION` above: a new key in an object
 * store that already exists, so no IndexedDB migration for this slice.
 */
export const THEME_COLLECTION = COLLECTIONS.settings
export const THEME_KEY = 'theme'

/** Collection + key the last-used instrument lives under (roadmap DR-01). Reuses `COLLECTIONS.settings`, same reasoning as `THEME_COLLECTION` above. */
export const INSTRUMENT_COLLECTION = COLLECTIONS.settings
export const INSTRUMENT_KEY = 'lastInstrument'

// ----------------------------------------------------------------- restore

/**
 * While one of these is `true`, the matching `persistXxx` subscriber below
 * ignores store changes: `restoreSlice` applying a restored value would
 * otherwise be seen as a fresh "changed, write it back" event and re-save the
 * exact bytes just read. One flag per slice, not a single shared flag,
 * because the twelve restores are independent of each other. Zustand's `set`
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
let applyingRestoredDrumsHistory = false
let applyingRestoredRepertoire = false
let applyingRestoredLevels = false
let applyingRestoredEarTraining = false
let applyingRestoredTheme = false
let applyingRestoredInstrument = false

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
 * Restores all thirteen persisted slices (see the module comment for the full
 * list). Each is validated and applied independently, so a corrupt or
 * missing slice never prevents the others from restoring. Returns whether
 * the SCORE session specifically was restored, the original roadmap-1.23
 * contract this app's callers and tests rely on.
 *
 * The theme slice restores FIRST, ahead of the score session and everything
 * else: it is the one restore whose delay reads as a visible "flash" of the
 * wrong palette rather than a silent, invisible gap (a level or a history
 * entry restoring a beat later is not something the eye catches the way a
 * dark-to-light flip is). This function is still awaited from `App.tsx`'s
 * `useEffect` — which runs after React's first commit — so restoring theme
 * first narrows that window as much as this async flow allows, but does not
 * close it; see `themeStore.ts` and this task's own report for the honest
 * limit of what is achievable without touching `App.tsx` (outside this
 * task's file boundary).
 */
export async function restoreSession(store: Store): Promise<boolean> {
  await restoreSlice(
    store,
    THEME_COLLECTION,
    THEME_KEY,
    isValidTheme,
    (guarding) => {
      applyingRestoredTheme = guarding
    },
    (data) => useThemeStore.getState().hydrate(data.theme),
  )

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
    DRUMS_HISTORY_COLLECTION,
    DRUMS_HISTORY_KEY,
    isValidDrumsHistory,
    (guarding) => {
      applyingRestoredDrumsHistory = guarding
    },
    (data) =>
      useDrumsHistoryStore.getState().hydrate({
        // Row-by-row, never all-or-nothing: `isValidDrumsHistory` checks the wrapper only,
        // so one unreadable attempt costs one attempt instead of the whole history. See
        // that function's comment for what the all-or-nothing version destroyed.
        attempts: data.attempts
          .filter(isValidDrumsGrooveAttempt)
          .slice(0, MAX_STORED_GROOVE_ATTEMPTS),
      }),
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
  // Unconditional, and outside `restoreSlice`'s own apply/guard machinery on
  // purpose: `restoreSlice` never throws, so this always runs, whether a
  // record was found, nothing was stored (fresh install), the payload was
  // invalid, or the store's `get` itself rejected. `ScoreScreen`'s
  // analysis-panel gate renders nothing until this flips — see the
  // `hydrated` field comment in `levelStore.ts` — so a permanently-false flag
  // on a failed or empty read would mean the panel never appears at all,
  // rather than merely starting from level 1.
  useLevelStore.getState().markHydrated()

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

  await restoreSlice(
    store,
    INSTRUMENT_COLLECTION,
    INSTRUMENT_KEY,
    isValidInstrument,
    (guarding) => {
      applyingRestoredInstrument = guarding
    },
    (data) => useInstrumentStore.getState().hydrate(data.lastInstrument),
  )

  return scoreRestored
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
 * What every `persistXxx` below hands back to `startPersisting`: how to stop
 * listening, and how to best-effort-drain whatever this slice's queue is
 * currently holding (roadmap follow-up F.2's page-hide flush).
 */
type PersistedSlice = {
  readonly unsubscribe: () => void
  readonly flush: () => void
}

/**
 * Subscribes to the score store and writes the session on every change to the
 * loaded score or the practice settings. Never on MIDI-device state or import
 * errors, which are not session state.
 */
function persistScoreSession(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedSession>(store, SESSION_COLLECTION, SESSION_KEY)
  const unsubscribe = useScoreStore.subscribe((state, prevState) => {
    if (applyingRestoredScoreSession) return
    if (!isSessionRelevantChange(state, prevState)) return
    const session = toSession(state)
    if (session === undefined) return
    write(session)
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the sight-reading store and writes level + history on every change. */
function persistSightReadingHistory(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedSightReadingHistory>(
    store,
    SIGHT_READING_COLLECTION,
    SIGHT_READING_KEY,
  )
  const unsubscribe = useSightReadingStore.subscribe((state, prevState) => {
    if (applyingRestoredSightReadingHistory) return
    if (state.level === prevState.level && state.history === prevState.history) return
    write({ level: state.level, history: state.history })
  })
  return { unsubscribe, flush: write.flush }
}

/**
 * Subscribes to the annotation store and writes every score's annotations
 * (roadmap 4.8, REQ-3.2.6). `COLLECTIONS.annotations` was the last declared
 * collection nothing wrote.
 */
function persistAnnotations(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedAnnotations>(
    store,
    ANNOTATIONS_COLLECTION,
    ANNOTATIONS_KEY,
  )
  const unsubscribe = useAnnotationStore.subscribe((state, prevState) => {
    if (applyingRestoredAnnotations) return
    if (state.byScoreId === prevState.byScoreId) return
    write({ byScoreId: state.byScoreId })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the flashcard store and writes `cardsById` on every change. */
function persistFlashcards(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedFlashcards>(store, FLASHCARDS_COLLECTION, FLASHCARDS_KEY)
  const unsubscribe = useFlashcardStore.subscribe((state, prevState) => {
    if (applyingRestoredFlashcards) return
    if (state.cardsById === prevState.cardsById) return
    write({ cardsById: state.cardsById })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the progress store and writes `assessments` on every change. */
function persistAssessments(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedAssessments>(store, PROGRESS_COLLECTION, PROGRESS_KEY)
  const unsubscribe = useProgressStore.subscribe((state, prevState) => {
    if (applyingRestoredAssessments) return
    if (state.assessments === prevState.assessments) return
    write({ assessments: state.assessments })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the progress store and writes `recordings` on every change. */
function persistRecordings(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedRecordings>(store, RECORDINGS_COLLECTION, RECORDINGS_KEY)
  const unsubscribe = useProgressStore.subscribe((state, prevState) => {
    if (applyingRestoredRecordings) return
    if (state.recordings === prevState.recordings) return
    write({ recordings: state.recordings })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the progress store and writes `practiceEntries` on every change. */
function persistPracticeLog(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedPracticeLog>(
    store,
    PRACTICE_LOG_COLLECTION,
    PRACTICE_LOG_KEY,
  )
  const unsubscribe = useProgressStore.subscribe((state, prevState) => {
    if (applyingRestoredPracticeLog) return
    if (state.practiceEntries === prevState.practiceEntries) return
    write({ practiceEntries: state.practiceEntries })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the technique store and writes `attempts` on every change. */
function persistTechniqueHistory(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedTechniqueHistory>(
    store,
    TECHNIQUE_COLLECTION,
    TECHNIQUE_KEY,
  )
  const unsubscribe = useTechniqueStore.subscribe((state, prevState) => {
    if (applyingRestoredTechniqueHistory) return
    if (state.attempts === prevState.attempts) return
    write({ attempts: state.attempts })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the drums groove history and writes `attempts` on every change (roadmap DR-09). */
function persistDrumsHistory(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedDrumsHistory>(
    store,
    DRUMS_HISTORY_COLLECTION,
    DRUMS_HISTORY_KEY,
  )
  const unsubscribe = useDrumsHistoryStore.subscribe((state, prevState) => {
    if (applyingRestoredDrumsHistory) return
    if (state.attempts === prevState.attempts) return
    write({ attempts: state.attempts })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the repertoire store and writes `pieces` on every change. */
function persistRepertoire(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedRepertoire>(store, REPERTOIRE_COLLECTION, REPERTOIRE_KEY)
  const unsubscribe = useRepertoireStore.subscribe((state, prevState) => {
    if (applyingRestoredRepertoire) return
    if (state.pieces === prevState.pieces) return
    write({ pieces: state.pieces })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the level store and writes `levelState` on every change. */
function persistLevels(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedLevelState>(store, LEVELS_COLLECTION, LEVELS_KEY)
  const unsubscribe = useLevelStore.subscribe((state, prevState) => {
    if (applyingRestoredLevels) return
    if (state.levelState === prevState.levelState) return
    write({ levelState: state.levelState })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the ear-training store and writes `session` + `itemsById` on every change to either. */
function persistEarTraining(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedEarTraining>(store, EAR_TRAINING_COLLECTION, EAR_TRAINING_KEY)
  const unsubscribe = useEarTrainingStore.subscribe((state, prevState) => {
    if (applyingRestoredEarTraining) return
    if (state.session === prevState.session && state.itemsById === prevState.itemsById) return
    write({ session: state.session, itemsById: state.itemsById })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the theme store and writes `theme` on every change (roadmap UI-05). */
function persistTheme(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedTheme>(store, THEME_COLLECTION, THEME_KEY)
  const unsubscribe = useThemeStore.subscribe((state, prevState) => {
    if (applyingRestoredTheme) return
    if (state.theme === prevState.theme) return
    write({ theme: state.theme })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the instrument store and writes `lastInstrument` on every change (roadmap DR-01). */
function persistInstrument(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedInstrument>(store, INSTRUMENT_COLLECTION, INSTRUMENT_KEY)
  const unsubscribe = useInstrumentStore.subscribe((state, prevState) => {
    if (applyingRestoredInstrument || state.lastInstrument === prevState.lastInstrument) return
    write({ lastInstrument: state.lastInstrument })
  })
  return { unsubscribe, flush: write.flush }
}

/**
 * Starts persisting all fourteen slices, registers the page-hide flush
 * listener pair (roadmap follow-up F.2 — see the module comment), and
 * returns one combined unsubscribe that tears both down. See the module
 * comment for the mandatory `restoreSession` → `startPersisting` call order.
 */
export function startPersisting(store: Store): () => void {
  const slices = [
    persistScoreSession(store),
    persistSightReadingHistory(store),
    persistFlashcards(store),
    persistAnnotations(store),
    persistAssessments(store),
    persistRecordings(store),
    persistPracticeLog(store),
    persistTechniqueHistory(store),
    persistDrumsHistory(store),
    persistRepertoire(store),
    persistLevels(store),
    persistEarTraining(store),
    persistTheme(store),
    persistInstrument(store),
  ]

  // Best-effort drain of every slice's write queue — see the module comment's
  // "Page-hide flush" section for why both events are wired and neither
  // subsumes the other, and `createWriteQueue`'s `flush` for why this is
  // synchronous and never awaited.
  const flushAll = (): void => {
    for (const slice of slices) slice.flush()
  }
  const handlePageHide = (): void => flushAll()
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') flushAll()
  }
  window.addEventListener('pagehide', handlePageHide)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    window.removeEventListener('pagehide', handlePageHide)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    for (const slice of slices) slice.unsubscribe()
  }
}
