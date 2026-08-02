/**
 * The practice engine (roadmap 1.18): builds the `Transport` — and, when wait
 * mode is on, the `WaitModeController` wrapping it — for the currently loaded
 * score, and wires them to sound, the metronome and the score cursor.
 * `useTransportLoop` is the only place per-frame work happens; everything
 * here that is not inside `onFrame` runs on ordinary React commits, not on
 * every animation frame.
 *
 * Two kinds of state, deliberately kept apart:
 *  - `transport` / `waitController` are rebuilt only when the score, the
 *    active hands or the wait-mode toggle change — rare, so ordinary React
 *    state is fine for them, and `Transport.setTempoScale`/`setLoop` update
 *    the SAME instance for tempo and loop changes, which is what keeps the
 *    playhead from jumping when a slider moves.
 *  - `display` is the one piece of state a frame is allowed to touch, and
 *    `onFrame` only calls `setDisplay` when what it shows actually changed.
 *    The score cursor itself is moved straight through the `ScoreViewerHandle`
 *    ref every frame, never through props or state, so following the cursor
 *    never re-renders — see the module comment on `useTransportLoop`.
 *
 * `onFrame` guards against a same-frame race with any sibling
 * `useTransportLoop` subscriber on the same driver (`useRecorder`'s
 * replay-end path is the concrete case, roadmap 2.14): such a subscriber can
 * call this engine's own `stop()`/`pause()` synchronously, mid-frame, before
 * this callback runs — `Transport.stop()` rewinds `positionTicks` immediately,
 * with no React commit in between, so `active` does not go false until the
 * NEXT render. If that happens before this frame's own `tick()`, the position
 * on the transport is leftover from whatever else just stopped it, not
 * something THIS pump produced; reporting it anyway would move the cursor to
 * the rewound tick and feed `useNoteFeedback`'s backward-jump detector a fake
 * loop wrap or seek, wiping a just-finished run's summary the instant it
 * finishes. `onFrame` checks `transport.state` BEFORE calling `tick()` and
 * bails when it is already not `'playing'`/`'waiting'` — see the guard at the
 * top of `onFrame` below. A stop or pause THIS pump's own `tick()` causes (the
 * end of the piece, or a barrier) is unaffected: the state is only read once,
 * before `tick()` runs, so that transition still reports normally.
 *
 * Hand mute (REQ-3.2.3) is `filterHands` applied to the score BEFORE it is
 * handed to the transport: a muted hand's notes are not merely skipped when
 * scheduling sound, they are not in the score the transport plays, so they
 * cannot be waited for either. Metronome and wait-mode note names still read
 * true because both operate on that same filtered score.
 *
 * `play`/`playLoop`/`rewindToTop` are the atomic primitives a caller that
 * needs to mutate the transport (loop, position) AND start or stop it in one
 * indivisible step — `useAssessment` is the reason they exist (roadmap
 * 2.11a) — uses instead of going through React state. Score-store state like
 * `options.loop` reaches the transport only on the NEXT commit, via the
 * effects below; a caller that sets state and then calls `play()` in the
 * same event handler would have `play()` run against the transport's OLD
 * loop, because the commit that applies the new one hasn't happened yet.
 * These three call straight through to the SAME `Transport` instance the
 * click handler already has, so the mutation and the play/stop/seek land
 * together, no commit in between. `play`/`playLoop` also read back the
 * instant the transport actually anchored tick 0 to — see `anchorOf` below —
 * instead of making the caller guess it from its own `clock.now()`.
 */
import type { ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { filterHands, type Hand, type Score } from '@core/notation/score.ts'
import type { AudioOutput, Clock, MidiInput } from '@core/ports/index.ts'
import { WaitModeController, type WaitState } from '@core/practice/waitmode.ts'
import {
  beatTicks,
  clicksInRange,
  type MetronomeSettings,
  type Subdivision,
} from '@core/timing/metronome.ts'
import {
  bpmAtTick,
  effectiveBpmAtTick,
  makeTempoMap,
  tickToMs,
  type TempoMap,
} from '@core/timing/tempo.ts'
import {
  Transport,
  type LoopRange,
  type TransportEvent,
  type TransportState,
} from '@core/timing/transport.ts'
import { invariant } from '@core/shared/invariant.ts'
import { millis, ticks, type Bpm, type Millis, type Ticks } from '@core/shared/units.ts'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useTransportLoop, type FrameDriver } from './useTransportLoop.ts'

