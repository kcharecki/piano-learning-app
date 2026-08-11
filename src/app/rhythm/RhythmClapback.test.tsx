/**
 * Screen-level composition for the clap-back drill (roadmap 3.21/5.21,
 * REQ-3.6.2). Per-hook behaviour is covered by `useClapbackDrill.test.ts`;
 * this file's one load-bearing job is the proof the task exists to make:
 * *the notation is genuinely absent from the DOM* during listening and
 * tapping — not merely visually hidden — because a learner who can read the
 * answer off the screen is doing sight-reading again. This file does not
 * mock `ScoreViewer` (unlike `RhythmScreen.test.tsx`) because `RhythmClapback`
 * and `useClapbackDrill` never import it at all — asserting its absence from
 * the DOM is the real test, not a substitute for one.
 */
import { seededRng } from '@core/ports/rng.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { RhythmClapback } from './RhythmClapback.tsx'

afterEach(cleanup)

/** Fixed 2 bars, 120bpm default tempo (`RhythmClapback`'s own `BARS` constant). */
const RUN_LENGTH_MS = 2 * 2000

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

/** No score container, no SVG, no OSMD-authored element — anywhere in the
 *  rendered tree. Asserted on presence/absence, never on visibility/opacity,
 *  which is exactly the distinction the task brief calls out as the part
 *  that "quietly fails". */
function assertNoNotationInDom(): void {
  expect(screen.queryByTestId('score-container')).not.toBeInTheDocument()
  expect(document.querySelector('svg')).toBeNull()
  expect(document.querySelector('[data-note-id]')).toBeNull()
}

describe('RhythmClapback', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<RhythmClapback connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    assertNoNotationInDom()
  })

  it('the Tap button is disabled before a run starts', () => {
    render(<RhythmClapback midiInput={new FakeMidiInput()} rng={seededRng(1)} />)
    expect(screen.getByRole('button', { name: 'Tap' })).toBeDisabled()
    assertNoNotationInDom()
  })

  it('the pattern is heard and never shown: no notation exists in the DOM through listening, tapping, or graded', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={midiInput}
        audioOutput={audioOutput}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )
    assertNoNotationInDom()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByTestId('clapback-listening-status')).toBeInTheDocument()
    assertNoNotationInDom()

    // Listening ends and hands off to tapping automatically.
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    expect(screen.getByTestId('clapback-tapping-status')).toBeInTheDocument()
    assertNoNotationInDom()

    const tapButton = screen.getByRole('button', { name: 'Tap' })
    expect(tapButton).toBeEnabled()
    await user.click(tapButton)
    expect(screen.getByTestId('clapback-tap-count')).toHaveTextContent('Taps: 1')
    assertNoNotationInDom()

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    expect(screen.getByTestId('clapback-accuracy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Again' })).toBeInTheDocument()
    assertNoNotationInDom()
  })

  it('the pattern is heard, for real: listening dispatches real note-on calls, not silence', () => {
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={audioOutput}
        rng={seededRng(3)}
        frameDriver={manual.driver}
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'Start' }).click()
    })
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(audioOutput.calls.some((c) => c.kind === 'noteOn')).toBe(true)
  })

  it('running a full drill through to the end shows the real grade and an Again button', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    const tapButton = screen.getByRole('button', { name: 'Tap' })
    await user.click(tapButton)

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByTestId('clapback-matched')).toBeInTheDocument()
    expect(screen.getByTestId('clapback-missed')).toBeInTheDocument()
    expect(screen.getByTestId('clapback-extra')).toBeInTheDocument()
    expect(screen.getByTestId('clapback-accuracy')).toHaveTextContent(/^\d+%$/)
    expect(screen.getByTestId('clapback-deviation')).toHaveTextContent(/^\d+ms$/)
    const matched = Number(screen.getByTestId('clapback-matched').textContent)
    const extra = Number(screen.getByTestId('clapback-extra').textContent)
    expect(matched + extra).toBe(1)
    expect(screen.getByRole('button', { name: 'Again' })).toBeInTheDocument()
  })

  it('changing level is reflected immediately, and locked while listening or tapping', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(1)}
      />,
    )

    expect(screen.getByTestId('clapback-level')).toHaveTextContent('Level 1')
    await user.click(screen.getByRole('button', { name: 'Increase level' }))
    expect(screen.getByTestId('clapback-level')).toHaveTextContent('Level 2')

    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(screen.getByRole('button', { name: 'Increase level' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decrease level' })).toBeDisabled()
  })

  it('the metronome checkbox is on by default and only sounds during tapping, never listening', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()
    const audioOutput = new RecordingAudioOutput(clock)

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={audioOutput}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )
    expect(screen.getByRole('checkbox', { name: /Metronome click/i })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
    })
    // Still within the listening run at this point in wall time — no clicks yet.
    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(0)

    act(() => manual.pump())
    expect(screen.getByTestId('clapback-tapping-status')).toBeInTheDocument()

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    expect(audioOutput.calls.filter((c) => c.kind === 'click').length).toBeGreaterThan(0)
  })
})
