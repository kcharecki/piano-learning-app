/**
 * `Score` objects backing the STAFF and RHYTHM lesson diagrams in
 * `diagrams.ts` (roadmap 3.25, REQ-3.5.2) — split out on file-size grounds,
 * mirroring how `src/content/scores/harmonyDemoScores.ts` splits out of
 * `demoScores.ts`: these are plain data, assembled into `LessonDiagram`
 * entries by `diagrams.ts` itself and rendered by `LessonBody.tsx` through
 * the same read-only OSMD pipeline `@app/theory/ScaleStaff.tsx` already uses
 * for the theory reference screen.
 *
 * Every score here is a small, single-purpose illustration — one to four
 * bars, sized to what it is teaching, never a whole piece — built directly
 * with `@core/notation/score.ts`'s `makeScore`. Deliberately NOT one of the
 * `src/content/scores/demoScores.ts` entries: a demo is meant to be *played*
 * end to end by the lesson's "Open demonstration" control, a diagram is
 * meant to be *read* inline, at a glance, without leaving the lesson text —
 * conflating the two would leave a diagram too long to read in one look or a
 * demo too short to practise.
 *
 * Chord- and scale-based diagrams derive their pitches from
 * `@core/theory/chords.ts`/`@core/theory/scales.ts` rather than hand-typed
 * MIDI numbers, the same discipline `demoScores.ts` documents for its own
 * harmony content — the notes are derived, not guessed, which matters for
 * content whose whole point is to be theoretically correct.
 */
