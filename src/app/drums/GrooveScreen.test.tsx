/**
 * `GrooveScreen` (roadmap DR-09): a thin render/wiring test over
 * `useGrooveDrill` — the transport, the grading and the pad-swap logic all
 * have their own suite in `useGrooveDrill.test.ts`. This only proves the
 * screen renders what the hook reports, that Start/Stop actually drives it,
 * and that both input paths (pointer and keyboard) reach `drill.hit`.
 *
 * `useDrumsHistoryStore` is a module singleton the screen reads
 * (`drill.lastAttempt`), so it is reset in `beforeEach` even though no test
 * here inspects it directly.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { GrooveScreen } from './GrooveScreen.tsx'

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

/** Money Beat at 80bpm: 3000ms count-in + two 3000ms graded bars + a 100ms tolerance tail. */
const RUN_LENGTH_MS = 9100

function renderScreen() {
  const clock = new FakeClock()
  const audioOutput = new RecordingAudioOutput(clock)
  const manual = manualDriver()
  render(<GrooveScreen clock={clock} audioOutput={audioOutput} frameDriver={manual.driver} date={clock} />)
  return { clock, audioOutput, manual }
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

afterEach(() => {
  cleanup()
})

describe('GrooveScreen', () => {
  it('renders the heading, the groove name, the tempo spinbutton and a Start button', () => {
    renderScreen()

    expect(screen.getByRole('heading', { name: 'Groove trainer' })).toBeInTheDocument()
    expect(screen.getByText('Money Beat')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(80)
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('renders one pad button per pad the groove uses, named for that pad', () => {
    renderScreen()

    expect(screen.getByRole('button', { name: 'Hi-hat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Snare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kick' })).toBeInTheDocument()
    // Money Beat never asks for the open hi-hat, so no pad button for it exists.
    expect(screen.queryByRole('button', { name: 'Open hi-hat' })).not.toBeInTheDocument()
  })

  it('clicking Start swaps the transport to Stop, and the run state moves from count-in to playing', () => {
    const { clock, manual } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    const runState = screen.getByRole('status', { name: 'Run state' })
    expect(runState).toHaveTextContent(/count in/i)

    act(() => {
      clock.advance(3000)
      manual.pump()
    })

    expect(runState).toHaveTextContent(/playing/i)
  })

  it('a pointerdown on a pad during a run is recorded — the pad flashes', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    const hiHatPad = screen.getByRole('button', { name: 'Hi-hat' })
    expect(hiHatPad.querySelector('.groove-pad-flash')).toBeNull()

    fireEvent.pointerDown(hiHatPad)

    expect(hiHatPad.querySelector('.groove-pad-flash')).not.toBeNull()
  })

  it('the F, J and Space keys register hi-hat, snare and kick hits during a run', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    const hiHatPad = screen.getByRole('button', { name: 'Hi-hat' })
    const snarePad = screen.getByRole('button', { name: 'Snare' })
    const kickPad = screen.getByRole('button', { name: 'Kick' })

    fireEvent.keyDown(window, { code: 'KeyF' })
    fireEvent.keyDown(window, { code: 'KeyJ' })
    fireEvent.keyDown(window, { code: 'Space' })

    expect(hiHatPad.querySelector('.groove-pad-flash')).not.toBeNull()
    expect(snarePad.querySelector('.groove-pad-flash')).not.toBeNull()
    expect(kickPad.querySelector('.groove-pad-flash')).not.toBeNull()
  })

  it('shows a "Result" region only once a run has finished', () => {
    const { clock, manual } = renderScreen()

    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
  })
})
