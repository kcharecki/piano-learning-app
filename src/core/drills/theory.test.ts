import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { midi, type Midi } from '@core/shared/units.ts'
import { seededRng } from '@core/ports/rng.ts'
import { classifyCadence, chordForRomanNumeral } from '@core/theory/harmony.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { buildChord, chordMidi } from '@core/theory/chords.ts'
import { spell } from '@core/theory/pitch.ts'
import { buildTheoryQuiz, gradeTheoryStep, type TheoryQuizItem, type TheoryQuizKind } from './theory.ts'

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
// buildTheoryQuiz — determinism
// ---------------------------------------------------------------------------

describe('buildTheoryQuiz — determinism', () => {
  it('is fully determined by kind, level and a seeded rng, ids included', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const a = buildTheoryQuiz(kind, level, seededRng(seed))
        const b = buildTheoryQuiz(kind, level, seededRng(seed))
        expect(b).toEqual(a)
      }),
    )
  })

  it('treats level 0 and negative levels as level 1', () => {
    fc.assert(
      fc.property(arbKind, arbSeed, (kind, seed) => {
        const level1 = buildTheoryQuiz(kind, 1, seededRng(seed))
        expect(buildTheoryQuiz(kind, 0, seededRng(seed))).toEqual(level1)
        expect(buildTheoryQuiz(kind, -5, seededRng(seed))).toEqual(level1)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// buildTheoryQuiz — shape
// ---------------------------------------------------------------------------

describe('buildTheoryQuiz — shape', () => {
  it('marks chord/cadence items simultaneous and note-sequence items not', () => {
    const expected: Readonly<Record<TheoryQuizKind, boolean>> = {
      'build-scale': false,
      'build-chord': true,
      'build-interval': false,
      'name-key-signature': false,
      'build-cadence': true,
    }
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        expect(item.simultaneous).toBe(expected[kind])
        expect(item.kind).toBe(kind)
        expect(item.answer.length).toBeGreaterThan(0)
      }),
    )
  })

  it('build-scale plays ascending, tonic to tonic', () => {
    const item = buildTheoryQuiz('build-scale', 4, seededRng(7))
    expect(item.prompt).toMatch(/^Play .+, ascending\.$/)
    expect(item.answer.length).toBeGreaterThanOrEqual(6)
    // every group is exactly one note
    for (const group of item.answer) expect(group.length).toBe(1)
  })

  it('build-chord plays every voice of the chord together', () => {
    const item = buildTheoryQuiz('build-chord', 4, seededRng(3))
    expect(item.prompt).toMatch(/^Play a \S+ .+ chord, .+\.$/)
    expect(item.answer.length).toBe(1)
    expect((item.answer[0] as readonly Midi[]).length).toBeGreaterThanOrEqual(3)
  })

  it('build-interval plays the root, then the interval note', () => {
    const item = buildTheoryQuiz('build-interval', 4, seededRng(9))
    expect(item.prompt).toMatch(/^Play \S+, then a .+ above it\.$/)
    expect(item.answer.length).toBe(2)
    for (const group of item.answer) expect(group.length).toBe(1)
    // the target really is above the root, by the interval's own distance
    const semitones = (item.answer[1] as readonly Midi[])[0] as number
    const root = (item.answer[0] as readonly Midi[])[0] as number
    expect(semitones - root).toBeGreaterThan(0)
  })

  it('name-key-signature is answered by a single tonic note', () => {
    const item = buildTheoryQuiz('name-key-signature', 4, seededRng(5))
    expect(item.prompt).toMatch(/^How many (sharps|flats|sharps or flats) has .+\? Answer by playing its tonic\.$/)
    expect(item.answer).toEqual([item.answer[0]])
    expect((item.answer[0] as readonly Midi[]).length).toBe(1)
  })

  it('build-cadence plays two chords in sequence', () => {
    const item = buildTheoryQuiz('build-cadence', 4, seededRng(11))
    expect(item.prompt).toMatch(/^Play a .+ cadence in .+\.$/)
    expect(item.answer.length).toBe(2)
    for (const group of item.answer) expect(group.length).toBeGreaterThanOrEqual(3)
  })

  it('level 1 stays at the simplest pool: no accidentals, only the perfect authentic cadence', () => {
    for (let seed = 0; seed < 20; seed++) {
      const key = buildTheoryQuiz('name-key-signature', 1, seededRng(seed))
      expect(key.prompt).toMatch(
        /^How many sharps or flats has (C major|A minor)\? Answer by playing its tonic\.$/,
      )

      const cadence = buildTheoryQuiz('build-cadence', 1, seededRng(seed))
      expect(cadence.prompt).toMatch(/^Play a perfect authentic cadence in/)
    }
  })

  it('level 1 build-cadence items really are perfect authentic cadences, per classifyCadence', () => {
    const cMajor = keyFromFifths(0, 'major')
    const v = chordForRomanNumeral('V', cMajor)
    const i = chordForRomanNumeral('I', cMajor)
    if (!v.ok || !i.ok) throw new Error('V and I must be diatonic in C major')
    for (let seed = 0; seed < 30; seed++) {
      const item = buildTheoryQuiz('build-cadence', 1, seededRng(seed))
      const soprano = (item.answer[1] as readonly Midi[]).at(-1) as Midi
      expect(classifyCadence(v.value, i.value, cMajor, soprano)).toBe('perfect-authentic')
    }
  })

  it('chord and interval roots widen past naturals by level 3', () => {
    let sawAccidentalRoot = false
    for (let seed = 0; seed < 200 && !sawAccidentalRoot; seed++) {
      const chord = buildTheoryQuiz('build-chord', 3, seededRng(seed))
      const interval = buildTheoryQuiz('build-interval', 3, seededRng(seed))
      if (/[#b]/.test(chord.prompt) || /[#b]/.test(interval.prompt)) sawAccidentalRoot = true
    }
    expect(sawAccidentalRoot).toBe(true)
  })

  it('level progression is monotonic: every id reachable at a level is still reachable one level up', () => {
    for (const kind of KINDS) {
      for (let level = 1; level <= 3; level++) {
        const lowerIds = new Set<string>()
        const higherIds = new Set<string>()
        for (let seed = 0; seed < 100; seed++) {
          lowerIds.add(buildTheoryQuiz(kind, level, seededRng(seed)).id)
          higherIds.add(buildTheoryQuiz(kind, level + 1, seededRng(seed)).id)
        }
        for (const id of lowerIds) {
          if (higherIds.has(id)) continue
          // A higher level's pool is a strict superset — more seeds at the
          // higher level must eventually reach the same id.
          let found = false
          for (let seed = 100; seed < 6000 && !found; seed++) {
            if (buildTheoryQuiz(kind, level + 1, seededRng(seed)).id === id) found = true
          }
          expect(found).toBe(true)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// gradeTheoryStep
// ---------------------------------------------------------------------------

describe('gradeTheoryStep', () => {
  it('grades every generated item playing its own answer as fully correct', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const result = gradeTheoryStep(item, item.answer)
        expect(result).toEqual({ correct: true, matchedGroups: item.answer.length, done: true })
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
        expect(result).toEqual({ correct: true, matchedGroups: item.answer.length, done: true })
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
        const size = ((target - root) % 12 + 12) % 12
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
      level: 2,
      prompt: 'Play a C major chord, first inversion.',
      answer: [chordMidi(firstInversion)],
      simultaneous: true,
    }
    const result = gradeTheoryStep(item, [chordMidi(rootPosition)])
    expect(result.correct).toBe(false)
    // The actual first-inversion answer still grades correct.
    expect(gradeTheoryStep(item, item.answer).correct).toBe(true)
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
    expect(partial).toEqual({ correct: false, matchedGroups: 1, done: false })
  })

  it('settles as done and correct only once every group has been played', () => {
    const item = buildTheoryQuiz('build-chord', 3, seededRng(2))
    const half = gradeTheoryStep(item, [])
    expect(half).toEqual({ correct: false, matchedGroups: 0, done: false })
    const full = gradeTheoryStep(item, item.answer)
    expect(full).toEqual({ correct: true, matchedGroups: item.answer.length, done: true })
  })
})
