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
 * still cleared those rows' range WIDTH, so the column was sized for the
 * cadence walk's own reachability need instead of for what a learner should
 * be shown.
 *
 * The reachability need is real, but "clears the range width" was itself
 * ~2.7× too conservative (roadmap 5.53 review, F3/F6/F7): `generateMelodicLine`'s
 * actual cadence-closing test is `bestDist > durations.length * maxLeap`,
 * where `bestDist` is the distance from wherever the melody enters the final
 * bar to the NEAREST tonic occurrence already inside the range — not the
 * full range width, which only binds if the walk could enter the final bar
 * at the range's extreme edge with the nearest tonic sitting at the opposite
 * edge. `levelDefaults.test.ts` now models that distance directly (worst
 * case over every position in the range, not just the edges), and every row
 * here clears it with room to spare at its own graded `maxLeap` — level 2's
 * `maxLeap: 7`, its unchanged range, and `melody.ts`'s unchanged `quarters`
 * pool (half note included: `RHYTHM_MAX_UNIT` never needed to drop it) needs
 * `minNotes(2) * 7 = 14` against a worst-case nearest-tonic distance of `7` —
 * no range or rhythm pool had to move for level 2's or level 3's sake.
 *
 * Level 1's `maxLeap` is unused by its own `stepwiseOneDirection` walk
 * (`stepwiseLine.ts`) — and, unlike an earlier draft of this comment
 * claimed, it is currently DEAD for every level's row here, not just level
 * 1's: `core/eartraining/dictation.ts:285` always computes
 * `Math.max(defaults.maxLeapSemitones, range.high - range.low)` before
 * generating, and the range-width term is the larger of the two for every
 * row in this table, so whatever pedagogical ceiling this column sets is
 * discarded there every time. The column stays a real per-level value
 * anyway, for two reasons that don't depend on dictation: table coherence
 * with the other monotonically-graded columns, and `generateMelody`'s
 * sight-reading callers (`useSightReadingTrainer`, not dictation) DO read
 * this value as-is via `defaultParamsForLevel`. Nothing about dictation's
 * own leap size should be inferred from this table.
 *
 * The rhythm column (roadmap 5.54): level 1 is `'quarter-half'`
 * (`rhythmPools.ts`) — units `{4, 8}` only, no whole notes — and level 2 is
 * `'quarters'`, whose own pool (`{1, 2, 4, 8}`) is already a strict superset,
 * so the level 1 -> 2 vocabulary step needed no change of its own. Faber
 * Piano Adventures Primer introduces note values quarter -> half -> whole,
 * ALL inside Unit 2 (official Teacher Guide, verified 2026-08-12); a level-1
 * exercise engraving whole notes before quarter/half were secure inverted
 * that order — the identical defect roadmap 5.20 fixed for the Rhythm drill
 * on the same source. Levels 3-6's own pools (`eighths`/`dotted`/
 * `syncopated`) predate this task and are NOT verified against level 2 the
 * same way — `eighths` in particular has no half note at all — so the
 * ladder's monotonic-vocabulary property in `levelDefaults.test.ts` only
 * asserts the 1 -> 2 step this task is scoped to, not the full 1 -> 6 chain.
 *
 * Level 3's `leftRange` (roadmap 5.53b) is `57..76`, not `48..67` like levels
 * 2 and 4's rows — deliberately incongruent with `rightRange` (`60..79`),
 * unlike a `'unison'` row. `doubleHand`'s `'parallel'` path (this row's
 * `handIndependence`) targets a diatonic third BELOW each right-hand note, so
 * the range that needs to hold the left hand is `rightRange` shifted down by
 * only 3-4 semitones, not by a full octave: `57..76` is `60..79` shifted down
 * 3, and its top (`76`) is exactly `rightRange.high - 3`, the tightest bound
 * that lets every right-hand note (up to `79`) reach an exact-register third
 * below it. The old `48..67` (a full octave down, like the 'unison' rows)
 * left `76` unreachable, so `doubleHand`'s cascade (see its own doc) gave up
 * the exact interval and fell back to same-pitch-class-wrong-octave or
 * any-scale-tone on measured 5.2% of engraved simultaneities — 62% true
 * thirds, not the ~95%+ "parallel thirds" `levelDescriptions.ts` promises.
 * Measured before (baseline `48..67`, 200 seeds, `scratchpad-vertical-probe.ts`,
 * not committed): 94.7% thirds/tenths, 0.9% tritones. After (`57..76`, same
 * 200 seeds): 99.8% thirds/tenths, 0% tritones, 0% sevenths — see
 * `levelDefaults.test.ts`'s own congruency check, which pins this on ENGRAVED
 * output rather than the table.
 *
 * `handIndependence: 'unison'` (`doubleHand`, `melody.ts`) transposes the
 * primary hand by a fixed octave computed once from its first note, so it
 * only ever lands inside `leftRange` when `leftRange` is exactly `rightRange`
 * shifted down by that octave — same width, same offset. A `'unison'` row
 * whose ranges aren't congruent like that still generates (nothing errors)
 * but silently folds the left hand into whatever octave overlaps, producing
 * contrary motion in a level whose whole point is hands moving together.
 * `'parallel'` degrades the same way, more mildly, for the same reason.
 * `doubleHand` bounds that fold to `maxLeapSemitones` of the previous
 * derived note (roadmap 5.53 review F1), so an incongruent range no longer
 * risks a leap wider than the row's own declared column — only the
 * contrary-motion drift described above.
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
  [0, 'major', 4, FOUR_FOUR, 'right', 60, 79, null, null, 'quarter-half', 2, 0, 'unison', true],
  [0, 'major', 4, FOUR_FOUR, 'both', 60, 79, 48, 67, 'quarters', 7, 0, 'unison', false],
  [1, 'major', 8, THREE_FOUR, 'both', 60, 79, 57, 76, 'eighths', 7, 0.05, 'parallel', false],
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
