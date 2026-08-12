/**
 * `useRecorder` wiring (roadmap 2.14, REQ-3.9.2): recording captures live
 * events into a `Recording` via `MidiRecorder`, and replay re-emits that
 * recording's events through the SAME `input` a live take would have used —
 * restamped onto the current clock — driven one frame at a time exactly like
 * `usePracticeEngine`'s pump (see `usePracticeEngine.test.ts`'s `manualDriver`,
 * copied here for the same reason: no real timers, no `requestAnimationFrame`).
 */
import type { AudioPlayback, AudioRecorder } from '@adapters/audio/audioRecorder.ts'
import { getRecordingAudio, putRecordingAudio } from '@adapters/store/idb.ts'
import type { MidiEvent, MidiInput, Store } from '@core/ports/index.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { midi, millis } from '@core/shared/units.ts'
import type { Recording } from '@core/practice/recorder.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, MemoryStore } from '@test/fakes.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useAudioRecording, useRecorder, type UseAudioRecordingOptions, type UseRecorderOptions } from './useRecorder.ts'
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

// --------------------------------------------------------- useAudioRecording

class FakeAudioRecorder implements AudioRecorder {
  mimeType = 'audio/webm'
  state: 'inactive' | 'recording' = 'inactive'
  startCalls = 0
  disposeCalls = 0
  /** What `stop()` resolves with — settable per test. */
  private stopDeferred: { promise: Promise<Blob>; resolve: (blob: Blob) => void } | undefined

  start(): void {
    this.startCalls += 1
    this.state = 'recording'
  }

  stop(): Promise<Blob> {
    this.state = 'inactive'
    let resolve!: (blob: Blob) => void
    const promise = new Promise<Blob>((r) => {
      resolve = r
    })
    this.stopDeferred = { promise, resolve }
    return promise
  }

  /** Resolves the most recent `stop()` call's promise — the test's hand on the "encoder finished" event. */
  resolveStop(blob: Blob): void {
    this.stopDeferred?.resolve(blob)
  }

  dispose(): void {
    this.disposeCalls += 1
  }
}

class FakeAudioPlayback implements AudioPlayback {
  playCalls: number[] = []
  stopCalls = 0
  disposeCalls = 0
  play(fromSeconds = 0): void {
    this.playCalls.push(fromSeconds)
  }
  stop(): void {
    this.stopCalls += 1
  }
  dispose(): void {
    this.disposeCalls += 1
  }
}

function makeAudioOptions(
  overrides: Partial<UseAudioRecordingOptions> = {},
): UseAudioRecordingOptions {
  return {
    phase: 'idle',
    recording: undefined,
    openStore: () => Promise.resolve(new MemoryStore()),
    now: () => 0,
    ...overrides,
  }
}

function recordingOf(id: string): Recording {
  return { id, recordedAt: 0, durationMs: 100, events: [] }
}

