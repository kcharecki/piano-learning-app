/**
 * `useRudimentTrainer` — the ladder/persistence wiring, not the grading rules
 * themselves (those are `@core/drums/rudiment/tempoLadder.ts`'s own tests).
 * What is pinned here: a clean pass advances the ladder and the trainer's own
 * plan follows the new tempo, a failed pass drops it, a personal best lands
 * in `useDrumsRudimentStore`, and changing rudiments resets the ladder.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { FakeClock } from '@test/fakes.ts'
import { rudimentById } from '@content/drums/rudiments.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { Rudiment } from '@core/drums/rudiment/index.ts'
import { RUDIMENT_CLEAN_EVENNESS } from '@core/drums/rudiment/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { useRudimentTrainer, type UseRudimentTrainerOptions } from './useRudimentTrainer.ts'

function manualDriver(): { driver: FrameDriver; pump: () => void } {
  let callback: (() => void) | undefined
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      callback = undefined
    }
  }
  return { driver, pump: () => callback?.() }
}

/** A silent stand-in for the real drum audio port — see `useGrooveRun.test.ts`'s own copy of this idea. */
class SilentDrumAudio implements DrumAudioOutput {
  private readonly clock: Clock
  constructor(clock: Clock) {
    this.clock = clock
  }
  strike(): void {
    // Not exercised here.
  }
  click(): void {
    // Not exercised here.
  }
  allNotesOff(): void {
    // Not exercised here.
  }
  setVolume(): void {
    // Not exercised here.
  }
  now(): Millis {
    return this.clock.now() as Millis
  }
}

function singleStrokeRoll(): Rudiment {
  const rudiment = rudimentById('single-stroke-roll')
  if (rudiment === undefined) throw new Error('fixture missing: single-stroke-roll')
  return rudiment
}

function singleParadiddle(): Rudiment {
  const rudiment = rudimentById('single-paradiddle')
  if (rudiment === undefined) throw new Error('fixture missing: single-paradiddle')
  return rudiment
}

function harness(rudiment: Rudiment) {
  const clock = new FakeClock()
  const audio = new SilentDrumAudio(clock)
  const manual = manualDriver()
  let stamp = 1_700_000_000_000
  const nowStamp = (): number => {
    stamp += 1
    return stamp
  }
  const optionsFor = (props: { rudiment: Rudiment }): UseRudimentTrainerOptions => ({
    rudiment: props.rudiment,
    clock,
    audio: () => audio,
    driver: manual.driver,
    now: nowStamp,
  })
  const view = renderHook(
    (props: { rudiment: Rudiment }) => useRudimentTrainer(optionsFor(props)),
    {
      initialProps: { rudiment },
    },
  )
  return { clock, pump: manual.pump, view, nowStamp }
}

type Harness = ReturnType<typeof harness>

/** Move the clock to `ms` and run one frame there. */
function frameAt(h: Harness, ms: number): void {
  act(() => {
    h.clock.setTime(ms)
    h.pump()
  })
}

/**
 * Drives one full graded run. `clean` hits every expected snare instant
 * exactly on time (a rudiment's whole pattern is on `snare` — see
 * `rudimentToScore`); a failed run plays nothing at all, which the grader
 * marks every instant missed and `totalHits === 0`, so `steady` is false.
 */
