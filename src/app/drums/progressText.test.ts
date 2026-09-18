import { describe, expect, it } from 'vitest'
import {
  biasLine,
  bestLine,
  formatDay,
  grooveCoverageLine,
  milestoneLine,
  milestoneSummaryLine,
  readingLine,
  rudimentCoverageLine,
  tierLine,
  trendLine,
} from './progressText.ts'
import type {
  GrooveBest,
  GrooveCoverage,
  GrooveTrend,
  LimbBias,
  MilestoneStatus,
  RudimentCoverage,
  TierCompletion,
} from '@core/drums/progress/index.ts'

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

describe('grooveCoverageLine', () => {
  it('names the never-played grooves when any remain', () => {
    const c: GrooveCoverage = {
      total: 3,
      played: 1,
      steady: 0,
      neverPlayed: [
        { id: 'quarter-note-rock', title: 'Quarter-Note Rock' },
        { id: 'money-beat-open-hat', title: 'Money Beat (Open Hat)' },
      ],
      playedNotSteady: [],
    }
    expect(grooveCoverageLine(c)).toBe(
      'Grooves: 1 of 3 played, 0 steady. Not yet played: Quarter-Note Rock, Money Beat (Open Hat).',
    )
  })

  it('names the not-yet-steady grooves once everything has been played', () => {
    const c: GrooveCoverage = {
      total: 3,
      played: 3,
      steady: 2,
      neverPlayed: [],
      playedNotSteady: [{ id: 'money-beat-open-hat', title: 'Money Beat (Open Hat)' }],
    }
    expect(grooveCoverageLine(c)).toBe(
      'Grooves: 3 of 3 played, 2 steady. Not yet steady: Money Beat (Open Hat).',
    )
  })

  it('ends after the counts once everything is steady', () => {
    const c: GrooveCoverage = { total: 3, played: 3, steady: 3, neverPlayed: [], playedNotSteady: [] }
    expect(grooveCoverageLine(c)).toBe('Grooves: 3 of 3 played, 3 steady.')
  })
})

describe('rudimentCoverageLine', () => {
  it('names the next unstarted rudiments when any remain', () => {
    const c: RudimentCoverage = {
      total: 40,
      started: 2,
      nextUp: [
        { id: 'double-stroke-open-roll', title: 'Double Stroke Open Roll' },
        { id: 'five-stroke-roll', title: 'Five Stroke Roll' },
        { id: 'single-paradiddle', title: 'Single Paradiddle' },
      ],
    }
    expect(rudimentCoverageLine(c)).toBe(
      'Rudiments: 2 of 40 started. Next up: Double Stroke Open Roll, Five Stroke Roll, Single Paradiddle.',
    )
  })

  it('ends after the counts once everything is started', () => {
    const c: RudimentCoverage = { total: 40, started: 40, nextUp: [] }
    expect(rudimentCoverageLine(c)).toBe('Rudiments: 40 of 40 started.')
  })
})

describe('formatDay', () => {
  it('formats as day, short month, year, en-GB by default', () => {
    expect(formatDay(Date.UTC(2025, 5, 18))).toBe('18 Jun 2025')
  })

  it('accepts an explicit locale', () => {
    expect(formatDay(Date.UTC(2025, 5, 18), 'en-GB')).toBe('18 Jun 2025')
  })
})

describe('milestoneLine', () => {
  const formatDate = (epochMs: number) => `<${epochMs}>`

  it('formats a reached milestone with its formatted date', () => {
    const status: MilestoneStatus = { id: 'first-steady-run', title: 'First steady run', how: 'Play any groove steady once.', reachedAt: 42 }
    expect(milestoneLine(status, formatDate)).toBe('First steady run — reached <42>')
  })

  it('formats an unreached milestone as "not yet"', () => {
    const status: MilestoneStatus = { id: 'first-steady-run', title: 'First steady run', how: 'Play any groove steady once.', reachedAt: undefined }
    expect(milestoneLine(status, formatDate)).toBe('First steady run — not yet. Play any groove steady once.')
  })
})

describe('milestoneSummaryLine', () => {
  it('formats reached count of total', () => {
    expect(milestoneSummaryLine(2, 6)).toBe('2 of 6 reached.')
  })

  it('formats zero reached', () => {
    expect(milestoneSummaryLine(0, 6)).toBe('0 of 6 reached.')
  })

  it('formats all reached', () => {
    expect(milestoneSummaryLine(6, 6)).toBe('6 of 6 reached.')
  })
})
