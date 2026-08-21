/**
 * Technique drill wiring (roadmap 4.4a, REQ-3.7.1/3.7.2/3.7.3) — picks a drill
 * from `techniqueLibrary(level)`, engraves it (fingerings included, see
 * `techniqueScore`), runs it against `useMetronome`'s click track, captures
 * the learner's onsets from a `PlayableMidiInput` (roadmap 5.5a — the device
 * when one is connected, plus whatever the screen's on-screen/qwerty fallback
 * presses through `press`/`release`), and on `stop()` scores the run
 * with `evennessOf`/`isClean` and appends a `TechniqueAttempt` to
 * `techniqueStore` — the store the dashboard's `tempoHistory`/`bestCleanBpm`
 * readers already know how to read (`@core/technique/evenness.ts`).
 *
 * ## Reusing the metronome, not a second scheduler
 *
 * `useMetronome` (roadmap 2.28) is the standalone click track; this hook
 * drives it directly rather than building a third scheduler. The click stays
 * on the BEAT — one per quarter — for every drill, and that is a decision
 * rather than an accident of the note values.
 *
 * Most drills write one `QUARTER` per note, so the beat and the note coincide.
 * The broken triad sequence does not: it writes three triplet eighths to a
 * quarter (`@core/technique/triadSequence.ts`). Clicking each of those three
 * would remove the very thing the row trains — fitting a three-note harmony
 * inside one pulse you are counting — and would triple the click rate on a
 * drill the syllabus expects from memory. Because that drill puts exactly one
 * triad per beat, every triad ROOT still lands on a click, so the quarter
 * pulse marks the pattern correctly without marking every note of it.
 *
 * `techniqueScore(drill, metronome.bpm)` is regenerated whenever that bpm
 * changes, so the engraved score and the clicks always describe one tempo.
 *
 * ## Scoring a run
 *
 * A run keeps its own `NoteMatcher` (the same engine `useAssessment` uses)
 * built from a flat tempo map at the run's bpm, plus a raw list of onset
 * offsets (ms since the run's anchor). `stop()` closes every window still
 * open (a trailing note nobody pressed must count against accuracy, not
 * vanish because no later MIDI event ever arrived to advance the matcher's
 * clock past it — the same reasoning `useAssessment.finalizeRun` documents),
 * reduces the matcher to an accuracy figure, reduces the onsets to an
 * evenness figure via `evennessOf`, and stores the result.
 *
 * ## Fingering reaches the engraving (roadmap 5.22)
 *
 * Every note `techniqueScore` produces carries `ScoreNote.fingering`
 * (REQ-3.7.1); `writeMusicXml` (`@core/notation/musicxmlwriter.ts`) writes it
 * as a `<technical><fingering>` notation, placed above the staff for the
 * right hand and below for the left, and OSMD draws it natively above/below
 * its own notehead — no separate text readout on the screen needed.
 *
 * ## What MIDI cannot see (roadmap 5.23)
 *
 * Everything this hook scores comes from note-on/note-off events: pitch and
 * timing only. A clean, rising tempo history is not a technique validation —
 * see `posturePromptSchedule.ts` for the periodic human-check schedule this
 * hook drives from `clock`, and `TechniqueScreen.tsx` for the standing
 * on-screen statement.
 */
import { createBrowserClock } from '@app/practice/clock.ts'
import { createPlayableInput, type PlayableMidiInput } from '@app/practice/playableInput.ts'
import {
  useMidiConnection,
  type ConnectMidi,
  type MidiConnection,
} from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useMetronome } from '@app/metronome/useMetronome.ts'
import { usePracticeLog } from '@app/practice/usePracticeLog.ts'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { measureDurationTicks, scoreDurationTicks, type Score, type TimeSignature } from '@core/notation/score.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { MATCHER_DEFAULTS, NoteMatcher } from '@core/practice/matcher.ts'
import {
  diagnoseTechnique,
  type TechniqueDiagnosis,
  type TechniqueKey,
} from '@core/technique/verdict.ts'
import {
  chordWindowMs,
  describeRoll,
  groupOnsets,
  shortestGapMs,
} from '@core/technique/onsets.ts'
import { bpm as asBpm, millis as asMillis, type Bpm, type Midi } from '@core/shared/units.ts'
import { MAX_BPM, MIN_BPM } from '@core/timing/metronome.ts'
import { makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import {
  bestCleanBpm,
  evennessOf,
  isClean,
  tempoHistory,
  type TechniqueAttempt,
  type TempoPoint,
} from '@core/technique/evenness.ts'
import { techniqueLibrary, techniqueScore, type TechniqueDrill } from '@core/technique/library.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  acknowledgePrompt as acknowledgePostureSchedule,
  addAttempt as addPostureAttempt,
  addRunningTime as addPostureRunningTime,
  INITIAL_POSTURE_SCHEDULE_STATE,
  isPosturePromptDue,
  type PostureScheduleState,
} from './posturePromptSchedule.ts'

