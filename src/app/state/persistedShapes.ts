/**
 * The SHAPE of everything this app persists, and the structural validation of
 * it on the way back in.
 *
 * Split out of `persistence.ts` when that file outgrew the 500-line limit:
 * the plumbing (restore, write queues, subscriptions) is one concept, and
 * "what a persisted slice looks like, and how to tell a corrupt one" is
 * another. Everything here is pure and total — a validator returns false, it
 * never throws — because its input is untrusted data off a disk that a
 * previous version of this app, or a hand edit, may have written.
 */
import type { Hand, Score } from '@core/notation/score.ts'
import type { MidiEvent } from '@core/ports/index.ts'
import { MAX_TEMPO_SCALE, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { MAX_LEVEL, MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import type { AssessmentResult, MeasureScore } from '@core/practice/assessment.ts'
import type { Recording } from '@core/practice/recorder.ts'
import { ACTIVITY_KINDS, type ActivityKind, type PracticeEntry } from '@core/progress/log.ts'
import { validateAnnotations, type ScoreAnnotations } from '@core/notation/annotations.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import { REPERTOIRE_STATUSES, type RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { MAX_LEVEL as MAX_TRACK_LEVEL, MIN_LEVEL as MIN_TRACK_LEVEL, TRACKS } from '@core/curriculum/types.ts'
import type { Track } from '@core/curriculum/types.ts'
import type { LevelState } from '@core/progress/levels.ts'
import type { EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { EAR_MAX_LEVEL, EAR_MIN_LEVEL, type EarAttempt, type EarSessionState } from '@core/eartraining/session.ts'
import type { PracticeSettings } from '@app/state/scoreStore.ts'
import type { StoredAssessment } from '@app/state/progressStore.ts'
import type { ThemePreference } from '@app/state/themeStore.ts'

export type PersistedRepertoire = {
  readonly pieces: readonly RepertoirePiece[]
}

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

export type PersistedAnnotations = {
  readonly byScoreId: Readonly<Record<string, ScoreAnnotations>>
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

export type PersistedTechniqueHistory = {
  readonly attempts: readonly TechniqueAttempt[]
}

export type PersistedLevelState = {
  readonly levelState: LevelState
}

/** The learner's theme choice (roadmap UI-05) — see `themeStore.ts`'s module comment. */
export type PersistedTheme = {
  readonly theme: ThemePreference
}

/**
 * The whole ear-training slice (roadmap 3.11, REQ-3.6.3): the shared
 * `EarSessionState` — per-kind levels, SRS cards, id -> kind map and attempt
 * log — plus the generated-item cache `itemsById` (see `earTrainingStore.ts`'s
 * module comment for why the cache must be persisted alongside the session:
 * some item ids have no reverse parser, so "what to play again for this due
 * card" is a question only the originally generated `EarItem` can answer).
 */
export type PersistedEarTraining = {
  readonly session: EarSessionState
  readonly itemsById: Readonly<Record<string, EarItem>>
}

// --------------------------------------------------------------- validation

function isHand(value: unknown): value is Hand {
  return value === 'left' || value === 'right'
}

export function isValidLoop(value: unknown): value is LoopRange | undefined {
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

export function isValidSettings(value: unknown): value is PracticeSettings {
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
export function isValidScore(value: unknown): value is Score {
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

export function isValidSession(value: unknown): value is PersistedSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isValidScore(v.score)) return false
  if (typeof v.sourceName !== 'string') return false
  if (v.musicXml !== undefined && typeof v.musicXml !== 'string') return false
  return isValidSettings(v.settings)
}

export function isValidSightReadingRecord(value: unknown): value is SightReadingRecord {
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

export function isValidSightReadingHistory(value: unknown): value is PersistedSightReadingHistory {
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

export function isValidCard(value: unknown): value is Card {
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

export function isValidFlashcards(value: unknown): value is PersistedFlashcards {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.cardsById !== 'object' || v.cardsById === null) return false
  return Object.values(v.cardsById as Record<string, unknown>).every(isValidCard)
}

/**
 * Every entry must survive `validateAnnotations` — the core validator that
 * already knows the shape — and its key must match the annotations' own
 * `scoreId`, since a mismatch would silently file one piece's edits under
 * another's id.
 */
export function isValidAnnotations(value: unknown): value is PersistedAnnotations {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.byScoreId !== 'object' || v.byScoreId === null) return false
  return Object.entries(v.byScoreId as Record<string, unknown>).every(([scoreId, entry]) => {
    const parsed = validateAnnotations(entry)
    return parsed.ok && parsed.value.scoreId === scoreId
  })
}

export function isValidMeasureScore(value: unknown): value is MeasureScore {
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

export function isValidAssessmentCounts(value: unknown): value is AssessmentResult['counts'] {
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

export function isValidAssessmentResult(value: unknown): value is AssessmentResult {
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

export function isValidStoredAssessment(value: unknown): value is StoredAssessment {
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

export function isValidAssessments(value: unknown): value is PersistedAssessments {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.assessments) && v.assessments.every(isValidStoredAssessment)
}

export function isValidMidiEvent(value: unknown): value is MidiEvent {
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

export function isValidRecording(value: unknown): value is Recording {
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

export function isValidRecordings(value: unknown): value is PersistedRecordings {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.recordings) && v.recordings.every(isValidRecording)
}

export function isValidActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value)
}

export function isValidPracticeEntry(value: unknown): value is PracticeEntry {
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

export function isValidPracticeLog(value: unknown): value is PersistedPracticeLog {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.practiceEntries) && v.practiceEntries.every(isValidPracticeEntry)
}

export function isValidTechniqueAttempt(value: unknown): value is TechniqueAttempt {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.drillId === 'string' &&
    typeof a.at === 'number' &&
    Number.isFinite(a.at) &&
    typeof a.bpm === 'number' &&
    Number.isFinite(a.bpm) &&
    typeof a.evenness === 'number' &&
    Number.isFinite(a.evenness) &&
    typeof a.accuracy === 'number' &&
    Number.isFinite(a.accuracy) &&
    typeof a.clean === 'boolean'
  )
}

export function isValidTechniqueHistory(value: unknown): value is PersistedTechniqueHistory {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.attempts) && v.attempts.every(isValidTechniqueAttempt)
}

export function isValidRepertoirePiece(value: unknown): value is RepertoirePiece {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.level === 'number' &&
    Number.isFinite(p.level) &&
    typeof p.status === 'string' &&
    (REPERTOIRE_STATUSES as readonly string[]).includes(p.status) &&
    Array.isArray(p.sessions) &&
    typeof p.bestAccuracy === 'number' &&
    Number.isFinite(p.bestAccuracy) &&
    typeof p.notes === 'string'
  )
}

export function isValidRepertoire(value: unknown): value is PersistedRepertoire {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.pieces) && v.pieces.every(isValidRepertoirePiece)
}

/**
 * Every `Track` must have an integer level within `MIN_LEVEL..MAX_LEVEL` and a
 * boolean `overridden` flag — no missing track, no extra track, no
 * out-of-range or fractional level.
 */
function isValidLevels(value: unknown): value is Readonly<Record<Track, number>> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== TRACKS.length) return false
  return TRACKS.every((track) => {
    const level = v[track]
    return (
      typeof level === 'number' &&
      Number.isInteger(level) &&
      level >= MIN_TRACK_LEVEL &&
      level <= MAX_TRACK_LEVEL
    )
  })
}

function isValidOverridden(value: unknown): value is Readonly<Record<Track, boolean>> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== TRACKS.length) return false
  return TRACKS.every((track) => typeof v[track] === 'boolean')
}

