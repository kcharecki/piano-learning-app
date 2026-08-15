/**
 * Screen-level composition (roadmap 2.12): the store, the trainer hook and
 * the note preview are wired together correctly, and the screen is fully
 * usable with no MIDI keyboard connected. Per-hook behaviour is covered by
 * `useSightReadingTrainer.test.ts` — this only asserts the wiring and that a
 * user driving the screen by clicking through it sees the piece end to end.
 */
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { seededRng } from '@core/ports/rng.ts'
import { sightReadingLevelDescription } from '@content/sightreading/levelDescriptions.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { SightReadingScreen } from './SightReadingScreen.tsx'

// The exercise is engraved for real now (roadmap 2.20), and OSMD cannot run in
// happy-dom — it measures text with a canvas this environment does not have.
// The same mock `PracticeScreen.test.tsx` uses: what belongs to this file is
// that the screen HANDS a score to the viewer, which the `data-score-id`
// attribute below asserts; that OSMD then draws it is `e2e`'s job.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({
    score,
    chrome,
  }: {
    readonly score: { readonly id: string }
    readonly chrome?: { readonly title?: boolean }
  }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} data-chrome-title={String(chrome?.title)} />
  ),
}))

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

function resetStore(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

describe('SightReadingScreen', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    // Roadmap UI-04b: the "No MIDI keyboard connected" status moved out of
    // this screen entirely, into the shell's topbar input-status chip —
    // proved in `InputCapabilityBanner.test.tsx`, not here.
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<SightReadingScreen connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByRole('button', { name: 'Start exercise' })).toBeEnabled()
  })

  // UI-21 (states sweep): before this, `useSightReadingTrainer` fed the
  // engine/assessment straight off `midi.input`, so a learner with no Web
  // MIDI device at all had a "Start exercise"/"Begin now" button but nothing
  // to actually play a note WITH once the run began — the one note-answered
  // screen with no on-screen fallback (`useSightReadingTrainer.test.ts` proves
  // an on-screen press is graded like a MIDI one; this proves the keyboard
  // actually reaches the screen once a run is playing).
  it('renders the on-screen keyboard once a run is playing, with no MIDI keyboard connected', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const neverResolves = (): Promise<never> => new Promise(() => {})

    render(
      <SightReadingScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        connectMidi={neverResolves}
        frameDriver={manual.driver}
        rng={seededRng(42)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start exercise' }))
    await user.click(screen.getByRole('button', { name: 'Begin now' }))

    expect(screen.getByRole('group', { name: 'Play the score' })).toBeInTheDocument()
  })

  it('walks through the full discipline: generate, preview, play, and grade', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    const { container } = render(
      <SightReadingScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
        rng={seededRng(42)}
      />,
    )

    // roadmap 5.57: the trainer's own adaptive level, named distinctly from
    // the curriculum track level shown on Progress — see that screen's own
    // "(curriculum track)" wording for the other half of this collision fix.
    expect(screen.getByTestId('sight-reading-level')).toHaveTextContent(
      'Sight-reading trainer level: 1',
    )
    expect(screen.getByTestId('sight-reading-level-note')).toHaveTextContent(
      /separate from the curriculum track level on Progress/i,
    )
    // Rule 1 of the nine screen rules: exactly one `.btn-primary` while idle.
    expect(container.querySelectorAll('.btn-primary')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Start exercise' }))
    expect(screen.getByTestId('preview-countdown')).toHaveTextContent('30s')
    // The preview is the generated exercise itself, engraved — not a text list
    // of note names, which handed the learner the answer in letters
    // (roadmap 2.20). The score reaching the viewer is what this asserts;
    // whether OSMD draws noteheads is asserted in e2e/smoke.spec.ts.
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-score-id')
    expect(screen.queryByRole('heading', { name: 'Right hand' })).toBeNull()
    // roadmap UI-11: the engraved paper no longer prints its own redundant
    // title — the screen's own `.page-header` already names it, for the
    // whole session, not just this phase.
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-chrome-title', 'false')
    // "Begin now" is the one primary during the countdown; "Start exercise"
    // is gone in this phase, so there is still exactly one.
    expect(container.querySelectorAll('.btn-primary')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Begin now' })).toHaveClass('btn-primary')

    await user.click(screen.getByRole('button', { name: 'Begin now' }))
    expect(screen.getByTestId('playing-status')).toBeInTheDocument()
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-chrome-title', 'false')

    act(() => {
      clock.advance(8_500)
      manual.pump()
    })

    expect(screen.getByTestId('sight-reading-accuracy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeInTheDocument()
    // No shadowing audio (REQ-3.4.4) — only the metronome sounded.
    expect(audio.playedNotes).toEqual([])
  })

  it('the metronome click checkbox is on by default, and turning it off reaches the hook (roadmap 2.28a)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <SightReadingScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
        rng={seededRng(42)}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Metronome click' })
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start exercise' }))
    await user.click(screen.getByRole('button', { name: 'Begin now' }))

    act(() => {
      clock.advance(2_000)
      manual.pump()
    })

    expect(audio.clicks.length).toBe(0)
  })

  it('with the checkbox left checked, the metronome click actually sounds (roadmap 2.28a)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <SightReadingScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
        rng={seededRng(42)}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Metronome click' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start exercise' }))
    await user.click(screen.getByRole('button', { name: 'Begin now' }))

    act(() => {
      clock.advance(2_000)
      manual.pump()
    })

    expect(audio.clicks.length).toBeGreaterThan(0)
  })

  // roadmap U.1: the trainer's level had no human description anywhere on
  // screen (UI-11 wanted a "Level 1 — notes around middle C" subtitle and had
  // nowhere to pull it from). This proves the header actually renders the
  // real per-level text from `@content/sightreading/levelDescriptions.ts` —
  // not a hardcoded string that happens to match level 1 — by asserting it
  // follows the store's level.
  it('the header subtitle names the trainer level and its real description, and follows the level (roadmap U.1)', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<SightReadingScreen connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByTestId('sight-reading-level-description')).toHaveTextContent(
      `Level 1 — ${sightReadingLevelDescription(1)}`,
    )

    act(() => {
      useSightReadingStore.setState({ level: 3, history: [] })
    })

    expect(screen.getByTestId('sight-reading-level-description')).toHaveTextContent(
      `Level 3 — ${sightReadingLevelDescription(3)}`,
    )
    // Levels 1 and 3 must actually read differently, or this assertion would
    // pass even if the subtitle were frozen on level 1's text.
    expect(sightReadingLevelDescription(1)).not.toBe(sightReadingLevelDescription(3))
  })

  it('the customizer reaches the generator: picking a key changes the exercise actually drawn (roadmap 5.12)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    render(<SightReadingScreen rng={seededRng(42)} clock={clock} date={clock} audioOutput={new RecordingAudioOutput(clock)} />)

    await user.click(screen.getByText('Customize exercise'))
    await user.selectOptions(screen.getByLabelText('Key tonic'), 'G major')

    await user.click(screen.getByRole('button', { name: 'Start exercise' }))

    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute(
      'data-score-id',
      expect.stringMatching(/^generated:G major:/),
    )
  })

  it('the customizer is disabled once a run has started', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    render(<SightReadingScreen rng={seededRng(42)} clock={clock} date={clock} audioOutput={new RecordingAudioOutput(clock)} />)

    await user.click(screen.getByText('Customize exercise'))
    await user.click(screen.getByRole('button', { name: 'Start exercise' }))

    expect(screen.getByLabelText('Hands')).toBeDisabled()
  })
})
