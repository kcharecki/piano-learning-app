/**
 * Repertoire library: statuses, practice history and maintenance prompts
 * (roadmap 4.5, REQ-3.8.2 / REQ-3.8.3 / REQ-3.8.4).
 *
 * The actual graded piece list (REQ-3.8.1) is content and lands separately
 * (roadmap 4.9); this module only models what a piece IN that list carries:
 * its status, its practice sessions and its best-ever accuracy.
 *
 * Everything here is pure: every function returns a new array, and never
 * mutates its inputs — see the co-located tests for non-mutation proofs.
 */
import { DAY_MS } from '@core/srs/scheduler.ts'
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { invariant } from '@core/shared/invariant.ts'
import type { PracticeEntry } from '@core/progress/log.ts'

/** REQ-3.8.2's four statuses, in their natural progression. */
export type RepertoireStatus = 'learning' | 'polishing' | 'performance-ready' | 'maintained'

/**
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32. No store persists a `RepertoirePiece`
 * list anywhere in the app (`snapshot.ts` hardcodes `repertoire: []`,
 * `useDashboard.ts` hardcodes `repertoirePieces: []`) — a whole domain module
 * (statuses, practice history, maintenance prompts) with no screen wired to
 * it, not dead code. Sibling of `addPiece`/`setStatus`/`recordSession`/
 * `setNotes`/`maintenanceDue`/`sessionFromEntry` below, all in the same boat.
 */
export const REPERTOIRE_STATUSES: readonly RepertoireStatus[] = [
  'learning',
  'polishing',
  'performance-ready',
  'maintained',
]

export type RepertoireSession = {
  /** Epoch ms, supplied by the caller. */
  readonly at: number
  readonly minutes: number
  /** Best assessment accuracy in that session, 0..1, when one was run. */
  readonly accuracy?: number
  /** Tempo achieved during the session, in BPM — same unit as `PracticeEntry.tempoBpm`. */
  readonly tempoBpm?: number
}

/**
 * Build a `RepertoireSession` from the `PracticeEntry` the practice-timer
 * path (`src/app/practice/usePracticeLog.ts`) already logs, so a maintained
 * piece's practice history has exactly one writer: the timer's stop(), which
 * both appends the `PracticeEntry` and calls `recordSession` with the result
 * of this adapter. Never construct a `RepertoireSession` from a second,
 * independent record of the same practice session.
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32. `usePracticeLog.ts`'s `stop()` does not
 * actually call `recordSession` with this adapter's result today (checked:
 * no reference to `repertoire`/`recordSession` anywhere in that file) — the
 * doc comment above describes the intended wiring, not the current state.
 */
export function sessionFromEntry(entry: PracticeEntry): RepertoireSession {
  const minutes = (entry.endedAt - entry.startedAt) / 60_000
  return {
    at: entry.startedAt,
    minutes,
    ...(entry.accuracy === undefined ? {} : { accuracy: entry.accuracy }),
    ...(entry.tempoBpm === undefined ? {} : { tempoBpm: entry.tempoBpm }),
  }
}

export type RepertoirePiece = {
  readonly id: string
  readonly title: string
  readonly composer: string
  /** 1..5. Manually assignable for an imported score (REQ-3.8.3). */
  readonly level: number
  readonly status: RepertoireStatus
  /** The imported score's id, when this piece came from an import (REQ-3.8.3). */
  readonly scoreId?: string
  readonly sessions: readonly RepertoireSession[]
  /** Best assessment accuracy ever recorded for this piece, 0..1 (REQ-3.8.2). */
  readonly bestAccuracy: number
  readonly notes: string
}

/** Fields the caller supplies when adding a piece; the rest default to a fresh piece's state. */
export type NewPieceInput = {
  readonly id: string
  readonly title: string
  readonly composer: string
  readonly level: number
  readonly scoreId?: string
}

/**
 * Add a piece to the library. Errs on a duplicate id, an empty (or
 * whitespace-only) title, or a level outside 1..5. `composer` is otherwise
 * unchecked — REQ-3.8.3 lets the learner assign the level manually, and
 * nothing here second-guesses the rest of an imported score's metadata.
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32 (see `REPERTOIRE_STATUSES`'s note).
 */
