/**
 * Demonstration scores — REQ-3.1.3: a lesson is never introduced without a
 * demonstration the app can play, so `validateCurriculum` requires every
 * lesson to name a non-empty `demoScoreId`. Authoring 30 MusicXML files by
 * hand is the wrong shape for that; this is a small, hand-picked registry of
 * short teaching examples built directly with the core score constructors —
 * data, diffable, and unit-tested like any other module.
 *
 * Every demo is 1-6 bars, hands placed around middle C (RH at or above C4,
 * LH at or below C4) — the range a levels 1-3 curriculum actually plays; this
 * is enforced by a registry-wide range test in the co-located spec. Most
 * demos are in C major; a handful deliberately carry a different key
 * signature (or change key mid-score) to honestly demonstrate the key a
 * specific lesson teaches — see the four key-signature demonstrations
 * appended at the end of `DEMO_SCORES`. Chord-based demos build their
 * pitches from `@core/theory/chords.ts` rather than hand-typed MIDI numbers,
 * so the harmony is derived, not guessed.
 *
 * Consumed by the level 2/3 curriculum (`src/content/curriculum/lessonsLevel2.ts`,
 * `lessonsLevel3.ts`), which points `Lesson.demoScoreId` at these ids, and by
 * the lesson screen that resolves and plays them via `demoScoreById`.
 */
import {
  makeScore,
  type Hand,
  type MeasureInput,
  type Score,
  type ScoreNote,
  type ScoreNoteInput,
} from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { techniqueDrillById, techniqueScore, type TechniqueDrill } from '@core/technique/library.ts'
import { HARMONY_DEMO_SCORES } from './harmonyDemoScores.ts'
import type { DemoScore } from './demoScoreTypes.ts'

export type { DemoScore } from './demoScoreTypes.ts'

// ---------------------------------------------------------------------------
// tick helpers — note values in ticks, TICKS_PER_QUARTER-relative
// ---------------------------------------------------------------------------

const Q = TICKS_PER_QUARTER
const E = Q / 2
const H = Q * 2
const W = Q * 4

// ---------------------------------------------------------------------------
// note-building helpers
// ---------------------------------------------------------------------------

/** One note per pitch, spaced `duration` ticks apart starting at `startTick`.
 *  `fingers[i]`, when given, becomes that note's fingering. */
function run(
  hand: Hand,
  startTick: number,
  duration: number,
  pitches: readonly number[],
  fingers?: readonly number[],
): ScoreNoteInput[] {
  return pitches.map((p, i) => {
    const fingering = fingers === undefined ? undefined : fingers[i]
    return {
      midi: p,
      startTick: startTick + i * duration,
      durationTicks: duration,
      hand,
      ...(fingering === undefined ? {} : { fingering }),
    }
  })
}

/** Every pitch struck together (a block chord). */
function chordNotes(
  hand: Hand,
  startTick: number,
  duration: number,
  pitches: readonly number[],
): ScoreNoteInput[] {
  return pitches.map((p) => ({ midi: p, startTick, durationTicks: duration, hand }))
}

/** `count` bare measures, inheriting 4/4 / C major unless `first` overrides the first one. */
function bars(count: number, first?: { readonly beats: number; readonly beatType: number }): MeasureInput[] {
  return Array.from({ length: count }, (_, i) => (i === 0 && first ? { timeSignature: first } : {}))
}

/** Rebuild an already-placed `ScoreNote` as fresh input, shifted by `offset` ticks and
 *  `midiOffset` semitones — used to splice a technique-library render (a hands-alone run)
 *  into a bigger, hands-separately demo. */
function toInput(n: ScoreNote, offset: number, midiOffset = 0): ScoreNoteInput {
  return {
    midi: n.midi + midiOffset,
    startTick: n.startTick + offset,
    durationTicks: n.durationTicks,
    hand: n.hand,
    voice: n.voice,
    staff: n.staff,
    velocity: n.velocity,
    tiedFrom: n.tiedFrom,
    tiedTo: n.tiedTo,
    ...(n.fingering === undefined ? {} : { fingering: n.fingering }),
  }
}

function drill(id: string): TechniqueDrill {
  const found = techniqueDrillById(id)
  if (found === undefined) throw new Error(`demoScores: unknown technique drill '${id}'`)
  return found
}

