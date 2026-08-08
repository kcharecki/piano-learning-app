/**
 * Harmony demonstration scores — chords, progressions, cadences and relative
 * keys — split out of `demoScores.ts` on file-size grounds (eslint
 * `max-lines`), not on a functional boundary: these are ordinary entries in
 * that module's `DEMO_SCORES` registry, spliced in by `demoScores.ts` itself.
 * See that file's module doc for the registry's purpose and conventions.
 */
import { makeScore, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { buildChord, invertChord, type Chord } from '@core/theory/chords.ts'
import { spell, toMidi } from '@core/theory/pitch.ts'
import type { DemoScore } from './demoScoreTypes.ts'

const Q = 480
const W = Q * 4

/** Every pitch struck together (a block chord). */
function chordNotes(
  hand: 'left' | 'right',
  startTick: number,
  duration: number,
  pitches: readonly number[],
): ScoreNoteInput[] {
  return pitches.map((p) => ({ midi: p, startTick, durationTicks: duration, hand }))
}

function run(
  hand: 'left' | 'right',
  startTick: number,
  duration: number,
  pitches: readonly number[],
): ScoreNoteInput[] {
  return pitches.map((p, i) => ({
    midi: p,
    startTick: startTick + i * duration,
    durationTicks: duration,
    hand,
  }))
}

const midisOf = (c: Chord): readonly number[] => c.notes.map(toMidi)

const G2 = 43
const C3 = 48
const F3 = 53
const C4 = 60
const E4 = 64
const G4 = 67
const C5 = 72

const C_MAJOR_TRIAD = buildChord(spell('C', 0, 4), 'major', 0)
const F_MAJOR_TRIAD = buildChord(spell('F', 0, 4), 'major', 0)
const G_MAJOR_TRIAD = buildChord(spell('G', 0, 4), 'major', 0)
const A_MINOR_TRIAD = buildChord(spell('A', 0, 4), 'minor', 0)

// ---------------------------------------------------------------------------
// the C major triad, blocked then broken
// ---------------------------------------------------------------------------

const C_MAJOR_TRIAD_BLOCKED: Score = makeScore({
  id: 'demo-c-major-triad-blocked',
  meta: { title: 'C Major Triad — Blocked' },
  measures: [{}, {}, {}, {}],
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
  measures: [{}],
  notes: run('right', 0, Q / 2, [C4, E4, G4, C5, G4, E4, C4]),
})

// ---------------------------------------------------------------------------
// I-V-I and I-IV-V-I progressions in C, blocked chords over LH roots
// ---------------------------------------------------------------------------

const I_V_I_C_MAJOR: Score = makeScore({
  id: 'demo-i-v-i-c-major',
  meta: { title: 'I–V–I Progression in C Major' },
  measures: [{}, {}, {}],
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
  measures: [{}, {}, {}, {}],
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
// I-IV-I in C major (roadmap 5.9a) — `l2-i-iv-v-i-progression`'s own prose
// says combining IV with V comes later, so its demo must stop at IV, not the
// full I-IV-V-I above.
// ---------------------------------------------------------------------------

const I_IV_I_C_MAJOR: Score = makeScore({
  id: 'demo-i-iv-i-c-major',
  meta: { title: 'I–IV–I Progression in C Major' },
  measures: [{}, {}, {}],
  notes: [
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [F3]),
    ...chordNotes('right', W, W, midisOf(F_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [C3]),
    ...chordNotes('right', W * 2, W, midisOf(C_MAJOR_TRIAD)),
  ],
})

// ---------------------------------------------------------------------------
// perfect authentic cadence in C — root position V then I, RH melody landing
// on the tonic (the soprano condition `classifyCadence` checks)
// ---------------------------------------------------------------------------

const AUTHENTIC_CADENCE_C_MAJOR: Score = makeScore({
  id: 'demo-authentic-cadence-c-major',
  meta: { title: 'Perfect Authentic Cadence in C Major' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('left', 0, W, [G2]),
    ...chordNotes('right', 0, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [C3]),
    ...chordNotes('right', W, W, [...midisOf(C_MAJOR_TRIAD), C5]),
  ],
})

// ---------------------------------------------------------------------------
// C major and A minor triads, back to back (roadmap 5.9a) — relative keys
// share a key signature (no sharps or flats).
// ---------------------------------------------------------------------------

const C_MAJOR_AND_A_MINOR_TRIADS: Score = makeScore({
  id: 'demo-c-major-and-a-minor-triads',
  meta: { title: 'C Major and A Minor Triads — Relative Keys' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('right', W, W, midisOf(A_MINOR_TRIAD)),
  ],
})

export const HARMONY_DEMO_SCORES: readonly DemoScore[] = [
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
    id: 'demo-i-iv-i-c-major',
    title: 'I–IV–I Progression in C Major',
    description: 'The tonic-subdominant-tonic progression in C major, as blocked chords over left-hand roots — stops at IV, without the dominant.',
    score: I_IV_I_C_MAJOR,
  },
  {
    id: 'demo-authentic-cadence-c-major',
    title: 'Perfect Authentic Cadence in C Major',
    description: 'A root-position V-I cadence in C major with the melody landing on the tonic — the strongest way a phrase can end.',
    score: AUTHENTIC_CADENCE_C_MAJOR,
  },
  {
    id: 'demo-c-major-and-a-minor-triads',
    title: 'C Major and A Minor Triads — Relative Keys',
    description:
      'The C major triad, then the A minor triad — the same three white keys, C-E-G and A-C-E, starting from a different note.',
    score: C_MAJOR_AND_A_MINOR_TRIADS,
  },
]
