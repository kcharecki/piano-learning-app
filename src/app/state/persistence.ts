/**
 * Session persistence over the `Store` port (roadmap 1.23/1.24/2.24,
 * REQ-3.10.4/4.3, REQ-3.4.3/3.4.6, REQ-3.9.4, REQ-3.3.4/3.9.2/3.9.5).
 *
 * Nothing here touches IndexedDB directly — it reads and writes through the
 * `Store` port, so it is exercised in tests with an in-memory fake and the
 * real zustand stores, never a browser database.
 *
 * Six independent slices are persisted, each following the same shape
 * (validate → `restoreSlice` on the way in, `createWriteQueue` +  a
 * `subscribe` on the way out):
 *  - the score session (`useScoreStore`) — the original roadmap-1.23 slice.
 *  - the sight-reading level + retirement history (`useSightReadingStore`).
 *    Without this, REQ-3.4.3's "once read, retired forever" resets on every
 *    reload (the pool refills), and REQ-3.4.6's level adaptation can never
 *    accumulate past whatever a single page life manages.
 *  - the SRS flashcard state (`useFlashcardStore`, REQ-3.9.4). Without this
 *    every card, ease factor and due date is lost on reload.
 *  - stored assessment results, MIDI recordings and the practice log
 *    (`useProgressStore`, roadmap 2.24, REQ-3.3.4/3.9.2/3.9.5) — three
 *    further collections on the SAME store, each restored and persisted
 *    independently via `hydrate`'s partial-state contract (see that store's
 *    module comment), because each has its own validation and can fail
 *    without disturbing the other two.
 *
 * Each slice's write queue is fully independent — its own collection, its own
 * key, its own in-flight `put` — so a slow write to one can never block or
 * reorder a write to another. `startPersisting` just wires up all six and
 * returns one combined unsubscribe.
 *
 * CALL ORDER IS MANDATORY, for every slice: `await restoreSession(store)`
 * must resolve before `startPersisting(store)` is called. Subscribing first
 * races each slice's in-flight `get` against any early write that happens
 * before restore lands (for example a caller auto-loading a sample score) —
 * IndexedDB serialises transactions, so that write can commit first and the
 * subsequent read then returns the wrong (or no) saved value, silently
 * discarding it.
 */
import type { Hand, Score } from '@core/notation/score.ts'
import type { MidiEvent, Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { MAX_TEMPO_SCALE, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { MAX_LEVEL, MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { AssessmentResult, MeasureScore } from '@core/practice/assessment.ts'
import type { Recording } from '@core/practice/recorder.ts'
import { ACTIVITY_KINDS, type ActivityKind, type PracticeEntry } from '@core/progress/log.ts'
import {
  useScoreStore,
  type PracticeSettings,
  type ScoreStoreState,
} from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useProgressStore, MAX_STORED_ASSESSMENTS, MAX_STORED_RECORDINGS, MAX_STORED_PRACTICE_ENTRIES, type StoredAssessment } from '@app/state/progressStore.ts'

/** Collection + key the score session lives under. */
export const SESSION_COLLECTION = COLLECTIONS.settings
export const SESSION_KEY = 'session'

/** Collection + key the sight-reading level + retirement history live under. */
export const SIGHT_READING_COLLECTION = COLLECTIONS.sightReadingHistory
export const SIGHT_READING_KEY = 'sightReadingHistory'

/** Collection + key the SRS flashcard state lives under. */
export const FLASHCARDS_COLLECTION = COLLECTIONS.srsCards
export const FLASHCARDS_KEY = 'srsCards'

/** Collection + key the stored assessment results live under (roadmap 2.24, REQ-3.3.4). */
export const PROGRESS_COLLECTION = COLLECTIONS.progress
export const PROGRESS_KEY = 'assessments'

/** Collection + key the stored recordings live under (roadmap 2.24, REQ-3.9.2). */
export const RECORDINGS_COLLECTION = COLLECTIONS.recordings
export const RECORDINGS_KEY = 'recordings'

/** Collection + key the practice log lives under (roadmap 2.24, REQ-3.9.5). */
export const PRACTICE_LOG_COLLECTION = COLLECTIONS.practiceLog
export const PRACTICE_LOG_KEY = 'practiceLog'

export type PersistedSession = {
  readonly score: Score
  readonly sourceName: string
  readonly musicXml: string | undefined
  readonly settings: PracticeSettings
}

export type PersistedSightReadingHistory = {
  readonly level: number
  readonly history: readonly SightReadingRecord[]
}

export type PersistedFlashcards = {
  readonly cardsById: Readonly<Record<string, Card>>
}

export type PersistedAssessments = {
  readonly assessments: readonly StoredAssessment[]
}

export type PersistedRecordings = {
  readonly recordings: readonly Recording[]
}

export type PersistedPracticeLog = {
  readonly practiceEntries: readonly PracticeEntry[]
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
 * The same reasoning applies to every other `isValidXxx` below.
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

function isValidSightReadingRecord(value: unknown): value is SightReadingRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.pieceId === 'string' &&
    typeof r.readAt === 'number' &&
    Number.isFinite(r.readAt) &&
    typeof r.accuracy === 'number' &&
    Number.isFinite(r.accuracy) &&
    typeof r.level === 'number' &&
    Number.isFinite(r.level)
  )
}

function isValidSightReadingHistory(value: unknown): value is PersistedSightReadingHistory {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.level === 'number' &&
    Number.isFinite(v.level) &&
    v.level >= MIN_LEVEL &&
    v.level <= MAX_LEVEL &&
    Array.isArray(v.history) &&
    v.history.every(isValidSightReadingRecord)
  )
}

function isValidCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.due === 'number' &&
    Number.isFinite(c.due) &&
    typeof c.intervalDays === 'number' &&
    Number.isFinite(c.intervalDays) &&
    typeof c.ease === 'number' &&
    Number.isFinite(c.ease) &&
    typeof c.reps === 'number' &&
    Number.isFinite(c.reps) &&
    typeof c.lapses === 'number' &&
    Number.isFinite(c.lapses) &&
    typeof c.introducedAt === 'number' &&
    Number.isFinite(c.introducedAt)
  )
}

function isValidFlashcards(value: unknown): value is PersistedFlashcards {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.cardsById !== 'object' || v.cardsById === null) return false
  return Object.values(v.cardsById as Record<string, unknown>).every(isValidCard)
}

function isValidMeasureScore(value: unknown): value is MeasureScore {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.measureIndex === 'number' &&
    Number.isFinite(m.measureIndex) &&
    typeof m.expected === 'number' &&
    Number.isFinite(m.expected) &&
    typeof m.correct === 'number' &&
    Number.isFinite(m.correct) &&
    typeof m.wrongPitch === 'number' &&
    Number.isFinite(m.wrongPitch) &&
    typeof m.missed === 'number' &&
    Number.isFinite(m.missed) &&
    typeof m.extra === 'number' &&
    Number.isFinite(m.extra) &&
    typeof m.accuracy === 'number' &&
    Number.isFinite(m.accuracy) &&
    typeof m.meanAbsDeviationMs === 'number' &&
    Number.isFinite(m.meanAbsDeviationMs)
  )
}

function isValidAssessmentCounts(value: unknown): value is AssessmentResult['counts'] {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.correct === 'number' &&
    Number.isFinite(c.correct) &&
    typeof c.wrongPitch === 'number' &&
    Number.isFinite(c.wrongPitch) &&
    typeof c.missed === 'number' &&
    Number.isFinite(c.missed) &&
    typeof c.extra === 'number' &&
    Number.isFinite(c.extra)
  )
}

function isValidAssessmentResult(value: unknown): value is AssessmentResult {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.scoreId === 'string' &&
    typeof r.accuracy === 'number' &&
    Number.isFinite(r.accuracy) &&
    typeof r.timingConsistency === 'number' &&
    Number.isFinite(r.timingConsistency) &&
    typeof r.meanAbsDeviationMs === 'number' &&
    Number.isFinite(r.meanAbsDeviationMs) &&
    typeof r.tempoBpm === 'number' &&
    Number.isFinite(r.tempoBpm) &&
    Array.isArray(r.measures) &&
    r.measures.every(isValidMeasureScore) &&
    isValidAssessmentCounts(r.counts) &&
    typeof r.completedAt === 'number' &&
    Number.isFinite(r.completedAt)
  )
}

function isValidStoredAssessment(value: unknown): value is StoredAssessment {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.id === 'string' &&
    typeof a.scoreId === 'string' &&
    typeof a.scoreTitle === 'string' &&
    typeof a.at === 'number' &&
    Number.isFinite(a.at) &&
    isValidAssessmentResult(a.result)
  )
}

function isValidAssessments(value: unknown): value is PersistedAssessments {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.assessments) && v.assessments.every(isValidStoredAssessment)
}

