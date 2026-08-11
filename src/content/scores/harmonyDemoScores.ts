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
import { scaleNotes } from '@core/theory/scales.ts'
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

const A2 = 45
const G2 = 43
const C3 = 48
const D3 = 50
const F3 = 53
const C4 = 60
const E4 = 64
const G4 = 67
const C5 = 72

const C_MAJOR_TRIAD = buildChord(spell('C', 0, 4), 'major', 0)
const D_MINOR_TRIAD = buildChord(spell('D', 0, 4), 'minor', 0)
const D_MAJOR_TRIAD = buildChord(spell('D', 0, 4), 'major', 0)
const F_MAJOR_TRIAD = buildChord(spell('F', 0, 4), 'major', 0)
const G_MAJOR_TRIAD = buildChord(spell('G', 0, 4), 'major', 0)
const G_DOMINANT_SEVENTH = buildChord(spell('G', 0, 4), 'dominant7', 0)
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

// ---------------------------------------------------------------------------
// roadmap 5.10 — real demonstrations for the six level 4-5 topics (roadmap
// 3.24) that had pointed at the closest existing-but-off-topic demo rather
// than at content of their own: a triad-inversion cycle standing in for a
// seventh chord, a bare V-I standing in for all four cadence types, one
// progression standing in for three, a chord pair standing in for the three
// minor scale forms, a plain I-V-I standing in for a secondary dominant, and
// a same-key circle-of-fifths run standing in for a modulation. Each of the
// six below plays exactly what its lesson's prose describes — see
// `demoScores.test.ts` for the content assertions reading these demos' own
// notes, the same 5.9a discipline applied to this task's own audit.
// ---------------------------------------------------------------------------

// ---- l4-seventh-chords: G major triad, then G dominant seventh ------------

const G_MAJOR_TO_G_DOMINANT_SEVENTH: Score = makeScore({
  id: 'demo-g-major-to-g-dominant-seventh',
  meta: { title: 'G Major Triad, Then G Dominant Seventh' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('left', 0, W, [G2]),
    ...chordNotes('right', 0, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [G2]),
    ...chordNotes('right', W, W, midisOf(G_DOMINANT_SEVENTH)),
  ],
})

// ---- l4-cadences: all four cadence types, each starting from I ------------
//
// I-V-I (perfect authentic), IV-I (plagal), I-V (half — ends ON V), V-vi
// (deceptive). `demoScores.test.ts` proves each pair with `classifyCadence`
// directly on the same `Chord` objects the notes below are built from, not a
// re-derivation — see that file for why.

const FOUR_CADENCES_C_MAJOR: Score = makeScore({
  id: 'demo-four-cadence-types-c-major',
  meta: { title: 'Four Cadence Types in C Major' },
  measures: [{}, {}, {}, {}, {}, {}, {}],
  notes: [
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [G2]),
    ...chordNotes('right', W, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [C3]),
    ...chordNotes('right', W * 2, W, [...midisOf(C_MAJOR_TRIAD), C5]),
    ...chordNotes('left', W * 3, W, [F3]),
    ...chordNotes('right', W * 3, W, midisOf(F_MAJOR_TRIAD)),
    ...chordNotes('left', W * 4, W, [C3]),
    ...chordNotes('right', W * 4, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W * 5, W, [G2]),
    ...chordNotes('right', W * 5, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 6, W, [A2]),
    ...chordNotes('right', W * 6, W, midisOf(A_MINOR_TRIAD)),
  ],
})

// ---- l4-common-progressions: I-IV-V-I, then ii-V-I, then I-vi-IV-V --------

const COMMON_PROGRESSIONS_C_MAJOR: Score = makeScore({
  id: 'demo-common-progressions-c-major',
  meta: { title: 'Common Progressions in C Major' },
  measures: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}],
  notes: [
    // I-IV-V-I
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [F3]),
    ...chordNotes('right', W, W, midisOf(F_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [G2]),
    ...chordNotes('right', W * 2, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 3, W, [C3]),
    ...chordNotes('right', W * 3, W, midisOf(C_MAJOR_TRIAD)),
    // ii-V-I
    ...chordNotes('left', W * 4, W, [D3]),
    ...chordNotes('right', W * 4, W, midisOf(D_MINOR_TRIAD)),
    ...chordNotes('left', W * 5, W, [G2]),
    ...chordNotes('right', W * 5, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 6, W, [C3]),
    ...chordNotes('right', W * 6, W, midisOf(C_MAJOR_TRIAD)),
    // I-vi-IV-V
    ...chordNotes('left', W * 7, W, [C3]),
    ...chordNotes('right', W * 7, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W * 8, W, [A2]),
    ...chordNotes('right', W * 8, W, midisOf(A_MINOR_TRIAD)),
    ...chordNotes('left', W * 9, W, [F3]),
    ...chordNotes('right', W * 9, W, midisOf(F_MAJOR_TRIAD)),
    ...chordNotes('left', W * 10, W, [G2]),
    ...chordNotes('right', W * 10, W, midisOf(G_MAJOR_TRIAD)),
  ],
})

