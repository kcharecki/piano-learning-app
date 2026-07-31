import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TempoMark } from '@core/notation/score.ts'
import { at, InvariantError } from '@core/shared/invariant.ts'
import {
  bpm as asBpm,
  millis as asMillis,
  ticks as asTicks,
  type Ticks,
} from '@core/shared/units.ts'
import {
  beatsToTicks,
  bpmAtTick,
  clampScale,
  DEFAULT_BPM,
  effectiveBpmAtTick,
  makeTempoMap,
  MAX_TEMPO_SCALE,
  MIN_TEMPO_SCALE,
  msToTick,
  tickDurationMs,
  ticksToBeats,
  tickToMs,
  withScale,
  type TempoMap,
} from './tempo.ts'

// -------------------------------------------------------------------- helpers

const mark = (tick: number, bpm: number): TempoMark => ({ tick: asTicks(tick), bpm: asBpm(bpm) })

/** Relative-tolerance comparison — absolute epsilons are meaningless at 10^5 ms. */
const nearly = (actual: number, expected: number, tolerance = 1e-9): void => {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected))
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * scale)
}

/** Naive O(n) oracle for the binary search: the last mark at or before `tick`. */
const scanForMark = (map: TempoMap, tick: number): TempoMark => {
  let found = at(map.marks, 0)
  for (const m of map.marks) if (m.tick <= tick) found = m
  return found
}

const QUARTER_TICKS = 480
const WHOLE_TICKS = 1920

// --------------------------------------------------------------- makeTempoMap

describe('makeTempoMap', () => {
  it('defaults to a single 120 bpm mark at tick 0 when there are no marks', () => {
    const map = makeTempoMap([])
    expect(map.marks).toEqual([{ tick: 0, bpm: DEFAULT_BPM }])
    expect(map.scale).toBe(1)
  })

  it('keeps a well-formed list untouched', () => {
    const map = makeTempoMap([mark(0, 120), mark(1920, 60)])
    expect(map.marks).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 1920, bpm: 60 },
    ])
  })

  it('sorts marks that arrive out of order', () => {
    const map = makeTempoMap([mark(1920, 60), mark(960, 90), mark(0, 120)])
    expect(map.marks.map((m) => m.tick)).toEqual([0, 960, 1920])
    expect(map.marks.map((m) => m.bpm)).toEqual([120, 90, 60])
  })

  it('prepends a 120 bpm mark when the first written tempo is later than tick 0', () => {
    const map = makeTempoMap([mark(1920, 60)])
    expect(map.marks).toEqual([
      { tick: 0, bpm: DEFAULT_BPM },
      { tick: 1920, bpm: 60 },
    ])
  })

  it('does not prepend a redundant default when the first written tempo is already 120', () => {
    const map = makeTempoMap([mark(1920, 120)])
    expect(map.marks).toEqual([{ tick: 0, bpm: DEFAULT_BPM }])
  })

  it('lets the later mark win when two marks share a tick', () => {
    const map = makeTempoMap([mark(0, 120), mark(960, 90), mark(960, 72)])
    expect(map.marks).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 960, bpm: 72 },
    ])
  })

  it('drops an equal-tick duplicate that leaves the tempo unchanged', () => {
    // 90 at 960 wins over 72, but 90 is what was already sounding, so nothing is kept.
    const map = makeTempoMap([mark(0, 90), mark(960, 72), mark(960, 90)])
    expect(map.marks).toEqual([{ tick: 0, bpm: 90 }])
  })

  it('drops marks that repeat the tempo already in force', () => {
    const map = makeTempoMap([mark(0, 120), mark(480, 120), mark(960, 60), mark(1440, 60)])
    expect(map.marks).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 960, bpm: 60 },
    ])
  })

  it('keeps a tempo that returns to an earlier value after a change', () => {
    const map = makeTempoMap([mark(0, 120), mark(480, 60), mark(960, 120)])
    expect(map.marks.map((m) => m.bpm)).toEqual([120, 60, 120])
  })

  it('accepts and clamps a scale argument', () => {
    expect(makeTempoMap([], 0.5).scale).toBe(0.5)
    expect(makeTempoMap([], 0.01).scale).toBe(MIN_TEMPO_SCALE)
    expect(makeTempoMap([], 99).scale).toBe(MAX_TEMPO_SCALE)
  })

  const malformed: readonly (readonly [string, TempoMark])[] = [
    ['a negative tick', mark(-1, 120)],
    ['a non-finite tick', mark(Number.POSITIVE_INFINITY, 120)],
    ['a NaN tick', mark(Number.NaN, 120)],
    ['zero bpm', mark(0, 0)],
    ['a negative bpm', mark(0, -60)],
    ['an infinite bpm', mark(0, Number.POSITIVE_INFINITY)],
    ['a NaN bpm', mark(0, Number.NaN)],
  ]
  for (const [label, bad] of malformed) {
    it(`throws on ${label}`, () => {
      expect(() => makeTempoMap([bad])).toThrow(InvariantError)
    })
  }

  it('rejects a malformed mark even when a valid one is present', () => {
    expect(() => makeTempoMap([mark(0, 120), mark(960, -1)])).toThrow(InvariantError)
  })

  it('does not alias the caller’s array', () => {
    const input = [mark(0, 120)]
    const map = makeTempoMap(input)
    expect(map.marks).not.toBe(input)
  })
})

