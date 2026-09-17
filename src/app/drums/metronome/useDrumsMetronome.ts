/**
 * Drums metronome (roadmap DR-12): a click engine layered with subdivision
 * accents, click placement, gap-click return-drift grading, random mute and a
 * bar-stepped tempo ramp — all driven off the same `clicksInRange` grid
 * (`@core/timing/metronome.ts`) shaped through `@core/timing/clickFilters.ts`.
 * Fixed 4/4 — this slice has no configurable meter. The pure musical-time
 * arithmetic (ramp resolution, bar crossings, tick decomposition, the return
 * window) lives in `@core/timing/metronomeRun.ts`; this file is the effectful
 * shell around it — React state, the `Clock`/`Rng`/`DrumAudioOutput` ports,
 * and the frame pump.
 *
 * ## Scheduling: one fixed origin, one growing `TempoMap`, a real look-ahead
 *
 * The obvious way to ramp tempo is to re-anchor `originMs`/`posTick` at every
 * bar boundary the ramp fires on, the way `useMetronome.ts` re-anchors on an
 * ad-hoc `setBpm`. That fights the dispatch formula this slice is scheduled
 * against — `audio.click(c.accented, millis(startedAt + c.ms), c.gain)`, one
 * constant `startedAt`. Ticks are already tempo-independent, so a ramp does
 * not need re-anchoring: it needs one more `TempoMark` appended to a single,
 * monotonically-growing `TempoMap` — exactly the piecewise-linear design
 * `@core/timing/tempo.ts` already supports. `originMs` is captured once in
 * `start()` and never touched again; every click's wall time is
 * `originMs + tickToMs(tempoMap, tick)`.
 *
 * An adversarial review caught the trap that fixed origin sets: resolving the
 * schedule up to "now" and dispatching everything crossed hands every click a
 * wall time at or before `clock.now()` — already in the past by the time the
 * real audio adapter sees it, which clamps it to `ctx.currentTime` and
 * collapses a whole frame's clicks into one sound. `useMetronome.ts` (the
 * piano one) sidesteps this by anchoring each frame's dispatch on the WINDOW
 * START rather than the true origin; this hook keeps the fixed origin (the
 * ramp needs it) and instead resolves a genuine look-ahead window each frame
 * — `[scheduledTick, tickAt(now + LOOKAHEAD_MS))` — so every dispatched click
 * is scheduled `LOOKAHEAD_MS` or less into the future, never the past. The
 * on-screen bar/beat/silent readout tracks a SEPARATE tick resolved from the
 * real `now` (not the look-ahead), so the UI reports where the beat actually
 * is, not where the audio has been scheduled to.
 *
 * A large gap between frames (a backgrounded tab suspending rAF) must not
 * replay the backlog: if the real-time tick has jumped more than one bar
 * since the last frame, `flush` snaps straight to "now" — no dispatch, no
 * catch-up burst — the same one-bar cap `useMetronome.ts` uses.
 *
 * ## Random mute cannot be called fresh every frame
 *
 * `randomMuteClicks` draws one `rng.next()` per bar it sees, in ascending bar
 * order, on every call. Called with only one frame's slice of clicks — which,
 * once a bar spans multiple frames (any subdivision > 1 typically does, and
 * even subdivision 1 can if a frame lands mid-bar), is every frame that bar
 * reappears in — it would redraw, and could flip, the same bar's decision
 * mid-bar. `applyMemoMute` below wraps it: a `Map<bar, boolean>` records the
 * decision the first time a bar is seen, for the life of the run, and every
 * later click of that bar reuses it instead of asking again. Entries older
 * than the bar just displayed are pruned so the map does not grow unbounded
 * over a long run.
 *
 * ## The return report is graded on a later frame, not the crossing frame
 *
 * A learner can tap AFTER the return bar's downbeat has already sounded —
 * the whole point of grading "late" as well as "early" — so the report
 * cannot be computed the instant the schedule crosses into the return bar
 * (that frame has not seen a late tap yet, by definition). Crossing the
 * return bar instead arms `pendingReturnRef` (bar, downbeat, window); a
 * later `flush`, once real time has actually passed the window's end, reads
 * every tap and lets `returnDriftMs` pick the nearest one inside the window.
 */
