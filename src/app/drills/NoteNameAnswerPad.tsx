/**
 * The answer pad for a `'note-name'` flashcard (roadmap 3.11, REQ-3.5.2):
 * one button per pitch class `buildNoteNameDeck` can ever draw, read
 * straight off `fromMidi`'s canonical (sharps-preferred) spelling for each
 * of the twelve pitch classes — the same spelling the deck itself answers
 * with, so this pad can never offer a letter/accidental combination the
 * deck would mark wrong even if pressed.
 *
 * Every button is a real `<button>` with a readable label ("C", "F♯"), so
 * this is keyboard-reachable and screen-reader-friendly for free; the pad
 * itself is a labelled `role="group"`.
 */
import type { NoteNameAnswer } from '@core/drills/flashcards.ts'
import { fromMidi, type Alter } from '@core/theory/pitch.ts'
import { midi } from '@core/shared/units.ts'

export type NoteNameAnswerPadProps = {
  readonly onAnswer: (answer: NoteNameAnswer) => void
}

const ACCIDENTAL_SUFFIX: Record<Alter, string> = {
  [-2]: '\u{1D12B}',
  [-1]: '♭',
  0: '',
  1: '♯',
  2: '\u{1D12A}',
}

const PITCH_CLASSES_PER_OCTAVE = 12
const MIDDLE_C = 60

/** Every pitch class `buildNoteNameDeck` can draw, in its canonical (sharps-preferred) spelling. */
const NOTE_NAME_BUTTONS: readonly NoteNameAnswer[] = Array.from(
  { length: PITCH_CLASSES_PER_OCTAVE },
  (_, pitchClass) => {
    const spelled = fromMidi(midi(MIDDLE_C + pitchClass))
    return { letter: spelled.letter, alter: spelled.alter }
  },
)

function label(answer: NoteNameAnswer): string {
  return `${answer.letter}${ACCIDENTAL_SUFFIX[answer.alter]}`
}

export function NoteNameAnswerPad({ onAnswer }: NoteNameAnswerPadProps) {
  return (
    <div className="note-name-answer-pad" role="group" aria-label="Note name answer">
      {NOTE_NAME_BUTTONS.map((answer) => (
        <button key={label(answer)} type="button" onClick={() => onAnswer(answer)}>
          {label(answer)}
        </button>
      ))}
    </div>
  )
}