function driveRun(h: Harness, clean: boolean): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin)

  if (clean) {
    for (const padPlan of plan.pads) {
      for (const ms of padPlan.expectedMs) {
        act(() => {
          h.clock.setTime(gradedOrigin + ms)
          h.view.result.current.tap()
        })
      }
    }
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

/**
 * Drives one full graded run identically to `driveRun(h, true)`, except the
 * stroke at `shiftIndex` (into the flattened, time-ordered list of expected
 * instants — single-stroke-roll is one pad, so this is just its own
 * `expectedMs`) lands `shiftMs` late. Picked deliberately NOT at either end
 * of the run, so the shift disturbs two adjacent gaps rather than one — see
 * the evenness tests below for the arithmetic this is built to produce.
 */
function driveRunOneStrokeLate(h: Harness, shiftIndex: number, shiftMs: number): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin)

  for (const padPlan of plan.pads) {
    padPlan.expectedMs.forEach((ms, i) => {
      const lateBy = i === shiftIndex ? shiftMs : 0
      act(() => {
        h.clock.setTime(gradedOrigin + ms + lateBy)
        h.view.result.current.tap()
      })
    })
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

beforeEach(() => {
  useDrumsRudimentStore.setState({ records: {} })
})

describe('useRudimentTrainer', () => {
  it('starts the ladder at the rudiment’s own bpmBand.start', () => {
    const h = harness(singleStrokeRoll())
    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.plan.bpm).toBe(60)
  })

  it('advances the ladder — and the trainer’s own plan — after passesToAdvance clean runs, and records the personal best', () => {
    const h = harness(singleStrokeRoll())

    driveRun(h, true)
    expect(h.view.result.current.lastClean).toBe(true)
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.ladder.cleanStreak).toBe(1)
    // Still building the streak — the default passesToAdvance is 2 (tempoLadder.ts).
    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.plan.bpm).toBe(60)

    driveRun(h, true)
    expect(h.view.result.current.lastClean).toBe(true)
    // The streak just completed: bpm steps up by the default 5.
    expect(h.view.result.current.ladder.bpm).toBe(65)
    expect(h.view.result.current.plan.bpm).toBe(65)

    const record = useDrumsRudimentStore.getState().records['single-stroke-roll']
    expect(record?.bestCleanBpm).toBe(60)
  })

  it('drops the ladder by stepBpm on a failed run, without touching bestCleanBpm', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    driveRun(h, false)
    expect(h.view.result.current.lastClean).toBe(false)
    expect(h.view.result.current.ladder.failStreak).toBe(1)
    expect(h.view.result.current.ladder.bpm).toBe(60)

    // The failed run's verdict is still readable after the tempo stepped
    // down: the plan's grooveId does not carry the bpm (see the hook's module
    // comment), so `useGrooveRun` keeps the result, labelled with the bpm it
    // was graded at. A silent run has no evenness evidence, so no score.
    expect(h.view.result.current.run.result?.bpm).toBe(65)
    expect(h.view.result.current.run.result?.result.steady).toBe(false)
    expect(h.view.result.current.lastEvenness).toBeUndefined()

    // The best clean pass is still on record — a later failure never erases it.
    expect(useDrumsRudimentStore.getState().records['single-stroke-roll']?.bestCleanBpm).toBe(60)
  })

  it('resets the ladder when the rudiment changes, even mid-progress', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    act(() => h.view.rerender({ rudiment: singleParadiddle() }))

    // single-paradiddle shares single-stroke-roll's tier-1 band (start 60).
    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.ladder.history).toEqual([])
    expect(h.view.result.current.ladder.bestCleanBpm).toBeUndefined()
    expect(h.view.result.current.lastClean).toBeUndefined()
    expect(h.view.result.current.plan.grooveId).toContain('single-paradiddle')
  })

  it('restart() puts the ladder back to the start, without touching the stored best', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    act(() => h.view.result.current.restart())

    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.ladder.history).toEqual([])
    expect(h.view.result.current.lastEvenness).toBeUndefined()
    expect(useDrumsRudimentStore.getState().records['single-stroke-roll']?.bestCleanBpm).toBe(60)
  })

  it('names the score with the sticking-bearing pad the honesty line cares about', () => {
    const h = harness(singleStrokeRoll())
    const pads = new Set(
      h.view.result.current.score.notes.map((note: { pad: MappedDrumPad }) => note.pad),
    )
    expect(pads).toEqual(new Set(['snare']))
  })
})

describe('useRudimentTrainer — evenness (roadmap DR-10)', () => {
  it('scores lastEvenness from the taps recorded during the graded window', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })

  it('fails the pass on unevenness alone, even when the engine’s own timing verdict stays steady', () => {
    const h = harness(singleStrokeRoll())
    const shiftIndex = 8
    const shiftMs = 80

    // single-stroke-roll at its bpmBand.start (60) is straight sixteenths,
    // 250ms apart. One stroke 80ms late (index 8 — neither end of the run)
    // moves that pad's own spread to roughly 19ms SD, comfortably inside the
    // engine's own ±40ms-SD steady budget (`STEADY_SPREAD_FRACTION` in
    // `@core/drums/practice/grade.ts`). It still breaks two adjacent 250ms
    // gaps to 330ms/170ms, which is well past the evenness axis's own bar
    // (see `evenness.test.ts`'s worked example at the same ~125ms scale) —
    // proving the two axes are independently enforced, not that one implies
    // the other.
    driveRunOneStrokeLate(h, shiftIndex, shiftMs)
    expect(h.view.result.current.run.result?.result.steady).toBe(true)
    expect(h.view.result.current.lastEvenness).toBeLessThan(RUDIMENT_CLEAN_EVENNESS)
    expect(h.view.result.current.lastClean).toBe(false)
  })

  it('ignores taps played during the count-in', () => {
    const h = harness(singleStrokeRoll())
    const startedAt = h.clock.now()
    act(() => h.view.result.current.run.start())

    // A tap while still in the count-in — must not survive into the record.
    act(() => h.view.result.current.tap())

    const plan = h.view.result.current.plan
    const gradedOrigin = startedAt + plan.countInBars * plan.barMs
    frameAt(h, gradedOrigin)

    for (const padPlan of plan.pads) {
      for (const ms of padPlan.expectedMs) {
        act(() => {
          h.clock.setTime(gradedOrigin + ms)
          h.view.result.current.tap()
        })
      }
    }
    frameAt(h, gradedOrigin + plan.gradedMs)

    // Had the count-in tap counted, it would sit far before the pattern's own
    // first onset and wreck the score; instead the run reads perfectly even.
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })

  it('resets the stroke record between runs', () => {
    const h = harness(singleStrokeRoll())
    driveRunOneStrokeLate(h, 8, 80)
    expect(h.view.result.current.lastEvenness).toBeLessThan(RUDIMENT_CLEAN_EVENNESS)

    driveRun(h, true)
    // A clean run right after an uneven one reads as perfectly even — the
    // previous run's taps did not leak into this one's record.
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })
})