export type PositionDisplay = {
  /** 1-based, as printed on the page. */
  readonly measureNumber: number
  /** 1-based. */
  readonly beat: number
  readonly beatsPerMeasure: number
}

/** Where the transport's playhead is now, for moving the score cursor directly. */
export type CursorTarget = { readonly measureIndex: number; readonly tick: Ticks }

export type PracticeEngineOptions = {
  readonly score: Score | undefined
  readonly activeHands: readonly Hand[]
  readonly tempoScale: number
  readonly loop: LoopRange | undefined
  readonly metronomeEnabled: boolean
  readonly metronomeSubdivision: Subdivision
  readonly waitModeEnabled: boolean
  readonly clock: Clock
  readonly audioOutput: AudioOutput | undefined
  readonly midiInput: MidiInput | undefined
  /** Moved imperatively every frame — see the module comment. */
  readonly scoreViewerRef?: RefObject<ScoreViewerHandle | null>
  readonly frameDriver?: FrameDriver
}

export type PracticeEngine = {
  readonly phase: TransportState
  readonly position: PositionDisplay | undefined
  readonly writtenBpm: Bpm | undefined
  readonly effectiveBpm: Bpm | undefined
  readonly wait: WaitState | undefined
  /**
   * Starts the transport. Returns the clock instant tick 0 is anchored to —
   * i.e. the value `t` for which the note at tick `k` sounds at
   * `t + tickToMs(tempo, k)`. `undefined` when there is no transport.
   */
  readonly play: () => Millis | undefined
  readonly pause: () => void
  /**
   * Stops and rewinds. Returns where the playhead landed so the caller can move
   * the score cursor there through the RAW ScoreViewerHandle - see PracticeScreen.
   * `undefined` when there is no transport.
   */
  readonly stop: () => CursorTarget | undefined
  /**
   * Rewinds to tick 0 with any loop cleared, atomically on the transport
   * instance — no React commit in between, so a caller may `play()` straight
   * after and be certain it starts at the top of the whole piece (REQ-3.3.4).
   * Does NOT touch the score store; the caller owns the store's loop state.
   * Unlike `stop()`, this reports nothing: every caller rewinds only to
   * `play()` immediately afterwards, so the cursor is about to be driven by
   * the frame pump anyway and there is no target worth handing back.
   */
  readonly rewindToTop: () => void
  /**
   * Sets `loop` on the transport, seeks to `loop.startTick`, and plays — all
   * atomically on the transport instance (REQ-3.3.5's one-click practice
   * loop). Returns the same anchor `play()` does. Does NOT touch the score
   * store; the caller owns the store's loop state.
   */
  readonly playLoop: (loop: LoopRange) => Millis | undefined
}

type EngineDisplay = {
  readonly phase: TransportState
  readonly position: PositionDisplay | undefined
  readonly writtenBpm: Bpm | undefined
  readonly effectiveBpm: Bpm | undefined
  readonly wait: WaitState | undefined
}

const IDLE_DISPLAY: EngineDisplay = {
  phase: 'stopped',
  position: undefined,
  writtenBpm: undefined,
  effectiveBpm: undefined,
  wait: undefined,
}

/**
 * Used for the metronome grid when nothing better is known. A mid-score meter
 * change is not followed — see `dispatchMetronome`.
 */
const DEFAULT_TIME_SIGNATURE = { beats: 4, beatType: 4 }

function positionOf(
  score: Score,
  measureIndex: number,
  position: Ticks,
): PositionDisplay | undefined {
  const measure = score.measures[measureIndex]
  if (measure === undefined) return undefined
  const unit = beatTicks(measure.timeSignature)
  const beatIndex = Math.max(0, Math.floor((position - measure.startTick) / unit))
  return {
    measureNumber: measureIndex + 1,
    beat: beatIndex + 1,
    beatsPerMeasure: measure.timeSignature.beats,
  }
}

