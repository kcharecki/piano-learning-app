/**
 * Grading an attempt at a theory drill item.
 *
 * Split from `theory.ts` by concept: that file BUILDS items — the scales,
 * chords, intervals, key signatures and cadences the drill asks for, and the
 * ids they round-trip through — while this one answers the one question a
 * built item is put to, is what the learner played the answer? The two halves
 * share only the item shape, so the import runs one way.
 *
 * A cadence is graded on the cadence's own requirements rather than on one
 * spelling of them; that lives in `cadenceGrading.ts`, and the sentence a
 * refusal is written as lives in `theoryFeedback.ts`.
 */
import { at } from '@core/shared/invariant.ts'
import { type Midi } from '@core/shared/units.ts'
import { cadenceGroupVerdict } from './cadenceGrading.ts'
import {
  describeExtraGroups,
  describeGroupMiss,
  describeTheoryAnswer,
  INTERVAL_MISMATCH,
  SCALE_NOT_ASCENDING,
} from './theoryFeedback.ts'
import { type TheoryAnswerResult, type TheoryQuizItem, type TheoryQuizKind } from './theory.ts'

/** Pitch classes, sorted — the octave-insensitive form one group is compared in. */
function pitchClasses(group: readonly Midi[]): number[] {
  return [...group].map((n) => ((n % 12) + 12) % 12).sort((a, b) => a - b)
}

function groupsMatch(
  kind: TheoryQuizKind,
  expected: readonly Midi[],
  played: readonly Midi[],
): boolean {
  if (expected.length !== played.length) return false
  const e = pitchClasses(expected)
  const p = pitchClasses(played)
  if (!e.every((v, i) => v === p[i])) return false
  // 'build-chord' additionally grades inversion: the pitch-class set alone is
  // invariant under inversion, but the lowest sounding note is not — a first
  // inversion prompt is only answered by playing the third in the bass.
  if (kind === 'build-chord') {
    return Math.min(...played) % 12 === Math.min(...expected) % 12
  }
  return true
}

/**
 * `build-scale`'s extra order/direction check: the played MIDI numbers must be
 * strictly increasing across groups, exactly like the expected answer is.
 * Pitch-class matching alone accepts any octave placement per note, so a
 * scrambled-octave rendition of the right pitch classes would otherwise pass.
 */
function isStrictlyAscending(groups: readonly (readonly Midi[])[]): boolean {
  let prev = -Infinity
  for (const group of groups) {
    const note = at(group, 0) as number
    if (note <= prev) return false
    prev = note
  }
  return true
}

/**
 * `build-interval`'s extra direction/size check: the signed semitone gap from
 * the played root to the played target must equal the expected gap exactly
 * (octave-insensitive only as a whole, via the caller transposing both groups
 * together) — pitch-class matching alone cannot tell a major 6th above from a
 * minor 3rd below, or a unison from an octave.
 */
function intervalMatches(
  expected: readonly (readonly Midi[])[],
  played: readonly (readonly Midi[])[],
): boolean {
  const expectedRoot = at(at(expected, 0), 0) as number
  const expectedTarget = at(at(expected, 1), 0) as number
  const playedRoot = at(at(played, 0), 0) as number
  const playedTarget = at(at(played, 1), 0) as number
  return playedTarget - playedRoot === expectedTarget - expectedRoot
}

/**
 * Fold one played group (one key, or one chord) into an in-progress attempt.
 * Pure: state in, state out. Octave-insensitive by default — a learner
 * playing C major an octave up has built the right chord.
 *
 * `playedSoFar` is every group played in this attempt, in order; this is a
 * pure function of that whole history rather than an incremental reducer, so
 * a caller re-derives the result from its own accumulated state each time
 * rather than trusting one carried forward.
 */
export { describeTheoryAnswer } from './theoryFeedback.ts'

export function gradeTheoryStep(
  item: TheoryQuizItem,
  playedSoFar: readonly (readonly Midi[])[],
): TheoryAnswerResult {
  const expectedText = describeTheoryAnswer(item)
  const wrong = (matchedGroups: number, reason: string): TheoryAnswerResult => ({
    correct: false,
    matchedGroups,
    done: true,
    expected: expectedText,
    reason,
  })
  let matchedGroups = 0
  for (const played of playedSoFar) {
    const expected = item.answer[matchedGroups]
    if (expected === undefined) {
      return wrong(matchedGroups, describeExtraGroups(item, matchedGroups))
    }
    // A cadence is graded on the cadence's own requirements; every other kind
    // still matches the spelled answer note for note.
    const ok =
      item.cadence !== undefined
        ? cadenceGroupVerdict(item.cadence, matchedGroups, played).ok
        : groupsMatch(item.kind, expected, played)
    if (!ok) return wrong(matchedGroups, describeGroupMiss(item, matchedGroups, played))
    matchedGroups++
  }
  const done = matchedGroups === item.answer.length
  if (!done) {
    return { correct: false, matchedGroups, done, expected: expectedText, reason: '' }
  }
  if (item.kind === 'build-scale' && !isStrictlyAscending(playedSoFar)) {
    return wrong(matchedGroups, SCALE_NOT_ASCENDING)
  }
  if (item.kind === 'build-interval' && !intervalMatches(item.answer, playedSoFar)) {
    return wrong(matchedGroups, INTERVAL_MISMATCH)
  }
  return { correct: true, matchedGroups, done, expected: expectedText, reason: '' }
}