// ---------------------------------------------------------------------------
// MIDI note names, around middle C (60)
// ---------------------------------------------------------------------------

const F2 = 41
const A2 = 45
const C3 = 48
const D3 = 50
const E3 = 52
const F3 = 53
const G3 = 55
const A3 = 57
const B3 = 59
const C4 = 60
const Cs4 = 61
const D4 = 62
const Eb4 = 63
const E4 = 64
const F4 = 65
const Fs4 = 66
const G4 = 67
const A4 = 69
const Bb4 = 70
const C5 = 72

// ---------------------------------------------------------------------------
// 1-2. middle C position, hands separately
// ---------------------------------------------------------------------------

const MIDDLE_C_POSITION_RH: Score = makeScore({
  id: 'demo-middle-c-position-rh',
  meta: { title: 'Middle C Position — Right Hand' },
  measures: bars(3),
  tempos: [{ tick: 0, bpm: 72 }],
  notes: [
    ...run('right', 0, Q, [C4, D4, E4, F4], [1, 2, 3, 4]),
    ...run('right', H * 2, Q, [G4, F4, E4, D4], [5, 4, 3, 2]),
    ...run('right', H * 4, W, [C4], [1]),
  ],
})

const MIDDLE_C_POSITION_LH: Score = makeScore({
  id: 'demo-middle-c-position-lh',
  meta: { title: 'Middle C Position — Left Hand' },
  measures: bars(3),
  tempos: [{ tick: 0, bpm: 72 }],
  notes: [
    ...run('left', 0, Q, [C4, B3, A3, G3], [1, 2, 3, 4]),
    ...run('left', H * 2, Q, [F3, G3, A3, B3], [5, 4, 3, 2]),
    ...run('left', H * 4, W, [C4], [1]),
  ],
})

// ---------------------------------------------------------------------------
// 3. five-finger C major pattern, hands separately (reuses the technique
//    library's own drill for the pitches/fingerings — see REQ-3.7.1)
// ---------------------------------------------------------------------------

const FIVE_FINGER_RH = techniqueScore(drill('five-finger-c-major-hands-right'), 66)
const FIVE_FINGER_LH = techniqueScore(drill('five-finger-c-major-hands-left'), 66)

const FIVE_FINGER_C_MAJOR: Score = makeScore({
  id: 'demo-five-finger-c-major-hands-separately',
  meta: { title: 'Five-Finger C Major Pattern — Hands Separately' },
  measures: bars(6),
  tempos: [{ tick: 0, bpm: 66 }],
  notes: [
    ...FIVE_FINGER_RH.notes.map((n) => toInput(n, 0)),
    ...FIVE_FINGER_LH.notes.map((n) => toInput(n, 3 * W, -12)),
  ],
})

// ---------------------------------------------------------------------------
// 4. steps vs skips
// ---------------------------------------------------------------------------

const STEPS_VS_SKIPS: Score = makeScore({
  id: 'demo-steps-vs-skips',
  meta: { title: 'Steps vs Skips' },
  measures: bars(4),
  notes: [
    ...run('right', 0, H, [C4, D4]),
    ...run('right', W, H, [C4, E4]),
    ...run('right', W * 2, H, [D4, E4]),
    ...run('right', W * 3, H, [D4, F4]),
  ],
})

// ---------------------------------------------------------------------------
// 5. C major one-octave scale, right hand (reuses the technique library)
// ---------------------------------------------------------------------------

const C_MAJOR_SCALE_RH: Score = {
  ...techniqueScore(drill('scale-c-major-1oct-hands-right'), 72),
  id: 'demo-c-major-scale-one-octave-rh',
  meta: { title: 'C Major Scale, One Octave — Right Hand', composer: '' },
}

// ---------------------------------------------------------------------------
// 6. rhythm reading in 4/4 — whole, half, quarter, on a single pitch so only
//    the rhythm changes
// ---------------------------------------------------------------------------

const RHYTHM_4_4: Score = makeScore({
  id: 'demo-rhythm-reading-4-4',
  meta: { title: 'Rhythm Reading — Whole, Half and Quarter Notes in 4/4' },
  measures: bars(3),
  notes: [
    ...run('right', 0, W, [C4]),
    ...run('right', W, H, [C4, C4]),
    ...run('right', W * 2, Q, [C4, C4, C4, C4]),
  ],
})

