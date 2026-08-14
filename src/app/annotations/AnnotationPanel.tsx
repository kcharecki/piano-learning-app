/**
 * `AnnotationPanel` (roadmap 4.8, REQ-3.2.6): edit the fingering of the
 * currently selected note, toggle a highlight on it, and write a text note
 * against the measure currently in view. A thin view over `useAnnotations` —
 * every edit decision (replace-per-note fingering/highlight, accumulate-per-
 * measure notes) lives there and in `@core/notation/annotations.ts`.
 *
 * `selectedNoteId` and `measureIndex` are controlled by the caller (the score
 * viewer owns "which note/measure is in view"); this panel never guesses one
 * on its own.
 *
 * Roadmap UI-10 (2026-08-12 UI audit): restyled onto `.card` (primitives.css)
 * — it already rendered inside "More tools"'s bordered box, so this gives it
 * its own lifted surface for the three sub-groups (fingering, highlight,
 * measure note) instead of unstyled default block spacing. No structural
 * change: same three `role="group"` sections, same fields, same test ids.
 */
import { MAX_FINGER, MIN_FINGER } from '@core/notation/annotations.ts'
import { useState } from 'react'
import { useAnnotations } from './useAnnotations.ts'

export type AnnotationPanelProps = {
  /** The note currently selected in the score viewer, if any. */
  readonly selectedNoteId?: string
  /** The measure currently in view — per-measure notes are written against it. */
  readonly measureIndex: number
}

const DEFAULT_HIGHLIGHT_COLOUR = '#ffe066'

export function AnnotationPanel({ selectedNoteId, measureIndex }: AnnotationPanelProps) {
  const {
    fingeringFor,
    setFingering,
    removeFingering,
    highlightFor,
    setHighlight,
    removeHighlight,
    notesForMeasure,
    addMeasureNote,
    removeMeasureNote,
  } = useAnnotations()

  const [fingerInput, setFingerInput] = useState('')
  const [noteText, setNoteText] = useState('')
  const [fingerError, setFingerError] = useState<string | undefined>(undefined)

  const hasSelection = selectedNoteId !== undefined
  const currentFinger = hasSelection ? fingeringFor(selectedNoteId) : undefined
  const currentColour = hasSelection ? highlightFor(selectedNoteId) : undefined
  const measureNotes = notesForMeasure(measureIndex)

  const applyFingering = (): void => {
    if (selectedNoteId === undefined) return
    const finger = Number(fingerInput)
    if (!Number.isInteger(finger) || finger < MIN_FINGER || finger > MAX_FINGER) {
      setFingerError(`Finger must be a whole number ${MIN_FINGER}–${MAX_FINGER}`)
      return
    }
    setFingerError(undefined)
    setFingering(selectedNoteId, finger)
    setFingerInput('')
  }

  const toggleHighlight = (): void => {
    if (selectedNoteId === undefined) return
    if (currentColour === undefined) setHighlight(selectedNoteId, DEFAULT_HIGHLIGHT_COLOUR)
    else removeHighlight(selectedNoteId)
  }

  const submitNote = (): void => {
    const text = noteText.trim()
    if (text.length === 0) return
    addMeasureNote(measureIndex, text)
    setNoteText('')
  }

  return (
    <div className="card annotation-panel">
      <section role="group" aria-label="Fingering">
        <label htmlFor="annotation-finger-input">Finger (1–5)</label>
        <input
          id="annotation-finger-input"
          type="number"
          min={MIN_FINGER}
          max={MAX_FINGER}
          value={fingerInput}
          disabled={!hasSelection}
          onChange={(e) => setFingerInput(e.target.value)}
        />
        <button type="button" disabled={!hasSelection || fingerInput === ''} onClick={applyFingering}>
          Set fingering
        </button>
        <button
          type="button"
          disabled={!hasSelection || currentFinger === undefined}
          onClick={() => selectedNoteId !== undefined && removeFingering(selectedNoteId)}
        >
          Clear fingering
        </button>
        <p role="status" data-testid="annotation-current-finger">
          {currentFinger === undefined ? 'No fingering set' : `Finger ${currentFinger}`}
        </p>
        {fingerError !== undefined && (
          <p role="status" data-testid="annotation-finger-error">
            {fingerError}
          </p>
        )}
      </section>

      <section role="group" aria-label="Highlight">
        <button type="button" disabled={!hasSelection} onClick={toggleHighlight}>
          {currentColour === undefined ? 'Highlight note' : 'Remove highlight'}
        </button>
        <p role="status" data-testid="annotation-current-highlight">
          {currentColour === undefined ? 'No highlight' : `Highlighted ${currentColour}`}
        </p>
      </section>

      <section role="group" aria-label="Measure note">
        <label htmlFor="annotation-note-input">Note for measure {measureIndex + 1}</label>
        <input
          id="annotation-note-input"
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
        />
        <button type="button" disabled={noteText.trim().length === 0} onClick={submitNote}>
          Add note
        </button>
        <ul aria-label="Measure notes" data-testid="annotation-measure-notes">
          {measureNotes.map((text, i) => (
            // Notes are plain accumulated strings, not identified entities — index+text is a stable-enough key.
            <li key={`${i}-${text}`}>
              {text}
              <button
                type="button"
                aria-label={`Remove note: ${text}`}
                onClick={() => removeMeasureNote(measureIndex, text)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