export function addPiece(
  pieces: readonly RepertoirePiece[],
  piece: NewPieceInput,
): Result<readonly RepertoirePiece[], string> {
  if (pieces.some((p) => p.id === piece.id)) {
    return err(`addPiece: duplicate id "${piece.id}"`)
  }
  if (piece.title.trim().length === 0) {
    return err('addPiece: title must not be blank')
  }
  if (!Number.isInteger(piece.level) || piece.level < MIN_LEVEL || piece.level > MAX_LEVEL) {
    return err(
      `addPiece: level must be an integer ${MIN_LEVEL}..${MAX_LEVEL}, got ${piece.level}`,
    )
  }
  const newPiece: RepertoirePiece = {
    id: piece.id,
    title: piece.title,
    composer: piece.composer,
    level: piece.level,
    status: 'learning',
    ...(piece.scoreId === undefined ? {} : { scoreId: piece.scoreId }),
    sessions: [],
    bestAccuracy: 0,
    notes: '',
  }
  return ok([...pieces, newPiece])
}

/**
 * Replace the status of the piece with the given id. Status changes are free-form: a learner may move a piece back to 'learning'.
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32 (see `REPERTOIRE_STATUSES`'s note).
 */
export function setStatus(
  pieces: readonly RepertoirePiece[],
  id: string,
  status: RepertoireStatus,
): readonly RepertoirePiece[] {
  return pieces.map((p) => (p.id === id ? { ...p, status } : p))
}

/**
 * Append a practice session; updates `bestAccuracy` if the new session beat
 * it. Pure. Throws if `id` does not match a piece in the library — an unknown
 * id here means a stale caller reference, and silently dropping the session
 * would leave maintenance prompts firing with no signal anywhere.
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32 (see `REPERTOIRE_STATUSES`'s note).
 */
export function recordSession(
  pieces: readonly RepertoirePiece[],
  id: string,
  session: RepertoireSession,
): readonly RepertoirePiece[] {
  invariant(
    pieces.some((p) => p.id === id),
    `recordSession: unknown piece id "${id}"`,
  )
  return pieces.map((p) => {
    if (p.id !== id) return p
    const bestAccuracy =
      session.accuracy !== undefined && session.accuracy > p.bestAccuracy
        ? session.accuracy
        : p.bestAccuracy
    return { ...p, sessions: [...p.sessions, session], bestAccuracy }
  })
}

/**
 * Replace the free-text notes for the piece with the given id.
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32 (see `REPERTOIRE_STATUSES`'s note).
 */
export function setNotes(
  pieces: readonly RepertoirePiece[],
  id: string,
  notes: string,
): readonly RepertoirePiece[] {
  return pieces.map((p) => (p.id === id ? { ...p, notes } : p))
}

/** Days since the last recorded session, or `null` if never practised. */
export function daysSincePractice(piece: RepertoirePiece, now: number): number | null {
  if (piece.sessions.length === 0) return null
  const lastAt = Math.max(...piece.sessions.map((s) => s.at))
  return (now - lastAt) / DAY_MS
}

export type MaintenanceOptions = {
  /** Days after which a 'maintained' piece is due for review. Default 21. */
  readonly intervalDays?: number
}

const DEFAULT_MAINTENANCE_INTERVAL_DAYS = 21

/**
 * REQ-3.8.4: which 'maintained' pieces are due for review, most overdue
 * first. A piece never practised is due immediately, and sorts ahead of any
 * practised piece (it has no bound on how overdue it is).
 * @public — roadmap 4.5's consumer screen doesn't call this yet; see the
 * roadmap triage note added for 2.32 (see `REPERTOIRE_STATUSES`'s note).
 */
export function maintenanceDue(
  pieces: readonly RepertoirePiece[],
  now: number,
  opts: MaintenanceOptions = {},
): readonly RepertoirePiece[] {
  const intervalDays = opts.intervalDays ?? DEFAULT_MAINTENANCE_INTERVAL_DAYS
  return pieces
    .filter((p) => p.status === 'maintained')
    .map((p) => ({ piece: p, since: daysSincePractice(p, now) }))
    .filter((x) => x.since === null || x.since - intervalDays >= 0)
    .sort((a, b) => {
      if (a.since === null) return b.since === null ? 0 : -1
      if (b.since === null) return 1
      return b.since - a.since
    })
    .map((x) => x.piece)
}
