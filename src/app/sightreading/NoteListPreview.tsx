/**
 * A readable stand-in for notation (roadmap 2.12). `ScoreViewer` (REQ-3.2.4)
 * takes MusicXML text, but the sight-reading generator produces a `Score`
 * directly and this codebase has no `Score`-to-MusicXML writer yet — see the
 * roadmap-2.12 report. Rather than fabricate one or silently skip rendering
 * anything, this prints the real generated notes: one line per hand, grouped
 * by measure, in playing order. Not engraved notation, but every note on it
 * is real and honestly labelled.
 */
import type { Score } from '@core/notation/score.ts'
import { groupByHandAndMeasure, noteLabel } from './noteDisplay.ts'

export type NoteListPreviewProps = {
  readonly score: Score
}

const HAND_LABEL = { left: 'Left hand', right: 'Right hand' } as const

export function NoteListPreview({ score }: NoteListPreviewProps) {
  const lines = groupByHandAndMeasure(score)
  return (
    <div className="note-list-preview" aria-label="Exercise notes">
      <p className="note-list-preview-note">
        Notation rendering is not available for generated exercises yet — this is the exercise's
        real note sequence, not a picture of the score.
      </p>
      {lines.map((line) => (
        <section key={line.hand} aria-label={HAND_LABEL[line.hand]}>
          <h3>{HAND_LABEL[line.hand]}</h3>
          <ol className="note-list-measures">
            {line.measures.map((measure) => (
              <li
                key={measure.measureIndex}
                data-testid={`measure-${line.hand}-${measure.measureIndex}`}
              >
                <span className="note-list-measure-number">m{measure.measureNumber}</span>
                <span className="note-list-notes">
                  {measure.notes.map((note) => noteLabel(note)).join(', ')}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
