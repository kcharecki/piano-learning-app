/**
 * The impure edge of progress export/import (roadmap 4.6a, REQ-3.10.4/4.3):
 * gathers a `ProgressSnapshot` (`@core/progress/export.ts`) out of the app's
 * zustand stores, and applies a restored one back into them. `ExportPanel`
 * calls these two functions and never reads or writes a store directly, so
 * the store read/write — the actual impure part — lives here, not in the
 * component.
 *
 * ## What is, and is not, in the snapshot today
 *
 * `ProgressSnapshot`'s shape is a fixed contract owned by `@core/progress/export.ts`
 * (not this file) and only covers stores that exist:
 *  - `practiceEntries` — `useProgressStore().practiceEntries`, exactly (the
 *    core `PracticeEntry` type is what that store already holds).
 *  - `srsCards` — `useFlashcardStore().cardsById`, flattened to an array.
 *  - `sightReadingHistory` — `useSightReadingStore().history`, exactly.
 *  - `levels` — only `'sight-reading'` has a real persisted level anywhere in
 *    the app (`useSightReadingStore().level`); `playing` and `theory` have no
 *    `LevelState` store yet (see `useDashboard.ts`'s module comment for the
 *    same gap), so this snapshot cannot honestly report them and does not
 *    invent a value for either.
 *  - `repertoire` — `useRepertoireStore().pieces` (roadmap 4.5), projected
 *    through `RepertoirePieceLike`. This comment used to claim no such store
 *    existed (matching a now-stale claim in `useDashboard.ts`'s module
 *    comment) — that has been false since roadmap 4.5 landed
 *    `useRepertoireStore`. UNLIKE `assessments` below, this projection is now
 *    LOSSLESS (roadmap 4.10, REQ-3.10.4/4.3): `RepertoirePieceLike` was
 *    widened to carry `level`/`sessions`/`bestAccuracy`/`notes`/`scoreId`
 *    too, after the narrower version was found to silently destroy a piece's
 *    practice history on restore — see `docs/m4-acceptance-2026-08-12.md`
 *    Defect 2 and `@core/progress/export.ts`'s module comment. The one
 *    remaining fabrication: an unrecognised `status` string (a hand-edited
 *    file) falls back to `'learning'` rather than crashing, and an
 *    out-of-range restored `level` is clamped to `MIN_LEVEL..MAX_LEVEL`
 *    exactly like the sight-reading level below, rather than trusted as-is
 *    from an untrusted file.
 *  - `assessments` — `useProgressStore().assessments`, projected through
 *    `StoredAssessmentLike`. This projection is LOSSY: `StoredAssessmentLike`
 *    keeps only `id`/`at`/`accuracy`/`kind`/`itemId` (the export module's own
 *    structural minimum), so a restored `StoredAssessment`'s `result` is a
 *    reconstruction carrying just the recovered `accuracy` — timing
 *    consistency, per-measure breakdown and tempo are NOT preserved by this
 *    export format. `scoreTitle`/`scoreId` round-trip via `kind`/`itemId`.
 *  - `techniqueAttempts` — `useTechniqueStore().attempts` (roadmap 4.4b,
 *    REQ-3.7.2/3.7.3), exactly. This IS a first-class, required field of
 *    `@core/progress/export.ts`'s own `ProgressSnapshot` type, so it round-trips
 *    through a real exported JSON file exactly like every other collection:
 *    `exportJson` writes it and `importProgress` restores it, including for a
 *    file exported before this field existed (`importProgress` defaults a
 *    missing `techniqueAttempts` to `[]` — see that module's doc comment).
 *  - `earTraining` — `useEarTrainingStore()`'s `session` + `itemsById`
 *    (roadmap 3.11, REQ-3.6.3). This IS a first-class field of
 *    `@core/progress/export.ts`'s own `ProgressSnapshot` type (it used to be
 *    widened onto a LOCAL `ProgressSnapshotWithEarTraining` type here, which
 *    never actually round-tripped through a real `exportJson`/`importProgress`
 *    file — that workaround is gone). `gatherProgressSnapshot` always sets it
 *    from the live store, so it exactly round-trips through a real downloaded-
 *    then-reimported file exactly like `techniqueAttempts`, EXCEPT for one
 *    deliberate difference: unlike every other field, `ProgressSnapshot.earTraining`
 *    is OPTIONAL, and `importProgress` leaves it genuinely absent (not
 *    defaulted to an empty session) when the source file predates the field —
 *    see that type's own doc comment for why. `applyProgressSnapshot` below
 *    honours that: an absent `earTraining` means "leave the store alone", not
 *    "wipe it to empty", because unlike an empty attempt array, an emptied
 *    ear-training session actively destroys adapted levels, SRS cards and
 *    attempt history that a REPLACING import must not touch when the backup
 *    file simply has nothing to say about it.
 */
