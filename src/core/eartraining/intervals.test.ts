import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { EarItem } from '@core/eartraining/item.ts'
import {
  generateIntervalItem,
  gradeIntervalAnswer,
  type IntervalItemOptions,
  intervalsForLevel,
} from './intervals.ts'
import { makeScore } from '@core/notation/score.ts'
import { seededRng } from '@core/ports/rng.ts'
import {
  type Interval,
  intervalFromSemitones,
  intervalName,
  makeInterval,
  parseInterval,
} from '@core/theory/intervals.ts'
import { unwrap } from '@core/shared/result.ts'
import { HALF, midi, QUARTER } from '@core/shared/units.ts'

const iv = (n: number, q: Parameters<typeof makeInterval>[1]): Interval => unwrap(makeInterval(n, q))

/** A dummy but valid EarItem carrying the given answerKey — grading never reads `prompt`. */
function itemWithAnswer(answerKey: string): EarItem {
  return {
    id: 'test-item',
    kind: 'interval-harmonic',
    prompt: makeScore({
      id: 'test-score',
      measures: [{}],
      notes: [
        { midi: 60, startTick: 0, durationTicks: HALF, hand: 'right' },
        { midi: 64, startTick: 0, durationTicks: HALF, hand: 'right' },
      ],
    }),
    answerKey,
    level: 1,
  }
}

const nameOf = (i: Interval): string => `${i.number}-${i.quality}`

// ---------------------------------------------------------------------------
// intervalsForLevel
// ---------------------------------------------------------------------------

