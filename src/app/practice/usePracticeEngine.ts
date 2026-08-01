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
 * Hand mute (REQ-3.2.3) is `filterHands` applied to the score BEFORE it is
 * handed to the transport: a muted hand's notes are not merely skipped when
 * scheduling sound, they are not in the score the transport plays, so they
 * cannot be waited for either. Metronome and wait-mode note names still read
 * true because both operate on that same filtered score.
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
import { bpmAtTick, effectiveBpmAtTick, makeTempoMap } from '@core/timing/tempo.ts'
import {
  Transport,
  type LoopRange,
  type TransportEvent,
  type TransportState,
} from '@core/timing/transport.ts'
import { ticks, type Bpm, type Ticks } from '@core/shared/units.ts'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useTransportLoop, type FrameDriver } from './useTransportLoop.ts'

export type PositionDisplay = {
  /** 1-based, as printed on the page. */
  readonly measureNumber: number
  /** 1-based. */
  readonly beat: number
  readonly beatsPerMeasure: number
}

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
  readonly play: () => void
  readonly pause: () => void
  readonly stop: () => void
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

function dispatchAudio(audio: AudioOutput | undefined, events: readonly TransportEvent[]): void {
  if (audio === undefined) return
  for (const event of events) {
    if (event.type === 'noteOn') audio.noteOn(event.note.midi, event.note.velocity)
    else if (event.type === 'noteOff') audio.noteOff(event.note.midi)
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
  for (const click of clicks) audio.click(click.accented)
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

  // Rebuild the transport when the score (or which hands are muted) changes —
  // its score is fixed at construction, so this is the only way hand mute can
  // take effect.
  useEffect(() => {
    if (filteredScore === undefined) {
      setTransport(undefined)
      return
    }
    const next = new Transport({
      score: filteredScore,
      tempo: makeTempoMap(filteredScore.tempos),
      clock: options.clock,
    })
    lastTickRef.current = next.positionTicks
    setTransport(next)
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
    const prevTick = lastTickRef.current
    const events = waitController !== undefined ? waitController.update().events : transport.tick()
    const newTick = transport.positionTicks
    dispatchAudio(options.audioOutput, events)
    if (options.metronomeEnabled && filteredScore !== undefined) {
      dispatchMetronome(
        options.audioOutput,
        transport,
        filteredScore,
        options.metronomeSubdivision,
        prevTick,
        newTick,
        events,
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

  function play(): void {
    if (transport === undefined) return
    transport.play()
    lastTickRef.current = transport.positionTicks
    setDisplay(computeDisplay(transport, waitController, filteredScore))
  }

  function pause(): void {
    if (transport === undefined) return
    transport.pause()
    setDisplay(computeDisplay(transport, waitController, filteredScore))
  }

  function stop(): void {
    if (transport === undefined) return
    transport.stop()
    waitController?.reset()
    lastTickRef.current = transport.positionTicks
    setDisplay(computeDisplay(transport, waitController, filteredScore))
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
  }
}
