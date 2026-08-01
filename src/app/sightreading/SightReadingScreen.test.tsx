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
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { SightReadingScreen } from './SightReadingScreen.tsx'

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
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<SightReadingScreen connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start exercise' })).toBeEnabled()
  })

  it('walks through the full discipline: generate, preview, play, and grade', async () => {
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

    expect(screen.getByTestId('sight-reading-level')).toHaveTextContent('Level 1')

    await user.click(screen.getByRole('button', { name: 'Start exercise' }))
    expect(screen.getByTestId('preview-countdown')).toHaveTextContent('30s')
    expect(screen.getByRole('heading', { name: 'Right hand' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Begin now' }))
    expect(screen.getByTestId('playing-status')).toBeInTheDocument()

    act(() => {
      clock.advance(8_500)
      manual.pump()
    })

    expect(screen.getByTestId('sight-reading-accuracy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeInTheDocument()
    // No shadowing audio (REQ-3.4.4) — only the metronome sounded.
    expect(audio.playedNotes).toEqual([])
  })
})
