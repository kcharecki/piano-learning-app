import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TEMPO_CHANGE } from '@core/notation/fixtures.ts'
import type { TimeSignature } from '@core/notation/score.ts'
import { at, InvariantError } from '@core/shared/invariant.ts'
import { bpm as asBpm, ticks as asTicks, type Bpm } from '@core/shared/units.ts'
import { FakeClock } from '@test/fakes.ts'
import {
  advanceRamp,
  beatTicks,
  clicksForBars,
  clicksInRange,
  defaultAccents,
  MAX_BPM,
  MAX_CLICK_GAP_MS,
  MAX_CLICKS,
  MIN_BPM,
  MIN_CLICK_GAP_MS,
  startRamp,
  SUBDIVISIONS,
  validateMetronomeSettings,
  type Click,
  type MetronomeSettings,
  type RampSettings,
  type RampState,
  type Subdivision,
} from './metronome.ts'
import { makeTempoMap, tickToMs, type TempoMap } from './tempo.ts'
import { Transport } from './transport.ts'

// -------------------------------------------------------------------- helpers

const sig = (beats: number, beatType: number): TimeSignature => ({ beats, beatType })

const settings = (over: Partial<MetronomeSettings> = {}): MetronomeSettings => ({
  bpm: asBpm(120),
  timeSignature: sig(4, 4),
  subdivision: 1,
  ...over,
})

const range = (s: MetronomeSettings, from: number, to: number): readonly Click[] =>
  clicksInRange(s, asTicks(from), asTicks(to))

/** Relative-tolerance comparison — absolute epsilons are meaningless at 10^5 ms. */
const nearly = (actual: number, expected: number, tolerance = 1e-9): void => {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected))
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * scale)
}

/** The 0-based beats an accent falls on — how a musician says "1, 4 and 6". */
const accentIndices = (accents: readonly boolean[]): number[] =>
  accents.flatMap((a, i) => (a ? [i] : []))

const ticksOf = (clicks: readonly Click[]): number[] => clicks.map((c) => c.tick)
const msOf = (clicks: readonly Click[]): number[] => clicks.map((c) => c.ms)
const accentsOf = (clicks: readonly Click[]): boolean[] => clicks.map((c) => c.accented)

// ------------------------------------------------------------------ beatTicks

describe('beatTicks', () => {
  it('gives the quarter note in simple metres with a quarter-note beat', () => {
    expect(beatTicks(sig(4, 4))).toBe(480)
    expect(beatTicks(sig(3, 4))).toBe(480)
    expect(beatTicks(sig(2, 4))).toBe(480)
    expect(beatTicks(sig(5, 4))).toBe(480)
  })

  it('follows the beat type: 2/2 clicks half notes, 4/1 whole notes', () => {
    expect(beatTicks(sig(2, 2))).toBe(960)
    expect(beatTicks(sig(4, 1))).toBe(1920)
  })

  it('clicks the eighth in compound metres — 6/8 -> 240, six clicks to the bar', () => {
    expect(beatTicks(sig(6, 8))).toBe(240)
    expect(beatTicks(sig(9, 8))).toBe(240)
    expect(beatTicks(sig(12, 8))).toBe(240)
  })

  it('clicks the eighth in 7/8 too, which is additive rather than compound', () => {
    expect(beatTicks(sig(7, 8))).toBe(240)
    expect(beatTicks(sig(5, 8))).toBe(240)
  })

  it('handles sixteenth-based metres', () => {
    expect(beatTicks(sig(6, 16))).toBe(120)
  })

  it('throws on a beat count that is not a positive integer', () => {
    expect(() => beatTicks(sig(0, 4))).toThrow(InvariantError)
    expect(() => beatTicks(sig(-3, 4))).toThrow(InvariantError)
    expect(() => beatTicks(sig(2.5, 4))).toThrow(InvariantError)
  })

  it('throws on a beat type that is not a positive integer', () => {
    expect(() => beatTicks(sig(4, 0))).toThrow(InvariantError)
    expect(() => beatTicks(sig(4, -4))).toThrow(InvariantError)
    expect(() => beatTicks(sig(4, 4.5))).toThrow(InvariantError)
  })

  it('throws on a beat unit that is not tick-exact (1920 % beatType !== 0)', () => {
    // 1920 = 2^7 * 3 * 5, so 7 and 256 are not divisors (64 and 5 are).
    expect(() => beatTicks(sig(4, 7))).toThrow(/not tick-exact/)
    expect(() => beatTicks(sig(4, 256))).toThrow(/not tick-exact/)
    expect(beatTicks(sig(4, 64))).toBe(30)
  })
})

// -------------------------------------------------------------- defaultAccents

