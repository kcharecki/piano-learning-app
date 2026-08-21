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
import { isDrumPad } from '@core/drums/model/pad.ts'
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import type { PadResult } from '@core/drums/practice/grooveGrader.ts'
import { REPERTOIRE_STATUSES, type RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { MAX_LEVEL as MAX_TRACK_LEVEL, MIN_LEVEL as MIN_TRACK_LEVEL, TRACKS } from '@core/curriculum/types.ts'
import type { Track } from '@core/curriculum/types.ts'
import type { LevelState } from '@core/progress/levels.ts'
import type { PracticeSettings } from '@app/state/scoreStore.ts'
import type { StoredAssessment } from '@app/state/progressStore.ts'
import type { ThemePreference } from '@app/state/themeStore.ts'
import type { Instrument } from '@app/shell/route.ts'

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

/**
 * Graded groove runs (roadmap DR-09) — see `drumsHistoryStore.ts`. Stored
 * under `COLLECTIONS.settings` with its own key rather than a new object
 * store, the same way the level, theme, ear-training and instrument slices
 * are: a new key in a store that already exists needs no IndexedDB version
 * bump (see `persistence.ts`'s module comment).
 */
export type PersistedDrumsHistory = {
  readonly attempts: readonly DrumsGrooveAttempt[]
}

export type PersistedLevelState = {
  readonly levelState: LevelState
}

/** The learner's theme choice (roadmap UI-05) — see `themeStore.ts`'s module comment. */
export type PersistedTheme = {
  readonly theme: ThemePreference
}

/** The learner's last-used instrument (DR-01) — see `instrumentStore.ts`'s module comment. */
export type PersistedInstrument = {
  readonly lastInstrument: Instrument
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A number that may legitimately be absent — an offset for a pad that matched nothing. */
function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value)
}

export function isValidPadResult(value: unknown): value is PadResult {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.pad === 'string' &&
    isDrumPad(p.pad) &&
    isFiniteNumber(p.expected) &&
    isFiniteNumber(p.matched) &&
    isFiniteNumber(p.missed) &&
    isFiniteNumber(p.extra) &&
    isOptionalFiniteNumber(p.meanOffsetMs) &&
    isOptionalFiniteNumber(p.worstOffsetMs) &&
    isOptionalFiniteNumber(p.spreadMs) &&
    typeof p.steady === 'boolean'
  )
}

/**
 * No migration for the `clean` -> `steady` rename: `drumsHistory` was first written this
 * same release cycle with zero recorded events, so no stored run in the world carries the
 * old key. A record still in the previous shape is therefore correctly rejected as
 * malformed, not migrated.
 */
export function isValidDrumsGrooveAttempt(value: unknown): value is DrumsGrooveAttempt {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.grooveId === 'string' &&
    typeof a.grooveTitle === 'string' &&
    isFiniteNumber(a.bpm) &&
    isFiniteNumber(a.repeats) &&
    isFiniteNumber(a.at) &&
    typeof a.steady === 'boolean' &&
    Array.isArray(a.pads) &&
    a.pads.every(isValidPadResult)
  )
}

export function isValidDrumsHistory(value: unknown): value is PersistedDrumsHistory {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.attempts) && v.attempts.every(isValidDrumsGrooveAttempt)
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

/** `lastInstrument` must be exactly one of the two instruments — no other string, no missing field. */
export function isValidInstrument(value: unknown): value is PersistedInstrument {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.lastInstrument === 'piano' || v.lastInstrument === 'drums'
}
