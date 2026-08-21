import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { measuresInRange } from './measures.ts'
import { type Hand } from '@core/notation/score.ts'
import { measureRange } from '@core/notation/scoreQueries.ts'
import { C_MAJOR_SCALE_RH, PICKUP_MEASURE, TWO_HAND_CHORDS, buildTestScore } from '@test/fixtures.ts'
import { ticks, type Ticks } from '@core/shared/units.ts'

const T = (n: number): Ticks => ticks(n)

describe('measuresInRange', () => {
  it('is the inverse of measureRange for a single measure', () => {
    expect(measuresInRange(TWO_HAND_CHORDS, measureRange(TWO_HAND_CHORDS, 1, 1))).toEqual({
      startMeasure: 1,
      endMeasure: 1,
    })
  })

  it('spans multiple measures inclusively, mirroring measureRange', () => {
    expect(measuresInRange(TWO_HAND_CHORDS, measureRange(TWO_HAND_CHORDS, 1, 2))).toEqual({
      startMeasure: 1,
      endMeasure: 2,
    })
    expect(measuresInRange(PICKUP_MEASURE, measureRange(PICKUP_MEASURE, 0, 2))).toEqual({
      startMeasure: 0,
      endMeasure: 2,
    })
  })

  it('clamps a tick range that runs past either end of the score', () => {
    const last = TWO_HAND_CHORDS.measures.length - 1
    expect(measuresInRange(TWO_HAND_CHORDS, { startTick: T(-999), endTick: T(1) })).toEqual({
      startMeasure: 0,
      endMeasure: 0,
    })
    expect(measuresInRange(TWO_HAND_CHORDS, { startTick: T(0), endTick: T(999_999) })).toEqual({
      startMeasure: 0,
      endMeasure: last,
    })
  })

  it('collapses an empty or inverted range to a single measure', () => {
    expect(measuresInRange(C_MAJOR_SCALE_RH, { startTick: T(480), endTick: T(480) })).toEqual({
      startMeasure: 0,
      endMeasure: 0,
    })
    expect(measuresInRange(C_MAJOR_SCALE_RH, { startTick: T(1920), endTick: T(0) })).toEqual({
      startMeasure: 1,
      endMeasure: 1,
    })
  })

  it('reads the last tick as inclusive: a range ending exactly on a barline stops at the prior measure', () => {
    // measure 0 spans [0, 1920); a range ending at 1920 must NOT reach into measure 1.
    expect(measuresInRange(C_MAJOR_SCALE_RH, { startTick: T(0), endTick: T(1920) })).toEqual({
      startMeasure: 0,
      endMeasure: 0,
    })
  })
})

// ---------------------------------------------------------------- property tests

type NoteSpec = { bar: number; beat: number; midi: number; hand: Hand; beats: number }
const BAR = 1920

const noteSpecArb = fc.record<NoteSpec>({
  bar: fc.nat({ max: 5 }),
  beat: fc.nat({ max: 3 }),
  midi: fc.integer({ min: 40, max: 90 }),
  hand: fc.constantFrom<Hand>('left', 'right'),
  beats: fc.integer({ min: 1, max: 4 }),
})

const scoreArb = fc.array(noteSpecArb, { maxLength: 25 }).map((specs) =>
  buildTestScore(
    specs.map((s) => ({
      midi: s.midi,
      startTick: s.bar * BAR + s.beat * 480,
      durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
      hand: s.hand,
    })),
    { measureCount: Math.max(1, ...specs.map((s) => s.bar + 1)) },
  ),
)

describe('measuresInRange properties', () => {
  it('round-trips with measureRange for any valid 0 <= a <= b <= lastMeasure', () => {
    fc.assert(
      fc.property(scoreArb, fc.nat({ max: 200 }), fc.nat({ max: 200 }), (score, x, y) => {
        const last = score.measures.length - 1
        const a = Math.min(x, y, last)
        const b = Math.min(Math.max(x, y), last)
        const range = measureRange(score, a, b)
        expect(measuresInRange(score, range)).toEqual({ startMeasure: a, endMeasure: b })
      }),
    )
  })

  it('always returns indices clamped inside the score, in order', () => {
    fc.assert(
      fc.property(
        scoreArb,
        fc.integer({ min: -5000, max: 20_000 }),
        fc.integer({ min: -5000, max: 20_000 }),
        (score, x, y) => {
          const last = score.measures.length - 1
          const { startMeasure, endMeasure } = measuresInRange(score, {
            startTick: T(Math.min(x, y)),
            endTick: T(Math.max(x, y)),
          })
          expect(startMeasure).toBeGreaterThanOrEqual(0)
          expect(endMeasure).toBeGreaterThanOrEqual(0)
          expect(startMeasure).toBeLessThanOrEqual(last)
          expect(endMeasure).toBeLessThanOrEqual(last)
          expect(startMeasure).toBeLessThanOrEqual(endMeasure)
        },
      ),
    )
  })
})
