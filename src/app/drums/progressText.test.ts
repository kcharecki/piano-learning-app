import { describe, expect, it } from 'vitest'
import { biasLine, bestLine, readingLine, tierLine, trendLine } from './progressText.ts'
import type { GrooveBest, GrooveTrend, LimbBias, TierCompletion } from '@core/drums/progress/index.ts'

describe('tierLine', () => {
  it('formats tier, atTarget/total and started', () => {
    const row: TierCompletion = { tier: 1, total: 8, started: 5, atTarget: 3 }
    expect(tierLine(row)).toBe('Tier 1: 3 of 8 at target, 5 started')
  })

  it('formats a tier with nothing started', () => {
    const row: TierCompletion = { tier: 4, total: 6, started: 0, atTarget: 0 }
    expect(tierLine(row)).toBe('Tier 4: 0 of 6 at target, 0 started')
  })
})

describe('bestLine', () => {
  it('formats a groove with a steady best', () => {
    const b: GrooveBest = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bestSteadyBpm: 96,
      attempts: 4,
      lastAt: 1,
    }
    expect(bestLine(b)).toBe('Money Beat — best steady 96 bpm (4 attempts)')
  })

  it('formats a groove with no steady run yet, and singular attempt', () => {
    const b: GrooveBest = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bestSteadyBpm: undefined,
      attempts: 1,
      lastAt: 1,
    }
    expect(bestLine(b)).toBe('Money Beat — no steady run yet (1 attempt)')
  })

  it('pluralizes attempts for the no-steady-yet case', () => {
    const b: GrooveBest = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bestSteadyBpm: undefined,
      attempts: 2,
      lastAt: 1,
    }
    expect(bestLine(b)).toBe('Money Beat — no steady run yet (2 attempts)')
  })
})

describe('biasLine', () => {
  it('reads a positive meanMs as late', () => {
    const b: LimbBias = { pad: 'kick', meanMs: 15, samples: 24 }
    expect(biasLine(b)).toBe('Kick: 15 ms late (24 hits)')
  })

  it('reads a negative meanMs as early', () => {
    const b: LimbBias = { pad: 'snare', meanMs: -6, samples: 16 }
    expect(biasLine(b)).toBe('Snare: 6 ms early (16 hits)')
  })

  it('rounds to the nearest integer', () => {
    expect(biasLine({ pad: 'kick', meanMs: 12.4, samples: 24 })).toBe('Kick: 12 ms late (24 hits)')
    expect(biasLine({ pad: 'kick', meanMs: 12.6, samples: 24 })).toBe('Kick: 13 ms late (24 hits)')
  })

  it('reads a magnitude under 3ms as on time', () => {
    expect(biasLine({ pad: 'hhClosed', meanMs: 0, samples: 30 })).toBe('Hi-hat: on time (30 hits)')
    expect(biasLine({ pad: 'hhClosed', meanMs: 2.9, samples: 30 })).toBe(
      'Hi-hat: on time (30 hits)',
    )
    expect(biasLine({ pad: 'hhClosed', meanMs: -2.9, samples: 30 })).toBe(
      'Hi-hat: on time (30 hits)',
    )
  })

  it('singularizes a single hit', () => {
    expect(biasLine({ pad: 'kick', meanMs: 10, samples: 1 })).toBe('Kick: 10 ms late (1 hit)')
  })
})

describe('trendLine', () => {
  function point(worstAbsOffsetMs: number | undefined, steady = true) {
    return { at: 1, bpm: 90, steady, worstAbsOffsetMs }
  }

  it('formats offsets, direction word and steady count', () => {
    const t: GrooveTrend = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      points: [point(15, false), point(15, true), point(15, true)],
      direction: 'unknown',
      steadyCount: 2,
    }
    expect(trendLine(t)).toBe('Money Beat — worst limb 15, 15, 15 ms · too few runs · steady 2 of 3')
  })

  it('formats tightening, loosening and flat direction words', () => {
    const base: Omit<GrooveTrend, 'direction'> = {
      grooveId: 'g',
      grooveTitle: 'G',
      points: [point(30), point(25), point(20), point(10)],
      steadyCount: 4,
    }
    expect(trendLine({ ...base, direction: 'tightening' })).toContain('· tightening ·')
    expect(trendLine({ ...base, direction: 'loosening' })).toContain('· loosening ·')
    expect(trendLine({ ...base, direction: 'flat' })).toContain('· flat ·')
  })

  it('renders an undefined point as an en dash', () => {
    const t: GrooveTrend = {
      grooveId: 'g',
      grooveTitle: 'G',
      points: [point(undefined), point(10), point(10), point(10)],
      direction: 'flat',
      steadyCount: 4,
    }
    expect(trendLine(t)).toBe('G — worst limb –, 10, 10, 10 ms · flat · steady 4 of 4')
  })

  it('reports no timing data yet when no point has an offset', () => {
    const t: GrooveTrend = {
      grooveId: 'g',
      grooveTitle: 'G',
      points: [point(undefined), point(undefined, false)],
      direction: 'unknown',
      steadyCount: 1,
    }
    expect(trendLine(t)).toBe('G — no timing data yet · steady 1 of 2')
  })
})

describe('readingLine', () => {
  it('formats the level and each accuracy as a rounded percentage', () => {
    expect(readingLine(3, [0.8, 0.9, 1])).toBe('Level 3 — last runs 80%, 90%, 100%')
  })

  it('reports no runs yet when accuracies is empty', () => {
    expect(readingLine(1, [])).toBe('Level 1 — no runs yet')
  })
})
