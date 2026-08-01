/**
 * Pure display helpers for `NoteListPreview.tsx` (roadmap 2.12) — turning a
 * generated `Score`'s notes into short, readable strings. No rendering here,
 * only the string/grouping logic, so it is unit-testable without a DOM.
 */
import type { Hand, Score, ScoreNote } from '@core/notation/score.ts'
import { HANDS } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { midiToName } from '@core/theory/pitch.ts'

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

/** `'C#4 (quarter)'`. */
export function noteLabel(note: ScoreNote): string {
  return `${midiToName(note.midi)} (${durationLabel(note.durationTicks)})`
}

export type MeasureNotes = {
  readonly measureIndex: number
  /** As printed on the page — `Measure.number`. */
  readonly measureNumber: string
  readonly notes: readonly ScoreNote[]
}

export type HandLine = {
  readonly hand: Hand
  readonly measures: readonly MeasureNotes[]
}

/**
 * `score`'s notes grouped by hand, then by measure, in playing order. Only
 * hands that actually have at least one note appear — a right-hand-only
 * exercise (level 1) does not print an empty left-hand line.
 */
export function groupByHandAndMeasure(score: Score): readonly HandLine[] {
  const lines: HandLine[] = []
  for (const hand of HANDS) {
    const notes = score.notes.filter((n) => n.hand === hand)
    if (notes.length === 0) continue
    const measures: MeasureNotes[] = []
    for (const measure of score.measures) {
      const inMeasure = notes.filter((n) => n.measureIndex === measure.index)
      if (inMeasure.length === 0) continue
      measures.push({
        measureIndex: measure.index,
        measureNumber: measure.number,
        notes: inMeasure,
      })
    }
    lines.push({ hand, measures })
  }
  return lines
}
