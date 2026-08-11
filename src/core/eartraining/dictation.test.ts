import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { seededRng } from '@core/ports/rng.ts'
import { midi as asMidi, ticks as asTicks } from '@core/shared/units.ts'
import { makeScore } from '@core/notation/score.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { pitchClass, spelledPitchClass, toMidi } from '@core/theory/pitch.ts'
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

  // roadmap 5.28: melodic dictation is generated IN a real Key — the one
  // drill here that gets to use the actual tonic instead of a stand-in.
  it('carries the key tonic as its tonal-context tonic', () => {
    const key = keyFromFifths(3, 'major')
    const range = { low: asMidi(57), high: asMidi(81) }
    const item = generateMelodicDictation(1, { key, range }, seededRng(11))
    expect(item.contextTonicMidi).toBe(toMidi(key.tonic))
  })
})

describe('generateMelodicDictation / generateRhythmicDictation — REQ-3.6.1 phrase length', () => {
  // The bug this task exists to fix: `defaultParamsForLevel`'s `bars` is tuned
  // for a full sight-reading piece (4 bars of quarters at level 2, 8 bars of
  // eighths at levels 3-5), so an un-bounded dictation item could carry dozens
  // of notes. This fails today (before the bounding in `generateMelodicDictation`/
  // `generateRhythmicDictation`) — a mutant that deletes the truncation or the
  // bars-growth loop reintroduces exactly this defect, in one direction or the
  // other.
  it('generates between 2 and 8 notes inclusive, for every level, both kinds', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const melodic = generateMelodicDictation(level, {}, seededRng(seed))
        expect(melodic.prompt.notes.length).toBeGreaterThanOrEqual(2)
        expect(melodic.prompt.notes.length).toBeLessThanOrEqual(8)

        const rhythmic = generateRhythmicDictation(level, {}, seededRng(seed))
        expect(rhythmic.prompt.notes.length).toBeGreaterThanOrEqual(2)
        expect(rhythmic.prompt.notes.length).toBeLessThanOrEqual(8)
      }),
    )
  })

  // Review finding: measured over 2000 rhythmic draws, 436 left the item with
  // declared trailing measures containing no onset at all — `score.measures`
  // was never trimmed to match the (possibly truncated, possibly
  // bar-grown-past-its-onsets) note list. A dangling empty measure at the end
  // of a "2-8 note phrase" is not itself an invalid Score, but it is not what
  // this bounding exists to produce either. This fails against the
  // pre-fix code (which never trimmed `measures`) for a large share of draws.
  it('never leaves a trailing measure with no notes in it, for an auto-selected bar count', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        for (const item of [
          generateMelodicDictation(level, {}, seededRng(seed)),
          generateRhythmicDictation(level, {}, seededRng(seed)),
        ]) {
          const lastNote = item.prompt.notes[item.prompt.notes.length - 1]
          if (lastNote === undefined) continue // the MIN floor guarantees >= 2, but guard anyway
          expect(lastNote.measureIndex).toBe(item.prompt.measures.length - 1)
        }
      }),
    )
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

  // roadmap 5.28: `opts.key` is already documented as meaningless here
  // ("rhythm has no scale") — a tonal-context drone before pure rhythm would
  // be noise, not context, so this drill never sets a tonic.
  it('carries no tonal-context tonic — rhythm has no scale', () => {
    const item = generateRhythmicDictation(1, {}, seededRng(7))
    expect(item.contextTonicMidi).toBeUndefined()
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

// ---------------------------------------------------------------------------
// grading — tempo-scale robustness (roadmap 3.23, REQ-3.6.1)
// ---------------------------------------------------------------------------

/**
 * A synthetic phrase with `n` notes evenly spaced a quarter note (480 ticks) apart, entirely
 * hand-built rather than drawn from `generateMelodicDictation` — the tempo-scale margin math in
 * the tests below (how far outside the accepted bound a factor has to land before the clamped fit
 * can no longer explain it) depends on knowing the exact inter-onset gap, which a generated
 * phrase's variable spacing does not give.
 */
function buildEvenPhrase(n: number): EarItem {
  const gap = 480
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72]
  const notes = Array.from({ length: n }, (_, i) => ({
    midi: pitches[i % pitches.length] as number,
    startTick: i * gap,
    durationTicks: 240,
    hand: 'right' as const,
  }))
  const score = makeScore({
    id: `test:even-phrase:${n}`,
    measures: [{ durationTicks: n * gap }],
    notes,
  })
  return {
    id: `test:even-phrase:${n}`,
    kind: 'melodic-dictation',
    prompt: score,
    answerKey: 'irrelevant-for-this-test',
    level: 1,
  }
}

/** A uniform scale of `answer`'s onsets around its own first onset. */
function scaleAnswer(answer: readonly DictationAnswerNote[], factor: number): DictationAnswerNote[] {
  const anchor = answer[0]?.startTick ?? asTicks(0)
  return answer.map((n) => ({
    midi: n.midi,
    startTick: asTicks(anchor + factor * (n.startTick - anchor)),
  }))
}

// Independent of dictation.ts's own private default — every test in this block that cares about
// "inside" vs "outside" the bound passes this explicitly, so it stays correct even if the private
// default changes.
const TEST_MAX_SCALE = 1.2

describe('gradeDictation — tempo-scale robustness (roadmap 3.23, REQ-3.6.1)', () => {
  it('grades a uniformly-scaled, otherwise note-perfect answer identically to the unscaled one, for any factor inside the accepted bound', () => {
    fc.assert(
      fc.property(
        seedArb,
        levelArb,
        fc.boolean(),
        fc.double({ min: 1 / TEST_MAX_SCALE, max: TEST_MAX_SCALE, noNaN: true }),
        (seed, level, melodic, factor) => {
          const item = melodic
            ? generateMelodicDictation(level, {}, seededRng(seed))
            : generateRhythmicDictation(level, {}, seededRng(seed))
          const full = toAnswer(item)
          fc.pre(full.length >= 2)
          const scaled = scaleAnswer(full, factor)

          const unscaledGrade = gradeDictation(item, full, { maxTempoScale: TEST_MAX_SCALE })
          const scaledGrade = gradeDictation(item, scaled, { maxTempoScale: TEST_MAX_SCALE })

          expect(unscaledGrade.correct).toBe(true) // sanity: the unscaled answer is the item's own notes
          expect(scaledGrade.correct).toBe(unscaledGrade.correct)
          expect(scaledGrade.pitchAccuracy).toBe(unscaledGrade.pitchAccuracy)
          expect(scaledGrade.rhythmAccuracy).toBe(unscaledGrade.rhythmAccuracy)
        },
      ),
    )
  })

  it('does not forgive a uniform scale factor outside the accepted bound', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (n) => {
        const item = buildEvenPhrase(n)
        const full = toAnswer(item)
        // Comfortably outside TEST_MAX_SCALE: even clamped to the bound's own edge, the
        // reconstructed onset for the last (largest-offset) note is still off by
        // (factor - TEST_MAX_SCALE) * lastOffset, which for the smallest phrase here (n=2,
        // lastOffset=480) is 2.4 * 480 = 1152 ticks — far past the default eighth-note tolerance.
        const factor = TEST_MAX_SCALE * 3
        const scaled = scaleAnswer(full, factor)

        const grade = gradeDictation(item, scaled, { maxTempoScale: TEST_MAX_SCALE })

        expect(grade.correct).toBe(false)
        expect(grade.rhythmAccuracy).toBeLessThan(1)
      }),
    )
  })

  // The exact defect this task measures: a phrase replayed 8% slower than written, graded with
  // the DEFAULT options (no maxTempoScale passed) — this is what a real dictation answer typed a
  // little under tempo looks like. Before this task, 416 of 900 such cases graded incorrect.
  it('a phrase replayed 8% slower than written grades correct under the default tolerance', () => {
    fc.assert(
      fc.property(seedArb, levelArb, fc.boolean(), (seed, level, melodic) => {
        const item = melodic
          ? generateMelodicDictation(level, {}, seededRng(seed))
          : generateRhythmicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 2)
        const slow = scaleAnswer(full, 1.08)

        const grade = gradeDictation(item, slow) // default options

        expect(grade.correct).toBe(true)
        expect(grade.rhythmAccuracy).toBe(1)
      }),
    )
  })

  it('maxTempoScale: 1 recovers the pre-3.23 behaviour exactly — the same 8% slower answer the default forgives now grades wrong', () => {
    const item = buildEvenPhrase(8)
    const full = toAnswer(item)
    const slow = scaleAnswer(full, 1.08)

    const withTolerance = gradeDictation(item, slow)
    expect(withTolerance.correct).toBe(true)

    // maxTempoScale: 1 is exactly gradeDictation(item, slow) with no tempo-scale fit at all — the
    // per-note classification (wrong-rhythm vs missing/extra, depending on how far the drift has
    // pushed a note past `alignDictation`'s own mutual-nearest gate) is that function's own
    // implementation detail, not something this test pins; only that the forgiveness is gone.
    const strict = gradeDictation(item, slow, { maxTempoScale: 1 })
    expect(strict.correct).toBe(false)
    expect(strict.notes.some((n) => n.status !== 'correct')).toBe(true)
  })

  // The regression this task exists to guard: an isolated, genuinely wrong onset (not a uniform
  // tempo difference at all — every other note in the phrase is exact) must not be smoothed away
  // by the tempo-scale fit. A `rhythmAccuracy` that always returns 1 would pass every test above
  // but fails this one.
  it('a genuinely wrong onset — not a uniform tempo difference — still grades wrong-rhythm regardless of the default tolerance', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (n) => {
        const item = buildEvenPhrase(n)
        const full = toAnswer(item)
        const lastIndex = full.length - 1
        const distorted = full.map((note, i) =>
          i === lastIndex ? { midi: note.midi, startTick: asTicks(note.startTick + 2000) } : note,
        )

        const grade = gradeDictation(item, distorted)

        expect(grade.correct).toBe(false)
        expect(grade.rhythmAccuracy).toBeLessThan(1)
        expect(grade.notes[lastIndex]?.status).not.toBe('correct')
      }),
    )
  })

  it('a tempo-scaled AND transposed answer keeps pitchAccuracy 0 while rhythmAccuracy stays 1 — the two axes stay independent under scaling too', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 2)
        const scaled = scaleAnswer(full, 1.1)
        const answer = scaled.map((n) => ({ midi: asMidi(n.midi + 1), startTick: n.startTick }))

        const grade = gradeDictation(item, answer)

        expect(grade.rhythmAccuracy).toBe(1)
        expect(grade.pitchAccuracy).toBe(0)
        expect(grade.correct).toBe(false)
      }),
    )
  })

  it('a mismatched note count (a missing note) never engages the tempo-scale fit — dropping one note behaves exactly as without it', () => {
    fc.assert(
      fc.property(seedArb, levelArb, (seed, level) => {
        const item = generateMelodicDictation(level, {}, seededRng(seed))
        const full = toAnswer(item)
        fc.pre(full.length >= 2)
        const dropped = full.slice(1) // drop the first note — an unequal count either way

        const withDefaultTolerance = gradeDictation(item, dropped)
        const withNoTolerance = gradeDictation(item, dropped, { maxTempoScale: 1 })

        expect(withDefaultTolerance).toEqual(withNoTolerance)
      }),
    )
  })
})