// -------------------------------------------------------------------- tickToMs

describe('tickToMs', () => {
  const at120 = makeTempoMap([mark(0, 120)])
  const at60 = makeTempoMap([mark(0, 60)])

  it('puts tick 0 at 0 ms', () => {
    expect(tickToMs(at120, asTicks(0))).toBe(0)
  })

  // At ♩=120 a quarter note lasts 60/120 s = 500 ms, and a whole note 2000 ms.
  it('makes a quarter note 500 ms and a whole note 2000 ms at 120 bpm', () => {
    expect(tickToMs(at120, asTicks(QUARTER_TICKS))).toBe(500)
    expect(tickToMs(at120, asTicks(WHOLE_TICKS))).toBe(2000)
  })

  // At ♩=60 the quarter note is one second, by definition of bpm.
  it('makes a quarter note 1000 ms at 60 bpm', () => {
    expect(tickToMs(at60, asTicks(QUARTER_TICKS))).toBe(1000)
  })

  // Satie, Gymnopédie No. 1 — 3/4, "Lent" taken at ♩=60: one bar = 1440 ticks = 3 s.
  it('makes a 3/4 bar last 3 s at 60 bpm', () => {
    expect(tickToMs(at60, asTicks(1440))).toBe(3000)
  })

  // Bach, Invention No. 1 BWV 772 at ♩=72: an eighth note (240 ticks) is 240*125/72 ms.
  it('handles a tempo that does not divide evenly', () => {
    const at72 = makeTempoMap([mark(0, 72)])
    nearly(tickToMs(at72, asTicks(240)), 416.6666666666667)
  })

  it('is linear inside a segment, including fractional ticks', () => {
    expect(tickToMs(at120, asTicks(240))).toBe(250)
    expect(tickToMs(at120, asTicks(120.5))).toBeCloseTo(125.52083333, 6)
  })

  // A written tempo change: 120 until tick 1920, then 60. Tick 2400 is the first
  // bar (2000 ms) plus one quarter at 60 bpm (2 x 500 ms) = 3000 ms.
  it('is piecewise-linear across a tempo change', () => {
    const map = makeTempoMap([mark(0, 120), mark(1920, 60)])
    expect(tickToMs(map, asTicks(1920))).toBe(2000)
    expect(tickToMs(map, asTicks(2400))).toBe(3000)
    expect(tickToMs(map, asTicks(2160))).toBe(2500)
    expect(tickToMs(map, asTicks(3840))).toBe(6000)
  })

  it('accumulates across several tempo changes', () => {
    // 0: 120 bpm, 1920: 96 bpm, 3840: 80 bpm — a written molto ritardando.
    // bar 1 = 1920*125/120 = 2000 ms; bar 2 = 1920*125/96 = 2500; bar 3 = 3000.
    const map = makeTempoMap([mark(0, 120), mark(1920, 96), mark(3840, 80)])
    expect(tickToMs(map, asTicks(1920))).toBe(2000)
    expect(tickToMs(map, asTicks(2880))).toBe(3250)
    expect(tickToMs(map, asTicks(3840))).toBe(4500)
    expect(tickToMs(map, asTicks(5760))).toBe(7500)
  })

  it('extrapolates backwards at the first tempo for a count-in before tick 0', () => {
    const map = makeTempoMap([mark(0, 120), mark(1920, 60)])
    expect(tickToMs(map, asTicks(-1920))).toBe(-2000)
  })

  it('divides by the practice scale: half speed doubles every duration', () => {
    const half = withScale(at120, 0.5)
    expect(tickToMs(half, asTicks(QUARTER_TICKS))).toBe(1000)
    expect(tickToMs(half, asTicks(WHOLE_TICKS))).toBe(4000)
    const double = withScale(at120, 2)
    expect(tickToMs(double, asTicks(QUARTER_TICKS))).toBe(250)
  })

  it('throws when handed a map with no marks', () => {
    expect(() => tickToMs({ marks: [], scale: 1 }, asTicks(0))).toThrow(InvariantError)
  })
})

