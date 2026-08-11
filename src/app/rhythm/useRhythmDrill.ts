/**
 * Rhythm tapping drill wiring (roadmap 2.13, REQ-3.9.1-adjacent). This is the
 * only consumer `core/generator/rhythm.ts` has: `generateRhythm` produces a
 * `RhythmPattern`, `rhythmToScore` turns it into a real (single-pitch) `Score`
 * so it can be driven by the SAME transport machinery every other drill uses
 * (`usePracticeEngine`, exactly as `useSightReadingTrainer` drives it), and
 * `gradeTapping` scores whatever the learner tapped once the run ends.
 *
 * ## Silent playback, audible pulse
 *
 * The pattern itself must never be heard — tapping along to a recording is
 * not reading a rhythm — so the engine's `AudioOutput` is wrapped in
 * `silentAudioOutput` exactly like the sight-reading trainer wraps it for the
 * same reason. The metronome is left ON: a tapping drill with no pulse to tap
 * against is meaningless.
 *
 * ## Starting playback the instant a fresh pattern is set
 *
 * `usePracticeEngine` only (re)builds its `Transport` in an effect of its own
 * (the score is fixed at construction) — but that rebuild effect ALSO carries
 * a *running* previous transport's state over onto the brand new one it
 * builds (see that module's comment on `previous`/`wasRunning`). `start()`
 * below plays whatever transport already exists BEFORE it sets the fresh
 * score, so that carry-over does the actual work: the new transport comes up
 * already running, no race, no extra render to wait out. A deferred
 * `engine.play()` call made only AFTER the score changes cannot tell a
 * freshly-built, not-yet-played transport apart from the OLD, already
 * FINISHED one on the very next render — both report a defined position
 * before the new transport exists — and ends up occasionally firing against
 * the wrong instance (see the roadmap-2.13 report). The very first run ever
 * has no previous transport to carry over, so that ONE case still needs the
 * effect below, which the same "position just became defined" signal is
 * unambiguous for (nothing existed to be confused with).
 *
 * ## Taps are wall-clock, relative to the SAME anchor audio uses
 *
 * `engine.play()` returns the clock instant tick 0 is anchored to (see its own
 * doc) — the same anchor `dispatchAudio`/`dispatchMetronome` add `tickToMs` to
 * before sounding anything. Recording `clock.now() - anchorMs` for every tap
 * puts taps on the exact same timeline `gradeTapping` compares onsets against
 * (onsets are `tickToMs(tempo, onset.tick)`, i.e. also relative to tick 0).
 */
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import {
  useMidiConnection,
  type ConnectMidi,
  type MidiConnection,
} from '@app/practice/useMidiConnection.ts'
import { usePracticeEngine, type PositionDisplay } from '@app/practice/usePracticeEngine.ts'
import { usePracticeLog } from '@app/practice/usePracticeLog.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { createBrowserRng } from '@app/sightreading/rng.ts'
import { silentAudioOutput } from '@app/sightreading/silentAudioOutput.ts'
import {
  generateRhythm,
  gradeTapping,
  rhythmToScore,
  type RhythmPattern,
  type TapGrade,
  type TimeSignature,
} from '@core/generator/rhythm.ts'
import type { Hand } from '@core/notation/score.ts'
import type { AudioOutput, Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { makeTempoMap, type TempoMap } from '@core/timing/tempo.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import type { Score } from '@core/notation/score.ts'
import { useEffect, useMemo, useRef, useState } from 'react'

export type RhythmUiPhase = 'idle' | 'tapping' | 'graded'

export type UseRhythmDrillOptions = {
  readonly complexity: 1 | 2 | 3 | 4 | 5
  readonly bars: number
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly rng?: Rng
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
  /** REQ-3.9.1: the click is on by default (a tapping drill needs a pulse) but must be switchable. */
  readonly metronomeEnabled?: boolean
}

export type UseRhythmDrill = {
  readonly phase: RhythmUiPhase
  /** The pattern being tapped, or the last one graded. */
  readonly pattern: RhythmPattern | undefined
  /** The same pattern, engraved — one pitch, real durations and rests (roadmap 5.19). */
  readonly score: Score | undefined
  readonly grade: TapGrade | undefined
  /** How many taps have been registered in the current run. */
  readonly tapCount: number
  readonly position: PositionDisplay | undefined
  readonly midi: MidiConnection
  /** Generates a fresh pattern and starts the run. No-op while already tapping. */
  readonly start: () => void
  /** One tap, from any source. No-op unless phase is 'tapping'. */
  readonly tap: () => void
}

/** REQ-3.9.1-adjacent fixes the metre; only `complexity`/`bars` are asked for. */
const TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

/**
 * `rhythmToScore` always writes onto the right hand — a module-level
 * constant so `usePracticeEngine`'s `activeHands` dependency has a STABLE
 * reference across renders. A fresh `['right']` literal here would change
 * identity every render, defeat its `useMemo`, rebuild the transport on
 * every render, and loop forever — see the roadmap-2.13 report.
 */
const ACTIVE_HANDS: readonly Hand[] = ['right']

export function useRhythmDrill(options: UseRhythmDrillOptions): UseRhythmDrill {
  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
  // No `date` option on this hook — this seam exists solely to give
  // `usePracticeLog` a wall-clock epoch for `PracticeEntry.startedAt`.
  const [date] = useState<DateSource>(() => ({ epochMillis: () => Date.now() }))
  const practiceLog = usePracticeLog({ clock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog
  const [rng] = useState<Rng>(() => options.rng ?? createBrowserRng())
  const [audioOutput, setAudioOutput] = useState<AudioOutput | undefined>(options.audioOutput)
  const audioOutputRef = useRef<AudioOutput | undefined>(options.audioOutput)

  const midi = useMidiConnection(
    options.midiInput !== undefined
      ? { midiInput: options.midiInput }
      : options.connectMidi !== undefined
        ? { connect: options.connectMidi }
        : {},
  )

  const [phase, setPhase] = useState<RhythmUiPhase>('idle')
  const [pattern, setPattern] = useState<RhythmPattern | undefined>(undefined)
  const [grade, setGrade] = useState<TapGrade | undefined>(undefined)
  const [tapCount, setTapCount] = useState(0)

  /** The pattern/tempo the CURRENT run is graded against, read by effects that
   * must not depend on the `pattern` state (they fire on `engine.phase`, not
   * on a pattern change). */
  const patternRef = useRef<RhythmPattern | undefined>(undefined)
  const tempoMapRef = useRef<TempoMap | undefined>(undefined)
  const tapsRef = useRef<Millis[]>([])
  const anchorMsRef = useRef<Millis>(millis(0))
  /** Set by `start()`, consumed by the deferred play effect below. */
  const pendingPlayRef = useRef(false)
  /** True once THIS run's `play()` has actually fired — gates the "run ended"
   * effect so the transport's initial idle 'stopped' is never mistaken for
   * the end of a run that has not started yet. */
  const hasPlayedRef = useRef(false)

  const engineAudioOutput = useMemo(
    () => (audioOutput === undefined ? undefined : silentAudioOutput(audioOutput)),
    [audioOutput],
  )

  const { score, tempo } = useMemo(() => {
    if (pattern === undefined) return { score: undefined, tempo: undefined }
    const generatedScore = rhythmToScore(pattern)
    return { score: generatedScore, tempo: makeTempoMap(generatedScore.tempos) }
  }, [pattern])

  // Keeps the grading tempo map in lockstep with the SAME `Score` instance the
  // transport plays — `score` and `tempo` are derived together above from one
  // `rhythmToScore` call, so they can never disagree.
  useEffect(() => {
    tempoMapRef.current = tempo
  }, [tempo])

  const engine = usePracticeEngine({
    score,
    activeHands: ACTIVE_HANDS,
    tempoScale: 1,
    loop: undefined,
    metronomeEnabled: options.metronomeEnabled ?? true,
    metronomeSubdivision: 1,
    waitModeEnabled: false,
    clock,
    audioOutput: engineAudioOutput,
    midiInput: midi.input,
    ...(options.frameDriver === undefined ? {} : { frameDriver: options.frameDriver }),
  })

  // Covers ONLY the very first run ever, when `start()` below found no
  // existing transport to carry `play()` over onto (see its comment): that
  // transport takes an extra commit to build, and `engine.position` becomes
  // defined the instant it is — safe to `engine.play()` for the first time.
  useEffect(() => {
    if (!pendingPlayRef.current) return
    if (engine.position === undefined) return
    pendingPlayRef.current = false
    const anchor = engine.play()
    anchorMsRef.current = anchor ?? clock.now()
    hasPlayedRef.current = true
  }, [engine, clock])

  // The run just reached the end (the transport played through to its final
  // tick and auto-stopped) — grade the taps collected against it.
  useEffect(() => {
    if (!hasPlayedRef.current) return
    if (engine.phase !== 'stopped') return
    const currentPattern = patternRef.current
    const tempo = tempoMapRef.current
    if (currentPattern === undefined || tempo === undefined) return
    hasPlayedRef.current = false
    const result = gradeTapping(currentPattern, tapsRef.current, tempo)
    setGrade(result)
    setPhase('graded')
    practiceLogRef.current.stop({ accuracy: result.accuracy })
  }, [engine.phase])

  function start(): void {
    if (phase === 'tapping') return
    if (audioOutputRef.current === undefined) {
      audioOutputRef.current = createDefaultAudioOutput()
      setAudioOutput(audioOutputRef.current)
    }
    const generated = generateRhythm(
      {
        bars: options.bars,
        timeSignature: TIME_SIGNATURE,
        complexity: options.complexity,
        allowRests: true,
        allowTies: true,
      },
      rng,
    )
    patternRef.current = generated
    tapsRef.current = []
    hasPlayedRef.current = false
    setGrade(undefined)
    setTapCount(0)
    practiceLogRef.current.start('technique', `Rhythm — complexity ${options.complexity}`)

    // Play whatever transport already exists BEFORE the score below changes:
    // `usePracticeEngine`'s own rebuild effect carries a RUNNING previous
    // transport's state over onto the brand new transport it builds for the
    // fresh score (see that module's comment on `previous`/`wasRunning`),
    // which is what keeps this safe from a real race. A deferred
    // `engine.play()` call made only AFTER the score changes cannot tell a
    // freshly-built, not-yet-played transport apart from the OLD, already
    // FINISHED one — both report a defined position on the very next render,
    // before the new transport exists — and so can end up firing against the
    // wrong instance entirely (see the roadmap-2.13 report). The very first
    // run ever has no transport to carry over — `engine.play()` here is then
    // a harmless no-op — so `pendingPlayRef` still covers exactly that one
    // case, in the effect above.
    const anchor = engine.play()
    if (anchor !== undefined) {
      anchorMsRef.current = anchor
      hasPlayedRef.current = true
      pendingPlayRef.current = false
    } else {
      pendingPlayRef.current = true
    }

    setPattern(generated)
    setPhase('tapping')
  }

  function tap(): void {
    if (phase !== 'tapping') return
    const relative = millis(clock.now() - anchorMsRef.current)
    tapsRef.current = [...tapsRef.current, relative]
    setTapCount((count) => count + 1)
  }

  const tapRef = useRef(tap)
  tapRef.current = tap
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // The spacebar taps, exactly like the on-screen button — ignoring
  // auto-repeat (holding the key down must not count as many taps) — but only
  // while a run is actually 'tapping': preventing Space's default (page
  // scroll, button activation) in every other phase would break keyboard
  // activation of Start/Again/the complexity steppers, and disable page
  // scroll for as long as the screen is mounted while idle.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code !== 'Space' || event.repeat) return
      if (phaseRef.current !== 'tapping') return
      event.preventDefault()
      tapRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A real MIDI press taps exactly like the on-screen button or the spacebar
  // — any key counts, since a tapping drill grades timing, not pitch.
  useEffect(() => {
    if (midi.input === undefined) return undefined
    return midi.input.onEvent((event) => {
      if (event.type === 'noteOn') tapRef.current()
    })
  }, [midi.input])

  return {
    phase,
    pattern,
    score,
    grade,
    tapCount,
    position: engine.position,
    midi,
    start,
    tap,
  }
}
