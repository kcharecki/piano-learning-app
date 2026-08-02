/**
 * Answer pad for the two interval ear-training drills (roadmap 3.10,
 * REQ-3.6.1): one button per interval `intervalsForLevel(level)` says the
 * current level can draw — the exact vocabulary `generateIntervalItem` picks
 * from — so the pad never offers an interval the deck cannot ask and never
 * omits one it can.
 *
 * A melodic item also needs a direction: `generateIntervalItem` hears it
 * ascending or descending above level 1 (see `intervals.ts`'s
 * `pickDirection`), and `gradeIntervalAnswer` marks a direction mismatch
 * wrong even when the interval itself is right. `showDirection` renders the
 * ascending/descending toggle for that case; a harmonic item has no
 * direction to name (both notes sound together) and always encodes
 * ascending, so `showDirection={false}` hides the toggle and every answer is
 * submitted as ascending, matching what the generator always produced.
 */
import { useState } from 'react'
import { intervalsForLevel } from '@core/eartraining/intervals.ts'
import { intervalLongName, type Interval } from '@core/theory/intervals.ts'

export type IntervalAnswerButtonsProps = {
  readonly level: number
  /** Show the ascending/descending toggle. Only meaningful for a melodic item. */
  readonly showDirection: boolean
  readonly onAnswer: (interval: Interval, direction: 1 | -1) => void
}

export function IntervalAnswerButtons({ level, showDirection, onAnswer }: IntervalAnswerButtonsProps) {
  const [direction, setDirection] = useState<1 | -1>(1)
  const intervals = intervalsForLevel(level)

  return (
    <div className="interval-answer-buttons">
      {showDirection && (
        <div role="group" aria-label="Direction">
          <button type="button" aria-pressed={direction === 1} onClick={() => setDirection(1)}>
            Ascending
          </button>
          <button type="button" aria-pressed={direction === -1} onClick={() => setDirection(-1)}>
            Descending
          </button>
        </div>
      )}
      <div role="group" aria-label="Interval answer">
        {intervals.map((interval) => (
          <button
            key={`${interval.number}-${interval.quality}`}
            type="button"
            onClick={() => onAnswer(interval, showDirection ? direction : 1)}
          >
            {intervalLongName(interval)}
          </button>
        ))}
      </div>
    </div>
  )
}
