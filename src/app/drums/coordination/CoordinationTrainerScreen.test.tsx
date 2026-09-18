/**
 * `CoordinationTrainerScreen` — thin, per the testing rules: what is
 * asserted here is wiring and accessible names (mode switch lists the right
 * steps, a locked step is disabled, a steady run unlocks and moves the
 * active step), not grading (`grade.test.ts`) and not the progress math
 * (`coordinationRun.test.ts`, `useCoordinationTrainer.test.ts`).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { LOCAL_INPUT_ID, useDrumsLatencyStore } from '@app/state/drumsLatencyStore.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import { midi, millis } from '@core/shared/units.ts'
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

function setup(opts: { readonly midiInput?: FakeMidiInput } = {}) {
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
  render(
    <CoordinationTrainerScreen
      clock={clock}
      audio={() => audio}
      frameDriver={frameDriver}
      {...(opts.midiInput === undefined ? {} : { midiInput: opts.midiInput })}
    />,
  )
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
  useDrumsLatencyStore.setState({ offsets: {} })
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

  // F8: a swung run (Jazz ride) delays every off-beat instant against the
  // click by design; without a cue in the header, a learner reads that as
  // drift rather than the notated feel. Kills the mutant of no swing badge
  // ever rendering, and the mutant of it rendering unconditionally (present
  // even on a straight drill).
  //
  // A5: also asserts the badge sits inside `.page-header-actions`, not just
  // that its text is present — before the fix it was a third direct child
  // of `.page-header` (a flex row, space-between), which pushed the
  // subtitle to the middle of the header instead of leaving it beside the
  // title.
  it('shows a "Swing 67%" badge for Jazz ride, inside .page-header-actions, and no swing badge on the default (straight) Layer build drill', async () => {
    const { user } = setup()
    expect(screen.queryByText(/Swing \d+%/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Jazz ride' }))
    const badge = screen.getByText('Swing 67%')
    expect(badge).toBeInTheDocument()
    expect(badge.closest('.page-header-actions')).not.toBeNull()
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

  it('switching to Hi-hat foot lists 3 steps for the default groove, keeps the groove picker, and only the first is unlocked', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('radio', { name: 'Hi-hat foot' }))

    expect(screen.getByRole('combobox', { name: 'Groove' })).toBeInTheDocument()

    const stepsList = screen.getByRole('list', { name: 'Steps' })
    const items = stepsList.querySelectorAll('li')
    expect(items).toHaveLength(3)

    const stepListButtons = within(stepsList).getAllByRole('button')
    expect(stepListButtons.map((b) => b.textContent)).toEqual([
      'Quarter-Note Rock — ride and foot on 2 and 4',
      'Quarter-Note Rock — add the kick',
      'Quarter-Note Rock — add the snare',
    ])
    expect(stepListButtons[0]).not.toBeDisabled()
    expect(stepListButtons[0]).toHaveAttribute('aria-current', 'step')
    expect(stepListButtons[1]).toBeDisabled()

    expect(screen.getByRole('button', { name: 'Ride' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hi-hat pedal' })).toBeInTheDocument()
  })

  it('offers Hi-hat openings, keeps the groove picker, and shows the empty state for the default groove (no hat on an "&")', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('radio', { name: 'Hi-hat openings' }))

    expect(screen.getByRole('radio', { name: 'Hi-hat openings' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: 'Groove' })).toBeInTheDocument()

    expect(screen.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Drill steps' })).toHaveTextContent(
      'No hi-hat on an "&" in this groove — pick an eighth-note groove.',
    )
    // Nothing to drill: no staff, and Start cannot run the raw groove.
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('Hi-hat openings lists 3 steps once a groove with an "&" hat is picked', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('radio', { name: 'Hi-hat openings' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Groove' }), 'Money Beat')

    expect(screen.queryByRole('status', { name: 'Drill steps' })).not.toBeInTheDocument()
    const stepsList = screen.getByRole('list', { name: 'Steps' })
    const stepListButtons = within(stepsList).getAllByRole('button')
    expect(stepListButtons.map((b) => b.textContent)).toEqual([
      'Money Beat — open on the & of 4',
      'Money Beat — open on the & of 2 and 4',
      'Money Beat — open on every &',
    ])
    expect(stepListButtons[0]).not.toBeDisabled()
    expect(stepListButtons[0]).toHaveAttribute('aria-current', 'step')
    expect(stepListButtons[1]).toBeDisabled()
    expect(stepListButtons[2]).toBeDisabled()
  })

  it('hides the groove picker in kicks mode', async () => {
    const { user } = setup()
    expect(screen.getByRole('combobox', { name: 'Groove' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Kick permutations' }))
    expect(screen.queryByRole('combobox', { name: 'Groove' })).not.toBeInTheDocument()
  })

  it('switching to Two kicks lists 12 steps with only the first unlocked, and hides the groove picker', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('radio', { name: 'Two kicks' }))

    expect(screen.getByRole('radio', { name: 'Two kicks' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('combobox', { name: 'Groove' })).not.toBeInTheDocument()

    const stepsList = screen.getByRole('list', { name: 'Steps' })
    const items = stepsList.querySelectorAll('li')
    expect(items).toHaveLength(12)

    const stepListButtons = within(stepsList).getAllByRole('button')
    expect(stepListButtons[0]).not.toBeDisabled()
    expect(stepListButtons[0]).toHaveAttribute('aria-current', 'step')
    expect(stepListButtons[1]).toBeDisabled()
    stepListButtons.forEach((button) => expect(button.textContent ?? '').toMatch(/^Kick on \S+ and \S+$/))
    const labels = stepListButtons.map((button) => button.textContent ?? '')
    expect(new Set(labels).size).toBe(12)
  })

  it('switching to Jazz ride lists the six fixed steps with only the first unlocked, and hides the groove picker', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('radio', { name: 'Jazz ride' }))

    expect(screen.getByRole('radio', { name: 'Jazz ride' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('combobox', { name: 'Groove' })).not.toBeInTheDocument()

    const stepsList = screen.getByRole('list', { name: 'Steps' })
    const stepListButtons = within(stepsList).getAllByRole('button')
    expect(stepListButtons.map((b) => b.textContent)).toEqual([
      'Jazz ride — ride alone',
      'Jazz ride — ride and hi-hat foot',
      'Jazz ride — comp on the & of 2',
      'Jazz ride — comp on 4',
      'Jazz ride — comp on the & of 1 and the & of 3',
      'Jazz ride — comp on 2 and the & of 4',
    ])
    expect(stepListButtons[0]).not.toBeDisabled()
    expect(stepListButtons[0]).toHaveAttribute('aria-current', 'step')
    expect(stepListButtons[1]).toBeDisabled()
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

  it('names a connected e-kit, and a real stroke lights the pad like a tap (roadmap DR-02)', async () => {
    const kit = new FakeMidiInput()
    const { user, clock, frameAt } = setup({ midiInput: kit })
    const name = kit.listDevices()[0]?.name ?? ''
    expect(screen.getByRole('status', { name: 'E-kit' })).toHaveTextContent(
      `E-kit: ${name} · General MIDI map`,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    expect(runState()).toMatch(/^Playing/)

    // Layer 1 of the default groove is hi-hat only; GM 42 = closed hi-hat.
    clock.setTime(BAR_MS)
    act(() => {
      kit.emit({ type: 'noteOn', note: midi(42), velocity: 100, time: millis(clock.now()) })
    })
    expect(screen.getByRole('button', { name: 'Hi-hat' })).toHaveAttribute('data-lit', 'true')
  })

  /**
   * DR-08 latency calibration, wired at the screen level: `useCoordinationTrainer`
   * reads the stored offset for the local input (`LOCAL_INPUT_ID`) and passes
   * it through as `inputOffsetMs`, the same option `useGrooveRun.test.ts`
   * proves subtracts a constant offset from every hit before grading. This
   * screen has no per-hit "Last hit" line (unlike `GrooveTrainerScreen`), so
   * the observable is the per-pad summary in the finished `Result` region
   * (`resultLines.ts`'s `offsetPhrase` — pure and unit-tested on its own):
   * a kick struck a real 40ms late reads "40 ms late" with nothing on record,
   * and "dead on" once a 40ms offset is stored, because `hit()` subtracts it
   * from the clock reading before the stroke is ever handed to the grader.
   */
  describe('DR-08 latency calibration', () => {
    /** Same choreography as "a steady run unlocks step 2" above, but every kick lands 40ms late. */
    async function runWithLateKick(): Promise<{ result: HTMLElement }> {
      const { user, clock, frameAt } = setup()
      await user.click(screen.getByRole('radio', { name: 'Kick permutations' }))
      await user.click(screen.getByRole('button', { name: 'Start' }))
      frameAt(BAR_MS)

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
      // Both kick instants land a real 40ms after the grid, uncorrected.
      const kickMs = [0 + 40, 3000 + 40]
      const strokes: readonly [HTMLElement, number][] = [
        ...hatMs.map((ms): [HTMLElement, number] => [hat, ms]),
        ...snareMs.map((ms): [HTMLElement, number] => [snare, ms]),
        ...kickMs.map((ms): [HTMLElement, number] => [kick, ms]),
      ].sort((a, b) => a[1] - b[1])
      for (const [button, ms] of strokes) hitAt(button, ms)

      frameAt(BAR_MS + GRADED_MS)
      return { result: screen.getByRole('region', { name: 'Result' }) }
    }

    it('reads the late kick as "40 ms late" with no offset on record', async () => {
      const { result } = await runWithLateKick()
      expect(result.textContent ?? '').toMatch(/Kick — 2 of 2, 40 ms late/)
    })

    it('a stored offset for the local input corrects the same late kick to "dead on"', async () => {
      useDrumsLatencyStore
        .getState()
        .setOffset(LOCAL_INPUT_ID, { offsetMs: 40, spreadMs: 2, samples: 16, at: 0 })
      const { result } = await runWithLateKick()
      expect(result.textContent ?? '').toMatch(/Kick — 2 of 2, dead on/)
    })
  })
})