describe('defaultAccents', () => {
  it('accents beat 1 only in simple metres', () => {
    expect(defaultAccents(sig(4, 4))).toEqual([true, false, false, false])
    expect(defaultAccents(sig(3, 4))).toEqual([true, false, false])
    expect(defaultAccents(sig(2, 4))).toEqual([true, false])
    expect(defaultAccents(sig(1, 4))).toEqual([true])
  })

  it('groups irregular metres additively — 5 as 3+2, 7 as 3+2+2', () => {
    // Seven undifferentiated eighths is not a usable 7/8 metronome: the whole
    // point of the metre is where the groups fall.
    expect(accentIndices(defaultAccents(sig(5, 4)))).toEqual([0, 3])
    expect(accentIndices(defaultAccents(sig(5, 8)))).toEqual([0, 3])
    expect(accentIndices(defaultAccents(sig(7, 8)))).toEqual([0, 3, 5])
    expect(accentIndices(defaultAccents(sig(7, 4)))).toEqual([0, 3, 5])
    expect(defaultAccents(sig(7, 8))).toEqual([true, false, false, true, false, true, false])
  })

  it('leaves the additive grouping alone when the beat is a half or a whole note', () => {
    // 5/2 is five very long beats, not 3+2 of anything felt as a group.
    expect(accentIndices(defaultAccents(sig(5, 2)))).toEqual([0])
    expect(accentIndices(defaultAccents(sig(7, 1)))).toEqual([0])
  })

  it('groups compound metres in threes — 6/8 accents beats 1 and 4', () => {
    expect(defaultAccents(sig(6, 8))).toEqual([true, false, false, true, false, false])
    // 9/8 is compound triple: three groups of three.
    expect(defaultAccents(sig(9, 8))).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ])
    // 12/8 is compound quadruple: accents on 1, 4, 7, 10.
    const twelveEight = defaultAccents(sig(12, 8))
    expect(twelveEight).toHaveLength(12)
    expect(twelveEight.flatMap((a, i) => (a ? [i] : []))).toEqual([0, 3, 6, 9])
  })

  it('treats 6/4 as compound — three quarters is a dotted half, a real beat', () => {
    expect(defaultAccents(sig(6, 4))).toEqual([true, false, false, true, false, false])
    expect(defaultAccents(sig(6, 16))).toEqual([true, false, false, true, false, false])
  })

  it('does NOT treat 6/2 or 6/1 as compound — three whole notes is not a beat', () => {
    expect(defaultAccents(sig(6, 2))).toEqual([true, false, false, false, false, false])
    expect(defaultAccents(sig(6, 1))).toEqual([true, false, false, false, false, false])
    expect(defaultAccents(sig(12, 2))).toEqual(Array.from({ length: 12 }, (_, i) => i === 0))
  })

  it('leaves 3/8 as one group of three, i.e. the same as 3/4', () => {
    expect(defaultAccents(sig(3, 8))).toEqual([true, false, false])
  })

  it('throws on an invalid time signature', () => {
    expect(() => defaultAccents(sig(0, 4))).toThrow(InvariantError)
    expect(() => defaultAccents(sig(4, 7))).toThrow(InvariantError)
  })
})

// ---------------------------------------------------------------- accent oracle

/**
 * Real metres and the accents a musician expects in them, written out by hand.
 * This is the oracle for the grouping rules: it is what stops the accent tests
 * from simply restating whatever `isCompound` happens to say.
 */
const ACCENT_ORACLE: readonly { ts: TimeSignature; accents: readonly number[]; why: string }[] = [
  { ts: sig(4, 4), accents: [0], why: 'simple quadruple' },
  { ts: sig(3, 4), accents: [0], why: 'simple triple — one group of three' },
  { ts: sig(2, 2), accents: [0], why: 'cut common' },
  { ts: sig(5, 4), accents: [0, 3], why: 'additive 3+2' },
  { ts: sig(7, 8), accents: [0, 3, 5], why: 'additive 3+2+2' },
  { ts: sig(6, 8), accents: [0, 3], why: 'compound duple' },
  { ts: sig(9, 8), accents: [0, 3, 6], why: 'compound triple' },
  { ts: sig(12, 8), accents: [0, 3, 6, 9], why: 'compound quadruple' },
  { ts: sig(6, 16), accents: [0, 3], why: 'compound duple, sixteenth beat' },
  { ts: sig(6, 4), accents: [0, 3], why: 'compound duple — three quarters is a dotted half' },
  {
    ts: sig(6, 2),
    accents: [0],
    why: 'six half notes — not compound, a group of three is not a beat',
  },
]

describe('accent oracle', () => {
  for (const { ts, accents, why } of ACCENT_ORACLE) {
    it(`${ts.beats}/${ts.beatType} accents beats ${accents.map((a) => a + 1).join(', ')} (${why})`, () => {
      const pattern = defaultAccents(ts)
      expect(pattern).toHaveLength(ts.beats)
      expect(accentIndices(pattern)).toEqual(accents)
    })
  }
})

// --------------------------------------------------------------- clicksInRange