function computeDisplay(
  transport: Transport | undefined,
  wait: WaitModeController | undefined,
  score: Score | undefined,
): EngineDisplay {
  if (transport === undefined || score === undefined) return IDLE_DISPLAY
  return {
    phase: transport.state,
    position: positionOf(score, transport.currentMeasure, transport.positionTicks),
    writtenBpm: bpmAtTick(transport.tempoMap, transport.positionTicks),
    effectiveBpm: effectiveBpmAtTick(transport.tempoMap, transport.positionTicks),
    wait: wait?.state,
  }
}

function positionEqual(a: PositionDisplay | undefined, b: PositionDisplay | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return (
    a.measureNumber === b.measureNumber &&
    a.beat === b.beat &&
    a.beatsPerMeasure === b.beatsPerMeasure
  )
}

/** Reference equality on `wait` is deliberate: `WaitModeController.state` only
 * hands back a new object when something in it actually changed. */
function displayEqual(a: EngineDisplay, b: EngineDisplay): boolean {
  return (
    a.phase === b.phase &&
    a.writtenBpm === b.writtenBpm &&
    a.effectiveBpm === b.effectiveBpm &&
    a.wait === b.wait &&
    positionEqual(a.position, b.position)
  )
}

/**
 * `anchorMs` maps this pump's tick-relative musical time onto the `Clock`
 * epoch `AudioOutput.atMs` is on (see `core/ports/audio.ts`): the wall-clock
 * instant tick 0 would have sounded at, so `anchorMs + tickToMs(tempo, t)` is
 * when tick `t` actually sounds. Passing it through — instead of letting
 * every event in the pump default to "now" — is what keeps a frame that
 * covers several onsets (a dropped frame, a metronome pumping four clicks at
 * once) from collapsing them onto the frame boundary as a simultaneous chord;
 * see the roadmap-1.18 review.
 */
function dispatchAudio(
  audio: AudioOutput | undefined,
  events: readonly TransportEvent[],
  tempo: TempoMap,
  anchorMs: Millis,
): void {
  if (audio === undefined) return
  for (const event of events) {
    if (event.type === 'noteOn') {
      const atMs = millis(anchorMs + tickToMs(tempo, event.note.startTick))
      audio.noteOn(event.note.midi, event.note.velocity, atMs)
    } else if (event.type === 'noteOff') {
      const endTick = ticks(event.note.startTick + event.note.durationTicks)
      const atMs = millis(anchorMs + tickToMs(tempo, endTick))
      audio.noteOff(event.note.midi, atMs)
    }
  }
}

/**
 * Metronome clicks for the tick span this pump just played. Built fresh every
 * frame: `MetronomeSettings` is cheap to construct, and caching one across a
 * tempo-scale change would click at a stale rate.
 *
 * Only the score's own opening time signature drives the grid — a mid-score
 * meter change would need one `MetronomeSettings` per measure, which this
 * wiring does not attempt (see the roadmap-1.18 report).
 */
function dispatchMetronome(
  audio: AudioOutput | undefined,
  transport: Transport,
  score: Score,
  subdivision: Subdivision,
  prevTick: number,
  newTick: number,
  events: readonly TransportEvent[],
  anchorMs: Millis,
): void {
  if (audio === undefined) return
  const settings: MetronomeSettings = {
    bpm: effectiveBpmAtTick(transport.tempoMap, ticks(Math.max(0, prevTick))),
    timeSignature: score.measures[0]?.timeSignature ?? DEFAULT_TIME_SIGNATURE,
    subdivision,
    tempo: transport.tempoMap,
  }
  const loop = transport.loop
  const wrapped = events.some((event) => event.type === 'loop')
  const clicks =
    wrapped && loop !== null
      ? [
          ...clicksInRange(settings, ticks(prevTick), loop.endTick),
          ...clicksInRange(settings, loop.startTick, ticks(newTick)),
        ]
      : newTick > prevTick
        ? clicksInRange(settings, ticks(prevTick), ticks(newTick))
        : []
  for (const click of clicks) audio.click(click.accented, millis(anchorMs + click.ms))
}

