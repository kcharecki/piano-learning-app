/**
 * Shared hand-written scores.
 *
 * Every downstream suite (parser, timing, practice, app) imports these instead
 * of inventing its own, so a change to the score model breaks in one place and
 * so that a failure message like "expected 8 notes in C_MAJOR_SCALE_RH" means
 * the same thing everywhere. Each fixture states its musical content in a
 * comment, so a reader can check the music rather than trusting the numbers.
 *
 * The exported scores are frozen: they are shared mutable-by-reference objects
 * and a test that scribbles on one would poison every later test.
 */
import {
  makeScore,
  measureDurationTicks,
  type Hand,
  type MeasureInput,
  type Score,
  type ScoreNoteInput,
  type TimeSignature,
} from '@core/notation/score.ts'
import { at } from '@core/shared/invariant.ts'
import { EIGHTH, HALF, QUARTER, TICKS_PER_QUARTER, WHOLE } from '@core/shared/units.ts'

/** Dotted value: 1.5x the base — inlined here since `units.ts` dropped the unused helper. */
const dotted = (t: number): number => t * 1.5

export type TestNote = {
  readonly midi: number
  readonly startTick: number
  /** Defaults to a quarter note. */
  readonly durationTicks?: number
  /** Defaults to the right hand. */
  readonly hand?: Hand
  readonly voice?: number
  readonly staff?: number
  readonly velocity?: number
  readonly tiedFrom?: boolean
  readonly tiedTo?: boolean
  readonly fingering?: number
}

export type BuildTestScoreOptions = {
  readonly id?: string
  readonly title?: string
  readonly composer?: string
  /** Defaults to 4/4. */
  readonly timeSignature?: TimeSignature
  readonly keyFifths?: number
  /** Defaults to just enough measures to hold the notes. */
  readonly measureCount?: number
  /** Length of a shorter opening measure, for upbeats. */
  readonly pickupTicks?: number
  /** Single tempo mark at tick 0. Defaults to 120. */
  readonly bpm?: number
  /** Full tempo map; overrides `bpm`. */
  readonly tempos?: readonly { readonly tick: number; readonly bpm: number }[]
}

function toInput(n: TestNote): ScoreNoteInput {
  return {
    midi: n.midi,
    startTick: n.startTick,
    durationTicks: n.durationTicks ?? QUARTER,
    hand: n.hand ?? 'right',
    ...(n.voice === undefined ? {} : { voice: n.voice }),
    ...(n.staff === undefined ? {} : { staff: n.staff }),
    ...(n.velocity === undefined ? {} : { velocity: n.velocity }),
    ...(n.tiedFrom === undefined ? {} : { tiedFrom: n.tiedFrom }),
    ...(n.tiedTo === undefined ? {} : { tiedTo: n.tiedTo }),
    ...(n.fingering === undefined ? {} : { fingering: n.fingering }),
  }
}

/**
 * Build a score from a bare note list. Measures, ids, staves and the tempo map
 * are filled in, so a test that cares about one note stays one line long.
 */
export function buildTestScore(
  notes: readonly TestNote[],
  opts: BuildTestScoreOptions = {},
): Score {
  const timeSignature = opts.timeSignature ?? { beats: 4, beatType: 4 }
  const barTicks = measureDurationTicks(timeSignature)
  const pickupTicks = opts.pickupTicks ?? 0
  const inputs = notes.map(toInput)
  const lastTick = inputs.reduce((end, n) => Math.max(end, n.startTick + n.durationTicks), 0)
  const barsAfterPickup = Math.ceil(Math.max(0, lastTick - pickupTicks) / barTicks)
  const needed = pickupTicks > 0 ? 1 + barsAfterPickup : Math.max(1, barsAfterPickup)
  const measureCount = opts.measureCount ?? needed

  const first: MeasureInput = {
    timeSignature,
    keyFifths: opts.keyFifths ?? 0,
    ...(pickupTicks > 0 ? { durationTicks: pickupTicks } : {}),
  }
  const measures: MeasureInput[] = [first]
  for (let i = 1; i < measureCount; i++) measures.push({})

  return makeScore({
    id: opts.id ?? 'test-score',
    meta: { title: opts.title ?? 'Test Score', composer: opts.composer ?? 'Test' },
    measures,
    notes: inputs,
    tempos: opts.tempos ?? [{ tick: 0, bpm: opts.bpm ?? 120 }],
  })
}

