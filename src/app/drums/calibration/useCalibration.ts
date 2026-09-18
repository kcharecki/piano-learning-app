/**
 * The latency calibration run (roadmap DR-08): a steady click at
 * `CALIBRATION_BPM`, the learner plays along on any pad for
 * `CALIBRATION_HITS` hits, and the median signed deviation from the nearest
 * click becomes the rig's offset — see `@core/drums/scoring/latency.ts` for
 * the scoring itself.
 *
 * Modelled on `@app/drums/groove/useGrooveRun.ts`'s own discipline: one
 * clock reading at `start()` is the origin everything else derives from, the
 * click track is scheduled one bar ahead per frame rather than re-derived,
 * and a hit is judged by the clock, never by which phase the screen happens
 * to be showing. There is no grading plan here — every pad counts, and the
 * only question a hit answers is "how far from the nearest click".
 *
 * `phase` walks `'idle' -> 'count-in' -> 'collecting' -> 'done'`. The
 * count-in is exactly one bar (`CALIBRATION_BAR_BEATS` beats) so the learner
 * has heard the pulse before anything they play counts — every bar accents
 * its own first beat the same way, not just the count-in's; `collecting`
 * then runs indefinitely — clicks keep scheduling one bar ahead — until the
 * `CALIBRATION_HITS`th hit lands, at which point scheduling stops (the
 * transport loop deactivates the moment `phase` leaves
 * `'count-in'`/`'collecting'`), already-scheduled clicks are silenced the
 * same way `stop()` silences them, and `summary` is computed once, from
 * exactly those hits.
 */
import { useCallback, useRef, useState } from 'react'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDrumAudioOutput } from '@adapters/audio/drumAudio.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { PadFlash } from '@app/drums/groove/useGrooveRun.ts'
import {
  CALIBRATION_BPM,
  CALIBRATION_HITS,
  nearestClickDeviationMs,
  summarizeCalibration,
  type CalibrationSummary,
} from '@core/drums/scoring/latency.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { millis } from '@core/shared/units.ts'

export type CalibrationPhase = 'idle' | 'count-in' | 'collecting' | 'done'

/** Beats to a bar of the calibration click — the count-in is exactly one of these. */
export const CALIBRATION_BAR_BEATS = 4
export const CALIBRATION_BEAT_MS = 60_000 / CALIBRATION_BPM
const CALIBRATION_BAR_MS = CALIBRATION_BEAT_MS * CALIBRATION_BAR_BEATS

/** The velocity a learner's own pad press sounds at — matches `useGrooveRun`'s own `HIT_VELOCITY`. */
const HIT_VELOCITY = 96

export type UseCalibrationOptions = {
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly frameDriver?: FrameDriver
  /**
   * Constant input latency of the rig, ms — same contract as
   * `useGrooveRun`'s option of the same name, subtracted from every hit's
   * clock reading before it is compared to the click grid. Defaults to 0.
   */
  readonly inputOffsetMs?: number
}

export type CalibrationApi = {
  readonly phase: CalibrationPhase
  /** 1-based beat currently sounding within the current bar, 0 outside a run. */
  readonly beat: number
  readonly hits: number
  readonly deviationsMs: readonly number[]
  readonly summary: CalibrationSummary | undefined
  readonly flash: PadFlash | undefined
  start: () => void
  stop: () => void
  hit: (pad: MappedDrumPad) => void
}

