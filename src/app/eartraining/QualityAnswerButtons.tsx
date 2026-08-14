/**
 * Answer pad for the chord-quality and scale/mode ear-training drills
 * (roadmap 3.10, REQ-3.6.1 — redesigned roadmap UI-13, 2026-08-12 UI audit):
 * one large `.card` button per value the current level's vocabulary can draw
 * (`chordQualitiesForLevel(level)` / `scaleTypesForLevel(level)`, passed in
 * as `options`), so the pad never offers a quality/type the deck cannot ask
 * and never omits one it can.
 *
 * Generic over the vocabulary's own string union (`ChordQuality` /
 * `ScaleType`) so one component serves both drills instead of two
 * near-identical ones — the caller supplies the vocabulary and the label,
 * this file only renders it and reports back exactly the value clicked.
 *
 * `answered` (new in UI-13) is the answer-as-the-interface piece: once
 * `EarTrainingScreen` has a grade, it passes back the exact value the
 * learner picked and whether it graded correct. Every card locks once
 * `answered` is set — no more picking — and the one matching `picked`
 * renders the feedback tokens plus a glyph (`check`/`x`): color is never the
 * only signal (DESIGN.md rule 8).
 */
import { Icon } from '@app/ui/Icon.tsx'

export type QualityAnswerButtonsProps<T extends string> = {
  /** aria-label for the pad's `role="group"` — e.g. "Chord quality answer". */
  readonly groupLabel: string
  readonly options: readonly T[]
  readonly onAnswer: (value: T) => void
  /** Once this item has been graded: which option was picked, and whether it
   *  was correct. `undefined` before an answer — every card stays
   *  interactive and unmarked. */
  readonly answered?: { readonly picked: T; readonly correct: boolean }
}

/**
 * 'halfDiminished7' -> 'Half Diminished 7'; 'naturalMinor' -> 'Natural Minor'.
 * Exported so `EarTrainingScreen` can render a wrong-answer's `expected` value
 * in the same vocabulary as this pad's own button labels.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared formatter, not a component; deliberately reused by EarTrainingScreen
export function humanize(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2')
  return spaced.length === 0 ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function QualityAnswerButtons<T extends string>({
  groupLabel,
  options,
  onAnswer,
  answered,
}: QualityAnswerButtonsProps<T>) {
  const locked = answered !== undefined

  return (
    <div role="group" aria-label={groupLabel} className="quality-answer-buttons eartraining-answer-grid">
      {options.map((value) => {
        const picked = answered !== undefined && value === answered.picked ? answered : undefined
        return (
          <button
            key={value}
            type="button"
            className="card answer-card"
            disabled={locked}
            data-state={picked === undefined ? undefined : picked.correct ? 'correct' : 'wrong'}
            onClick={() => onAnswer(value)}
          >
            {humanize(value)}
            {picked !== undefined && <Icon name={picked.correct ? 'check' : 'x'} />}
          </button>
        )
      })}
    </div>
  )
}
