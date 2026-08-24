/**
 * The play-back echo: the reveal's second half, where a learner plays the
 * named answer back at the keys instead of only reading it.
 *
 * Its own module because it is its own concept — nothing here grades an
 * attempt, and the drill screen is the only caller.
 */
import { at } from '@core/shared/invariant.ts'
import { type Midi } from '@core/shared/units.ts'
import { type TheoryQuizItem } from './theory.ts'

/**
 * How far a learner has got playing the named answer back under the reveal.
 * `group` is the answer group being played; `matched` are the indexes within
 * that group already sounded. Both are needed because a group is a CHORD: a
 * mouse has one pointer, so its notes arrive one at a time and in any order.
 */
export type EchoProgress = {
  readonly group: number
  readonly matched: readonly number[]
}

/** Nothing played back yet. */
export const ECHO_START: EchoProgress = { group: 0, matched: [] }

/** Every note of the answer, counted flat — the echo's denominator. */
export function echoTotal(item: TheoryQuizItem): number {
  return item.answer.reduce((n, group) => n + group.length, 0)
}

/** How many notes of the answer have been played back — the echo's numerator. */
export function echoPlayed(item: TheoryQuizItem, progress: EchoProgress): number {
  let played = progress.matched.length
  for (let i = 0; i < progress.group && i < item.answer.length; i++) {
    played += at(item.answer, i).length
  }
  return played
}

/** The whole answer has been played back. */
export function echoDone(item: TheoryQuizItem, progress: EchoProgress): boolean {
  return progress.group >= item.answer.length
}

/**
 * One press against the play-back echo: the progress it produces, or
 * `undefined` when the note is not one the echo is waiting for.
 *
 * Matched **by pitch class, order-free within a group, groups in order** —
 * deliberately the same shape as `groupsMatch` above, because the echo
 * contradicting the grader is a defect a learner meets directly: the panel
 * found a complete, correct C major scale played an octave up counted as
 * "0 of 8" while the identical keys, played as the ANSWER, graded "Correct"
 * (panel r2 2026-08-24-1, Skeptic and Teacher). Octave-free matching is also
 * what makes an item whose answer runs off the panel's own keyboard playable
 * at all — 73 of the 770 generated items name a note outside 48–84.
 *
 * The one thing it does not mirror is `build-chord`'s bass rule and
 * `build-scale`'s ascending rule: those grade the ATTEMPT, and this is not an
 * attempt — it is the correction being rehearsed, already scored, with `Next`
 * the only way on.
 */
export function advanceEcho(
  item: TheoryQuizItem,
  progress: EchoProgress,
  note: Midi,
): EchoProgress | undefined {
  if (echoDone(item, progress)) return undefined
  const group = at(item.answer, progress.group)
  const hit = group.findIndex(
    (expected, i) => !progress.matched.includes(i) && sameClass(expected, note),
  )
  if (hit === -1) return undefined
  const matched = [...progress.matched, hit]
  if (matched.length < group.length) return { group: progress.group, matched }
  return { group: progress.group + 1, matched: [] }
}

/** Two MIDI numbers that name the same note in some octave. */
function sameClass(a: Midi, b: Midi): boolean {
  return ((a % 12) + 12) % 12 === ((b % 12) + 12) % 12
}
