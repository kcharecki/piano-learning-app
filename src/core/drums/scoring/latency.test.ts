import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_HITS,
  MIN_CALIBRATION_HITS,
  median,
  nearestClickDeviationMs,
  summarizeCalibration,
} from './latency.ts'

describe('nearestClickDeviationMs', () => {
  it('reads a hit after the click as late (positive)', () => {
    expect(nearestClickDeviationMs(30, 0, 500)).toBe(30)
  })

  it('reads a hit before the click as early (negative)', () => {
    expect(nearestClickDeviationMs(-30, 0, 500)).toBe(-30)
  })

  it('picks the nearest click, not always the grid origin', () => {
    // 480 is nearer to the click at 500 than to the one at 0.
    expect(nearestClickDeviationMs(480, 0, 500)).toBe(-20)
  })

  it('resolves an exact tie to the earlier click — positive on both sides of the grid', () => {
    // Exactly halfway between the click at 0 and the one at 500.
    expect(nearestClickDeviationMs(250, 0, 500)).toBe(250)
    // Exactly halfway between the click at -500 and the one at 0 — ties still
    // resolve to the earlier click (-500), so this also reads positive.
    expect(nearestClickDeviationMs(-250, 0, 500)).toBe(250)
  })

  it('is always in (-beatMs/2, beatMs/2]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        (hitMs, originMs, beatMs) => {
          const dev = nearestClickDeviationMs(hitMs, originMs, beatMs)
          expect(dev).toBeGreaterThan(-beatMs / 2)
          expect(dev).toBeLessThanOrEqual(beatMs / 2)
        },
      ),
    )
  })

  it('is unchanged by shifting hitMs by whole beats', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100_000, max: 100_000, noNaN: true }),
        fc.double({ min: -100_000, max: 100_000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.integer({ min: -50, max: 50 }),
        (hitMs, originMs, beatMs, k) => {
          const base = nearestClickDeviationMs(hitMs, originMs, beatMs)
          const shifted = nearestClickDeviationMs(hitMs + k * beatMs, originMs, beatMs)
          expect(shifted).toBeCloseTo(base, 6)
        },
      ),
    )
  })
})

describe('median', () => {
  it('throws on an empty array (programmer error)', () => {
    expect(() => median([])).toThrow(/invariant/i)
  })

  it('returns the single value for a one-element array', () => {
    expect(median([42])).toBe(42)
  })

  it('returns the middle value for an odd count', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('returns the MEAN of the two middle values for an even count — not the lower one', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('summarizeCalibration', () => {
  it('is undefined below MIN_CALIBRATION_HITS', () => {
    const deviations = Array.from({ length: MIN_CALIBRATION_HITS - 1 }, () => 30)
    expect(summarizeCalibration(deviations)).toBeUndefined()
  })

  it('is defined at exactly MIN_CALIBRATION_HITS samples', () => {
    const deviations = Array.from({ length: MIN_CALIBRATION_HITS }, () => 12)
    expect(summarizeCalibration(deviations)).toEqual({
      offsetMs: 12,
      spreadMs: 0,
      samples: MIN_CALIBRATION_HITS,
    })
  })

  it('a +30 ms biased, noiseless stream of 16 reads offsetMs 30, spreadMs 0', () => {
    const deviations = Array.from({ length: CALIBRATION_HITS }, () => 30)
    expect(summarizeCalibration(deviations)).toEqual({ offsetMs: 30, spreadMs: 0, samples: 16 })
  })

  it('a negative (early) biased stream reads a negative offset', () => {
    const deviations = Array.from({ length: CALIBRATION_HITS }, () => -18)
    expect(summarizeCalibration(deviations)).toEqual({ offsetMs: -18, spreadMs: 0, samples: 16 })
  })

  it('reports the spread as the median absolute deviation from the offset', () => {
    // 8 hits at +20, 8 hits at +40 — median (mean of the two middles) is 30,
    // and every value sits exactly 10 away from it.
    const deviations = [...Array.from({ length: 8 }, () => 20), ...Array.from({ length: 8 }, () => 40)]
    expect(summarizeCalibration(deviations)).toEqual({ offsetMs: 30, spreadMs: 10, samples: 16 })
  })

  it('rounds both figures to 1 decimal', () => {
    const deviations = Array.from({ length: CALIBRATION_HITS }, (_, i) => (i % 2 === 0 ? 10 : 11))
    const summary = summarizeCalibration(deviations)
    expect(summary?.offsetMs).toBe(10.5)
  })

  it('a handful of wild outliers cannot drag the median outside the untouched values’ own range', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -200, max: 200, noNaN: true }), {
          minLength: CALIBRATION_HITS,
          maxLength: CALIBRATION_HITS,
        }),
        fc.uniqueArray(fc.integer({ min: 0, max: CALIBRATION_HITS - 1 }), { minLength: 0, maxLength: 3 }),
        fc.array(fc.constantFrom(10_000, -10_000), { minLength: 3, maxLength: 3 }),
        (deviations, outlierIndices, outlierValues) => {
          const untouchedIndices = new Set(
            Array.from({ length: CALIBRATION_HITS }, (_, i) => i).filter((i) => !outlierIndices.includes(i)),
          )
          const untouched = [...untouchedIndices].map((i) => deviations[i] as number)
          const corrupted = deviations.map((d, i) => {
            const pos = outlierIndices.indexOf(i)
            return pos === -1 ? d : (outlierValues[pos] as number)
          })
          const summary = summarizeCalibration(corrupted)
          expect(summary).toBeDefined()
          const min = Math.min(...untouched)
          const max = Math.max(...untouched)
          expect(summary?.offsetMs).toBeGreaterThanOrEqual(min - 1e-6)
          expect(summary?.offsetMs).toBeLessThanOrEqual(max + 1e-6)
        },
      ),
    )
  })
})