// -------------------------------------------------------------------- msToTick

describe('msToTick', () => {
  const at120 = makeTempoMap([mark(0, 120)])

  it('inverts tickToMs at a constant tempo', () => {
    expect(msToTick(at120, asMillis(500))).toBe(QUARTER_TICKS)
    expect(msToTick(at120, asMillis(2000))).toBe(WHOLE_TICKS)
    expect(msToTick(at120, asMillis(0))).toBe(0)
  })

  it('inverts tickToMs across a tempo change', () => {
    const map = makeTempoMap([mark(0, 120), mark(1920, 60)])
    expect(msToTick(map, asMillis(2000))).toBe(1920)
    expect(msToTick(map, asMillis(3000))).toBe(2400)
    expect(msToTick(map, asMillis(2500))).toBe(2160)
  })

  it('returns fractional ticks rather than rounding', () => {
    expect(msToTick(at120, asMillis(250.5))).toBeCloseTo(240.48, 6)
  })

  it('extrapolates backwards for negative milliseconds', () => {
    expect(msToTick(at120, asMillis(-500))).toBe(-QUARTER_TICKS)
  })

  it('accounts for the practice scale', () => {
    const half = withScale(at120, 0.5)
    // At half speed 1000 ms of wall clock is only one quarter note of music.
    expect(msToTick(half, asMillis(1000))).toBe(QUARTER_TICKS)
  })

  it('throws when handed a map with no marks', () => {
    expect(() => msToTick({ marks: [], scale: 1 }, asMillis(0))).toThrow(InvariantError)
  })
})

// ---------------------------------------------------------------- bpm queries

describe('bpmAtTick / effectiveBpmAtTick', () => {
  const map = makeTempoMap([mark(0, 120), mark(1920, 96), mark(3840, 80)])

  it('reports the written tempo in force, boundaries included', () => {
    expect(bpmAtTick(map, asTicks(0))).toBe(120)
    expect(bpmAtTick(map, asTicks(1919))).toBe(120)
    expect(bpmAtTick(map, asTicks(1920))).toBe(96)
    expect(bpmAtTick(map, asTicks(3839))).toBe(96)
    expect(bpmAtTick(map, asTicks(3840))).toBe(80)
    expect(bpmAtTick(map, asTicks(999_999))).toBe(80)
  })

  it('uses the first mark for ticks before the start', () => {
    expect(bpmAtTick(map, asTicks(-480))).toBe(120)
  })

  it('ignores the practice scale', () => {
    expect(bpmAtTick(withScale(map, 0.5), asTicks(0))).toBe(120)
  })

  it('applies the practice scale to the effective tempo', () => {
    expect(effectiveBpmAtTick(withScale(map, 0.5), asTicks(0))).toBe(60)
    expect(effectiveBpmAtTick(withScale(map, 2), asTicks(1920))).toBe(192)
    expect(effectiveBpmAtTick(map, asTicks(3840))).toBe(80)
  })

  it('throws when handed a map with no marks', () => {
    expect(() => bpmAtTick({ marks: [], scale: 1 }, asTicks(0))).toThrow(InvariantError)
  })
})

