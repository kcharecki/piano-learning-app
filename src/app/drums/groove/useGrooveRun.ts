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
 * grid is also what the click track is scheduled against — `DrumAudioOutput.click`
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
 * Every call into `DrumAudioOutput` here is wrapped. A suspended audio
 * device, a browser that refuses to build one outside a real gesture — none
 * of that may take the drill down with it, and none of it changes a single
 * graded instant.
 *
 * ## What a marking is a marking OF (roadmap T.31)
 *
 * A `GrooveRunResult` outlives the run that made it — it stays on screen so
 * the learner can read it. Two shapes are both wrong: showing it under a
 * groove it never graded (a stale verdict resurrected by cycling back), and
 * hiding it the moment the tempo is retuned (the panel the learner is reading
 * disappearing out from under them for a change that never invalidated it).
 * So the result is retired — actually cleared, not merely hidden — exactly
 * when `plan.grooveId` changes, and survives a tempo change by carrying the
 * bpm it was graded at alongside it (`GradedRun`), so the screen can still
 * say what tempo produced it after the control has moved on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDrumAudioOutput } from '@adapters/audio/drumAudio.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { gradeGrooveRun, type GrooveHit, type GrooveRunResult } from '@core/drums/practice/grade.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { millis } from '@core/shared/units.ts'

export type GrooveRunPhase = 'idle' | 'count-in' | 'playing' | 'graded' | 'preview'

/** The pad that was last struck, with a sequence number so two hits in a row still re-trigger the flash. */
export type PadFlash = {
  readonly pad: MappedDrumPad
  readonly seq: number
}

/**
 * A graded verdict, paired with the tempo it was actually graded at. The
 * pairing exists because `plan.bpm` moves the instant the learner retunes,
 * while the result on screen must keep naming the run it came from — see the
 * module comment.
 */
export type GradedRun = {
  readonly result: GrooveRunResult
  readonly bpm: number
}

export type UseGrooveRunOptions = {
  readonly plan: GrooveRunPlan
  readonly onFinished?: (result: GrooveRunResult) => void
  /** Injection seams. The browser defaults are built lazily, inside the first press. */
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly driver?: FrameDriver
}

export type GrooveRunApi = {
  readonly phase: GrooveRunPhase
  /** Beats since the run started, count-in included. `-1` before the first frame. */
  readonly beatIndex: number
  /** 1-based beat of the count-in bar currently sounding, or 0 outside the count-in. */
  readonly countInBeat: number
  /** 1-based bar of the graded window, or 0 outside it. */
  readonly bar: number
  readonly result: GradedRun | undefined
  readonly flash: PadFlash | undefined
  start: () => void
  stop: () => void
  hit: (pad: MappedDrumPad) => void
  /** Play the graded music, plus a click track under it. Nothing is graded. */
  preview: () => void
}

type RunTiming = {
  readonly startedAt: number
  readonly gradedOrigin: number
  readonly endAt: number
}

/** A preview in flight: nothing but "when does it end", since nothing is graded. */
type PreviewTiming = {
  readonly endAt: number
}

/** The velocity a learner's own pad press sounds at — a stroke, not a demonstration. */
const HIT_VELOCITY = 96

/** The velocity `preview()` plays back at — slightly hotter, since it is the model to copy. */
const PREVIEW_VELOCITY = 100

