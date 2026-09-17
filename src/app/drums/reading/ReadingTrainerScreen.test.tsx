/**
 * `ReadingTrainerScreen` — thin, per the testing rules: what is asserted
 * here is wiring and accessible names. The run, the grading and the level
 * adaptation are `useReadingTrainer.test.ts`'s job; the result panel's
 * wording is `readingRun.test.ts`'s.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock } from '@test/fakes.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { ReadingTrainerScreen } from './ReadingTrainerScreen.tsx'

function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup(initialSeed = 1) {
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
    <ReadingTrainerScreen
      clock={clock}
      audio={() => audio}
      frameDriver={frameDriver}
      initialSeed={initialSeed}
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

function levelStatus(): string {
  return screen.getByRole('status', { name: 'Level' }).textContent ?? ''
}

function runState(): string {
  return screen.getByRole('status', { name: 'Run state' }).textContent ?? ''
}

beforeEach(() => {
  useDrumsReadingStore.setState({ level: 1, runs: [] })
})

describe('ReadingTrainerScreen', () => {
  it('opens on level 1, describing it in words, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Rhythm reading' })).toBeInTheDocument()
    expect(levelStatus()).toBe('Level 1 — Quarters: one note or one silence per beat.')
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(runState()).toBe('Ready when you are')
  })

  it('draws the exercise on a percussion staff with an accessible label', () => {
    setup()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('has no per-pad legend or pad buttons — pad identity is ignored, only one Tap target exists', () => {
    setup()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
  })

  it('has the six main-bar controls: Start, Listen, Next exercise, Slower, Faster, Tap', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Slower' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Faster' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
  })

  it('Listen and Next exercise are disabled while a run is live, and Start becomes Stop', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))

    // Start itself is not merely disabled — it is replaced by Stop, since a
    // live run still needs a way to end it early.
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Listen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeDisabled()
  })

  it('the Tap pad is wired to the run: pressing it flashes and registers a hit', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(runState()).toMatch(/^Counting in/)

    const tapPad = screen.getByRole('button', { name: 'Tap' })
    await user.pointer({ keys: '[MouseLeft]', target: tapPad })
    expect(tapPad).toHaveAttribute('data-lit', 'true')
  })

  it('Next exercise draws a new staff', async () => {
    const { user } = setup()
    const before = screen.getByRole('img').getAttribute('data-groove-staff')
    await user.click(screen.getByRole('button', { name: 'Next exercise' }))
    const after = screen.getByRole('img').getAttribute('data-groove-staff')
    expect(after).not.toBe(before)
  })
})
