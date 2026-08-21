/**
 * The groove trainer's run (roadmap DR-09/T.17): count in a bar, open a graded
 * window for two, collect what the learner hit, and grade it.
 *
 * ## One timeline, anchored once
 *
 * `start()` reads the clock exactly once. The count-in clicks, the graded
 * window's opening, its closing and every metronome click after it are all
 * derived from that single instant, so nothing accumulates: a frame that
 * arrives late moves when the SCREEN updates, never where the grid is. The
 * grid is also what the click track is scheduled against — `AudioOutput.click`
 * takes an absolute instant on the same `Clock` epoch — so what the learner
 * hears and what the grader compares against cannot drift apart.
 *
 * The frame pump is `useTransportLoop`, the same one the practice transport
 * uses, for the same reason: `requestAnimationFrame` does not exist in every
 * test environment, and a test should not depend on real frame timing.
 *
 * ## A hit is accepted by the clock, not by the phase
 *
 * The window around the first notated instant opens *before* the graded window
 * does — a stroke half a window early is early, not absent — so acceptance is
 * `gradedOrigin - windowMs` to `endAt + windowMs`, read off the clock. Phase
 * decides what the screen says; it never decides whether a stroke counted.
 *
 * A press outside that span still flashes the pad and still sounds, at any
 * phase including `idle`. Pads a learner cannot try before pressing Start are
 * pads they will meet for the first time under a running clock.
 *
 * ## Audio is best-effort, always
 *
 * Every call into `AudioOutput` here is wrapped. A suspended `AudioContext`, a
 * device that went away, a browser that refuses to build one outside a real
 * gesture — none of that may take the drill down with it, and none of it
 * changes a single graded instant.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { gradeGrooveRun, type GrooveHit, type GrooveRunResult } from '@core/drums/practice/grade.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { AudioOutput, Clock } from '@core/ports/index.ts'
import { midi, millis } from '@core/shared/units.ts'

export type GrooveRunPhase = 'idle' | 'count-in' | 'playing' | 'graded'

/** The pad that was last struck, with a sequence number so two hits in a row still re-trigger the flash. */
export type PadFlash = {
  readonly pad: MappedDrumPad
  readonly seq: number
}

export type UseGrooveRunOptions = {
  readonly plan: GrooveRunPlan
  readonly onFinished?: (result: GrooveRunResult) => void
  /** Injection seams. The browser defaults are built lazily, inside the first press. */
  readonly clock?: Clock
  readonly audio?: () => AudioOutput
  readonly driver?: FrameDriver
}

export type GrooveRunApi = {
  readonly phase: GrooveRunPhase
  /** Beats since the run started, count-in included. `-1` before the first frame. */
  readonly beatIndex: number
  /** Count-in beats still to come, or 0 once the graded window is open. */
  readonly countInLeft: number
  /** 1-based bar of the graded window, or 0 outside it. */
  readonly bar: number
  readonly result: GrooveRunResult | undefined
  readonly flash: PadFlash | undefined
  start: () => void
  stop: () => void
  hit: (pad: MappedDrumPad) => void
}

type RunTiming = {
  readonly startedAt: number
  readonly gradedOrigin: number
  readonly endAt: number
}

/** How long a pad's confirmation tone rings. Short enough that sixteenths at 200 bpm do not blur. */
const PAD_TONE_MS = 60

/**
 * The pitch a pad's confirmation tone sounds at. Not `gmNoteOf` directly: the
 * fallback voice is a pitched triangle oscillator, and the GM percussion map
 * crowds kick, snare and hats into a sixth at the bottom of the range, where
 * they are indistinguishable. Spreading them across three octaves keeps
 * "which limb did I just play" audible on the fallback voice, and any output
 * routed to a real drum module ignores this and uses `gmNoteOf` anyway.
 */
function padTonePitch(pad: MappedDrumPad): number {
  if (pad === 'kick' || pad === 'hhPedal') return 40
  if (pad === 'hhClosed' || pad === 'hhOpen' || pad === 'rideBow' || pad === 'rideBell') return 88
  if (pad === 'crash1' || pad === 'crash2' || pad === 'splash' || pad === 'rideEdge') return 84
  // Snare, rim, cross stick and the toms: the middle of the range.
  return 64
}

