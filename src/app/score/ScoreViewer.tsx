/**
 * Score viewer (roadmap 1.17, REQ-3.2.4). Wraps OSMD behind the `ScoreEngraver`
 * seam (`engraver.ts`) so nothing outside this file ever touches the library
 * directly, and so tests can drive it with a fake engraver instead of a real
 * DOM/canvas render.
 */
import type { Score } from '@core/notation/score.ts'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
}

export const ScoreViewer = forwardRef<ScoreViewerHandle, ScoreViewerProps>(function ScoreViewer(
  { musicXml, score, cursorPosition, createEngraver = createOsmdEngraver },
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

  return (
    <div className="score-viewer">
      {error !== undefined && (
        <p role="alert" className="score-viewer-error">
          Could not display this score: {error}
        </p>
      )}
      <div ref={containerRef} data-testid="score-container" />
    </div>
  )
})