export function isValidLevelState(value: unknown): value is PersistedLevelState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.levelState !== 'object' || v.levelState === null) return false
  const levelState = v.levelState as Record<string, unknown>
  return isValidLevels(levelState.levels) && isValidOverridden(levelState.overridden)
}

/** `theme` must be exactly one of the three preference values — no other string, no missing field. */
export function isValidTheme(value: unknown): value is PersistedTheme {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.theme === 'system' || v.theme === 'dark' || v.theme === 'light'
}

/**
 * Exhaustive over `EarItemKind`, the same trick `@core/eartraining/session.ts`
 * uses for its own private `KIND_SET`: adding a kind without adding it here is
 * a compile error, unlike a hand-maintained array literal typed as
 * `readonly EarItemKind[]`.
 */
const EAR_ITEM_KIND_SET: Record<EarItemKind, true> = {
  'interval-melodic': true,
  'interval-harmonic': true,
  'chord-quality': true,
  'scale-mode': true,
  'melodic-dictation': true,
  'rhythmic-dictation': true,
}
const EAR_ITEM_KINDS = Object.keys(EAR_ITEM_KIND_SET) as readonly EarItemKind[]

function isEarItemKind(value: unknown): value is EarItemKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EAR_ITEM_KIND_SET, value)
}

/** Every `EarItemKind` must have an INTEGER level within `EAR_MIN_LEVEL..EAR_MAX_LEVEL` — no missing kind, no extra kind, no fractional level (e.g. `2.5`). */
function isValidEarLevels(value: unknown): value is Readonly<Record<EarItemKind, number>> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== EAR_ITEM_KINDS.length) return false
  return EAR_ITEM_KINDS.every((kind) => {
    const level = v[kind]
    return (
      typeof level === 'number' && Number.isInteger(level) && level >= EAR_MIN_LEVEL && level <= EAR_MAX_LEVEL
    )
  })
}

