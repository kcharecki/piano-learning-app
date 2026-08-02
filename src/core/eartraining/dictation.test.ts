import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { seededRng } from '@core/ports/rng.ts'
import { midi as asMidi, ticks as asTicks } from '@core/shared/units.ts'
import { makeScore } from '@core/notation/score.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { pitchClass, spelledPitchClass } from '@core/theory/pitch.ts'
import type { EarItem } from '@core/eartraining/item.ts'
import {
  gradeDictation,
  generateMelodicDictation,
  generateRhythmicDictation,
  type DictationAnswerNote,
} from './dictation.ts'

const seedArb = fc.integer({ min: 0, max: 100_000 })
const levelArb = fc.integer({ min: 1, max: 5 })

function toAnswer(item: EarItem): DictationAnswerNote[] {
  return item.prompt.notes.map((n) => ({ midi: n.midi, startTick: n.startTick }))
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

describe('generateMelodicDictation', () => {
  it('is deterministic in its rng seed', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const a = generateMelodicDictation(level, {}, seededRng(seed))
        const b = generateMelodicDictation(level, {}, seededRng(seed))
        expect(a.id).toBe(b.id)
        expect(a.answerKey).toBe(b.answerKey)
        expect(a.prompt.notes).toEqual(b.prompt.notes)
      }),
    )
  })

  it('produces a single monophonic right-hand line', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        expect(item.kind).toBe('melodic-dictation')
        expect(item.prompt.notes.every((n) => n.hand === 'right')).toBe(true)
        for (let i = 1; i < item.prompt.notes.length; i++) {
          expect(item.prompt.notes[i]!.startTick).toBeGreaterThan(
            item.prompt.notes[i - 1]!.startTick,
          )
        }
      }),
    )
  })

  it('honours a bars override', () => {
    const item = generateMelodicDictation(2, { bars: 3 }, seededRng(7))
    expect(item.prompt.measures).toHaveLength(3)
  })

  it('honours a range override', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const range = { low: asMidi(48), high: asMidi(60) }
        const item = generateMelodicDictation(level, { range }, seededRng(seed))
        expect(item.prompt.notes.every((n) => n.midi >= 48 && n.midi <= 60)).toBe(true)
      }),
    )
  })

  it('honours a key override', () => {
    const key = keyFromFifths(3, 'major')
    const range = { low: asMidi(57), high: asMidi(81) } // wide enough to contain A (69/57/81)
    const item = generateMelodicDictation(1, { key, range }, seededRng(11))
    expect(item.prompt.measures.every((m) => m.keyFifths === 3)).toBe(true)
    const notes = item.prompt.notes
    expect(notes.length).toBeGreaterThan(0)
    const lastNote = notes[notes.length - 1]
    if (lastNote === undefined) throw new Error('expected at least one note')
    expect(pitchClass(lastNote.midi)).toBe(spelledPitchClass(key.tonic))
  })
})

