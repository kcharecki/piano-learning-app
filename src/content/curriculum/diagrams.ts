/**
 * Diagrams referenced from lesson markdown (REQ-3.1.3, REQ-3.5.2) — a lesson
 * writes `[diagram:<id>]` on its own line and `LessonBody.tsx` resolves that
 * id through `lessonDiagramById` and renders it.
 *
 * Three kinds, discriminated by `kind` (roadmap 3.25 widened this from
 * keyboard-only, a structural fix, not just more content: seven level-1
 * lessons about staff notation and rhythm — and four more theory lessons
 * across levels 2-3 — were previously *incapable* of carrying a diagram at
 * all, because `LessonDiagram` had no shape a staff or rhythm picture could
 * fit into):
 *
 *  - `'keyboard'` — a piano-keyboard picture, rendered by
 *    `@app/theory/KeyboardDiagram.tsx`. Every field here is exactly what
 *    `KeyboardDiagramProps` needs except `labels`/`ariaLabel`, which the
 *    lesson screen fills in itself (`caption` doubles as the accessible
 *    name).
 *  - `'staff'` / `'rhythm'` — a short, real engraved `Score` (built in the
 *    sibling `diagramScores.ts`, split out on file-size grounds), rendered
 *    read-only through the same OSMD pipeline `@app/theory/ScaleStaff.tsx`
 *    already uses for the theory reference screen — no cursor, no title, no
 *    tempo mark (see `ScorePresentation` in `@app/score/osmdEngraver.ts`).
 *    `'staff'` is for pitch/structure content (clefs, intervals, chords on
 *    the page); `'rhythm'` is for note-value/metre content, following the
 *    same "single repeated pitch so only the rhythm changes" convention
 *    `src/content/scores/demoScores.ts` uses for its own rhythm demos. The
 *    two kinds share a shape today (both just carry a `Score`) but are kept
 *    distinct so a future rhythm-specific presentation (e.g. suppressing
 *    noteheads' pitch significance) has somewhere to attach without another
 *    type-widening pass.
 *
 * `curriculum.test.ts` asserts both directions: every `[diagram:...]`
 * reference in every lesson resolves to an entry here, and every entry here
 * is referenced by at least one lesson — an unreferenced diagram is dead
 * content, a dangling reference renders nothing.
 */
import type { Score } from '@core/notation/score.ts'
import {
  AUTHENTIC_CADENCE_STAFF,
  BASS_STAFF_LINES,
  CIRCLE_OF_FIFTHS_ASCENDING,
  FOUR_FOUR_RHYTHM,
  GRAND_STAFF_MIDDLE_C,
  I_IV_CHORDS_STAFF,
  INTERVALS_SIXTH_SEVENTH_OCTAVE,
  MINOR_SCALE_FORMS_STAFF,
  MODULATION_STAFF,
  NOTE_VALUES_RHYTHM,
  PROGRESSION_I_IV_V_I_STAFF,
  SECONDARY_DOMINANT_STAFF,
  SEVENTH_CHORD_STAFF,
  STEPS_VS_SKIPS_STAFF,
  THREE_FOUR_RHYTHM,
  TREBLE_STAFF_LINES,
  TRIAD_INVERSIONS_STAFF,
} from './diagramScores.ts'

/** Pitch classes, 0 = C .. 11 = B, named for readability below. */
const C = 0
const CSharp = 1
const D = 2
const E = 4
const F = 5
const FSharp = 6
const G = 7
const A = 9
const Bb = 10
const B = 11

export type KeyboardLessonDiagram = {
  readonly kind: 'keyboard'
  /** Referenced from lesson markdown as `[diagram:<id>]`. Kebab-case, unique. */
  readonly id: string
  /** Rendered as the diagram's caption and its accessible name. */
  readonly caption: string
  /** Inclusive MIDI range the keyboard spans. */
  readonly low: number
  readonly high: number
  /** Pitch classes 0-11 to highlight, independent of octave. */
  readonly highlightedPitchClasses: readonly number[]
  /** Pitch class drawn as the root/tonic. Omit when there is none. */
  readonly rootPitchClass?: number
}

export type StaffLessonDiagram = {
  readonly kind: 'staff'
  readonly id: string
  readonly caption: string
  readonly score: Score
}

export type RhythmLessonDiagram = {
  readonly kind: 'rhythm'
  readonly id: string
  readonly caption: string
  readonly score: Score
}

export type LessonDiagram = KeyboardLessonDiagram | StaffLessonDiagram | RhythmLessonDiagram

