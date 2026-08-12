/**
 * Screen-level composition (roadmap 2.13): the hook, the complexity stepper,
 * the engraved pattern (roadmap 5.19) and the tap controls are wired together
 * correctly, and starting a run through the UI actually begins tapping.
 * Per-hook behaviour is covered by `useRhythmDrill.test.ts`.
 */
import { seededRng } from '@core/ports/rng.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { RhythmScreen } from './RhythmScreen.tsx'

// The pattern is engraved for real now (roadmap 5.19), and OSMD cannot run in
// happy-dom — see SightReadingScreen.test.tsx's identical mock. What belongs
// to this file is that the screen hands a score to the viewer; that OSMD then
// draws it is e2e's job.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({
    score,
  }: {
    readonly score: { readonly id: string; readonly meta: { readonly title: string } }
  }) => <div data-testid="mock-score-viewer" data-score-id={score.id} data-score-title={score.meta.title} />,
}))

afterEach(cleanup)

/** Fixed 4 bars, 120bpm default tempo (`RhythmScreen`'s own `BARS` constant). */
const RUN_LENGTH_MS = 4 * 2000

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

describe('RhythmScreen', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<RhythmScreen connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByRole('heading', { name: 'Rhythm' })).toBeInTheDocument()
    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('starting the drill shows the pattern and lets the on-screen button tap', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)

    render(
      <RhythmScreen clock={clock} midiInput={midiInput} audioOutput={audioOutput} rng={seededRng(7)} />)

    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(screen.getByTestId('rhythm-tapping-status')).toBeInTheDocument()
    const tapButton = screen.getByRole('button', { name: 'Tap' })
    expect(tapButton).toBeEnabled()
    expect(screen.getByTestId('mock-score-viewer')).toBeInTheDocument()
    // roadmap 5.56: the engraved pattern must never carry an empty/"Untitled
    // Score" title — 5.13 fixed `generateMelody`/`techniqueScore` but never
    // reached `rhythmToScore`, which is what this screen's drill calls.
    expect(screen.getByTestId('mock-score-viewer').dataset.scoreTitle).toBe(
      'Rhythm — complexity 1',
    )

    await user.click(tapButton)

    expect(screen.getByTestId('rhythm-tap-count')).toHaveTextContent('Taps: 1')
  })

  it('the engraved title names the complexity the pattern was actually generated at (roadmap 5.56)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()

    render(
      <RhythmScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(7)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Increase complexity' }))
    await user.click(screen.getByRole('button', { name: 'Increase complexity' }))
    expect(screen.getByTestId('rhythm-complexity')).toHaveTextContent('Complexity 3')

    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(screen.getByTestId('mock-score-viewer').dataset.scoreTitle).toBe(
      'Rhythm — complexity 3',
    )
  })

  it('the Tap button is disabled before a run starts', () => {
    render(<RhythmScreen midiInput={new FakeMidiInput()} rng={seededRng(1)} />)

    expect(screen.getByRole('button', { name: 'Tap' })).toBeDisabled()
  })

  it('changing complexity is reflected immediately, and locked while tapping', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    render(
      <RhythmScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(1)}
      />,
    )

    expect(screen.getByTestId('rhythm-complexity')).toHaveTextContent('Complexity 1')
    await user.click(screen.getByRole('button', { name: 'Increase complexity' }))
    expect(screen.getByTestId('rhythm-complexity')).toHaveTextContent('Complexity 2')

    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(screen.getByRole('button', { name: 'Increase complexity' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decrease complexity' })).toBeDisabled()
  })

  it('running a full drill through to the end shows the real grade and an Again button', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()

    render(
      <RhythmScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    const tapButton = screen.getByRole('button', { name: 'Tap' })
    await user.click(tapButton)

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByTestId('rhythm-matched')).toBeInTheDocument()
    expect(screen.getByTestId('rhythm-missed')).toBeInTheDocument()
    expect(screen.getByTestId('rhythm-extra')).toBeInTheDocument()
    // A stub `percent()` that dropped the *100, or a swapped matched/missed,
    // would still render — but not with a `%` suffix / the actual counts.
    expect(screen.getByTestId('rhythm-accuracy')).toHaveTextContent(/^\d+%$/)
    expect(screen.getByTestId('rhythm-deviation')).toHaveTextContent(/^\d+ms$/)
    const matched = Number(screen.getByTestId('rhythm-matched').textContent)
    const extra = Number(screen.getByTestId('rhythm-extra').textContent)
    expect(matched + extra).toBe(1)
    expect(screen.getByRole('button', { name: 'Again' })).toBeInTheDocument()
  })

  it('the metronome click checkbox is on by default, and turning it off reaches the hook (roadmap 2.28a)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()
    const audioOutput = new RecordingAudioOutput(clock)

    render(
      <RhythmScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={audioOutput}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Metronome click' })
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByTestId('rhythm-matched')).toBeInTheDocument()
    expect(audioOutput.clicks.length).toBe(0)
  })

  it('with the checkbox left checked, the metronome click actually sounds (roadmap 2.28a)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()
    const audioOutput = new RecordingAudioOutput(clock)

    render(
      <RhythmScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={audioOutput}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Metronome click' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByTestId('rhythm-matched')).toBeInTheDocument()
    expect(audioOutput.clicks.length).toBeGreaterThan(0)
  })
})

describe('RhythmScreen — mode switch (roadmap 3.21/5.21)', () => {
  it('defaults to sight-reading mode, and switching to clap-back mode swaps the whole drill', async () => {
    const user = userEvent.setup()
    render(<RhythmScreen midiInput={new FakeMidiInput()} rng={seededRng(1)} />)

    // Default: the original sight-reading drill's own controls are present.
    expect(screen.getByTestId('rhythm-complexity')).toBeInTheDocument()
    expect(screen.queryByTestId('clapback-level')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clap-back mode' }))

    // The sight-reading drill's controls are gone; the clap-back drill's own
    // are there instead — a real swap, not two panels stacked and hidden.
    expect(screen.queryByTestId('rhythm-complexity')).not.toBeInTheDocument()
    expect(screen.getByTestId('clapback-level')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sight-reading mode' }))
    expect(screen.getByTestId('rhythm-complexity')).toBeInTheDocument()
    expect(screen.queryByTestId('clapback-level')).not.toBeInTheDocument()
  })
})
