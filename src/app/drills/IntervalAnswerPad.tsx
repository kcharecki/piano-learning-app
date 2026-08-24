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
 *
 * The label comes from `intervalOrdinalName` in core rather than a table here,
 * so that the reveal which corrects a miss (improve-app run 2026-08-24-1) names
 * the answer in exactly the words printed on the button the learner pressed.
 */
import { intervalOrdinalName, SIMPLE_INTERVALS } from '@core/theory/intervals.ts'
import type { IntervalAnswer } from '@core/drills/flashcards.ts'

export type IntervalAnswerPadProps = {
  readonly onAnswer: (answer: IntervalAnswer) => void
}

/** Every interval `buildIntervalDeck` can draw — a unison is never among them. */
const INTERVAL_BUTTONS: readonly IntervalAnswer[] = SIMPLE_INTERVALS.filter(
  (iv) => iv.number >= 2,
).map((iv) => ({ number: iv.number, quality: iv.quality }))

export function IntervalAnswerPad({ onAnswer }: IntervalAnswerPadProps) {
  return (
    <div className="interval-answer-pad answer-pad" role="group" aria-label="Interval answer">
      {INTERVAL_BUTTONS.map((answer) => (
        <button
          key={`${answer.number}-${answer.quality}`}
          type="button"
          onClick={() => onAnswer(answer)}
        >
          {intervalOrdinalName(answer)}
        </button>
      ))}
    </div>
  )
}
