/**
 * Screen-level composition (roadmap 1.18): the store, the engine and every
 * control are wired together correctly, and the screen renders — and stays
 * usable — with no MIDI keyboard connected. Per-control behaviour is already
 * covered by each control's own test file; this only asserts the wiring
 * between them.
 */
import { useScoreStore } from '@app/state/scoreStore.ts'
import { C_MAJOR_SCALE_RH } from '@core/notation/fixtures.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PracticeScreen } from './PracticeScreen.tsx'
import type { FrameDriver } from './useTransportLoop.ts'

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
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
}

function loadSampleScore(): void {
  useScoreStore
    .getState()
    .loadScore({ score: C_MAJOR_SCALE_RH, sourceName: 'Test Score', musicXml: undefined })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

describe('PracticeScreen', () => {
  it('asks the user to load a score before showing any controls', () => {
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)
    expect(screen.getByText(/load a score/i)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Transport' })).toBeNull()
  })

  it('is fully usable with no MIDI keyboard connected — REQ-4.1', async () => {
    loadSampleScore()
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<PracticeScreen connectMidi={neverResolves} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
  })

  it('composes the store, the engine and every control into one working screen', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    expect(screen.getByText(/MIDI keyboard connected: Fake Digital Piano/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump())
    expect(audio.playedNotes.length).toBeGreaterThan(0)

    await user.click(screen.getByRole('radio', { name: 'Right hand only' }))
    expect(useScoreStore.getState().settings.activeHands).toEqual(['right'])

    await user.click(screen.getByRole('checkbox', { name: 'Metronome' }))
    expect(useScoreStore.getState().settings.metronomeEnabled).toBe(true)
  })

  it('shows live note feedback (REQ-3.3.2) and clears it when the transport stops', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    // Before anything is played, the panel reads a clean slate.
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump()) // parks the cursor on tick 0, arming the matcher

    // C_MAJOR_SCALE_RH's first note is C4 (60) at tick 0.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')
  })
})
