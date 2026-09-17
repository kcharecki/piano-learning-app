/**
 * `metronomeRun.ts` — the pure arithmetic behind the drums metronome's run
 * loop, pinned with examples plus property tests for the pieces with a
 * genuine invariant (roadmap DR-12 adversarial-review follow-up).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TempoMark } from '@core/notation/score.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { bpm, ticks } from '@core/shared/units.ts'
import {
  appendTempoMark,
  barCrossingRange,
  nextRampBarAfter,
  resolveRampStep,
  returnWindowMs,
  tickToBarBeat,
  type RampConfig,
} from './metronomeRun.ts'

const BAR_TICKS = 1920 // 4/4 at 480 ticks/quarter
const BEAT_TICKS = 480

describe('nextRampBarAfter', () => {
  it('is the next multiple of everyBars strictly after bar, floored at one full cycle', () => {
    // A cursor of -1 means "no bar has played yet" (the pre-`start()` seed) —
    // the first step is always due at bar `everyBars`, never bar 0: "every N
    // bars" fires after N bars have played, not before the first has.
    expect(nextRampBarAfter(-1, 1)).toBe(1)
    expect(nextRampBarAfter(0, 1)).toBe(1)
    expect(nextRampBarAfter(0, 4)).toBe(4)
    expect(nextRampBarAfter(4, 4)).toBe(8)
    expect(nextRampBarAfter(5, 4)).toBe(8)
  })

  it('property: result is a positive multiple of everyBars, strictly greater than bar, and minimal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 64 }),
        (bar, everyBars) => {
          const result = nextRampBarAfter(bar, everyBars)
          expect(result % everyBars).toBe(0)
          expect(result).toBeGreaterThan(bar)
          expect(result).toBeGreaterThanOrEqual(everyBars)
          // Minimality only applies once `bar` is far enough along that a
          // multiple of `everyBars` between it and `everyBars` itself could
          // exist; below that, the floor at one full cycle IS the minimum.
          if (bar >= 0) expect(result - everyBars).toBeLessThanOrEqual(bar)
          else expect(result).toBe(everyBars)
        },
      ),
    )
  })
})

describe('appendTempoMark', () => {
  it('appendTempoMark replaces a mark on an equal tick and keeps the rest', () => {
    const marks = [
      { tick: ticks(0), bpm: bpm(100) },
      { tick: ticks(BAR_TICKS), bpm: bpm(110) },
    ]
    const out = appendTempoMark(marks, BAR_TICKS, bpm(120))
    expect(out).toEqual([
      { tick: ticks(0), bpm: bpm(100) },
      { tick: ticks(BAR_TICKS), bpm: bpm(120) },
    ])
  })

  it('property: appending a mark at or past the scheduling edge re-times no tick before that edge', () => {
    // The hook places every manual mark at `scheduledTickRef` — the far edge of
    // what has already been dispatched — so this is the invariant that keeps
    // dispatched clicks and the elapsed-time readout consistent with the map.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            gap: fc.integer({ min: 1, max: 4000 }),
            bpm: fc.integer({ min: 40, max: 240 }),
          }),
          {
            minLength: 1,
            maxLength: 6,
          },
        ),
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 40, max: 240 }),
        (steps, edgeGap, newBpm) => {
          let tick = 0
          const marks = steps.map((s, i) => {
            tick += i === 0 ? 0 : s.gap
            return { tick: ticks(tick), bpm: bpm(s.bpm) }
          })
          const edge = tick + edgeGap
          const before = makeTempoMap(marks)
          const after = makeTempoMap(appendTempoMark(marks, edge, bpm(newBpm)))
          for (let probe = 0; probe <= edge; probe += Math.max(1, Math.floor(edge / 16))) {
            expect(tickToMs(after, ticks(probe))).toBe(tickToMs(before, ticks(probe)))
          }
          expect(tickToMs(after, ticks(edge))).toBe(tickToMs(before, ticks(edge)))
        },
      ),
    )
  })
})

describe('resolveRampStep', () => {
  const ramp: RampConfig = { stepBpm: 5, everyBars: 1, targetBpm: 70 }

  it('is undefined while cursorBar is still ahead of the window', () => {
    const marks = [{ tick: ticks(0), bpm: bpm(60) }]
    expect(resolveRampStep(marks, bpm(60), ramp, 3, 1, BAR_TICKS)).toBeUndefined()
  })

  it('appends one mark and advances the cursor when a step is due', () => {
    const marks = [{ tick: ticks(0), bpm: bpm(60) }]
    const step = resolveRampStep(marks, bpm(60), ramp, 1, 1, BAR_TICKS)
    expect(step).toEqual({
      marks: [
        { tick: ticks(0), bpm: bpm(60) },
        { tick: ticks(BAR_TICKS), bpm: bpm(65) },
      ],
      bpm: bpm(65),
      nextCursor: 2,
    })
  })

  it('holds at targetBpm once reached, still advancing the cursor', () => {
    const marks = [{ tick: ticks(0), bpm: bpm(70) }]
    const step = resolveRampStep(marks, bpm(70), ramp, 1, 1, BAR_TICKS)
    expect(step).toEqual({ marks, bpm: bpm(70), nextCursor: 2 })
  })

  it('steps a downward ramp toward targetBpm by stepBpm too', () => {
    const downRamp: RampConfig = { stepBpm: 5, everyBars: 1, targetBpm: 50 }
    const marks = [{ tick: ticks(0), bpm: bpm(60) }]
    const step = resolveRampStep(marks, bpm(60), downRamp, 1, 1, BAR_TICKS)
    expect(step?.bpm).toBe(bpm(55))
  })

  it('property: repeated resolution reaches and holds at targetBpm, monotonically toward it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 40, max: 240 }),
        fc.integer({ min: 40, max: 240 }),
        fc.integer({ min: 1, max: 20 }),
        (startBpm, targetBpm, stepBpm) => {
          const cfg: RampConfig = { stepBpm, everyBars: 1, targetBpm }
          let marks: readonly TempoMark[] = [{ tick: ticks(0), bpm: bpm(startBpm) }]
          let current = bpm(startBpm)
          let cursor = 0
          const goingUp = targetBpm >= startBpm
          for (let bar = 0; bar < 500; bar++) {
            const step = resolveRampStep(marks, current, cfg, cursor, bar, BAR_TICKS)
            if (step === undefined) continue
            // Never overshoots the target in either direction.
            if (goingUp) expect(step.bpm).toBeLessThanOrEqual(targetBpm)
            else expect(step.bpm).toBeGreaterThanOrEqual(targetBpm)
            marks = step.marks
            current = step.bpm
            cursor = step.nextCursor
            if (current === targetBpm) break
          }
          expect(current).toBe(targetBpm)
        },
      ),
    )
  })
})

describe('barCrossingRange', () => {
  it('is the bars whose downbeat lies in (prevTick, newTick]', () => {
    expect(barCrossingRange(0, BAR_TICKS, BAR_TICKS)).toEqual({ from: 1, to: 1 })
    expect(barCrossingRange(0, BAR_TICKS - 1, BAR_TICKS)).toEqual({ from: 1, to: 0 }) // empty: to < from
    expect(barCrossingRange(BAR_TICKS, 3 * BAR_TICKS, BAR_TICKS)).toEqual({ from: 2, to: 3 })
  })

  it('property: the range spans exactly floor(new/bar) - floor(prev/bar) bars', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (a, b) => {
          const prevTick = Math.min(a, b)
          const newTick = Math.max(a, b)
          const { from, to } = barCrossingRange(prevTick, newTick, BAR_TICKS)
          const expectedCount = Math.floor(newTick / BAR_TICKS) - Math.floor(prevTick / BAR_TICKS)
          expect(Math.max(0, to - from + 1)).toBe(expectedCount)
        },
      ),
    )
  })
})

describe('tickToBarBeat', () => {
  it('decomposes ticks into 0-based bar and beat', () => {
    expect(tickToBarBeat(0, BAR_TICKS, BEAT_TICKS)).toEqual({ bar: 0, beat: 0 })
    expect(tickToBarBeat(BEAT_TICKS, BAR_TICKS, BEAT_TICKS)).toEqual({ bar: 0, beat: 1 })
    expect(tickToBarBeat(BAR_TICKS, BAR_TICKS, BEAT_TICKS)).toEqual({ bar: 1, beat: 0 })
    expect(tickToBarBeat(BAR_TICKS + 2 * BEAT_TICKS, BAR_TICKS, BEAT_TICKS)).toEqual({
      bar: 1,
      beat: 2,
    })
  })

  it('property: beat is always within [0, beatsPerBar) and reconstructs the tick', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (tick) => {
        const { bar, beat } = tickToBarBeat(tick, BAR_TICKS, BEAT_TICKS)
        const beatsPerBar = BAR_TICKS / BEAT_TICKS
        expect(beat).toBeGreaterThanOrEqual(0)
        expect(beat).toBeLessThan(beatsPerBar)
        expect(bar * BAR_TICKS + beat * BEAT_TICKS).toBeLessThanOrEqual(tick)
        expect(bar * BAR_TICKS + (beat + 1) * BEAT_TICKS).toBeGreaterThan(tick)
      }),
    )
  })
})

describe('returnWindowMs', () => {
  it('is half a beat at the map bpm in force over that bar', () => {
    const map = makeTempoMap([{ tick: ticks(0), bpm: bpm(120) }]) // beat = 500ms
    expect(returnWindowMs(map, 0, BAR_TICKS, BEAT_TICKS)).toBe(250)
    expect(returnWindowMs(map, 3, BAR_TICKS, BEAT_TICKS)).toBe(250)
  })

  it('reflects the tempo actually in force at that bar across a ramp', () => {
    const map = makeTempoMap([
      { tick: ticks(0), bpm: bpm(60) }, // beat = 1000ms -> window 500ms
      { tick: ticks(BAR_TICKS), bpm: bpm(120) }, // beat = 500ms -> window 250ms
    ])
    expect(returnWindowMs(map, 0, BAR_TICKS, BEAT_TICKS)).toBe(500)
    expect(returnWindowMs(map, 1, BAR_TICKS, BEAT_TICKS)).toBe(250)
  })

  it('property: is always non-negative and half the elapsed ms of one beat', () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 240 }), fc.integer({ min: 0, max: 50 }), (b, bar) => {
        const map = makeTempoMap([{ tick: ticks(0), bpm: bpm(b) }])
        const window = returnWindowMs(map, bar, BAR_TICKS, BEAT_TICKS)
        expect(window).toBeGreaterThan(0)
        expect(window).toBeCloseTo(60_000 / b / 2, 5)
      }),
    )
  })
})
