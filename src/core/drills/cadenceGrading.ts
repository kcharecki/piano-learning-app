/**
 * How a `'build-cadence'` drill item is graded.
 *
 * Split out of `theory.ts` by concept rather than by size: everything here
 * answers one question — is what the learner played the CADENCE that was
 * asked for? — while `theory.ts` owns what the items are and how they are
 * built. The two halves had drifted apart in exactly that shape anyway: the
 * builder knew the cadence's chords and the grader only ever saw a MIDI list
 * that had been flattened out of them.
 */
import { at } from '@core/shared/invariant.ts'
import { type Midi } from '@core/shared/units.ts'
import { pitchClass, toMidi } from '@core/theory/pitch.ts'
import { type Chord } from '@core/theory/chords.ts'
import { type CadenceType } from '@core/theory/harmony.ts'

/**
 * The two chords a `'build-cadence'` item asked for, and the tonic they cadence
 * to. Carried on the item so `gradeTheoryStep` can grade the cadence's own
 * requirements instead of one spelling of them — see `TheoryQuizItem.cadence`.
 */
export type CadenceAnswer = {
  readonly type: CadenceType
  /** Penultimate then final, exactly the recipe's two numerals. */
  readonly chords: readonly [Chord, Chord]
  /** 0-11. The key's tonic, which a perfect authentic cadence needs on top. */
  readonly tonicPitchClass: number
}

/**
 * `build-cadence`'s grading: does this group of notes play the chord the
 * cadence asked for, in the position the cadence requires?
 *
 * A cadence is a relation between two chords, not a voicing of them. Exact
 * MIDI matching graded one arrangement and called every other realisation
 * wrong — `C4 E4 G4 C5` against an expected `C4 E4 C5` lost on note count
 * alone (roadmap `T.23`). These are `classifyCadence`'s own conditions
 * (`theory/harmony.ts`), applied to the chord the item already knows it asked
 * for rather than to a chord recognised back out of the played notes, because
 * recognition is deliberately ambiguous — an incomplete tonic `C + E` has
 * several equally good readings and grading must not turn on which ranks
 * first.
 *
 * Three questions:
 *
 * 1. **Is this the chord?** Every sounding pitch class is one of the chord's,
 *    and the root and third — the two that fix its identity and quality — both
 *    sound. Doubling is free, and so is omitting the fifth, which is what a
 *    final tonic in four-part writing routinely does. A foreign note fails.
 * 2. **Root position?** Lowest sounding pitch class is the chord's root.
 *    Required of BOTH chords, and only for `'perfect-authentic'` — that is
 *    exactly where `classifyCadence` requires it. A half, plagal or deceptive
 *    cadence is still itself over an inverted chord.
 * 3. **Tonic on top?** Highest sounding pitch class is the key's tonic, for a
 *    `'perfect-authentic'` FINAL chord only. This is the requirement that
 *    separates a perfect authentic cadence from an imperfect one, so dropping
 *    it would make the drill accept an answer that is a different cadence.
 */
export function cadenceGroupMatches(
  cadence: CadenceAnswer,
  index: number,
  played: readonly Midi[],
): boolean {
  if (played.length === 0) return false
  const chord = at(cadence.chords, index)
  const chordClasses = chord.notes.map((n) => pitchClass(toMidi(n)))
  const playedClasses = played.map(pitchClass)

  if (!playedClasses.every((pc) => chordClasses.includes(pc))) return false
  // Sounding order, lowest first, with inversion applied — so the chord's own
  // root and third are found by pitch class, not by position in `notes`.
  const rootClass = pitchClass(toMidi(chord.root))
  const thirdClass = chordClasses.find((pc) => pc !== rootClass)
  if (thirdClass === undefined) return false
  if (!playedClasses.includes(rootClass)) return false
  if (!playedClasses.includes(thirdClass)) return false

  if (cadence.type !== 'perfect-authentic') return true
  if (pitchClass(Math.min(...played) as Midi) !== rootClass) return false
  const isFinal = index === cadence.chords.length - 1
  return !isFinal || pitchClass(Math.max(...played) as Midi) === cadence.tonicPitchClass
}
