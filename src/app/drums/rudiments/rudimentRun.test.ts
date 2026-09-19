import { describe, expect, it } from 'vitest'
import { RUDIMENTS } from '@content/drums/rudiments.ts'
import type { GroovePadResult, GrooveRunResult } from '@core/drums/practice/grade.ts'
import type { Rudiment } from '@core/drums/rudiment/index.ts'
import type { TempoLadderState } from '@core/drums/rudiment/index.ts'
import { RUDIMENT_CLEAN_EVENNESS } from '@core/drums/rudiment/index.ts'
import {
  barsOf,
  cyclesForBars,
  evennessText,
  isCleanPass,
  ladderText,
  measuresOnly,
  stickingPreview,
} from './rudimentRun.ts'

const BAR_TICKS = 1920

function paradiddle(): Rudiment {
  const rudiment = RUDIMENTS.find((r) => r.id === 'single-paradiddle')
  if (rudiment === undefined) throw new Error('fixture missing: single-paradiddle')
  return rudiment
}

function padRow(overrides: Partial<GroovePadResult> = {}): GroovePadResult {
  return {
    pad: 'snare',
    expected: 8,
    hits: 8,
    matched: 8,
    missed: 0,
    extra: 0,
    slipped: 0,
    meanOffsetMs: 0,
    spreadMs: 0,
    driftMs: 0,
    // DR-07 tail added this required field to `GroovePadResult`; unread here.
    displacementSteps: 0,
    ...overrides,
  }
}

function result(overrides: Partial<GrooveRunResult> = {}): GrooveRunResult {
  return {
    steady: true,
    totalHits: 8,
    pads: [padRow()],
    unison: [],
    articulation: [],
    slipSteps: undefined,
    limits: { spreadMs: 20, driftMs: 20, flamMs: 30 },
    ...overrides,
  }
}

function ladder(overrides: Partial<TempoLadderState> = {}): TempoLadderState {
  return {
    bpm: 80,
    direction: 'up',
    cleanStreak: 0,
    failStreak: 0,
    bestCleanBpm: undefined,
    history: [],
    done: false,
    ...overrides,
  }
}

describe('cyclesForBars', () => {
  it('fills exactly `bars` bars for every bundled rudiment, whenever its patternTicks allows it', () => {
    for (const rudiment of RUDIMENTS) {
      const cycles = cyclesForBars(rudiment, 2)
      expect(cycles).toBeGreaterThanOrEqual(1)
      const bars = barsOf(rudiment, cycles)
      // Always a whole number of bars, whatever the count.
      expect(Number.isInteger(bars)).toBe(true)
      expect(bars).toBeGreaterThanOrEqual(1)
      // barsOf's own arithmetic must agree with the ticks cyclesForBars picked.
      expect((cycles * rudiment.patternTicks) / BAR_TICKS).toBe(bars)
    }
  })

  it('picks exactly 2 bars when patternTicks divides 2 bars evenly (single-stroke-roll: 960 ticks)', () => {
    const rudiment = RUDIMENTS.find((r) => r.id === 'single-stroke-roll')
    if (rudiment === undefined) throw new Error('fixture missing')
    const cycles = cyclesForBars(rudiment, 2)
    expect(barsOf(rudiment, cycles)).toBe(2)
  })

  it('falls back to the smallest whole-bar span when patternTicks does not divide 2 bars (double-paradiddle: 1440 ticks -> 3 bars)', () => {
    const rudiment = RUDIMENTS.find((r) => r.id === 'double-paradiddle')
    if (rudiment === undefined) throw new Error('fixture missing')
    expect(rudiment.patternTicks).toBe(1440)
    const cycles = cyclesForBars(rudiment, 2)
    expect(barsOf(rudiment, cycles)).toBe(3)
  })

  it('falls back for seventeen-stroke-roll (2400 ticks -> 5 bars)', () => {
    const rudiment = RUDIMENTS.find((r) => r.id === 'seventeen-stroke-roll')
    if (rudiment === undefined) throw new Error('fixture missing')
    expect(rudiment.patternTicks).toBe(2400)
    const cycles = cyclesForBars(rudiment, 2)
    expect(barsOf(rudiment, cycles)).toBe(5)
  })
})

describe('stickingPreview', () => {
  it('reads a paradiddle as its letters, space separated', () => {
    expect(stickingPreview(paradiddle())).toBe('R L R R L R L L')
  })
})