// --------------------------------------------------------------- withScale

describe('withScale', () => {
  const map = makeTempoMap([mark(0, 120), mark(1920, 60)])

  it('replaces the scale and keeps the marks by reference', () => {
    const scaled = withScale(map, 0.75)
    expect(scaled.scale).toBe(0.75)
    expect(scaled.marks).toBe(map.marks)
  })

  it('leaves the source map untouched', () => {
    withScale(map, 0.5)
    expect(map.scale).toBe(1)
  })

  it('clamps below 25% and above 200% (REQ-3.2.2)', () => {
    expect(withScale(map, 0.1).scale).toBe(MIN_TEMPO_SCALE)
    expect(withScale(map, 0).scale).toBe(MIN_TEMPO_SCALE)
    expect(withScale(map, -3).scale).toBe(MIN_TEMPO_SCALE)
    expect(withScale(map, 10).scale).toBe(MAX_TEMPO_SCALE)
    expect(withScale(map, MIN_TEMPO_SCALE).scale).toBe(MIN_TEMPO_SCALE)
    expect(withScale(map, MAX_TEMPO_SCALE).scale).toBe(MAX_TEMPO_SCALE)
  })

  it('throws on a non-finite scale', () => {
    expect(() => withScale(map, Number.NaN)).toThrow(InvariantError)
    expect(() => withScale(map, Number.POSITIVE_INFINITY)).toThrow(InvariantError)
  })
})

describe('clampScale', () => {
  it('passes through anything inside the supported range', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale(0.3)).toBe(0.3)
  })

  it('clamps to the documented bounds', () => {
    expect(clampScale(0.24)).toBe(MIN_TEMPO_SCALE)
    expect(clampScale(2.01)).toBe(MAX_TEMPO_SCALE)
  })

  it('rejects NaN rather than clamping it', () => {
    expect(() => clampScale(Number.NaN)).toThrow(InvariantError)
  })
})

// ------------------------------------------------------------ tickDurationMs

describe('tickDurationMs', () => {
  const at120 = makeTempoMap([mark(0, 120)])
  const changing = makeTempoMap([mark(0, 120), mark(1920, 60)])

  it('measures a span at a constant tempo', () => {
    expect(tickDurationMs(at120, asTicks(0), asTicks(QUARTER_TICKS))).toBe(500)
    expect(tickDurationMs(at120, asTicks(480), asTicks(960))).toBe(500)
  })

  it('is zero for an empty span', () => {
    expect(tickDurationMs(at120, asTicks(960), asTicks(960))).toBe(0)
  })

  it('is negative for a backwards span', () => {
    expect(tickDurationMs(at120, asTicks(960), asTicks(480))).toBe(-500)
  })

  it('includes tempo changes inside the span', () => {
    // 1440..2400 spans the change: 480 ticks at 120 (500 ms) + 480 at 60 (1000 ms).
    expect(tickDurationMs(changing, asTicks(1440), asTicks(2400))).toBe(1500)
  })

  it('follows the practice scale', () => {
    expect(tickDurationMs(withScale(changing, 0.5), asTicks(1440), asTicks(2400))).toBe(3000)
  })

  it('throws when handed a map with no marks', () => {
    expect(() => tickDurationMs({ marks: [], scale: 1 }, asTicks(0), asTicks(1))).toThrow(
      InvariantError,
    )
  })
})

// -------------------------------------------------------------- beat helpers