export function useCalibration(options: UseCalibrationOptions = {}): CalibrationApi {
  const clockRef = useRef<Clock | undefined>(undefined)
  if (clockRef.current === undefined) clockRef.current = options.clock ?? createBrowserClock()
  const clock = clockRef.current

  const audioFactory = options.audio ?? createDrumAudioOutput
  const audioRef = useRef<DrumAudioOutput | undefined>(undefined)

  const [phase, setPhase] = useState<CalibrationPhase>('idle')
  const [beat, setBeat] = useState(0)
  const [deviationsMs, setDeviationsMs] = useState<readonly number[]>([])
  const [summary, setSummary] = useState<CalibrationSummary | undefined>(undefined)
  const [flash, setFlash] = useState<PadFlash | undefined>(undefined)

  const phaseRef = useRef<CalibrationPhase>('idle')
  const beatIndexRef = useRef(-1)
  const originRef = useRef<number | undefined>(undefined)
  /** How many bars' clicks have been scheduled so far. Only ever advances. */
  const scheduledBarsRef = useRef(0)
  const deviationsRef = useRef<number[]>([])
  const seqRef = useRef(0)
  const inputOffsetMsRef = useRef(options.inputOffsetMs)
  inputOffsetMsRef.current = options.inputOffsetMs

  /** Every call into the audio output goes through here, so none of them can throw into React. */
  const withAudio = useCallback(
    (use: (out: DrumAudioOutput) => void): void => {
      try {
        if (audioRef.current === undefined) audioRef.current = audioFactory()
        use(audioRef.current)
      } catch {
        // Best-effort by design, exactly like `useGrooveRun`.
      }
    },
    [audioFactory],
  )

  const stop = useCallback((): void => {
    originRef.current = undefined
    scheduledBarsRef.current = 0
    deviationsRef.current = []
    beatIndexRef.current = -1
    phaseRef.current = 'idle'
    setPhase('idle')
    setBeat(0)
    setDeviationsMs([])
    setSummary(undefined)
    withAudio((out) => out.allNotesOff())
  }, [withAudio])

  const start = useCallback((): void => {
    const startedAt = clock.now()
    originRef.current = startedAt
    // Bar 0 (the count-in) is scheduled synchronously below; `1` means "bar
    // 0 done", so `onFrame` schedules bar 1 the moment bar 0 opens — exactly
    // `useGrooveRun`'s own `scheduledPassesRef` discipline.
    scheduledBarsRef.current = 1
    deviationsRef.current = []
    beatIndexRef.current = -1
    phaseRef.current = 'count-in'
    setDeviationsMs([])
    setSummary(undefined)
    setBeat(1)
    setPhase('count-in')

    withAudio((out) => {
      for (let b = 0; b < CALIBRATION_BAR_BEATS; b++) {
        out.click(b === 0, millis(startedAt + b * CALIBRATION_BEAT_MS))
      }
    })
  }, [clock, withAudio])

  const onFrame = useCallback((): void => {
    const origin = originRef.current
    if (origin === undefined) return
    const now = clock.now()
    const elapsed = now - origin

    const beatIndex = Math.floor(elapsed / CALIBRATION_BEAT_MS)
    if (beatIndex !== beatIndexRef.current) {
      beatIndexRef.current = beatIndex
      const beatOneBased = Math.max(1, beatIndex + 1)
      setBeat(((beatOneBased - 1) % CALIBRATION_BAR_BEATS) + 1)
    }

    const currentBar = Math.max(0, Math.floor(elapsed / CALIBRATION_BAR_MS))
    if (phaseRef.current === 'count-in' && currentBar >= 1) {
      phaseRef.current = 'collecting'
      setPhase('collecting')
    }

    // The click track, one bar at a time, as far ahead as `now` demands — see
    // `useGrooveRun`'s own loop-mode click scheduling for why this is a
    // `while` (an ordinary stalled frame catches up) with a floor snap (a
    // hidden tab does not replay a pile of missed bars at once).
    scheduledBarsRef.current = Math.max(scheduledBarsRef.current, currentBar)
    while (scheduledBarsRef.current <= currentBar + 1) {
      const barIndex = scheduledBarsRef.current
      const barStart = origin + barIndex * CALIBRATION_BAR_MS
      withAudio((out) => {
        for (let b = 0; b < CALIBRATION_BAR_BEATS; b++) {
          const at = barStart + b * CALIBRATION_BEAT_MS
          if (at < now) continue
          out.click(b === 0, millis(at))
        }
      })
      scheduledBarsRef.current += 1
    }
  }, [clock, withAudio])

  useTransportLoop({
    active: phase === 'count-in' || phase === 'collecting',
    onFrame,
    ...(options.frameDriver === undefined ? {} : { driver: options.frameDriver }),
  })

  const hit = useCallback(
    (pad: MappedDrumPad): void => {
      seqRef.current += 1
      setFlash({ pad, seq: seqRef.current })
      withAudio((out) => out.strike(pad, HIT_VELOCITY))

      // Judged by the clock, never by which phase the screen happens to be
      // showing (see the module comment): only `'idle'` (nothing started)
      // and `'done'` (already scored) have no grid to judge a hit against. A
      // hit inside the half-beat window right before the collecting
      // downbeat — i.e. against the count-in's own last click — still
      // counts, closing the dead zone a phase-state check would leave open.
      if (phaseRef.current === 'idle' || phaseRef.current === 'done') return
      const origin = originRef.current
      if (origin === undefined) return

      const rawOffset = inputOffsetMsRef.current
      const offset = rawOffset !== undefined && Number.isFinite(rawOffset) ? rawOffset : 0
      const hitMs = clock.now() - offset
      if (hitMs < origin + CALIBRATION_BAR_MS - CALIBRATION_BEAT_MS / 2) return

      // The grid is periodic with period `CALIBRATION_BEAT_MS`, and `origin`
      // itself sits on it (the count-in's own accented first beat) — no need
      // to offset to the collecting bar's own downbeat before scoring.
      const deviation = nearestClickDeviationMs(hitMs, origin, CALIBRATION_BEAT_MS)

      const next = [...deviationsRef.current, deviation]
      deviationsRef.current = next
      setDeviationsMs(next)

      if (next.length >= CALIBRATION_HITS) {
        phaseRef.current = 'done'
        beatIndexRef.current = -1
        setPhase('done')
        setBeat(0)
        setSummary(summarizeCalibration(next))
        withAudio((out) => out.allNotesOff())
      }
    },
    [clock, withAudio],
  )

  return {
    phase,
    beat,
    hits: deviationsMs.length,
    deviationsMs,
    summary,
    flash,
    start,
    stop,
    hit,
  }
}
