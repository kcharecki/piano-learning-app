/**
 * Score viewer (roadmap 1.17, REQ-3.2.4). Wraps OSMD behind the `ScoreEngraver`
 * seam (`engraver.ts`) so nothing outside this file ever touches the library
 * directly, and so tests can drive it with a fake engraver instead of a real
 * DOM/canvas render.
 */
import type { Score } from '@core/notation/score.ts'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import type { EngraverFactory, ScoreEngraver } from './engraver.ts'
import { createOsmdEngraver } from './osmdEngraver.ts'

export type CursorPosition = { readonly measureIndex: number; readonly tick: number }

export type ScoreViewerHandle = {
  moveCursorTo(measureIndex: number, tick: number): void
  setNoteColor(noteId: string, color: string): void
  clearNoteColors(): void
  setNoteHidden(noteId: string, hidden: boolean): void
  clearHiddenNotes(): void
}

export type ScoreViewerProps = {
  readonly musicXml: string
  readonly score: Score
  /** Follows the transport position, if given — moves the cursor as it changes. */
  readonly cursorPosition?: CursorPosition
  /** Injection seam for tests. Defaults to the real OSMD-backed engraver. */
  readonly createEngraver?: EngraverFactory
  /** Called with the clicked note's id, or `undefined` when the click hit no notehead. */
  readonly onSelectNote?: (noteId: string | undefined) => void
}

export const ScoreViewer = forwardRef<ScoreViewerHandle, ScoreViewerProps>(function ScoreViewer(
  { musicXml, score, cursorPosition, createEngraver = createOsmdEngraver, onSelectNote },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const engraverRef = useRef<ScoreEngraver | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    const engraver = createEngraver()
    engraverRef.current = engraver
    setError(undefined)
    let cancelled = false
    engraver.load(container, musicXml, score).catch((reason: unknown) => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : 'could not render the score')
    })
    return () => {
      cancelled = true
      engraverRef.current = undefined
      engraver.destroy()
    }
  }, [musicXml, score, createEngraver])

  useEffect(() => {
    if (cursorPosition === undefined) return
    engraverRef.current?.moveCursorTo(cursorPosition.measureIndex, cursorPosition.tick)
  }, [cursorPosition])

  useImperativeHandle(
    ref,
    () => ({
      moveCursorTo: (measureIndex, tick) => engraverRef.current?.moveCursorTo(measureIndex, tick),
      setNoteColor: (noteId, color) => engraverRef.current?.setNoteColor(noteId, color),
      clearNoteColors: () => engraverRef.current?.clearNoteColors(),
      setNoteHidden: (noteId, hidden) => engraverRef.current?.setNoteHidden(noteId, hidden),
      clearHiddenNotes: () => engraverRef.current?.clearHiddenNotes(),
    }),
    [],
  )

  // One listener on the container, not one per notehead (roadmap 4.8a) — the
  // engraver walks up from `event.target` to the nearest stamped notehead.
  // Fires for every click on the score, including a miss (empty staff),
  // which resolves to `undefined` and so clears the caller's selection.
  //
  // Known gap (roadmap-review finding, low severity): selection is mouse-only
  // — the container below has no `role`/`tabIndex`/key handler, so the
  // fingering/highlight controls this unlocks have no keyboard path. Left
  // unaddressed here rather than added ad hoc; needs a named roadmap task
  // (arrow-key note stepping) rather than a one-line bolt-on.
  function handleContainerClick(event: MouseEvent<HTMLDivElement>): void {
    onSelectNote?.(engraverRef.current?.noteIdAt(event.target))
  }

  return (
    <div className="score-viewer notation-frame" style={{ position: 'relative' }}>
      {error !== undefined && (
        <p role="alert" className="score-viewer-error">
          Could not display this score: {error}
        </p>
      )}
      <div ref={containerRef} data-testid="score-container" onClick={handleContainerClick} />
    </div>
  )
})
