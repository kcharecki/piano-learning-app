/**
 * The answer pad for an `'interval-on-staff'` flashcard (roadmap 2.25,
 * REQ-3.4.5): one button per interval `buildIntervalDeck` can ever draw,
 * read straight off `SIMPLE_INTERVALS` (the same vocabulary the deck itself
 * draws from) filtered to numbers 2 and up — a unison never appears, since
 * no level's `INTERVAL_NUMBERS_BY_LEVEL` ever admits number 1.
 *
 * Every button is a real `<button>` with a readable label ("Major 3rd"), so
 * this is keyboard-reachable and screen-reader-friendly for free; the pad
 * itself is a labelled `role="group"`.
 */
import { SIMPLE_INTERVALS, type IntervalQuality } from '@core/theory/intervals.ts'
import type { IntervalAnswer } from '@core/drills/flashcards.ts'

export type IntervalAnswerPadProps = {
  readonly onAnswer: (answer: IntervalAnswer) => void
}

const QUALITY_LABEL: Record<IntervalQuality, string> = {
  perfect: 'Perfect',
  major: 'Major',
  minor: 'Minor',
  augmented: 'Augmented',
  diminished: 'Diminished',
  doublyAugmented: 'Doubly augmented',
  doublyDiminished: 'Doubly diminished',
}

const NUMBER_ORDINAL: Record<number, string> = {
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: '5th',
  6: '6th',
  7: '7th',
  8: '8th',
}

/** Every interval `buildIntervalDeck` can draw — a unison is never among them. */
const INTERVAL_BUTTONS: readonly IntervalAnswer[] = SIMPLE_INTERVALS.filter(
  (iv) => iv.number >= 2,
).map((iv) => ({ number: iv.number, quality: iv.quality }))

function label(answer: IntervalAnswer): string {
  const ordinal = NUMBER_ORDINAL[answer.number] ?? `${answer.number}th`
  return `${QUALITY_LABEL[answer.quality]} ${ordinal}`
}

export function IntervalAnswerPad({ onAnswer }: IntervalAnswerPadProps) {
  return (
    <div className="interval-answer-pad answer-pad" role="group" aria-label="Interval answer">
      {INTERVAL_BUTTONS.map((answer) => (
        <button
          key={`${answer.number}-${answer.quality}`}
          type="button"
          onClick={() => onAnswer(answer)}
        >
          {label(answer)}
        </button>
      ))}
    </div>
  )
}
