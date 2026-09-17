/**
 * The rhythm-cell vocabulary for the Reed-style one-line reading generator
 * (DR-11). A "cell" is the smallest unit the generator assembles bars from —
 * one or two beats' worth of onsets/rests, always exact in ticks so that
 * `generate.ts` can lay cells end to end without ever producing a note that
 * straddles a barline (drums are onset events; `makeGrooveScore` rejects a
 * note that runs past its measure, same as tied notation would need a split).
 *
 * Cells are DATA, not code, on purpose: `levels.ts`'s pedagogical ladder is
 * just a list of cell ids per level, so "what rhythms exist" and "which level
 * teaches which rhythm" are two separate, independently testable tables. A
 * rest is the ABSENCE of an onset inside a cell's span — there is no explicit
 * rest-onset type, mirroring how `GrooveScore` has no rest notes either.
 */
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'

/** One onset inside a cell, relative to the cell's own start (never absolute). */
export type CellOnset = {
  readonly offsetTicks: number
  readonly durationTicks: number
}

export type RhythmCell = {
  /** Stable, unique across the whole table — referenced by `ReadingLevelSpec.cellIds`. */
  readonly id: string
  /** How many beats (quarter notes, this slice's only supported beat unit) the cell spans. */
  readonly beats: 1 | 2
  /** Sorted by `offsetTicks`, non-overlapping, entirely inside `[0, beats * TICKS_PER_QUARTER)`. */
  readonly onsets: readonly CellOnset[]
}

/** A cell's total span in ticks — always `beats * TICKS_PER_QUARTER`, asserted by `cells.test.ts`. */
export function cellSpanTicks(cell: RhythmCell): number {
  return cell.beats * TICKS_PER_QUARTER
}

const Q = TICKS_PER_QUARTER // 480
const E = Q / 2 // 240 — eighth
const S = Q / 4 // 120 — sixteenth
const DE = (Q * 3) / 4 // 360 — dotted eighth
const DQ = (Q * 3) / 2 // 720 — dotted quarter
const T = Q / 3 // 160 — triplet eighth

/**
 * The full cell table, keyed by id. A record (not an array) so lookups from
 * `levels.ts`'s `cellIds` are O(1) and a typo'd id is a `Record` miss the
 * type system can't hide — `cellsForLevel` throws (via `invariant`) on one.
 */
export const RHYTHM_CELLS: Readonly<Record<string, RhythmCell>> = {
  // Level 1 — quarters
  q_note: { id: 'q_note', beats: 1, onsets: [{ offsetTicks: 0, durationTicks: Q }] },
  q_rest: { id: 'q_rest', beats: 1, onsets: [] },

  // Level 2 — a beat of two eighths
  ee: {
    id: 'ee',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: E },
      { offsetTicks: E, durationTicks: E },
    ],
  },

  // Level 3 — eighth rests
  rest_e: { id: 'rest_e', beats: 1, onsets: [{ offsetTicks: E, durationTicks: E }] },
  e_rest: { id: 'e_rest', beats: 1, onsets: [{ offsetTicks: 0, durationTicks: E }] },

  // Level 4 — sixteenths
  ssss: {
    id: 'ssss',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: S },
      { offsetTicks: S, durationTicks: S },
      { offsetTicks: 2 * S, durationTicks: S },
      { offsetTicks: 3 * S, durationTicks: S },
    ],
  },
  e_ss: {
    id: 'e_ss',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: E },
      { offsetTicks: E, durationTicks: S },
      { offsetTicks: E + S, durationTicks: S },
    ],
  },
  ss_e: {
    id: 'ss_e',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: S },
      { offsetTicks: S, durationTicks: S },
      { offsetTicks: 2 * S, durationTicks: E },
    ],
  },

  // Level 5 — dotted rhythms
  de_s: {
    id: 'de_s',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: DE },
      { offsetTicks: DE, durationTicks: S },
    ],
  },
  s_de: {
    id: 's_de',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: S },
      { offsetTicks: S, durationTicks: DE },
    ],
  },
  /** Two-beat: dotted quarter (720) + eighth (240) = 960 = 2 * 480. */
  dq_e: {
    id: 'dq_e',
    beats: 2,
    onsets: [
      { offsetTicks: 0, durationTicks: DQ },
      { offsetTicks: DQ, durationTicks: E },
    ],
  },

  // Level 6 — eighth-note triplet: three notes in one beat, 160 ticks each.
  triplet: {
    id: 'triplet',
    beats: 1,
    onsets: [
      { offsetTicks: 0, durationTicks: T },
      { offsetTicks: T, durationTicks: T },
      { offsetTicks: 2 * T, durationTicks: T },
    ],
  },

  // Level 7 — syncopation: an onset on the "and" held across the beat.
  /** eighth + quarter (starting on the "and") + eighth, 240+480+240 = 960. */
  sync_a: {
    id: 'sync_a',
    beats: 2,
    onsets: [
      { offsetTicks: 0, durationTicks: E },
      { offsetTicks: E, durationTicks: Q },
      { offsetTicks: E + Q, durationTicks: E },
    ],
  },
  /** eighth-rest + quarter (starting on the "and") + eighth, 240+480+240 = 960. */
  sync_b: {
    id: 'sync_b',
    beats: 2,
    onsets: [
      { offsetTicks: E, durationTicks: Q },
      { offsetTicks: E + Q, durationTicks: E },
    ],
  },
}