describe('isCleanPass', () => {
  it('is true for a steady run with no missed or extra hits, played evenly', () => {
    expect(isCleanPass(result(), 1)).toBe(true)
    expect(isCleanPass(result(), RUDIMENT_CLEAN_EVENNESS)).toBe(true)
  })

  it('is false when the run was not steady, even with no missed/extra rows', () => {
    expect(isCleanPass(result({ steady: false }), 1)).toBe(false)
  })

  it('is false when any pad missed a hit', () => {
    expect(isCleanPass(result({ pads: [padRow({ missed: 1 })] }), 1)).toBe(false)
  })

  it('is false when any pad played an extra hit', () => {
    expect(isCleanPass(result({ pads: [padRow({ extra: 1 })] }), 1)).toBe(false)
  })

  it('is false when the run was otherwise clean but the strokes were not even enough', () => {
    expect(isCleanPass(result(), RUDIMENT_CLEAN_EVENNESS - 0.01)).toBe(false)
  })
})

describe('evennessText', () => {
  it('reports the percentage and an even-enough verdict at or above the clean bar', () => {
    expect(evennessText(1)).toBe('Evenness 100% — even enough')
    expect(evennessText(RUDIMENT_CLEAN_EVENNESS)).toBe('Evenness 80% — even enough')
  })

  it('reports the percentage and an uneven verdict below the clean bar', () => {
    expect(evennessText(0.5)).toBe('Evenness 50% — uneven: one gap was well off the rest')
  })
})

describe('measuresOnly', () => {
  it('is false for a rudiment with no articulated strokes', () => {
    expect(measuresOnly(paradiddle())).toBe(false)
  })

  it('is true for a rudiment with a flam/drag/buzz articulation', () => {
    const flam = RUDIMENTS.find((r) => r.id === 'flam')
    if (flam === undefined) throw new Error('fixture missing: flam')
    expect(measuresOnly(flam)).toBe(true)
  })
})

describe('ladderText', () => {
  it('reads a fresh ladder as ready, before any run', () => {
    expect(ladderText(ladder({ bpm: 60 }))).toBe('Ready at 60 bpm')
  })

  it('reports progress mid clean-streak, same bpm as the pass just graded', () => {
    const state = ladder({ bpm: 80, cleanStreak: 1, history: [{ bpm: 80, clean: true }] })
    expect(ladderText(state)).toBe('Clean 1 of 2 at 80 bpm')
  })

  it('reports the completed streak and the next bpm once the ladder steps up', () => {
    const state = ladder({
      bpm: 85,
      cleanStreak: 0,
      failStreak: 0,
      history: [
        { bpm: 80, clean: true },
        { bpm: 80, clean: true },
      ],
    })
    expect(ladderText(state)).toBe('Clean 2 of 2 at 80 bpm — next 85')
  })

  it('reports a miss and the tempo it drops to', () => {
    const state = ladder({ bpm: 75, failStreak: 1, history: [{ bpm: 80, clean: false }] })
    expect(ladderText(state)).toBe('Missed 1 of 3 at 80 bpm — next 75')
  })

  it('reports a plateau by reason, at the bpm the streak actually failed at', () => {
    const state = ladder({
      bpm: 70,
      done: true,
      reason: 'plateau',
      history: [
        { bpm: 75, clean: false },
        { bpm: 75, clean: false },
        { bpm: 75, clean: false },
      ],
    })
    expect(ladderText(state)).toBe('Plateau at 75 bpm: 3 failed passes')
  })

  it('reports a ceiling by reason', () => {
    const state = ladder({
      bpm: 200,
      done: true,
      reason: 'ceiling',
      history: [
        { bpm: 200, clean: true },
        { bpm: 200, clean: true },
      ],
    })
    expect(ladderText(state)).toBe('Ceiling at 200 bpm: top tempo held clean')
  })

  it('reports a floor by reason', () => {
    const state = ladder({
      bpm: 40,
      done: true,
      reason: 'floor',
      history: [{ bpm: 40, clean: false }],
    })
    expect(ladderText(state)).toBe('Floor at 40 bpm: cannot drop further')
  })

  it('reports completion by reason, at the bpm the descent finished on', () => {
    const state = ladder({
      bpm: 60,
      done: true,
      reason: 'completed',
      history: [
        { bpm: 60, clean: true },
        { bpm: 60, clean: true },
      ],
    })
    expect(ladderText(state)).toBe('Completed the ladder back down to 60 bpm')
  })
})