import {
  useProgressStore,
  MAX_STORED_ASSESSMENTS,
  MAX_STORED_PRACTICE_ENTRIES,
  type StoredAssessment,
} from '@app/state/progressStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useTechniqueStore, MAX_STORED_TECHNIQUE_ATTEMPTS } from '@app/state/techniqueStore.ts'
import { useRepertoireStore, MAX_STORED_REPERTOIRE_PIECES } from '@app/state/repertoireStore.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import {
  MIN_LEVEL as SIGHT_READING_MIN_LEVEL,
  MAX_LEVEL as SIGHT_READING_MAX_LEVEL,
} from '@core/sightreading/adaptive.ts'
import {
  MIN_LEVEL as REPERTOIRE_MIN_LEVEL,
  MAX_LEVEL as REPERTOIRE_MAX_LEVEL,
} from '@core/curriculum/types.ts'
import {
  REPERTOIRE_STATUSES,
  type RepertoirePiece,
  type RepertoireSession,
  type RepertoireStatus,
} from '@core/repertoire/repertoire.ts'
import type { DateSource } from '@core/ports/index.ts'
import type {
  ProgressSnapshot,
  RepertoirePieceLike,
  RepertoireSessionLike,
  StoredAssessmentLike,
} from '@core/progress/export.ts'

/**
 * The only track key `levels` carries today — see the module comment. Named
 * distinctly from the `Track` key `'sight-reading'` in `@core/curriculum/types.ts`
 * so a future `LevelState` restore can never mistake this generator-difficulty
 * number for a curriculum track level.
 */
export const SIGHT_READING_LEVEL_KEY = 'sight-reading-exercise'

function isRepertoireStatus(value: string): value is RepertoireStatus {
  return (REPERTOIRE_STATUSES as readonly string[]).includes(value)
}

function toRepertoireSessionLike(session: RepertoireSession): RepertoireSessionLike {
  return {
    at: session.at,
    minutes: session.minutes,
    ...(session.accuracy === undefined ? {} : { accuracy: session.accuracy }),
    ...(session.tempoBpm === undefined ? {} : { tempoBpm: session.tempoBpm }),
  }
}

function toRepertoirePieceLike(piece: RepertoirePiece): RepertoirePieceLike {
  return {
    id: piece.id,
    title: piece.title,
    composer: piece.composer,
    status: piece.status,
    level: piece.level,
    sessions: piece.sessions.map(toRepertoireSessionLike),
    bestAccuracy: piece.bestAccuracy,
    notes: piece.notes,
    ...(piece.scoreId === undefined ? {} : { scoreId: piece.scoreId }),
  }
}

/** Clamp a restored level into the curriculum's valid range, mirroring the
 *  sight-reading level clamp below — an untrusted file's `level` is trusted
 *  for its VALUE but not its RANGE. */
function clampLevel(level: number): number {
  return Math.min(REPERTOIRE_MAX_LEVEL, Math.max(REPERTOIRE_MIN_LEVEL, Math.round(level)))
}

function toRepertoireSession(like: RepertoireSessionLike): RepertoireSession {
  return {
    at: like.at,
    minutes: like.minutes,
    ...(like.accuracy === undefined ? {} : { accuracy: like.accuracy }),
    ...(like.tempoBpm === undefined ? {} : { tempoBpm: like.tempoBpm }),
  }
}

/**
 * Reconstructs a `RepertoirePiece` from a snapshot's `RepertoirePieceLike`.
 * Since roadmap 4.10, this is lossless for every field a file THIS app wrote
 * carries — `level`/`sessions`/`bestAccuracy`/`notes`/`scoreId` all round
 * trip. Only two things are still not the source-of-truth value verbatim:
 * an unrecognised `status` string falls back to `'learning'` (a hand-edited
 * file), and `level` is clamped into range (see `clampLevel`) rather than
 * trusted as-is. A genuinely OLDER export (written before this widening)
 * simply has these fields absent, so every `?? default` below is what makes
 * that file still import cleanly instead of crashing.
 */