import {
  BAR_TICKS,
  BEAT_TICKS,
  DEFAULT_BPM,
  DEFAULT_GAP,
  DEFAULT_PLACEMENT,
  DEFAULT_SUBDIVISION_VOLUME,
  TIME_SIGNATURE,
  clamp01,
  clampBpm,
  validateGapBars,
  validatePlacement,
  validateRamp,
  type DrumSubdivision,
  type DrumsRampSettings,
} from '@app/drums/metronome/drumsMetronomeSettings.ts'
import { createBrowserClock } from '@app/practice/clock.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import { createDrumAudioOutput } from '@adapters/audio/drumAudio.ts'
import type { Clock, DrumAudioOutput, Rng } from '@core/ports/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import {
  gapClicks,
  isSilentBar,
  placeClicks,
  returnDriftMs,
  voiceClicks,
  type ClickPlacement,
  type GapClickSchedule,
} from '@core/timing/clickFilters.ts'
import {
  clicksInRange,
  validateMetronomeSettings,
  type Click,
  type MetronomeSettings,
} from '@core/timing/metronome.ts'
import {
  appendTempoMark,
  barCrossingRange,
  nextRampBarAfter,
  resolveRampStep,
  returnWindowMs,
  tickToBarBeat,
  type RampConfig,
} from '@core/timing/metronomeRun.ts'
import {
  makeTempoMap,
  tickToMs,
  msToTick,
  type TempoMap,
  type TempoMark,
} from '@core/timing/tempo.ts'
import { millis, ticks, type Bpm } from '@core/shared/units.ts'
import { useRef, useState } from 'react'

/** The dial's bounds and setting types live in `drumsMetronomeSettings.ts`; re-exported so the screen has one import. */
export {
  DRUMS_MAX_BPM,
  DRUMS_MIN_BPM,
  MAX_EVERY_N_BARS,
  MAX_GAP_BARS,
  MAX_RAMP_STEP_BPM,
  MIN_EVERY_N_BARS,
  MIN_GAP_BARS,
  MIN_RAMP_STEP_BPM,
  type DrumSubdivision,
  type DrumsRampSettings,
  type GapSchedule,
} from '@app/drums/metronome/drumsMetronomeSettings.ts'

/**
 * How far ahead of `clock.now()` each frame schedules clicks — the fix for
 * the adversarial review's BLOCKER 1 (see the module comment). 100 ms is
 * comfortably more than one frame's real-time gap at any plausible frame
 * rate, so the scheduling tick always leads the display tick by roughly this
 * much, and comfortably less than the shortest musically-relevant gap this
 * slice ever schedules (a subdivision-4 click at the 240 bpm ceiling is still
 * ~62 ms apart), so it never bundles two clicks that should sound distinct.
 */
const LOOKAHEAD_MS = 100

/**
 * Bounds the ramp-resolution loop's iteration count and the look-ahead
 * window's tick span. The primary defence against a hidden-tab backlog is
 * the one-bar real-time catch-up cap in `flush` (BLOCKER 2); this is a
 * secondary guard so a pathological ramp (`everyBars: 1` at the fastest
 * tempo) still cannot spin the resolution loop unbounded.
 */
const MAX_CATCHUP_BARS = 512

/** `driftMs` is `undefined` when no tap landed near the return bar's downbeat. */
export type ReturnReport = { readonly bar: number; readonly driftMs: number | undefined }

export type UseDrumsMetronomeOptions = {
  readonly clock?: Clock
  readonly audio?: DrumAudioOutput
  readonly driver?: FrameDriver
  readonly rng?: Rng
  readonly initialBpm?: number
}

export type DrumsMetronomeApi = {
  readonly running: boolean
  readonly bpm: Bpm
  readonly subdivision: DrumSubdivision
  readonly placement: ClickPlacement
  readonly gap: GapClickSchedule
  readonly muteProbability: number
  readonly subdivisionVolume: number
  readonly ramp: DrumsRampSettings
  /** 0-based bar since `start()`; -1 while not running. */
  readonly bar: number
  /** 0-based beat within the bar. */
  readonly beat: number
  readonly silentBar: boolean
  readonly lastReturn: ReturnReport | undefined
  /** Set when a proposed change is out of range; the change is rejected. */
  readonly error: string | undefined
  readonly start: () => void
  readonly stop: () => void
  /** Record a tap now — used to grade the return from a silent (gap) bar. */
  readonly tap: () => void
  readonly setBpm: (bpm: number) => void
  readonly setSubdivision: (subdivision: DrumSubdivision) => void
  readonly setPlacement: (placement: ClickPlacement) => void
  readonly setGap: (gap: GapClickSchedule) => void
  readonly setMuteProbability: (p: number) => void
  readonly setSubdivisionVolume: (v: number) => void
  readonly setRamp: (ramp: DrumsRampSettings) => void
}

