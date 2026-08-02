/**
 * `useRecorder` wiring (roadmap 2.14, REQ-3.9.2): recording captures live
 * events into a `Recording` via `MidiRecorder`, and replay re-emits that
 * recording's events through the SAME `input` a live take would have used —
 * restamped onto the current clock — driven one frame at a time exactly like
 * `usePracticeEngine`'s pump (see `usePracticeEngine.test.ts`'s `manualDriver`,
 * copied here for the same reason: no real timers, no `requestAnimationFrame`).
 */
import type { MidiEvent, MidiInput } from '@core/ports/index.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useRecorder, type UseRecorderOptions } from './useRecorder.ts'
import type { FrameDriver } from './useTransportLoop.ts'

afterEach(() => {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
})

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

function makeOptions(
  clock: FakeClock,
  source: MidiInput | undefined,
  overrides: Partial<UseRecorderOptions> = {},
): UseRecorderOptions {
  return {
    source,
    clock,
    date: clock,
    scoreId: undefined,
    tempoBpm: undefined,
    rewindToTop: vi.fn(),
    play: vi.fn(() => clock.now()),
    stop: vi.fn(),
    ...overrides,
  }
}

describe('useRecorder', () => {
  it('starts idle, with no recording, and an input mirroring the live source', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    expect(result.current.phase).toBe('idle')
    expect(result.current.recording).toBeUndefined()
    expect(result.current.input?.listDevices()).toEqual(source.listDevices())
  })

  it('input keeps a stable identity across re-renders, so subscribers are not torn down and re-subscribed', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result, rerender } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    const first = result.current.input
    expect(first).toBeDefined()
    rerender(makeOptions(clock, source))
    expect(result.current.input).toBe(first)
  })

  it('input delegates device listing/selection to the live source', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    act(() => result.current.input?.selectDevice('device-1'))
    expect(source.selectedDeviceId).toBe('device-1')
    expect(result.current.input?.selectedDeviceId).toBe('device-1')

    const changed = vi.fn()
    result.current.input?.onDevicesChanged(changed)
    act(() => source.setDevices([{ id: 'device-1', name: 'Keyboard', manufacturer: 'Test' }]))
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('the Unsubscribe returned by input.onEvent stops delivery to that handler only', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    const kept: MidiEvent[] = []
    const dropped: MidiEvent[] = []
    result.current.input?.onEvent((e) => kept.push(e))
    const unsubscribeDropped = result.current.input?.onEvent((e) => dropped.push(e))
    unsubscribeDropped?.()

    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(kept).toHaveLength(1)
    expect(dropped).toHaveLength(0)
  })

  it('input is undefined exactly when there is no live source', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, undefined),
    })

    expect(result.current.input).toBeUndefined()
  })

  it('startRecording is a no-op with no live source connected', () => {
    const clock = new FakeClock()
    const rewindToTop = vi.fn()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, undefined, { rewindToTop }),
    })

    act(() => result.current.startRecording())

    expect(result.current.phase).toBe('idle')
    expect(rewindToTop).not.toHaveBeenCalled()
  })

  it('stopRecording is a no-op unless a recording is in progress', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const stop = vi.fn()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source, { stop }),
    })

    act(() => result.current.stopRecording())

    expect(stop).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('idle')
  })

  it('startRecording rewinds and starts the transport, then captures notes and pedal from the live source', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const rewindToTop = vi.fn()
    const play = vi.fn(() => clock.now())
    const stop = vi.fn()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source, { rewindToTop, play, stop }),
    })

    act(() => result.current.startRecording())
    expect(rewindToTop).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('recording')

    act(() => clock.advance(50))
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(clock.now()) }))
    act(() => source.emit({ type: 'sustain', down: true, time: millis(clock.now()) }))
    act(() => clock.advance(100))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(clock.now()) }))

    act(() => result.current.stopRecording())

    expect(stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
    // Every event's time is relative to `start()`, from the recorder's own
    // clock — not whatever `time` the live MidiEvent happened to carry.
    expect(result.current.recording?.events).toEqual([
      { type: 'noteOn', note: 60, velocity: 80, time: 50 },
      { type: 'sustain', down: true, time: 50 },
      { type: 'noteOff', note: 60, time: 150 },
    ])
    expect(result.current.recording?.durationMs).toBe(150)
  })

  it('stopRecording appends the completed take to useProgressStore and it is exposed as recordings', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    expect(result.current.recordings).toEqual([])

    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(0) }))
    act(() => result.current.stopRecording())

    expect(result.current.recordings).toHaveLength(1)
    expect(result.current.recordings[0]).toEqual(result.current.recording)
    expect(useProgressStore.getState().recordings).toEqual(result.current.recordings)
  })

  it('seeds recording from useProgressStore on mount, so a take restored from a reload is selectable and replayable', () => {
    const restored: MidiEvent[] = [
      { type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) },
      { type: 'noteOff', note: midi(60), time: millis(100) },
    ]
    useProgressStore.getState().addRecording({
      id: 'restored-take',
      recordedAt: 0,
      durationMs: 100,
      events: restored,
    })

    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    expect(result.current.recording?.id).toBe('restored-take')
  })

  it('selectRecording makes an existing recordings entry the active recording; a no-op for an unknown id', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(0) }))
    act(() => result.current.stopRecording())
    const first = result.current.recording

    act(() => clock.advance(10))
    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(clock.now()) }))
    act(() => source.emit({ type: 'noteOff', note: midi(64), time: millis(clock.now()) }))
    act(() => result.current.stopRecording())
    const second = result.current.recording

    expect(result.current.recording).toEqual(second)

    act(() => result.current.selectRecording('unknown-id'))
    expect(result.current.recording).toEqual(second)

    act(() => result.current.selectRecording(first?.id ?? ''))
    expect(result.current.recording).toEqual(first)
  })

  it('a second take is prepended in useProgressStore, newest first, without dropping the first', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(0) }))
    act(() => result.current.stopRecording())
    const first = result.current.recording

    act(() => clock.advance(10))
    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(clock.now()) }))
    act(() => source.emit({ type: 'noteOff', note: midi(64), time: millis(clock.now()) }))
    act(() => result.current.stopRecording())
    const second = result.current.recording

    expect(result.current.recordings).toEqual([second, first])
  })

  it('the fan-out forwards live events to input subscribers even while idle', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    const events: MidiEvent[] = []
    result.current.input?.onEvent((e) => events.push(e))
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(events).toEqual([{ type: 'noteOn', note: 60, velocity: 80, time: 0 }])
  })

  it('a live event is captured into the recording AND forwarded live to input subscribers', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source),
    })

    const events: MidiEvent[] = []
    result.current.input?.onEvent((e) => events.push(e))

    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(0) }))
    act(() => result.current.stopRecording())

    expect(events).toEqual([
      { type: 'noteOn', note: 60, velocity: 80, time: 0 },
      { type: 'noteOff', note: 60, time: 0 },
    ])
    expect(result.current.recording?.events).toEqual([
      { type: 'noteOn', note: 60, velocity: 80, time: 0 },
      { type: 'noteOff', note: 60, time: 0 },
    ])
  })

  it('startReplay is a no-op with no prior recording', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const rewindToTop = vi.fn()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source, { rewindToTop }),
    })

    act(() => result.current.startReplay())

    expect(result.current.phase).toBe('idle')
    expect(rewindToTop).not.toHaveBeenCalled()
  })

  it('startReplay does nothing beyond rewinding if play() cannot anchor the transport', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const rewindToTop = vi.fn()
    const play = vi.fn<UseRecorderOptions['play']>(() => clock.now())
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source, { rewindToTop, play }),
    })

    act(() => result.current.startRecording())
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => result.current.stopRecording())
    expect(result.current.recording).toBeDefined()

    rewindToTop.mockClear()
    play.mockReturnValueOnce(undefined)
    act(() => result.current.startReplay())

    expect(rewindToTop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
  })

  function recordShortTake(
    clock: FakeClock,
    source: FakeMidiInput,
    result: { current: ReturnType<typeof useRecorder> },
  ): void {
    act(() => result.current.startRecording())
    act(() => clock.advance(50))
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(clock.now()) }))
    act(() => clock.advance(100))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(clock.now()) }))
    act(() => result.current.stopRecording())
  }

  it('replays a finished recording frame by frame, restamped onto the current clock, and finishes once the recording duration has elapsed', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const manual = manualDriver()
    const rewindToTop = vi.fn()
    const play = vi.fn(() => clock.now())
    const stop = vi.fn()
    const options = makeOptions(clock, source, { rewindToTop, play, stop, frameDriver: manual.driver })
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), { initialProps: options })

    recordShortTake(clock, source, result)
    expect(result.current.recording?.events).toHaveLength(2)

    rewindToTop.mockClear()
    play.mockClear()
    stop.mockClear()

    const replayed: MidiEvent[] = []
    result.current.input?.onEvent((e) => replayed.push(e))

    act(() => result.current.startReplay())
    expect(rewindToTop).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('replaying')

    const anchor = clock.now()

    // Before the first event's restamped time, a pump emits nothing.
    act(() => manual.pump())
    expect(replayed).toEqual([])

    act(() => {
      clock.advance(50)
      manual.pump()
    })
    expect(replayed).toEqual([{ type: 'noteOn', note: 60, velocity: 80, time: anchor + 50 }])
    expect(result.current.phase).toBe('replaying')
    expect(stop).not.toHaveBeenCalled()

    // The second (and last) event: replay must finish itself and stop the transport.
    act(() => {
      clock.advance(100)
      manual.pump()
    })
    expect(replayed).toEqual([
      { type: 'noteOn', note: 60, velocity: 80, time: anchor + 50 },
      { type: 'noteOff', note: 60, time: anchor + 150 },
    ])
    expect(stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
  })

  it('replay does not end until the recording duration elapses, even after the last event has been emitted (trailing silence)', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const manual = manualDriver()
    const stop = vi.fn()
    const play = vi.fn(() => clock.now())
    const options = makeOptions(clock, source, { stop, play, frameDriver: manual.driver })
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), { initialProps: options })

    act(() => result.current.startRecording())
    act(() => clock.advance(50))
    act(() => source.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(clock.now()) }))
    act(() => clock.advance(100))
    act(() => source.emit({ type: 'noteOff', note: midi(60), time: millis(clock.now()) }))
    // Trailing silence: two more seconds elapse before the take is stopped.
    act(() => clock.advance(2000))
    act(() => result.current.stopRecording())
    expect(result.current.recording?.durationMs).toBe(2150)

    stop.mockClear()
    const anchor2 = clock.now()

    act(() => result.current.startReplay())
    // Both events land within the first 150ms.
    act(() => {
      clock.advance(150)
      manual.pump()
    })
    expect(result.current.phase).toBe('replaying')
    expect(stop).not.toHaveBeenCalled()

    // Short of the recording's full duration: still replaying.
    act(() => {
      clock.advance(1000)
      manual.pump()
    })
    expect(result.current.phase).toBe('replaying')
    expect(stop).not.toHaveBeenCalled()

    // Once `anchor2 + durationMs` has passed, the replay ends on its own.
    act(() => {
      clock.advance(2150 - (clock.now() - anchor2))
      manual.pump()
    })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
  })

  it('stopReplay ends a replay early and no further events are emitted', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const manual = manualDriver()
    const stop = vi.fn()
    const options = makeOptions(clock, source, { stop, frameDriver: manual.driver })
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), { initialProps: options })

    recordShortTake(clock, source, result)
    stop.mockClear()

    const replayed: MidiEvent[] = []
    result.current.input?.onEvent((e) => replayed.push(e))

    act(() => result.current.startReplay())
    act(() => {
      clock.advance(50)
      manual.pump()
    })
    expect(replayed).toHaveLength(1)

    act(() => result.current.stopReplay())
    expect(stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')

    // The loop was torn down when phase left 'replaying' — pumping again is inert.
    act(() => {
      clock.advance(200)
      manual.pump()
    })
    expect(replayed).toHaveLength(1)
  })

  it('a single slow frame that spans several restamped events emits all of them, in order, each with its own restamped time', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const manual = manualDriver()
    const play = vi.fn(() => clock.now())
    const options = makeOptions(clock, source, { play, frameDriver: manual.driver })
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), { initialProps: options })

    recordShortTake(clock, source, result)

    const replayed: MidiEvent[] = []
    result.current.input?.onEvent((e) => replayed.push(e))

    act(() => result.current.startReplay())
    const anchor = clock.now()

    // One frame, advanced past BOTH events' restamped times at once.
    act(() => {
      clock.advance(150)
      manual.pump()
    })

    expect(replayed).toEqual([
      { type: 'noteOn', note: 60, velocity: 80, time: anchor + 50 },
      { type: 'noteOff', note: 60, time: anchor + 150 },
    ])
  })

  it('stopReplay is a no-op unless a replay is running', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const stop = vi.fn()
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), {
      initialProps: makeOptions(clock, source, { stop }),
    })

    act(() => result.current.stopReplay())

    expect(stop).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('idle')
  })

  it('recording and replaying are mutually exclusive', () => {
    const clock = new FakeClock()
    const source = new FakeMidiInput()
    const manual = manualDriver()
    const rewindToTop = vi.fn()
    const options = makeOptions(clock, source, { rewindToTop, frameDriver: manual.driver })
    const { result } = renderHook((p: UseRecorderOptions) => useRecorder(p), { initialProps: options })

    recordShortTake(clock, source, result)

    act(() => result.current.startReplay())
    expect(result.current.phase).toBe('replaying')

    rewindToTop.mockClear()
    act(() => result.current.startRecording())
    expect(result.current.phase).toBe('replaying')
    expect(rewindToTop).not.toHaveBeenCalled()

    act(() => result.current.stopReplay())
    expect(result.current.phase).toBe('idle')

    act(() => result.current.startRecording())
    expect(result.current.phase).toBe('recording')

    rewindToTop.mockClear()
    act(() => result.current.startReplay())
    expect(result.current.phase).toBe('recording')
    expect(rewindToTop).not.toHaveBeenCalled()
  })
})