/**
 * The clock instant tick 0 is anchored to, read back immediately after a call
 * that ACTUALLY (re)anchors the transport. `Transport.play()` is a no-op —
 * and does NOT reanchor — when the transport is already `'running'`
 * (`transport.ts`'s `play()`: `if (this.runState === 'running') return`,
 * which covers the public `'playing'` and `'waiting'` states); calling this
 * function right after such a no-op `play()` would recompute the formula
 * against the CURRENT `positionTicks`, which has moved on since the last
 * real reanchor, and return a fabricated anchor. `seekTick` (the `playLoop`
 * path) has no such no-op case — it always reanchors, even against an
 * already-running transport — so it is always safe to call this right after
 * a `seekTick`.
 *
 * `Transport` computes and stores this instant itself (`originMs`, private)
 * inside `reanchor()` every time it reanchors, as `clock.now() -
 * tickToMs(tempo, positionTicks)` at that moment; `Transport` has no public
 * getter for it, so callers that need the true value after a possibly-no-op
 * `play()` must cache the last value they know to be correct instead of
 * recomputing it — see `play()`'s use of `lastAnchorRef` below.
 */
function anchorOf(transport: Transport, clock: Clock): Millis {
  return millis(clock.now() - tickToMs(transport.tempoMap, transport.positionTicks))
}

