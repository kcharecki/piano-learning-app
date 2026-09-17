/**
 * The rhythm reading generator (DR-11): turns a level + rng into a
 * `GrooveScore` all on the `'snare'` pad, so the existing groove
 * engraver/trainer renders and grades it with no changes of their own.
 *
 * Filling a bar is beat-by-beat: at each remaining-beats count we only ever
 * consider cells (`cells.ts`) whose `beats` fits in what is left, so a
 * two-beat cell (e.g. the level-5 dotted-quarter-plus-eighth, or a level-7
 * syncopation) can never straddle a barline — the same rule
 * `makeGrooveScore` enforces the hard way (it throws on a note that runs past
 * its measure) is upheld here by construction, before a single note input is
 * built.
 *
 * A bar that is nothing but silence teaches nothing above level 1 (where
 * quarter rests are still an honest exercise in reading whole beats of rest),
 * so `fillMeasure` detects an all-rest bar at level >= 2 and swaps one
 * rest-only cell for an onset-bearing cell of the same span — see
 * `forceOnset`. That swap only ever needs to touch a 1-beat cell, because the
 * only zero-onset cell in the whole table is the 1-beat `q_rest`; no 2-beat
 * cell is ever silent.
 */
import { invariant } from '@core/shared/invariant.ts'
import { pick, type Rng } from '@core/ports/rng.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import type { TimeSignature } from '@core/notation/score.ts'
import {
  makeGrooveScore,
  type GrooveNoteInput,
  type GrooveScore,
} from '@core/drums/model/groove.ts'
import type { RhythmCell } from './cells.ts'
import { cellsForLevel, describeReadingLevel, READING_LEVELS, type ReadingLevel } from './levels.ts'

const DEFAULT_MEASURES = 2
const MIN_MEASURES = 1
const MAX_MEASURES = 4
const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
const DEFAULT_ID = 'reading'

export type ReadingExerciseOptions = {
  readonly level: ReadingLevel
  /** Whole bars; default 2, allowed 1..4. */
  readonly measures?: number
  /** Default 4/4. Only beatType 4 is supported in this slice; 3/4 and 4/4 beats. */
  readonly timeSignature?: TimeSignature
  /** Plugged into the score id (`reading-L<level>-<id>`); default `'reading'`. */
  readonly id?: string
}

function hasOnset(cells: readonly RhythmCell[]): boolean {
  return cells.some((cell) => cell.onsets.length > 0)
}

/** Replace the first zero-onset cell with a same-span cell that has an onset, from `vocabulary`. */
function forceOnset(cells: readonly RhythmCell[], vocabulary: readonly RhythmCell[]): readonly RhythmCell[] {
  const silentIndex = cells.findIndex((cell) => cell.onsets.length === 0)
  if (silentIndex < 0) return cells
  const span = cells[silentIndex]?.beats
  invariant(span !== undefined, 'forceOnset: silentIndex out of bounds')
  const replacement = vocabulary.find((cell) => cell.beats === span && cell.onsets.length > 0)
  invariant(replacement !== undefined, `no onset-bearing ${span}-beat cell available to replace a silent bar`)
  const next = [...cells]
  next[silentIndex] = replacement
  return next
}

/**
 * Pick cells filling exactly `beatsInMeasure` beats, never letting a cell
 * overrun what's left. Exported (but not re-exported via `index.ts`) purely
 * so `generate.test.ts` can drive it directly for the "no dead cells"
 * property — reconstructing cell choices from `GrooveScore` note ticks alone
 * would mean re-implementing this same matching logic inside the test.
 */
export function fillMeasure(
  vocabulary: readonly RhythmCell[],
  beatsInMeasure: number,
  level: ReadingLevel,
  rng: Rng,
): readonly RhythmCell[] {
  const picked: RhythmCell[] = []
  let remaining = beatsInMeasure
  while (remaining > 0) {
    const candidates = vocabulary.filter((cell) => cell.beats <= remaining)
    invariant(candidates.length > 0, `no cell fits the remaining ${remaining} beat(s) at level ${level}`)
    const cell = pick(rng, candidates)
    picked.push(cell)
    remaining -= cell.beats
  }
  if (level >= 2 && !hasOnset(picked)) return forceOnset(picked, vocabulary)
  return picked
}

/** `beats * TICKS_PER_QUARTER` per beat — only beatType 4 is supported this slice (see options doc). */
function ticksPerBeat(timeSignature: TimeSignature): number {
  invariant(
    timeSignature.beatType === 4,
    `reading generator only supports a quarter-note beat, got beatType ${timeSignature.beatType}`,
  )
  return TICKS_PER_QUARTER
}

function notesForMeasure(
  cells: readonly RhythmCell[],
  measureStartTick: number,
  beatTicks: number,
): readonly GrooveNoteInput[] {
  const notes: GrooveNoteInput[] = []
  let cellStartTick = measureStartTick
  for (const cell of cells) {
    for (const onset of cell.onsets) {
      notes.push({
        pad: 'snare',
        tick: cellStartTick + onset.offsetTicks,
        durationTicks: onset.durationTicks,
      })
    }
    cellStartTick += cell.beats * beatTicks
  }
  return notes
}

/** Deterministic from `rng`: the same seed and options always yield the same exercise. */
export function generateReadingExercise(options: ReadingExerciseOptions, rng: Rng): GrooveScore {
  const { level } = options
  const measures = options.measures ?? DEFAULT_MEASURES
  invariant(
    Number.isInteger(measures) && measures >= MIN_MEASURES && measures <= MAX_MEASURES,
    `measures must be a whole number ${MIN_MEASURES}..${MAX_MEASURES}, got ${measures}`,
  )
  const timeSignature = options.timeSignature ?? DEFAULT_TIME_SIGNATURE
  const beatTicks = ticksPerBeat(timeSignature)
  const vocabulary = cellsForLevel(level)
  const barTicks = timeSignature.beats * beatTicks

  const notes: GrooveNoteInput[] = []
  for (let m = 0; m < measures; m++) {
    const cells = fillMeasure(vocabulary, timeSignature.beats, level, rng)
    notes.push(...notesForMeasure(cells, m * barTicks, beatTicks))
  }

  const levelName = READING_LEVELS.find((spec) => spec.level === level)?.name
  invariant(levelName !== undefined, `no level name for level ${level}`)
  const idPart = options.id ?? DEFAULT_ID

  return makeGrooveScore({
    id: `reading-L${level}-${idPart}`,
    title: `Reading level ${level}: ${levelName}`,
    timeSignature,
    measureCount: measures,
    notes,
  })
}

/** Number of notes in a generated exercise — the app's header count (DR-11). */
export function readingOnsetCount(score: GrooveScore): number {
  return score.notes.length
}

// Re-exported so the app header can render the sentence next to the exercise
// it goes with, without importing `levels.ts` separately.
export { describeReadingLevel }
