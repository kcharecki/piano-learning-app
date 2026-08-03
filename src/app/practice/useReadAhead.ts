/**
 * Read-ahead drill (roadmap 2.26, REQ-3.4.5): while enabled, every note
 * STRICTLY BEFORE the measure the cursor is currently at is occluded — the
 * measure the cursor is in, and everything after it, stays visible. This
 * hides the notes for hands the learner has already read ahead past,
 * forcing them to keep looking ahead of their hands rather than at the note
 * they are currently playing.
 *
 * The cursor's own current measure is deliberately excluded from hiding:
 * OSMD draws its own highlighted rectangle behind the note at the cursor's
 * position, and a hidden (background-coloured) note sitting on top of that
 * highlight renders as a clearly readable dark silhouette — worse than not
 * hiding it at all. Excluding the current measure sidesteps that collision
 * entirely rather than trying to suppress the cursor highlight.
 *
 * Occlusion itself is `ScoreEngraver`'s job (`setNoteHidden`/
 * `clearHiddenNotes`, see `osmdEngraver.ts`); this hook only decides WHICH ids
 * should be hidden right now and keeps that set in step with the cursor as
 * cheaply as possible.
 *
 * ## Incremental hiding
 *
 * The obvious implementation — rebuild the whole hidden set from measure 0
 * every time the boundary moves, then diff it against what was hidden last
 * time — was a real cost, not a hypothetical one: on a 102-measure,
 * 1603-note import (Pachelbel's Canon in D) the rebuild loops `measureIndex`
 * from `0` to `currentMeasureIndex - 1` and calls `notesInMeasure` for each,
 * so the cost of a single measure boundary crossing grows linearly with how
 * far into the piece playback has reached — near the end it walks almost the
 * whole score, on the very React commit that follows a frame with an audio
 * deadline to meet. Almost all of that work was then thrown away by the diff,
 * which only ever issues `setNoteHidden` for the handful of ids that changed
 * state.
 *
 * Instead, alongside `hiddenRef` (exactly what was hidden last time), two
 * more refs track what that set corresponds to: `boundaryRef` holds the
 * clamped measure boundary it was built up to, and `scoreRef` holds the score
 * identity it was built against. Each effect run compares the new clamped
 * boundary against `boundaryRef.current`:
 *
 * - Score identity changed, or `boundaryRef.current` is `undefined` (the hook
 *   was previously disabled/cleared, or this is the first run): fall back to
 *   the full rebuild-then-diff above. This happens once per score, not once
 *   per measure, so its cost is amortised over the whole piece.
 * - Boundary moved forward from `prev` to `next`: only measures `prev ..
 *   next - 1` are newly strictly-before the cursor, so only their notes get
 *   hidden and added to `hiddenRef`.
 * - Boundary moved backward from `prev` to `next` (e.g. a loop or seek back):
 *   only measures `next .. prev - 1` are no longer strictly-before the
 *   cursor, so only their notes get revealed and removed from `hiddenRef`.
 * - Boundary unchanged: no work at all.
 *
 * This makes the cost of a measure-boundary crossing proportional to the
 * notes in the measures actually crossed, not to every note behind the
 * cursor — the same idea as `useNoteFeedback`'s batched-render seam, applied
 * incrementally here instead of diffed in full each time.
 *
 * ## Reading the rest of `options` through a ref
 *
 * The effect below is keyed on `[enabled, score, currentMeasureIndex]` only.
 * `scoreViewerRef` is a ref already (identity never meaningfully changes) and
 * does not belong in a dependency array; the `optionsRef.current = options`
 * assignment on every render (mirroring `useNoteFeedback.ts`) is what lets the
 * effect read it without needing to be listed.
 */
import type { Score } from '@core/notation/score.ts'
import { notesInMeasure } from '@core/notation/score.ts'
import { useEffect, useRef, type RefObject } from 'react'

export type ReadAheadHandle = {
  setNoteHidden(noteId: string, hidden: boolean): void
  clearHiddenNotes(): void
}

