/**
 * Tests for clickFilters (roadmap DR-12).
 *
 * The property tests build real click lists with `clicksForBars` — a fake
 * grid would risk asserting against a model of the metronome instead of the
 * metronome itself — and check the two invariants the module doc promises:
 * every filter returns a subsequence of its input, and the count-in is
 * never touched by a gap or mute mode.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clicksForBars, type Click, type MetronomeSettings, type Subdivision } from './metronome.ts'
import { isErr, ok } from '@core/shared/result.ts'
import { InvariantError } from '@core/shared/invariant.ts'
import { bpm } from '@core/shared/units.ts'
import { seededRng } from '@core/ports/rng.ts'
import { scriptedRng } from '@test/fakes.ts'
import {
  gapClicks,
  isSilentBar,
  placeClicks,
  randomMuteClicks,
  returnBars,
  returnDriftMs,
  validateGapClickSchedule,
  voiceClicks,
  type ClickPlacement,
  type GapClickSchedule,
} from './clickFilters.ts'

// -------------------------------------------------------------------- helpers

function makeSettings(subdivision: Subdivision, countInBars: number): MetronomeSettings {
  return {
    bpm: bpm(120),
    timeSignature: { beats: 4, beatType: 4 },
    subdivision,
    countInBars,
  }
}

const subdivisionArb = fc.constantFrom<Subdivision>(1, 2, 4)
const countInArb = fc.integer({ min: 0, max: 2 })
const barsArb = fc.integer({ min: 0, max: 4 })

/** A real settings + bar count + the click list `clicksForBars` produces for it. */
const clicksArb = fc
  .tuple(subdivisionArb, countInArb, barsArb)
  .map(([subdivision, countInBars, bars]) => {
    const settings = makeSettings(subdivision, countInBars)
    return { settings, bars, clicks: clicksForBars(settings, bars) }
  })

const scheduleArb: fc.Arbitrary<GapClickSchedule> = fc.record({
  onBars: fc.integer({ min: 1, max: 4 }),
  offBars: fc.integer({ min: 0, max: 4 }),
})

const placementArb: fc.Arbitrary<ClickPlacement> = fc.oneof(
  fc.constant<ClickPlacement>({ kind: 'all' }),
  fc.constant<ClickPlacement>({ kind: 'downbeat' }),
  fc
    .array(fc.integer({ min: 0, max: 3 }), { minLength: 0, maxLength: 4 })
    .map((beats): ClickPlacement => ({ kind: 'beats', beats })),
  fc.integer({ min: 1, max: 4 }).map((n): ClickPlacement => ({ kind: 'every-n-bars', n })),
)

/** `sub` is `full` with some elements dropped, everything else untouched. */
function isSubsequence(sub: readonly Click[], full: readonly Click[]): boolean {
  let i = 0
  for (const c of full) {
    if (i < sub.length && sub[i] === c) i++
  }
  return i === sub.length
}

// -------------------------------------------------------------- placeClicks

describe('placeClicks', () => {
  it('returns a subsequence of the input for every placement', () => {
    fc.assert(
      fc.property(clicksArb, placementArb, ({ clicks }, placement) => {
        expect(isSubsequence(placeClicks(clicks, placement), clicks)).toBe(true)
      }),
    )
  })

  it("'all' is identity", () => {
    fc.assert(
      fc.property(clicksArb, ({ clicks }) => {
        expect(placeClicks(clicks, { kind: 'all' })).toEqual(clicks)
      }),
    )
  })

  it("'downbeat' is exactly beat 0, subdivisionIndex 0", () => {
    fc.assert(
      fc.property(clicksArb, ({ clicks }) => {
        const result = placeClicks(clicks, { kind: 'downbeat' })
        expect(result).toEqual(clicks.filter((c) => c.beat === 0 && c.subdivisionIndex === 0))
      }),
    )
  })

  it("'beats' keeps only the on-beat click of the given beats", () => {
    const settings = makeSettings(2, 0)
    const clicks = clicksForBars(settings, 1)
    const result = placeClicks(clicks, { kind: 'beats', beats: [1, 3] })
    expect(result.map((c) => [c.beat, c.subdivisionIndex])).toEqual([
      [1, 0],
      [3, 0],
    ])
  })

  it("'every-n-bars' keeps the downbeat of every n-th bar", () => {
    const settings = makeSettings(1, 0)
    const clicks = clicksForBars(settings, 4)
    const result = placeClicks(clicks, { kind: 'every-n-bars', n: 2 })
    expect(result.map((c) => c.bar)).toEqual([0, 2])
  })

  it('rejects a negative beat index', () => {
    const clicks = clicksForBars(makeSettings(1, 0), 1)
    expect(() => placeClicks(clicks, { kind: 'beats', beats: [-1] })).toThrow(InvariantError)
  })

  it('rejects n < 1', () => {
    const clicks = clicksForBars(makeSettings(1, 0), 1)
    expect(() => placeClicks(clicks, { kind: 'every-n-bars', n: 0 })).toThrow(InvariantError)
  })
})

