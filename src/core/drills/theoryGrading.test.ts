import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { midi, type Midi } from '@core/shared/units.ts'
import { at } from '@core/shared/invariant.ts'
import { seededRng } from '@core/ports/rng.ts'
import { buildChord, chordMidi } from '@core/theory/chords.ts'
import { pitchDisplayName, spell } from '@core/theory/pitch.ts'
import {
  buildTheoryQuiz,
  theoryQuizFromId,
  type TheoryQuizItem,
  type TheoryQuizKind,
} from './theory.ts'
import { describeTheoryAnswer } from './theoryFeedback.ts'
import { gradeTheoryStep } from './theoryGrading.ts'

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
  const highest = Math.max(...all)
  return highest + 12 <= 127 ? 1 : -1
}

function transposeOctave(
  answer: readonly (readonly Midi[])[],
  direction: 1 | -1,
): readonly (readonly Midi[])[] {
  return answer.map((group) => group.map((n) => midi(n + 12 * direction)))
}

// ---------------------------------------------------------------------------
// gradeTheoryStep
// ---------------------------------------------------------------------------

describe('gradeTheoryStep', () => {
  it('grades every generated item playing its own answer as fully correct', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const result = gradeTheoryStep(item, item.answer)
        expect(result).toEqual({
          correct: true,
          matchedGroups: item.answer.length,
          done: true,
          expected: describeTheoryAnswer(item),
          reason: '',
        })
      }),
    )
  })

  it('rejects a single wrong note anywhere in the answer', () => {
    fc.assert(
      fc.property(
        arbKind,
        arbLevel,
        arbSeed,
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (kind, level, seed, groupPick, notePick) => {
          const item = buildTheoryQuiz(kind, level, seededRng(seed))
          const groupIndex = groupPick % item.answer.length
          const group = item.answer[groupIndex] as readonly Midi[]
          const noteIndex = notePick % group.length

          const mutated = item.answer.map((g, gi) =>
            gi === groupIndex ? g.map((n, ni) => (ni === noteIndex ? bumpNote(n) : n)) : g,
          )

          const result = gradeTheoryStep(item, mutated)
          expect(result.correct).toBe(false)
          expect(result.done).toBe(true)
          expect(result.matchedGroups).toBe(groupIndex)
        },
      ),
    )
  })

  it('is octave-insensitive: the whole answer transposed by an octave still grades correct', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const direction = octaveDirectionFor(item.answer)
        const transposed = transposeOctave(item.answer, direction)
        const result = gradeTheoryStep(item, transposed)
        expect(result).toEqual({
          correct: true,
          matchedGroups: item.answer.length,
          done: true,
          expected: describeTheoryAnswer(item),
          reason: '',
        })
      }),
    )
  })

  it('build-scale: the correct pitch classes played in scrambled octaves do not grade correct', () => {
    fc.assert(
      fc.property(arbLevel, arbSeed, (level, seed) => {
        const item = buildTheoryQuiz('build-scale', level, seededRng(seed))
        // Force every note into octave 4-5, alternating — scrambles the
        // ascending contour while keeping every pitch class correct.
        const scrambled = item.answer.map((group, i) =>
          group.map((n) => midi((((n % 12) + 12) % 12) + (i % 2 === 0 ? 60 : 72))),
        )
        const result = gradeTheoryStep(item, scrambled)
        expect(result.correct).toBe(false)
      }),
    )
  })

  it('build-interval: the right pitch classes in the wrong direction do not grade correct', () => {
    fc.assert(
      fc.property(arbLevel, arbSeed, (level, seed) => {
        const item = buildTheoryQuiz('build-interval', level, seededRng(seed))
        const root = (item.answer[0] as readonly Midi[])[0] as number
        const target = (item.answer[1] as readonly Midi[])[0] as number
        const size = (((target - root) % 12) + 12) % 12
        if (size === 0) return // a perfect octave: root - 12 would still be a valid octave below
        // Same pitch class as the real target, but an octave lower — below the
        // root rather than above it. Pitch-class matching alone cannot tell.
        const wrongTarget = root + size - 12
        const result = gradeTheoryStep(item, [[midi(root)], [midi(wrongTarget)]])
        expect(result.correct).toBe(false)
      }),
    )
  })

  it('build-chord: root position does not grade correct against a first-inversion prompt', () => {
    const rootPosition = buildChord(spell('C', 0, 4), 'major', 0)
    const firstInversion = buildChord(spell('C', 0, 4), 'major', 1)
    const item: TheoryQuizItem = {
      id: 'build-chord-C-major-1',
      kind: 'build-chord',
      prompt: 'Play a C major chord, first inversion.',
      answer: [chordMidi(firstInversion)],
      spelledAnswer: [firstInversion.notes],
      simultaneous: true,
    }
    const result = gradeTheoryStep(item, [chordMidi(rootPosition)])
    expect(result.correct).toBe(false)
    // The actual first-inversion answer still grades correct.
    expect(gradeTheoryStep(item, item.answer).correct).toBe(true)
  })

  // -------------------------------------------------------------------------
  // build-cadence — roadmap `T.23`. A cadence is a relation between two chords,
  // not a voicing of them, so grading asks the cadence's own three questions.
  // -------------------------------------------------------------------------

  /** The level-1 cadence: perfect authentic in C major, the only draw at level 1. */
  const cadenceInC = (): TheoryQuizItem => {
    const item = theoryQuizFromId('build-cadence-perfect-authentic-C')
    if (item === undefined) throw new Error('build-cadence-perfect-authentic-C must be buildable')
    return item
  }

  const notes = (...ns: readonly number[]): readonly Midi[] => ns.map((n) => midi(n))
  /** G4 B4 D5 — the dominant, root position, unchanged by this run. */
  const V_IN_C = notes(67, 71, 74)

  it('build-cadence: the answer it names is a complete tonic triad with the tonic on top', () => {
    // C4 E4 G4 C5 — root, third, FIFTH, tonic doubled above. Deleting the fifth
    // was `T.23`.
    expect(cadenceInC().answer[1]).toEqual(notes(60, 64, 67, 72))
  })

  it('build-cadence: a perfect authentic cadence spread over other octaves grades correct', () => {
    // Same three requirements, a different arrangement: the tonic in the bass
    // an octave down, the third above the fifth. Exact-MIDI matching called
    // this wrong.
    const result = gradeTheoryStep(cadenceInC(), [V_IN_C, notes(48, 67, 76, 84)])
    expect(result.correct).toBe(true)
  })

  it('build-cadence: an incomplete final tonic — root, third, doubled root, no fifth — grades correct', () => {
    // What four-part writing does at a final cadence, and what this drill
    // itself demanded before `T.23` was fixed.
    // C4 E4 C5 C6 — no G anywhere, tonic still the highest voice.
    const result = gradeTheoryStep(cadenceInC(), [V_IN_C, notes(60, 64, 72, 84)])
    expect(result.correct).toBe(true)
  })

  it('build-cadence: the fifth in the highest voice is an IMPERFECT authentic cadence and is refused', () => {
    // C4 E4 G4 + G5: right chord, root position, wrong soprano. Accepting it
    // would make the drill grade a different cadence than the one it asked for.
    const result = gradeTheoryStep(cadenceInC(), [V_IN_C, notes(60, 64, 67, 79)])
    expect(result.correct).toBe(false)
    expect(result.matchedGroups).toBe(1)
  })

  it('build-cadence: a first-inversion tonic is refused even with the tonic on top', () => {
    // E4 G4 C5 C6 — soprano is the tonic, bass is the third. `classifyCadence`
    // requires root position on both chords for a perfect authentic cadence.
    const result = gradeTheoryStep(cadenceInC(), [V_IN_C, notes(64, 67, 72, 84)])
    expect(result.correct).toBe(false)
  })

  it('build-cadence: an inverted DOMINANT is refused too — the rule is both chords', () => {
    // B3 D4 G4 — V6. Right pitch classes, third in the bass.
    const result = gradeTheoryStep(cadenceInC(), [notes(59, 62, 67)])
    expect(result.correct).toBe(false)
    expect(result.matchedGroups).toBe(0)
  })

  it('build-cadence: a foreign note is refused however well the rest fits', () => {
    // C4 E4 G4 A5 — A is in neither chord.
    const result = gradeTheoryStep(cadenceInC(), [V_IN_C, notes(60, 64, 67, 81)])
    expect(result.correct).toBe(false)
  })

  it('build-cadence: a chord missing its third is refused — the third is what fixes the quality', () => {
    // C4 G4 C5 C6: an open fifth is not a tonic triad.
    const result = gradeTheoryStep(cadenceInC(), [V_IN_C, notes(60, 67, 72, 84)])
    expect(result.correct).toBe(false)
  })

  it('build-cadence: half, plagal and deceptive cadences accept inverted chords', () => {
    // Only `perfect-authentic` carries a root-position requirement in
    // `classifyCadence`, so the others must not inherit one.
    const half = theoryQuizFromId('build-cadence-half-C')
    expect(half).toBeDefined()
    // I6 (E4 G4 C5) then V (G4 B4 D5) — still a half cadence.
    expect(gradeTheoryStep(half as TheoryQuizItem, [notes(64, 67, 72), V_IN_C]).correct).toBe(true)
  })

  it('build-cadence: property — over every level and seed, the generated answer grades correct and the same chord with a non-tonic soprano does not', () => {
    fc.assert(
      fc.property(arbLevel, arbSeed, (level, seed) => {
        const item = buildTheoryQuiz('build-cadence', level, seededRng(seed))
        expect(gradeTheoryStep(item, item.answer).correct).toBe(true)
        if (item.cadence?.type !== 'perfect-authentic') return
        const final = item.answer[1] as readonly Midi[]
        // Move the top voice to a chord tone that is NOT the tonic, keeping the
        // bass and every other voice where it is.
        const tonicPc = item.cadence.tonicPitchClass
        const other = final.find((n) => n % 12 !== tonicPc)
        if (other === undefined) return
        const top = Math.max(...final)
        const raised = midi(((other % 12) + 12) % 12 + (Math.floor(top / 12) + 1) * 12)
        if (raised > 127) return
        expect(gradeTheoryStep(item, [item.answer[0] as readonly Midi[], [...final, raised]]).correct).toBe(false)
      }),
    )
  })

  it('build-chord: a single voice moved an octave (a differently-spread voicing) still grades correct', () => {
    fc.assert(
      fc.property(arbLevel, arbSeed, (level, seed) => {
        const item = buildTheoryQuiz('build-chord', level, seededRng(seed))
        const chord = item.answer[0] as readonly Midi[]
        if (chord.length < 2) return
        const lastIndex = chord.length - 1
        const respread = chord.map((n, i) => (i === lastIndex ? midi(n + 12) : n))
        const result = gradeTheoryStep(item, [respread])
        expect(result.correct).toBe(true)
      }),
    )
  })

  it('build-scale: the right notes in the wrong order do not grade correct', () => {
    fc.assert(
      fc.property(arbLevel, arbSeed, (level, seed) => {
        const item = buildTheoryQuiz('build-scale', level, seededRng(seed))
        const reversed = [...item.answer].reverse()
        const result = gradeTheoryStep(item, reversed)
        expect(result.correct).toBe(false)
      }),
    )
  })

  it('tracks progressive matches before the attempt is settled', () => {
    const item: TheoryQuizItem = buildTheoryQuiz('build-scale', 1, seededRng(1))
    const first = item.answer[0] as readonly Midi[]
    const partial = gradeTheoryStep(item, [first])
    expect(partial).toEqual({
      correct: false,
      matchedGroups: 1,
      done: false,
      expected: describeTheoryAnswer(item),
      reason: '',
    })
  })

  it('settles as done and correct only once every group has been played', () => {
    const item = buildTheoryQuiz('build-chord', 3, seededRng(2))
    const half = gradeTheoryStep(item, [])
    expect(half).toEqual({
      correct: false,
      matchedGroups: 0,
      done: false,
      expected: describeTheoryAnswer(item),
      reason: '',
    })
    const full = gradeTheoryStep(item, item.answer)
    expect(full).toEqual({
      correct: true,
      matchedGroups: item.answer.length,
      done: true,
      expected: describeTheoryAnswer(item),
      reason: '',
    })
  })
})

