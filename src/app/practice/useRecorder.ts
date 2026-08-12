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
 *
 * ## Persistence (roadmap 2.24, REQ-3.9.2)
 *
 * `stopRecording` appends the completed take to `useProgressStore` in
 * addition to holding it as `recording` (the last take, kept for replay) —
 * `recordings` exposes the store's full, capped, newest-first list so every
 * take a learner records in a session survives past this component's own
 * lifetime instead of being overwritten by the next one.
 */
import {
  createAudioPlayback,
  createAudioRecorder,
  type AudioPlayback,
  type AudioRecorder,
} from '@adapters/audio/audioRecorder.ts'
import {
  createIdbStore,
  deleteRecordingAudio,
  getRecordingAudio,
  putRecordingAudio,
} from '@adapters/store/idb.ts'
import type { Clock, DateSource, MidiDevice, MidiEvent, MidiInput, Store, Unsubscribe } from '@core/ports/index.ts'
import { MidiRecorder, type Recording, type RecorderStartOptions } from '@core/practice/recorder.ts'
import type { Result } from '@core/shared/result.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import { useEffect, useRef, useState } from 'react'
import { useProgressStore } from '@app/state/progressStore.ts'
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
  /** Every completed recording still held by `useProgressStore`, newest first (roadmap 2.24, REQ-3.9.2). */
  readonly recordings: readonly Recording[]
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
  /**
   * Makes `id` the `recording` replay targets — how a take restored from
   * `recordings` after a reload becomes selectable, since `recording` is
   * otherwise seeded only from this session's own last take. No-op if `id`
   * is not in `recordings`.
   */
  readonly selectRecording: (id: string) => void
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
  // Seeded from whatever `useProgressStore` already holds (its newest take,
  // if any) rather than always starting `undefined` — otherwise a take
  // restored from IndexedDB on reload exists in the store but can never be
  // selected or replayed (roadmap 2.24, REQ-3.9.2).
  const [recording, setRecording] = useState<Recording | undefined>(
    () => useProgressStore.getState().recordings[0],
  )
  const recordings = useProgressStore((s) => s.recordings)
  const addRecording = useProgressStore((s) => s.addRecording)

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
    if (done !== undefined) {
      setRecording(done)
      addRecording(done)
    }
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

  function selectRecording(id: string): void {
    const found = recordings.find((r) => r.id === id)
    if (found !== undefined) setRecording(found)
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
    recordings,
    input: fanout,
    startRecording,
    stopRecording,
    startReplay,
    stopReplay,
    selectRecording,
  }
}

// ------------------------------------------------------------- audio (B.5)