export function usePracticeEngine(options: PracticeEngineOptions): PracticeEngine {
  const filteredScore = useMemo(
    () =>
      options.score === undefined ? undefined : filterHands(options.score, options.activeHands),
    [options.score, options.activeHands],
  )

  const [transport, setTransport] = useState<Transport | undefined>(undefined)
  const [waitController, setWaitController] = useState<WaitModeController | undefined>(undefined)
  const [display, setDisplay] = useState<EngineDisplay>(IDLE_DISPLAY)
  const lastTickRef = useRef(0)
  /** Mirrors `transport` for this same effect to read without depending on
   * its own output — see the rebuild effect below. */
  const transportRef = useRef<Transport | undefined>(undefined)
  /**
   * The last anchor known, for certain, to be correct — set only right after
   * a call that actually reanchored the transport. `play()` falls back to
   * this instead of recomputing `anchorOf` when the transport was already
   * running (see `anchorOf`'s module comment): `Transport.play()` no-ops
   * there, so nothing changed, and this is still the true value.
   */
  const lastAnchorRef = useRef<Millis | undefined>(undefined)

  // Rebuild the transport when the score (or which hands are muted) changes —
  // its score is fixed at construction, so this is the only way hand mute can
  // take effect (REQ-3.2.3).
  //
  // A rebuild mid-playback must not read as a stop: the old transport is
  // simply dropped here, so without carrying its position and running phase
  // over, toggling a hand mute while playing silently rewound to bar 1 and
  // orphaned whatever chord was ringing on the old, now-unreferenced
  // transport — see the roadmap-1.18 review. `allNotesOff` first panics
  // whatever the old transport left sounding; the new transport is seeked to
  // the same tick and, if the old one was running, restarted from there.
  useEffect(() => {
    const previous = transportRef.current
    if (filteredScore === undefined) {
      if (previous !== undefined) options.audioOutput?.allNotesOff()
      transportRef.current = undefined
      setTransport(undefined)
      return
    }
    const next = new Transport({
      score: filteredScore,
      tempo: makeTempoMap(filteredScore.tempos),
      clock: options.clock,
    })
    if (previous !== undefined) {
      options.audioOutput?.allNotesOff()
      const wasRunning = previous.state === 'playing' || previous.state === 'waiting'
      next.seekTick(previous.positionTicks)
      if (wasRunning) next.play()
    }
    lastTickRef.current = next.positionTicks
    lastAnchorRef.current = undefined
    transportRef.current = next
    setTransport(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- audioOutput is read via the latest closure, not tracked: only a score/hands change should rebuild the transport
  }, [filteredScore, options.clock])

  // Tempo scale and loop range update the SAME transport instance — both
  // preserve the playhead by design, so neither needs a rebuild.
  useEffect(() => {
    if (transport === undefined) return
    transport.setTempoScale(options.tempoScale)
    setDisplay(computeDisplay(transport, waitController, filteredScore))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the scale itself should re-apply this
  }, [transport, options.tempoScale])

  useEffect(() => {
    if (transport === undefined) return
    transport.setLoop(options.loop ?? null)
    setDisplay(computeDisplay(transport, waitController, filteredScore))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the range itself should re-apply this
  }, [transport, options.loop?.startTick, options.loop?.endTick])

  // Wait mode wraps the same transport; toggling it never rebuilds the
  // transport, only arms or releases the barrier it uses.
  useEffect(() => {
    if (transport === undefined || filteredScore === undefined || !options.waitModeEnabled) {
      setWaitController(undefined)
      setDisplay(computeDisplay(transport, undefined, filteredScore))
      return undefined
    }
    const controller = new WaitModeController(transport, filteredScore)
    setWaitController(controller)
    setDisplay(computeDisplay(transport, controller, filteredScore))
    return () => controller.reset()
  }, [transport, filteredScore, options.waitModeEnabled])

  // Forward the learner's keyboard into wait mode. Harmless when nothing is
  // armed — `WaitModeController.noteOn` only means something while holding.
  useEffect(() => {
    if (options.midiInput === undefined || waitController === undefined) return undefined
    return options.midiInput.onEvent((event) => {
      if (event.type === 'noteOn') waitController.noteOn(event.note)
      else if (event.type === 'noteOff') waitController.noteOff(event.note)
    })
  }, [options.midiInput, waitController])

  function onFrame(): void {
    if (transport === undefined) return
    // Read BEFORE this frame's own `tick()`: a sibling `useTransportLoop`
    // subscriber sharing this driver may already have stopped or paused the
    // transport earlier in this SAME animation frame (see the module
    // comment). If so, `positionTicks` is leftover state this pump did not
    // produce — bail without moving the cursor or touching `lastTickRef`, so
    // neither this frame nor the next run is corrupted by a rewound tick. A
    // stop this frame's OWN `tick()` causes (reaching the end of the piece)
    // is unaffected, because `transport.state` is read here, once, before
    // that call.
    if (transport.state !== 'playing' && transport.state !== 'waiting') return
    const prevTick = lastTickRef.current
    const events = waitController !== undefined ? waitController.update().events : transport.tick()
    const newTick = transport.positionTicks
    // The wall-clock instant tick 0 would have sounded at, so every event this
    // pump produced converts back to its OWN moment instead of "now".
    //
    // Anchored on the tick the pump STARTED from, not the one it ended on. A
    // pump reports the events of the window it just crossed, so anchoring on
    // the end places every one of them in the past — and Web Audio rejects a
    // negative time outright ("Time must be a finite non-negative number:
    // -0.0017"), which killed playback entirely. Anchoring on the start puts
    // the window in the next frame instead: one frame of latency, about 16ms
    // at 60fps and well inside REQ-4.1's 20ms budget, with the relative
    // spacing intact. That last part is the point — after a 400ms stall the
    // gap's notes are spread across the following 400ms rather than fired
    // together as a chord.
    const anchorMs = millis(options.clock.now() - tickToMs(transport.tempoMap, ticks(prevTick)))
    dispatchAudio(options.audioOutput, events, transport.tempoMap, anchorMs)
    if (options.metronomeEnabled && filteredScore !== undefined) {
      dispatchMetronome(
        options.audioOutput,
        transport,
        filteredScore,
        options.metronomeSubdivision,
        prevTick,
        newTick,
        events,
        anchorMs,
      )
    }
    lastTickRef.current = newTick
    options.scoreViewerRef?.current?.moveCursorTo(transport.currentMeasure, transport.positionTicks)
    setDisplay((prev) => {
      const next = computeDisplay(transport, waitController, filteredScore)
      return displayEqual(prev, next) ? prev : next
    })
  }

  const active = display.phase === 'playing' || display.phase === 'waiting'
  useTransportLoop({
    active,
    onFrame,
    ...(options.frameDriver === undefined ? {} : { driver: options.frameDriver }),
  })

  function play(): Millis | undefined {
    if (transport === undefined) return undefined
    // `Transport.play()` no-ops without reanchoring when already 'playing' or
    // 'waiting' — capture that BEFORE calling it, so the fallback below is not
    // itself contaminated by the call. See `anchorOf`'s module comment.
    const alreadyRunning = transport.state === 'playing' || transport.state === 'waiting'
    transport.play()
    const anchor =
      alreadyRunning && lastAnchorRef.current !== undefined
        ? lastAnchorRef.current
        : anchorOf(transport, options.clock)
    lastAnchorRef.current = anchor
    lastTickRef.current = transport.positionTicks
    setDisplay(computeDisplay(transport, waitController, filteredScore))
    return anchor
  }

  /**
   * Clears the loop and rewinds to tick 0 on the SAME transport instance a
   * subsequent `play()` will use, in one synchronous call — see the
   * `PracticeEngine.rewindToTop` doc. `setLoop(null)` first, then `stop()`:
   * `Transport.stop()` rewinds to `loopRange?.startTick ?? 0`, so clearing the
   * loop first is what makes it land on tick 0 instead of the old loop start.
   */
  function rewindToTop(): void {
    if (transport === undefined) return
    transport.setLoop(null)
    transport.stop()
    options.audioOutput?.allNotesOff()
    waitController?.reset()
    lastTickRef.current = transport.positionTicks
    setDisplay(computeDisplay(transport, waitController, filteredScore))
  }

  /**
   * Sets the loop, seeks INTO it, and plays, atomically — see the
   * `PracticeEngine.playLoop` doc. Seeks to the transport's OWN (possibly
   * `MIN_LOOP_TICKS`-widened, see `Transport.setLoop`) loop start rather than
   * the caller's raw `loop.startTick`, so the seek always lands inside the
   * range that will actually be played.
   */
  function playLoop(loop: LoopRange): Millis | undefined {
    if (transport === undefined) return undefined
    transport.setLoop(loop)
    // `setLoop` either throws (an invalid range) or leaves `transport.loop`
    // non-null — there is no third outcome — so the widened range is always
    // there to read back; see `Transport.setLoop`.
    const armed = transport.loop
    invariant(armed !== null, 'playLoop: setLoop did not leave a loop armed')
    transport.seekTick(armed.startTick)
    transport.play()
    // `seekTick` always reanchors, even against an already-running transport
    // (unlike `play()` alone — see `anchorOf`'s module comment), so this is
    // always the true anchor.
    const anchor = anchorOf(transport, options.clock)
    lastAnchorRef.current = anchor
    lastTickRef.current = transport.positionTicks
    setDisplay(computeDisplay(transport, waitController, filteredScore))
    return anchor
  }

  function pause(): void {
    if (transport === undefined) return
    transport.pause()
    // `Transport.pause` freezes the playhead but leaves held notes held (by
    // design, on the domain side — see `transport.ts`), so nothing there
    // releases the sound. Without this the instrument keeps droning through
    // the pause; see the roadmap-1.18 review. The note stays marked "held" on
    // the transport, so its eventual real `noteOff` still fires on resume —
    // harmlessly, into a voice that is already silent.
    options.audioOutput?.allNotesOff()
    setDisplay(computeDisplay(transport, waitController, filteredScore))
  }

  function stop(): CursorTarget | undefined {
    if (transport === undefined) return undefined
    transport.stop()
    // `Transport.stop` queues its releases into a private pending list that
    // only the NEXT `tick()` drains — and stopping is exactly what stops the
    // pump (`active` below goes false), so that pending release could sit
    // unheard until the next `play()`, on Web MIDI (no safety net) for as
    // long as the player leaves it stopped. Panicking here is what actually
    // silences the instrument now; see the roadmap-1.18 review.
    options.audioOutput?.allNotesOff()
    waitController?.reset()
    lastTickRef.current = transport.positionTicks
    setDisplay(computeDisplay(transport, waitController, filteredScore))
    return { measureIndex: transport.currentMeasure, tick: transport.positionTicks }
  }

  return {
    phase: display.phase,
    position: display.position,
    writtenBpm: display.writtenBpm,
    effectiveBpm: display.effectiveBpm,
    wait: display.wait,
    play,
    pause,
    stop,
    rewindToTop,
    playLoop,
  }
}