function frozen(score: Score): Score {
  Object.freeze(score.meta)
  for (const m of score.measures) {
    Object.freeze(m)
    Object.freeze(m.timeSignature)
  }
  for (const n of score.notes) Object.freeze(n)
  for (const t of score.tempos) Object.freeze(t)
  for (const s of score.staves) Object.freeze(s)
  Object.freeze(score.measures)
  Object.freeze(score.notes)
  Object.freeze(score.tempos)
  Object.freeze(score.staves)
  return Object.freeze(score)
}

/** One middle C (C4 = 60), a quarter note on beat 1 of a single 4/4 bar. */
export const SINGLE_NOTE: Score = frozen(
  buildTestScore([{ midi: 60, startTick: 0, fingering: 1 }], {
    id: 'fixture-single-note',
    title: 'Single Note',
  }),
)

/**
 * One octave of C major, right hand, quarter notes in 4/4 — two bars:
 *   C4 D4 E4 F4 | G4 A4 B4 C5   (midi 60 62 64 65 67 69 71 72)
 * with the standard RH fingering 1 2 3 1 2 3 4 5.
 */
export const C_MAJOR_SCALE_RH: Score = frozen(
  buildTestScore(
    [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({
      midi,
      startTick: i * QUARTER,
      fingering: at([1, 2, 3, 1, 2, 3, 4, 5], i),
    })),
    { id: 'fixture-c-major-scale-rh', title: 'C Major Scale (RH)' },
  ),
)

/**
 * Four bars of 4/4, RH melody over LH root-position triads (whole notes):
 *   bar 1  I   C major  (C3 E3 G3 = 48 52 55)   RH C5 D5 E5 F5
 *   bar 2  IV  F major  (F2 A2 C3 = 41 45 48)   RH F5 E5 D5 C5
 *   bar 3  V   G major  (G2 B2 D3 = 43 47 50)   RH G5 F5 E5 D5
 *   bar 4  I   C major  (C3 E3 G3 = 48 52 55)   RH C5 (whole note)
 * 12 LH notes + 13 RH notes = 25.
 */
const TRIADS: readonly (readonly number[])[] = [
  [48, 52, 55],
  [41, 45, 48],
  [43, 47, 50],
  [48, 52, 55],
]
const MELODY: readonly (readonly number[])[] = [
  [72, 74, 76, 77],
  [77, 76, 74, 72],
  [79, 77, 76, 74],
  [72],
]
export const TWO_HAND_CHORDS: Score = frozen(
  buildTestScore(
    [
      ...TRIADS.flatMap((triad, bar) =>
        triad.map((midi) => ({
          midi,
          startTick: bar * WHOLE,
          durationTicks: WHOLE,
          hand: 'left' as const,
        })),
      ),
      ...MELODY.flatMap((bar, barIndex) =>
        bar.map((midi, beat) => ({
          midi,
          startTick: barIndex * WHOLE + beat * QUARTER,
          durationTicks: bar.length === 1 ? WHOLE : QUARTER,
          hand: 'right' as const,
        })),
      ),
    ],
    { id: 'fixture-two-hand-chords', title: 'Two Hand Chords', composer: 'Anon.' },
  ),
)

/**
 * A tie across the barline, 4/4, two bars:
 *   E4 half | C4 half ~ | ~ C4 half | G4 half
 * The C4 sounds for four beats total but is two ScoreNotes, because a note may
 * not cross a barline: the second carries `tiedFrom` and expects no key press.
 */
export const TIED_NOTES: Score = frozen(
  buildTestScore(
    [
      { midi: 64, startTick: 0, durationTicks: HALF },
      { midi: 60, startTick: HALF, durationTicks: HALF, tiedTo: true },
      { midi: 60, startTick: 2 * HALF, durationTicks: HALF, tiedFrom: true },
      { midi: 67, startTick: 3 * HALF, durationTicks: HALF },
    ],
    { id: 'fixture-tied-notes', title: 'Tied Notes' },
  ),
)

/**
 * 3/4 with a one-beat upbeat — measure 0 is the pickup (480 ticks, printed "0"):
 *   G4 | C5 D5 E5 | F5 (dotted half)
 * Total 480 + 1440 + 1440 = 3360 ticks over three measures.
 */
export const PICKUP_MEASURE: Score = frozen(
  buildTestScore(
    [
      { midi: 67, startTick: 0 },
      { midi: 72, startTick: 480 },
      { midi: 74, startTick: 960 },
      { midi: 76, startTick: 1440 },
      { midi: 77, startTick: 1920, durationTicks: dotted(HALF) },
    ],
    {
      id: 'fixture-pickup-measure',
      title: 'Pickup Measure',
      timeSignature: { beats: 3, beatType: 4 },
      pickupTicks: TICKS_PER_QUARTER,
    },
  ),
)