// ---------------------------------------------------------------------------
// 7. 3/4 waltz-feel rhythm — LH root on beat 1, RH chord tones on 2 and 3
// ---------------------------------------------------------------------------

const WALTZ_BAR = 3 * Q

const WALTZ_3_4: Score = makeScore({
  id: 'demo-waltz-rhythm-3-4',
  meta: { title: 'Waltz-Feel Rhythm in 3/4' },
  measures: bars(2, { beats: 3, beatType: 4 }),
  notes: [
    ...run('left', 0, Q, [C3]),
    ...run('right', Q, Q, [E4, G4]),
    ...run('left', WALTZ_BAR, Q, [C3]),
    ...run('right', WALTZ_BAR + Q, Q, [E4, G4]),
  ],
})

// ---------------------------------------------------------------------------
// 8-9, 10-11, 12: the C major triad (blocked/broken), I-V-I, I-IV-V-I and
// the perfect authentic cadence live in `harmonyDemoScores.ts` — moved out
// on file-size grounds, spliced into `DEMO_SCORES` below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 13. hands-together parallel motion in C position
// ---------------------------------------------------------------------------

const HANDS_TOGETHER_PARALLEL_MOTION: Score = makeScore({
  id: 'demo-hands-together-parallel-motion-c',
  meta: { title: 'Hands Together — Parallel Motion in C Position' },
  measures: bars(2),
  notes: [
    ...run('right', 0, Q, [C4, D4, E4, F4]),
    ...run('left', 0, Q, [C3, D3, E3, F3]),
    ...run('right', W, Q, [G4, F4, E4, D4]),
    ...run('left', W, Q, [G3, F3, E3, D3]),
  ],
})

// ---------------------------------------------------------------------------
// 14. a simple two-hand piece: LH held root under a RH melody
// ---------------------------------------------------------------------------

const LH_ROOT_RH_MELODY: Score = makeScore({
  id: 'demo-lh-root-rh-melody-simple-piece',
  meta: { title: 'Simple Piece — Left-Hand Held Root, Right-Hand Melody' },
  measures: bars(3),
  notes: [
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('left', W, W, [C3]),
    ...chordNotes('left', W * 2, W, [C3]),
    ...run('right', 0, Q, [C4, D4, E4, F4]),
    ...run('right', W, Q, [G4, F4, E4, D4]),
    ...run('right', W * 2, W, [C4]),
  ],
})

// ---------------------------------------------------------------------------
// 15-16. one-octave scales in the keys levels 2/3 actually teach — reuses the
//        technique library, same construction as C_MAJOR_SCALE_RH
// ---------------------------------------------------------------------------

const G_MAJOR_SCALE_RH: Score = {
  ...techniqueScore(drill('scale-g-major-1oct-hands-right'), 72),
  id: 'demo-g-major-scale-one-octave-rh',
  meta: { title: 'G Major Scale, One Octave — Right Hand', composer: '' },
}

const F_MAJOR_SCALE_RH: Score = {
  ...techniqueScore(drill('scale-f-major-1oct-hands-right'), 72),
  id: 'demo-f-major-scale-one-octave-rh',
  meta: { title: 'F Major Scale, One Octave — Right Hand', composer: '' },
}

// ---------------------------------------------------------------------------
// 19. C major scale, two octaves, hands together, two octaves apart (roadmap
//     5.9a — reuses the level-3 technique drill of the same shape, the exact
//     scale `l3-two-octave-scales-hands-together-ex1` already drills, so the
//     demonstration and the exercise agree). `HAND_OCTAVE_OFFSET` in
//     `@core/technique/library.ts` places every hands-together drill's left
//     hand two octaves below the right, not one — keeping the left hand at
//     or below middle C throughout, same as every other demo here.
// ---------------------------------------------------------------------------

const C_MAJOR_SCALE_2OCT_HANDS_TOGETHER: Score = {
  ...techniqueScore(drill('scale-c-major-2oct-hands-together'), 72),
  id: 'demo-c-major-scale-two-octaves-hands-together',
  meta: { title: 'C Major Scale, Two Octaves — Hands Together', composer: '' },
}