export function useGrooveRun(options: UseGrooveRunOptions): GrooveRunApi {
  const { plan, driver } = options

  const clockRef = useRef<Clock | undefined>(undefined)
  if (clockRef.current === undefined) clockRef.current = options.clock ?? createBrowserClock()
  const clock = clockRef.current

  const audioFactory = options.audio ?? createDrumAudioOutput
  const audioRef = useRef<DrumAudioOutput | undefined>(undefined)

  const [phase, setPhase] = useState<GrooveRunPhase>('idle')
  const [beatIndex, setBeatIndex] = useState(-1)
  const [result, setResult] = useState<GradedRun | undefined>(undefined)
  const [flash, setFlash] = useState<PadFlash | undefined>(undefined)

  // Retiring the result on a groove change is done HERE, during render, not
  // in an effect: comparing the plan's own identity against what was seen
  // last render and calling `setResult` synchronously is the documented way
  // to reset state in response to a prop change, and it means there is no
  // committed frame in which the old verdict is still showing beside a staff
  // it never graded. A tempo change on the SAME groove leaves this alone —
  // that is the whole point of T.31.
  const [seenGrooveId, setSeenGrooveId] = useState(plan.grooveId)
  if (plan.grooveId !== seenGrooveId) {
    setSeenGrooveId(plan.grooveId)
    setResult(undefined)
  }

  const phaseRef = useRef<GrooveRunPhase>('idle')
  const beatRef = useRef(-1)
  const timingRef = useRef<RunTiming | undefined>(undefined)
  const previewRef = useRef<PreviewTiming | undefined>(undefined)
  const hitsRef = useRef<GrooveHit[]>([])
  const seqRef = useRef(0)
  const planRef = useRef(plan)
  planRef.current = plan
  const onFinishedRef = useRef(options.onFinished)
  onFinishedRef.current = options.onFinished

  /** Every call into the audio output goes through here, so none of them can throw into React. */
  const withAudio = useCallback(
    (use: (out: DrumAudioOutput) => void): void => {
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
      withAudio((out) => out.strike(pad, HIT_VELOCITY))
    },
    [withAudio],
  )

  const stop = useCallback((): void => {
    timingRef.current = undefined
    previewRef.current = undefined
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
    previewRef.current = undefined
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

  const preview = useCallback((): void => {
    const runPlan = planRef.current
    const startedAt = clock.now()
    timingRef.current = undefined

    // The preview is exactly as long as the thing being graded. `gradedMs`
    // and `pad.expectedMs` are the grader's OWN instants — the same array
    // `gradeGrooveRun` marks against — so the demonstration cannot state a
    // different length, or a different pattern, from the run that follows it.
    // The staff draws the same number as `×N` (`GrooveTrainerScreen` derives
    // it from `gradedBars` too), so all three now agree by construction
    // rather than by three copies of one formula.
    const spanMs = runPlan.gradedMs

    phaseRef.current = 'preview'
    setPhase('preview')
    previewRef.current = { endAt: startedAt + spanMs }

    // One pass of the drawn music, plus a click track under it — both
    // scheduled once against absolute instants on the clock epoch, exactly
    // the discipline `start()` uses above. The persona this screen serves
    // does not already know the groove (see `GrooveTrainerScreen`'s module
    // comment), so hearing it once, at the tempo it will be graded at, is
    // what turns the staff from notation to decode into a pattern to copy.
    const beatsPerBar = Math.max(1, Math.round(runPlan.barMs / runPlan.beatMs))
    const totalBeats = beatsPerBar * runPlan.gradedBars
    withAudio((out) => {
      for (const pad of runPlan.pads) {
        for (const ms of pad.expectedMs) {
          out.strike(pad.pad, PREVIEW_VELOCITY, millis(startedAt + ms))
        }
      }
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
    setResult({ result: graded, bpm: planRef.current.bpm })
    onFinishedRef.current?.(graded)
  }, [])

  const onFrame = useCallback((): void => {
    const now = clock.now()

    const previewTiming = previewRef.current
    if (previewTiming !== undefined) {
      if (now >= previewTiming.endAt) {
        previewRef.current = undefined
        phaseRef.current = 'idle'
        setPhase('idle')
      }
      return
    }

    const timing = timingRef.current
    if (timing === undefined) return
    const runPlan = planRef.current

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
    active: phase === 'count-in' || phase === 'playing' || phase === 'preview',
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
  useEffect(
    () => () => {
      timingRef.current = undefined
      previewRef.current = undefined
    },
    [],
  )

  const beatsPerBar = Math.max(1, Math.round(plan.barMs / plan.beatMs))
  const countInBeats = plan.countInBars * beatsPerBar
  const gradedBeat = beatIndex - countInBeats
  return {
    phase,
    beatIndex,
    countInBeat:
      phase === 'count-in' ? Math.min(countInBeats, Math.max(1, beatIndex + 1)) : 0,
    bar: phase === 'playing' ? Math.min(plan.gradedBars, Math.floor(gradedBeat / beatsPerBar) + 1) : 0,
    result,
    flash,
    start,
    stop,
    hit,
    preview,
  }
}