import { makeScore, type Hand, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { buildChord, chordMidi } from '@core/theory/chords.ts'
import { spell, toMidi } from '@core/theory/pitch.ts'
import { scaleNotes } from '@core/theory/scales.ts'

const Q = TICKS_PER_QUARTER
const H = Q * 2
const W = Q * 4

/** One note per pitch, spaced `duration` ticks apart starting at `startTick`. */
function run(
  hand: Hand,
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

/** Every pitch struck together (a block chord). */
function chordNotes(
  hand: Hand,
  startTick: number,
  duration: number,
  pitches: readonly number[],
): ScoreNoteInput[] {
  return pitches.map((p) => ({ midi: p, startTick, durationTicks: duration, hand }))
}

// ---------------------------------------------------------------------------
// MIDI note names, around middle C (60) — same convention as demoScores.ts
// ---------------------------------------------------------------------------

const G2 = 43
const B2 = 47
const D3 = 50
const F3 = 53
const A3 = 57
const C3 = 48
const C4 = 60
const D4 = 62
const E4 = 64
const G4 = 67
const A4 = 69
const B4 = 71
const C5 = 72
const D5 = 74
const E5 = 76
const F5 = 77

// ---------------------------------------------------------------------------
// reusable triads, derived from core/theory/chords.ts — never hand-typed
// ---------------------------------------------------------------------------

const C_MAJOR_TRIAD = buildChord(spell('C', 0, 4), 'major', 0)
const D_MAJOR_TRIAD = buildChord(spell('D', 0, 4), 'major', 0)
const F_MAJOR_TRIAD = buildChord(spell('F', 0, 4), 'major', 0)
const G_MAJOR_TRIAD = buildChord(spell('G', 0, 4), 'major', 0)
const G_DOMINANT_SEVENTH = buildChord(spell('G', 0, 4), 'dominant7', 0)

// ---------------------------------------------------------------------------
// staff/rhythm diagrams for the 11 level 1-3 theory lessons that had none
// (roadmap 3.25) — see `diagrams.ts` for the registry entries these back.
// ---------------------------------------------------------------------------

export const GRAND_STAFF_MIDDLE_C: Score = makeScore({
  id: 'diagram-grand-staff-middle-c',
  meta: { title: 'Middle C on the Grand Staff' },
  measures: [{}],
  notes: [...chordNotes('right', 0, W, [C4]), ...chordNotes('left', 0, W, [C4])],
})

export const TREBLE_STAFF_LINES: Score = makeScore({
  id: 'diagram-treble-staff-lines',
  meta: { title: 'Treble Staff Lines: E G B D F' },
  measures: [{ timeSignature: { beats: 5, beatType: 4 } }],
  notes: run('right', 0, Q, [E4, G4, B4, D5, F5]),
})

export const BASS_STAFF_LINES: Score = makeScore({
  id: 'diagram-bass-staff-lines',
  meta: { title: 'Bass Staff Lines: G B D F A' },
  measures: [{ timeSignature: { beats: 5, beatType: 4 } }],
  notes: run('left', 0, Q, [G2, B2, D3, F3, A3]),
})

export const STEPS_VS_SKIPS_STAFF: Score = makeScore({
  id: 'diagram-steps-vs-skips',
  meta: { title: 'A Step (C-D), Then a Skip (C-E)' },
  measures: [{}, {}],
  notes: [...run('right', 0, H, [C4, D4]), ...run('right', W, H, [C4, E4])],
})

export const NOTE_VALUES_RHYTHM: Score = makeScore({
  id: 'diagram-note-values',
  meta: { title: 'Whole, Half and Quarter Notes' },
  measures: [{}, {}, {}],
  notes: [
    ...run('right', 0, W, [C4]),
    ...run('right', W, H, [C4, C4]),
    ...run('right', W * 2, Q, [C4, C4, C4, C4]),
  ],
})

export const FOUR_FOUR_RHYTHM: Score = makeScore({
  id: 'diagram-4-4-time',
  meta: { title: '4/4 Time: Four Quarter-Note Beats' },
  measures: [{}],
  notes: run('right', 0, Q, [C4, C4, C4, C4]),
})

export const THREE_FOUR_RHYTHM: Score = makeScore({
  id: 'diagram-3-4-time',
  meta: { title: '3/4 Time: "Oom-Pah-Pah"' },
  measures: [{ timeSignature: { beats: 3, beatType: 4 } }],
  notes: [...run('left', 0, Q, [C3]), ...run('right', Q, Q, [E4, G4])],
})

export const I_IV_CHORDS_STAFF: Score = makeScore({
  id: 'diagram-i-iv-chords',
  meta: { title: 'I and IV Chords in C Major' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('right', 0, W, chordMidi(C_MAJOR_TRIAD)),
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', W, W, chordMidi(F_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [F3]),
  ],
})

export const CIRCLE_OF_FIFTHS_ASCENDING: Score = makeScore({
  id: 'diagram-circle-of-fifths-ascending',
  meta: { title: 'Ascending by Fifths: C, G, D' },
  measures: [{ keyFifths: 0 }, { keyFifths: 1 }, { keyFifths: 2 }],
  notes: [
    ...chordNotes('right', 0, W, [C4]),
    ...chordNotes('right', W, W, [G4]),
    ...chordNotes('right', W * 2, W, [D5]),
  ],
})

export const TRIAD_INVERSIONS_STAFF: Score = makeScore({
  id: 'diagram-triad-inversions',
  meta: { title: 'C Major Triad: Root, First and Second Inversion' },
  measures: [{}, {}, {}],
  notes: [
    ...chordNotes('right', 0, W, [C4, E4, G4]),
    ...chordNotes('right', W, W, [E4, G4, C5]),
    ...chordNotes('right', W * 2, W, [G4, C5, E5]),
  ],
})

export const INTERVALS_SIXTH_SEVENTH_OCTAVE: Score = makeScore({
  id: 'diagram-intervals-sixth-seventh-octave',
  meta: { title: 'A Sixth, a Seventh and an Octave from C' },
  measures: [{}, {}, {}],
  notes: [
    ...run('right', 0, H, [C4, A4]),
    ...run('right', W, H, [C4, B4]),
    ...run('right', W * 2, H, [C4, C5]),
  ],
})

// ---------------------------------------------------------------------------
// staff diagrams for the six new level 4-5 REQ-3.5.1 topics (roadmap 3.24) —
// each is a STAFF diagram, not a keyboard diagram, because the topic is a
// relationship between chords/scale degrees that a keyboard picture cannot
// show (see the module doc on `LessonBody.tsx` and the roadmap 3.25 task
// brief: "a cadence lesson with a keyboard-only diagram would be the same
// defect again").
// ---------------------------------------------------------------------------

/** G major triad, then G dominant 7th — the seventh is one third stacked on
 *  top of a triad the learner already knows, shown side by side. */
export const SEVENTH_CHORD_STAFF: Score = makeScore({
  id: 'diagram-seventh-chord',
  meta: { title: 'G Major Triad, Then G Dominant Seventh' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('right', 0, W, chordMidi(G_MAJOR_TRIAD)),
    ...chordNotes('right', W, W, chordMidi(G_DOMINANT_SEVENTH)),
  ],
})

/** Root-position V then I, left-hand roots under right-hand triads — the
 *  same V-I shape `demo-authentic-cadence-c-major` plays, as a diagram. */
export const AUTHENTIC_CADENCE_STAFF: Score = makeScore({
  id: 'diagram-authentic-cadence',
  meta: { title: 'V-I: A Perfect Authentic Cadence in C Major' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('left', 0, W, [G2]),
    ...chordNotes('right', 0, W, chordMidi(G_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [C3]),
    ...chordNotes('right', W, W, chordMidi(C_MAJOR_TRIAD)),
  ],
})

/** I-IV-V-I, blocked chords over left-hand roots. */
export const PROGRESSION_I_IV_V_I_STAFF: Score = makeScore({
  id: 'diagram-i-iv-v-i-progression',
  meta: { title: 'I-IV-V-I in C Major' },
  measures: [{}, {}, {}, {}],
  notes: [
    ...chordNotes('right', 0, W, chordMidi(C_MAJOR_TRIAD)),
    ...chordNotes('left', 0, W, [C3]),
    ...chordNotes('right', W, W, chordMidi(F_MAJOR_TRIAD)),
    ...chordNotes('left', W, W, [F3]),
    ...chordNotes('right', W * 2, W, chordMidi(G_MAJOR_TRIAD)),
    ...chordNotes('left', W * 2, W, [G2]),
    ...chordNotes('right', W * 3, W, chordMidi(C_MAJOR_TRIAD)),
    ...chordNotes('left', W * 3, W, [C3]),
  ],
})

const BAR8 = 8 * Q
const A_NATURAL_MINOR = scaleNotes(spell('A', 0, 4), 'naturalMinor', 1).map(toMidi)
const A_HARMONIC_MINOR = scaleNotes(spell('A', 0, 4), 'harmonicMinor', 1).map(toMidi)
const A_MELODIC_MINOR = scaleNotes(spell('A', 0, 4), 'melodicMinor', 1).map(toMidi)

/** A natural, harmonic, then melodic minor, one octave ascending each — the
 *  three forms' differing 6th/7th degrees read directly off `scaleNotes`,
 *  never restated by hand (roadmap 3.24: "author against what exists"). */
export const MINOR_SCALE_FORMS_STAFF: Score = makeScore({
  id: 'diagram-minor-scale-forms',
  meta: { title: 'A Natural, Harmonic and Melodic Minor' },
  measures: [{ timeSignature: { beats: 8, beatType: 4 } }, {}, {}],
  notes: [
    ...run('right', 0, Q, A_NATURAL_MINOR),
    ...run('right', BAR8, Q, A_HARMONIC_MINOR),
    ...run('right', BAR8 * 2, Q, A_MELODIC_MINOR),
  ],
})

/** D major (V of G) resolving to G major (V of C) — a secondary dominant
 *  tonicising the dominant, the first and most common case a learner meets. */
export const SECONDARY_DOMINANT_STAFF: Score = makeScore({
  id: 'diagram-secondary-dominant',
  meta: { title: 'V/V Resolving to V, in C Major' },
  measures: [{}, {}],
  notes: [
    ...chordNotes('right', 0, W, chordMidi(D_MAJOR_TRIAD)),
    ...chordNotes('right', W, W, chordMidi(G_MAJOR_TRIAD)),
  ],
})

/** C major's I then V (the pivot chord), then the same G major triad
 *  restated as I in a 1-sharp key signature, then G major's own V (D) —
 *  a real mid-score key-signature change, the same device
 *  `demo-key-signatures-g-and-f` uses to demonstrate a key. */
export const MODULATION_STAFF: Score = makeScore({
  id: 'diagram-modulation-c-to-g',
  meta: { title: 'Modulating from C Major to Its Dominant, G Major' },
  measures: [{ keyFifths: 0 }, {}, { keyFifths: 1 }, {}],
  notes: [
    ...chordNotes('right', 0, W, chordMidi(C_MAJOR_TRIAD)),
    ...chordNotes('right', W, W, chordMidi(G_MAJOR_TRIAD)),
    ...chordNotes('right', W * 2, W, chordMidi(G_MAJOR_TRIAD)),
    ...chordNotes('right', W * 3, W, chordMidi(D_MAJOR_TRIAD)),
  ],
})
