/**
 * Answer pad for the two interval ear-training drills (roadmap 3.10,
 * REQ-3.6.1 — redesigned roadmap UI-13, 2026-08-12 UI audit): one large
 * `.card` button per interval `intervalsForLevel(level)` says the current
 * level can draw — the exact vocabulary `generateIntervalItem` picks from —
 * so the pad never offers an interval the deck cannot ask and never omits
 * one it can.
 *
 * A melodic item also needs a direction: `generateIntervalItem` hears it
 * ascending or descending above level 1 (see `intervals.ts`'s
 * `pickDirection`), and `gradeIntervalAnswer` marks a direction mismatch
 * wrong even when the interval itself is right. `showDirection` renders the
 * ascending/descending toggle for that case; a harmonic item has no
 * direction to name (both notes sound together) and always encodes
 * ascending, so `showDirection={false}` hides the toggle and every answer is
 * submitted as ascending, matching what the generator always produced.
 *
 * `answered` (new in UI-13) is the answer-as-the-interface piece: once
 * `EarTrainingScreen` has a grade, it passes back the exact key of the
 * option the learner picked (the same `[-]QUALITY+NUMBER` encoding
 * `gradeIntervalAnswer`'s own `given` field already uses, e.g. `'M3'`,
 * `'-A4'`) and whether that answer graded correct. Every card locks once
 * `answered` is set — no more picking — and the one matching `pickedKey`
 * renders the feedback tokens plus a glyph (`check`/`x`): color is never the
 * only signal (DESIGN.md rule 8).
 */
import { useState } from 'react'
import { intervalsForLevel } from '@core/eartraining/intervals.ts'
import { intervalLongName, intervalName, type Interval } from '@core/theory/intervals.ts'
import { Icon } from '@app/ui/Icon.tsx'

export type IntervalAnswerButtonsProps = {
  readonly level: number
  /** Show the ascending/descending toggle. Only meaningful for a melodic item. */
  readonly showDirection: boolean
  readonly onAnswer: (interval: Interval, direction: 1 | -1) => void
  /** Once this item has been graded: which option was picked, and whether it
   *  was correct. `undefined` before an answer — every card stays
   *  interactive and unmarked. */
  readonly answered?: { readonly pickedKey: string; readonly correct: boolean }
}

export function IntervalAnswerButtons({
  level,
  showDirection,
  onAnswer,
  answered,
}: IntervalAnswerButtonsProps) {
  const [direction, setDirection] = useState<1 | -1>(1)
  const intervals = intervalsForLevel(level)
  const locked = answered !== undefined

  return (
    <div className="interval-answer-buttons">
      {showDirection && (
        <div role="group" aria-label="Direction">
          <button
            type="button"
            aria-pressed={direction === 1}
            disabled={locked}
            onClick={() => setDirection(1)}
          >
            Ascending
          </button>
          <button
            type="button"
            aria-pressed={direction === -1}
            disabled={locked}
            onClick={() => setDirection(-1)}
          >
            Descending
          </button>
        </div>
      )}
      <div role="group" aria-label="Interval answer" className="eartraining-answer-grid">
        {intervals.map((interval) => {
          const key = `${direction === -1 && showDirection ? '-' : ''}${intervalName(interval)}`
          const picked = answered !== undefined && key === answered.pickedKey ? answered : undefined
          return (
            <button
              key={`${interval.number}-${interval.quality}`}
              type="button"
              className="card answer-card"
              disabled={locked}
              data-state={picked === undefined ? undefined : picked.correct ? 'correct' : 'wrong'}
              onClick={() => onAnswer(interval, showDirection ? direction : 1)}
            >
              {intervalLongName(interval)}
              {picked !== undefined && <Icon name={picked.correct ? 'check' : 'x'} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
