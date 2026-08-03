/**
 * The seam between `ScoreViewer` and OpenSheetMusicDisplay.
 *
 * OSMD is a large DOM/canvas library that cannot run in happy-dom, so every
 * component test drives `ScoreViewer` through a fake implementing this
 * contract (see `ScoreViewer.test.tsx`) instead of the real thing.
 * `osmdEngraver.ts` — the only file that imports `opensheetmusicdisplay` — is
 * the sole real implementation, so nothing else in the app depends on OSMD.
 */
import type { Score } from '@core/notation/score.ts'

export type ScoreEngraver = {
  /** Render `musicXml` into `container`. `score` is the same music, used to key note colouring. */
  load(container: HTMLElement, musicXml: string, score: Score): Promise<void>
  /** Move the position cursor to the given measure, no later than `tick` within it. */
  moveCursorTo(measureIndex: number, tick: number): void
  /** Colour a single note, keyed by `ScoreNote.id` (see `@core/notation/score.ts`). */
  setNoteColor(noteId: string, color: string): void
  /** Restore every note coloured by `setNoteColor` back to its default. */
  clearNoteColors(): void
  /**
   * Occlude (or reveal) a single note for the read-ahead drill (roadmap 2.26,
   * REQ-3.4.5), keyed by `ScoreNote.id`. Independent of `setNoteColor`: a
   * hidden note stays hidden regardless of what colour is requested for it,
   * and reveals showing whatever colour was last requested (or the default).
   */
  setNoteHidden(noteId: string, hidden: boolean): void
  /** Reveal every note hidden via `setNoteHidden`. Colours from `setNoteColor` are unaffected. */
  clearHiddenNotes(): void
  /** Release everything the engraver holds — DOM nodes, listeners, the OSMD instance. */
  destroy(): void
}

export type EngraverFactory = () => ScoreEngraver
