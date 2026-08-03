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
 * ## Minimal diffing
 *
 * Re-hiding a note that is already hidden (or re-revealing one already
 * visible) would still be harmless on the engraver side — `setNoteHidden` is
 * itself idempotent — but doing it on every render, for every note in every
 * measure already behind the cursor, would mean the hidden set grows to
 * "every note in the piece so far" and gets rewritten in full every time the
 * cursor advances even one measure. Instead, a `useRef<Set<string>>` tracks
 * exactly what was hidden last time, and only the ids that actually change
 * state this run get a `setNoteHidden` call — the same idea as
 * `useNoteFeedback`'s batched-render seam, just diffed here instead of there.
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

  useEffect(() => {
    const { enabled, score, scoreViewerRef, currentMeasureIndex } = optionsRef.current
    const handle = scoreViewerRef.current

    if (!enabled || score === undefined) {
      if (hiddenRef.current.size > 0) {
        handle?.clearHiddenNotes()
        hiddenRef.current = new Set()
      }
      return
    }

    const nextHidden = idsHiddenBefore(score, currentMeasureIndex)
    const previouslyHidden = hiddenRef.current

    for (const id of nextHidden) {
      if (!previouslyHidden.has(id)) handle?.setNoteHidden(id, true)
    }
    for (const id of previouslyHidden) {
      if (!nextHidden.has(id)) handle?.setNoteHidden(id, false)
    }

    hiddenRef.current = nextHidden
  }, [options.enabled, options.score, options.currentMeasureIndex])
}