/**
 * The optional audio half of practice recording (roadmap B.5, REQ-3.9.2
 * "audio recording is optional"). A SEPARATE hook, not a field folded into
 * `useRecorder` above, because its wiring point is different: `RecordPanel`
 * (not `PracticeScreen`) is what calls this, wrapping its own Record/Stop/
 * Replay/Stop-replay button handlers around `beginCapture`/`markMidiOrigin`/
 * `endCapture`/`beginPlayback`/`endPlayback` — see `RecordPanel.tsx`'s module
 * comment for why the wiring lives there and not in a new `useRecorder` prop
 * `PracticeScreen` would have to forward (it can't; it is owned by another
 * session for this slice).
 *
 * ## Opt-in, always
 *
 * Mirrors `useMicInput.ts`'s enable/error contract (same reasoning, roadmap
 * 5.7): requesting the microphone lights the browser's recording indicator,
 * so nothing here ever calls `getUserMedia` except in reaction to
 * `setEnabled(true)` — an explicit user action, never automatic, and never
 * merely because a MIDI recording started.
 *
 * ## Measuring the start offset, not assuming it
 *
 * `beginCapture` and `markMidiOrigin` are two ends of one bracket around a
 * SINGLE synchronous call: `RecordPanel`'s Record button handler calls
 * `beginCapture()` (starts the already-provisioned `MediaRecorder` — no
 * `await`, so this is near-instant), then the MIDI-side `onStartRecording`
 * (which synchronously runs `MidiRecorder.start()`, capturing ITS OWN origin
 * from a `Clock`), then `markMidiOrigin()`. Both brackets read the same
 * `now()` (defaults to `performance.now`), so `offsetMs` — audio's start
 * minus the MIDI origin — is a real measured quantity (the synchronous
 * call-overhead between the two starts, typically sub-millisecond), not an
 * assumed zero. `getUserMedia`/mic provisioning happens ahead of time, on
 * `setEnabled(true)`, specifically so this bracket has no `await` in it.
 *
 * ## Attaching audio to its recording
 *
 * `endCapture` stops the `MediaRecorder` and stashes the resulting `Blob` in
 * a ref — its `id` is not known yet, because `MidiRecorder.stop()`'s
 * `Recording` only becomes THIS hook's `recording` prop on ITS OWN caller's
 * next render, and the two resolve independently (one is a synchronous
 * return value, the other an async `MediaRecorder.stop()` event). Once BOTH
 * have happened — a pending blob exists AND `recording.id` has changed from
 * whatever it was when capture began — `tryAttachPending` persists the pair
 * via `putRecordingAudio`. This is checked from both directions (the blob
 * resolving, and `recording` changing) so it is correct regardless of which
 * settles first.
 *
 * ## Storage failure
 *
 * `putRecordingAudio` can reject — most realistically `QuotaExceededError`
 * on a full IndexedDB. That failure only drops the audio; the MIDI
 * `Recording` was already saved (by `useRecorder`, independently) before this
 * hook's `putRecordingAudio` call even starts, so a learner never loses a
 * take over storage pressure, only its audio track — surfaced via `error`.
 */
export type AudioRecordingStatus = 'idle' | 'requesting' | 'ready' | 'recording' | 'unavailable'

export type AudioSummary = {
  readonly mimeType: string
  readonly sizeBytes: number
}

export type UseAudioRecordingOptions = {
  /** The MIDI phase from the paired `useRecorder` — used only for documentation/consistency checks by callers; this hook does not read it directly. */
  readonly phase: RecorderUiPhase
  /** The MIDI recording audio should be attached to / read from — the paired `useRecorder`'s own `recording`. */
  readonly recording: Recording | undefined
  /** Test seam. Defaults to `createIdbStore` — this hook opens its own connection, same pattern as `useSessionRun.ts`/`OnboardingFlow.tsx`. */
  readonly openStore?: () => Promise<Store>
  /** Test seam. Defaults to the real microphone-backed `createAudioRecorder`. */
  readonly createRecorder?: () => Promise<Result<AudioRecorder, string>>
  /** Test seam. Defaults to the real `createAudioPlayback`. */
  readonly createPlayback?: (blob: Blob) => AudioPlayback
  /** Test seam for the wall-clock reads the offset measurement brackets. Defaults to `performance.now`. */
  readonly now?: () => number
}

export type UseAudioRecording = {
  readonly enabled: boolean
  setEnabled(enabled: boolean): void
  readonly status: AudioRecordingStatus
  /** Set on a failed mic request or a failed save; cleared on the next `setEnabled(true)`. */
  readonly error: string | undefined
  /** The CURRENT `recording`'s stored audio, if any. `undefined` for a take with none — including every recording made before this feature shipped. */
  readonly audio: AudioSummary | undefined
  deleteAudio(): void
  /** Call synchronously, immediately BEFORE the paired `startRecording`. */
  beginCapture(): void
  /** Call synchronously, immediately AFTER the paired `startRecording` returns. */
  markMidiOrigin(): void
  /** Call synchronously, alongside the paired `stopRecording`. */
  endCapture(): void
  /** Call synchronously, immediately AFTER the paired `startReplay`. No-op if the current recording has no stored audio. */
  beginPlayback(): void
  /** Call synchronously, alongside the paired `stopReplay` (or when a replay ends on its own). */
  endPlayback(): void
}