export function useGrooveRun(options: UseGrooveRunOptions): GrooveRunApi {
  const { plan, driver } = options

  const clockRef = useRef<Clock | undefined>(undefined)
  if (clockRef.current === undefined) clockRef.current = options.clock ?? createBrowserClock()
  const clock = clockRef.current

  const audioFactory = options.audio ?? createDefaultAudioOutput
  const audioRef = useRef<AudioOutput | undefined>(undefined)

  const [phase, setPhase] = useState<GrooveRunPhase>('idle')
  const [beatIndex, setBeatIndex] = useState(-1)
  const [result, setResult] = useState<GrooveRunResult | undefined>(undefined)
  const [flash, setFlash] = useState<PadFlash | undefined>(undefined)

  const phaseRef = useRef<GrooveRunPhase>('idle')
  const beatRef = useRef(-1)
  const timingRef = useRef<RunTiming | undefined>(undefined)
  const hitsRef = useRef<GrooveHit[]>([])
  const seqRef = useRef(0)
  const planRef = useRef(plan)
  planRef.current = plan
  const onFinishedRef = useRef(options.onFinished)
  onFinishedRef.current = options.onFinished

  /** Every call into the audio output goes through here, so none of them can throw into React. */
  const withAudio = useCallback(
    (use: (out: AudioOutput) => void): void => {
      try {
        if (audioRef.current === undefined) audioRef.current = audioFactory()
        use(audioRef.current)
      } catch {
        // Best-effort by design — see the module comment.
      }
    },
    [audioFactory],
  )

  const sound = useCallback(
    (pad: MappedDrumPad): void => {
      withAudio((out) => {
        const pitch = midi(padTonePitch(pad))
        out.noteOn(pitch, 96)
        out.noteOff(pitch, millis(out.now() + PAD_TONE_MS))
      })
    },
    [withAudio],
  )

  const stop = useCallback((): void => {
    timingRef.current = undefined
    hitsRef.current = []
    phaseRef.current = 'idle'
    beatRef.current = -1
    setPhase('idle')
    setBeatIndex(-1)
    withAudio((out) => out.allNotesOff())
  }, [withAudio])

  const start = useCallback((): void => {
    const runPlan = planRef.current
    const startedAt = clock.now()
    const gradedOrigin = startedAt + runPlan.countInBars * runPlan.barMs
    timingRef.current = { startedAt, gradedOrigin, endAt: gradedOrigin + runPlan.gradedMs }
    hitsRef.current = []
    beatRef.current = -1
    phaseRef.current = 'count-in'
    setResult(undefined)
    setBeatIndex(-1)
    setPhase('count-in')

    // The whole click track, scheduled once against absolute instants on the
    // clock epoch. Nothing re-schedules it per frame, so a stalled frame can
    // never move the pulse the learner is playing to.
    const beatsPerBar = Math.max(1, Math.round(runPlan.barMs / runPlan.beatMs))
    const totalBeats = beatsPerBar * (runPlan.countInBars + runPlan.gradedBars)
    withAudio((out) => {
      for (let beat = 0; beat < totalBeats; beat++) {
        out.click(beat % beatsPerBar === 0, millis(startedAt + beat * runPlan.beatMs))
      }
    })
  }, [clock, withAudio])

  const finish = useCallback((): void => {
    const graded = gradeGrooveRun(planRef.current, hitsRef.current)
    timingRef.current = undefined
    phaseRef.current = 'graded'
    setPhase('graded')
    setResult(graded)
    onFinishedRef.current?.(graded)
  }, [])

  const onFrame = useCallback((): void => {
    const timing = timingRef.current
    if (timing === undefined) return
    const runPlan = planRef.current
    const now = clock.now()

    const beat = Math.floor((now - timing.startedAt) / runPlan.beatMs)
    if (beat !== beatRef.current) {
      beatRef.current = beat
      setBeatIndex(beat)
    }
    if (phaseRef.current === 'count-in' && now >= timing.gradedOrigin) {
      phaseRef.current = 'playing'
      setPhase('playing')
    }
    if (phaseRef.current === 'playing' && now >= timing.endAt) finish()
  }, [clock, finish])

  useTransportLoop({
    active: phase === 'count-in' || phase === 'playing',
    onFrame,
    ...(driver === undefined ? {} : { driver }),
  })

  const hit = useCallback(
    (pad: MappedDrumPad): void => {
      seqRef.current += 1
      setFlash({ pad, seq: seqRef.current })
      sound(pad)

      const timing = timingRef.current
      if (timing === undefined) return
      const runPlan = planRef.current
      const now = clock.now()
      if (now < timing.gradedOrigin - runPlan.windowMs) return
      if (now > timing.endAt + runPlan.windowMs) return
      hitsRef.current.push({ pad, ms: now - timing.gradedOrigin })
    },
    [clock, sound],
  )

  // A run cannot outlive the screen: a pump that keeps ticking after unmount
  // would grade against a plan nothing is showing.
  useEffect(() => () => void (timingRef.current = undefined), [])

  const beatsPerBar = Math.max(1, Math.round(plan.barMs / plan.beatMs))
  const countInBeats = plan.countInBars * beatsPerBar
  const gradedBeat = beatIndex - countInBeats
  return {
    phase,
    beatIndex,
    countInLeft: phase === 'count-in' ? Math.max(0, countInBeats - Math.max(0, beatIndex)) : 0,
    bar: phase === 'playing' ? Math.min(plan.gradedBars, Math.floor(gradedBeat / beatsPerBar) + 1) : 0,
    result,
    flash,
    start,
    stop,
    hit,
  }
}
