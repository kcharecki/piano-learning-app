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
import { letterAlterDisplayName, pitchClass, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { chordTones, type Chord } from '@core/theory/chords.ts'
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
 * Which of the grader's conditions a group broke.
 *
 * A rule this drill polices and never states cannot teach. The panel's entire
 * refusal was `Not quite — it was G4 + B4 + D5`: it names notes and no
 * standard, so a learner refused for doubling the leading tone reads back a
 * list of notes they mostly played and has nothing to correct (roadmap
 * `T.39`). The grader is the only thing that knows which condition it applied,
 * so the verdict carries it out instead of leaving the panel to guess.
 */
export type CadenceRule =
  | 'no-notes'
  | 'foreign-note'
  | 'missing-root'
  | 'missing-third'
  | 'doubled-leading-tone'
  | 'not-root-position'
  | 'tonic-not-on-top'

export type CadenceVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly rule: CadenceRule }

const OK: CadenceVerdict = { ok: true }
const no = (rule: CadenceRule): CadenceVerdict => ({ ok: false, rule })

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
 * Four questions, and a refusal names which one it was — {@link CadenceRule},
 * written out by {@link describeCadenceRule}:
 *
 * 1. **Is this the chord?** Every sounding pitch class is one of the chord's,
 *    and the root and third — the two that fix its identity and quality — both
 *    sound. Doubling is free, and so is omitting the fifth, which is what a
 *    final tonic in four-part writing routinely does. A foreign note fails.
 * 2. **Is the leading tone left alone?** The leading tone is the third of V,
 *    and doubling it is the one doubling every harmony text forbids — so where
 *    the chord contains it, it may sound once and no more. Every other
 *    doubling stays free, the tonic's own third included: `C4 E4 E5 C6` is a
 *    thin final tonic, not a wrong one.
 * 3. **Root position?** Lowest sounding pitch class is the chord's root.
 *    Required of the FINAL chord of EVERY cadence type. A phrase that ends
 *    over its third or fifth is not the cadence the prompt named: no text
 *    calls IV-I⁶ a plagal cadence, and a half cadence's V is in root position
 *    (a 6/4 over the dominant is a cadential six-four, which is the chord
 *    BEFORE the cadence, not the cadence). Required of the PENULTIMATE chord
 *    only for `'perfect-authentic'`, where both chords must be — ii⁶-V is an
 *    ordinary half cadence and I⁶-V opens one just as well.
 *    `classifyCadence` (`theory/harmony.ts`) is laxer than this, on purpose:
 *    it reads back a cadence somebody else wrote. This drill is not reading.
 *    It asked for a cadence by name and reveals a root-position answer, so
 *    that is the standard it has to grade against — panel r1 skeptic, which
 *    drove `F4 A4 C5` then `E4 G4 C5` and was told `Correct`.
 * 4. **Tonic on top?** Highest sounding pitch class is the key's tonic, for a
 *    `'perfect-authentic'` FINAL chord only. This is the requirement that
 *    separates a perfect authentic cadence from an imperfect one, so dropping
 *    it would make the drill accept an answer that is a different cadence.
 */