type PendingAudio = { readonly blob: Blob; readonly mimeType: string; readonly offsetMs: number }

function defaultNow(): number {
  return performance.now()
}

export function useAudioRecording(options: UseAudioRecordingOptions): UseAudioRecording {
  const openStore = options.openStore ?? createIdbStore
  const createRecorderImpl = options.createRecorder ?? (() => createAudioRecorder())
  const createPlaybackImpl = options.createPlayback ?? ((blob: Blob) => createAudioPlayback(blob))
  const now = options.now ?? defaultNow

  const [enabled, setEnabledState] = useState(false)
  const [status, setStatus] = useState<AudioRecordingStatus>('idle')
  const [error, setError] = useState<string | undefined>(undefined)
  const [audio, setAudio] = useState<AudioSummary | undefined>(undefined)
  const [store, setStore] = useState<Store | undefined>(undefined)

  const recorderRef = useRef<AudioRecorder | undefined>(undefined)
  // A REF, deliberately not derived from `status` state: `beginCapture` and
  // `markMidiOrigin` are called back-to-back inside the SAME synchronous
  // click handler (see the module comment's alignment bracket). `setStatus`
  // does not update `status` until the next render, so a check against
  // `status` inside that same handler would always see the value from
  // BEFORE `beginCapture` ran — this ref is what lets `markMidiOrigin` see
  // capture as already started, in the same synchronous turn it began in.
  const capturingRef = useRef(false)
  const captureStartMsRef = useRef<number | undefined>(undefined)
  const midiOriginMsRef = useRef<number | undefined>(undefined)
  const recordingIdAtCaptureStartRef = useRef<string | undefined>(undefined)
  const pendingRef = useRef<PendingAudio | undefined>(undefined)
  const playbackRef = useRef<AudioPlayback | undefined>(undefined)
  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // "Latest ref" pattern: kept current on every render (no dep array) so the
  // async `MediaRecorder.stop()` continuation below can read the recording/
  // store this hook has NOW, not whatever was in scope when capture began.
  const latestRef = useRef({ recording: options.recording, store })
  useEffect(() => {
    latestRef.current = { recording: options.recording, store }
  })

  useEffect(() => {
    let alive = true
    void openStore()
      .then((opened) => {
        if (alive) setStore(opened)
      })
      .catch(() => {
        // No IndexedDB in this environment (or it failed to open) — audio
        // simply never persists/replays; the MIDI half is entirely
        // unaffected, since `useRecorder` never touches this store.
      })
    return () => {
      alive = false
    }
  }, [openStore])

  useEffect(
    () => () => {
      recorderRef.current?.dispose()
      recorderRef.current = undefined
      playbackRef.current?.dispose()
      playbackRef.current = undefined
      if (playbackTimeoutRef.current !== undefined) clearTimeout(playbackTimeoutRef.current)
    },
    [],
  )

  /** Persists a stashed blob once BOTH it and a newly-changed recording id exist — see the module comment. */
  function tryAttachPending(): void {
    const pending = pendingRef.current
    const { recording, store: currentStore } = latestRef.current
    const currentId = recording?.id
    if (pending === undefined) return
    if (currentId === undefined || currentId === recordingIdAtCaptureStartRef.current) return
    if (currentStore === undefined) return
    pendingRef.current = undefined
    void putRecordingAudio(currentStore, { recordingId: currentId, ...pending })
      .then(() => setAudio({ mimeType: pending.mimeType, sizeBytes: pending.blob.size }))
      .catch(() => {
        setError("Audio couldn't be saved — storage may be full. The MIDI recording is safe.")
      })
  }

  useEffect(() => {
    tryAttachPending()
  }, [options.recording])

  // Fetches the stored audio summary for whichever recording is current —
  // absent for an old, audio-less recording exactly as it should be.
  useEffect(() => {
    let alive = true
    const id = options.recording?.id
    if (id === undefined || store === undefined) {
      setAudio(undefined)
      return undefined
    }
    void getRecordingAudio(store, id)
      .then((stored) => {
        if (!alive) return
        setAudio(stored === undefined ? undefined : { mimeType: stored.mimeType, sizeBytes: stored.blob.size })
      })
      .catch(() => {
        if (alive) setAudio(undefined)
      })
    return () => {
      alive = false
    }
  }, [options.recording?.id, store])

  function setEnabled(next: boolean): void {
    setEnabledState(next)
    setError(undefined)
    if (!next) {
      recorderRef.current?.dispose()
      recorderRef.current = undefined
      capturingRef.current = false
      setStatus('idle')
      return
    }
    setStatus('requesting')
    void createRecorderImpl().then((result) => {
      if (!result.ok) {
        recorderRef.current = undefined
        setStatus('unavailable')
        setError(result.error)
        // Revert the optimistic toggle: the checkbox reflects whether audio
        // WILL actually be captured, and on a failed request it will not —
        // showing it checked would be a lie the next Record click exposes.
        setEnabledState(false)
        return
      }
      recorderRef.current = result.value
      setStatus('ready')
    })
  }

  function beginCapture(): void {
    if (!enabled || status !== 'ready' || recorderRef.current === undefined) return
    recordingIdAtCaptureStartRef.current = options.recording?.id
    captureStartMsRef.current = now()
    recorderRef.current.start()
    capturingRef.current = true
    setStatus('recording')
  }

  function markMidiOrigin(): void {
    if (!capturingRef.current) return
    midiOriginMsRef.current = now()
  }

  function endCapture(): void {
    if (!capturingRef.current || recorderRef.current === undefined) return
    capturingRef.current = false
    const recorder = recorderRef.current
    const startedAt = captureStartMsRef.current
    const originAt = midiOriginMsRef.current
    const offsetMs = startedAt !== undefined && originAt !== undefined ? startedAt - originAt : 0
    captureStartMsRef.current = undefined
    midiOriginMsRef.current = undefined
    setStatus('ready')
    void recorder.stop().then((blob) => {
      pendingRef.current = { blob, mimeType: recorder.mimeType, offsetMs }
      tryAttachPending()
    })
  }

  function beginPlayback(): void {
    const id = options.recording?.id
    if (id === undefined || store === undefined) return
    void getRecordingAudio(store, id).then((stored) => {
      if (stored === undefined) return
      const playback = createPlaybackImpl(stored.blob)
      playbackRef.current = playback
      if (stored.offsetMs <= 0) {
        // The clip's own first sample is BEFORE the point replay resumes
        // from — skip that much of the clip rather than playing it early.
        // `Math.max(0, ...)` rather than a bare negation: at exactly
        // `offsetMs === 0` the negation is `-0`, which is numerically 0 but
        // fails a strict equality/deep-equality check against `0` — this
        // keeps the seek target a plain, unambiguous `0` in that case.
        playback.play(Math.max(0, -stored.offsetMs) / 1000)
      } else {
        playbackTimeoutRef.current = setTimeout(() => playback.play(0), stored.offsetMs)
      }
    })
  }

  function endPlayback(): void {
    if (playbackTimeoutRef.current !== undefined) {
      clearTimeout(playbackTimeoutRef.current)
      playbackTimeoutRef.current = undefined
    }
    playbackRef.current?.stop()
    playbackRef.current?.dispose()
    playbackRef.current = undefined
  }

  function deleteAudio(): void {
    const id = options.recording?.id
    if (id === undefined || store === undefined) return
    void deleteRecordingAudio(store, id)
      .then(() => setAudio(undefined))
      .catch(() => {})
  }

  return {
    enabled,
    setEnabled,
    status,
    error,
    audio,
    deleteAudio,
    beginCapture,
    markMidiOrigin,
    endCapture,
    beginPlayback,
    endPlayback,
  }
}
