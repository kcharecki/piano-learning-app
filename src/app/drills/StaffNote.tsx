/**
 * A single note drawn on a five-line staff (roadmap 2.12, REQ-3.4.5). Not a
 * general notation renderer — `ScoreViewer`/OSMD is that, and needs MusicXML
 * this codebase has no way to build for a single ad-hoc prompt — just enough
 * real, computed staff geometry (`staffPosition.ts`) to make a flashcard's
 * prompt genuinely readable from its POSITION, not from text that would name
 * the answer outright.
 *
 * The rendered pitch is `fromMidi(midi)`'s canonical spelling. Flashcard
 * grading (`gradeAnswer` in `core/drills/flashcards.ts`) is by MIDI number,
 * not by letter, so which enharmonic spelling is drawn does not change what
 * counts as correct — exactly like `buildNoteNameDeck`'s own answer, which is
 * `fromMidi`'s spelling of the same prompt note.
 */
import type { Clef } from '@core/drills/flashcards.ts'
import { fromMidi } from '@core/theory/pitch.ts'
import type { Midi } from '@core/shared/units.ts'
import { ledgerSteps, staffStep } from './staffPosition.ts'

export type StaffNoteProps = {
  readonly midi: Midi
  readonly clef: Clef
}

const LINE_GAP = 12
const STEP_GAP = LINE_GAP / 2
const BOTTOM_LINE_Y = 100
const NOTE_X = 70
const LEDGER_HALF_WIDTH = 12
const CLEF_GLYPH: Record<Clef, string> = { treble: '\u{1D11E}', bass: '\u{1D122}' }
const ACCIDENTAL_GLYPH: Record<number, string> = {
  [-2]: '\u{1D12B}',
  [-1]: '♭',
  [1]: '♯',
  [2]: '\u{1D12A}',
}

function y(step: number): number {
  return BOTTOM_LINE_Y - step * STEP_GAP
}

export function StaffNote({ midi, clef }: StaffNoteProps) {
  const spelled = fromMidi(midi)
  const step = staffStep(spelled, clef)
  const ledgers = ledgerSteps(step)
  const accidental = ACCIDENTAL_GLYPH[spelled.alter]

  return (
    <svg
      className="staff-note"
      viewBox="0 0 140 140"
      role="img"
      aria-label={`A note on the ${clef} staff`}
      data-testid="staff-note"
      data-step={step}
    >
      <text x="10" y={y(4) + 14} fontSize="34" aria-hidden="true">
        {CLEF_GLYPH[clef]}
      </text>
      {[0, 2, 4, 6, 8].map((line) => (
        <line key={line} x1="0" x2="140" y1={y(line)} y2={y(line)} stroke="currentColor" />
      ))}
      {ledgers.map((ledgerStep) => (
        <line
          key={ledgerStep}
          data-testid={`ledger-${ledgerStep}`}
          x1={NOTE_X - LEDGER_HALF_WIDTH}
          x2={NOTE_X + LEDGER_HALF_WIDTH}
          y1={y(ledgerStep)}
          y2={y(ledgerStep)}
          stroke="currentColor"
        />
      ))}
      {accidental !== undefined && (
        <text x={NOTE_X - 22} y={y(step) + 6} fontSize="20" aria-hidden="true">
          {accidental}
        </text>
      )}
      <ellipse cx={NOTE_X} cy={y(step)} rx="7" ry="5.5" fill="currentColor" />
    </svg>
  )
}