// ---------------------------------------------------------------------------
// 20. eighth notes in 4/4 (roadmap 5.9a) — same single-repeated-pitch
//     convention as RHYTHM_4_4, extended to the finer subdivision: two
//     quarters, then four eighths, then a full bar of eighths.
// ---------------------------------------------------------------------------

const RHYTHM_EIGHTH_NOTES: Score = makeScore({
  id: 'demo-rhythm-reading-eighth-notes',
  meta: { title: 'Rhythm Reading — Eighth Notes in 4/4' },
  measures: bars(2),
  notes: [
    ...run('right', 0, Q, [C4, C4]),
    ...run('right', H, E, [C4, C4, C4, C4]),
    ...run('right', W, E, [C4, C4, C4, C4, C4, C4, C4, C4]),
  ],
})

// ---------------------------------------------------------------------------
// 21. dotted quarter + eighth, the "long-short" pattern (roadmap 5.9a) — same
//     3/4 waltz metre as WALTZ_3_4 (reuses WALTZ_BAR), single repeated pitch
//     so only the rhythm changes, same convention as RHYTHM_4_4.
// ---------------------------------------------------------------------------

const DOTTED_Q = Q + E

const DOTTED_RHYTHM_3_4: Score = makeScore({
  id: 'demo-dotted-rhythm-3-4',
  meta: { title: 'Dotted Rhythm in 3/4' },
  measures: bars(2, { beats: 3, beatType: 4 }),
  notes: [
    ...run('right', 0, DOTTED_Q, [C4]),
    ...run('right', DOTTED_Q, E, [C4]),
    ...run('right', DOTTED_Q + E, Q, [C4]),
    ...run('right', WALTZ_BAR, DOTTED_Q, [C4]),
    ...run('right', WALTZ_BAR + DOTTED_Q, E, [C4]),
    ...run('right', WALTZ_BAR + DOTTED_Q + E, Q, [C4]),
  ],
})

// ---------------------------------------------------------------------------
// 22. I-IV-I in C major lives in `harmonyDemoScores.ts` (roadmap 5.9a —
//     `l2-i-iv-v-i-progression`'s prose says combining IV with V comes
//     later, so its demo must stop at IV).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 23. circle of fifths — C, then its clockwise neighbour G (+1 sharp) and its
//     counter-clockwise neighbour F (-1 flat) (roadmap 5.9a). Same
//     four-note-run-per-key-pair shape as KEY_SIGNATURES_G_AND_F below, so
//     the same pitch-class assertions apply, with a C major pair prepended.
// ---------------------------------------------------------------------------

const CIRCLE_OF_FIFTHS_C_G_F: Score = makeScore({
  id: 'demo-circle-of-fifths-c-g-f',
  meta: { title: 'Circle of Fifths — C, Then Its Neighbours G and F' },
  measures: [{ keyFifths: 0 }, {}, { keyFifths: 1 }, {}, { keyFifths: -1 }, {}],
  notes: [
    ...run('right', 0, Q, [C4, D4, E4, F4]),
    ...run('right', W, Q, [G4, F4, E4, D4]),
    ...run('right', W * 2, Q, [C4, D4, E4, Fs4]),
    ...run('right', W * 3, Q, [G4, Fs4, E4, D4]),
    ...run('right', W * 4, Q, [F4, G4, A4, Bb4]),
    ...run('right', W * 5, Q, [C5, Bb4, A4, G4]),
  ],
})

// ---------------------------------------------------------------------------
// 24. C major and A minor triads, back to back, lives in
//     `harmonyDemoScores.ts` (roadmap 5.9a — relative keys share a key
//     signature).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 25. contrary motion with different rhythms in each hand (roadmap 5.9a) —
//     the two-hand-coordination lesson's prose explicitly promises "beyond
//     parallel motion... different rhythms... different directions", which
//     HANDS_TOGETHER_PARALLEL_MOTION (same direction, same rhythm) does not
//     show. Bar 1: RH rises in quarters while LH falls in halves; bar 2
//     mirrors it (RH falls, LH rises) so both bars are genuinely contrary.
// ---------------------------------------------------------------------------