export const LESSON_DIAGRAMS: readonly LessonDiagram[] = [
  {
    kind: 'keyboard',
    id: 'finding-middle-c',
    caption:
      'Middle C sits just to the left of the group of two black keys nearest the centre of the keyboard.',
    low: 55, // G3
    high: 67, // G4
    highlightedPitchClasses: [C],
    rootPitchClass: C,
  },
  {
    kind: 'keyboard',
    id: 'black-key-groups',
    caption:
      'Black keys form repeating groups of two and three — use them to find any white key by touch, without counting from the end of the keyboard.',
    low: 48,
    high: 72,
    highlightedPitchClasses: [CSharp, 3],
  },
  {
    kind: 'keyboard',
    id: 'c-position-right-hand',
    caption: 'Right hand C position: thumb (1) on middle C, fingers 2-5 resting on D, E, F and G.',
    low: 60, // C4
    high: 67, // G4
    highlightedPitchClasses: [C, D, E, F, G],
    rootPitchClass: C,
  },
  {
    kind: 'keyboard',
    id: 'c-position-left-hand',
    caption: 'Left hand C position: pinky (5) on F below middle C, thumb (1) on middle C.',
    low: 53, // F3
    high: 60, // C4
    highlightedPitchClasses: [F, G, A, B, C],
    rootPitchClass: C,
  },
  {
    kind: 'keyboard',
    id: 'c-major-scale',
    caption: 'The C major scale: every white key from C to C, with no sharps or flats.',
    low: 60,
    high: 72,
    highlightedPitchClasses: [C, D, E, F, G, A, B],
    rootPitchClass: C,
  },
  {
    kind: 'keyboard',
    id: 'g-major-scale',
    caption:
      'The G major scale: one sharp, F#, keeps the same whole-step/half-step pattern as C major, just starting on G.',
    low: 55, // G3
    high: 67, // G4
    highlightedPitchClasses: [G, A, B, C, D, E, FSharp],
    rootPitchClass: G,
  },
  {
    kind: 'keyboard',
    id: 'f-major-scale',
    caption:
      'The F major scale: one flat, Bb, keeps the same whole-step/half-step pattern as C major, just starting on F.',
    low: 53, // F3
    high: 65, // F4
    highlightedPitchClasses: [F, G, A, 10, C, D, E],
    rootPitchClass: F,
  },
  {
    kind: 'keyboard',
    id: 'interval-second',
    caption: 'A second: two adjacent letter names, C up to D — a step.',
    low: 60,
    high: 64,
    highlightedPitchClasses: [C, D],
  },
  {
    kind: 'keyboard',
    id: 'interval-third',
    caption: 'A third: skip one letter name, C up to E — a skip.',
    low: 60,
    high: 64,
    highlightedPitchClasses: [C, E],
  },
  {
    kind: 'keyboard',
    id: 'interval-fourth',
    caption: 'A fourth: C up to F, spanning four letter names.',
    low: 60,
    high: 65,
    highlightedPitchClasses: [C, F],
  },
  {
    kind: 'keyboard',
    id: 'interval-fifth',
    caption: 'A fifth: C up to G, spanning five letter names.',
    low: 60,
    high: 67,
    highlightedPitchClasses: [C, G],
  },
  {
    kind: 'keyboard',
    id: 'c-major-triad',
    caption: 'The C major triad: root C, third E, fifth G.',
    low: 60,
    high: 67,
    highlightedPitchClasses: [C, E, G],
    rootPitchClass: C,
  },
  {
    kind: 'keyboard',
    id: 'g-major-triad',
    caption:
      'The G major triad — the dominant (V) chord in the key of C — built from G, B and D.',
    low: 55, // G3
    high: 62, // D4
    highlightedPitchClasses: [G, B, D],
    rootPitchClass: G,
  },
  {
    kind: 'keyboard',
    id: 'a-minor-triad',
    caption:
      'The A minor triad: A, C and E — the same three white keys as the C major triad, just starting on A.',
    low: 57, // A3
    high: 64, // E4
    highlightedPitchClasses: [A, C, E],
    rootPitchClass: A,
  },
  {
    kind: 'keyboard',
    id: 'd-major-scale',
    caption: 'The D major scale: two sharps, F# and C#.',
    low: 62, // D4
    high: 74, // D5
    highlightedPitchClasses: [D, E, FSharp, G, A, B, CSharp],
    rootPitchClass: D,
  },
  {
    // roadmap 5.10: l3-keys-to-two-sharps-flats names D major and B-flat
    // major with equal weight ("two sharps... and two flats...") but only
    // 'd-major-scale' above existed — a beginner reading the lesson would
    // see one of its two named keys illustrated and not the other. `low` is
    // A3 (a white key, satisfying the same registry invariant every other
    // keyboard diagram here does) rather than the root Bb itself, which is a
    // black key.
    kind: 'keyboard',
    id: 'b-flat-major-scale',
    caption: 'The B-flat major scale: two flats, Bb and Eb.',
    low: 57, // A3
    high: 69, // A4
    highlightedPitchClasses: [Bb, C, D, 3, F, G, A],
    rootPitchClass: Bb,
  },

  // -- staff/rhythm diagrams for the level 1-3 gap topics (roadmap 3.25) ----
  {
    kind: 'staff',
    id: 'staff-grand-staff-middle-c',
    caption:
      'Middle C sits on its own short ledger line between the treble staff above and the bass staff below — one note, shared by both clefs.',
    score: GRAND_STAFF_MIDDLE_C,
  },
  {
    kind: 'staff',
    id: 'staff-treble-lines',
    caption: "The treble staff's five lines, bottom to top, spell E-G-B-D-F.",
    score: TREBLE_STAFF_LINES,
  },
  {
    kind: 'staff',
    id: 'staff-bass-lines',
    caption: "The bass staff's five lines, bottom to top, spell G-B-D-F-A.",
    score: BASS_STAFF_LINES,
  },
  {
    kind: 'staff',
    id: 'staff-steps-vs-skips',
    caption:
      'A step (C to D, adjacent letter names) followed by a skip (C to E, one letter name apart).',
    score: STEPS_VS_SKIPS_STAFF,
  },
  {
    kind: 'rhythm',
    id: 'rhythm-note-values',
    caption:
      'The same four beats, subdivided three ways: one whole note, two half notes, four quarter notes.',
    score: NOTE_VALUES_RHYTHM,
  },
  {
    kind: 'rhythm',
    id: 'rhythm-4-4-time',
    caption: 'One measure of 4/4 time: four quarter-note beats.',
    score: FOUR_FOUR_RHYTHM,
  },
  {
    kind: 'rhythm',
    id: 'rhythm-3-4-time',
    caption:
      'One measure of 3/4 time: a left-hand root on beat 1 under right-hand notes on beats 2 and 3 — the "oom-pah-pah" waltz feel.',
    score: THREE_FOUR_RHYTHM,
  },
  {
    kind: 'staff',
    id: 'staff-i-iv-chords',
    caption:
      'The tonic (I) and subdominant (IV) chords in C major, each as a blocked triad over its own root.',
    score: I_IV_CHORDS_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-circle-of-fifths-ascending',
    caption:
      'Ascending by fifths from C: C major (no sharps), G major (one sharp), D major (two sharps) — each step adds one sharp.',
    score: CIRCLE_OF_FIFTHS_ASCENDING,
  },
  {
    kind: 'staff',
    id: 'staff-triad-inversions',
    caption:
      'The C major triad in root position (C-E-G), first inversion (E-G-C) and second inversion (G-C-E).',
    score: TRIAD_INVERSIONS_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-intervals-sixth-seventh-octave',
    caption: 'From C: a sixth (C to A), a seventh (C to B) and an octave (C to the next C).',
    score: INTERVALS_SIXTH_SEVENTH_OCTAVE,
  },

  // -- staff diagrams for the six new level 4-5 topics (roadmap 3.24) -------
  {
    kind: 'staff',
    id: 'staff-seventh-chord',
    caption:
      'The G major triad, then G dominant seventh — a seventh chord is a triad with one more third stacked on top.',
    score: SEVENTH_CHORD_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-authentic-cadence',
    caption: 'A perfect authentic cadence in C major: root-position V resolving to root-position I.',
    score: AUTHENTIC_CADENCE_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-i-iv-v-i-progression',
    caption: 'The I-IV-V-I progression in C major, blocked chords over left-hand roots.',
    score: PROGRESSION_I_IV_V_I_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-minor-scale-forms',
    caption:
      'A natural minor, A harmonic minor and A melodic minor (ascending), one octave each — the three forms differ only in the 6th and 7th degrees.',
    score: MINOR_SCALE_FORMS_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-secondary-dominant',
    caption:
      'D major (the dominant of G) resolving to G major (the dominant of C) — a secondary dominant tonicising the dominant.',
    score: SECONDARY_DOMINANT_STAFF,
  },
  {
    kind: 'staff',
    id: 'staff-modulation-c-to-g',
    caption:
      'Modulating from C major to its dominant key, G major: the G major chord (V in C) becomes the new I once the key signature gains its sharp.',
    score: MODULATION_STAFF,
  },
]

const LESSON_DIAGRAMS_BY_ID: ReadonlyMap<string, LessonDiagram> = new Map(
  LESSON_DIAGRAMS.map((d) => [d.id, d]),
)

export function lessonDiagramById(id: string): LessonDiagram | undefined {
  return LESSON_DIAGRAMS_BY_ID.get(id)
}
