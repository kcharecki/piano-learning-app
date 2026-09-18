/**
 * `CalibrationScreen` — thin, per the testing rules: wiring and accessible
 * names, not the run's own timing (that is `useCalibration.test.ts`) and not
 * the scoring (that is `@core/drums/scoring/latency.test.ts`).
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsLatencyStore } from '@app/state/drumsLatencyStore.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { midi, millis } from '@core/shared/units.ts'
import { CALIBRATION_HITS } from '@core/drums/scoring/latency.ts'
import { CalibrationScreen } from './CalibrationScreen.tsx'

/**
 * Never resolves. With no `midiInput` seam given, `useMidiConnection` would
 * otherwise kick off a real `connect()` whose `.then` lands after the test
 * (and its `act(...)`) is already done — the exact shape of the `act(...)`
 * warning this file must not print. A hung "still connecting" promise is
 * indistinguishable, for every assertion here, from "no e-kit connected".
 */
const neverConnect: ConnectMidi = () => new Promise(() => {})

const BEAT_MS = 750 // 60000 / 80 bpm
const BAR_MS = BEAT_MS * 4 // 3000 — one count-in bar

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
    <CalibrationScreen
      clock={clock}
      audio={() => audio}
      frameDriver={frameDriver}
      {...(opts.midiInput === undefined ? { connect: neverConnect } : { midiInput: opts.midiInput })}
    />,
  )
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

function stateText(): string {
  return screen.getByRole('status', { name: 'Calibration state' }).textContent ?? ''
}

function storedOffsetLine(): string {
  return screen.getByRole('status', { name: 'Stored offset' }).textContent ?? ''
}

/**
 * Clicks the Kick pad `count` times, one per successive click of the
 * collecting grid, each landing `lateByMs` after its own click — a frame
 * pump between hits advances scheduling past the click each hit judges
 * against, so this exercises per-click nearest-click judgement rather than
 * one frozen instant.
 */
async function hitKickRepeatedly(
  user: ReturnType<typeof userEvent.setup>,
  clock: FakeClock,
  frameAt: (ms: number) => void,
  lateByMs: number,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    frameAt(BAR_MS + i * BEAT_MS)
    act(() => clock.setTime(BAR_MS + i * BEAT_MS + lateByMs))
    await user.click(screen.getByRole('button', { name: 'Kick' }))
  }
}

beforeEach(() => {
  useDrumsLatencyStore.setState({ offsets: {} })
})

describe('CalibrationScreen', () => {
  it('opens idle, ready to start, with nothing stored for the pads/keyboard input', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Latency' })).toBeInTheDocument()
    expect(stateText()).toBe('Play along with the click on any pad. 16 hits.')
    expect(storedOffsetLine()).toBe('Pads and keys: no offset stored')
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('counts in, then opens collecting at "Hit 0 of 16"', async () => {
    const { user, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(stateText()).toBe('Count-in… 1')
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()

    frameAt(BAR_MS)
    expect(stateText()).toMatch(/^Hit 0 of 16/)
  })

  it('16 hits, each 30ms after a click, produce the exact result line and Save stores the offset', async () => {
    const { user, clock, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    expect(stateText()).toBe('Hit 0 of 16')

    await hitKickRepeatedly(user, clock, frameAt, 30, CALIBRATION_HITS)

    expect(stateText()).toBe('Done')
    expect(screen.getByRole('status', { name: 'Result' })).toHaveTextContent(
      'Your hits read 30 ms late on average (spread ±0 ms)',
    )

    await user.click(screen.getByRole('button', { name: 'Save offset' }))

    expect(useDrumsLatencyStore.getState().offsets.local).toMatchObject({
      offsetMs: 30,
      spreadMs: 0,
      samples: CALIBRATION_HITS,
    })
    expect(storedOffsetLine()).toBe('Pads and keys: 30 ms late offset stored')
  })

  it('Start is enabled again once done, and pressing it starts a fresh count-in with the old result gone', async () => {
    const { user, clock, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    await hitKickRepeatedly(user, clock, frameAt, 30, CALIBRATION_HITS)

    expect(stateText()).toBe('Done')
    expect(screen.getByRole('status', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(stateText()).toBe('Count-in… 1')
    expect(screen.queryByRole('status', { name: 'Result' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  it('Clear offset removes a previously saved offset', async () => {
    const { user, clock, frameAt } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    await hitKickRepeatedly(user, clock, frameAt, 30, CALIBRATION_HITS)
    await user.click(screen.getByRole('button', { name: 'Save offset' }))
    expect(screen.getByRole('button', { name: 'Clear offset' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear offset' }))

    expect(useDrumsLatencyStore.getState().offsets.local).toBeUndefined()
    expect(storedOffsetLine()).toBe('Pads and keys: no offset stored')
  })

  it('a mapped note-on from the e-kit shows up in the input monitor', async () => {
    const midiInput = new FakeMidiInput()
    setup({ midiInput })

    expect(screen.getByRole('status', { name: 'Input monitor status' })).toHaveTextContent(
      'No events yet — hit a pad on your kit.',
    )

    act(() => {
      midiInput.emit({ type: 'noteOn', note: midi(38), velocity: 92, time: millis(0) })
    })

    const list = screen.getByRole('list', { name: 'Input events' })
    expect(within(list).getByRole('listitem')).toHaveTextContent('note 38 · vel 92 → Snare')
  })

  it('with an e-kit connected, the input id is the device id and the label is its name', async () => {
    const midiInput = new FakeMidiInput()
    const { user, clock, frameAt } = setup({ midiInput })

    expect(storedOffsetLine()).toBe('Fake Digital Piano: no offset stored')

    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(BAR_MS)
    await hitKickRepeatedly(user, clock, frameAt, 30, CALIBRATION_HITS)
    await user.click(screen.getByRole('button', { name: 'Save offset' }))

    expect(useDrumsLatencyStore.getState().offsets['fake-piano']).toMatchObject({ offsetMs: 30 })
    expect(storedOffsetLine()).toBe('Fake Digital Piano: 30 ms late offset stored')
  })
})
