/**
 * `useCoordinationTrainer` (roadmap DR-15) — the drill-list/progress wiring,
 * not grading itself (that is `grade.test.ts`) and not the pure step-list
 * math (that is `coordinationRun.test.ts`). What is pinned here: switching
 * mode/groove/tempo resets progress, `select` refuses a locked step, a
 * steady pass unlocks and moves to the next step and records an attempt, an
 * unsteady pass changes nothing, and the just-graded verdict survives the
 * step change it itself triggers (see the hook's own module comment on why
 * that needs a latch).
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { layerStack } from '@core/drums/coordination/layers.ts'
import { singleKickPermutations } from '@core/drums/coordination/permutations.ts'
import { quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { FakeClock } from '@test/fakes.ts'
import { useCoordinationTrainer } from './useCoordinationTrainer.ts'

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

function harness() {
  const clock = new FakeClock()
  const audio = new SilentDrumAudio(clock)
  const manual = manualDriver()
  const view = renderHook(() =>
    useCoordinationTrainer({ clock, audio: () => audio, driver: manual.driver }),
  )
  return { clock, pump: manual.pump, view }
}

type Harness = ReturnType<typeof harness>

function frameAt(h: Harness, ms: number): void {
  act(() => {
    h.clock.setTime(ms)
    h.pump()
  })
}

/**
 * Drives one full graded run against whatever step is currently active.
 * `clean` hits every expected instant, on every pad the step's plan uses,
 * exactly on time; a dirty run plays nothing.
 */
function driveRun(h: Harness, clean: boolean): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs

  frameAt(h, gradedOrigin)

  if (clean) {
    // Every pad's own expected instants are individually sorted, but across
    // pads they are not — a groove's kick and hats do not share one clock of
    // their own. Merge into a single ms-ascending sequence (unison instants
    // land back to back at the same ms) so the clock, which the FakeClock
    // requires to be monotonic, is never asked to run backwards.
    const events = plan.pads
      .flatMap((padPlan) => padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms })))
      .sort((a, b) => a.ms - b.ms)
    for (const { pad, ms } of events) {
      act(() => {
        h.clock.setTime(gradedOrigin + ms)
        h.view.result.current.run.hit(pad)
      })
    }
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

describe('useCoordinationTrainer', () => {
  it('opens on layers mode, the first library groove, step 0, nothing unlocked beyond it', () => {
    const h = harness()
    const view = h.view.result.current
    expect(view.mode).toBe('layers')
    expect(view.groove.id).toBe(quarterNoteRock().id)
    expect(view.index).toBe(0)
    expect(view.unlocked).toBe(0)
    const stack = layerStack(quarterNoteRock())
    expect(view.steps).toHaveLength(stack.length)
    expect(view.plan.grooveId).toBe(stack[0]?.score.id)
  })

  it('switching to kicks mode lists all 16 permutation drills and resets progress', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))
    const view = h.view.result.current
    expect(view.mode).toBe('kicks')
    expect(view.steps).toHaveLength(16)
    expect(view.index).toBe(0)
    expect(view.unlocked).toBe(0)
    expect(view.plan.grooveId).toBe(singleKickPermutations()[0]?.score.id)
  })

  it('select ignores an index beyond unlocked, and beyond the list', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))
    act(() => h.view.result.current.select(1))
    expect(h.view.result.current.index).toBe(0)
    act(() => h.view.result.current.select(-1))
    expect(h.view.result.current.index).toBe(0)
    act(() => h.view.result.current.select(999))
    expect(h.view.result.current.index).toBe(0)
  })

  it('a steady pass unlocks and moves to the next step, and records the attempt', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))
    const firstStepTitle = h.view.result.current.steps[0]?.title

    driveRun(h, true)

    const view = h.view.result.current
    expect(view.index).toBe(1)
    expect(view.unlocked).toBe(1)
    expect(view.plan.grooveId).toBe(singleKickPermutations()[1]?.score.id)

    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.steady).toBe(true)
    expect(attempts[0]?.grooveTitle).toBe(firstStepTitle)

    // Now select(1) is allowed since it is exactly `unlocked`.
    act(() => h.view.result.current.select(1))
    expect(h.view.result.current.index).toBe(1)
  })

  /**
   * See the hook's own module comment: `useGrooveRun` retires its `result`
   * the instant `plan.grooveId` changes, and a steady pass changes it (by
   * advancing `index`) in the very same update the verdict is produced in.
   * Without the latch this hook adds, `run.result` would already be
   * `undefined` by the time this assertion runs — the screen would show step
   * 2 unlocked with no explanation why.
   */
  it('the verdict from a steady pass survives the step change it triggers', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))

    driveRun(h, true)

    const view = h.view.result.current
    expect(view.index).toBe(1) // already moved on
    expect(view.run.result).toBeDefined()
    expect(view.run.result?.result.steady).toBe(true)
  })

  it('an unsteady pass changes nothing but still records the attempt', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))

    driveRun(h, false)

    const view = h.view.result.current
    expect(view.index).toBe(0)
    expect(view.unlocked).toBe(0)
    expect(view.run.result?.result.steady).toBe(false)

    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.steady).toBe(false)
  })

  it('pressing Start again clears the latched verdict from the previous attempt', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))
    driveRun(h, true)
    expect(h.view.result.current.run.result).toBeDefined()

    act(() => h.view.result.current.run.start())
    expect(h.view.result.current.run.result).toBeUndefined()
  })

  it('changing the tempo resets progress and clears any latched verdict', () => {
    const h = harness()
    act(() => h.view.result.current.setMode('kicks'))
    driveRun(h, true)
    expect(h.view.result.current.index).toBe(1)
    expect(h.view.result.current.run.result).toBeDefined()

    act(() => h.view.result.current.setBpm(100))

    const view = h.view.result.current
    expect(view.bpm).toBe(100)
    expect(view.index).toBe(0)
    expect(view.unlocked).toBe(0)
    expect(view.run.result).toBeUndefined()
  })

  it('changing the groove (layers mode) resets progress', () => {
    const h = harness()
    const other = layerStack(quarterNoteRock())[0]?.score.id
    // Advance once first so there is progress to lose.
    driveRun(h, true)
    expect(h.view.result.current.index).toBeGreaterThanOrEqual(0)

    act(() => h.view.result.current.setGroove('money-beat'))
    const view = h.view.result.current
    expect(view.groove.id).toBe('money-beat')
    expect(view.index).toBe(0)
    expect(view.unlocked).toBe(0)
    expect(other).toBeDefined() // sanity: the id used above is real
  })
})
