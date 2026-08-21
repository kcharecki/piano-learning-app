/**
 * The Groove trainer's wiring (roadmap DR-09): count-in, click, hit capture,
 * and the graded verdict at the end.
 *
 * ## Why this does not use `usePracticeEngine`
 *
 * Every piano drill drives a `Score` through the shared transport, because a
 * piano drill has notes to sound and a cursor to move across engraved
 * notation. A groove has neither: the app owns no drum samples, so there is
 * nothing to play but the click, and the pattern is read off a grid rather
 * than a staff. Borrowing the score transport would mean building a fake
 * single-pitch `Score` (the way `rhythmToScore` does) purely to get a clock —
 * and `useRhythmDrill`'s own module comment records how much care that
 * borrowed machinery then needs. One origin instant plus a frame loop is the
 * whole requirement here, so that is what this is.
 *
 * ## One origin, absolute scheduling
 *
 * `start()` records `clock.now()` as the run origin. Everything else — every
 * click, the moment the graded window opens, the end of the run — is that
 * origin plus a fixed offset, computed fresh each frame rather than
 * accumulated. A drifting drill would report the learner's timing as the
 * learner's fault, which is the one thing this screen must never do.
 *
 * Clicks are scheduled with a short look-ahead instead of all at once, so
 * Stop actually stops: `AudioOutput.click(accented, atMs)` hands the sound to
 * the output there and then, and nothing can un-schedule it afterwards.
 *
 * ## Hits are captured on the clock, not on the render
 *
 * A pad press records `clock.now()` immediately and stores it absolutely;
 * only at grading time is it converted to "milliseconds from the graded
 * window". React state never sits between the press and the timestamp.
 *
 * A hit slightly BEFORE the graded window opens is legitimate — a learner
 * leaning into beat 1 is early, not absent — so those timestamps convert to
 * small negative numbers, which is exactly what the grader's tolerance window
 * is for. `makeDrumHit` refuses a negative time (it models an absolute input
 * timestamp, where negative is nonsense), so the relative hits handed to the
 * grader are built here rather than through that constructor.
 *
 * ## Stop abandons, it does not grade
 *
 * Half a groove graded as "12 missed" would read as a failure the learner did
 * not have. Stop therefore throws the run away and returns the screen to
 * idle. The verdict only ever describes a run that finished.
 *
 * ## Count-in hits: a lean is scored, count-in noise is not
 *
 * A pad press during the count-in is recorded the same as any other — riding
 * the hi-hat through the count-in is what a count-in is *for*, and the "Hits
 * are captured" section above already promises a hit slightly before beat 1
 * still counts as a lean-in. `finish()` is where the two get told apart:
 * anything at or after `-toleranceMs` relative to `gradeOrigin` is graded,
 * anything earlier is discarded before it ever reaches
 * `gradeGroovePerformance`. The boundary is one tolerance window rather than
 * the whole count-in — dropping everything before beat 1 would also drop a
 * legitimate early lean, and grading everything back to the start of the
 * count-in would grade the 8 hi-hat hits the count-in exists to absorb.
 *
 * ## The tolerance is derived, not a constant
 *
 * `grooveToleranceMs` replaces the flat 100ms everywhere in this file:
 * computed once in `timing` (it needs exactly `score`, `bpm` and `repeats`,
 * the same inputs `timing` already closes over) and reused for the
 * end-of-run tail, the count-in discard boundary above, and the number the
 * screen prints. A fixed 100ms was wrong for `ghostFunkBar`'s sixteenths at
 * speed — the gaps between its onsets are narrower than the window meant to
 * forgive mistiming, so two adjacent notes could both claim the same hit.
 * Deriving it here rather than inside the grader's own call keeps one number
 * flowing through discard, grading and the printed value instead of three
 * call sites independently reconstructing it.
 *
 * ## Repeats are a setting, not a constant
 *
 * `GRADED_REPEATS` is the default, not the only option: `repeats` is state,
 * settable up to `REPEAT_CHOICES` before a run starts, exactly like `bpm` and
 * the groove. Two bars proves the pattern was read correctly but is only 6
 * seconds at 80bpm — nowhere near enough to see a limb drift as it tires
 * against the minute of continuous playing this app is actually training
 * toward, which is why 4 and 8 exist.
 *
 * ## The audio output is built inside a gesture
 *
 * `createDefaultAudioOutput()` used to run unconditionally in the hook body,
 * which built a suspended shared `AudioContext` the instant `/drums/groove`
 * rendered — before any click, on a page that was never touched. Every other
 * call site in the app builds it inside a click handler, matching
 * `createDefaultAudioOutput`'s own requirement that the context be built
 * inside a user gesture. It is now built at most once, lazily, inside
 * `start()` (itself only reachable from a click), with `options.audioOutput`
 * still winning as the test seam. `onFrame` reads `audioRef.current` rather
 * than a value closed over at render, since the ref is what `start()` just
 * populated.
 *
 * ## The tempo and groove remember the last run, but never argue with the learner
 *
 * After a finished run the screen prints the groove and tempo that run was
 * graded at, so a reload that leaves the picker on the hardcoded default
 * (`grooves[0]`) and the tempo at 80 while `lastAttempt` says "Money Beat at
 * 200" is a screen actively lying about what Start will do — the printed line
 * names one groove while Start would grade whichever one the picker, still on
 * the default, happens to be sitting on. Seeding `bpm` and `grooveId` from
 * `lastAttempt` has to happen after mount (see the effect below) because the
 * store hydrates from IndexedDB asynchronously. Neither must ever fire twice,
 * and neither once the learner has made their own choice — including via
 * `options.initialBpm` / `options.initialGrooveId`, a caller's instruction
 * that counts as the learner having chosen — because overwriting a value
 * someone just set would be worse than the stale default it replaces. The two
 * seeds share one effect: both key off the same event (the first
 * `lastAttempt` to arrive) and differ only in which "touched" ref they check
 * and which setter they call, so one `seededRef` marks the single shot both
 * take together. A persisted groove id naming a groove no longer offered
 * (removed from the bundle, or filtered out by `playableGrooves()`) is
 * ignored rather than selected, so the picker never lands on nothing.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioOutput, Clock, DateSource } from '@core/ports/index.ts'
import { millis, TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { padOrderIndex, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import { referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import {
  gradeGroovePerformance,
  grooveToleranceMs,
  type GroovePerformance,
  type PadResult,
} from '@core/drums/practice/grooveGrader.ts'
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'

/** How many passes of the groove are graded by default. The count-in bar is not one of them. */
export const GRADED_REPEATS = 2