export type UseReadAheadOptions = {
  readonly enabled: boolean
  readonly score: Score | undefined
  /**
   * 0-based index of the measure the cursor is at or inside. Notes STRICTLY
   * BEFORE this measure are hidden; this measure itself, and every later one,
   * stay visible. At `0` (resting at the first measure, before any playback)
   * nothing is hidden — there is no measure before it.
   */
  readonly currentMeasureIndex: number
  readonly scoreViewerRef: RefObject<ReadAheadHandle | null>
}

/**
 * Every note id in measures `0 .. currentMeasureIndex - 1` inclusive — i.e.
 * strictly before `currentMeasureIndex`. `currentMeasureIndex` itself is
 * never hidden (see the module comment for why). Empty when
 * `currentMeasureIndex` is `0`.
 */
function idsHiddenBefore(score: Score, currentMeasureIndex: number): Set<string> {
  const exclusiveUpper = Math.min(currentMeasureIndex, score.measures.length)
  const ids = new Set<string>()
  for (let measureIndex = 0; measureIndex < exclusiveUpper; measureIndex++) {
    for (const note of notesInMeasure(score, measureIndex)) ids.add(note.id)
  }
  return ids
}

export function useReadAhead(options: UseReadAheadOptions): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  /** Exactly what was hidden as of the last run of the effect below. */
  const hiddenRef = useRef<Set<string>>(new Set())
  /**
   * The clamped measure boundary `hiddenRef` currently corresponds to, or
   * `undefined` when `hiddenRef` isn't tracking anything — disabled,
   * `score === undefined`, or not yet run. `undefined` is what forces the
   * next real run to take the full-rebuild path instead of an incremental
   * one.
   */
  const boundaryRef = useRef<number | undefined>(undefined)
  /** The score identity `hiddenRef`/`boundaryRef` were last built against. */
  const scoreRef = useRef<Score | undefined>(undefined)

  useEffect(() => {
    const { enabled, score, scoreViewerRef, currentMeasureIndex } = optionsRef.current
    const handle = scoreViewerRef.current

    if (!enabled || score === undefined) {
      if (hiddenRef.current.size > 0) handle?.clearHiddenNotes()
      hiddenRef.current = new Set()
      boundaryRef.current = undefined
      scoreRef.current = undefined
      return
    }

    const nextBoundary = Math.min(currentMeasureIndex, score.measures.length)

    // Full rebuild: either the score changed identity (a new piece was
    // loaded) or the previous run left nothing to build on incrementally
    // (disabled/cleared, or this is the very first run). Correctness first —
    // this only happens once per score, not once per measure.
    if (score !== scoreRef.current || boundaryRef.current === undefined) {
      const nextHidden = idsHiddenBefore(score, currentMeasureIndex)
      const previouslyHidden = hiddenRef.current

      for (const id of nextHidden) {
        if (!previouslyHidden.has(id)) handle?.setNoteHidden(id, true)
      }
      for (const id of previouslyHidden) {
        if (!nextHidden.has(id)) handle?.setNoteHidden(id, false)
      }

      hiddenRef.current = nextHidden
      boundaryRef.current = nextBoundary
      scoreRef.current = score
      return
    }

    // Incremental path: only touch the measures the boundary actually
    // crossed since the last run, instead of walking every measure behind
    // the cursor again.
    const previousBoundary = boundaryRef.current
    const hidden = hiddenRef.current

    if (nextBoundary > previousBoundary) {
      for (let measureIndex = previousBoundary; measureIndex < nextBoundary; measureIndex++) {
        for (const note of notesInMeasure(score, measureIndex)) {
          handle?.setNoteHidden(note.id, true)
          hidden.add(note.id)
        }
      }
    } else if (nextBoundary < previousBoundary) {
      for (let measureIndex = nextBoundary; measureIndex < previousBoundary; measureIndex++) {
        for (const note of notesInMeasure(score, measureIndex)) {
          handle?.setNoteHidden(note.id, false)
          hidden.delete(note.id)
        }
      }
    }

    boundaryRef.current = nextBoundary
  }, [options.enabled, options.score, options.currentMeasureIndex])
}