const FALLBACK_BPM = 60
const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

export type UseTechniqueDrillOptions = {
  readonly level: number
  /** Which drill of this level's library to open first. Defaults to the first. */
  readonly initialDrillId?: string
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
}

export type TechniqueDrillApi = {
  readonly drills: readonly TechniqueDrill[]
  readonly drill: TechniqueDrill | undefined
  readonly score: Score | undefined
  readonly bpm: Bpm
  readonly running: boolean
  readonly midi: MidiConnection
  /** The attempt this run's `stop()` just produced; cleared by the next `start()`. */
  readonly lastAttempt: TechniqueAttempt | undefined
  /** What went wrong in that same attempt, in named notes (roadmap T.12).
   *  Cleared by the next `start()`, and empty for a run with no wrong notes. */
  readonly lastDiagnosis: TechniqueDiagnosis | undefined
  /** How far the run's chords were rolled, in words, or `undefined` when
   *  none was rolled enough to be worth saying (roadmap T.11). */
  readonly lastRoll: string | undefined
  /** REQ-3.7.3: this drill's clean-tempo history, oldest first. */
  readonly history: readonly TempoPoint[]
  readonly bestBpm: number
  /** REQ-5.23: a human posture/technique check is due — see `posturePromptSchedule.ts`. */
  readonly posturePromptDue: boolean
  /** The learner confirmed a human check; restarts the schedule from zero. */
  readonly acknowledgePosturePrompt: () => void
  readonly setDrillId: (id: string) => void
  readonly setBpm: (bpm: number) => void
  /** No-op if no drill is selected or a run is already in progress. */
  readonly start: () => void
  /** No-op if no run is in progress. */
  readonly stop: () => void
  /** Sound a note now, as if a key went down (roadmap 5.5a) — the on-screen
   *  keyboard and computer-keyboard input both press through this, same seam
   *  a real MIDI key feeds, so a clicked/typed note is scored exactly like a
   *  played one. */
  readonly press: (note: Midi) => void
  readonly release: (note: Midi) => void
}

type Run = {
  readonly drillId: string
  readonly bpm: number
  readonly tempo: TempoMap
  readonly score: Score
  readonly matcher: NoteMatcher
  /** The drill's key, kept on the run so a mid-run drill switch cannot make
   *  the verdict name degrees from a key the learner was not playing in. */
  readonly key: TechniqueKey
  /** How far apart two presses may be and still be one chord, sized off THIS
   *  score at THIS tempo (roadmap T.11). */
  readonly chordWindowMs: number
  /** The clock instant onsets are measured relative to. */
  readonly anchorMs: number
  /** Every key press of the run, relative to `anchorMs`, ungrouped. */
  readonly presses: number[]
  /** `clock.now()` when `start()` ran — the wall-time baseline the posture
   *  schedule's running-time counter is credited from on `stop()` (roadmap
   *  5.23). Deliberately the moment Start was pressed, not `anchorMs`
   *  (which is offset by the count-in): the learner's hands are already at
   *  the keyboard for the count-in bar, so that time counts too. */
  readonly startedAtMs: number
}

function firstIdOf(drills: readonly TechniqueDrill[]): string | undefined {
  return drills[0]?.id
}