/**
 * The repeat counts the screen offers. Two bars proves the pattern was read
 * correctly; it cannot show a limb drifting as it tires over the minute of
 * continuous playing the learner is actually working toward, so 4 and 8 are
 * here for that longer read. A fixed menu rather than a free number input —
 * an arbitrary repeat count has no reference performance to compare against
 * beyond what these three already cover.
 */
export const REPEAT_CHOICES: readonly number[] = [2, 4, 8]

/**
 * How fine the pattern grid the screen draws has to be. Read off the groove
 * rather than fixed: `moneyBeat` is written in eighths and `ghostFunkBar` in
 * sixteenths, and drawing the second one on an eighth grid would put two of
 * its notes in the same cell.
 */
function cellsPerBeatOf(score: GrooveScore): number {
  const eighth = TICKS_PER_QUARTER / 2
  return score.notes.every((note) => note.tick % eighth === 0) ? 2 : 4
}

/**
 * A pad press carries no velocity — a mouse and a laptop keyboard cannot
 * express one. Middle of the normal range, so nothing downstream reads it as
 * a ghost note or an accent (`velocityClassOf`).
 */
const PRESS_VELOCITY = 90

/** How far ahead of itself the frame loop hands clicks to the audio output. */
const CLICK_LOOKAHEAD_MS = 120

export type GroovePhase = 'idle' | 'count-in' | 'playing' | 'done'

export type UseGrooveDrillOptions = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
  readonly date?: DateSource
  readonly initialGrooveId?: string
  readonly initialBpm?: number
}