type Draft = {
  /** MAJOR 2: `start()` reads this, never the `bpmState` render closure — see `start`. */
  readonly bpm: Bpm
  readonly subdivision: DrumSubdivision
  readonly placement: ClickPlacement
  readonly gap: GapClickSchedule
  readonly muteProbability: number
  readonly subdivisionVolume: number
  readonly ramp: DrumsRampSettings
}

/** A pending gap-click return, armed at the crossing, graded on a later frame — see the module comment. */
type PendingReturn = {
  readonly bar: number
  readonly downbeatMs: number
  readonly windowMs: number
}

export function useDrumsMetronome(options: UseDrumsMetronomeOptions = {}): DrumsMetronomeApi {
  const browserClockRef = useRef<Clock | undefined>(undefined)
  if (browserClockRef.current === undefined) browserClockRef.current = createBrowserClock()
  const clock = options.clock ?? browserClockRef.current

  // Edge-of-the-app seeding (never used inside a decision, only to construct
  // the default port) — same allowance `createBrowserClock`'s callers rely on.
  const defaultRngRef = useRef<Rng | undefined>(undefined)
  if (defaultRngRef.current === undefined) defaultRngRef.current = seededRng(Date.now())
  const rng = options.rng ?? defaultRngRef.current

  const initialBpm = clampBpm(options.initialBpm ?? DEFAULT_BPM)

  const [bpmState, setBpmState] = useState<Bpm>(initialBpm)
  const [subdivisionState, setSubdivisionState] = useState<DrumSubdivision>(1)
  const [placementState, setPlacementState] = useState<ClickPlacement>(DEFAULT_PLACEMENT)
  const [gapState, setGapState] = useState<GapClickSchedule>(DEFAULT_GAP)
  const [muteProbabilityState, setMuteProbabilityState] = useState(0)
  const [subdivisionVolumeState, setSubdivisionVolumeState] = useState(DEFAULT_SUBDIVISION_VOLUME)
  const [rampState, setRampState] = useState<DrumsRampSettings>(undefined)
  const [running, setRunning] = useState(false)
  const [bar, setBar] = useState(-1)
  const [beat, setBeat] = useState(0)
  const [silentBar, setSilentBar] = useState(false)
  const [lastReturn, setLastReturn] = useState<ReturnReport | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const runningRef = useRef(running)
  runningRef.current = running

  // The authoritative draft every setter reads and the frame pump acts on —
  // written synchronously so two setters called in one tick compose, exactly
  // `useMetronome.ts`'s `apply`/`draftRef` pattern (see its module comment).
  // `bpm` lives here too (MAJOR 2): `start()` must see a `setBpm` call made
  // earlier in the same tick, and the render closure's `bpmState` is exactly
  // as stale in-tick as the draft it replaced.
  const draftRef = useRef<Draft>({
    bpm: initialBpm,
    subdivision: 1,
    placement: DEFAULT_PLACEMENT,
    gap: DEFAULT_GAP,
    muteProbability: 0,
    subdivisionVolume: DEFAULT_SUBDIVISION_VOLUME,
    ramp: undefined,
  })

  const marksRef = useRef<readonly TempoMark[]>([{ tick: ticks(0), bpm: initialBpm }])
  const tempoMapRef = useRef<TempoMap>(makeTempoMap(marksRef.current))
  const currentRampBpmRef = useRef<Bpm>(initialBpm)

  function rebuildSettings(subdivision: DrumSubdivision): MetronomeSettings {
    return {
      bpm: currentRampBpmRef.current,
      timeSignature: TIME_SIGNATURE,
      subdivision,
      tempo: tempoMapRef.current,
    }
  }

  const settingsRef = useRef<MetronomeSettings>(rebuildSettings(1))
  /** Next bar the ramp is due to check, `Infinity` while no ramp is armed. */
  const rampCursorRef = useRef(Number.POSITIVE_INFINITY)

  /** The last tick SCHEDULED to `DrumAudioOutput` — the look-ahead horizon, only ever moves forward. */
  const scheduledTickRef = useRef(0)
  /** The last tick resolved from the REAL clock — what the on-screen readout tracks, only ever moves forward. */
  const elapsedTickRef = useRef(0)
  /** The clock instant tick 0 is anchored to — captured once in `start()`. */
  const originMsRef = useRef(0)
  const tapsRef = useRef<number[]>([])
  /** Wall time the current silent stretch began, `undefined` outside one. */
  const offRunStartMsRef = useRef<number | undefined>(undefined)
  /** Armed at the return-bar crossing, graded (and cleared) on a later frame — see the module comment. */
  const pendingReturnRef = useRef<PendingReturn | undefined>(undefined)
  const muteDecisionsRef = useRef<Map<number, boolean>>(new Map())

  const audioRef = useRef<DrumAudioOutput | undefined>(options.audio)
  if (options.audio !== undefined) audioRef.current = options.audio

  /** Best-effort: an audio adapter glitch must not break the transport loop. */
  function withAudio(fn: (audio: DrumAudioOutput) => void): void {
    const audio = audioRef.current
    if (audio === undefined) return
    try {
      fn(audio)
    } catch {
      // Swallowed deliberately — see the doc comment above.
    }
  }

  /** One rng draw per bar, the first time that bar is seen — see the module comment. */
  function applyMemoMute(clicks: readonly Click[], probability: number): readonly Click[] {
    if (probability <= 0) return clicks
    const bars = [...new Set(clicks.filter((c) => c.bar >= 0).map((c) => c.bar))].sort(
      (a, b) => a - b,
    )
    for (const b of bars) {
      if (!muteDecisionsRef.current.has(b)) {
        muteDecisionsRef.current.set(b, rng.next() < probability)
      }
    }
    return clicks.filter((c) => !(c.bar >= 0 && muteDecisionsRef.current.get(c.bar) === true))
  }

  /**
   * Stop the run AND surface an error, instead of the transport loop dying
   * silently mid-`rAF` (MAJOR 3). Distinct from `stop()`, which is the
   * learner's own, error-free Stop button.
   */
  function haltWithError(message: string): void {
    runningRef.current = false
    setRunning(false)
    setBar(-1)
    setBeat(0)
    setSilentBar(false)
    setError(message)
    withAudio((audio) => audio.allNotesOff())
  }

  /** Advance the schedule and the display position to `nowMs`; see the module comment for the design. */
  function flush(nowMs: number): void {
    if (!runningRef.current) return
    try {
      const prevElapsedTick = elapsedTickRef.current
      const rawElapsedTick = msToTick(tempoMapRef.current, millis(nowMs - originMsRef.current))
      const elapsedTick = Math.max(prevElapsedTick, rawElapsedTick)

      // BLOCKER 2: a hidden tab (or any other large frame gap) must not
      // replay a huge backlog — up to `MAX_CLICKS` clicks in a single frame,
      // in the old design. If real time jumped more than one bar since the
      // last frame, snap the schedule and the readout straight to "now",
      // re-seat the ramp cursor from the bar we landed in, and dispatch
      // nothing this frame.
      if (elapsedTick - prevElapsedTick > BAR_TICKS) {
        elapsedTickRef.current = elapsedTick
        scheduledTickRef.current = elapsedTick
        const currentBar = Math.floor(elapsedTick / BAR_TICKS)
        const ramp = draftRef.current.ramp
        rampCursorRef.current =
          ramp === undefined
            ? Number.POSITIVE_INFINITY
            : nextRampBarAfter(currentBar - 1, ramp.everyBars)
        const { beat: catchupBeat } = tickToBarBeat(elapsedTick, BAR_TICKS, BEAT_TICKS)
        setBar(currentBar)
        setBeat(catchupBeat)
        setSilentBar(isSilentBar(currentBar, draftRef.current.gap))
        return
      }
      elapsedTickRef.current = elapsedTick

      // BLOCKER 1: resolve a genuine look-ahead window, not "now" — every
      // click dispatched below therefore gets a wall time up to
      // `LOOKAHEAD_MS` in the FUTURE, never at or before `nowMs`.
      const prevScheduledTick = scheduledTickRef.current
      const lookaheadMs = millis(nowMs + LOOKAHEAD_MS - originMsRef.current)
      const maxTick = prevScheduledTick + MAX_CATCHUP_BARS * BAR_TICKS
      let targetTick = Math.max(
        prevScheduledTick,
        Math.min(msToTick(tempoMapRef.current, lookaheadMs), maxTick),
      )

      // Resolve the ramp against the look-ahead tick: while a bar at or
      // before the window's far edge has not yet had its step applied,
      // apply it (append one TempoMark at that bar's own downbeat) and
      // re-resolve — raising (or lowering) the tempo can itself pull more or
      // fewer bars into the window.
      for (let guard = 0; guard < MAX_CATCHUP_BARS + 1; guard++) {
        const ramp = draftRef.current.ramp
        if (ramp === undefined) break
        const barHigh = Math.floor(targetTick / BAR_TICKS)
        const rampConfig: RampConfig = ramp
        const step = resolveRampStep(
          marksRef.current,
          currentRampBpmRef.current,
          rampConfig,
          rampCursorRef.current,
          barHigh,
          BAR_TICKS,
        )
        if (step === undefined) break
        rampCursorRef.current = step.nextCursor
        if (step.bpm !== currentRampBpmRef.current) {
          currentRampBpmRef.current = step.bpm
          marksRef.current = step.marks
          tempoMapRef.current = makeTempoMap(marksRef.current)
          settingsRef.current = rebuildSettings(draftRef.current.subdivision)
          setBpmState(step.bpm)
        }
        targetTick = Math.max(
          prevScheduledTick,
          Math.min(
            msToTick(tempoMapRef.current, millis(nowMs + LOOKAHEAD_MS - originMsRef.current)),
            maxTick,
          ),
        )
      }

      const newTick = targetTick
      if (newTick > prevScheduledTick) {
        const rawClicks = clicksInRange(
          settingsRef.current,
          ticks(prevScheduledTick),
          ticks(newTick),
        )
        const placed = placeClicks(rawClicks, draftRef.current.placement)
        const gapped =
          draftRef.current.gap.offBars === 0 ? placed : gapClicks(placed, draftRef.current.gap)
        const muted = applyMemoMute(gapped, draftRef.current.muteProbability)
        const voiced = voiceClicks(muted, {
          beat: 1,
          subdivision: draftRef.current.subdivisionVolume,
        })

        withAudio((audio) => {
          for (const c of voiced)
            audio.click(c.accented, millis(originMsRef.current + c.ms), c.gain)
        })

        scheduledTickRef.current = newTick

        // Bar-transition pass (gap entry / return-window arming), off the
        // (now final) tempo map, scheduled ahead of real time exactly like
        // the clicks above — every value it records is a genuine wall-clock
        // instant computed off the fixed `originMs` + `tempoMap`, so
        // recording it early only means it is known sooner, not that it is
        // wrong (MAJOR 1's fix is in when the REPORT is emitted, below, not
        // in when this arming happens).
        const gap = draftRef.current.gap
        const { from: barFrom, to: barTo } = barCrossingRange(prevScheduledTick, newTick, BAR_TICKS)
        for (let b = barFrom; b <= barTo; b++) {
          const silentPrev = isSilentBar(b - 1, gap)
          const silentNow = isSilentBar(b, gap)
          if (!silentPrev && silentNow) {
            offRunStartMsRef.current =
              originMsRef.current + tickToMs(tempoMapRef.current, ticks(b * BAR_TICKS))
          } else if (silentPrev && !silentNow) {
            const downbeatMs =
              originMsRef.current + tickToMs(tempoMapRef.current, ticks(b * BAR_TICKS))
            const windowMs = returnWindowMs(tempoMapRef.current, b, BAR_TICKS, BEAT_TICKS)
            pendingReturnRef.current = { bar: b, downbeatMs, windowMs }
          }
        }

        // MINOR c: a mute decision more than one bar behind the schedule can
        // never be asked for again — drop it so a long run's map does not
        // grow unbounded.
        const scheduledBar = Math.floor(newTick / BAR_TICKS)
        for (const key of muteDecisionsRef.current.keys()) {
          if (key < scheduledBar - 1) muteDecisionsRef.current.delete(key)
        }
      }

      // MAJOR 1: emit the deferred return report once real time has actually
      // passed the grading window's end, not at the frame that merely
      // scheduled the crossing — a late tap needs the chance to arrive first.
      // `returnDriftMs` itself picks the nearest hit inside `[downbeatMs -
      // windowMs, downbeatMs + windowMs]`, so passing every recorded tap is
      // correct, not just the ones after the stretch began.
      const pending = pendingReturnRef.current
      if (pending !== undefined && nowMs > pending.downbeatMs + pending.windowMs) {
        setLastReturn({
          bar: pending.bar,
          driftMs: returnDriftMs(pending.downbeatMs, tapsRef.current, pending.windowMs),
        })
        pendingReturnRef.current = undefined
      }

      // The on-screen readout tracks REAL elapsed time, not the look-ahead
      // schedule — see the module comment.
      const { bar: finalBar, beat: finalBeat } = tickToBarBeat(elapsedTick, BAR_TICKS, BEAT_TICKS)
      const mutedBar = muteDecisionsRef.current.get(finalBar) === true
      setBar(finalBar)
      setBeat(finalBeat)
      // MINOR d: a randomly-muted bar reads as silent too — the learner
      // hears no click either way and should keep time the same way a
      // gap-scheduled silent bar asks.
      setSilentBar(isSilentBar(finalBar, draftRef.current.gap) || mutedBar)
    } catch (e) {
      haltWithError(e instanceof Error ? e.message : String(e))
    }
  }

  useTransportLoop({
    active: running,
    onFrame: () => flush(clock.now()),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
  })

  function start(): void {
    // MAJOR 2: read the bpm the draft holds RIGHT NOW, not the `bpmState`
    // render closure — a `setBpm` earlier in the same tick has already
    // updated `draftRef` synchronously, but React has not re-rendered yet.
    const targetBpm = draftRef.current.bpm
    const initialMarks: readonly TempoMark[] = [{ tick: ticks(0), bpm: targetBpm }]
    const initialMap = makeTempoMap(initialMarks)
    const settings: MetronomeSettings = {
      bpm: targetBpm,
      timeSignature: TIME_SIGNATURE,
      subdivision: draftRef.current.subdivision,
      tempo: initialMap,
    }
    const validated = validateMetronomeSettings(settings)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setError(undefined)
    if (audioRef.current === undefined) audioRef.current = createDrumAudioOutput()
    marksRef.current = initialMarks
    tempoMapRef.current = initialMap
    currentRampBpmRef.current = targetBpm
    settingsRef.current = settings
    const ramp = draftRef.current.ramp
    rampCursorRef.current =
      ramp === undefined ? Number.POSITIVE_INFINITY : nextRampBarAfter(-1, ramp.everyBars)
    scheduledTickRef.current = 0
    elapsedTickRef.current = 0
    originMsRef.current = clock.now()
    tapsRef.current = []
    offRunStartMsRef.current = undefined
    pendingReturnRef.current = undefined
    muteDecisionsRef.current = new Map()
    setLastReturn(undefined)
    setBpmState(targetBpm)
    setBar(0)
    setBeat(0)
    setSilentBar(isSilentBar(0, draftRef.current.gap))
    setRunning(true)
  }

  function stop(): void {
    // Flip the ref before `setRunning` — `flush` reads `runningRef`, not
    // `running`, so a frame landing between this call and the next commit
    // sees "stopped" immediately.
    runningRef.current = false
    setRunning(false)
    setBar(-1)
    setBeat(0)
    setSilentBar(false)
    withAudio((audio) => audio.allNotesOff())
  }

  function tap(): void {
    const now = clock.now()
    // MINOR c: drop taps that can no longer matter — older than the start of
    // the current silent stretch — so a long-running session's tap log does
    // not grow unbounded. MINOR a: `offRunStartMsRef` can be `undefined`
    // here (no silent stretch has been entered as a tick-crossing since the
    // gap schedule last changed mid-run — see `setGap`); fall back to the
    // downbeat of the bar the readout is currently showing.
    const fallbackCutoff =
      originMsRef.current +
      tickToMs(
        tempoMapRef.current,
        ticks(Math.floor(elapsedTickRef.current / BAR_TICKS) * BAR_TICKS),
      )
    const cutoff = offRunStartMsRef.current ?? fallbackCutoff
    tapsRef.current = [...tapsRef.current.filter((t) => t >= cutoff), now]
  }

  function setBpm(n: number): void {
    const clamped = clampBpm(n)
    const targetTick = runningRef.current ? scheduledTickRef.current : 0
    // Append at the scheduling edge; never rewrite an earlier mark (see
    // `appendTempoMark`'s comment for why coalescing is a timing bug).
    const candidateMarks = appendTempoMark(marksRef.current, targetTick, clamped)
    const candidateMap = makeTempoMap(candidateMarks)
    const candidateSettings: MetronomeSettings = {
      bpm: clamped,
      timeSignature: TIME_SIGNATURE,
      subdivision: draftRef.current.subdivision,
      tempo: candidateMap,
    }
    const validated = validateMetronomeSettings(candidateSettings)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setError(undefined)
    marksRef.current = candidateMarks
    tempoMapRef.current = candidateMap
    currentRampBpmRef.current = clamped
    settingsRef.current = candidateSettings
    draftRef.current = { ...draftRef.current, bpm: clamped }
    setBpmState(clamped)
  }

  function setSubdivision(s: DrumSubdivision): void {
    const candidateSettings = rebuildSettings(s)
    const validated = validateMetronomeSettings(candidateSettings)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setError(undefined)
    draftRef.current = { ...draftRef.current, subdivision: s }
    settingsRef.current = candidateSettings
    setSubdivisionState(s)
  }

  function setPlacement(p: ClickPlacement): void {
    const placementError = validatePlacement(p)
    if (placementError !== undefined) {
      setError(placementError)
      return
    }
    setError(undefined)
    draftRef.current = { ...draftRef.current, placement: p }
    setPlacementState(p)
  }

  function setGap(g: GapClickSchedule): void {
    const gapError = validateGapBars(g)
    if (gapError !== undefined) {
      setError(gapError)
      return
    }
    setError(undefined)
    draftRef.current = { ...draftRef.current, gap: g }
    setGapState(g)
    // MINOR a: a gap schedule changed mid-run can make the CURRENT bar
    // silent (or sounding) without a tick-crossing ever having fired to set
    // (or clear) `offRunStartMsRef` — clear it so `tap()`'s pruning falls
    // back to the current bar's downbeat instead of pruning against a
    // stretch that may no longer describe reality.
    offRunStartMsRef.current = undefined
  }

  function setMuteProbability(p: number): void {
    const clamped = clamp01(p)
    draftRef.current = { ...draftRef.current, muteProbability: clamped }
    setMuteProbabilityState(clamped)
  }

  function setSubdivisionVolume(v: number): void {
    const clamped = clamp01(v)
    draftRef.current = { ...draftRef.current, subdivisionVolume: clamped }
    setSubdivisionVolumeState(clamped)
  }

  function setRamp(r: DrumsRampSettings): void {
    const rampError = validateRamp(r)
    if (rampError !== undefined) {
      setError(rampError)
      return
    }
    setError(undefined)
    draftRef.current = { ...draftRef.current, ramp: r }
    setRampState(r)
    if (r === undefined) {
      rampCursorRef.current = Number.POSITIVE_INFINITY
    } else {
      const currentBar = runningRef.current ? Math.floor(scheduledTickRef.current / BAR_TICKS) : -1
      rampCursorRef.current = nextRampBarAfter(currentBar, r.everyBars)
    }
  }

  return {
    running,
    bpm: bpmState,
    subdivision: subdivisionState,
    placement: placementState,
    gap: gapState,
    muteProbability: muteProbabilityState,
    subdivisionVolume: subdivisionVolumeState,
    ramp: rampState,
    bar,
    beat,
    silentBar,
    lastReturn,
    error,
    start,
    stop,
    tap,
    setBpm,
    setSubdivision,
    setPlacement,
    setGap,
    setMuteProbability,
    setSubdivisionVolume,
    setRamp,
  }
}
