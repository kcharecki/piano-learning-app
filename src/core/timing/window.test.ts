import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { WINDOW_EPSILON_ULPS, windowLimitMs } from './window.ts'
import { makeTempoMap, tickToMs } from './tempo.ts'
import { ticks } from '@core/shared/units.ts'

const tempo = makeTempoMap([])
const ms = (t: number): number => Number(tickToMs(tempo, ticks(t)))

describe('windowLimitMs', () => {
  it('admits the exact boundary tap that roadmap T.15 was about', () => {
    // Onsets 0/9/13 ticks, tap at 14, tolerance 1 tick. In ticks the tap is
    // exactly on onset 13's boundary. In milliseconds it is 1.2e-15 outside,
    // which is what made `gradeTapping` disagree with the live classifier.
    const onsetMs = [ms(0), ms(9), ms(13)]
    const tapMs = [ms(14)]
    const rawDelta = ms(14) - ms(13)
    expect(rawDelta).toBeGreaterThan(ms(1))
    expect(rawDelta).toBeLessThanOrEqual(windowLimitMs(ms(1), onsetMs, tapMs))
  })

  it('admits the second counterexample the 50k-run sweep found', () => {
    const onsetMs = [0, 1556, 3073, 3793, 4360].map(ms)
    const tapMs = [ms(4355)]
    expect(ms(4360) - ms(4355)).toBeLessThanOrEqual(windowLimitMs(ms(5), onsetMs, tapMs))
  })

  it('never returns less than the tolerance it was given', () => {
    expect(windowLimitMs(150, [0, 1000], [500])).toBeGreaterThanOrEqual(150)
    expect(windowLimitMs(0, [0], [0])).toBeGreaterThanOrEqual(0)
  })

  it('reads the magnitude off the ends of the arrays, including negative taps', () => {
    // A tap before the first onset is legal (the learner tapped early), so
    // the magnitude has to come from |first| as well as |last|.
    const wide = windowLimitMs(10, [0, 100], [-90_000, 5])
    const narrow = windowLimitMs(10, [0, 100], [-5, 5])
    expect(wide).toBeGreaterThan(narrow)
  })

  it('falls back to the tolerance alone when there is nothing to measure', () => {
    // Empty arrays: no onsets, no taps. The slack still has to be defined,
    // and comes off the tolerance itself.
    expect(windowLimitMs(150, [], [])).toBeCloseTo(150, 10)
    expect(windowLimitMs(150, [], [])).toBeGreaterThan(150)
    expect(windowLimitMs(0, [], [])).toBe(0)
  })

  it('rejects a tolerance that is not a finite number >= 0', () => {
    expect(() => windowLimitMs(-1, [], [])).toThrow(/toleranceMs/)
    expect(() => windowLimitMs(Number.NaN, [], [])).toThrow(/toleranceMs/)
    expect(() => windowLimitMs(Number.POSITIVE_INFINITY, [], [])).toThrow(/toleranceMs/)
  })

  it('the slack it adds is far below any timing this app claims to resolve', () => {
    // Ten minutes of music at 120bpm, a 150ms tolerance. The widening has to
    // be invisible: nothing here resolves better than a microsecond, and no
    // clock feeding it does either.
    const tenMinutesMs = 600_000
    const limit = windowLimitMs(150, [0, tenMinutesMs], [tenMinutesMs])
    expect(limit - 150).toBeLessThan(1e-6)
    expect(limit - 150).toBeGreaterThan(0)
  })

  it('property: a tap exactly one tolerance away, in ticks, is always inside the limit', () => {
    // The whole contract. Both the onset and the tap are exact ticks, and the
    // tolerance is the exact tick distance between them, so in the domain's
    // own units the tap is on the boundary and therefore claimable. Converting
    // all three to milliseconds must not change that answer — which is exactly
    // what it did before this module existed.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 1, max: 4000 }),
        (onsetTick, toleranceTicks) => {
          const tapTick = onsetTick + toleranceTicks
          const delta = ms(tapTick) - ms(onsetTick)
          expect(delta).toBeLessThanOrEqual(windowLimitMs(ms(toleranceTicks), [ms(onsetTick)], [ms(tapTick)]))
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('property: a tap a whole tick BEYOND the tolerance is never dragged inside', () => {
    // The other half — the slack must not be big enough to widen the window
    // by anything the domain can express. One tick is the smallest distance
    // core code can name, and it must always stay out.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 1, max: 4000 }),
        (onsetTick, toleranceTicks) => {
          const tapTick = onsetTick + toleranceTicks + 1
          const delta = ms(tapTick) - ms(onsetTick)
          expect(delta).toBeGreaterThan(windowLimitMs(ms(toleranceTicks), [ms(onsetTick)], [ms(tapTick)]))
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('WINDOW_EPSILON_ULPS is the knob both properties above are balanced on', () => {
    // Documented so a future change to it is a deliberate act: it has to be
    // big enough for the first property and small enough for the second.
    expect(WINDOW_EPSILON_ULPS).toBe(16)
  })
})