const CONTRARY_MOTION_DIFFERENT_RHYTHMS: Score = makeScore({
  id: 'demo-contrary-motion-different-rhythms-c',
  meta: { title: 'Hands Together — Contrary Motion, Different Rhythms' },
  measures: bars(2),
  notes: [
    ...run('right', 0, Q, [C4, D4, E4, F4]),
    ...run('left', 0, H, [C3, A2]),
    ...run('right', W, Q, [G4, F4, E4, D4]),
    ...run('left', W, H, [F2, C3]),
  ],
})

// ---------------------------------------------------------------------------
// 17-18. key-signature demonstrations — the key CHANGES mid-score so the
//        learner hears the one note each signature adds, right hand only,
//        hand-authored (no technique drill covers a mid-piece key change)
// ---------------------------------------------------------------------------

const KEY_SIGNATURES_G_AND_F: Score = makeScore({
  id: 'demo-key-signatures-g-and-f',
  meta: { title: 'Key Signatures — One Sharp, Then One Flat' },
  measures: [{ keyFifths: 1 }, {}, { keyFifths: -1 }, {}],
  notes: [
    ...run('right', 0, Q, [C4, D4, E4, Fs4]),
    ...run('right', W, Q, [G4, Fs4, E4, D4]),
    ...run('right', W * 2, Q, [F4, G4, A4, Bb4]),
    ...run('right', W * 3, Q, [C5, Bb4, A4, G4]),
  ],
})