function isValidMidiEvent(value: unknown): value is MidiEvent {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  if (typeof e.time !== 'number' || !Number.isFinite(e.time)) return false
  if (e.type === 'noteOn') {
    return (
      typeof e.note === 'number' &&
      Number.isFinite(e.note) &&
      typeof e.velocity === 'number' &&
      Number.isFinite(e.velocity)
    )
  }
  if (e.type === 'noteOff') return typeof e.note === 'number' && Number.isFinite(e.note)
  if (e.type === 'sustain') return typeof e.down === 'boolean'
  return false
}

function isValidRecording(value: unknown): value is Recording {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string') return false
  if (r.scoreId !== undefined && typeof r.scoreId !== 'string') return false
  if (typeof r.recordedAt !== 'number' || !Number.isFinite(r.recordedAt)) return false
  if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs)) return false
  if (!Array.isArray(r.events) || !r.events.every(isValidMidiEvent)) return false
  if (r.tempoBpm !== undefined && (typeof r.tempoBpm !== 'number' || !Number.isFinite(r.tempoBpm))) {
    return false
  }
  return true
}

function isValidRecordings(value: unknown): value is PersistedRecordings {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.recordings) && v.recordings.every(isValidRecording)
}

function isValidActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value)
}

function isValidPracticeEntry(value: unknown): value is PracticeEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  if (typeof e.id !== 'string') return false
  if (typeof e.startedAt !== 'number' || !Number.isFinite(e.startedAt)) return false
  if (typeof e.endedAt !== 'number' || !Number.isFinite(e.endedAt)) return false
  if (!isValidActivityKind(e.kind)) return false
  if (e.itemId !== undefined && typeof e.itemId !== 'string') return false
  if (typeof e.itemName !== 'string') return false
  if (e.tempoBpm !== undefined && (typeof e.tempoBpm !== 'number' || !Number.isFinite(e.tempoBpm))) {
    return false
  }
  if (e.accuracy !== undefined && (typeof e.accuracy !== 'number' || !Number.isFinite(e.accuracy))) {
    return false
  }
  if (e.note !== undefined && typeof e.note !== 'string') return false
  return true
}

function isValidPracticeLog(value: unknown): value is PersistedPracticeLog {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.practiceEntries) && v.practiceEntries.every(isValidPracticeEntry)
}

// ----------------------------------------------------------------- restore

/**
 * While one of these is `true`, the matching `persistXxx` subscriber below
 * ignores store changes: `restoreSlice` applying a restored value would
 * otherwise be seen as a fresh "changed, write it back" event and re-save the
 * exact bytes just read. One flag per slice, not a single shared flag,
 * because the three restores are independent of each other. Zustand's `set`
 * notifies subscribers synchronously, so toggling a flag around the
 * synchronous `apply()` call below is enough — nothing async ever runs while
 * it is `true`.
 */
let applyingRestoredScoreSession = false
let applyingRestoredSightReadingHistory = false
let applyingRestoredFlashcards = false
let applyingRestoredAssessments = false
let applyingRestoredRecordings = false
let applyingRestoredPracticeLog = false

/**
 * Reads `key` from `collection`, validates it, and — only if valid — applies
 * it with `setGuard` held `true` for the (synchronous) duration of `apply`.
 * Never throws: a store error or invalid payload resolves to `false` and
 * leaves the caller's state on its defaults, because a learner who cannot
 * start the app has lost more than a learner who lost their saved state.
 */
async function restoreSlice<T>(
  store: Store,
  collection: string,
  key: string,
  isValid: (value: unknown) => value is T,
  setGuard: (guarding: boolean) => void,
  apply: (value: T) => void,
): Promise<boolean> {
  let raw: unknown
  try {
    raw = await store.get<unknown>(collection, key)
  } catch {
    return false
  }
  if (!isValid(raw)) return false
  setGuard(true)
  try {
    apply(raw)
  } finally {
    setGuard(false)
  }
  return true
}

/**
 * Restores all three persisted slices — score session, sight-reading history,
 * flashcard SRS state. Each is validated and applied independently, so a
 * corrupt or missing slice never prevents the others from restoring. Returns
 * whether the SCORE session specifically was restored, the original
 * roadmap-1.23 contract this app's callers and tests rely on.
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

/**
 * Starts persisting all six slices and returns one combined unsubscribe. See
 * the module comment for the mandatory `restoreSession` → `startPersisting`
 * call order.
 */
export function startPersisting(store: Store): () => void {
  const unsubscribers = [
    persistScoreSession(store),
    persistSightReadingHistory(store),
    persistFlashcards(store),
    persistAssessments(store),
    persistRecordings(store),
    persistPracticeLog(store),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
