/**
 * The sight-reading trainer's session state machine (roadmap 2.5, REQ-3.4.1,
 * REQ-3.4.3, REQ-3.4.4).
 *
 * ## The discipline is the whole point
 *
 * A sight-reading exercise is not "practice until it's right" — it is closer
 * to a driving test: look at the piece once, then go, and whatever happens
 * happens. `SightReadingSession` encodes that discipline as a small state
 * machine so nothing above it can accidentally cheat:
 *
 * ```
 * idle --beginPreview()--> preview --beginPlaying() / update()--> playing --finish()--> finished
 * ```
 *
 * - **idle → preview** only through `beginPreview()`, which starts the
 *   REQ-3.4.4 scan window (`previewMs`, defaulting to 30 000 — 30s).
 * - **preview → playing** either early, by the player calling `beginPlaying()`
 *   themselves ("I've seen enough"), or automatically, when `update()` —
 *   pumped every frame by the transport — notices the preview clock has run
 *   out.
 * - **There is no way back.** No method returns the session to `preview`, and
 *   calling `beginPlaying()` a second time (from `playing` or `finished`) is a
 *   programmer error, not a silent no-op: the whole point of the discipline is
 *   that a stumble cannot buy a second look at the score.
 * - **playing → finished** only through `finish()`, which stamps the result
 *   with the clock's read time and hands back the record for the retirement
 *   pool below.
 *
 * `previewRemainingMs` is derived from the `Clock` on every read, never
 * stored as a decrementing counter, so it is always exactly consistent with
 * whatever `update()` would decide right now.
 *
 * The level a piece was drawn at (`adaptive.ts`'s job) is supplied at
 * construction, alongside the score — it is a fact about how this attempt was
 * set up, not something `finish()` could derive from the score or the
 * assessment result, so it rides along on `SightReadingRecord` unchanged.
 *
 * ## Retirement (REQ-3.4.3)
 *
 * Once read, a piece must never be offered again. That is deliberately *not*
 * a property of the session (which only knows about the one piece it was
 * built for) — it is a pure function over the caller's stored history, so the
 * generator's picker (`adaptive.ts`) can consult it before ever building a
 * score. `retire` is append-only and never mutates its input, matching every
 * other history list in this codebase.
 */
import type { Clock } from '@core/ports/clock.ts'
import type { AssessmentResult } from '@core/practice/assessment.ts'
import type { Score } from '@core/notation/score.ts'
import { invariant } from '@core/shared/invariant.ts'

export type SightReadingPhase = 'idle' | 'preview' | 'playing' | 'finished'

export type SightReadingRecord = {
  readonly pieceId: string
  /** Epoch/clock ms `finish()` was called, from the session's `Clock`. */
  readonly readAt: number
  readonly accuracy: number
  /** The sight-reading level the piece was drawn at — see `adaptive.ts`. */
  readonly level: number
}

export type SightReadingSessionOptions = {
  readonly score: Score
  readonly clock: Clock
  /** REQ-3.4.4's scan window, in ms. Defaults to 30 000 (30s). */
  readonly previewMs?: number
  /**
   * The sight-reading level `score` was drawn at (see `adaptive.ts`'s
   * `nextExerciseParams`), carried onto the finished record so
   * `adaptLevel` has something to adapt from. Not part of the sketch this
   * module was scoped from, but `SightReadingRecord.level` has to come from
   * somewhere, and nothing else in scope for `finish()` knows it.
   */
  readonly level: number
}

const DEFAULT_PREVIEW_MS = 30_000

export class SightReadingSession {
  private readonly score: Score
  private readonly clock: Clock
  private readonly previewMs: number
  private readonly level: number
  private _phase: SightReadingPhase = 'idle'
  private previewStartedAt: number | null = null

  constructor(opts: SightReadingSessionOptions) {
    const previewMs = opts.previewMs ?? DEFAULT_PREVIEW_MS
    invariant(
      Number.isFinite(previewMs) && previewMs >= 0,
      `SightReadingSession: previewMs must be >= 0, got ${previewMs}`,
    )
    this.score = opts.score
    this.clock = opts.clock
    this.previewMs = previewMs
    this.level = opts.level
  }

  get phase(): SightReadingPhase {
    return this._phase
  }

  /**
   * Ms left in the preview: the full `previewMs` before it has started, a
   * live countdown while it is running, and `0` once it has ended (whether
   * by timeout or by `beginPlaying()`).
   */
  get previewRemainingMs(): number {
    if (this._phase === 'idle') return this.previewMs
    if (this._phase !== 'preview') return 0
    const startedAt = this.previewStartedAt
    invariant(startedAt !== null, 'SightReadingSession: preview phase without a start time')
    const elapsed = this.clock.now() - startedAt
    return Math.max(0, this.previewMs - elapsed)
  }

  /** REQ-3.4.4: start the preview scan window. Only legal once, from `idle`. */
  beginPreview(): void {
    invariant(
      this._phase === 'idle',
      `SightReadingSession.beginPreview: phase is '${this._phase}', not 'idle'`,
    )
    this._phase = 'preview'
    this.previewStartedAt = this.clock.now()
  }

  /**
   * Move straight to playing, ending the preview early. Only legal during
   * `preview`: calling it from `idle` would skip the discipline entirely, and
   * calling it a second time (from `playing` or `finished`) is exactly the
   * "go back and look again" REQ-3.4.4 forbids — there is no path that ever
   * returns `phase` to `'preview'`.
   */
  beginPlaying(): void {
    invariant(
      this._phase === 'preview',
      `SightReadingSession.beginPlaying: phase is '${this._phase}', not 'preview'`,
    )
    this._phase = 'playing'
  }

  /**
   * Pumped regularly by the transport. Ends the preview, transitioning to
   * `playing`, the instant its timer has run out; a no-op in every other
   * phase (including before the timer expires).
   */
  update(): void {
    if (this._phase === 'preview' && this.previewRemainingMs <= 0) {
      this._phase = 'playing'
    }
  }

  /** REQ-3.4.1: the piece is played once, straight through. Only legal from `playing`. */
  finish(result: AssessmentResult): SightReadingRecord {
    invariant(
      this._phase === 'playing',
      `SightReadingSession.finish: phase is '${this._phase}', not 'playing'`,
    )
    this._phase = 'finished'
    return {
      pieceId: this.score.id,
      readAt: this.clock.now(),
      accuracy: result.accuracy,
      level: this.level,
    }
  }
}

/** REQ-3.4.3: once read, a piece is retired from the pool forever. */
export function isRetired(history: readonly SightReadingRecord[], pieceId: string): boolean {
  return history.some((record) => record.pieceId === pieceId)
}

/** `history` with `record` appended. Never mutates `history`. */
export function retire(
  history: readonly SightReadingRecord[],
  record: SightReadingRecord,
): readonly SightReadingRecord[] {
  return [...history, record]
}
