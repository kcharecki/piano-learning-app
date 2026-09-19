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
 *
 * ## Loop mode (roadmap DR-09 "loop")
 *
 * With `{ loop: true }`, `start()` counts in once and the graded window then
 * repeats back-to-back with no gap and no further count-in until `stop()`.
 * Three things keep the same discipline the rest of this module rests on:
 *
 *  - **The click track is scheduled one pass ahead, never re-derived.**
 *    `start()` schedules the count-in plus the FIRST pass only, against
 *    absolute instants exactly as before. `onFrame` schedules pass `k+1`'s
 *    clicks the moment pass `k` opens — `scheduledPassesRef` only ever
 *    advances, so a beat is never scheduled twice, and a stalled frame
 *    catches up (a `while`, not an `if`) rather than skipping a pass's clicks.
 *  - **A hit is filed by the clock, into the pass the clock says it answers.**
 *    `@core/drums/practice/loop.ts`'s `passOfHit` — not the phase, not which
 *    pass the screen happens to be showing — decides which pass's bucket a
 *    hit lands in, and its ms is stored relative to THAT pass's own origin so
 *    `gradeGrooveRun` never has to know it is being called from a loop.
 *  - **A pass is graded the instant it can be, not when the next one opens.**
 *    `passGradeableAt` is a pass's end plus the window, so pass `k+1` is
 *    already in progress — by design, the windows overlap by `windowMs` — by
 *    the time pass `k` is actually graded. `phase` stays `'playing'` through
 *    every grade; only `stop()` ends a loop run, and every pass that never
 *    got to grade — the one in progress, and any dropped by a stall (below)
 *    — is discarded, never graded.
 *
 * ## History gets one attempt per loop run, not one per pass
 *
 * `onFinished` is the screen's `addAttempt`, capped and persisted — calling
 * it once per pass would let a multi-minute loop run evict half the
 * learner's history in one sitting, and a stalled frame (below) could fire
 * it a dozen times in a single tick. So in loop mode `onFinished` fires
 * exactly ONCE, from `stop()`, with the LAST graded pass's result — the
 * learner's state at the end of the drill — and not at all if no pass ever
 * graded. Per-pass results, for anything that wants them (the live tally),
 * go through the new `onPassGraded` instead, which loop mode calls once per
 * graded pass and non-loop mode never calls. Non-loop `onFinished` is
 * unchanged: it fires once, at the natural end of the one pass it ever runs.
 *
 * ## Stalled frames
 *
 * A hidden tab (or any other large gap between frames) can leave `onFrame`
 * discovering many passes have elapsed at once — the same hazard
 * `useDrumsMetronome` guards against for its click track. Two things would
 * go wrong without a guard: the click-scheduling loop would replay every
 * missed pass's clicks in one frame, almost all of them at instants already
 * in the past (the audio adapter clamps a past instant to "right now", so
 * they would all sound at once); and the grading loop would grade every
 * missed pass as entirely missed, one `onPassGraded` call each. Neither
 * click nor grade is something the learner could have acted on — they were
 * looking at something else — so both are skipped, not played back:
 *
 *  - **Clicks resume at the pass that is ACTUALLY open**, not at the one
 *    after the last one scheduled — `scheduledPassesRef` jumps forward to
 *    `currentPass` before scheduling resumes, and no click is ever scheduled
 *    at an instant that has already passed.
 *  - **A pass discovered more than one whole pass after it became
 *    gradeable is dropped, not graded** — no result, no `onPassGraded`, no
 *    tally change, its hits simply discarded. A pass found only a little
 *    late (an ordinary scheduling jitter, on the order of tens or a couple
 *    hundred milliseconds) still grades normally: the threshold is a whole
 *    extra `gradedMs`, far more than any frame is ever late by outside of a
 *    hidden tab or a debugger pause.
 *
 * ## Per-hit live feedback (roadmap DR-09 "per-hit live feedback")
 *
 * Every hit `hit()` ACCEPTS — the phase/clock acceptance rule above is
 * unchanged — is also judged live, against `@core/drums/practice/
 * liveHit.ts`'s `judgeLiveHit`, and the result is published as `lastHit`.
 * This is deliberately a SEPARATE, provisional read of the same hit stream
 * `grade.ts` grades at the end of the pass: `judgeLiveHit` commits to a
 * verdict the instant a hit lands, with no lookahead, while `grade.ts`'s
 * `pair` sees the whole pass at once. The two can disagree on a hit that
 * arrives out of the order its instants are notated — see `liveHit.ts`'s own
 * module comment — so `lastHit` is a coach, not the marking.
 *
 * A claimed-instant set tracks which of a pad's expected instants live
 * feedback has already spent, so a second hit near an instant already
 * claimed by an earlier one reads against what is actually still open
 * rather than re-claiming the same instant twice. Non-loop keeps ONE such
 * set for the run. Loop mode keeps one PER PASS (`claimedByPassRef`, keyed
 * exactly like `hitsByPassRef`), because passes grade independently and a
 * pass's own claims must not bleed into the next one's; an entry is dropped
 * the moment that pass is graded or discarded as stale, alongside its
 * `hitsByPassRef` entry.
 *
 * `lastHit` resets to `undefined` in `start()` and in `preview()` — a fresh
 * run or a demonstration has nothing yet to report — but NOT in `stop()` and
 * NOT when a pass or a non-loop run finishes: the learner reads the last
 * line after the stick has already landed, and the whole point of `stop()`
 * leaving history intact (see above) applies here too. A rejected hit never
 * touches it. `lastHit` is a single slot, though, and a unison instant —
 * hat and kick together, which is EVERY instant of the default Quarter-Note
 * Rock — has a second accepted hit overwrite the first within the same
 * frame, so `hitByPad` exists alongside it to keep one pad's verdict from
 * erasing another's; it follows the exact same reset/survive rules as
 * `lastHit` above, just keyed by pad instead of holding one slot.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDrumAudioOutput } from '@adapters/audio/drumAudio.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { gradeGrooveRun, type GrooveHit, type GrooveRunResult } from '@core/drums/practice/grade.ts'