describe('beatsToTicks / ticksToBeats', () => {
  it('converts whole beats', () => {
    expect(beatsToTicks(1)).toBe(480)
    expect(beatsToTicks(4)).toBe(1920)
    expect(beatsToTicks(0)).toBe(0)
    expect(ticksToBeats(asTicks(480))).toBe(1)
    expect(ticksToBeats(asTicks(1920))).toBe(4)
  })

  it('converts fractional and negative beats without rounding', () => {
    expect(beatsToTicks(1.5)).toBe(720)
    expect(beatsToTicks(1 / 3)).toBeCloseTo(160, 10)
    expect(beatsToTicks(-2)).toBe(-960)
    expect(ticksToBeats(asTicks(720))).toBe(1.5)
    expect(ticksToBeats(asTicks(240))).toBe(0.5)
  })

  it('throws on non-finite input', () => {
    expect(() => beatsToTicks(Number.NaN)).toThrow(InvariantError)
    expect(() => beatsToTicks(Number.POSITIVE_INFINITY)).toThrow(InvariantError)
    expect(() => ticksToBeats(asTicks(Number.NaN))).toThrow(InvariantError)
  })

  it('agrees with tickToMs: one beat at 120 bpm is 500 ms', () => {
    const map = makeTempoMap([mark(0, 120)])
    expect(tickToMs(map, beatsToTicks(1))).toBe(500)
  })
})

// ----------------------------------------------------------- property tests

const arbRawMarks = fc.array(
  fc.record({ tick: fc.integer({ min: 0, max: 20_000 }), bpm: fc.integer({ min: 20, max: 300 }) }),
  { maxLength: 6 },
)
// Integer percentages keep the generator exact — no float scale to reason about.
const arbScale = fc.integer({ min: 25, max: 200 }).map((n) => n / 100)
const arbMap = fc.tuple(arbRawMarks, arbScale).map(([raw, scale]) =>
  makeTempoMap(
    raw.map((m) => mark(m.tick, m.bpm)),
    scale,
  ),
)
const arbTick = fc.integer({ min: -2_000, max: 30_000 }).map((n): Ticks => asTicks(n))

