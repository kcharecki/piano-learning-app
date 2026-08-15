/**
 * Level defaults for the sight-reading generator (requirements.md section 2,
 * roadmap 5.11) — split out of `melody.ts` (which owns *how* a melody is
 * generated from a `GeneratorParams`) because this file owns a different
 * concern: *what* params each level uses.
 *
 * One row per level (roadmap 5.11 — six levels, not requirements.md
 * section 2's five, so the 1→2 jump has room to be gradual and the two
 * levels that need more than 2 accidentals have somewhere to live): fifths,
 * mode, bars, time signature, hands, right low/high, left low/high (`null`
 * when unused), rhythm, max leap, accidental density, hand independence,
 * stepwise-one-direction — monotonically harder in range width, rhythm and
 * leap size as the level rises, and never more than 2 sharps/flats below
 * level 6 (RCM/ABRSM/Faber all hold key signatures to 0–2 accidentals across
 * their first several grades; harder keys are a level-6 thing, not a
 * level-4 thing).
 *
 * `maxLeap` is graded for PEDAGOGY first (roadmap 5.53), not solved backward
 * from reachability: it rises monotonically level to level and never exceeds
 * a 5th (7 semitones) below level 4 — Faber Level 1 prepares reading "with
 * intervals up through the 5th", and RCM/ABRSM agree a 6th or wider is a
 * later-grade thing. An earlier draft of this table ran that backward —
 * levels 2–4 all shared `maxLeap: 10` (a minor seventh, one level after a
 * genuinely stepwise level 1) purely because 10 was the smallest leap that
 * still cleared those rows' range width, so the column was sized for the
 * cadence walk's own reachability need instead of for what a learner should
 * be shown. The reachability need is still real — the cadence in
 * `generateMelodicLine` needs `notes-in-last-bar * maxLeap` to reach any
 * point in the range — but for level 2 it is now met on the OTHER side of
 * the inequality: `melody.ts`'s `quarters` rhythm pool no longer offers a
 * half-note-long draw (its worst case used to be two half notes filling a
 * 4/4 bar, `minNotes = 2`), so the worst case is now four quarter-note-or
 * -shorter draws (`minNotes = 4`), which clears this row's UNCHANGED range
 * width at `maxLeap: 7` (4×7=28 ≥ 19) with room to spare — no range had to
 * shrink to fit. That also keeps this row's width from needing to move
 * relative to level 1's, sidestepping a real trap: narrowing level 1's own
 * range (it does not need to change for this row's sake — level 1's
 * `stepwiseOneDirection` walk never reads `maxLeap` or cares how wide the
 * range is beyond holding 4 scale tones) shrinks the pool of start
 * positions `stepwiseLine.ts` draws from, and at every width from 5 to 15
 * semitones tried, `useSightReadingTrainer.test.ts`'s two hardcoded seeds
 * (42 and 7) collide onto the identical four-note run — a UI-level test this
 * file may not edit. Level 3 needed no pool change or range change either —
 * its `eighths`/¾ rhythm already guarantees enough notes in the last bar to
 * cadence at `maxLeap: 7` across its existing range (`minNotes = 3`,
 * 3×7=21 ≥ 19). Level 1's `maxLeap` is unused by its own
 * `stepwiseOneDirection` walk (`stepwiseLine.ts`), but it is NOT dead:
 * `core/eartraining/dictation.ts` reuses this row and can force
 * `stepwiseOneDirection: false` back on, at which point the cadence walk
 * runs for real — so it still has to be a real per-level step, not a
 * placeholder (this is exactly the mistake an earlier draft of this file
 * made, caught by `dictation.test.ts`'s property tests, not by anything
 * here).
 *
 * `handIndependence: 'unison'` (`doubleHand`, `melody.ts`) transposes the
 * primary hand by a fixed octave computed once from its first note, so it
 * only ever lands inside `leftRange` when `leftRange` is exactly `rightRange`
 * shifted down by that octave — same width, same offset. A `'unison'` row
 * whose ranges aren't congruent like that still generates (nothing errors)
 * but silently folds the left hand into whatever octave overlaps, producing
 * contrary motion in a level whose whole point is hands moving together.
 * `'parallel'` degrades the same way, more mildly, for the same reason.
 */
import { at } from '@core/shared/invariant.ts'
import { midi as asMidi } from '@core/shared/units.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import type { TimeSignature } from '@core/notation/score.ts'
import type { GeneratorParams, HandIndependence, MidiRange, RhythmStyle } from './melody.ts'

const range = (low: number, high: number): MidiRange => ({ low: asMidi(low), high: asMidi(high) })

type LevelRow = readonly [
  number,
  'major' | 'minor',
  number,
  TimeSignature,
  GeneratorParams['hands'],
  number,
  number,
  number | null,
  number | null,
  RhythmStyle,
  number,
  number,
  HandIndependence,
  boolean,
]

const FOUR_FOUR: TimeSignature = { beats: 4, beatType: 4 }
const THREE_FOUR: TimeSignature = { beats: 3, beatType: 4 }
const SIX_EIGHT: TimeSignature = { beats: 6, beatType: 8 }

const LEVEL_ROWS: readonly LevelRow[] = [
  // fifths mode      bars ts         hands   rLo rHi lLo  lHi  rhythm        leap density indep             stepwise
  [0, 'major', 4, FOUR_FOUR, 'right', 60, 79, null, null, 'whole-half', 2, 0, 'unison', true],
  [0, 'major', 4, FOUR_FOUR, 'both', 60, 79, 48, 67, 'quarters', 7, 0, 'unison', false],
  [1, 'major', 8, THREE_FOUR, 'both', 60, 79, 48, 67, 'eighths', 7, 0.05, 'parallel', false],
  [2, 'major', 8, SIX_EIGHT, 'both', 60, 79, 48, 67, 'dotted', 10, 0.1, 'blocked-chords', false],
  [1, 'minor', 8, FOUR_FOUR, 'both', 60, 84, 36, 60, 'syncopated', 11, 0.15, 'independent', false],
  [4, 'major', 8, SIX_EIGHT, 'both', 55, 88, 31, 67, 'syncopated', 12, 0.2, 'independent', false],
]

/** Matches {@link LEVEL_ROWS}; also `core/sightreading/adaptive.ts`'s `MAX_LEVEL`. */
export const MAX_GENERATOR_LEVEL = LEVEL_ROWS.length

export function defaultParamsForLevel(level: number): GeneratorParams {
  const row = at(LEVEL_ROWS, Math.min(MAX_GENERATOR_LEVEL, Math.max(1, Math.round(level))) - 1)
  const [
    fifths,
    mode,
    bars,
    ts,
    hands,
    rLow,
    rHigh,
    lLow,
    lHigh,
    rhythm,
    maxLeap,
    density,
    indep,
    stepwiseOneDirection,
  ] = row
  return {
    key: keyFromFifths(fifths, mode),
    bars,
    timeSignature: ts,
    hands,
    rightRange: range(rLow, rHigh),
    ...(lLow === null || lHigh === null ? {} : { leftRange: range(lLow, lHigh) }),
    rhythm,
    maxLeapSemitones: maxLeap,
    accidentalDensity: density,
    handIndependence: indep,
    stepwiseOneDirection,
  }
}