export function useTechniqueDrill(options: UseTechniqueDrillOptions): TechniqueDrillApi {
  const drills = useMemo(() => techniqueLibrary(options.level), [options.level])
  const [drillId, setDrillId] = useState<string | undefined>(
    () => options.initialDrillId ?? firstIdOf(drills),
  )

  // A level change (or a drill dropping out of the library) falls back to
  // that level's first drill rather than leaving the picker pointed at
  // nothing selectable.
  useEffect(() => {
    setDrillId((current) =>
      current !== undefined && drills.some((d) => d.id === current) ? current : firstIdOf(drills),
    )
  }, [drills])

  const drill = useMemo(() => drills.find((d) => d.id === drillId), [drills, drillId])

  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
  const [date] = useState<DateSource>(() => options.date ?? { epochMillis: () => Date.now() })
  const practiceLog = usePracticeLog({ clock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog

  const midi = useMidiConnection(
    options.midiInput !== undefined
      ? { midiInput: options.midiInput }
      : options.connectMidi !== undefined
        ? { connect: options.connectMidi }
        : {},
  )

  const metronome = useMetronome({
    clock,
    ...(options.audioOutput === undefined ? {} : { audioOutput: options.audioOutput }),
    ...(options.frameDriver === undefined ? {} : { frameDriver: options.frameDriver }),
    initialBpm: asBpm(drill?.targetBpm ?? FALLBACK_BPM),
  })

  const metronomeRef = useRef(metronome)
  metronomeRef.current = metronome

  // Reset the tempo whenever the selection changes — a stale bpm left over
  // from a different drill/level is not a sensible default for a freshly
  // opened one. Seed from this drill's own clean-tempo history (REQ-3.7.2
  // tracks progress over time) and only fall back to the drill's beginner
  // default when nothing has ever been played clean.
  useEffect(() => {
    if (drill === undefined) return
    const best = bestCleanBpm(useTechniqueStore.getState().attempts, drill.id)
    metronomeRef.current.setBpm(best > 0 ? best : drill.targetBpm)
  }, [drill])

  const score = useMemo(
    () => (drill === undefined ? undefined : techniqueScore(drill, metronome.bpm)),
    [drill, metronome.bpm],
  )

  const attempts = useTechniqueStore((s) => s.attempts)
  const addAttempt = useTechniqueStore((s) => s.addAttempt)

  const history = useMemo(
    () => (drill === undefined ? [] : tempoHistory(attempts, drill.id)),
    [attempts, drill],
  )
  const bestBpm = useMemo(
    () => (drill === undefined ? 0 : bestCleanBpm(attempts, drill.id)),
    [attempts, drill],
  )

  const [lastAttempt, setLastAttempt] = useState<TechniqueAttempt | undefined>(undefined)
  const [lastDiagnosis, setLastDiagnosis] = useState<TechniqueDiagnosis | undefined>(undefined)
  const [lastRoll, setLastRoll] = useState<string | undefined>(undefined)
  const runRef = useRef<Run | undefined>(undefined)

  // REQ-5.23: the posture-prompt schedule (`posturePromptSchedule.ts`) is
  // pure and knows nothing about React, Clock or this hook's Run bookkeeping
  // — it only answers "given these two counters, is a check due?". This
  // state IS the counters; `stop()` below is the only place that advances
  // them, from `clock`, never `Date.now()`.
  const [postureSchedule, setPostureSchedule] = useState<PostureScheduleState>(
    INITIAL_POSTURE_SCHEDULE_STATE,
  )
  const posturePromptDue = useMemo(() => isPosturePromptDue(postureSchedule), [postureSchedule])
  function acknowledgePosturePrompt(): void {
    setPostureSchedule(acknowledgePostureSchedule())
  }

  // The run's actual input (roadmap 5.5a, mirrors `playableInput.ts`'s
  // reasoning on Practice): NOT `midi.input` directly, which is `undefined`
  // wherever Web MIDI is absent and left this screen's on-screen/qwerty
  // fallback with no seam to press through. `createPlayableInput` always
  // exists, forwards the device when there is one, and also emits from
  // `press`/`release` below — the matcher cannot tell a clicked note from a
  // played one, which is the point.
  const [playableInput, setPlayableInput] = useState<PlayableMidiInput | undefined>(undefined)
  useEffect(() => {
    const next = createPlayableInput(midi.input, clock)
    setPlayableInput(next)
    return () => next.dispose()
  }, [midi.input, clock])

  // Feed the run's matcher and onset list from the merged input while a run
  // is in progress; a no-op outside one (`runRef.current` is `undefined`).
  useEffect(() => {
    if (playableInput === undefined) return undefined
    return playableInput.onEvent((event) => {
      const run = runRef.current
      if (run === undefined) return
      const t = event.time - run.anchorMs
      if (event.type === 'noteOn') {
        // Every press, ungrouped. Deciding which presses were one chord used
        // to happen here, one event at a time, against a flat 80ms — which was
        // a cliff at both ends of the tempo range (roadmap T.11). It is now
        // `groupOnsets` at `stop()`, over the whole run at once, so the
        // grouping can also MEASURE what it collapsed and say so.
        run.presses.push(t)
        run.matcher.noteOn(event.note, asMillis(t))
      } else if (event.type === 'noteOff') {
        run.matcher.noteOff(event.note, asMillis(t))
      }
    })
  }, [playableInput])

  function start(): void {
    if (drill === undefined || score === undefined) return
    if (runRef.current !== undefined) return
    // `metronome.start()` re-validates its settings and can fail without ever
    // flipping `running` to true (`setError` alone, no exception) — mirror
    // that one reachable failure mode (an out-of-range bpm) before latching a
    // run in, so a rejected start can never wedge the screen with a run the
    // Stop button (gated on `running`) can't reach.
    if (metronome.bpm < MIN_BPM || metronome.bpm > MAX_BPM) return
    metronome.start()
    const tempo = makeTempoMap(score.tempos)
    // A one-bar count-in: tick 0 of the drill lands on the downbeat after a
    // full bar of clicks, not on the exact instant Start was pressed — a real
    // learner starts on the next click, not mid-frame-zero, and needs the
    // clicked-out bar to find the tempo before the first note is due.
    const barTicks = measureDurationTicks(score.measures[0]?.timeSignature ?? DEFAULT_TIME_SIGNATURE)
    const startedAtMs = clock.now()
    const anchorMs = startedAtMs + (tickToMs(tempo, barTicks) as number)
    runRef.current = {
      drillId: drill.id,
      bpm: metronome.bpm,
      tempo,
      score,
      matcher: new NoteMatcher(score, tempo),
      // Sized off this score at this tempo, never a flat number: at ♩=300 a
      // triplet gap is 66.7ms and the old flat 80ms swallowed notes the score
      // wrote as separate. `tiedFrom` notes are skipped because they continue
      // an earlier press rather than asking for a new one — the same rule the
      // matcher applies to its own expected list.
      chordWindowMs: chordWindowMs(
        shortestGapMs(
          [...new Set(score.notes.filter((n) => !n.tiedFrom).map((n) => n.startTick))]
            .sort((a, b) => a - b)
            .map((startTick) => tickToMs(tempo, startTick) as number),
        ),
        MATCHER_DEFAULTS.toleranceMs,
      ),
      // `?? 'major'`: the drills that omit a scale type — five-finger patterns,
      // triad sequences — are all built on a major tonic, and their degrees
      // are what the learner is being asked to hear. See `library.ts`.
      key: { tonic: drill.tonic, scaleType: drill.scaleType ?? 'major' },
      anchorMs,
      presses: [],
      startedAtMs,
    }
    practiceLogRef.current.start('technique', drill.title)
    setLastAttempt(undefined)
    setLastDiagnosis(undefined)
    setLastRoll(undefined)
  }

  function stop(): void {
    const run = runRef.current
    metronome.stop()
    if (run === undefined) return
    runRef.current = undefined
    // REQ-5.23: credit this run's wall time toward the posture-prompt
    // schedule regardless of whether it produced a scored attempt below —
    // time spent drilling under static tension counts even on a run nobody
    // played a note in.
    const ranMs = (clock.now() as number) - run.startedAtMs
    setPostureSchedule((prev) => addPostureRunningTime(prev, ranMs))
    // A run with no input at all (Start pressed then Stop, or no MIDI
    // keyboard connected) has nothing to score: `evennessOf([])` would report
    // a misleadingly perfect 1, and a junk row would consume one of the
    // capped history slots for a silent attempt.
    if (run.presses.length === 0) {
      practiceLogRef.current.stop()
      return
    }
    // Close every window still open at the end of the drill — a trailing
    // note nobody pressed must count against accuracy, not vanish because no
    // later MIDI event arrived to advance the matcher's clock past it (the
    // same reasoning `useAssessment.finalizeRun` documents).
    const endMs =
      (tickToMs(run.tempo, scoreDurationTicks(run.score)) as number) +
      MATCHER_DEFAULTS.toleranceMs +
      1
    run.matcher.advanceTo(asMillis(endMs))
    const accuracy = run.matcher.summary().accuracy
    const grouping = groupOnsets(run.presses, run.chordWindowMs)
    const evenness = evennessOf(grouping.onsets)
    const attempt: TechniqueAttempt = {
      drillId: run.drillId,
      at: date.epochMillis(),
      bpm: run.bpm,
      evenness,
      accuracy,
      clean: isClean({ evenness, accuracy }),
    }
    addAttempt(attempt)
    setLastAttempt(attempt)
    // The same match results the accuracy figure was reduced from, kept as
    // named notes this time: "Evenness 88%" told the learner a run went wrong
    // without telling them WHICH note, which was the one thing they asked for.
    // Roadmap T.12.
    setLastDiagnosis(diagnoseTechnique(run.matcher.results, run.key))
    // Widening a window hides things, so nothing is hidden silently: what the
    // grouping swallowed is reported in words rather than folded into the
    // evenness figure, where a learner could not tell it apart from a
    // timing problem. Roadmap T.11.
    setLastRoll(describeRoll(grouping) ?? undefined)
    // REQ-5.23: a completed, scored attempt is one rep toward the
    // repetition-count half of the posture schedule.
    setPostureSchedule((prev) => addPostureAttempt(prev))
    practiceLogRef.current.stop({ accuracy, tempoBpm: run.bpm })
  }

  function press(note: Midi): void {
    playableInput?.press(note)
  }

  function release(note: Midi): void {
    playableInput?.release(note)
  }

  return {
    drills,
    drill,
    score,
    bpm: metronome.bpm,
    running: metronome.running,
    midi,
    lastAttempt,
    lastDiagnosis,
    lastRoll,
    history,
    bestBpm,
    posturePromptDue,
    acknowledgePosturePrompt,
    setDrillId,
    setBpm: metronome.setBpm,
    start,
    stop,
    press,
    release,
  }
}
