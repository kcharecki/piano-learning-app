/**
 * Keyboard diagrams referenced from lesson markdown (REQ-3.1.3) — a lesson
 * writes `[diagram:<id>]` on its own line and the (not-yet-built) lesson
 * screen — roadmap 3.7/4.9's follow-on task — resolves that id through
 * `lessonDiagramById` and renders it with `@app/theory/KeyboardDiagram.tsx`.
 *
 * Every field here is exactly what `KeyboardDiagramProps` needs except
 * `labels`/`ariaLabel`, which the lesson screen fills in itself (`caption`
 * doubles as the accessible name). Only keyboard diagrams are authored —
 * there is no other diagram-rendering component in the app yet.
 *
 * `curriculum.test.ts` asserts both directions: every `[diagram:...]`
 * reference in every lesson resolves to an entry here, and every entry here
 * is referenced by at least one lesson — an unreferenced diagram is dead
 * content, a dangling reference renders nothing.
 */

/** Pitch classes, 0 = C .. 11 = B, named for readability below. */
const C = 0
const CSharp = 1
const D = 2
const E = 4
const F = 5
const FSharp = 6
const G = 7
const A = 9
const B = 11

export type LessonDiagram = {
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

export const LESSON_DIAGRAMS: readonly LessonDiagram[] = [
  {
    id: 'finding-middle-c',
    caption:
      'Middle C sits just to the left of the group of two black keys nearest the centre of the keyboard.',
    low: 55, // G3
    high: 67, // G4
    highlightedPitchClasses: [C],
    rootPitchClass: C,
  },
  {
    id: 'black-key-groups',
    caption:
      'Black keys form repeating groups of two and three — use them to find any white key by touch, without counting from the end of the keyboard.',
    low: 48,
    high: 72,
    highlightedPitchClasses: [CSharp, 3],
  },
  {
    id: 'c-position-right-hand',
    caption: 'Right hand C position: thumb (1) on middle C, fingers 2-5 resting on D, E, F and G.',
    low: 60, // C4
    high: 67, // G4
    highlightedPitchClasses: [C, D, E, F, G],
    rootPitchClass: C,
  },
  {
    id: 'c-position-left-hand',
    caption: 'Left hand C position: pinky (5) on F below middle C, thumb (1) on middle C.',
    low: 53, // F3
    high: 60, // C4
    highlightedPitchClasses: [F, G, A, B, C],
    rootPitchClass: C,
  },
  {
    id: 'c-major-scale',
    caption: 'The C major scale: every white key from C to C, with no sharps or flats.',
    low: 60,
    high: 72,
    highlightedPitchClasses: [C, D, E, F, G, A, B],
    rootPitchClass: C,
  },
  {
    id: 'g-major-scale',
    caption:
      'The G major scale: one sharp, F#, keeps the same whole-step/half-step pattern as C major, just starting on G.',
    low: 55, // G3
    high: 67, // G4
    highlightedPitchClasses: [G, A, B, C, D, E, FSharp],
    rootPitchClass: G,
  },
  {
    id: 'f-major-scale',
    caption:
      'The F major scale: one flat, Bb, keeps the same whole-step/half-step pattern as C major, just starting on F.',
    low: 53, // F3
    high: 65, // F4
    highlightedPitchClasses: [F, G, A, 10, C, D, E],
    rootPitchClass: F,
  },
  {
    id: 'interval-second',
    caption: 'A second: two adjacent letter names, C up to D — a step.',
    low: 60,
    high: 64,
    highlightedPitchClasses: [C, D],
  },
  {
    id: 'interval-third',
    caption: 'A third: skip one letter name, C up to E — a skip.',
    low: 60,
    high: 64,
    highlightedPitchClasses: [C, E],
  },
  {
    id: 'interval-fourth',
    caption: 'A fourth: C up to F, spanning four letter names.',
    low: 60,
    high: 65,
    highlightedPitchClasses: [C, F],
  },
  {
    id: 'interval-fifth',
    caption: 'A fifth: C up to G, spanning five letter names.',
    low: 60,
    high: 67,
    highlightedPitchClasses: [C, G],
  },
  {
    id: 'c-major-triad',
    caption: 'The C major triad: root C, third E, fifth G.',
    low: 60,
    high: 67,
    highlightedPitchClasses: [C, E, G],
    rootPitchClass: C,
  },
  {
    id: 'g-major-triad',
    caption:
      'The G major triad — the dominant (V) chord in the key of C — built from G, B and D.',
    low: 55, // G3
    high: 62, // D4
    highlightedPitchClasses: [G, B, D],
    rootPitchClass: G,
  },
  {
    id: 'a-minor-triad',
    caption:
      'The A minor triad: A, C and E — the same three white keys as the C major triad, just starting on A.',
    low: 57, // A3
    high: 64, // E4
    highlightedPitchClasses: [A, C, E],
    rootPitchClass: A,
  },
  {
    id: 'd-major-scale',
    caption: 'The D major scale: two sharps, F# and C#.',
    low: 62, // D4
    high: 74, // D5
    highlightedPitchClasses: [D, E, FSharp, G, A, B, CSharp],
    rootPitchClass: D,
  },
]

const LESSON_DIAGRAMS_BY_ID: ReadonlyMap<string, LessonDiagram> = new Map(
  LESSON_DIAGRAMS.map((d) => [d.id, d]),
)

export function lessonDiagramById(id: string): LessonDiagram | undefined {
  return LESSON_DIAGRAMS_BY_ID.get(id)
}