export function cadenceGroupVerdict(
  cadence: CadenceAnswer,
  index: number,
  played: readonly Midi[],
): CadenceVerdict {
  if (played.length === 0) return no('no-notes')
  const chord = at(cadence.chords, index)
  const chordClasses = chord.notes.map((n) => pitchClass(toMidi(n)))
  const playedClasses = played.map(pitchClass)

  if (!playedClasses.every((pc) => chordClasses.includes(pc))) return no('foreign-note')
  // `chordTones` is the root-position stack, so [1] is the third whatever the
  // inversion did to `notes`. Reading `notes` positionally found the FIFTH on a
  // second-inversion chord (panel r1 skeptic).
  const rootClass = pitchClass(toMidi(chord.root))
  const thirdClass = pitchClass(toMidi(at(chordTones(chord), 1)))
  if (!playedClasses.includes(rootClass)) return no('missing-root')
  if (!playedClasses.includes(thirdClass)) return no('missing-third')

  // A doubling is two DIFFERENT notes of one pitch class, so count over the
  // distinct sounding pitches. `played` is a press list: the cadence panel
  // buffers presses, so striking one key twice arrives here as a repeat, and
  // counting it as a doubling failed a learner for a slip of the hand
  // (panel r2 skeptic, who drove `G4, B4, B4, D5` and watched lapses 12 -> 13).
  const leadingToneClass = (cadence.tonicPitchClass + 11) % 12
  if (chordClasses.includes(leadingToneClass)) {
    const sounding = [...new Set(played)].map(pitchClass)
    if (sounding.filter((pc) => pc === leadingToneClass).length > 1) {
      return no('doubled-leading-tone')
    }
  }

  const isFinal = index === cadence.chords.length - 1
  if (isFinal || cadence.type === 'perfect-authentic') {
    if (pitchClass(Math.min(...played) as Midi) !== rootClass) return no('not-root-position')
  }
  if (!isFinal || cadence.type !== 'perfect-authentic') return OK
  if (pitchClass(Math.max(...played) as Midi) !== cadence.tonicPitchClass) {
    return no('tonic-not-on-top')
  }
  return OK
}

/**
 * A note named for a learner: letter and accidental, with the glyph rather
 * than `#`, and no octave. Grading is octave-insensitive, so an octave in
 * these sentences would name a requirement that is not being applied.
 */
function noteName(p: SpelledPitch): string {
  return letterAlterDisplayName(p.letter, p.alter)
}

/**
 * The tonic's letter and accidental, for the one refusal that has to name it.
 *
 * Read back off whichever of the two chords is rooted on the tonic rather than
 * carried as a second field, so the name in the sentence cannot drift from the
 * notes being graded. Every cadence recipe has one: `V-I`, `IV-I` and `I-V`
 * all do, and `V-vi` — the deceptive cadence, the only recipe whose final
 * chord is not the tonic — never reaches this branch, because the tonic-on-top
 * rule applies to `'perfect-authentic'` alone.
 */
function tonicName(cadence: CadenceAnswer): string {
  const [penultimate, final] = cadence.chords
  const spelled = [final.root, penultimate.root].find(
    (root) => pitchClass(toMidi(root)) === cadence.tonicPitchClass,
  )
  return spelled === undefined ? '' : noteName(spelled)
}

/**
 * A refused cadence group, written for the learner as the rule it broke.
 *
 * Names the standard AND the note it lands on, because neither alone can be
 * acted on: "the leading tone may only sound once" leaves a learner hunting
 * for which note that is, and "you doubled B" leaves them not knowing that
 * doubling it was the problem (roadmap `T.39`).
 *
 * Second person, in the vocabulary the prompt already uses — it says
 * `perfect authentic cadence` — because this is the screen where those words
 * are the subject being taught. DESIGN.md rule 7 bans SRS vocabulary from
 * learner copy, not the domain's own.
 */
export function describeCadenceRule(
  cadence: CadenceAnswer,
  index: number,
  rule: CadenceRule,
): string {
  const chord = at(cadence.chords, index)
  const tones = chordTones(chord)
  const root = noteName(chord.root)
  const third = noteName(at(tones, 1))
  switch (rule) {
    case 'no-notes':
      return 'Play the notes of the chord before moving on.'
    case 'foreign-note':
      return `One of those notes is not in the chord — it is built from ${tones.map(noteName).join(', ')}.`
    case 'missing-root':
      return `The root, ${root}, has to sound somewhere in the chord.`
    case 'missing-third':
      return `The third, ${third}, has to sound — it is the note that makes the chord major or minor.`
    case 'doubled-leading-tone':
      return `The leading tone, ${third}, may sound only once. Doubling it is the one doubling harmony rules out, because both copies want to rise to the tonic and cannot both do it.`
    case 'not-root-position':
      return `This chord has to be in root position, with its root, ${root}, as the lowest note.`
    case 'tonic-not-on-top':
      return `A perfect authentic cadence ends with the tonic, ${tonicName(cadence)}, as the highest note. Any other note on top makes it an imperfect authentic cadence.`
  }
}
