/**
 * Record & replay (roadmap 2.14, REQ-3.9.2) — the panel that makes
 * `src/core/practice/recorder.ts` reachable. `MidiRecorder` only captures and
 * hands back a `Recording`; this hook drives it from the live `MidiInput` and,
 * on replay, turns a `Recording` back into live-looking MIDI events.
 *
 * ## The fan-out `input`
 *
 * `useNoteFeedback` (and everything else on the practice screen) subscribes to
 * whatever `MidiInput` it is given and has no idea a recorder exists. Handing
 * it `recorder.input` instead of the raw live input — a `FanoutMidiInput` that
 * always forwards the live device's events, and during a replay ALSO emits the
 * recording's events restamped onto the current `Clock` — is what makes a
 * replay drive the score colouring through exactly the same code path a live
 * performance does, rather than needing a second, parallel "replay judging"
 * path that could disagree with the live one.
 *
 * ## Restamping
 *
 * A `Recording`'s events are timed relative to 0 at `start()` (see the module
 * comment on `MidiRecorder`). Replaying them as-is would be timestamped in the
 * PAST as far as any consumer reading `Clock.now()` is concerned. `startReplay`
 * asks the caller's `play()` for the instant tick 0 is anchored to and every
 * emitted event is `anchor + event.time` — the same shape `usePracticeEngine`
 * uses to turn a tick-relative time into a `Clock`-epoch one (see its
 * `anchorMs` in `dispatchAudio`), so the emitted events land on the same clock
 * `useNoteFeedback` compares `event.time` against.
 *
 * ## Driving the re-emission
 *
 * `useTransportLoop` — the one place per-frame work happens on this screen —
 * is reused here rather than a second polling mechanism: once per frame,
 * every event whose restamped time has passed since the last frame is emitted,
 * in order. Once every event has been emitted the replay ends itself, calling
 * the caller's `stop()` exactly as `stopReplay()` would.
 *
 * ## Mutual exclusivity
 *
 * Recording and replaying share the same `phase`: `startRecording` is a no-op
 * unless idle, `startReplay` is a no-op unless idle AND a recording exists, so
 * the two can never run at once — there is only ever one thing driving
 * `options.rewindToTop`/`play`/`stop`.
 */
import type { Clock, DateSource, MidiDevice, MidiEvent, MidiInput, Unsubscribe } from '@core/ports/index.ts'
import { MidiRecorder, type Recording, type RecorderStartOptions } from '@core/practice/recorder.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import { useEffect, useRef, useState } from 'react'
import { useTransportLoop, type FrameDriver } from './useTransportLoop.ts'

export type RecorderUiPhase = 'idle' | 'recording' | 'replaying'

export type UseRecorderOptions = {
  /** The LIVE midi input. `undefined` when no keyboard is connected. */
  readonly source: MidiInput | undefined
  readonly clock: Clock
  readonly date: DateSource
  readonly scoreId: string | undefined
  readonly tempoBpm: number | undefined
  /** Clears any loop and rewinds the transport to the top, atomically. */
  readonly rewindToTop: () => void
  /** Starts the transport; returns the instant tick 0 is anchored to. */
  readonly play: () => Millis | undefined
  /** Stops the transport. */
  readonly stop: () => void
  readonly frameDriver?: FrameDriver
}

export type UseRecorder = {
  readonly phase: RecorderUiPhase
  /** The last completed recording, if any. */
  readonly recording: Recording | undefined
  /**
   * Live events, plus replayed ones restamped onto the current clock. Every
   * consumer of MIDI on the practice screen subscribes HERE, not to `source` —
   * that is what makes a replay drive the score colouring exactly as a live
   * performance does (REQ-3.9.2). `undefined` only when `source` is.
   */
  readonly input: MidiInput | undefined
  /** No-op unless phase is 'idle'. Rewinds, starts the transport, starts capturing. */
  readonly startRecording: () => void
  /** No-op unless phase is 'recording'. Stops the transport and stores the take. */
  readonly stopRecording: () => void
  /** No-op unless phase is 'idle' and a recording exists. */
  readonly startReplay: () => void
  /** No-op unless phase is 'replaying'. */
  readonly stopReplay: () => void
}

/**
 * Forwards the live device's events to every subscriber, plus (during a
 * replay) whatever `emit` is called with directly — see the module comment.
 * Implements `MidiInput` completely so it is a drop-in replacement for the
 * live input anywhere on the practice screen.
 */
class FanoutMidiInput implements MidiInput {
  private readonly source: MidiInput
  private readonly handlers = new Set<(event: MidiEvent) => void>()
  private readonly unsubscribeSource: Unsubscribe

  constructor(source: MidiInput) {
    this.source = source
    this.unsubscribeSource = this.source.onEvent((event) => this.emit(event))
  }

  listDevices(): readonly MidiDevice[] {
    return this.source.listDevices()
  }

  onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    return this.source.onDevicesChanged(handler)
  }

  selectDevice(deviceId: string | null): void {
    this.source.selectDevice(deviceId)
  }

  get selectedDeviceId(): string | null {
    return this.source.selectedDeviceId
  }

  onEvent(handler: (event: MidiEvent) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /** Deliver an event to every current subscriber — live pass-through, or a replayed event. */
  emit(event: MidiEvent): void {
    for (const handler of this.handlers) handler(event)
  }

  /** Tears down the subscription to `source`. Call once, from the owning hook's unmount effect. */
  dispose(): void {
    this.unsubscribeSource()
    this.handlers.clear()
  }
}

/** `event.time` (ms since the recording's own `start()`) restamped onto `anchor`. */
function restamp(event: MidiEvent, anchor: Millis): MidiEvent {
  const time = millis(anchor + event.time)
  switch (event.type) {
    case 'noteOn':
      return { type: 'noteOn', note: event.note, velocity: event.velocity, time }
    case 'noteOff':
      return { type: 'noteOff', note: event.note, time }
    case 'sustain':
      return { type: 'sustain', down: event.down, time }
  }
}

export function useRecorder(options: UseRecorderOptions): UseRecorder {
  // Materialised once, like the browser-adapter ports this hook's caller
  // injects — see the module doc on `PracticeScreenProps`. `clock`/`date` are
  // themselves already stable for the lifetime of the practice screen.
  const [recorder] = useState<MidiRecorder>(() => new MidiRecorder(options.clock, options.date))
  const [phase, setPhase] = useState<RecorderUiPhase>('idle')
  const [recording, setRecording] = useState<Recording | undefined>(undefined)

  const recordUnsubscribeRef = useRef<Unsubscribe | undefined>(undefined)
  const replayAnchorRef = useRef<Millis | undefined>(undefined)
  const replayIndexRef = useRef(0)

  // Held in state (not `useMemo`, which React may discard as a cache) keyed on
  // `source` identity, so every consumer's subscription stays pinned to the
  // same `input` for the lifetime of a given live device.
  const [fanout, setFanout] = useState<FanoutMidiInput | undefined>(undefined)

  // Created once per distinct `source` (including the first render), disposed
  // when `source` changes or the hook unmounts — never on a plain re-render,
  // which is what made the previous `useMemo` version merely coincidentally stable.
  useEffect(() => {
    const next = options.source === undefined ? undefined : new FanoutMidiInput(options.source)
    setFanout(next)
    return () => next?.dispose()
  }, [options.source])

  // Release the recorder's own live subscription on unmount, so it cannot
  // keep pumping events into an orphaned `MidiRecorder` after the screen goes away.
  useEffect(
    () => () => {
      recordUnsubscribeRef.current?.()
      recordUnsubscribeRef.current = undefined
    },
    [],
  )

  function startRecording(): void {
    if (phase !== 'idle' || options.source === undefined) return
    options.rewindToTop()
    const anchor = options.play()
    if (anchor === undefined) return
    setRecording(undefined)
    const startOpts: RecorderStartOptions = {
      ...(options.scoreId === undefined ? {} : { scoreId: options.scoreId }),
      ...(options.tempoBpm === undefined ? {} : { tempoBpm: options.tempoBpm }),
    }
    recorder.start(startOpts)
    recordUnsubscribeRef.current = options.source.onEvent((event) => {
      if (event.type === 'noteOn') recorder.noteOn(event.note, event.velocity)
      else if (event.type === 'noteOff') recorder.noteOff(event.note)
      else recorder.sustain(event.down)
    })
    setPhase('recording')
  }

  function stopRecording(): void {
    if (phase !== 'recording') return
    recordUnsubscribeRef.current?.()
    recordUnsubscribeRef.current = undefined
    const done = recorder.stop()
    options.stop()
    if (done !== undefined) setRecording(done)
    setPhase('idle')
  }

  /** Shared tail of a replay ending, whether it ran to completion or was cut short. */
  function endReplay(): void {
    options.stop()
    replayAnchorRef.current = undefined
    replayIndexRef.current = 0
    setPhase('idle')
  }

  function startReplay(): void {
    if (phase !== 'idle' || recording === undefined || fanout === undefined) return
    options.rewindToTop()
    const anchor = options.play()
    if (anchor === undefined) return
    replayAnchorRef.current = anchor
    replayIndexRef.current = 0
    setPhase('replaying')
  }

  function stopReplay(): void {
    if (phase !== 'replaying') return
    endReplay()
  }

  function onReplayFrame(): void {
    const anchor = replayAnchorRef.current
    if (anchor === undefined || recording === undefined) return
    const now = options.clock.now()
    let index = replayIndexRef.current
    while (index < recording.events.length) {
      const event = recording.events[index]
      if (event === undefined) break
      if (anchor + event.time > now) break
      fanout?.emit(restamp(event, anchor))
      index += 1
    }
    replayIndexRef.current = index
    const allEventsEmitted = index >= recording.events.length
    const durationElapsed = now >= anchor + recording.durationMs
    if (allEventsEmitted && durationElapsed) endReplay()
  }

  useTransportLoop({
    active: phase === 'replaying',
    onFrame: onReplayFrame,
    ...(options.frameDriver === undefined ? {} : { driver: options.frameDriver }),
  })

  return {
    phase,
    recording,
    input: fanout,
    startRecording,
    stopRecording,
    startReplay,
    stopReplay,
  }
}
