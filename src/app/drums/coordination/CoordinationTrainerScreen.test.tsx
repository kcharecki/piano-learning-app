/**
 * `CoordinationTrainerScreen` — thin, per the testing rules: what is
 * asserted here is wiring and accessible names (mode switch lists the right
 * steps, a locked step is disabled, a steady run unlocks and moves the
 * active step), not grading (`grade.test.ts`) and not the progress math
 * (`coordinationRun.test.ts`, `useCoordinationTrainer.test.ts`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { FakeClock } from '@test/fakes.ts'
import { CoordinationTrainerScreen } from './CoordinationTrainerScreen.tsx'

/** One bar of count-in, two graded, at the trainer's default 80 bpm — same shape `GrooveTrainerScreen.test.tsx` uses. */
const BAR_MS = 3000
const GRADED_MS = 6000

function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup() {
  const clock = new FakeClock()
  const audio = fakeDrumAudio(clock)
  let frame: (() => void) | undefined
  const frameDriver: FrameDriver = (cb) => {
    frame = cb
    return () => {
      frame = undefined
    }
  }
  const user = userEvent.setup()
  render(<CoordinationTrainerScreen clock={clock} audio={() => audio} frameDriver={frameDriver} />)
  return {
    user,
    clock,
    frameAt: (ms: number) =>
      act(() => {
        clock.setTime(ms)
        frame?.()
      }),
  }
}

function runState(): string {
  return screen.getByRole('status', { name: 'Run state' }).textContent ?? ''
}

function stepButtons(): HTMLElement[] {
  return screen.getAllByRole('listitem').map((li) => li.querySelector('button')) as HTMLElement[]
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

describe('CoordinationTrainerScreen', () => {
  it('opens on Layer build, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Coordination' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Layer build' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(runState()).toBe('Ready when you are')
  })

  it('switching to Kick permutations lists 16 steps with only the first unlocked', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('radio', { name: 'Kick permutations' }))

    const steps = screen.getByRole('list', { name: 'Steps' })
    const items = steps.querySelectorAll('li')
    expect(items).toHaveLength(16)

    const buttons = stepButtons()
    expect(buttons[0]).not.toBeDisabled()
    expect(buttons[0]).toHaveAttribute('aria-current', 'step')
    expect(buttons[1]).toBeDisabled()
  })

  it('hides the groove picker in kicks mode', async () => {
    const { user } = setup()
    expect(screen.getByRole('combobox', { name: 'Groove' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Kick permutations' }))
    expect(screen.queryByRole('combobox', { name: 'Groove' })).not.toBeInTheDocument()
  })

  it('an unsteady pass (nothing played) does not unlock step 2', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('radio', { name: 'Kick permutations' }))

    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    expect(runState()).toBe('Playing — bar 1 of 2')
    frameAt(BAR_MS + GRADED_MS)

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Not steady yet — try again')).toBeInTheDocument()

    const buttons = stepButtons()
    expect(buttons[0]).toHaveAttribute('aria-current', 'step')
    expect(buttons[1]).toBeDisabled()
  })

  /**
   * The first kick-permutation drill is eighth-note hats (every 375 ms),
   * snare on beats 2 & 4 (750/2250 ms into each bar), and the kick on slot 0
   * (0 ms into each bar) — two bars graded at 80 bpm, so every instant
   * repeats once more 3000 ms later. `Pad` dispatches on `pointerdown`, the
   * same event a drum stroke actually is (see `GrooveControls.tsx`).
   */
  it('a steady run unlocks step 2 and moves aria-current to it', async () => {
    const { user, clock, frameAt } = setup()
    await user.click(screen.getByRole('radio', { name: 'Kick permutations' }))

    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    expect(runState()).toBe('Playing — bar 1 of 2')

    const hat = screen.getByRole('button', { name: 'Hi-hat' })
    const snare = screen.getByRole('button', { name: 'Snare' })
    const kick = screen.getByRole('button', { name: 'Kick' })

    function hitAt(button: HTMLElement, ms: number): void {
      act(() => {
        clock.setTime(BAR_MS + ms)
        fireEvent.pointerDown(button)
      })
    }

    const hatMs = [
      0, 375, 750, 1125, 1500, 1875, 2250, 2625, 3000, 3375, 3750, 4125, 4500, 4875, 5250, 5625,
    ]
    const snareMs = [750, 2250, 3750, 5250]
    const kickMs = [0, 3000]
    // Merge into one ms-ascending sequence — `hitAt` drives the FakeClock
    // forward, which rejects going backwards, and playing each pad's own
    // instants start-to-finish before moving to the next pad would do
    // exactly that (the kick's 0 ms instant would arrive after the hats'
    // 5625 ms one).
    const strokes: readonly [HTMLElement, number][] = [
      ...hatMs.map((ms): [HTMLElement, number] => [hat, ms]),
      ...snareMs.map((ms): [HTMLElement, number] => [snare, ms]),
      ...kickMs.map((ms): [HTMLElement, number] => [kick, ms]),
    ].sort((a, b) => a[1] - b[1])
    for (const [button, ms] of strokes) hitAt(button, ms)

    frameAt(BAR_MS + GRADED_MS)

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Steady — next step unlocked')).toBeInTheDocument()

    const buttons = stepButtons()
    expect(buttons[1]).not.toBeDisabled()
    expect(buttons[1]).toHaveAttribute('aria-current', 'step')
    expect(buttons[0]).not.toHaveAttribute('aria-current', 'step')

    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.steady).toBe(true)
  })
})