function toRepertoirePiece(like: RepertoirePieceLike): RepertoirePiece {
  const status: RepertoireStatus =
    like.status !== undefined && isRepertoireStatus(like.status) ? like.status : 'learning'
  return {
    id: like.id,
    title: like.title,
    composer: like.composer ?? '',
    level: like.level === undefined ? REPERTOIRE_MIN_LEVEL : clampLevel(like.level),
    status,
    sessions: (like.sessions ?? []).map(toRepertoireSession),
    bestAccuracy: like.bestAccuracy === undefined ? 0 : Math.min(1, Math.max(0, like.bestAccuracy)),
    notes: like.notes ?? '',
    ...(like.scoreId === undefined ? {} : { scoreId: like.scoreId }),
  }
}

function toStoredAssessmentLike(assessment: StoredAssessment): StoredAssessmentLike {
  return {
    id: assessment.id,
    at: assessment.at,
    accuracy: assessment.result.accuracy,
    kind: assessment.scoreTitle,
    itemId: assessment.scoreId,
  }
}

/**
 * Reconstructs a `StoredAssessment` from the structural minimum a snapshot
 * carries. `result` is fabricated around the one number that survived
 * (`accuracy`) — see the module comment on why the rest cannot be recovered.
 */
function toStoredAssessment(like: StoredAssessmentLike): StoredAssessment {
  const scoreId = like.itemId ?? like.id
  return {
    id: like.id,
    scoreId,
    scoreTitle: like.kind ?? scoreId,
    at: like.at,
    result: {
      scoreId,
      accuracy: like.accuracy,
      timingConsistency: 0,
      meanAbsDeviationMs: 0,
      tempoBpm: 0,
      measures: [],
      counts: { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
      completedAt: like.at,
    },
  }
}

/** Gathers everything the app currently persists into one `ProgressSnapshot`. */
export function gatherProgressSnapshot(date: DateSource): ProgressSnapshot {
  const progress = useProgressStore.getState()
  const flashcards = useFlashcardStore.getState()
  const sightReading = useSightReadingStore.getState()
  const technique = useTechniqueStore.getState()
  const repertoire = useRepertoireStore.getState()
  const earTraining = useEarTrainingStore.getState()

  return {
    version: 1,
    exportedAt: date.epochMillis(),
    practiceEntries: progress.practiceEntries,
    srsCards: Object.values(flashcards.cardsById),
    sightReadingHistory: sightReading.history,
    levels: { [SIGHT_READING_LEVEL_KEY]: sightReading.level },
    repertoire: repertoire.pieces.map(toRepertoirePieceLike),
    assessments: progress.assessments.map(toStoredAssessmentLike),
    techniqueAttempts: technique.attempts,
    earTraining: { session: earTraining.session, itemsById: earTraining.itemsById },
  }
}

/**
 * Applies a restored `ProgressSnapshot` back into every store that has one —
 * REPLACING their current contents, not merging. The caller (`ExportPanel`)
 * is responsible for confirming this with the learner first.
 */
export function applyProgressSnapshot(snapshot: ProgressSnapshot): void {
  useProgressStore.getState().hydrate({
    practiceEntries: snapshot.practiceEntries.slice(0, MAX_STORED_PRACTICE_ENTRIES),
    assessments: snapshot.assessments.map(toStoredAssessment).slice(0, MAX_STORED_ASSESSMENTS),
  })

  useFlashcardStore
    .getState()
    .hydrate(Object.fromEntries(snapshot.srsCards.map((card) => [card.id, card])))

  const rawLevel = snapshot.levels[SIGHT_READING_LEVEL_KEY] ?? SIGHT_READING_MIN_LEVEL
  const restoredLevel = Math.min(
    SIGHT_READING_MAX_LEVEL,
    Math.max(SIGHT_READING_MIN_LEVEL, Math.round(rawLevel)),
  )
  useSightReadingStore.getState().hydrate(restoredLevel, snapshot.sightReadingHistory)

  useTechniqueStore.getState().hydrate({
    attempts: snapshot.techniqueAttempts.slice(0, MAX_STORED_TECHNIQUE_ATTEMPTS),
  })

  useRepertoireStore.getState().hydrate({
    pieces: snapshot.repertoire.map(toRepertoirePiece).slice(0, MAX_STORED_REPERTOIRE_PIECES),
  })

  // Unlike every store above, this is NOT an unconditional replace:
  // `snapshot.earTraining` is only ever absent when `snapshot` came from an
  // older exported file that predates the field (see `ProgressSnapshot.earTraining`'s
  // doc comment in `@core/progress/export.ts`) — and an old backup having
  // nothing to say about ear training must leave the learner's current
  // adapted levels, SRS cards and attempt log alone, not wipe them to an
  // empty session.
  const earTraining = snapshot.earTraining
  if (earTraining !== undefined) {
    useEarTrainingStore.getState().hydrate(earTraining.session, earTraining.itemsById)
  }
}