describe('properties', () => {
  it('makeTempoMap always yields a normalised map', () => {
    fc.assert(
      fc.property(arbMap, (map) => {
        expect(map.marks.length).toBeGreaterThan(0)
        expect(at(map.marks, 0).tick).toBe(0)
        for (let i = 1; i < map.marks.length; i++) {
          const previous = at(map.marks, i - 1)
          const current = at(map.marks, i)
          expect(current.tick).toBeGreaterThan(previous.tick)
          expect(current.bpm).not.toBe(previous.bpm)
        }
        expect(map.scale).toBeGreaterThanOrEqual(MIN_TEMPO_SCALE)
        expect(map.scale).toBeLessThanOrEqual(MAX_TEMPO_SCALE)
      }),
    )
  })

  it('makeTempoMap is idempotent', () => {
    fc.assert(
      fc.property(arbMap, (map) => {
        expect(makeTempoMap(map.marks, map.scale)).toEqual(map)
      }),
    )
  })

  it('msToTick(tickToMs(t)) === t — the round-trip is the whole point', () => {
    fc.assert(
      fc.property(arbMap, arbTick, (map, tick) => {
        const back = msToTick(map, tickToMs(map, tick))
        expect(Math.abs(back - tick)).toBeLessThan(1e-6)
      }),
    )
  })

  it('tickToMs(msToTick(ms)) === ms', () => {
    fc.assert(
      fc.property(arbMap, fc.integer({ min: -5_000, max: 500_000 }), (map, msValue) => {
        const back = tickToMs(map, msToTick(map, asMillis(msValue)))
        nearly(back, msValue)
      }),
    )
  })

  it('tickToMs is strictly monotonic', () => {
    fc.assert(
      fc.property(arbMap, arbTick, arbTick, (map, a, b) => {
        fc.pre(a !== b)
        const [lo, hi] = a < b ? [a, b] : [b, a]
        expect(tickToMs(map, lo)).toBeLessThan(tickToMs(map, hi))
      }),
    )
  })

  it('msToTick is strictly monotonic', () => {
    fc.assert(
      fc.property(
        arbMap,
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (map, a, b) => {
          fc.pre(a !== b)
          const [lo, hi] = a < b ? [a, b] : [b, a]
          expect(msToTick(map, asMillis(lo))).toBeLessThan(msToTick(map, asMillis(hi)))
        },
      ),
    )
  })

  it('tickDurationMs is additive across any split point', () => {
    fc.assert(
      fc.property(arbMap, arbTick, arbTick, arbTick, (map, a, b, c) => {
        const first = tickDurationMs(map, a, b)
        const second = tickDurationMs(map, b, c)
        const whole = tickDurationMs(map, a, c)
        // The two halves can be huge and nearly cancel, so the tolerance is
        // relative to the terms rather than to the (possibly zero) result.
        const magnitude = Math.max(1, Math.abs(first), Math.abs(second))
        expect(Math.abs(first + second - whole)).toBeLessThanOrEqual(1e-9 * magnitude)
      }),
    )
  })

  it('tickDurationMs agrees with the difference of tickToMs', () => {
    fc.assert(
      fc.property(arbMap, arbTick, arbTick, (map, a, b) => {
        const from = tickToMs(map, a)
        const to = tickToMs(map, b)
        const magnitude = Math.max(1, Math.abs(from), Math.abs(to))
        expect(Math.abs(tickDurationMs(map, a, b) - (to - from))).toBeLessThanOrEqual(
          1e-9 * magnitude,
        )
      }),
    )
  })

  it('scaling by s then by 1/s is the identity on durations', () => {
    fc.assert(
      fc.property(arbMap, fc.integer({ min: 50, max: 200 }), arbTick, (map, percent, tick) => {
        const s = percent / 100
        const unscaled = tickToMs(withScale(map, 1), tick)
        // Slowing to s multiplies every duration by 1/s; speeding back up by 1/s
        // multiplies by s again, landing exactly where it started.
        const slowed = tickToMs(withScale(map, s), tick)
        const restored = tickToMs(withScale(map, 1 / s), tick)
        nearly(slowed * s, unscaled)
        nearly(restored / s, unscaled)
      }),
    )
  })

  it('scale is a pure multiplier on ms, and never touches the written tempo', () => {
    fc.assert(
      fc.property(arbMap, arbScale, arbTick, (map, scale, tick) => {
        const scaled = withScale(map, scale)
        nearly(tickToMs(scaled, tick) * scale, tickToMs(withScale(map, 1), tick))
        expect(bpmAtTick(scaled, tick)).toBe(bpmAtTick(map, tick))
        nearly(effectiveBpmAtTick(scaled, tick), bpmAtTick(map, tick) * scale)
      }),
    )
  })

  it('withScale is a setter: the last call wins', () => {
    fc.assert(
      fc.property(arbMap, arbScale, arbScale, (map, a, b) => {
        expect(withScale(withScale(map, a), b)).toEqual(withScale(map, b))
      }),
    )
  })

  it('bpmAtTick matches a linear scan of the marks', () => {
    fc.assert(
      fc.property(arbMap, arbTick, (map, tick) => {
        expect(bpmAtTick(map, tick)).toBe(scanForMark(map, tick).bpm)
      }),
    )
  })

  it('a beat that spans no tempo change lasts exactly one beat at that tempo', () => {
    fc.assert(
      fc.property(arbMap, fc.nat(), (map, index) => {
        const i = index % map.marks.length
        const m = at(map.marks, i)
        expect(bpmAtTick(map, m.tick)).toBe(m.bpm)
        const oneBeatOn = asTicks(m.tick + beatsToTicks(1))
        const next = map.marks[i + 1]
        fc.pre(next === undefined || next.tick >= oneBeatOn)
        nearly(tickDurationMs(map, m.tick, oneBeatOn), 60_000 / (m.bpm * map.scale))
      }),
    )
  })

  it('beatsToTicks and ticksToBeats are inverses', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000, max: 1_000 }), (quarters) => {
        // quarters/4 covers whole, half, quarter and dotted values exactly.
        const beats = quarters / 4
        expect(ticksToBeats(beatsToTicks(beats))).toBe(beats)
      }),
    )
    fc.assert(
      fc.property(arbTick, (tick) => {
        nearly(beatsToTicks(ticksToBeats(tick)), tick)
      }),
    )
  })
})