const KEYS_D_MAJOR_AND_B_FLAT_MAJOR: Score = makeScore({
  id: 'demo-keys-d-major-and-b-flat-major',
  meta: { title: 'Key Signatures — Two Sharps, Then Two Flats' },
  measures: [{ keyFifths: 2 }, {}, { keyFifths: -2 }, {}],
  notes: [
    ...run('right', 0, Q, [Cs4, D4, E4, Fs4]),
    ...run('right', W, Q, [G4, Fs4, E4, D4]),
    ...run('right', W * 2, Q, [Eb4, F4, G4, A4]),
    ...run('right', W * 3, Q, [Bb4, A4, G4, F4]),
  ],
})

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/** Every demonstration, in a deterministic authored order. */
export const DEMO_SCORES: readonly DemoScore[] = [
  {
    id: 'demo-middle-c-position-rh',
    title: 'Middle C Position — Right Hand',
    description:
      'Places the right hand in the middle C position: thumb on middle C, fingers 2-5 resting on D-E-F-G.',
    score: MIDDLE_C_POSITION_RH,
  },
  {
    id: 'demo-middle-c-position-lh',
    title: 'Middle C Position — Left Hand',
    description:
      'Places the left hand in the middle C position: thumb on middle C, fingers 2-5 resting on B-A-G-F below it.',
    score: MIDDLE_C_POSITION_LH,
  },
  {
    id: 'demo-five-finger-c-major-hands-separately',
    title: 'Five-Finger C Major Pattern — Hands Separately',
    description:
      'The classic 1-2-3-4-5-4-3-2-1 five-finger pattern in C major, played by the right hand and then the left.',
    score: FIVE_FINGER_C_MAJOR,
  },
  {
    id: 'demo-steps-vs-skips',
    title: 'Steps vs Skips',
    description:
      'Contrasts a step (a second, adjacent white keys) with a skip (a third, one key apart) on neighbouring pairs of notes.',
    score: STEPS_VS_SKIPS,
  },
  {
    id: 'demo-c-major-scale-one-octave-rh',
    title: 'C Major Scale, One Octave — Right Hand',
    description: 'The C major scale ascending and descending one octave, right hand, with standard fingering.',
    score: C_MAJOR_SCALE_RH,
  },
  {
    id: 'demo-rhythm-reading-4-4',
    title: 'Rhythm Reading — Whole, Half and Quarter Notes in 4/4',
    description:
      'A single repeated pitch in 4/4 so only the rhythm changes: one whole note, two half notes, four quarter notes.',
    score: RHYTHM_4_4,
  },
  {
    id: 'demo-waltz-rhythm-3-4',
    title: 'Waltz-Feel Rhythm in 3/4',
    description: 'An "oom-pah-pah" waltz texture in 3/4: a left-hand root on beat 1 under right-hand notes on beats 2 and 3.',
    score: WALTZ_3_4,
  },
  // The C major triad (blocked/broken), I-V-I, I-IV-V-I, I-IV-I, the perfect
  // authentic cadence, and C major/A minor as relative keys — see
  // `harmonyDemoScores.ts`.
  ...HARMONY_DEMO_SCORES,
  {
    id: 'demo-hands-together-parallel-motion-c',
    title: 'Hands Together — Parallel Motion in C Position',
    description: 'Both hands move in the same direction, an octave apart, up through C-D-E-F and back down through G-F-E-D.',
    score: HANDS_TOGETHER_PARALLEL_MOTION,
  },
  {
    id: 'demo-lh-root-rh-melody-simple-piece',
    title: 'Simple Piece — Left-Hand Held Root, Right-Hand Melody',
    description:
      'A short two-hand piece: the left hand holds a low C (an octave below middle C) as a sustained root while the right hand plays a simple melody above it.',
    score: LH_ROOT_RH_MELODY,
  },
  {
    id: 'demo-g-major-scale-one-octave-rh',
    title: 'G Major Scale, One Octave — Right Hand',
    description: 'The G major scale ascending and descending one octave, right hand, with standard fingering — one sharp, F#.',
    score: G_MAJOR_SCALE_RH,
  },
  {
    id: 'demo-f-major-scale-one-octave-rh',
    title: 'F Major Scale, One Octave — Right Hand',
    description: 'The F major scale ascending and descending one octave, right hand, with standard fingering — one flat, Bb.',
    score: F_MAJOR_SCALE_RH,
  },
  {
    id: 'demo-c-major-scale-two-octaves-hands-together',
    title: 'C Major Scale, Two Octaves — Hands Together',
    description:
      'The C major scale ascending and descending two octaves, hands together two octaves apart — the same scale the level-3 technique drill plays.',
    score: C_MAJOR_SCALE_2OCT_HANDS_TOGETHER,
  },
  {
    id: 'demo-rhythm-reading-eighth-notes',
    title: 'Rhythm Reading — Eighth Notes in 4/4',
    description:
      'A single repeated pitch in 4/4 so only the rhythm changes: two quarter notes, four eighth notes, then a full bar of eighth notes.',
    score: RHYTHM_EIGHTH_NOTES,
  },
  {
    id: 'demo-dotted-rhythm-3-4',
    title: 'Dotted Rhythm in 3/4',
    description:
      'A single repeated pitch in 3/4: a dotted quarter note followed by an eighth note (the "long-short" pattern), then a plain quarter to close the bar.',
    score: DOTTED_RHYTHM_3_4,
  },
  {
    id: 'demo-circle-of-fifths-c-g-f',
    title: 'Circle of Fifths — C, Then Its Neighbours G and F',
    description:
      'The same short stepwise phrase in three keys: C major (no sharps or flats), then its clockwise neighbour G major (one sharp), then its counter-clockwise neighbour F major (one flat).',
    score: CIRCLE_OF_FIFTHS_C_G_F,
  },
  {
    id: 'demo-contrary-motion-different-rhythms-c',
    title: 'Hands Together — Contrary Motion, Different Rhythms',
    description:
      'The two hands move in opposite directions with different note values: the right hand in quarter notes one way, the left hand in half notes the other.',
    score: CONTRARY_MOTION_DIFFERENT_RHYTHMS,
  },
  {
    id: 'demo-key-signatures-g-and-f',
    title: 'Key Signatures — One Sharp, Then One Flat',
    description:
      'The same short stepwise phrase in two keys: two bars in G major, where the key signature makes every F sound as F#, then two bars in F major, where it makes every B sound as Bb.',
    score: KEY_SIGNATURES_G_AND_F,
  },
  {
    id: 'demo-keys-d-major-and-b-flat-major',
    title: 'Key Signatures — Two Sharps, Then Two Flats',
    description:
      'The same short stepwise phrase in two keys: two bars in D major, whose two sharps raise F and C, then two bars in B-flat major, whose two flats lower B and E.',
    score: KEYS_D_MAJOR_AND_B_FLAT_MAJOR,
  },
]

const DEMO_SCORES_BY_ID: ReadonlyMap<string, DemoScore> = new Map(DEMO_SCORES.map((d) => [d.id, d]))

export function demoScoreById(id: string): DemoScore | undefined {
  return DEMO_SCORES_BY_ID.get(id)
}