export type GrooveDrillApi = {
  readonly phase: GroovePhase
  /** Every groove the trainer can offer — see `GROOVES` on why swung ones are not here yet. */
  readonly grooves: readonly GrooveScore[]
  readonly score: GrooveScore
  readonly bpm: number
  /** How many passes of the groove the next run grades — one of `repeatChoices`. */
  readonly repeats: number
  /** The repeat counts `setRepeats` accepts. */
  readonly repeatChoices: readonly number[]
  /** The pads this groove uses, top-to-bottom in kit order (hats above snare above kick). */
  readonly pads: readonly MappedDrumPad[]
  /** Eighth-note cells per bar, and which pads sound on each — what the screen draws. */
  readonly cellsPerBar: number
  readonly cellsFor: (pad: MappedDrumPad) => readonly boolean[]
  /** The cell the run is currently on, while it is being graded. */
  readonly activeCell: number | undefined
  /** 1-based, within the current bar. */
  readonly beat: number
  /** 0 while counting in, then 1..`repeats`. */
  readonly bar: number
  /** Bumped every time a pad is hit, so the screen can flash it. */
  readonly flashes: Readonly<Record<string, number>>
  readonly performance: GroovePerformance | undefined
  /** Per-pad rows in the screen's own top-to-bottom order, not the grader's canonical one. */
  readonly rows: readonly PadResult[]
  readonly lastAttempt: DrumsGrooveAttempt | undefined
  /**
   * The window this run is actually grading with — derived from the score,
   * `bpm` and `repeats`, not a fixed constant. See `grooveToleranceMs`.
   */
  readonly toleranceMs: number
  setGrooveId(id: string): void
  setBpm(bpm: number): void
  /** Refused mid-run and for any value outside `repeatChoices`, exactly like `setBpm`. */
  setRepeats(repeats: number): void
  start(): void
  /** Abandons the run — see the module comment on why this does not grade. */
  stop(): void
  hit(pad: MappedDrumPad): void
}

/**
 * Only straight grooves for now. `GrooveScore.swingPercent` is performance
 * metadata that is deliberately not baked into the notated ticks, and
 * `grooveOnsetsMs` refuses a swung score rather than grading a correctly
 * swung performance as late — so offering one here would put a groove on
 * screen that the grader will not accept.
 */
function playableGrooves(): readonly GrooveScore[] {
  return referenceGrooves().filter((groove) => groove.swingPercent === 50)
}

function padsOf(score: GrooveScore): readonly MappedDrumPad[] {
  const seen = new Set<MappedDrumPad>()
  for (const note of score.notes) seen.add(note.pad)
  // Descending kit order puts the hi-hat at the top and the kick at the
  // bottom, which is how drum notation and every groove grid reads.
  return [...seen].sort((a, b) => padOrderIndex(b) - padOrderIndex(a))
}