describe('clicksInRange', () => {
  it('4/4 at 120 bpm clicks at 0, 500, 1000, 1500 ms with the first accented', () => {
    const clicks = range(settings(), 0, 1920)
    expect(ticksOf(clicks)).toEqual([0, 480, 960, 1440])
    expect(msOf(clicks)).toEqual([0, 500, 1000, 1500])
    expect(accentsOf(clicks)).toEqual([true, false, false, false])
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3])
    expect(clicks.map((c) => c.subdivisionIndex)).toEqual([0, 0, 0, 0])
    expect(clicks.map((c) => c.bar)).toEqual([0, 0, 0, 0])
  })

  it('subdivision 2 doubles the count and never accents an off-beat', () => {
    const clicks = range(settings({ subdivision: 2 }), 0, 1920)
    expect(clicks).toHaveLength(8)
    expect(ticksOf(clicks)).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680])
    expect(msOf(clicks)).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750])
    expect(accentsOf(clicks)).toEqual([true, false, false, false, false, false, false, false])
    expect(clicks.map((c) => c.subdivisionIndex)).toEqual([0, 1, 0, 1, 0, 1, 0, 1])
    expect(clicks.map((c) => c.beat)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    for (const c of clicks) if (c.subdivisionIndex !== 0) expect(c.accented).toBe(false)
  })

  it('subdivision 3 gives triplets, subdivision 4 sixteenths', () => {
    expect(ticksOf(range(settings({ subdivision: 3 }), 0, 480))).toEqual([0, 160, 320])
    expect(ticksOf(range(settings({ subdivision: 4 }), 0, 480))).toEqual([0, 120, 240, 360])
    expect(range(settings({ subdivision: 6 }), 0, 1920)).toHaveLength(24)
    expect(range(settings({ subdivision: 8 }), 0, 1920)).toHaveLength(32)
  })

  it('6/8 accents beats 1 and 4 (index 0 and 3)', () => {
    const clicks = range(settings({ timeSignature: sig(6, 8) }), 0, 1440)
    expect(ticksOf(clicks)).toEqual([0, 240, 480, 720, 960, 1200])
    expect(accentsOf(clicks)).toEqual([true, false, false, true, false, false])
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('is exact at the boundaries: half-open [from, to)', () => {
    // The tick at `from` is included; the tick at `to` is not.
    expect(ticksOf(range(settings(), 480, 960))).toEqual([480])
    expect(ticksOf(range(settings(), 0, 1))).toEqual([0])
    expect(ticksOf(range(settings(), 0, 480))).toEqual([0])
    expect(range(settings(), 1, 480)).toHaveLength(0)
    expect(range(settings(), 479, 480)).toHaveLength(0)
    expect(ticksOf(range(settings(), 479, 481))).toEqual([480])
  })

  it('returns nothing for an empty or backwards range', () => {
    expect(range(settings(), 960, 960)).toHaveLength(0)
    expect(range(settings(), 1920, 0)).toHaveLength(0)
  })

  it('accepts a fractional start tick — the playhead lives between ticks', () => {
    expect(ticksOf(range(settings(), 0.5, 481))).toEqual([480])
    expect(ticksOf(range(settings(), -0.5, 1))).toEqual([0])
  })

  it('never emits a negative zero tick or bar, however the window is aligned', () => {
    // Math.ceil of a small negative is -0; a -0 tick is not Object.is-equal to 0
    // and would make identical clicks compare unequal.
    for (const from of [-0.5, -1, -0.0001, 0]) {
      const first = at(range(settings(), from, 1920), 0)
      expect(Object.is(first.tick, -0)).toBe(false)
      expect(Object.is(first.bar, -0)).toBe(false)
      expect(Object.is(first.ms, -0)).toBe(false)
    }
  })

  it('counts bars, resetting beat at every barline', () => {
    const clicks = range(settings(), 0, 3840)
    expect(clicks.map((c) => c.bar)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3, 0, 1, 2, 3])
    expect(accentsOf(clicks)).toEqual([true, false, false, false, true, false, false, false])
  })

  it('extends backwards into negative ticks, where the count-in lives', () => {
    const clicks = range(settings(), -1920, 0)
    expect(ticksOf(clicks)).toEqual([-1920, -1440, -960, -480])
    expect(msOf(clicks)).toEqual([-2000, -1500, -1000, -500])
    expect(clicks.map((c) => c.bar)).toEqual([-1, -1, -1, -1])
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3])
    expect(accentsOf(clicks)).toEqual([true, false, false, false])
  })

  it('honours a custom accent pattern, including one with no accents at all', () => {
    const backbeat = range(settings({ accents: [false, true, false, true] }), 0, 1920)
    expect(accentsOf(backbeat)).toEqual([false, true, false, true])
    const silent = range(settings({ accents: [false, false, false, false] }), 0, 1920)
    expect(accentsOf(silent)).toEqual([false, false, false, false])
  })

  it('scales with tempo — 60 bpm is a click per second', () => {
    expect(msOf(range(settings({ bpm: asBpm(60) }), 0, 1920))).toEqual([0, 1000, 2000, 3000])
  })

  it('throws when the accent pattern does not match the metre', () => {
    expect(() => range(settings({ accents: [true, false] }), 0, 1920)).toThrow(InvariantError)
    expect(() => range(settings({ accents: [] }), 0, 1920)).toThrow(
      /accent pattern has 0 entries but 4\/4 has 4 beats/,
    )
  })

  it('7/8 accents the heads of its 3+2+2 groups', () => {
    const clicks = range(settings({ timeSignature: sig(7, 8) }), 0, 1680)
    expect(ticksOf(clicks)).toEqual([0, 240, 480, 720, 960, 1200, 1440])
    expect(clicks.filter((c) => c.accented).map((c) => c.beat)).toEqual([0, 3, 5])
  })

  it('throws on a subdivision that is not tick-exact for the beat', () => {
    // A 1/32 beat is 60 ticks; splitting it 8 ways would need 7.5-tick clicks.
    expect(() => range(settings({ timeSignature: sig(4, 32), subdivision: 8 }), 0, 1920)).toThrow(
      /not tick-exact/,
    )
  })

  it('throws on a non-positive or non-integer subdivision', () => {
    expect(() => range(settings({ subdivision: 0 as Subdivision }), 0, 480)).toThrow(InvariantError)
    expect(() => range(settings({ subdivision: -2 as Subdivision }), 0, 480)).toThrow(
      InvariantError,
    )
    expect(() => range(settings({ subdivision: 1.5 as Subdivision }), 0, 480)).toThrow(
      InvariantError,
    )
  })

  it('throws on a non-positive or non-finite bpm', () => {
    expect(() => range(settings({ bpm: asBpm(0) }), 0, 480)).toThrow(InvariantError)
    expect(() => range(settings({ bpm: asBpm(-120) }), 0, 480)).toThrow(InvariantError)
    expect(() => range(settings({ bpm: asBpm(Number.NaN) }), 0, 480)).toThrow(InvariantError)
  })

  it('throws on a non-finite range', () => {
    expect(() => range(settings(), 0, Number.POSITIVE_INFINITY)).toThrow(InvariantError)
    expect(() => range(settings(), Number.NaN, 480)).toThrow(InvariantError)
  })
})

// -------------------------------------------------------------- clicksForBars