describe('generateRhythmicDictation', () => {
  it('is deterministic in its rng seed', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const a = generateRhythmicDictation(level, {}, seededRng(seed))
        const b = generateRhythmicDictation(level, {}, seededRng(seed))
        expect(a.id).toBe(b.id)
        expect(a.answerKey).toBe(b.answerKey)
        expect(a.prompt.notes).toEqual(b.prompt.notes)
      }),
    )
  })

  it('generates a single repeated pitch at the middle of the range', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const range = { low: asMidi(48), high: asMidi(60) }
        const item = generateRhythmicDictation(level, { range }, seededRng(seed))
        expect(item.kind).toBe('rhythmic-dictation')
        const pitches = new Set(item.prompt.notes.map((n) => n.midi))
        if (item.prompt.notes.length > 0) {
          expect(pitches).toEqual(new Set([54]))
        }
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// grading
// ---------------------------------------------------------------------------

describe('gradeDictation', () => {
  it('grades a melodic item against its own notes as fully correct', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const answer = toAnswer(item)
        const grade = gradeDictation(item, answer)
        expect(grade.correct).toBe(true)
        expect(grade.pitchAccuracy).toBe(1)
        expect(grade.rhythmAccuracy).toBe(1)
        expect(grade.given).toBe(grade.expected)
        expect(grade.notes).toHaveLength(answer.length)
        expect(grade.notes.every((n) => n.status === 'correct')).toBe(true)
        grade.notes.forEach((n, i) => {
          expect(n.expectedIndex).toBe(i)
          expect(n.givenIndex).toBe(i)
        })
      }),
    )
  })

  it('grades a rhythmic item against its own onsets as fully correct', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateRhythmicDictation(level, {}, seededRng(seed))
        const answer = toAnswer(item)
        const grade = gradeDictation(item, answer)
        expect(grade.correct).toBe(true)
        expect(grade.pitchAccuracy).toBe(1)
        expect(grade.rhythmAccuracy).toBe(1)
        expect(grade.given).toBe(grade.expected)
      }),
    )
  })

  it('rhythmic dictation ignores pitch entirely when grading', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateRhythmicDictation(level, {}, seededRng(seed))
        const answer = toAnswer(item).map((n) => ({ midi: asMidi(21), startTick: n.startTick }))
        const grade = gradeDictation(item, answer)
        expect(grade.correct).toBe(true)
        expect(grade.pitchAccuracy).toBe(1)
        expect(grade.notes.every((n) => n.status === 'correct')).toBe(true)
      }),
    )
  })

  it('dropping one note yields exactly one missing and leaves the rest correct', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 2)
        const dropIndex = seed % full.length
        const answer = full.filter((_, i) => i !== dropIndex)

        const grade = gradeDictation(item, answer)
        const missing = grade.notes.filter((n) => n.status === 'missing')
        const rest = grade.notes.filter((n) => n.status !== 'missing')

        // Which index is reported missing is not asserted: if the dropped note's
        // neighbour happens to share its pitch and lies within tolerance of it
        // (a busy, stepwise passage can do this), attributing the gap to either
        // one is an equally valid reading of the same answer. What must hold —
        // and is the anti-cascade property this test exists for — is that there
        // is exactly one gap and every other note is still exactly correct.
        expect(missing).toHaveLength(1)
        expect(rest.every((n) => n.status === 'correct')).toBe(true)
        expect(grade.notes).toHaveLength(full.length)
        expect(grade.correct).toBe(false)
      }),
    )
  })

  it('inserting one spurious note near the start yields exactly one extra and leaves the rest correct', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 2)
        const first = full[0]!
        const second = full[1]!
        const midTick = Math.floor((first.startTick + second.startTick) / 2)
        fc.pre(midTick !== first.startTick && midTick !== second.startTick)

        const spurious: DictationAnswerNote = { midi: asMidi(60), startTick: asTicks(midTick) }
        const answer = [first, spurious, ...full.slice(1)]

        const grade = gradeDictation(item, answer)
        const extra = grade.notes.filter((n) => n.status === 'extra')
        const rest = grade.notes.filter((n) => n.status !== 'extra')

        expect(extra).toHaveLength(1)
        expect(rest.every((n) => n.status === 'correct')).toBe(true)
        expect(grade.notes).toHaveLength(answer.length)
        expect(grade.correct).toBe(false)
      }),
    )
  })

  it('dropping one note and appending a spurious one yields one missing, one extra, and the rest correct', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 2)
        const dropIndex = seed % full.length
        const dropped = full.filter((_, i) => i !== dropIndex)
        const lastTick = full[full.length - 1]?.startTick ?? asTicks(0)
        const spurious: DictationAnswerNote = {
          midi: asMidi(60),
          startTick: asTicks(lastTick + 10 * 480),
        }
        const answer = [...dropped, spurious]

        const grade = gradeDictation(item, answer)
        const missing = grade.notes.filter((n) => n.status === 'missing')
        const extra = grade.notes.filter((n) => n.status === 'extra')
        const rest = grade.notes.filter((n) => n.status !== 'missing' && n.status !== 'extra')

        expect(missing).toHaveLength(1)
        expect(extra).toHaveLength(1)
        expect(rest.every((n) => n.status === 'correct')).toBe(true)
        expect(grade.rhythmAccuracy).toBeCloseTo((full.length - 1) / full.length)
        expect(grade.correct).toBe(false)
      }),
    )
  })

  it('transposing every pitch by a semitone leaves rhythmAccuracy at 1 and pitchAccuracy at 0', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 1)
        const answer = full.map((n) => ({ midi: asMidi(n.midi + 1), startTick: n.startTick }))

        const grade = gradeDictation(item, answer)
        expect(grade.rhythmAccuracy).toBe(1)
        expect(grade.pitchAccuracy).toBe(0)
        expect(grade.notes.every((n) => n.status === 'wrong-pitch')).toBe(true)
        expect(grade.correct).toBe(false)
      }),
    )
  })

  it('a paired note with matching pitch but an out-of-tolerance onset grades wrong-rhythm', () => {
    // Built by hand, not via the generator, so the inter-onset gap (960 ticks, a half
    // note) and the applied shift (300 ticks) are both exact: the shift clears the
    // default eighth-note tolerance (240) but stays far closer to each note's own
    // onset than to either neighbour's (960 - 300 = 660 away), so there is no
    // ambiguity about which note a shifted onset belongs to.
    const score = makeScore({
      id: 'test:wrong-rhythm',
      measures: [{}, {}],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 960, hand: 'right' },
        { midi: 62, startTick: 960, durationTicks: 960, hand: 'right' },
        { midi: 64, startTick: 1920, durationTicks: 960, hand: 'right' },
        { midi: 65, startTick: 2880, durationTicks: 960, hand: 'right' },
      ],
    })
    const item: EarItem = {
      id: 'test:wrong-rhythm',
      kind: 'melodic-dictation',
      prompt: score,
      answerKey: 'irrelevant-for-this-test',
      level: 1,
    }
    const shift = 300 // > the default eighth-note tolerance (240), and not a multiple of the 480 gap
    const answer: DictationAnswerNote[] = score.notes.map((n) => ({
      midi: n.midi,
      startTick: asTicks(n.startTick + shift),
    }))

    const grade = gradeDictation(item, answer)

    expect(grade.notes).toHaveLength(4)
    expect(grade.notes.every((n) => n.status === 'wrong-rhythm')).toBe(true)
    expect(grade.pitchAccuracy).toBe(1)
    expect(grade.rhythmAccuracy).toBe(0)
    expect(grade.correct).toBe(false)
  })

  it('respects a custom toleranceTicks', () => {
    const score = makeScore({
      id: 'test:tolerance',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
    })
    const item: EarItem = {
      id: 'test:tolerance',
      kind: 'melodic-dictation',
      prompt: score,
      answerKey: 'irrelevant',
      level: 1,
    }
    const answer: DictationAnswerNote[] = [{ midi: asMidi(60), startTick: asTicks(100) }]

    const loose = gradeDictation(item, answer, { toleranceTicks: asTicks(120) })
    expect(loose.notes[0]?.status).toBe('correct')

    const strict = gradeDictation(item, answer, { toleranceTicks: asTicks(50) })
    expect(strict.notes[0]?.status).toBe('wrong-rhythm')
  })

  it('handles an empty answer against a non-empty item as all missing', () => {
    const item = generateMelodicDictation(2, {}, seededRng(3))
    const grade = gradeDictation(item, [])
    expect(grade.notes.every((n) => n.status === 'missing')).toBe(true)
    expect(grade.notes).toHaveLength(item.prompt.notes.length)
    expect(grade.correct).toBe(item.prompt.notes.length === 0)
  })

  it('handles an empty item with a non-empty answer as all extra', () => {
    const score = makeScore({
      id: 'test:empty-item',
      measures: [{}],
      notes: [],
    })
    const item: EarItem = {
      id: 'test:empty-item',
      kind: 'melodic-dictation',
      prompt: score,
      answerKey: '',
      level: 1,
    }
    const answer: DictationAnswerNote[] = [
      { midi: asMidi(60), startTick: asTicks(0) },
      { midi: asMidi(62), startTick: asTicks(480) },
    ]
    const grade = gradeDictation(item, answer)
    expect(grade.notes.every((n) => n.status === 'extra')).toBe(true)
    expect(grade.notes).toHaveLength(2)
    expect(grade.pitchAccuracy).toBe(0)
    expect(grade.rhythmAccuracy).toBe(0)
    expect(grade.correct).toBe(false)
  })

  it('an empty item graded against an empty answer is trivially correct', () => {
    const score = makeScore({ id: 'test:both-empty', measures: [{}], notes: [] })
    const item: EarItem = {
      id: 'test:both-empty',
      kind: 'melodic-dictation',
      prompt: score,
      answerKey: '',
      level: 1,
    }
    const grade = gradeDictation(item, [])
    expect(grade.notes).toHaveLength(0)
    expect(grade.correct).toBe(true)
    expect(grade.pitchAccuracy).toBe(1)
    expect(grade.rhythmAccuracy).toBe(1)
  })
})