// ---------------------------------------------------------------- gapClicks

describe('gapClicks / isSilentBar / returnBars', () => {
  it('gapClicks returns a subsequence of the input', () => {
    fc.assert(
      fc.property(clicksArb, scheduleArb, ({ clicks }, schedule) => {
        expect(isSubsequence(gapClicks(clicks, schedule), clicks)).toBe(true)
      }),
    )
  })

  it('is periodic: bar b sounds iff bar b + cycle sounds', () => {
    fc.assert(
      fc.property(scheduleArb, fc.integer({ min: 0, max: 50 }), (schedule, bar) => {
        const cycle = schedule.onBars + schedule.offBars
        expect(isSilentBar(bar, schedule)).toBe(isSilentBar(bar + cycle, schedule))
      }),
    )
  })

  it('offBars 0 is identity', () => {
    fc.assert(
      fc.property(clicksArb, fc.integer({ min: 1, max: 5 }), ({ clicks }, onBars) => {
        expect(gapClicks(clicks, { onBars, offBars: 0 })).toEqual(clicks)
      }),
    )
  })

  it('never removes count-in clicks', () => {
    fc.assert(
      fc.property(clicksArb, scheduleArb, ({ clicks }, schedule) => {
        const countIn = clicks.filter((c) => c.bar < 0)
        const result = new Set(gapClicks(clicks, schedule))
        expect(countIn.every((c) => result.has(c))).toBe(true)
      }),
    )
  })

  it('isSilentBar: count-in bars are never silent', () => {
    fc.assert(
      fc.property(scheduleArb, fc.integer({ min: 1, max: 5 }), (schedule, negBar) => {
        expect(isSilentBar(-negBar, schedule)).toBe(false)
      }),
    )
  })

  it('example: onBars 2, offBars 1 silences bar 2 of a bar 0-2 cycle', () => {
    const schedule = { onBars: 2, offBars: 1 }
    expect(isSilentBar(0, schedule)).toBe(false)
    expect(isSilentBar(1, schedule)).toBe(false)
    expect(isSilentBar(2, schedule)).toBe(true)
    expect(isSilentBar(3, schedule)).toBe(false)
  })

  it('returnBars finds the first sounding bar after each silent stretch', () => {
    expect(returnBars(7, { onBars: 2, offBars: 1 })).toEqual([3, 6])
  })

  it('returnBars is empty when offBars is 0 (no gap)', () => {
    expect(returnBars(10, { onBars: 3, offBars: 0 })).toEqual([])
  })

  it('rejects an invalid schedule via invariant', () => {
    const clicks = clicksForBars(makeSettings(1, 0), 1)
    expect(() => gapClicks(clicks, { onBars: 0, offBars: 1 })).toThrow(InvariantError)
    expect(() => gapClicks(clicks, { onBars: 1, offBars: -1 })).toThrow(InvariantError)
  })
})

describe('validateGapClickSchedule', () => {
  it('accepts a valid schedule', () => {
    expect(validateGapClickSchedule({ onBars: 2, offBars: 1 })).toEqual(ok({ onBars: 2, offBars: 1 }))
  })

  it('rejects onBars < 1, non-integers, and negative offBars', () => {
    expect(isErr(validateGapClickSchedule({ onBars: 0, offBars: 1 }))).toBe(true)
    expect(isErr(validateGapClickSchedule({ onBars: 1.5, offBars: 0 }))).toBe(true)
    expect(isErr(validateGapClickSchedule({ onBars: 2, offBars: -1 }))).toBe(true)
  })
})