describe('clicksForBars', () => {
  it('returns every click of N bars', () => {
    const clicks = clicksForBars(settings(), 2)
    expect(ticksOf(clicks)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880, 3360])
    expect(clicks.map((c) => c.bar)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('returns nothing for zero bars without a count-in', () => {
    expect(clicksForBars(settings(), 0)).toHaveLength(0)
  })

  it('puts the count-in in front, at negative ticks and negative bars', () => {
    const clicks = clicksForBars(settings({ countInBars: 1 }), 1)
    expect(ticksOf(clicks)).toEqual([-1920, -1440, -960, -480, 0, 480, 960, 1440])
    expect(msOf(clicks)).toEqual([-2000, -1500, -1000, -500, 0, 500, 1000, 1500])
    expect(clicks.map((c) => c.bar)).toEqual([-1, -1, -1, -1, 0, 0, 0, 0])
    expect(accentsOf(clicks)).toEqual([true, false, false, false, true, false, false, false])
  })

  it('supports a count-in with no music after it (count me in, then I play alone)', () => {
    const clicks = clicksForBars(settings({ countInBars: 2 }), 0)
    expect(clicks).toHaveLength(8)
    expect(clicks.every((c) => c.tick < 0)).toBe(true)
    expect(clicks.map((c) => c.bar)).toEqual([-2, -2, -2, -2, -1, -1, -1, -1])
  })

  it('counts in with the metre it is about to play — 3/4 gives three, not four', () => {
    const clicks = clicksForBars(settings({ timeSignature: sig(3, 4), countInBars: 1 }), 0)
    expect(ticksOf(clicks)).toEqual([-1440, -960, -480])
  })

  it('agrees with the equivalent clicksInRange call', () => {
    const s = settings({ timeSignature: sig(6, 8), subdivision: 2, countInBars: 1 })
    expect(clicksForBars(s, 2)).toEqual(range(s, -1440, 2880))
  })

  it('throws on a bar count that is not a whole number >= 0', () => {
    expect(() => clicksForBars(settings(), -1)).toThrow(InvariantError)
    expect(() => clicksForBars(settings(), 1.5)).toThrow(InvariantError)
  })

  it('throws on a count-in that is not a whole number >= 0', () => {
    expect(() => clicksForBars(settings({ countInBars: -1 }), 1)).toThrow(InvariantError)
    expect(() => clicksForBars(settings({ countInBars: 0.5 }), 1)).toThrow(InvariantError)
  })
})

// ------------------------------------------------------------------ grid reuse

describe('grid reuse', () => {
  /**
   * `clicksInRange` is called once per frame by the scheduler's look-ahead.
   * Counting property reads is the observable proxy for "the grid — and the
   * TempoMap inside it — was built once": every read of `bpm` happens inside the
   * build, so a rebuilt grid reads it again. Rebuilding also minted a fresh marks
   * array each frame, which defeated the prefix-sum WeakMap in tempo.ts and grew
   * it by an entry per call.
   */
  const counting = (): { settings: MetronomeSettings; reads: () => number } => {
    const base = settings({ subdivision: 2 })
    let reads = 0
    const spied: MetronomeSettings = {
      ...base,
      get bpm(): Bpm {
        reads++
        return base.bpm
      },
    }
    return { settings: spied, reads: () => reads }
  }

  it('builds the grid once per settings object, however many frames ask', () => {
    const { settings: s, reads } = counting()
    range(s, 0, 480)
    const afterFirst = reads()
    expect(afterFirst).toBeGreaterThan(0)
    for (let frame = 1; frame < 60; frame++) range(s, frame * 480, (frame + 1) * 480)
    clicksForBars(s, 2)
    expect(reads()).toBe(afterFirst)
  })

  it('builds a new grid for a new settings object', () => {
    const first = counting()
    const second = counting()
    range(first.settings, 0, 480)
    range(second.settings, 0, 480)
    expect(second.reads()).toBe(first.reads())
    expect(second.reads()).toBeGreaterThan(0)
  })

  it('still throws every time when the cached settings are invalid', () => {
    const bad = settings({ accents: [true] })
    expect(() => range(bad, 0, 480)).toThrow(InvariantError)
    expect(() => range(bad, 0, 480)).toThrow(InvariantError)
  })
})

// ------------------------------------------------------------------- click cap

describe('click cap', () => {
  it('refuses to materialise an absurd number of clicks instead of hanging', () => {
    expect(() => clicksForBars(settings(), 1e7)).toThrow(InvariantError)
    expect(() => clicksForBars(settings(), 1e7)).toThrow(new RegExp(`over the ${MAX_CLICKS} cap`))
    expect(() => range(settings(), 0, 480 * (MAX_CLICKS + 1))).toThrow(
      new RegExp(`${MAX_CLICKS + 1} clicks`),
    )
  })

  it('counts the count-in against the cap too', () => {
    expect(() => clicksForBars(settings({ countInBars: 1e7 }), 0)).toThrow(InvariantError)
  })

  it('allows a window right up to the cap', () => {
    expect(range(settings(), 0, 480 * MAX_CLICKS)).toHaveLength(MAX_CLICKS)
  })
})

// --------------------------------------------------------- following the tempo

/**
 * The click has to sit on the same millisecond the transport puts the tick on,
 * or it drifts away from the music. TEMPO_CHANGE is an ordinary written tempo
 * change — crotchet = 120 in bar 1, 72 from bar 2 — which a scalar bpm cannot
 * follow: it puts tick 2400 at 2500 ms where the transport puts it at 2833.33,
 * 333 ms of drift inside one bar against the 20 ms budget of REQ-4.1.
 */
describe('following a tempo map', () => {
  const tempoOf = (scale: number): TempoMap => makeTempoMap(TEMPO_CHANGE.tempos, scale)

  /** Drive a transport and a metronome from one clock and compare them. */
  const agreesWithTransport = (scale: number): void => {
    const tempo = tempoOf(scale)
    const clock = new FakeClock()
    const transport = new Transport({ score: TEMPO_CHANGE, tempo, clock })
    const clicks = clicksForBars(settings({ tempo }), 2)
    expect(clicks).toHaveLength(8)
    transport.play()
    for (const click of clicks) {
      // The metronome's own tick -> ms must be the transport's tick -> ms...
      nearly(click.ms, tickToMs(tempo, click.tick))
      // ...and driving the shared clock to the click must land the playhead on it.
      clock.setTime(click.ms)
      transport.tick()
      nearly(transport.positionTicks, click.tick)
    }
  }

  it('agrees with a transport across a written tempo change at scale 1', () => {
    agreesWithTransport(1)
  })

  it('agrees with a transport at practice scale 0.5 (REQ-3.2.2)', () => {
    agreesWithTransport(0.5)
  })

  it('stretches bar 2 to the written 72 bpm instead of a straight 120 bpm line', () => {
    const clicks = clicksForBars(settings({ tempo: tempoOf(1) }), 2)
    expect(ticksOf(clicks)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880, 3360])
    expect(msOf(clicks).slice(0, 5)).toEqual([0, 500, 1000, 1500, 2000])
    // 72 bpm is 833.33 ms per quarter, so tick 2400 is at 2833.33, not 2500.
    nearly(at(clicks, 5).ms, 2000 + 2500 / 3)
    nearly(at(clicks, 6).ms, 2000 + 5000 / 3)
    nearly(at(clicks, 7).ms, 4500)
  })

  it('halves the click rate at scale 0.5 and doubles it at scale 2', () => {
    const base = msOf(clicksForBars(settings({ tempo: tempoOf(1) }), 2))
    const slow = msOf(clicksForBars(settings({ tempo: tempoOf(0.5) }), 2))
    const fast = msOf(clicksForBars(settings({ tempo: tempoOf(2) }), 2))
    base.forEach((ms, i) => nearly(at(slow, i), ms * 2))
    base.forEach((ms, i) => nearly(at(fast, i), ms / 2))
  })

  it('extends the first tempo backwards through the count-in', () => {
    const tempo = tempoOf(1)
    const clicks = clicksForBars(settings({ tempo, countInBars: 1 }), 0)
    expect(ticksOf(clicks)).toEqual([-1920, -1440, -960, -480])
    expect(msOf(clicks)).toEqual([-2000, -1500, -1000, -500])
  })

  it('falls back to a single mark of `bpm` when no map is supplied', () => {
    const scalar = clicksForBars(settings({ bpm: asBpm(90) }), 2)
    const mapped = clicksForBars(
      settings({ bpm: asBpm(90), tempo: makeTempoMap([{ tick: asTicks(0), bpm: asBpm(90) }]) }),
      2,
    )
    expect(scalar).toEqual(mapped)
  })

  it('lets the map win over the scalar bpm on the dial', () => {
    const tempo = makeTempoMap([{ tick: asTicks(0), bpm: asBpm(60) }])
    expect(msOf(clicksForBars(settings({ bpm: asBpm(240), tempo }), 1))).toEqual([
      0, 1000, 2000, 3000,
    ])
  })
})

// ------------------------------------------------------ validateMetronomeSettings

describe('validateMetronomeSettings', () => {
  it('accepts well-formed settings and passes them through', () => {
    const s = settings({ accents: [true, false, true, false], countInBars: 2 })
    const result = validateMetronomeSettings(s)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(s)
  })

  it('accepts every declared subdivision at the range boundaries of bpm', () => {
    for (const subdivision of SUBDIVISIONS) {
      expect(validateMetronomeSettings(settings({ subdivision })).ok).toBe(true)
    }
    expect(validateMetronomeSettings(settings({ bpm: asBpm(MIN_BPM) })).ok).toBe(true)
    expect(validateMetronomeSettings(settings({ bpm: asBpm(MAX_BPM) })).ok).toBe(true)
  })

  it('rejects a bpm outside the usable range', () => {
    for (const value of [0, -120, MIN_BPM - 1, MAX_BPM + 1, Number.NaN]) {
      const result = validateMetronomeSettings(settings({ bpm: asBpm(value) }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/bpm must be between/)
    }
  })

  it('rejects settings whose clicks would come faster than the ear (or the audio) can take', () => {
    // bpm x (4 / beatType) x subdivision is the audible rate; bpm alone is not.
    // 4/4 with subdivision 8 at 300 is a click every 25 ms...
    const buzz = validateMetronomeSettings(settings({ bpm: asBpm(300), subdivision: 8 }))
    expect(buzz.ok).toBe(false)
    if (!buzz.ok) expect(buzz.error).toMatch(/25 ms apart in 4\/4 with subdivision 8/)
    // ...and 6/16 with subdivision 8 at 300 is 6.25 ms, inside the 20 ms budget.
    const inaudible = validateMetronomeSettings(
      settings({ bpm: asBpm(300), timeSignature: sig(6, 16), subdivision: 8 }),
    )
    expect(inaudible.ok).toBe(false)
    if (!inaudible.ok) expect(inaudible.error).toMatch(/6.25 ms apart/)
    for (const result of [buzz, inaudible]) {
      if (!result.ok) expect(result.error).toMatch(new RegExp(`at least ${MIN_CLICK_GAP_MS} ms`))
    }
  })

  it('rejects settings whose clicks are too far apart to be a pulse', () => {
    // 4/1 at 20 bpm is one click every 12 seconds.
    const result = validateMetronomeSettings(
      settings({ bpm: asBpm(MIN_BPM), timeSignature: sig(4, 1) }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/12000 ms apart/)
      expect(result.error).toMatch(new RegExp(`at most ${MAX_CLICK_GAP_MS} ms`))
    }
  })

  it('accepts the boundaries of the click-gap window', () => {
    // 4/4 subdivision 4 at 300 bpm is exactly 50 ms; 2/2 at 20 bpm exactly 6000.
    expect(validateMetronomeSettings(settings({ bpm: asBpm(300), subdivision: 4 })).ok).toBe(true)
    expect(
      validateMetronomeSettings(settings({ bpm: asBpm(MIN_BPM), timeSignature: sig(2, 2) })).ok,
    ).toBe(true)
  })

  it('measures the gap at the extremes of a tempo map, not just the dial', () => {
    const tempo = makeTempoMap([
      { tick: asTicks(0), bpm: asBpm(60) },
      { tick: asTicks(1920), bpm: asBpm(300) },
    ])
    const fast = validateMetronomeSettings(settings({ tempo, subdivision: 8 }))
    expect(fast.ok).toBe(false)
    if (!fast.ok) expect(fast.error).toMatch(/25 ms apart/)
    // The same map at half speed is comfortable again.
    expect(
      validateMetronomeSettings(settings({ tempo: makeTempoMap(tempo.marks, 0.5), subdivision: 8 }))
        .ok,
    ).toBe(true)
    // ...and the practice scale can push a sane map out of range the other way.
    const slow = validateMetronomeSettings(
      settings({ tempo: makeTempoMap([{ tick: asTicks(0), bpm: asBpm(30) }], 0.25) }),
    )
    expect(slow.ok).toBe(false)
    if (!slow.ok) expect(slow.error).toMatch(/at most/)
  })

  it('rejects a tempo map with no marks at all', () => {
    const result = validateMetronomeSettings(settings({ tempo: { marks: [], scale: 1 } }))
    expect(result).toEqual({ ok: false, error: 'tempo map has no marks' })
  })

  it('rejects an impossible time signature', () => {
    expect(validateMetronomeSettings(settings({ timeSignature: sig(0, 4) }))).toEqual({
      ok: false,
      error: 'bad time signature beats: 0',
    })
    expect(validateMetronomeSettings(settings({ timeSignature: sig(2.5, 4) })).ok).toBe(false)
    expect(validateMetronomeSettings(settings({ timeSignature: sig(4, 0) })).ok).toBe(false)
    expect(validateMetronomeSettings(settings({ timeSignature: sig(4, -4) })).ok).toBe(false)
    // 1920 / 7 is not a whole tick.
    expect(validateMetronomeSettings(settings({ timeSignature: sig(4, 7) })).ok).toBe(false)
  })

  it('rejects an unsupported subdivision', () => {
    const result = validateMetronomeSettings(settings({ subdivision: 5 as Subdivision }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/unsupported subdivision/)
  })

  it('rejects a subdivision that does not divide the beat exactly', () => {
    const result = validateMetronomeSettings(
      settings({ timeSignature: sig(4, 32), subdivision: 8 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/does not divide a beat/)
  })

  it('rejects an accent pattern of the wrong length, but allows none at all', () => {
    const result = validateMetronomeSettings(settings({ accents: [true, false] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/needs 4/)
    expect(validateMetronomeSettings(settings()).ok).toBe(true)
  })

  it('rejects a count-in that is not a whole number >= 0', () => {
    expect(validateMetronomeSettings(settings({ countInBars: -1 })).ok).toBe(false)
    expect(validateMetronomeSettings(settings({ countInBars: 1.5 })).ok).toBe(false)
    expect(validateMetronomeSettings(settings({ countInBars: 0 })).ok).toBe(true)
  })
})

// --------------------------------------------------------- named musical cases

describe('named musical cases', () => {
  it('Ode to Joy, 4/4 at 120: four clicks a bar, one every 500 ms, downbeat accented', () => {
    const bar = clicksForBars(settings({ bpm: asBpm(120), timeSignature: sig(4, 4) }), 1)
    expect(msOf(bar)).toEqual([0, 500, 1000, 1500])
    expect(accentsOf(bar)).toEqual([true, false, false, false])
  })

  it('a Viennese waltz, 3/4 at 180: three clicks a bar, one bar per second', () => {
    const bar = clicksForBars(settings({ bpm: asBpm(180), timeSignature: sig(3, 4) }), 1)
    expect(accentsOf(bar)).toEqual([true, false, false])
    // 180 quarters/min -> 333.33 ms per beat, so a 3/4 bar lasts exactly 1 s.
    nearly(at(bar, 1).ms, 1000 / 3)
    nearly(at(bar, 2).ms, 2000 / 3)
    const twoBars = clicksForBars(settings({ bpm: asBpm(180), timeSignature: sig(3, 4) }), 2)
    nearly(at(twoBars, 3).ms, 1000)
  })

  it('When Johnny Comes Marching Home, 6/8: six eighth clicks, accents on 1 and 4', () => {
    // bpm is quarter-note BPM, so 120 gives an eighth every 250 ms — 240 eighths
    // per minute, the usual marching feel of a 6/8 quickstep.
    const bar = clicksForBars(settings({ bpm: asBpm(120), timeSignature: sig(6, 8) }), 1)
    expect(bar).toHaveLength(6)
    expect(msOf(bar)).toEqual([0, 250, 500, 750, 1000, 1250])
    expect(bar.filter((c) => c.accented).map((c) => c.beat)).toEqual([0, 3])
  })

  it('a Sousa march in cut common, 2/2 at 120: two half-note clicks a second apart', () => {
    const bar = clicksForBars(settings({ bpm: asBpm(120), timeSignature: sig(2, 2) }), 1)
    expect(ticksOf(bar)).toEqual([0, 960])
    expect(msOf(bar)).toEqual([0, 1000])
    expect(accentsOf(bar)).toEqual([true, false])
  })

  it('Chopin op. 28 no. 4 practised slowly: 4/4 at 40 with eighth-note subdivision', () => {
    const bar = clicksForBars(settings({ bpm: asBpm(40), subdivision: 2 }), 1)
    expect(bar).toHaveLength(8)
    // 40 bpm -> 1500 ms per quarter, so the eighths are 750 ms apart.
    expect(msOf(bar)).toEqual([0, 750, 1500, 2250, 3000, 3750, 4500, 5250])
  })
})

// ------------------------------------------------------------- ramp: examples

const ramp = (over: Partial<RampSettings> = {}): RampSettings => ({
  startBpm: asBpm(80),
  targetBpm: asBpm(100),
  stepBpm: 4,
  repsPerStep: 2,
  ...over,
})

const runRamp = (s: RampSettings, reps: readonly boolean[]): RampState[] => {
  const states: RampState[] = [startRamp(s)]
  for (const clean of reps) states.push(advanceRamp(s, at(states, states.length - 1), clean))
  return states
}

const clean = (n: number): boolean[] => Array.from({ length: n }, () => true)

describe('startRamp', () => {
  it('starts at the start tempo with no reps banked', () => {
    expect(startRamp(ramp())).toEqual({ currentBpm: 80, repsAtCurrent: 0, done: false })
  })

  it('is already done when the start is at or above the target, clamping to the target', () => {
    expect(startRamp(ramp({ startBpm: asBpm(100) }))).toEqual({
      currentBpm: 100,
      repsAtCurrent: 0,
      done: true,
    })
    expect(startRamp(ramp({ startBpm: asBpm(140) }))).toEqual({
      currentBpm: 100,
      repsAtCurrent: 0,
      done: true,
    })
  })

  it('throws on impossible ramp settings', () => {
    expect(() => startRamp(ramp({ startBpm: asBpm(0) }))).toThrow(InvariantError)
    expect(() => startRamp(ramp({ targetBpm: asBpm(-1) }))).toThrow(InvariantError)
    expect(() => startRamp(ramp({ stepBpm: 0 }))).toThrow(InvariantError)
    expect(() => startRamp(ramp({ stepBpm: Number.NaN }))).toThrow(InvariantError)
    expect(() => startRamp(ramp({ repsPerStep: 0 }))).toThrow(InvariantError)
    expect(() => startRamp(ramp({ repsPerStep: 1.5 }))).toThrow(InvariantError)
    expect(() => startRamp(ramp({ targetBpm: asBpm(Number.POSITIVE_INFINITY) }))).toThrow(
      InvariantError,
    )
  })
})

describe('advanceRamp', () => {
  it('80 -> 100 by 4 every 2 clean reps reaches exactly 100 and then stays there', () => {
    const states = runRamp(ramp(), clean(14))
    expect(states.map((s) => s.currentBpm)).toEqual([
      80, 80, 84, 84, 88, 88, 92, 92, 96, 96, 100, 100, 100, 100, 100,
    ])
    expect(states.map((s) => s.done)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ])
    expect(at(states, 14).repsAtCurrent).toBe(0)
  })

  it('a failed rep resets repsAtCurrent to 0 without lowering the tempo', () => {
    const s = ramp()
    const banked = advanceRamp(s, startRamp(s), true)
    expect(banked).toEqual({ currentBpm: 80, repsAtCurrent: 1, done: false })
    const failed = advanceRamp(s, banked, false)
    expect(failed).toEqual({ currentBpm: 80, repsAtCurrent: 0, done: false })
    // ...and the two clean reps after the failure still earn the step.
    const recovered = advanceRamp(s, advanceRamp(s, failed, true), true)
    expect(recovered).toEqual({ currentBpm: 84, repsAtCurrent: 0, done: false })
  })

  it('a failure with nothing banked changes nothing', () => {
    const s = ramp()
    expect(advanceRamp(s, startRamp(s), false)).toEqual(startRamp(s))
  })

  it('steps on every clean rep when repsPerStep is 1 (REQ-3.9.1: +2 BPM per clean rep)', () => {
    const s = ramp({ startBpm: asBpm(60), targetBpm: asBpm(66), stepBpm: 2, repsPerStep: 1 })
    expect(runRamp(s, clean(4)).map((st) => st.currentBpm)).toEqual([60, 62, 64, 66, 66])
  })

  it('never overshoots the target when the step does not divide the gap', () => {
    const s = ramp({ startBpm: asBpm(80), targetBpm: asBpm(100), stepBpm: 30, repsPerStep: 1 })
    const [, after] = runRamp(s, clean(1))
    expect(after).toEqual({ currentBpm: 100, repsAtCurrent: 0, done: true })
  })

  it('freezes once done — further reps, clean or not, return the same state', () => {
    const s = ramp({ startBpm: asBpm(100) })
    const done = startRamp(s)
    expect(advanceRamp(s, done, true)).toBe(done)
    expect(advanceRamp(s, done, false)).toBe(done)
  })

  it('validates its settings too', () => {
    expect(() => advanceRamp(ramp({ stepBpm: -4 }), startRamp(ramp()), true)).toThrow(
      InvariantError,
    )
  })
})

// ------------------------------------------------------------------ properties

const arbTimeSignature = fc.record({
  beats: fc.integer({ min: 1, max: 12 }),
  // Every one of these divides 1920 by all six subdivisions, so the grid is
  // always tick-exact — the throwing cases are covered by example above.
  beatType: fc.constantFrom(1, 2, 4, 8, 16),
})

const arbSubdivision: fc.Arbitrary<Subdivision> = fc.constantFrom<Subdivision>(1, 2, 3, 4, 6, 8)
const arbBpm: fc.Arbitrary<Bpm> = fc.integer({ min: MIN_BPM, max: MAX_BPM }).map(asBpm)

const arbSettings: fc.Arbitrary<MetronomeSettings> = fc.record({
  bpm: arbBpm,
  timeSignature: arbTimeSignature,
  subdivision: arbSubdivision,
})

/** A window that straddles tick 0, so every property also covers the count-in. */
const FROM = -1920
const TO = 3840

describe('properties', () => {
  it('stitches seamlessly: any partition of [FROM, TO) concatenates to the whole', () => {
    fc.assert(
      fc.property(
        arbSettings,
        fc.array(fc.integer({ min: FROM, max: TO }), { maxLength: 8 }),
        (s, rawCuts) => {
          const bounds = [FROM, ...[...new Set(rawCuts)].sort((a, b) => a - b), TO]
          const stitched: Click[] = []
          for (let i = 1; i < bounds.length; i++) {
            stitched.push(...range(s, at(bounds, i - 1), at(bounds, i)))
          }
          expect(stitched).toEqual(range(s, FROM, TO))
        },
      ),
    )
  })

  it('emits ticks and times in strictly increasing order', () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const clicks = range(s, FROM, TO)
        const rising = clicks.every(
          (c, i) => i === 0 || (c.tick > at(clicks, i - 1).tick && c.ms > at(clicks, i - 1).ms),
        )
        expect(rising).toBe(true)
      }),
    )
  })

  it('places every ms exactly where the tempo says: ms = tick * 125 / bpm', () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const clicks = range(s, FROM, TO)
        const worst = clicks.reduce(
          (max, c) =>
            Math.max(max, Math.abs(c.ms - (c.tick * 125) / s.bpm) / Math.max(1, Math.abs(c.ms))),
          0,
        )
        nearly(worst, 0)
      }),
    )
  })

  it('produces exactly beats * subdivision clicks per bar', () => {
    fc.assert(
      fc.property(arbSettings, fc.integer({ min: 0, max: 4 }), (s, bars) => {
        const perBar = s.timeSignature.beats * s.subdivision
        expect(clicksForBars(s, bars)).toHaveLength(bars * perBar)
        expect(clicksForBars({ ...s, countInBars: 1 }, bars)).toHaveLength((bars + 1) * perBar)
      }),
    )
  })

  it('reconstructs each tick from (bar, beat, subdivisionIndex)', () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const perBeat = beatTicks(s.timeSignature)
        const interval = perBeat / s.subdivision
        const clicks = range(s, FROM, TO)
        const rebuilt = clicks.map(
          (c) => (c.bar * s.timeSignature.beats + c.beat) * perBeat + c.subdivisionIndex * interval,
        )
        expect(rebuilt).toEqual(ticksOf(clicks))
        const indicesInRange = clicks.every(
          (c) =>
            c.beat >= 0 &&
            c.beat < s.timeSignature.beats &&
            c.subdivisionIndex >= 0 &&
            c.subdivisionIndex < s.subdivision,
        )
        expect(indicesInRange).toBe(true)
      }),
    )
  })

  it('accents only on the beat, and only where the pattern says so', () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const accents = defaultAccents(s.timeSignature)
        const clicks = range(s, FROM, TO)
        expect(accentsOf(clicks)).toEqual(
          clicks.map((c) => c.subdivisionIndex === 0 && at(accents, c.beat)),
        )
        expect(clicks.filter((c) => c.accented).every((c) => c.subdivisionIndex === 0)).toBe(true)
      }),
    )
  })

  it('gives every bar the same accent shape, count-in bars included', () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const clicks = clicksForBars({ ...s, countInBars: 2 }, 2)
        const perBar = s.timeSignature.beats * s.subdivision
        const shape = (bar: number): boolean[] =>
          accentsOf(clicks.slice(bar * perBar, (bar + 1) * perBar))
        for (let bar = 1; bar < 4; bar++) expect(shape(bar)).toEqual(shape(0))
      }),
    )
  })

  it('defaultAccents always accents the downbeat and returns one entry per beat', () => {
    // Deliberately NOT re-deriving the grouping: a property that recomputes the
    // implementation's own rule can never disagree with it. The grouping itself
    // is pinned by the oracle table in `accent oracle`, below.
    fc.assert(
      fc.property(arbTimeSignature, (ts) => {
        const accents = defaultAccents(ts)
        expect(accents).toHaveLength(ts.beats)
        expect(at(accents, 0)).toBe(true)
        expect(accents.every((a) => typeof a === 'boolean')).toBe(true)
      }),
    )
  })

  it('an empty range yields nothing, and any range a beat long yields at least one click', () => {
    fc.assert(
      fc.property(arbSettings, fc.integer({ min: FROM, max: TO }), (s, from) => {
        expect(range(s, from, from)).toHaveLength(0)
        expect(range(s, from, from - 1)).toHaveLength(0)
        expect(range(s, from, from + beatTicks(s.timeSignature)).length).toBeGreaterThanOrEqual(1)
      }),
    )
  })
})

