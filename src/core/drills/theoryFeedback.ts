/**
 * What a theory drill says back to the learner about an attempt.
 *
 * Split out of `theory.ts` by concept: everything here is copy — the answer
 * named, the position that broke, the convention that refused it — while
 * `theory.ts` owns what the items are and whether an attempt is right. The
 * grader is the only thing that knows which group broke and which rule broke
 * it, and it used to throw that away at the return statement, so the whole
 * refusal a learner read was the answer restated (roadmap `T.19`, `T.39`).
 *
 * The type import back into `theory.ts` is type-only, so nothing imports
 * anything at runtime in that direction and there is no cycle.
 */
import { type Midi } from '@core/shared/units.ts'
import { fromMidi, pitchDisplayName } from '@core/theory/pitch.ts'
import { cadenceGroupVerdict, describeCadenceRule } from './cadenceGrading.ts'
import { type TheoryQuizItem } from './theory.ts'

/**
 * The notes that answer an item, named for a learner: `'C4, D4, E4'` for a
 * sequence, `'C4 + E4 + G4'` for a chord, both joined with `', '` when an
 * item is several groups of several notes (a cadence).
 *
 * Octave-bearing on purpose. Grading is octave-insensitive, so this is not the
 * *only* right answer — but "C, E, G" leaves a learner who played the chord
 * two octaves down with nothing to check against, and the register the item
 * was built in is the one its prompt implies.
 */
export function describeTheoryAnswer(item: TheoryQuizItem): string {
  if (item.answerSummary !== undefined) return item.answerSummary
  return item.spelledAnswer
    .map((group) => group.map(pitchDisplayName).join(' + '))
    .join(', ')
}

/**
 * Names a group of played MIDI notes back to the learner, spelled the way the
 * item spells its own answer.
 *
 * `fromMidi`'s default table is sharps, so an item in F major would report a
 * played B♭ as `A♯4` — the same key on the keyboard, named in a vocabulary
 * the prompt never uses. The item's own spelling is the evidence for which
 * table to read: if any note of the answer is flattened, this is a flat
 * context.
 */
function describePlayedGroup(item: TheoryQuizItem, played: readonly Midi[]): string {
  const preferFlats = item.spelledAnswer.some((group) => group.some((p) => p.alter < 0))
  return played.map((note) => pitchDisplayName(fromMidi(note, preferFlats))).join(' + ')
}

/**
 * Why one group was refused, written for the learner — the `reason` on
 * `TheoryAnswerResult`.
 *
 * A cadence group answers with the convention it broke, because that rule is
 * the thing being taught and the learner cannot see it (roadmap `T.39`).
 * Every other kind answers with the position that broke and what was wanted
 * there, because a multi-group item otherwise reports its whole answer
 * whether one note was wrong or all of them (roadmap `T.19`).
 *
 * A single-group item says nothing: `expected` already names the only group
 * there is, and "you played C4, it is E4" next to "it was E4" is one sentence
 * pretending to be two.
 */
export function describeGroupMiss(
  item: TheoryQuizItem,
  index: number,
  played: readonly Midi[],
): string {
  if (item.cadence !== undefined) {
    const verdict = cadenceGroupVerdict(item.cadence, index, played)
    if (verdict.ok) return ''
    const which = index === 0 ? 'First chord' : 'Second chord'
    return `${which}: ${describeCadenceRule(item.cadence, index, verdict.rule)}`
  }
  if (item.answer.length < 2) return ''
  const wanted = item.spelledAnswer[index]
  if (wanted === undefined) return ''
  const label = item.simultaneous ? `Chord ${index + 1}` : `Note ${index + 1}`
  return `${label}: you played ${describePlayedGroup(item, played)}, it is ${wanted
    .map(pitchDisplayName)
    .join(' + ')}.`
}

/**
 * The attempt ran past the end of the answer. Says how long the answer is in
 * the unit the item is played in, because "too many notes" on a two-chord
 * cadence tells a learner nothing about where to stop.
 */
export function describeExtraGroups(item: TheoryQuizItem, answered: number): string {
  const unit = item.simultaneous ? 'chord' : 'note'
  return `That is more than the answer needs — it is ${answered} ${unit}${
    answered === 1 ? '' : 's'
  } long.`
}

/** Right pitch classes, wrong order: the notes of the scale, not climbing. */
export const SCALE_NOT_ASCENDING =
  'Those are the right notes, but a scale climbs: every note has to be higher than the one before it.'

/**
 * Right pitch classes, wrong signed gap — the two ways that happens are
 * playing the interval downwards and playing it across an octave, so the
 * sentence names both rather than repeating the note names the learner can
 * already see are right.
 */
export const INTERVAL_MISMATCH =
  'Right note names, wrong interval — check the direction you moved, and whether you crossed an octave.'