import { claimKey, judgeLiveHit, type LiveHitVerdict } from '@core/drums/practice/liveHit.ts'
import { passGradeableAt, passOfHit, passOrigin } from '@core/drums/practice/loop.ts'
import { mutePads } from '@core/drums/practice/mute.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { millis } from '@core/shared/units.ts'
import { mutedStrikes, VOICED_VELOCITY } from './mutedVoices.ts'

/** `UseGrooveRunOptions.muted`'s own default — a stable empty set, never re-allocated per render. */
const NO_MUTED_PADS: ReadonlySet<MappedDrumPad> = new Set()

export type GrooveRunPhase = 'idle' | 'count-in' | 'playing' | 'graded' | 'preview'

/** The pad that was last struck, with a sequence number so two hits in a row still re-trigger the flash. */
export type PadFlash = {
  readonly pad: MappedDrumPad
  readonly seq: number
}

/** One accepted hit's live verdict, with a sequence number so two equal verdicts in a row still re-render. */
export type LiveHit = LiveHitVerdict & { readonly seq: number }

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
  /**
   * Fires once with a run's verdict. Non-loop: the instant that run's one
   * pass grades, exactly as before loop mode existed. Loop: ONLY from
   * `stop()`, with the LAST graded pass's result, and not at all if no pass
   * ever graded — a multi-minute loop run is one attempt in history, not one
   * per pass (see the module comment). Per-pass results in loop mode go to
   * `onPassGraded` instead.
   */
  readonly onFinished?: (result: GrooveRunResult) => void
  /**
   * Loop mode only: fires once per pass, the instant that pass grades, with
   * the pass's own 1-based number. Never called outside loop mode.
   */
  readonly onPassGraded?: (result: GrooveRunResult, pass: number) => void
  /**
   * With loop on, after the single count-in the graded window repeats
   * back-to-back with no gap and no further count-in — see the module
   * comment. Defaults to false; non-loop behaviour is unaffected by this
   * option's presence.
   */
  readonly loop?: boolean
  /**
   * Pads the app voices itself instead of grading (roadmap DR-09 "per-limb
   * mute"). Read once at `start()` and frozen for the run, exactly like
   * `loop` — see the module comment. Ignored by `preview()`, which always
   * plays every pad. Defaults to none.
   */
  readonly muted?: ReadonlySet<MappedDrumPad>
  /** Injection seams. The browser defaults are built lazily, inside the first press. */
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly driver?: FrameDriver
  /**
   * Constant input latency of the rig, ms, positive = hits arrive late;
   * subtracted from every hit's clock reading inside `hit()`. Read live per
   * render through a ref, like `onFinished`. Defaults to 0.
   */
  readonly inputOffsetMs?: number
}