// ------------------------------------------------------------- ramp properties

const arbRamp: fc.Arbitrary<RampSettings> = fc
  .record({
    startBpm: fc.integer({ min: MIN_BPM, max: MAX_BPM }),
    gap: fc.integer({ min: -20, max: 120 }),
    stepBpm: fc.integer({ min: 1, max: 20 }),
    repsPerStep: fc.integer({ min: 1, max: 4 }),
  })
  .map(({ startBpm, gap, stepBpm, repsPerStep }) => ({
    startBpm: asBpm(startBpm),
    targetBpm: asBpm(Math.max(1, startBpm + gap)),
    stepBpm,
    repsPerStep,
  }))

describe('ramp properties', () => {
  it('never lowers the tempo, never exceeds the target, never banks a full step', () => {
    fc.assert(
      fc.property(arbRamp, fc.array(fc.boolean(), { maxLength: 40 }), (s, reps) => {
        const states = runRamp(s, reps)
        for (let i = 0; i < states.length; i++) {
          const state = at(states, i)
          expect(state.currentBpm).toBeLessThanOrEqual(s.targetBpm)
          expect(state.repsAtCurrent).toBeGreaterThanOrEqual(0)
          expect(state.repsAtCurrent).toBeLessThan(s.repsPerStep)
          if (i > 0) expect(state.currentBpm).toBeGreaterThanOrEqual(at(states, i - 1).currentBpm)
        }
      }),
    )
  })

  it('a failed repetition never changes the tempo or the done flag', () => {
    fc.assert(
      fc.property(arbRamp, fc.array(fc.boolean(), { maxLength: 20 }), (s, reps) => {
        const state = at(runRamp(s, reps), reps.length)
        const after = advanceRamp(s, state, false)
        expect(after.currentBpm).toBe(state.currentBpm)
        expect(after.done).toBe(state.done)
        expect(after.repsAtCurrent).toBe(state.done ? state.repsAtCurrent : 0)
      }),
    )
  })

  it('done is absorbing: once finished, no repetition changes the state', () => {
    fc.assert(
      fc.property(arbRamp, fc.array(fc.boolean(), { maxLength: 40 }), (s, reps) => {
        const states = runRamp(s, reps)
        for (let i = 1; i < states.length; i++) {
          if (at(states, i - 1).done) expect(at(states, i)).toEqual(at(states, i - 1))
        }
      }),
    )
  })

  it('enough clean repetitions always land exactly on the target', () => {
    fc.assert(
      fc.property(arbRamp, (s) => {
        const stepsNeeded = Math.ceil(Math.max(0, s.targetBpm - s.startBpm) / s.stepBpm)
        const states = runRamp(s, clean(stepsNeeded * s.repsPerStep))
        const last = at(states, states.length - 1)
        expect(last.currentBpm).toBe(s.targetBpm)
        expect(last.done).toBe(true)
      }),
    )
  })

  it('done is exactly "current tempo is the target tempo"', () => {
    fc.assert(
      fc.property(arbRamp, fc.array(fc.boolean(), { maxLength: 40 }), (s, reps) => {
        for (const state of runRamp(s, reps)) {
          expect(state.done).toBe(state.currentBpm >= s.targetBpm)
        }
      }),
    )
  })
})