/**
 * Compound metre: 6/8, two bars of 1440 ticks (an eighth is 240).
 *   bar 1  six eighths C4 D4 E4 F4 G4 A4
 *   bar 2  two dotted quarters C5, G4
 */
export const SIX_EIGHT: Score = frozen(
  buildTestScore(
    [
      ...[60, 62, 64, 65, 67, 69].map((midi, i) => ({
        midi,
        startTick: i * EIGHTH,
        durationTicks: EIGHTH,
      })),
      { midi: 72, startTick: 1440, durationTicks: dotted(QUARTER) },
      { midi: 67, startTick: 2160, durationTicks: dotted(QUARTER) },
    ],
    {
      id: 'fixture-six-eight',
      title: 'Six Eight',
      timeSignature: { beats: 6, beatType: 8 },
      pickupTicks: 0,
    },
  ),
)

/**
 * Two tempo marks: 120 bpm from the top, 72 bpm from bar 2 (tick 1920).
 *   bar 1  C4 D4 E4 F4 quarters | bar 2  G4 whole note
 */
export const TEMPO_CHANGE: Score = frozen(
  buildTestScore(
    [
      { midi: 60, startTick: 0 },
      { midi: 62, startTick: 480 },
      { midi: 64, startTick: 960 },
      { midi: 65, startTick: 1440 },
      { midi: 67, startTick: 1920, durationTicks: WHOLE },
    ],
    {
      id: 'fixture-tempo-change',
      title: 'Tempo Change',
      tempos: [
        { tick: 0, bpm: 120 },
        { tick: 1920, bpm: 72 },
      ],
    },
  ),
)

/**
 * A grand staff whose UPPER staff turns bass clef mid-piece — the shape the
 * MusicXML parser produces for `mid-score-changes`, and the reason a staff
 * cannot be identified with a hand. Four bars of 4/4. Staff 1 is declared with
 * the clef it OPENED with (treble/right) and staff 2 is the ordinary bass staff:
 *   staff 1  bar 1  C5 D5 E5 F5 quarters   right hand
 *            bar 2  G5 whole               right hand
 *            bar 3  C3 half, E3 half       left hand — the clef has turned bass
 *            bar 4  G3 whole               left hand
 *   staff 2  bars 1–4  C2 whole notes      left hand — a plain pedal line
 * So three notes carry `hand: 'left'` while standing on a staff whose `hand` is
 * 'right'. Anything that filters staves by hand alone breaks here: muting the
 * right hand keeps notes on BOTH staves, while the declared hands name only
 * staff 2. The second staff is what makes that discriminating — with one staff
 * the wrong answer (no staves at all) is indistinguishable from the fallback
 * `filterHands` applies when nothing survives.
 */
export const MID_PIECE_CLEF_CHANGE: Score = frozen(
  makeScore({
    id: 'fixture-mid-piece-clef-change',
    meta: { title: 'Mid Piece Clef Change', composer: 'Test' },
    measures: [{}, {}, {}, {}],
    notes: [
      ...[72, 74, 76, 77].map((midi, i) => ({
        midi,
        startTick: i * QUARTER,
        durationTicks: QUARTER,
        hand: 'right' as const,
        staff: 1,
      })),
      { midi: 79, startTick: WHOLE, durationTicks: WHOLE, hand: 'right' as const, staff: 1 },
      { midi: 48, startTick: 2 * WHOLE, durationTicks: HALF, hand: 'left' as const, staff: 1 },
      {
        midi: 52,
        startTick: 2 * WHOLE + HALF,
        durationTicks: HALF,
        hand: 'left' as const,
        staff: 1,
      },
      { midi: 55, startTick: 3 * WHOLE, durationTicks: WHOLE, hand: 'left' as const, staff: 1 },
      ...[0, 1, 2, 3].map((bar) => ({
        midi: 36,
        startTick: bar * WHOLE,
        durationTicks: WHOLE,
        hand: 'left' as const,
        staff: 2,
      })),
    ],
    staves: [
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ],
  }),
)

/** Every fixture, for suites that want to sweep the model over all of them. */
export const ALL_FIXTURES: readonly Score[] = Object.freeze([
  SINGLE_NOTE,
  C_MAJOR_SCALE_RH,
  TWO_HAND_CHORDS,
  TIED_NOTES,
  PICKUP_MEASURE,
  SIX_EIGHT,
  TEMPO_CHANGE,
  MID_PIECE_CLEF_CHANGE,
])
