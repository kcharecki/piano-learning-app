/**
 * A pure duration-label helper, testable without a DOM.
 *
 * It was written for the sight-reading trainer's text preview, which roadmap
 * 2.20 replaced with real engraved notation; its remaining consumer is
 * `@app/rhythm/PatternPreview.tsx`, where a bare `RhythmPattern` still has no
 * engraving. The pitch-labelling and hand/measure grouping that lived here
 * went with the text preview.
 */
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'

/** Named durations, longest first so a whole note is not read as 4 sixteenths. */
const NAMED_DURATIONS: readonly (readonly [number, string])[] = [
  [TICKS_PER_QUARTER * 4, 'whole'],
  [TICKS_PER_QUARTER * 3, 'dotted half'],
  [TICKS_PER_QUARTER * 2, 'half'],
  [(TICKS_PER_QUARTER * 3) / 2, 'dotted quarter'],
  [TICKS_PER_QUARTER, 'quarter'],
  [(TICKS_PER_QUARTER * 3) / 4, 'dotted eighth'],
  [TICKS_PER_QUARTER / 2, 'eighth'],
  [TICKS_PER_QUARTER / 4, 'sixteenth'],
]

/** A short duration label — a name for the common values, else a `n/16` fraction. */
export function durationLabel(durationTicks: number): string {
  const named = NAMED_DURATIONS.find(([ticks]) => ticks === durationTicks)
  if (named !== undefined) return named[1]
  const sixteenths = durationTicks / (TICKS_PER_QUARTER / 4)
  return `${sixteenths}/16`
}