// ---- l5-minor-scale-forms: A natural, harmonic, melodic minor ascending ---
//
// Same `scaleNotes` derivation as `diagramScores.ts`'s `MINOR_SCALE_FORMS_STAFF`
// (roadmap 3.24) — read off the scale builder, never hand-typed, so the three
// forms' differing 6th/7th degrees cannot silently drift from what
// `core/theory/scales.ts` actually defines.

const BAR8 = Q * 8
const A_NATURAL_MINOR_ASC = scaleNotes(spell('A', 0, 4), 'naturalMinor', 1).map(toMidi)
const A_HARMONIC_MINOR_ASC = scaleNotes(spell('A', 0, 4), 'harmonicMinor', 1).map(toMidi)
const A_MELODIC_MINOR_ASC = scaleNotes(spell('A', 0, 4), 'melodicMinor', 1).map(toMidi)

const MINOR_SCALE_THREE_FORMS: Score = makeScore({
  id: 'demo-a-minor-three-scale-forms',
  meta: { title: 'A Minor — Natural, Harmonic and Melodic, Ascending' },
  measures: [{}, {}, {}, {}, {}, {}],
  tempos: [{ tick: 0, bpm: 72 }],
  notes: [
    ...run('right', 0, Q, A_NATURAL_MINOR_ASC),
    ...run('right', BAR8, Q, A_HARMONIC_MINOR_ASC),
    ...run('right', BAR8 * 2, Q, A_MELODIC_MINOR_ASC),
  ],
})

// ---- l5-secondary-dominants: V/V (D major) resolving to V (G), then I -----

const SECONDARY_DOMINANT_V_OF_V: Score = makeScore({
  id: 'demo-secondary-dominant-v-of-v-c-major',
  meta: { title: 'V/V Resolving to V, Then I, in C Major' },
  measures: [{}, {}, {}],
  notes: [
    ...chordNotes('left', 0, W, [D3]),
    ...chordNotes('right', 0, W, midisOf(D_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [G2]),
    ...chordNotes('right', W, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [C3]),
    ...chordNotes('right', W * 2, W, midisOf(C_MAJOR_TRIAD)),
  ],
})

// ---- l5-modulation-closely-related-keys: C major pivoting to G major ------
//
// I (C major) - V (G major, the pivot chord) - the SAME G major triad
// restated as I once the key signature gains its sharp - that new key's own
// V (D major). `demoScores.test.ts` proves the pivot directly:
// `romanNumeralFor(G_MAJOR_TRIAD, ...)` reads degree 5 in C major and degree
// 1 in G major from the identical `Chord` object used to build bars 2-3 here.

const MODULATION_C_TO_G: Score = makeScore({
  id: 'demo-modulation-c-major-to-g-major',
  meta: { title: 'Modulating from C Major to G Major' },
  measures: [{ keyFifths: 0 }, {}, { keyFifths: 1 }, {}],
  notes: [
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', 0, W, midisOf(C_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [G2]),
    ...chordNotes('right', W, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [G2]),
    ...chordNotes('right', W * 2, W, midisOf(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 3, W, [D3]),
    ...chordNotes('right', W * 3, W, midisOf(D_MAJOR_TRIAD)),
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
  {
    id: 'demo-g-major-to-g-dominant-seventh',
    title: 'G Major Triad, Then G Dominant Seventh',
    description:
      'The G major triad, then the same chord with a minor third stacked on top to make G7 — the extra note that sharpens the pull back to C.',
    score: G_MAJOR_TO_G_DOMINANT_SEVENTH,
  },
  {
    id: 'demo-four-cadence-types-c-major',
    title: 'Four Cadence Types in C Major',
    description:
      'All four cadence types, each starting from the same I chord: perfect authentic (V-I), plagal (IV-I), half (ending on V), and deceptive (V resolving to vi instead of I).',
    score: FOUR_CADENCES_C_MAJOR,
  },
  {
    id: 'demo-common-progressions-c-major',
    title: 'Common Progressions in C Major',
    description:
      'Three progressions back to back, all built from the same seven diatonic triads: I-IV-V-I, ii-V-I, then I-vi-IV-V.',
    score: COMMON_PROGRESSIONS_C_MAJOR,
  },
  {
    id: 'demo-a-minor-three-scale-forms',
    title: 'A Minor — Natural, Harmonic and Melodic, Ascending',
    description:
      'A natural minor, then A harmonic minor (raised 7th), then A melodic minor ascending (raised 6th and 7th) — one octave each, back to back.',
    score: MINOR_SCALE_THREE_FORMS,
  },
  {
    id: 'demo-secondary-dominant-v-of-v-c-major',
    title: 'V/V Resolving to V, Then I, in C Major',
    description:
      'D major — the dominant of G, borrowed as a secondary dominant — resolving to G major (V), then on to C major (I).',
    score: SECONDARY_DOMINANT_V_OF_V,
  },
  {
    id: 'demo-modulation-c-major-to-g-major',
    title: 'Modulating from C Major to G Major',
    description:
      'A phrase in C major ending on its V chord (G major), then the same G major triad restated as the new I once the key signature gains its sharp, followed by that key\'s own V.',
    score: MODULATION_C_TO_G,
  },
]