// ----------------------------------------------------------- randomMuteClicks

describe('randomMuteClicks', () => {
  it('returns a subsequence of the input', () => {
    fc.assert(
      fc.property(
        clicksArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer(),
        ({ clicks }, p, seed) => {
          expect(isSubsequence(randomMuteClicks(clicks, p, seededRng(seed)), clicks)).toBe(true)
        },
      ),
    )
  })

  it('p=0 is identity', () => {
    fc.assert(
      fc.property(clicksArb, fc.integer(), ({ clicks }, seed) => {
        expect(randomMuteClicks(clicks, 0, seededRng(seed))).toEqual(clicks)
      }),
    )
  })

  it('p=1 removes every bar >= 0 and keeps the count-in', () => {
    fc.assert(
      fc.property(clicksArb, fc.integer(), ({ clicks }, seed) => {
        const result = randomMuteClicks(clicks, 1, seededRng(seed))
        expect(result).toEqual(clicks.filter((c) => c.bar < 0))
      }),
    )
  })

  it('a scripted rng of [0.1, 0.9, 0.1] at p=0.5 mutes exactly bars 0 and 2', () => {
    const clicks = clicksForBars(makeSettings(1, 0), 3)
    const result = randomMuteClicks(clicks, 0.5, scriptedRng([0.1, 0.9, 0.1]))
    const remainingBars = new Set(result.map((c) => c.bar))
    expect(remainingBars.has(0)).toBe(false)
    expect(remainingBars.has(1)).toBe(true)
    expect(remainingBars.has(2)).toBe(false)
  })

  it('rejects a probability outside [0, 1]', () => {
    const clicks = clicksForBars(makeSettings(1, 0), 1)
    expect(() => randomMuteClicks(clicks, 1.5, seededRng(1))).toThrow(InvariantError)
    expect(() => randomMuteClicks(clicks, -0.1, seededRng(1))).toThrow(InvariantError)
  })
})

// ---------------------------------------------------------------- voiceClicks

describe('voiceClicks', () => {
  it('gains are within [0, 1] and the accented downbeat gets 1', () => {
    fc.assert(
      fc.property(
        clicksArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ clicks }, beat, subdivision) => {
          const result = voiceClicks(clicks, { beat, subdivision })
          for (const c of result) {
            expect(c.gain).toBeGreaterThanOrEqual(0)
            expect(c.gain).toBeLessThanOrEqual(1)
            if (c.accented) expect(c.gain).toBe(1)
          }
        },
      ),
    )
  })

  it('rejects an out-of-range volume', () => {
    const clicks = clicksForBars(makeSettings(1, 0), 1)
    expect(() => voiceClicks(clicks, { beat: 1.5, subdivision: 0.5 })).toThrow(InvariantError)
    expect(() => voiceClicks(clicks, { beat: 0.5, subdivision: -0.1 })).toThrow(InvariantError)
  })
})

// -------------------------------------------------------------- returnDriftMs

describe('returnDriftMs', () => {
  it('shifting the (single) hit by +d shifts a defined result by +d', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (downbeat, hit, window, d) => {
          const base = returnDriftMs(downbeat, [hit], window)
          const shifted = returnDriftMs(downbeat, [hit + d], window)
          if (base !== undefined && shifted !== undefined) {
            expect(shifted).toBeCloseTo(base + d, 6)
          }
        },
      ),
    )
  })

  it('returns undefined when nothing is within the window', () => {
    expect(returnDriftMs(1000, [1200, 1500], 100)).toBeUndefined()
  })

  it('the nearest hit wins', () => {
    expect(returnDriftMs(1000, [1050, 970, 1200], 100)).toBe(-30)
  })

  it('rejects a negative window', () => {
    expect(() => returnDriftMs(0, [0], -1)).toThrow(InvariantError)
  })
})
