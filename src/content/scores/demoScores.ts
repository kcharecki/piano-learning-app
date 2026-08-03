/**
 * Demonstration scores — REQ-3.1.3: a lesson is never introduced without a
 * demonstration the app can play, so `validateCurriculum` requires every
 * lesson to name a non-empty `demoScoreId`. Authoring 30 MusicXML files by
 * hand is the wrong shape for that; this is a small, hand-picked registry of
 * short teaching examples built directly with the core score constructors —
 * data, diffable, and unit-tested like any other module.
 *
 * Every demo is 1-6 bars, in C major, hands placed around middle C (RH at or
 * above C4, LH at or below C4) — the range a levels 1-3 curriculum actually
 * plays; this is enforced by a registry-wide range test in the co-located
 * spec. Chord-based demos build their pitches from `@core/theory/chords.ts`
 * rather than hand-typed MIDI numbers, so the harmony is derived, not guessed.
 *
 * Not consumed yet: the curriculum content that assigns these ids to lessons,
 * and the lesson screen that plays them, are both scheduled as the NEXT task
 * (roadmap 3.7/4.9 follow-on). Nothing imports this file yet.
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
import { buildChord, invertChord, type Chord } from '@core/theory/chords.ts'
import { spell, toMidi } from '@core/theory/pitch.ts'

export type DemoScore = {
  /** Stable, kebab-case, content-derived. Referenced by `Lesson.demoScoreId`. */
  readonly id: string
  /** Shown to the learner above the engraving. */
  readonly title: string
  /** One or two sentences: what this demonstration is FOR. */
  readonly description: string
  readonly score: Score
}

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

const midisOf = (c: Chord): readonly number[] => c.notes.map(toMidi)

// ---------------------------------------------------------------------------
// MIDI note names, around middle C (60)
// ---------------------------------------------------------------------------

const G2 = 43
const C3 = 48
const D3 = 50
const E3 = 52
const F3 = 53
const G3 = 55
const A3 = 57
const B3 = 59
const C4 = 60
const D4 = 62
const E4 = 64
const F4 = 65
const G4 = 67
const C5 = 72

// ---------------------------------------------------------------------------
// C major triads used by the harmony demos — derived, not hand-typed
// ---------------------------------------------------------------------------

const C_MAJOR_TRIAD = buildChord(spell('C', 0, 4), 'major', 0)
const F_MAJOR_TRIAD = buildChord(spell('F', 0, 4), 'major', 0)
const G_MAJOR_TRIAD = buildChord(spell('G', 0, 4), 'major', 0)

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
// 8-9. the C major triad, blocked then broken
// ---------------------------------------------------------------------------

const C_MAJOR_TRIAD_BLOCKED: Score = makeScore({
  id: 'demo-c-major-triad-blocked',
  meta: { title: 'C Major Triad — Blocked' },
  measures: bars(4),
  notes: [
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('right', W, W, midisOf(invertChord(C_MAJOR_TRIAD, 1))),
    ...chordNotes('right', W * 2, W, midisOf(invertChord(C_MAJOR_TRIAD, 2))),
    ...chordNotes('right', W * 3, W, midisOf(C_MAJOR_TRIAD)),
  ],
})

const C_MAJOR_TRIAD_BROKEN: Score = makeScore({
  id: 'demo-c-major-triad-broken',
  meta: { title: 'C Major Triad — Broken' },
  measures: bars(1),
  notes: run('right', 0, E, [C4, E4, G4, C5, G4, E4, C4]),
})

// ---------------------------------------------------------------------------
// 10-11. I-V-I and I-IV-V-I progressions in C, blocked chords over LH roots
// ---------------------------------------------------------------------------

const I_V_I_C_MAJOR: Score = makeScore({
  id: 'demo-i-v-i-c-major',
  meta: { title: 'I–V–I Progression in C Major' },
  measures: bars(3),
  notes: [
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [G2]),
    ...chordNotes('right', W, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [C3]),
    ...chordNotes('right', W * 2, W, midisOf(C_MAJOR_TRIAD)),
  ],
})

const I_IV_V_I_C_MAJOR: Score = makeScore({
  id: 'demo-i-iv-v-i-c-major',
  meta: { title: 'I–IV–V–I Progression in C Major' },
  measures: bars(4),
  notes: [
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [F3]),
    ...chordNotes('right', W, W, midisOf(F_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [G2]),
    ...chordNotes('right', W * 2, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 3, W, [C3]),
    ...chordNotes('right', W * 3, W, midisOf(C_MAJOR_TRIAD)),
  ],
})

// ---------------------------------------------------------------------------
// 12. perfect authentic cadence in C — root position V then I, RH melody
//     landing on the tonic (the soprano condition `classifyCadence` checks)
// ---------------------------------------------------------------------------

const AUTHENTIC_CADENCE_C_MAJOR: Score = makeScore({
  id: 'demo-authentic-cadence-c-major',
  meta: { title: 'Perfect Authentic Cadence in C Major' },
  measures: bars(2),
  notes: [
    ...chordNotes('left', 0, W, [G2]),
    ...chordNotes('right', 0, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [C3]),
    ...chordNotes('right', W, W, [...midisOf(C_MAJOR_TRIAD), C5]),
  ],
})

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
  {
    id: 'demo-c-major-triad-blocked',
    title: 'C Major Triad — Blocked',
    description: 'The C major triad struck as a block chord through root position, first inversion, second inversion, and back.',
    score: C_MAJOR_TRIAD_BLOCKED,
  },
  {
    id: 'demo-c-major-triad-broken',
    title: 'C Major Triad — Broken',
    description: 'The same C major triad played one note at a time, ascending through the octave and back down.',
    score: C_MAJOR_TRIAD_BROKEN,
  },
  {
    id: 'demo-i-v-i-c-major',
    title: 'I–V–I Progression in C Major',
    description: 'The tonic-dominant-tonic progression in C major, as blocked chords over left-hand roots.',
    score: I_V_I_C_MAJOR,
  },
  {
    id: 'demo-i-iv-v-i-c-major',
    title: 'I–IV–V–I Progression in C Major',
    description: 'The tonic-subdominant-dominant-tonic progression in C major, as blocked chords over left-hand roots.',
    score: I_IV_V_I_C_MAJOR,
  },
  {
    id: 'demo-authentic-cadence-c-major',
    title: 'Perfect Authentic Cadence in C Major',
    description: 'A root-position V-I cadence in C major with the melody landing on the tonic — the strongest way a phrase can end.',
    score: AUTHENTIC_CADENCE_C_MAJOR,
  },
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
]

const DEMO_SCORES_BY_ID: ReadonlyMap<string, DemoScore> = new Map(DEMO_SCORES.map((d) => [d.id, d]))

export function demoScoreById(id: string): DemoScore | undefined {
  return DEMO_SCORES_BY_ID.get(id)
}