/**
 * Accepts BOTH shapes an `EarAttempt` has ever been persisted in (roadmap
 * 3.26): the current `{ accuracy: number }` shape, and a pre-3.26 record —
 * `{ correct: boolean }`, no `accuracy` at all — that real users have
 * sitting in IndexedDB right now. Rejecting the old shape here would
 * silently wipe a learner's whole ear-training history on the very next
 * load, exactly the failure mode `isValidEarSession`'s own doc warns about
 * for a missing `kinds` entry.
 *
 * `restoreSlice` (`persistence.ts`) takes this predicate's own `value`
 * argument as the restored data VERBATIM once this returns `true` (see its
 * doc comment: `raw = value`) — a boolean type guard has no way to hand back
 * a *different*, migrated object, and changing that signature is out of this
 * file's scope. So the migration happens as a side effect of validating: an
 * old record is normalised IN PLACE — `accuracy` written on to it, the
 * now-superseded `correct` dropped — before this returns `true`. That is a
 * deliberate, one-off exception to this file's "a validator never mutates"
 * rule (see the module doc); there is no other seam available to migrate
 * persisted data without touching `persistence.ts`.
 *
 * Mutating a value that ends up REJECTED (e.g. `isValidEarSession` fails a
 * later check on `cards`/`kinds`) is safe only because the sole production
 * `Store` (`createIdbStore`, see `App.tsx`) returns a fresh
 * `structuredClone()` from `get` — the mutation never reaches the persisted
 * record. A non-cloning store (e.g. a bare in-memory fake) would have its
 * stored payload corrupted by a validator that ultimately returns `false`.
 */
function isValidEarAttempt(value: unknown): value is EarAttempt {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  if (typeof a.itemId !== 'string') return false
  if (!isEarItemKind(a.kind)) return false
  if (typeof a.at !== 'number' || !Number.isFinite(a.at)) return false
  if (typeof a.level !== 'number' || !Number.isFinite(a.level)) return false

  if (typeof a.accuracy === 'number' && Number.isFinite(a.accuracy) && a.accuracy >= 0 && a.accuracy <= 1) {
    return true
  }
  if (typeof a.correct === 'boolean') {
    a.accuracy = a.correct ? 1 : 0
    delete a.correct
    return true
  }
  return false
}

/** `kinds` is the authoritative itemId -> kind map — any key is a valid id, but every value must be a real `EarItemKind`. */
function isValidEarKinds(value: unknown): value is Readonly<Record<string, EarItemKind>> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value as Record<string, unknown>).every(isEarItemKind)
}

/**
 * `cards` and `kinds` are cross-checked, not validated independently: every
 * card's id must have an entry in `kinds`, the authoritative itemId -> kind
 * map (`@core/eartraining/session.ts`'s own module comment names this exact
 * failure mode). A session accepted without this check lets a card with no
 * `kinds` entry through, and `nextDueItemId` then throws an `InvariantError`
 * on every single Start — forever, because the bad record stays in IndexedDB.
 */
function isValidEarSession(value: unknown): value is EarSessionState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isValidEarLevels(v.levels)) return false
  if (!Array.isArray(v.attempts) || !v.attempts.every(isValidEarAttempt)) return false
  if (!Array.isArray(v.cards) || !v.cards.every(isValidCard)) return false
  if (!isValidEarKinds(v.kinds)) return false
  const kinds = v.kinds as Readonly<Record<string, EarItemKind>>
  return (v.cards as readonly Card[]).every((card) => Object.hasOwn(kinds, card.id))
}

function isValidEarItem(value: unknown): value is EarItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    isEarItemKind(item.kind) &&
    isValidScore(item.prompt) &&
    typeof item.answerKey === 'string' &&
    typeof item.level === 'number' &&
    Number.isFinite(item.level)
  )
}

/**
 * The only thing standing between a corrupt IndexedDB record and a crash at
 * startup (see `persistence.ts`'s `restoreSlice`, which never throws but also
 * never applies a payload this rejects). Checks every level of STRUCTURE — a
 * missing `session`, a non-object `itemsById`, an item missing
 * `prompt`/`id`/`level`, a level that is not a finite number, or an
 * `itemsById` entry whose key does not match the item's own `id`, all reject
 * the whole payload — but NOT every level of CONTENT: an item's `prompt` is
 * checked by `isValidScore`, which (see that function's own doc comment) is
 * structural-only and never validates individual note/measure/tempo/staff
 * entries, so e.g. a `prompt.notes` of `[null, 42]` still passes here. The
 * caller falls back to `emptyEarSession()` / `{}` on outright rejection,
 * never a half-applied state.
 */
export function isValidEarTraining(value: unknown): value is PersistedEarTraining {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isValidEarSession(v.session)) return false
  if (typeof v.itemsById !== 'object' || v.itemsById === null || Array.isArray(v.itemsById)) return false
  return Object.entries(v.itemsById as Record<string, unknown>).every(
    ([id, item]) => isValidEarItem(item) && item.id === id,
  )
}
