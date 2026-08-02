/**
 * Answer pad for the chord-quality and scale/mode ear-training drills
 * (roadmap 3.10, REQ-3.6.1): one button per value the current level's
 * vocabulary can draw (`chordQualitiesForLevel(level)` /
 * `scaleTypesForLevel(level)`, passed in as `options`), so the pad never
 * offers a quality/type the deck cannot ask and never omits one it can.
 *
 * Generic over the vocabulary's own string union (`ChordQuality` /
 * `ScaleType`) so one component serves both drills instead of two
 * near-identical ones — the caller supplies the vocabulary and the label,
 * this file only renders it and reports back exactly the value clicked.
 */
export type QualityAnswerButtonsProps<T extends string> = {
  /** aria-label for the pad's `role="group"` — e.g. "Chord quality answer". */
  readonly groupLabel: string
  readonly options: readonly T[]
  readonly onAnswer: (value: T) => void
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
}: QualityAnswerButtonsProps<T>) {
  return (
    <div role="group" aria-label={groupLabel} className="quality-answer-buttons">
      {options.map((value) => (
        <button key={value} type="button" onClick={() => onAnswer(value)}>
          {humanize(value)}
        </button>
      ))}
    </div>
  )
}
