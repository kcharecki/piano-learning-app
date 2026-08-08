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
 * drives it directly rather than building a third scheduler. Every drill note
 * sits on a beat (`techniqueScore` writes one `QUARTER` per note — see
 * `@core/technique/library.ts`), so the metronome's default 1-click-per-beat
 * subdivision is exactly the pulse the learner plays against, at whatever bpm
 * is currently selected: `techniqueScore(drill, metronome.bpm)` is
 * regenerated whenever that bpm changes, so the engraved score and the clicks
 * are always describing the same tempo.
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
 * ## Contract ambiguity flagged for the reviewer
 *
 * `writeMusicXml` (`@core/notation/musicxmlwriter.ts`) does not emit a
 * `<technical><fingering>` notation for any note — grepping the file for
 * "fingering" turns up nothing. Every note `techniqueScore` produces DOES
 * carry `ScoreNote.fingering` (REQ-3.7.1), but the MusicXML this hook hands to
 * `ScoreViewer` cannot currently show it engraved: the writer silently drops
 * the field. That is a real, currently-open gap in a dependency this module
 * is not allowed to touch, so it is called out here rather than glossed over.
 * The test suite therefore asserts fingerings at the `Score` level (what this
 * hook actually guarantees), not on rendered engraving output.
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
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { measureDurationTicks, scoreDurationTicks, type Score, type TimeSignature } from '@core/notation/score.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { MATCHER_DEFAULTS, NoteMatcher } from '@core/practice/matcher.ts'
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
  /** REQ-3.7.3: this drill's clean-tempo history, oldest first. */
  readonly history: readonly TempoPoint[]
  readonly bestBpm: number
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
  /** The clock instant onsets are measured relative to. */
  readonly anchorMs: number
  readonly onsets: number[]
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
  const runRef = useRef<Run | undefined>(undefined)

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
        // Collapse simultaneous presses (a chord, or two hands on the same
        // beat) into one onset before scoring evenness — otherwise a
        // hands-together drill's near-zero inter-hand gaps drag the median
        // gap to (near) zero and `evennessOf` reports 0 for a flawless run.
        // This is the same tolerance the matcher already uses to treat
        // notes as "written on the same beat".
        const last = run.onsets[run.onsets.length - 1]
        if (last === undefined || t - last > MATCHER_DEFAULTS.chordWindowMs) {
          run.onsets.push(t)
        }
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
    const anchorMs = clock.now() + (tickToMs(tempo, barTicks) as number)
    runRef.current = {
      drillId: drill.id,
      bpm: metronome.bpm,
      tempo,
      score,
      matcher: new NoteMatcher(score, tempo),
      anchorMs,
      onsets: [],
    }
    setLastAttempt(undefined)
  }

  function stop(): void {
    const run = runRef.current
    metronome.stop()
    if (run === undefined) return
    runRef.current = undefined
    // A run with no input at all (Start pressed then Stop, or no MIDI
    // keyboard connected) has nothing to score: `evennessOf([])` would report
    // a misleadingly perfect 1, and a junk row would consume one of the
    // capped history slots for a silent attempt.
    if (run.onsets.length === 0) return
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
    const evenness = evennessOf(run.onsets)
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
    history,
    bestBpm,
    setDrillId,
    setBpm: metronome.setBpm,
    start,
    stop,
    press,
    release,
  }
}
