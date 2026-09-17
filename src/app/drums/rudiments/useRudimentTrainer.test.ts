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
  const view = renderHook((props: { rudiment: Rudiment }) => useRudimentTrainer(optionsFor(props)), {
    initialProps: { rudiment },
  })
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
    expect(h.view.result.current.plan.grooveId.startsWith('single-paradiddle@')).toBe(true)
  })

  it('restart() puts the ladder back to the start, without touching the stored best', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    act(() => h.view.result.current.restart())

    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.ladder.history).toEqual([])
    expect(useDrumsRudimentStore.getState().records['single-stroke-roll']?.bestCleanBpm).toBe(60)
  })

  it('names the score with the sticking-bearing pad the honesty line cares about', () => {
    const h = harness(singleStrokeRoll())
    const pads = new Set(h.view.result.current.score.notes.map((note: { pad: MappedDrumPad }) => note.pad))
    expect(pads).toEqual(new Set(['snare']))
  })
})