export function useGrooveDrill(options: UseGrooveDrillOptions = {}): GrooveDrillApi {
  const browserClockRef = useRef<Clock | undefined>(undefined)
  if (browserClockRef.current === undefined) browserClockRef.current = createBrowserClock()
  const clock = options.clock ?? browserClockRef.current

  // No fallback construction here — see the module comment on why the
  // context has to be built inside a gesture. `options.audioOutput` is still
  // the test seam; the real fallback is filled in lazily by `start()`.
  const audioRef = useRef<AudioOutput | undefined>(options.audioOutput)

  const [date] = useState<DateSource>(() => options.date ?? { epochMillis: () => Date.now() })

  const grooves = useMemo(playableGrooves, [])
  // The picker is ordered easiest-first (`referenceGrooves`), so the trainer
  // opens on `grooves[0]` rather than a hardcoded id.
  const [grooveId, setGrooveIdState] = useState(options.initialGrooveId ?? grooves[0]?.id ?? 'money-beat')
  // True once the learner has explicitly picked a groove — including via
  // `options.initialGrooveId`. Read by the seeding effect below, the same
  // discipline `bpmTouchedRef` applies to `bpm`.
  const grooveTouchedRef = useRef(options.initialGrooveId !== undefined)
  const selected = useMemo(() => grooves.find((g) => g.id === grooveId) ?? grooves[0], [grooves, grooveId])
  // The groove list is a static bundled one, so an empty one is a build
  // mistake rather than a state the screen has to render. Re-bound to a
  // declared type because the narrowing would not otherwise reach the
  // callbacks below.
  if (selected === undefined) throw new Error('no playable reference groove is bundled')
  const score: GrooveScore = selected

  const [bpm, setBpmState] = useState(options.initialBpm ?? 80)
  // True once the learner has explicitly chosen a tempo — including via
  // `options.initialBpm`, a caller's instruction that must always win. Read
  // by the seeding effect below so a freshly hydrated attempt never clobbers
  // a tempo someone already set.
  const bpmTouchedRef = useRef(options.initialBpm !== undefined)

  const [repeats, setRepeatsState] = useState(GRADED_REPEATS)

  const timing = useMemo(() => {
    const beatTicks = (TICKS_PER_QUARTER * 4) / score.timeSignature.beatType
    const msPerTick = 60_000 / (bpm * TICKS_PER_QUARTER)
    const beatMs = beatTicks * msPerTick
    const loopTicks = score.measures.reduce((total, measure) => total + measure.durationTicks, 0)
    const countInMs = score.timeSignature.beats * beatMs
    const loopMs = loopTicks * msPerTick
    const toleranceMs = grooveToleranceMs(score, bpm, repeats)
    return {
      beatMs,
      beatsPerBar: score.timeSignature.beats,
      countInMs,
      loopMs,
      toleranceMs,
      // A tail of one tolerance window, so a hit that is late on the very
      // last note still has somewhere to land.
      endMs: countInMs + loopMs * repeats + toleranceMs,
      totalBeats: score.timeSignature.beats * (1 + repeats * score.measures.length),
    }
  }, [score, bpm, repeats])

  const [phase, setPhase] = useState<GroovePhase>('idle')
  const [beat, setBeat] = useState(1)
  const [bar, setBar] = useState(0)
  const [activeCell, setActiveCell] = useState<number | undefined>(undefined)
  const [flashes, setFlashes] = useState<Readonly<Record<string, number>>>({})
  const [performance, setPerformance] = useState<GroovePerformance | undefined>(undefined)

  const originRef = useRef<number | undefined>(undefined)
  const hitsRef = useRef<readonly { readonly pad: MappedDrumPad; readonly atMs: number }[]>([])
  const nextClickRef = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const lastAttempt = useDrumsHistoryStore((state) => state.attempts[0])
  const addAttempt = useDrumsHistoryStore((state) => state.addAttempt)

  // Seeding from history is one-shot: only the *first* `lastAttempt` to
  // arrive gets to propose values, never a later one (the run the learner
  // just finished) — see the module comment for why bpm and grooveId share
  // this one effect and this one latch.
  const seededRef = useRef(false)

  useEffect(() => {
    if (seededRef.current) return
    if (lastAttempt === undefined) return
    seededRef.current = true
    if (phaseRef.current !== 'idle') return
    if (!bpmTouchedRef.current) setBpmState(lastAttempt.bpm)
    // An unknown persisted id — a groove no longer bundled, or filtered out
    // by `playableGrooves()` — is left alone rather than selected, so the
    // picker keeps its default instead of landing on nothing.
    if (!grooveTouchedRef.current && grooves.some((groove) => groove.id === lastAttempt.grooveId)) {
      setGrooveIdState(lastAttempt.grooveId)
    }
  }, [lastAttempt, grooves])

  const cellsPerBeat = cellsPerBeatOf(score)
  const cellsPerBar = timing.beatsPerBar * cellsPerBeat
  const cellTicks = TICKS_PER_QUARTER / cellsPerBeat

  function cellsFor(pad: MappedDrumPad): readonly boolean[] {
    const cells = new Array<boolean>(cellsPerBar * score.measures.length).fill(false)
    for (const note of score.notes) {
      if (note.pad !== pad) continue
      const index = Math.round(note.tick / cellTicks)
      if (index >= 0 && index < cells.length) cells[index] = true
    }
    return cells
  }

  function finish(origin: number): void {
    const gradeOrigin = origin + timing.countInMs
    // Count-in noise vs a legitimate lean-in — see the module comment. A hit
    // at or after `-toleranceMs` is close enough to beat 1 to be an early
    // lean; anything earlier is the count-in doing its job and is dropped
    // before the grader ever sees it.
    const hits: readonly RawDrumHit[] = hitsRef.current
      .filter((hit) => hit.atMs - gradeOrigin >= -timing.toleranceMs)
      .map((hit) => ({
        pad: hit.pad,
        velocity: PRESS_VELOCITY,
        // Relative to the graded window, which a hit taken early makes
        // negative — see the module comment.
        time: millis(hit.atMs - gradeOrigin),
        articulations: [],
      }))
    const graded = gradeGroovePerformance({ score, bpm, repeats, hits })
    // The grader returns its own canonical order; the screen shows the rows
    // against the pads the learner was looking at, in the same order. A pad
    // the groove never asked for (a stray crash) has no row up there, so it
    // goes last.
    const order = padsOf(score)
    const rank = (pad: PadResult['pad']): number => {
      const index = order.findIndex((known) => known === pad)
      return index === -1 ? order.length : index
    }
    const rows = [...graded.perPad].sort((a, b) => rank(a.pad) - rank(b.pad))
    addAttempt({
      grooveId: score.id,
      grooveTitle: score.title,
      bpm,
      repeats,
      at: date.epochMillis(),
      steady: graded.steady,
      pads: rows,
    })
    setPerformance({ ...graded, perPad: rows })
    setActiveCell(undefined)
    setPhase('done')
    originRef.current = undefined
  }

  function onFrame(): void {
    const origin = originRef.current
    if (origin === undefined) return
    // Read the ref, not a value captured at render — `start()` may have
    // filled it in after this hook last rendered. See the module comment.
    const output = audioRef.current
    if (output === undefined) return
    const elapsed = clock.now() - origin

    while (
      nextClickRef.current < timing.totalBeats &&
      nextClickRef.current * timing.beatMs <= elapsed + CLICK_LOOKAHEAD_MS
    ) {
      const index = nextClickRef.current
      nextClickRef.current += 1
      output.click(index % timing.beatsPerBar === 0, millis(origin + index * timing.beatMs))
    }

    if (elapsed >= timing.endMs) {
      finish(origin)
      return
    }

    const beatIndex = Math.max(0, Math.floor(elapsed / timing.beatMs))
    setBeat((beatIndex % timing.beatsPerBar) + 1)
    if (elapsed < timing.countInMs) {
      setPhase('count-in')
      setBar(0)
      return
    }
    const graded = elapsed - timing.countInMs
    setPhase('playing')
    setBar(Math.min(repeats, Math.floor(graded / timing.loopMs) + 1))
    const cellMs = timing.beatMs / cellsPerBeat
    const cells = cellsPerBar * score.measures.length
    setActiveCell(Math.floor(graded / cellMs) % cells)
  }

  useTransportLoop({
    active: phase === 'count-in' || phase === 'playing',
    onFrame,
    ...(options.frameDriver === undefined ? {} : { driver: options.frameDriver }),
  })

  function start(): void {
    // Built at most once, and only from here — a click handler all the way
    // up the call chain, which is the gesture `createDefaultAudioOutput`
    // requires. See the module comment.
    if (audioRef.current === undefined) audioRef.current = createDefaultAudioOutput()
    hitsRef.current = []
    nextClickRef.current = 0
    setPerformance(undefined)
    setFlashes({})
    setBeat(1)
    setBar(0)
    setActiveCell(undefined)
    originRef.current = clock.now()
    setPhase('count-in')
  }

  function stop(): void {
    originRef.current = undefined
    hitsRef.current = []
    setActiveCell(undefined)
    setPhase('idle')
  }

  function hit(pad: MappedDrumPad): void {
    if (phaseRef.current !== 'count-in' && phaseRef.current !== 'playing') return
    hitsRef.current = [...hitsRef.current, { pad, atMs: clock.now() }]
    setFlashes((current) => ({ ...current, [pad]: (current[pad] ?? 0) + 1 }))
  }

  return {
    phase,
    grooves,
    score,
    bpm,
    repeats,
    repeatChoices: REPEAT_CHOICES,
    pads: padsOf(score),
    cellsPerBar,
    cellsFor,
    activeCell,
    beat,
    bar,
    flashes,
    performance,
    rows: performance?.perPad ?? [],
    lastAttempt,
    toleranceMs: timing.toleranceMs,
    setGrooveId: (id) => {
      if (phaseRef.current === 'count-in' || phaseRef.current === 'playing') return
      grooveTouchedRef.current = true
      setGrooveIdState(id)
      setPerformance(undefined)
    },
    setBpm: (next) => {
      if (phaseRef.current === 'count-in' || phaseRef.current === 'playing') return
      if (!Number.isFinite(next)) return
      bpmTouchedRef.current = true
      setBpmState(Math.min(200, Math.max(40, Math.round(next))))
      // The Result card is about the run that produced it, and the subtitle above it
      // recomputes off the new tempo immediately. Leaving the card standing put a window
      // and a tempo over numbers they did not produce — and the screen's own "try it
      // slower" button did exactly that, twice in a row, with no run in between.
      setPerformance(undefined)
    },
    setRepeats: (next) => {
      if (phaseRef.current === 'count-in' || phaseRef.current === 'playing') return
      if (!REPEAT_CHOICES.includes(next)) return
      setRepeatsState(next)
      setPerformance(undefined)
    },
    start,
    stop,
    hit,
  }
}