describe('intervalsForLevel', () => {
  it('level 1 is exactly P5, P8, M3, m3', () => {
    expect(new Set(intervalsForLevel(1).map((i) => intervalName(i)))).toEqual(
      new Set(['P5', 'P8', 'M3', 'm3']),
    )
  })

  it('level 2 adds M2, m2, P4', () => {
    const names = new Set(intervalsForLevel(2).map((i) => intervalName(i)))
    expect(names).toEqual(new Set(['P5', 'P8', 'M3', 'm3', 'M2', 'm2', 'P4']))
  })

  it('level 3 adds M6, m6', () => {
    const names = new Set(intervalsForLevel(3).map((i) => intervalName(i)))
    expect(names).toEqual(new Set(['P5', 'P8', 'M3', 'm3', 'M2', 'm2', 'P4', 'M6', 'm6']))
  })

  it('level 4 adds M7, m7', () => {
    const names = new Set(intervalsForLevel(4).map((i) => intervalName(i)))
    expect(names).toEqual(
      new Set(['P5', 'P8', 'M3', 'm3', 'M2', 'm2', 'P4', 'M6', 'm6', 'M7', 'm7']),
    )
  })

  it('level 5 is exactly level 4 plus the tritone plus compounds of level 4, octave excluded', () => {
    const names = new Set(intervalsForLevel(5).map((i) => intervalName(i)))
    expect(names).toEqual(
      new Set([
        'P5', 'P8', 'M3', 'm3', 'M2', 'm2', 'P4', 'M6', 'm6', 'M7', 'm7',
        'A4',
        'M10', 'm10', 'M9', 'm9', 'P11', 'P12', 'M13', 'm13', 'M14', 'm14',
      ]),
    )
  })

  it('levels above 5 are the same as level 5 — there is nothing further to unlock', () => {
    const five = intervalsForLevel(5).map(nameOf)
    for (const level of [6, 7, 50]) {
      expect(intervalsForLevel(level).map(nameOf)).toEqual(five)
    }
  })

  it('rejects a level below 1', () => {
    expect(() => intervalsForLevel(0)).toThrow()
    expect(() => intervalsForLevel(-1)).toThrow()
  })

  it('is monotonic: a higher level never removes an interval a lower one had (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), fc.integer({ min: 1, max: 25 }), (a, b) => {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        const loNames = new Set(intervalsForLevel(lo).map(nameOf))
        const hiNames = new Set(intervalsForLevel(hi).map(nameOf))
        for (const name of loNames) expect(hiNames.has(name)).toBe(true)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// generateIntervalItem
// ---------------------------------------------------------------------------

const arbLevel = fc.integer({ min: 1, max: 5 })
const arbSeed = fc.integer({ min: 0, max: 2 ** 31 - 1 })

describe('generateIntervalItem', () => {
  it('produces a prompt with exactly two sounding pitches whose distance matches the answer key (property)', () => {
    fc.assert(
      fc.property(
        arbLevel,
        fc.boolean(),
        fc.boolean(),
        arbSeed,
        (level, harmonic, allowDescending, seed) => {
          const opts: IntervalItemOptions = { harmonic, allowDescending }
          const item = generateIntervalItem(level, opts, seededRng(seed))

          expect(item.prompt.notes.length).toBe(2)
          const [a, b] = item.prompt.notes
          expect(a).toBeDefined()
          expect(b).toBeDefined()
          if (a === undefined || b === undefined) return

          const semitoneDistance = Math.abs(a.midi - b.midi)
          const isDescending = item.answerKey.startsWith('-')
          const unsignedAnswer = isDescending ? item.answerKey.slice(1) : item.answerKey
          const expectedInterval = unwrap(parseInterval(unsignedAnswer))
          expect(semitoneDistance).toBe(expectedInterval.semitones)

          // level 1, harmonic items, or allowDescending: false, are always ascending
          if (level === 1 || harmonic || !allowDescending) {
            expect(isDescending).toBe(false)
          }

          // item grades itself correct when answered with its own interval and direction
          const direction = isDescending ? -1 : 1
          expect(gradeIntervalAnswer(item, expectedInterval, direction).correct).toBe(true)
          // the opposite direction claim is wrong even with the right semitone count
          expect(gradeIntervalAnswer(item, expectedInterval, direction === 1 ? -1 : 1).correct).toBe(
            false,
          )

          // aurally-equivalent respelling still grades correct; a different-sounding
          // interval (one semitone off) does not — exercises compound answer keys too
          const respelled = intervalFromSemitones(expectedInterval.semitones, 'diatonic')
          expect(gradeIntervalAnswer(item, respelled, direction).correct).toBe(true)
          const different = intervalFromSemitones(expectedInterval.semitones + 1)
          expect(gradeIntervalAnswer(item, different, direction).correct).toBe(false)
        },
      ),
    )
  })

  it('kind matches the harmonic option', () => {
    fc.assert(
      fc.property(arbLevel, fc.boolean(), arbSeed, (level, harmonic, seed) => {
        const item = generateIntervalItem(level, { harmonic }, seededRng(seed))
        expect(item.kind).toBe(harmonic ? 'interval-harmonic' : 'interval-melodic')
        expect(item.level).toBe(level)
      }),
    )
  })

  it('harmonic prompt: both notes at tick 0 for a half note', () => {
    const item = generateIntervalItem(1, { harmonic: true }, seededRng(7))
    for (const n of item.prompt.notes) {
      expect(n.startTick).toBe(0)
      expect(n.durationTicks).toBe(HALF)
    }
  })

  it('melodic prompt: one quarter each, in sequence', () => {
    const item = generateIntervalItem(1, { harmonic: false }, seededRng(7))
    const sorted = [...item.prompt.notes].sort((x, y) => x.startTick - y.startTick)
    expect(sorted.map((n) => n.startTick)).toEqual([0, QUARTER])
    for (const n of sorted) expect(n.durationTicks).toBe(QUARTER)
  })

  it('melodic notes play in the order implied by direction', () => {
    // Find one ascending and one descending draw at a level where both are possible.
    let sawAscending = false
    let sawDescending = false
    for (let seed = 0; seed < 200 && !(sawAscending && sawDescending); seed++) {
      const item = generateIntervalItem(2, { harmonic: false }, seededRng(seed))
      const sorted = [...item.prompt.notes].sort((x, y) => x.startTick - y.startTick)
      const first = sorted[0]
      const second = sorted[1]
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      if (first === undefined || second === undefined) continue
      if (item.answerKey.startsWith('-')) {
        sawDescending = true
        expect(first.midi).toBeGreaterThan(second.midi)
      } else {
        sawAscending = true
        expect(first.midi).toBeLessThan(second.midi)
      }
    }
    expect(sawAscending).toBe(true)
    expect(sawDescending).toBe(true)
  })

  it('puts both notes on one staff: treble if the lower note is >= middle C, else bass', () => {
    fc.assert(
      fc.property(arbLevel, fc.boolean(), arbSeed, (level, harmonic, seed) => {
        const item = generateIntervalItem(level, { harmonic }, seededRng(seed))
        expect(item.prompt.staves.length).toBe(1)
        const lowMidi = Math.min(...item.prompt.notes.map((n) => n.midi))
        const staff = item.prompt.staves[0]
        expect(staff).toBeDefined()
        if (staff === undefined) return
        expect(staff.clef).toBe(lowMidi >= 60 ? 'treble' : 'bass')
      }),
    )
  })

  it('is deterministic: the same Rng draw sequence produces the same item, id included', () => {
    fc.assert(
      fc.property(arbLevel, fc.boolean(), arbSeed, (level, harmonic, seed) => {
        const opts: IntervalItemOptions = { harmonic }
        const first = generateIntervalItem(level, opts, seededRng(seed))
        const second = generateIntervalItem(level, opts, seededRng(seed))
        expect(second).toEqual(first)
      }),
    )
  })

  it('no harmonic item, at any level or seed, has a descending answerKey', () => {
    for (let level = 1; level <= 6; level++) {
      for (let seed = 0; seed < 100; seed++) {
        const item = generateIntervalItem(
          level,
          { harmonic: true, allowDescending: true },
          seededRng(seed),
        )
        expect(item.answerKey.startsWith('-')).toBe(false)
        expect(item.id.endsWith(':asc')).toBe(true)
      }
    }
  })

  it('id pins an exact format encoding kind, pitches and direction', () => {
    const item = generateIntervalItem(
      1,
      { harmonic: true, range: { low: midi(60), high: midi(60) } },
      seededRng(0),
    )
    expect(item.id).toMatch(/^interval-harmonic:60:\d+:asc$/)
  })

  it('id (kind + pitches + direction) uniquely determines equality and vice versa (property)', () => {
    fc.assert(
      fc.property(arbLevel, fc.boolean(), fc.boolean(), arbSeed, arbSeed, (level, harmonic, allowDescending, seedA, seedB) => {
        const opts: IntervalItemOptions = { harmonic, allowDescending }
        const a = generateIntervalItem(level, opts, seededRng(seedA))
        const b = generateIntervalItem(level, opts, seededRng(seedB))
        const samePitchesAndKindAndDirection =
          a.kind === b.kind &&
          a.prompt.notes.map((n) => n.midi).sort().join(',') ===
            b.prompt.notes.map((n) => n.midi).sort().join(',') &&
          a.answerKey.startsWith('-') === b.answerKey.startsWith('-')
        expect(a.id === b.id).toBe(samePitchesAndKindAndDirection)
      }),
    )
  })

  it('honours a level-1 request to never descend, and an explicit allowDescending: false above it', () => {
    for (let seed = 0; seed < 50; seed++) {
      const level1 = generateIntervalItem(1, { harmonic: true, allowDescending: true }, seededRng(seed))
      expect(level1.answerKey.startsWith('-')).toBe(false)
      const forced = generateIntervalItem(
        3,
        { harmonic: true, allowDescending: false },
        seededRng(seed),
      )
      expect(forced.answerKey.startsWith('-')).toBe(false)
    }
  })

  it('respects a custom range for the lower note', () => {
    const range = { low: midi(60), high: midi(60) }
    for (let seed = 0; seed < 30; seed++) {
      const item = generateIntervalItem(1, { harmonic: true, range }, seededRng(seed))
      const lowMidi = Math.min(...item.prompt.notes.map((n) => n.midi))
      expect(lowMidi).toBe(60)
    }
  })
})

// ---------------------------------------------------------------------------
// gradeIntervalAnswer
// ---------------------------------------------------------------------------

describe('gradeIntervalAnswer', () => {
  it('the textbook example: an augmented second sounds like a minor third and grades correct', () => {
    const item = itemWithAnswer('m3')
    const asA2 = gradeIntervalAnswer(item, iv(2, 'augmented'))
    expect(asA2.correct).toBe(true)
    expect(asA2.expected).toBe('m3')
    expect(asA2.given).toBe('A2')
  })

  it('a different-sounding interval grades incorrect', () => {
    const item = itemWithAnswer('m3')
    const asM3 = gradeIntervalAnswer(item, iv(3, 'major'))
    expect(asM3.correct).toBe(false)
    expect(asM3.given).toBe('M3')
  })

  it('grades correct when answered with the exact same interval', () => {
    const item = itemWithAnswer('P5')
    expect(gradeIntervalAnswer(item, iv(5, 'perfect')).correct).toBe(true)
  })

  it('a descending item requires the answer to claim descending direction too', () => {
    const item = itemWithAnswer('-m3')
    // right semitones, but defaulted (ascending) direction: wrong
    expect(gradeIntervalAnswer(item, iv(3, 'minor')).correct).toBe(false)
    // right semitones and the matching descending direction: correct
    expect(gradeIntervalAnswer(item, iv(3, 'minor'), -1).correct).toBe(true)
    expect(gradeIntervalAnswer(item, iv(2, 'augmented'), -1).correct).toBe(true)
    expect(gradeIntervalAnswer(item, iv(3, 'major'), -1).correct).toBe(false)
  })

  it('an ascending item rejects a descending claim even with the right semitones', () => {
    const item = itemWithAnswer('m3')
    expect(gradeIntervalAnswer(item, iv(3, 'minor'), -1).correct).toBe(false)
    expect(gradeIntervalAnswer(item, iv(3, 'minor'), -1).given).toBe('-m3')
  })

  it('aurally-equivalent respellings grade correct across the drill vocabulary (property)', () => {
    // (primary spelling as it appears in the level vocabulary, an enharmonic respelling)
    const pairs: readonly [Interval, Interval][] = [
      [iv(2, 'minor'), iv(1, 'augmented')], // m2 == A1, 1 semitone
      [iv(2, 'major'), iv(3, 'diminished')], // M2 == d3, 2 semitones
      [iv(3, 'minor'), iv(2, 'augmented')], // m3 == A2, 3 semitones
      [iv(3, 'major'), iv(4, 'diminished')], // M3 == d4, 4 semitones
      [iv(4, 'perfect'), iv(3, 'augmented')], // P4 == A3, 5 semitones
      [iv(4, 'augmented'), iv(5, 'diminished')], // A4 == d5, 6 semitones (the tritone)
      [iv(5, 'perfect'), iv(6, 'diminished')], // P5 == d6, 7 semitones
      [iv(6, 'minor'), iv(5, 'augmented')], // m6 == A5, 8 semitones
      [iv(6, 'major'), iv(7, 'diminished')], // M6 == d7, 9 semitones
      [iv(7, 'minor'), iv(6, 'augmented')], // m7 == A6, 10 semitones
      [iv(7, 'major'), iv(8, 'diminished')], // M7 == d8, 11 semitones
      [iv(8, 'perfect'), iv(7, 'augmented')], // P8 == A7, 12 semitones
    ]
    for (const [primary, alt] of pairs) {
      expect(primary.semitones).toBe(alt.semitones)
      const item = itemWithAnswer(intervalName(primary))
      expect(gradeIntervalAnswer(item, primary).correct).toBe(true)
      expect(gradeIntervalAnswer(item, alt).correct).toBe(true)
      // one semitone off is a genuinely different sound, for every pair
      const off = intervalFromSemitones(primary.semitones + 1)
      expect(off.semitones).not.toBe(primary.semitones)
      expect(gradeIntervalAnswer(item, off).correct).toBe(false)
    }
  })
})