// ---------------------------------------------------------------------------
// gradeTheoryStep's `reason` — a refusal a learner can act on
// (roadmap T.19 for the group that broke, T.39 for the rule that broke it)
// ---------------------------------------------------------------------------

describe('gradeTheoryStep — the refusal says what went wrong, not just what was right', () => {
  /** The first `build-scale` item at a level, whose groups are one note each. */
  const scaleItem = (): TheoryQuizItem => buildTheoryQuiz('build-scale', 1, seededRng(1))

  /**
   * A `build-cadence` item that is specifically a PERFECT AUTHENTIC one — the
   * only type with a leading tone in its dominant, and so the only type whose
   * doubling rule can be reached. Found by seed rather than hand-built, so the
   * item under test is one the generator really produces.
   */
  function perfectAuthenticItem(): TheoryQuizItem {
    for (let seed = 0; seed < 200; seed++) {
      const item = buildTheoryQuiz('build-cadence', 6, seededRng(seed))
      if (item.cadence?.type === 'perfect-authentic') return item
    }
    throw new Error('no perfect-authentic cadence item in the first 200 seeds')
  }

  it('names the position that broke, and what belonged there', () => {
    const item = scaleItem()
    const played = item.answer.map((group, i) => (i === 5 ? [bumpNote(at(group, 0))] : group))
    const result = gradeTheoryStep(item, played.slice(0, 6))

    expect(result.matchedGroups).toBe(5)
    expect(result.reason).toContain('Note 6:')
    expect(result.reason).toContain(pitchDisplayName(at(at(item.spelledAnswer, 5), 0)))
  })

  /**
   * The defect this replaced: a learner seven-eighths of the way through an
   * eight-note scale read exactly the sentence a learner who played one wrong
   * note first read. `expected` is the same in both; `reason` is what tells
   * them apart.
   */
  it('distinguishes a miss at the end from a miss at the start, which `expected` cannot', () => {
    const item = scaleItem()
    const early = gradeTheoryStep(item, [[bumpNote(at(at(item.answer, 0), 0))]])
    const late = gradeTheoryStep(
      item,
      item.answer.slice(0, 5).concat([[bumpNote(at(at(item.answer, 5), 0))]]),
    )
    expect(early.expected).toBe(late.expected)
    expect(early.reason).not.toBe(late.reason)
    expect(early.reason).toContain('Note 1:')
    expect(late.reason).toContain('Note 6:')
  })

  it('says nothing extra when the answer is right', () => {
    const item = scaleItem()
    expect(gradeTheoryStep(item, item.answer).reason).toBe('')
  })

  it('stays quiet on a single-group item, where `expected` already names the only group', () => {
    const item = buildTheoryQuiz('name-key-signature', 1, seededRng(4))
    expect(item.answer).toHaveLength(1)
    const wrong = gradeTheoryStep(item, [[bumpNote(at(at(item.answer, 0), 0))]])
    expect(wrong.correct).toBe(false)
    expect(wrong.reason).toBe('')
  })

  it('names the rule for a scale played out of order, which the note list cannot show', () => {
    const item = scaleItem()
    // Right pitch classes, one of them an octave down: every group matches and
    // the answer is still not a scale.
    const scrambled = item.answer.map((group, i) =>
      i === 3 ? [midi(at(group, 0) - 12)] : group,
    )
    const result = gradeTheoryStep(item, scrambled)
    expect(result.correct).toBe(false)
    expect(result.reason).toContain('higher than the one before')
  })

  it('names the rule for an interval played in the wrong direction', () => {
    const item = buildTheoryQuiz('build-interval', 3, seededRng(7))
    const root = at(at(item.answer, 0), 0)
    const target = at(at(item.answer, 1), 0)
    // The same two note NAMES, an octave apart instead of the interval asked
    // for — every group matches by pitch class, and the interval does not.
    const result = gradeTheoryStep(item, [[root], [midi(target - 12)]])
    expect(result.correct).toBe(false)
    expect(result.reason).toContain('wrong interval')
  })

  it('refuses more groups than the answer has, and says how long it is', () => {
    const item = scaleItem()
    const result = gradeTheoryStep(item, [...item.answer, at(item.answer, 0)])
    expect(result.correct).toBe(false)
    expect(result.reason).toContain('more than the answer needs')
    expect(result.reason).toContain(String(item.answer.length))
  })

  /**
   * Roadmap `T.39`'s own example, end to end: `G4 B4 B5` is a V chord in root
   * position with every requirement the prompt states, refused for a doubling
   * the prompt never mentions. The learner now reads the convention.
   */
  it('names the cadence convention a group broke, and which chord broke it', () => {
    const item = perfectAuthenticItem()
    const root = at(at(item.answer, 0), 0)
    const third = at(at(item.answer, 0), 1)
    // The dominant with its fifth dropped and its leading tone doubled.
    const result = gradeTheoryStep(item, [[root, third, midi(third + 12)]])
    expect(result.correct).toBe(false)
    expect(result.reason).toContain('First chord:')
    expect(result.reason).toContain('leading tone')
  })
})