/** Flushes the microtask queue — enough for the resolved promises this hook chains through. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAudioRecording', () => {
  it('starts disabled, idle, with no error and no audio', async () => {
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions(),
    })
    await flush()

    expect(result.current.enabled).toBe(false)
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeUndefined()
    expect(result.current.audio).toBeUndefined()
  })

  it('setEnabled(true) requests a recorder and becomes ready on success', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const createRecorder = vi.fn<() => Promise<Result<AudioRecorder, string>>>(() =>
      Promise.resolve(ok(fakeRecorder)),
    )
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ createRecorder }),
    })

    act(() => result.current.setEnabled(true))
    expect(result.current.enabled).toBe(true)
    expect(result.current.status).toBe('requesting')

    await flush()
    expect(result.current.status).toBe('ready')
    expect(createRecorder).toHaveBeenCalledTimes(1)
  })

  it('setEnabled(true) becomes unavailable and surfaces the error on failure (permission denied / no device / unsupported)', async () => {
    const createRecorder = vi.fn<() => Promise<Result<AudioRecorder, string>>>(() =>
      Promise.resolve(err('Microphone access failed: Permission denied')),
    )
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ createRecorder }),
    })

    act(() => result.current.setEnabled(true))
    await flush()

    expect(result.current.status).toBe('unavailable')
    expect(result.current.error).toBe('Microphone access failed: Permission denied')
    // The optimistic toggle reverts on failure — a checkbox left "checked"
    // after a denied request would claim audio will be captured when it will not.
    expect(result.current.enabled).toBe(false)
  })

  it('setEnabled(false) disposes the recorder, returns to idle, and clears any error', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ createRecorder: () => Promise.resolve(ok(fakeRecorder)) }),
    })

    act(() => result.current.setEnabled(true))
    await flush()
    expect(result.current.status).toBe('ready')

    act(() => result.current.setEnabled(false))
    expect(result.current.status).toBe('idle')
    expect(result.current.enabled).toBe(false)
    expect(fakeRecorder.disposeCalls).toBe(1)
  })

  it('beginCapture is a no-op unless enabled and ready', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ createRecorder: () => Promise.resolve(ok(fakeRecorder)) }),
    })

    // Not enabled at all.
    act(() => result.current.beginCapture())
    expect(fakeRecorder.startCalls).toBe(0)
    expect(result.current.status).toBe('idle')

    // Enabled but still 'requesting' (the mic promise has not resolved yet).
    act(() => result.current.setEnabled(true))
    act(() => result.current.beginCapture())
    expect(fakeRecorder.startCalls).toBe(0)
  })

  it('beginCapture starts the recorder and moves status to recording', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ createRecorder: () => Promise.resolve(ok(fakeRecorder)) }),
    })

    act(() => result.current.setEnabled(true))
    await flush()

    act(() => result.current.beginCapture())
    expect(fakeRecorder.startCalls).toBe(1)
    expect(result.current.status).toBe('recording')
  })

  it('markMidiOrigin is a no-op unless status is recording', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const now = vi.fn(() => 0)
    const { result } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ createRecorder: () => Promise.resolve(ok(fakeRecorder)), now }),
    })

    act(() => result.current.markMidiOrigin())
    now.mockClear()
    act(() => result.current.setEnabled(true))
    await flush()
    act(() => result.current.markMidiOrigin())
    // Still 'ready', not 'recording' — no clock read.
    expect(now).not.toHaveBeenCalled()
  })

  it('measures a real offset between beginCapture and markMidiOrigin, and stores it — never assumes zero', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const reads = [1_000, 1_037] // beginCapture's read, then markMidiOrigin's read
    let i = 0
    const now = () => reads[i++] ?? 0
    const store = new MemoryStore()

    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(store),
        now,
        recording: undefined,
      }),
    })

    act(() => result.current.setEnabled(true))
    await flush()

    act(() => result.current.beginCapture()) // reads 1000
    act(() => result.current.markMidiOrigin()) // reads 1037
    act(() => result.current.endCapture())

    const blob = new Blob(['abc'], { type: 'audio/webm' })
    act(() => fakeRecorder.resolveStop(blob))
    await flush()

    rerender(
      makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(store),
        now,
        recording: recordingOf('rec-1'),
      }),
    )
    await flush()

    const stored = await getRecordingAudio(store, 'rec-1')
    expect(stored?.offsetMs).toBe(1_000 - 1_037) // -37: audio started before the MIDI origin
  })

  it('persists the captured blob once BOTH it resolves and the recording id changes — recording changes first, blob resolves after', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const store = new MemoryStore()
    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(store),
        recording: undefined,
      }),
    })

    act(() => result.current.setEnabled(true))
    await flush()
    act(() => result.current.beginCapture())
    act(() => result.current.markMidiOrigin())
    act(() => result.current.endCapture())

    // The MIDI side finishes and re-renders with the new recording BEFORE
    // the audio encoder has flushed its final blob.
    rerender(
      makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(store),
        recording: recordingOf('rec-2'),
      }),
    )
    await flush()
    expect(await getRecordingAudio(store, 'rec-2')).toBeUndefined()

    const blob = new Blob(['late blob'], { type: 'audio/webm' })
    act(() => fakeRecorder.resolveStop(blob))
    await flush()

    const stored = await getRecordingAudio(store, 'rec-2')
    expect(stored).toBeDefined()
    expect(await stored?.blob.text()).toBe('late blob')
    expect(result.current.audio).toEqual({ mimeType: 'audio/webm', sizeBytes: blob.size })
  })

  it('persists the captured blob once BOTH it resolves and the recording id changes — blob resolves first, recording changes after', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const store = new MemoryStore()
    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(store),
        recording: undefined,
      }),
    })

    act(() => result.current.setEnabled(true))
    await flush()
    act(() => result.current.beginCapture())
    act(() => result.current.markMidiOrigin())
    act(() => result.current.endCapture())

    const blob = new Blob(['early blob'], { type: 'audio/webm' })
    act(() => fakeRecorder.resolveStop(blob))
    await flush()
    // Nothing to attach to yet — `recording` has not changed.
    expect(result.current.audio).toBeUndefined()

    rerender(
      makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(store),
        recording: recordingOf('rec-3'),
      }),
    )
    await flush()

    const stored = await getRecordingAudio(store, 'rec-3')
    expect(await stored?.blob.text()).toBe('early blob')
  })

  it('audio is undefined for a recording that was never given audio — the migration path for pre-existing recordings', async () => {
    const store = new MemoryStore()
    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ openStore: () => Promise.resolve(store), recording: undefined }),
    })
    await flush()

    rerender(makeAudioOptions({ openStore: () => Promise.resolve(store), recording: recordingOf('old-recording') }))
    await flush()

    expect(result.current.audio).toBeUndefined()
  })

  it('deleteAudio removes the stored audio and clears audio state', async () => {
    const store = new MemoryStore()
    await putRecordingAudio(store, {
      recordingId: 'rec-1',
      blob: new Blob(['x'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      offsetMs: 0,
    })

    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({ openStore: () => Promise.resolve(store), recording: undefined }),
    })
    rerender(makeAudioOptions({ openStore: () => Promise.resolve(store), recording: recordingOf('rec-1') }))
    await flush()
    expect(result.current.audio).toEqual({ mimeType: 'audio/webm', sizeBytes: 1 })

    act(() => result.current.deleteAudio())
    await flush()

    expect(result.current.audio).toBeUndefined()
    expect(await getRecordingAudio(store, 'rec-1')).toBeUndefined()
  })

  it('a save failure (e.g. storage quota exceeded) surfaces an error without throwing', async () => {
    const fakeRecorder = new FakeAudioRecorder()
    const failingStore: Store = {
      get: () => Promise.resolve(undefined),
      getAll: () => Promise.resolve([]),
      put: () => Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError')),
      delete: () => Promise.resolve(undefined),
      clear: () => Promise.resolve(undefined),
      collections: () => Promise.resolve([]),
    }

    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(failingStore),
        recording: undefined,
      }),
    })

    act(() => result.current.setEnabled(true))
    await flush()
    act(() => result.current.beginCapture())
    act(() => result.current.markMidiOrigin())
    act(() => result.current.endCapture())
    act(() => fakeRecorder.resolveStop(new Blob(['x'])))
    await flush()

    rerender(
      makeAudioOptions({
        createRecorder: () => Promise.resolve(ok(fakeRecorder)),
        openStore: () => Promise.resolve(failingStore),
        recording: recordingOf('rec-4'),
      }),
    )
    await flush()

    expect(result.current.error).toMatch(/storage/i)
    expect(result.current.audio).toBeUndefined()
  })

  it('beginPlayback schedules play() to fire after offsetMs once the audio has a positive offset', async () => {
    vi.useFakeTimers()
    try {
      const store = new MemoryStore()
      await putRecordingAudio(store, {
        recordingId: 'rec-1',
        blob: new Blob(['x'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        offsetMs: 80,
      })
      const playback = new FakeAudioPlayback()
      const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
        initialProps: makeAudioOptions({
          openStore: () => Promise.resolve(store),
          createPlayback: () => playback,
          recording: undefined,
        }),
      })
      rerender(
        makeAudioOptions({
          openStore: () => Promise.resolve(store),
          createPlayback: () => playback,
          recording: recordingOf('rec-1'),
        }),
      )
      await vi.waitFor(() => expect(result.current.audio).toBeDefined())

      act(() => result.current.beginPlayback())
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(playback.playCalls).toEqual([])

      await act(async () => {
        vi.advanceTimersByTime(80)
      })
      expect(playback.playCalls).toEqual([0])
    } finally {
      vi.useRealTimers()
    }
  })

  it('beginPlayback seeks into the clip and plays immediately when the offset is zero or negative', async () => {
    const store = new MemoryStore()
    await putRecordingAudio(store, {
      recordingId: 'rec-1',
      blob: new Blob(['x'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      offsetMs: -250,
    })
    const playback = new FakeAudioPlayback()
    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({
        openStore: () => Promise.resolve(store),
        createPlayback: () => playback,
        recording: undefined,
      }),
    })
    rerender(
      makeAudioOptions({
        openStore: () => Promise.resolve(store),
        createPlayback: () => playback,
        recording: recordingOf('rec-1'),
      }),
    )
    await flush()

    act(() => result.current.beginPlayback())
    await flush()

    expect(playback.playCalls).toEqual([0.25])
  })

  it('beginPlayback is a no-op when the current recording has no stored audio', async () => {
    const store = new MemoryStore()
    const playback = new FakeAudioPlayback()
    const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
      initialProps: makeAudioOptions({
        openStore: () => Promise.resolve(store),
        createPlayback: () => playback,
        recording: undefined,
      }),
    })
    rerender(
      makeAudioOptions({
        openStore: () => Promise.resolve(store),
        createPlayback: () => playback,
        recording: recordingOf('audio-less-recording'),
      }),
    )
    await flush()

    act(() => result.current.beginPlayback())
    await flush()

    expect(playback.playCalls).toEqual([])
  })

  it('endPlayback clears a pending scheduled play and stops/disposes any active playback', async () => {
    vi.useFakeTimers()
    try {
      const store = new MemoryStore()
      await putRecordingAudio(store, {
        recordingId: 'rec-1',
        blob: new Blob(['x'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        offsetMs: 500,
      })
      const playback = new FakeAudioPlayback()
      const { result, rerender } = renderHook((p: UseAudioRecordingOptions) => useAudioRecording(p), {
        initialProps: makeAudioOptions({
          openStore: () => Promise.resolve(store),
          createPlayback: () => playback,
          recording: undefined,
        }),
      })
      rerender(
        makeAudioOptions({
          openStore: () => Promise.resolve(store),
          createPlayback: () => playback,
          recording: recordingOf('rec-1'),
        }),
      )
      await vi.waitFor(() => expect(result.current.audio).toBeDefined())

      act(() => result.current.beginPlayback())
      await act(async () => {
        await Promise.resolve()
      })
      act(() => result.current.endPlayback())

      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      // The scheduled play() never fires — endPlayback cleared the timeout
      // before it could.
      expect(playback.playCalls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
