import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { midi, type Midi } from '@core/shared/units.ts'
import { at } from '@core/shared/invariant.ts'
import { seededRng } from '@core/ports/rng.ts'
import { buildTheoryQuiz, type TheoryQuizItem, type TheoryQuizKind } from './theory.ts'
import {
  advanceEcho,
  ECHO_START,
  echoDone,
  echoPlayed,
  echoTotal,
  type EchoProgress,
} from './theoryEcho.ts'

const KINDS: readonly TheoryQuizKind[] = [
  'build-scale',
  'build-chord',
  'build-interval',
  'name-key-signature',
  'build-cadence',
]

const arbKind = fc.constantFrom(...KINDS)
const arbLevel = fc.integer({ min: 1, max: 10 })
const arbSeed = fc.integer({ min: 0, max: 2 ** 31 - 1 })

/** A different pitch class from `note`, one semitone away, staying in MIDI range. */
function bumpNote(note: Midi): Midi {
  return midi(note + 1 <= 127 ? note + 1 : note - 1)
}

/** The octave direction that keeps every note in `answer` inside 0..127. */
function octaveDirectionFor(answer: readonly (readonly Midi[])[]): 1 | -1 {
  const all = answer.flatMap((g) => [...g])
  return Math.max(...all) + 12 <= 127 ? 1 : -1
}

/** Play `notes` into the echo in order from the start, counting refused presses. */
function playEcho(
  item: TheoryQuizItem,
  notes: readonly Midi[],
): { progress: EchoProgress; refused: number } {
  let progress = ECHO_START
  let refused = 0
  for (const note of notes) {
    const next = advanceEcho(item, progress, note)
    if (next === undefined) refused += 1
    else progress = next
  }
  return { progress, refused }
}

/** The answer flattened into the order a learner would press it. */
function answerNotes(item: TheoryQuizItem): readonly Midi[] {
  return item.answer.flatMap((group) => [...group])
}

describe('the reveal play-back echo', () => {
  it('property: an item plays its own answer back to done, note by note', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const { progress, refused } = playEcho(item, answerNotes(item))
        expect(refused).toBe(0)
        expect(echoDone(item, progress)).toBe(true)
        expect(echoPlayed(item, progress)).toBe(echoTotal(item))
      }),
    )
  })

  it('property: the same answer an octave away plays back just as well', () => {
    // The echo contradicting the grader is a defect a learner meets directly:
    // a complete C major scale played an octave up counted "0 of 8" while the
    // identical keys, played as the answer, graded "Correct".
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const direction = octaveDirectionFor(item.answer)
        const moved = answerNotes(item).map((n) => midi(n + 12 * direction))
        const { progress, refused } = playEcho(item, moved)
        expect(refused).toBe(0)
        expect(echoDone(item, progress)).toBe(true)
      }),
    )
  })

  it('property: a chord group played top note first still counts', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const reversed = item.answer.flatMap((group) => [...group].reverse())
        const { progress, refused } = playEcho(item, reversed)
        expect(refused).toBe(0)
        expect(echoDone(item, progress)).toBe(true)
      }),
    )
  })

  it('property: every accepted press moves the count on by exactly one', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        let progress = ECHO_START
        for (const note of answerNotes(item)) {
          const before = echoPlayed(item, progress)
          const next = advanceEcho(item, progress, note)
          if (next === undefined) throw new Error('the answer must be playable back')
          expect(echoPlayed(item, next)).toBe(before + 1)
          progress = next
        }
      }),
    )
  })

  it('refuses a note from the next group until this one is finished', () => {
    const item = buildTheoryQuiz('build-scale', 1, seededRng(1))
    const first = at(item.answer, 0)
    expect(first).toHaveLength(1)
    const ahead = at(at(item.answer, 1), 0)
    expect(first.some((n) => n % 12 === ahead % 12)).toBe(false)

    expect(advanceEcho(item, ECHO_START, ahead)).toBeUndefined()

    const opened = advanceEcho(item, ECHO_START, at(first, 0))
    if (opened === undefined) throw new Error('the first note must open the echo')
    expect(advanceEcho(item, opened, ahead)).toEqual({ group: 2, matched: [] })
  })

  it('refuses a note the answer never names, and holds the count where it was', () => {
    const item = buildTheoryQuiz('build-scale', 1, seededRng(1))
    const wrong = bumpNote(at(at(item.answer, 0), 0))
    expect(advanceEcho(item, ECHO_START, wrong)).toBeUndefined()
    expect(echoPlayed(item, ECHO_START)).toBe(0)
  })

  it('refuses every press once the whole answer is back', () => {
    const item = buildTheoryQuiz('build-scale', 1, seededRng(1))
    const { progress } = playEcho(item, answerNotes(item))
    expect(echoDone(item, progress)).toBe(true)
    for (const note of answerNotes(item)) {
      expect(advanceEcho(item, progress, note)).toBeUndefined()
    }
  })

  it('counts nothing at the start and every note of the answer as its total', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        expect(echoPlayed(item, ECHO_START)).toBe(0)
        expect(echoDone(item, ECHO_START)).toBe(false)
        expect(echoTotal(item)).toBe(answerNotes(item).length)
      }),
    )
  })
})