export type GrooveRunApi = {
  readonly phase: GrooveRunPhase
  /** Beats since the run started, count-in included. `-1` before the first frame. */
  readonly beatIndex: number
  /** 1-based beat of the count-in bar currently sounding, or 0 outside the count-in. */
  readonly countInBeat: number
  /** 1-based bar of the graded window CURRENTLY IN PROGRESS, or 0 outside it. */
  readonly bar: number
  /**
   * 1-based pass currently in progress while `phase` is `'playing'`, 0
   * otherwise. Always 1 in non-loop mode while playing — a non-loop run is a
   * one-pass loop run by this reading, which is why the formula is the same
   * for both.
   */
  readonly pass: number
  /** How many passes have been graded this run. 0 outside a loop run; reset on `start()`. */
  readonly passesGraded: number
  /** How many of those graded passes were steady. 0 outside a loop run; reset on `start()`. */
  readonly steadyPasses: number
  readonly result: GradedRun | undefined
  readonly flash: PadFlash | undefined
  /** The most recent ACCEPTED hit's live verdict. See the module comment. */
  readonly lastHit: LiveHit | undefined
  /**
   * Each pad's own most recent accepted verdict — see the module comment on
   * `lastHit` for why this exists alongside it (a unison instant would
   * otherwise cost one of its pads its own colour).
   */
  readonly hitByPad: ReadonlyMap<MappedDrumPad, LiveHit>
  start: () => void
  stop: () => void
  /**
   * Records a stroke for grading, if the engine accepts it right now — see
   * the module comment ("A hit is accepted by the clock, not by the phase").
   * Returns the exact ms this hit was recorded at for grading — the same
   * value pushed into `hitsRef` (non-loop) or a pass's own list in
   * `hitsByPassRef` (loop) — or `undefined` when nothing was recorded: the
   * pad is muted, no run is in progress (idle, before `start()`, or after
   * `finish()`/`stop()`), or the hit landed outside the acceptance window
   * (too early for either mode, or too late for non-loop — loop has no upper
   * bound). The pad still flashes and sounds either way. The base the ms is
   * measured from differs by mode: the graded origin in non-loop mode, the
   * answering pass's own origin in loop mode — never accumulated across
   * passes.
   */
  hit: (pad: MappedDrumPad) => number | undefined
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
  const [pass, setPass] = useState(0)
  const [passesGraded, setPassesGraded] = useState(0)
  const [steadyPasses, setSteadyPasses] = useState(0)
  const [result, setResult] = useState<GradedRun | undefined>(undefined)
  const [flash, setFlash] = useState<PadFlash | undefined>(undefined)
  const [lastHit, setLastHit] = useState<LiveHit | undefined>(undefined)
  /** One entry per pad ever struck this run — see the module comment on `lastHit`. */
  const [hitByPad, setHitByPad] = useState<ReadonlyMap<MappedDrumPad, LiveHit>>(new Map())

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
  const liveHitSeqRef = useRef(0)
  /** Non-loop run's own claimed-instant set — see the module comment. */
  const claimedRef = useRef<Set<string>>(new Set())
  /** Loop mode's claimed-instant set, one per pass, keyed exactly like `hitsByPassRef`. */
  const claimedByPassRef = useRef<Map<number, Set<string>>>(new Map())
  const planRef = useRef(plan)
  planRef.current = plan
  const onFinishedRef = useRef(options.onFinished)
  onFinishedRef.current = options.onFinished
  const onPassGradedRef = useRef(options.onPassGraded)
  onPassGradedRef.current = options.onPassGraded
  const loopOptionRef = useRef(options.loop ?? false)
  loopOptionRef.current = options.loop ?? false
  /** Mirrors `options.muted` every render — frozen into `frozenMutedRef` at `start()`, exactly like `loop`. */
  const mutedRef = useRef(options.muted)
  mutedRef.current = options.muted
  /** Mirrors `options.inputOffsetMs` every render — see the option's own JSDoc. */
  const inputOffsetMsRef = useRef(options.inputOffsetMs)
  inputOffsetMsRef.current = options.inputOffsetMs

  /** Whether the run CURRENTLY IN PROGRESS is looping — frozen at `start()`, since the toggle is disabled while busy. */
  const loopingRef = useRef(false)
  /** The muted set CURRENTLY IN PROGRESS — frozen at `start()`, cleared at `stop()`. */
  const frozenMutedRef = useRef<ReadonlySet<MappedDrumPad>>(NO_MUTED_PADS)
  /** `plan` with every frozen-muted pad removed, computed once at `start()` — what grading reads instead of `planRef`. `undefined` outside a run. */
  const gradingPlanRef = useRef<GrooveRunPlan | undefined>(undefined)
  /** How many passes' click tracks have been scheduled so far. Only ever advances — see the module comment. */
  const scheduledPassesRef = useRef(0)
  /** This run's hits, bucketed by which pass `passOfHit` says they answer, ms relative to THAT pass's own origin. Loop mode only. */
  const hitsByPassRef = useRef<Map<number, GrooveHit[]>>(new Map())
  /** The highest pass index graded so far this run. `-1` means none yet. */
  const gradedThroughRef = useRef(-1)
  /** `pass`'s own guard, exactly like `beatRef` — avoids a `setPass` call on every playing frame when the value has not actually changed. */
  const passRef = useRef(0)
  /** The most recently graded pass's verdict this run, for `stop()` to hand to `onFinished` — see the module comment. `undefined` until a pass has graded. */
  const lastGradedRef = useRef<GrooveRunResult | undefined>(undefined)

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
    // Captured before the reset below clears them: whether THIS run was
    // looping, and the last pass it actually graded, if any — `stop()` is
    // where a loop run's one-and-only `onFinished` call happens (see the
    // module comment).
    const wasLooping = loopingRef.current
    const lastGraded = lastGradedRef.current

    timingRef.current = undefined
    previewRef.current = undefined
    hitsRef.current = []
    hitsByPassRef.current = new Map()
    claimedRef.current = new Set()
    claimedByPassRef.current = new Map()
    gradedThroughRef.current = -1
    scheduledPassesRef.current = 0
    loopingRef.current = false
    frozenMutedRef.current = NO_MUTED_PADS
    gradingPlanRef.current = undefined
    phaseRef.current = 'idle'
    beatRef.current = -1
    passRef.current = 0
    setPhase('idle')
    setBeatIndex(-1)
    setPass(0)
    // `lastHit` is deliberately left alone too, for the same reason — see the
    // module comment: the learner reads it after the stick has landed, and
    // Stop does not un-happen that.
    // `passesGraded`/`steadyPasses` are deliberately left alone: the screen
    // still shows the tally for whatever passes DID get graded before Stop —
    // see the module comment. `start()` is the only place that resets them.
    withAudio((out) => out.allNotesOff())

    // Every pass that never got to grade — the one in progress, and any a
    // stall dropped — is discarded here, not graded retroactively. What DID
    // grade still owes the learner's history exactly one attempt: the last
    // pass, and only if a pass ever actually graded.
    if (wasLooping && lastGraded !== undefined) {
      onFinishedRef.current?.(lastGraded)
    }
  }, [withAudio])

  const start = useCallback((): void => {
    const runPlan = planRef.current
    loopingRef.current = loopOptionRef.current
    // Frozen for the whole run, exactly like `loopingRef` above — the mute
    // switches are disabled while busy for the same reason the loop toggle
    // is: a run must not have its own grading plan pulled out from under it.
    //
    // `mutePads` throws if EVERY plan pad is muted — a run needs at least one
    // graded limb. The screen already disables the last switch to prevent
    // that, but this hook must be total on its own: it must not depend on a
    // caller keeping that promise, and a throw here would escape into a React
    // click handler with `loopingRef`/`frozenMutedRef` already mutated above.
    // So a request that would mute everything is silently treated as muting
    // nothing, rather than thrown.
    const requested = mutedRef.current ?? NO_MUTED_PADS
    const muted = runPlan.pads.every((p) => requested.has(p.pad)) ? NO_MUTED_PADS : requested
    frozenMutedRef.current = muted
    gradingPlanRef.current = mutePads(runPlan, muted)
    const startedAt = clock.now()
    const gradedOrigin = startedAt + runPlan.countInBars * runPlan.barMs
    timingRef.current = { startedAt, gradedOrigin, endAt: gradedOrigin + runPlan.gradedMs }
    previewRef.current = undefined
    hitsRef.current = []
    hitsByPassRef.current = new Map()
    claimedRef.current = new Set()
    claimedByPassRef.current = new Map()
    gradedThroughRef.current = -1
    lastGradedRef.current = undefined
    // Pass 0's clicks are scheduled below, unconditionally; `1` means "pass 0
    // done", so loop mode's onFrame schedules pass 1 the moment pass 0 opens.
    scheduledPassesRef.current = 1
    beatRef.current = -1
    passRef.current = 0
    phaseRef.current = 'count-in'
    setResult(undefined)
    setBeatIndex(-1)
    setPass(0)
    setPassesGraded(0)
    setSteadyPasses(0)
    setLastHit(undefined)
    setHitByPad(new Map())
    setPhase('count-in')

    // The whole click track, scheduled once against absolute instants on the
    // clock epoch. Nothing re-schedules it per frame, so a stalled frame can
    // never move the pulse the learner is playing to. In loop mode this is
    // the count-in plus the FIRST pass only — `onFrame` schedules every pass
    // after it, one pass ahead, the moment the pass before it opens.
    const beatsPerBar = Math.max(1, Math.round(runPlan.barMs / runPlan.beatMs))
    const totalBeats = beatsPerBar * (runPlan.countInBars + runPlan.gradedBars)
    withAudio((out) => {
      for (let beat = 0; beat < totalBeats; beat++) {
        out.click(beat % beatsPerBar === 0, millis(startedAt + beat * runPlan.beatMs))
      }
    })
    // The FIRST pass's muted voices, scheduled alongside the clicks above for
    // the same reason: one origin, nothing re-derived per frame. Later
    // passes' muted voices are scheduled by `onFrame`, one pass ahead,
    // exactly like their own click tracks. Its OWN `withAudio` call, separate
    // from the clicks' above: they share one `DrumAudioOutput`, but a
    // throwing `out.click` must not abort this loop and leave a muted limb
    // silent while still ungraded (best-effort applies to each independently).
    withAudio((out) => {
      for (const strike of mutedStrikes(runPlan, muted, gradedOrigin)) {
        out.strike(strike.pad, VOICED_VELOCITY, millis(strike.atMs))
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
    setLastHit(undefined)
    setHitByPad(new Map())
    previewRef.current = { endAt: startedAt + spanMs }

    // One pass of the drawn music, plus a click track under it — both
    // scheduled once against absolute instants on the clock epoch, exactly
    // the discipline `start()` uses above. The persona this screen serves
    // does not already know the groove (see `GrooveTrainerScreen`'s module
    // comment), so hearing it once, at the tempo it will be graded at, is
    // what turns the staff from notation to decode into a pattern to copy.
    const beatsPerBar = Math.max(1, Math.round(runPlan.barMs / runPlan.beatMs))
    const totalBeats = beatsPerBar * runPlan.gradedBars

    // Flattened across pads and sorted by instant, then by pad name — the
    // same order `mutedStrikes` uses — before any `out.strike` call is made.
    // Scheduling pad by pad instead would call every `hhClosed` strike before
    // any `hhOpen` strike regardless of timing, and a synth that chokes by
    // CALL ORDER (as a hi-hat voice does — a new closed-hat strike cuts off a
    // still-ringing open one) would then never see the open hat's strike
    // arrive after its closed-hat neighbours, so it rings out its full decay
    // instead of being choked where the score says it should be.
    const strikes: { pad: MappedDrumPad; at: number }[] = []
    for (const pad of runPlan.pads) {
      for (const ms of pad.expectedMs) {
        strikes.push({ pad: pad.pad, at: startedAt + ms })
      }
    }
    strikes.sort((a, b) => a.at - b.at || (a.pad < b.pad ? -1 : a.pad > b.pad ? 1 : 0))

    withAudio((out) => {
      for (const strike of strikes) {
        out.strike(strike.pad, PREVIEW_VELOCITY, millis(strike.at))
      }
      for (let beat = 0; beat < totalBeats; beat++) {
        out.click(beat % beatsPerBar === 0, millis(startedAt + beat * runPlan.beatMs))
      }
    })
  }, [clock, withAudio])

  const finish = useCallback((): void => {
    const graded = gradeGrooveRun(gradingPlanRef.current ?? planRef.current, hitsRef.current)
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
    if (phaseRef.current !== 'playing') return

    // `pass` is read straight off the clock — `floor((now - firstOrigin) /
    // gradedMs) + 1` — never off the beat count, for the same reason
    // everything else here is: one origin, every instant derived from it.
    // This is also correct for a non-loop run: it stays 0 until the graded
    // window opens, hits 1 the instant it does, and 1 is all a non-loop run
    // ever needs since it has exactly one pass. Guarded by `passRef` exactly
    // like `beatRef` above it (MINOR b) — otherwise every playing frame,
    // looping or not, calls `setPass` with the same unchanged value.
    const currentPass = Math.max(0, Math.floor((now - timing.gradedOrigin) / runPlan.gradedMs))
    if (currentPass + 1 !== passRef.current) {
      passRef.current = currentPass + 1
      setPass(currentPass + 1)
    }

    if (!loopingRef.current) {
      if (now >= timing.endAt) finish()
      return
    }

    // Loop mode never auto-finishes; only `stop()` ends it.

    // The click track, one pass at a time, as far ahead as `now` demands. A
    // `while` rather than an `if` so an ordinary stalled frame catches up
    // instead of skipping a pass's clicks; `scheduledPassesRef` only ever
    // advances, so a beat is never scheduled twice.
    //
    // CLICK FLOOR (MAJOR 1): a hidden tab can leave `scheduledPassesRef` many
    // passes behind `currentPass` — replaying every pass in between would
    // schedule dozens of clicks in one frame, almost all at instants already
    // in the past (the audio adapter clamps a past instant to "right now",
    // so they would all sound at once). Snapping the floor up to whichever
    // pass is ACTUALLY open resumes the click track there instead; the
    // per-beat `at < now` guard below catches anything still behind even
    // within that one pass's own beats.
    const beatsPerBar = Math.max(1, Math.round(runPlan.barMs / runPlan.beatMs))
    scheduledPassesRef.current = Math.max(scheduledPassesRef.current, currentPass)
    while (scheduledPassesRef.current <= currentPass + 1) {
      const nextPass = scheduledPassesRef.current
      const passStart = timing.gradedOrigin + passOrigin(runPlan, nextPass)
      withAudio((out) => {
        for (let clickBeat = 0; clickBeat < beatsPerBar * runPlan.gradedBars; clickBeat++) {
          const at = passStart + clickBeat * runPlan.beatMs
          // Never schedule a click at an instant already past — the learner
          // could not have heard it, and it would only join the pile-up the
          // floor above exists to prevent.
          if (at < now) continue
          out.click(clickBeat % beatsPerBar === 0, millis(at))
        }
      })
      // This pass's muted voices, one pass ahead exactly like its clicks
      // above — same past-instant guard, same reason. Its OWN `withAudio`
      // call, not shared with the clicks': a throwing `out.click` must not
      // abort this loop and leave a muted limb silent while still ungraded.
      withAudio((out) => {
        for (const strike of mutedStrikes(runPlan, frozenMutedRef.current, passStart)) {
          if (strike.atMs < now) continue
          out.strike(strike.pad, VOICED_VELOCITY, millis(strike.atMs))
        }
      })
      scheduledPassesRef.current += 1
    }

    // Grade every pass that has collected everything it is going to,
    // lowest-first. The next pass is already in progress by the time this
    // fires — the windows overlap by `windowMs` — which is by design; `phase`
    // stays `'playing'` through every grade in a loop run.
    //
    // STALL SNAP (MAJOR 1): a pass discovered more than one whole `gradedMs`
    // after it became gradeable was not merely reported on late — the
    // learner never heard its click track either (see CLICK FLOOR above), so
    // there is nothing honest to grade. It is dropped instead: its hits
    // discarded, `gradedThroughRef` advanced past it, no `setResult`, no
    // `onPassGraded`, no tally change. An ordinary bit of lateness (jitter on
    // the order of tens or a couple hundred milliseconds, nowhere near a
    // whole extra pass) stays well under that threshold and grades exactly
    // as before.
    for (;;) {
      const nextToGrade = gradedThroughRef.current + 1
      const gradeableAt = timing.gradedOrigin + passGradeableAt(runPlan, nextToGrade)
      if (now < gradeableAt) break
      if (now > gradeableAt + runPlan.gradedMs) {
        hitsByPassRef.current.delete(nextToGrade)
        claimedByPassRef.current.delete(nextToGrade)
        gradedThroughRef.current = nextToGrade
        continue
      }
      const hits = hitsByPassRef.current.get(nextToGrade) ?? []
      hitsByPassRef.current.delete(nextToGrade)
      claimedByPassRef.current.delete(nextToGrade)
      gradedThroughRef.current = nextToGrade
      const graded = gradeGrooveRun(gradingPlanRef.current ?? runPlan, hits)
      setResult({ result: graded, bpm: runPlan.bpm })
      lastGradedRef.current = graded
      onPassGradedRef.current?.(graded, nextToGrade + 1)
      setPassesGraded((n) => n + 1)
      if (graded.steady) setSteadyPasses((n) => n + 1)
    }
  }, [clock, finish, withAudio])

  useTransportLoop({
    active: phase === 'count-in' || phase === 'playing' || phase === 'preview',
    onFrame,
    ...(driver === undefined ? {} : { driver }),
  })

  /** Publishes an accepted hit's verdict to both `lastHit` and `hitByPad` — see the module comment. */
  const publishLiveHit = useCallback((pad: MappedDrumPad, verdict: LiveHitVerdict): void => {
    liveHitSeqRef.current += 1
    const liveHit: LiveHit = { ...verdict, seq: liveHitSeqRef.current }
    setLastHit(liveHit)
    setHitByPad((prev) => {
      const next = new Map(prev)
      next.set(pad, liveHit)
      return next
    })
  }, [])

  const hit = useCallback(
    (pad: MappedDrumPad): number | undefined => {
      seqRef.current += 1
      setFlash({ pad, seq: seqRef.current })
      sound(pad)
      // A muted pad still flashes and sounds (above) — that is what tells the
      // learner their own tap on it still registers as a stroke — but it is
      // never recorded and never gets a live verdict, in or out of a run.
      if (frozenMutedRef.current.has(pad)) return undefined

      const timing = timingRef.current
      if (timing === undefined) return undefined
      const runPlan = planRef.current
      const gradingPlan = gradingPlanRef.current ?? runPlan
      const rawOffset = inputOffsetMsRef.current
      const offset = rawOffset !== undefined && Number.isFinite(rawOffset) ? rawOffset : 0
      const now = clock.now() - offset
      if (now < timing.gradedOrigin - runPlan.windowMs) return undefined

      // Loop mode has no upper bound on acceptance — a loop run only ends at
      // Stop — and files the hit by which pass the CLOCK says it answers,
      // never by which pass the screen happens to be showing.
      if (loopingRef.current) {
        const relative = now - timing.gradedOrigin
        // The boundary rule ("file a hit to the pass whose nearest notated
        // instant is nearer") must consult the GRADER's own instants — a
        // muted pad's instants are not in `gradingPlan` and must not pull a
        // boundary hit toward a pass by a note nobody is grading there.
        const passIndex = passOfHit(gradingPlan, relative)
        const list = hitsByPassRef.current.get(passIndex) ?? []
        const passMs = relative - passOrigin(gradingPlan, passIndex)
        list.push({ pad, ms: passMs })
        hitsByPassRef.current.set(passIndex, list)

        const claimed = claimedByPassRef.current.get(passIndex) ?? new Set<string>()
        const verdict = judgeLiveHit(gradingPlan, pad, passMs, claimed)
        if (verdict.instantIndex !== undefined) claimed.add(claimKey(pad, verdict.instantIndex))
        claimedByPassRef.current.set(passIndex, claimed)
        publishLiveHit(pad, verdict)
        return passMs
      }

      if (now > timing.endAt + runPlan.windowMs) return undefined
      const ms = now - timing.gradedOrigin
      hitsRef.current.push({ pad, ms })

      const verdict = judgeLiveHit(gradingPlan, pad, ms, claimedRef.current)
      if (verdict.instantIndex !== undefined)
        claimedRef.current.add(claimKey(pad, verdict.instantIndex))
      publishLiveHit(pad, verdict)
      return ms
    },
    [clock, sound, publishLiveHit],
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
  // `bar` is the bar within whichever pass is CURRENTLY open, so it wraps at
  // the pass boundary in a loop run rather than counting past `gradedBars`.
  // A non-loop run's `gradedBeat` never reaches `beatsPerPass` while playing
  // (the run finishes first), so the modulo is a no-op there — this is the
  // same formula for both.
  const beatsPerPass = Math.max(1, beatsPerBar * plan.gradedBars)
  const gradedBeatInPass = ((gradedBeat % beatsPerPass) + beatsPerPass) % beatsPerPass
  return {
    phase,
    beatIndex,
    countInBeat: phase === 'count-in' ? Math.min(countInBeats, Math.max(1, beatIndex + 1)) : 0,
    bar:
      phase === 'playing'
        ? Math.min(plan.gradedBars, Math.floor(gradedBeatInPass / beatsPerBar) + 1)
        : 0,
    pass: phase === 'playing' ? pass : 0,
    passesGraded,
    steadyPasses,
    result,
    flash,
    lastHit,
    hitByPad,
    start,
    stop,
    hit,
    preview,
  }
}
