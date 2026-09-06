/**
 * `GrooveTrainerScreen` — thin, per the testing rules: what is asserted here
 * is wiring and accessible names, not grading (that is `grade.test.ts`) and
 * not timing (that is `useGrooveRun.test.ts`).
 *
 * The exception is the Space key. Its phase gate (T.17.4) is a screen-level
 * rule, it has no home in core, and getting it wrong is silent: the learner
 * starts with the mouse, Start keeps focus, and their first kick presses Stop.
 * Both directions of that gate are pinned below.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { GrooveTrainerScreen } from './GrooveTrainerScreen.tsx'

/** The money beat's shape at 80 bpm — one bar of count-in, two graded. */
const BAR_MS = 3000
const GRADED_MS = 6000

function setup() {
  const clock = new FakeClock()
  const audio = new RecordingAudioOutput(clock)
  let frame: (() => void) | undefined
  const frameDriver: FrameDriver = (cb) => {
    frame = cb
    return () => {
      frame = undefined
    }
  }
  const user = userEvent.setup()
  render(<GrooveTrainerScreen clock={clock} audio={() => audio} frameDriver={frameDriver} />)
  return {
    user,
    clock,
    audio,
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

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

describe('GrooveTrainerScreen', () => {
  it('opens on the easiest groove, at the persona’s goal tempo, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Groove trainer' })).toBeInTheDocument()
    expect(screen.getByText('Quarter-Note Rock')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(80)
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(runState()).toBe('Ready when you are')
  })

  it('steps through the library and shows the pads the chosen groove actually uses', async () => {
    const { user } = setup()
    expect(screen.queryByRole('button', { name: 'Open hi-hat' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    expect(screen.getByText('Money Beat')).toBeInTheDocument()
    for (const pad of ['Hi-hat', 'Snare', 'Kick']) {
      expect(screen.getByRole('button', { name: pad })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Open hi-hat' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    expect(screen.getByText('Money Beat (Open Hat)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open hi-hat' })).toBeInTheDocument()
  })

  it('says what the keys are, because the persona has no kit', () => {
    setup()
    expect(screen.getByText(/J is the hi-hat/)).toBeInTheDocument()
    expect(screen.getByText(/Space the kick/)).toBeInTheDocument()
  })

  it('states the tolerance on screen rather than burying it in the grader', () => {
    setup()
    expect(screen.getByText(/within 100 ms/)).toBeInTheDocument()
  })

  /** T.17.4, the outward half: outside a run, Space belongs to whatever has focus. */
  it('lets Space activate the focused control when no run is on', async () => {
    const { user } = setup()
    screen.getByRole('button', { name: 'Start' }).focus()
    await user.keyboard(' ')

    expect(runState().startsWith('Counting in')).toBe(true)
    expect(screen.getByRole('button', { name: 'Kick' })).not.toHaveAttribute('data-lit')
  })

  /** T.17.4, the inward half: once a run is on, Space is the kick and Stop cannot steal it. */
  it('takes Space for the kick while a run is on, without stopping the run', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(runState().startsWith('Counting in')).toBe(true)

    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Kick' })).toHaveAttribute('data-lit', 'true')
    expect(runState().startsWith('Counting in')).toBe(true)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('plays the letter-key pads too, and ignores keys typed into the tempo field', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    await user.keyboard('f')
    expect(screen.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-lit', 'true')

    await user.clear(screen.getByRole('spinbutton', { name: /tempo/i }))
    await user.type(screen.getByRole('spinbutton', { name: /tempo/i }), '70')
    expect(screen.getByRole('button', { name: 'Hi-hat' })).not.toHaveAttribute('data-lit')
  })

  it('retunes the whole run when the tempo changes', async () => {
    const { user } = setup()
    const tempo = screen.getByRole('spinbutton', { name: /tempo/i })
    await user.clear(tempo)
    await user.type(tempo, '70{Enter}')
    expect(screen.getByText(/at 70 bpm/)).toBeInTheDocument()
  })

  it('shows no result region until a run has actually finished', () => {
    setup()
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()
  })

  it('grades a finished run per pad and records it as the last attempt', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Next groove' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))

    frameAt(BAR_MS)
    expect(runState()).toBe('Playing — bar 1 of 2')
    frameAt(BAR_MS + GRADED_MS)

    const result = screen.getByRole('region', { name: 'Result' })
    expect(result).toBeInTheDocument()
    // Nothing was played, so every limb is missing and the verdict says so —
    // it must not read as a pass just because no wrong note was struck.
    expect(screen.getByText('Not there yet')).toBeInTheDocument()
    expect(screen.getByText('Hi-hat — 0 of 16, 16 missed')).toBeInTheDocument()
    expect(screen.getByText(/Nothing registered/)).toBeInTheDocument()

    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.grooveTitle).toBe('Money Beat')
    expect(attempts[0]?.bpm).toBe(80)
    expect(attempts[0]?.steady).toBe(false)
    // The stale summary of the PREVIOUS session gives way to this run, so the
    // screen never carries two verdicts at once.
    expect(screen.queryByText(/^Last run:/)).not.toBeInTheDocument()
  })

  /**
   * The other side of that: a learner arriving with history and no run of their
   * own sees what they last played, named and dated by tempo rather than a bare
   * "you have practised before".
   */
  it('greets a returning learner with the run they actually last played', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 92,
          at: 1_700_000_000_000,
          steady: true,
        },
      ],
    })
    setup()
    expect(screen.getByText('Last run: Money Beat at 92 bpm — steady')).toBeInTheDocument()
  })

  it('says where every millisecond figure came from, next to the figures', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS + GRADED_MS)
    expect(
      screen.getByRole('region', { name: 'Result' }).textContent ?? '',
    ).toMatch(/keyboard and speakers/)
  })

  /**
   * The Rival-seat MAJOR: the persona does not already know the groove, and
   * every shipping rival lets a learner hear the pattern first. The audio
   * itself is proven against a recording fake in `useGrooveRun.test.ts`; what
   * belongs here is the wiring — the button's own label, and that it does not
   * quietly disable the very control (Start) a learner reaches for next.
   */
  describe('Listen', () => {
    it('lets the learner hear the groove before playing it, then hands Start back', async () => {
      const { user, frameAt } = setup()
      expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Listen' }))
      expect(runState()).toBe('Listening — the groove as written')
      expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument()
      // Not disabled by a run that never started — only a graded run may gate Start.
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()

      // The preview's own span elapses on its own; nothing here presses Stop.
      frameAt(BAR_MS)
      expect(runState()).toBe('Ready when you are')
      expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    })

    it('lets Stop listening cancel a preview early', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))
      expect(runState()).toBe('Listening — the groove as written')

      await user.click(screen.getByRole('button', { name: 'Stop listening' }))
      expect(runState()).toBe('Ready when you are')
      expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    })

    it('disables the groove picker and the tempo field during a preview, same as during a run', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))

      expect(screen.getByRole('button', { name: 'Next groove' })).toBeDisabled()
      expect(screen.getByRole('spinbutton', { name: /tempo/i })).toBeDisabled()
      // Listen itself stays reachable, so the learner can stop and re-listen.
      expect(screen.getByRole('button', { name: 'Stop listening' })).toBeEnabled()
    })

    it('is disabled while a graded run is on', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Start' }))
      expect(screen.getByRole('button', { name: 'Listen' })).toBeDisabled()
    })

    /**
     * `running`, not `busy`, gates Space (T.17.4) — a preview must never
     * borrow the learner's own kick key.
     */
    it('does not let Space become the kick during a preview', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))
      await user.keyboard(' ')
      expect(screen.getByRole('button', { name: 'Kick' })).not.toHaveAttribute('data-lit')
    })

    it('still lights a pad struck during a preview — a learner tapping along is not an error', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Listen' }))
      await user.keyboard('f')
      expect(screen.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-lit', 'true')
    })
  })
})
