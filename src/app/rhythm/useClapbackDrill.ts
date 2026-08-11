/**
 * The clap/tap-back drill (roadmap 3.21/5.21, REQ-3.6.2): the learner HEARS a
 * generated rhythm phrase — the notation is never engraved anywhere in this
 * file's dependents, structurally, not merely hidden by CSS — then taps it
 * back from memory once playback ends. `core/rhythm/clapback.ts` grades what
 * they tapped; this hook is the wiring around it.
 *
 * ## Two silent-cursor runs on ONE transport, not two engines
 *
 * A naive design reaches for two `usePracticeEngine` instances — one for
 * "listen", one for "tap" — but that means two builds of the same score and
 * twice the anchor bookkeeping to get right. Instead this uses exactly the
 * SAME machinery `useRhythmDrill.ts` already proved out (one transport, one
 * `usePracticeEngine`, the same `anchorMs` trick for taps), run over the
 * pattern TWICE:
 *
 *  1. **Listening** — the transport plays once with the REAL `AudioOutput`
 *     (not wrapped in `silentAudioOutput`) and the metronome forced off: the
 *     learner hears the phrase itself, nothing else. No taps are recorded.
 *  2. **Tapping** — when that run ends (`engine.phase` reaches `'stopped'`),
 *     `engine.rewindToTop()` + `engine.play()` restart the SAME transport
 *     instance from tick 0 — exactly the primitive `PracticeEngine.rewindToTop`
 *     documents itself for ("a caller may `play()` straight after and be
 *     certain it starts at the top") — this time with `silentAudioOutput`
 *     (so the pattern is never re-heard, only clicked) and the metronome on,
 *     giving the learner a pulse to clap against. Taps are captured relative
 *     to THIS run's own anchor, exactly as `useRhythmDrill.ts` does for its
 *     one and only run.
 *
 * `AudioOutput`/metronome for the engine are swapped via a `phase`-keyed
 * `useMemo`, never a transport rebuild: `usePracticeEngine` only rebuilds on
 * a score/hand change (see its own module doc), and both `audioOutput` and
 * `metronomeEnabled` are read fresh every frame through the LATEST closure
 * (`useTransportLoop`'s own `onFrameRef`) — so toggling them between phases
 * needs no special-casing here beyond passing the phase-dependent value in.
 *
 * ## Why `score`/`position` are not on this hook's return type
 *
 * `useRhythmDrill` exposes its `Score` so the sight-reading rhythm drill can
 * engrave it — the whole point there. Here the opposite guarantee matters:
 * nothing this hook returns can be handed to `ExerciseScore`/`ScoreViewer` by
 * accident, because there is no `Score` in the return type to hand it. The
 * `Score` this hook builds internally (to drive playback) never leaves it.
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
import { generateRhythm, rhythmToScore, type RhythmPattern, type TimeSignature } from '@core/generator/rhythm.ts'
import { gradeClapback, type ClapbackGrade, type ClapbackLevel } from '@core/rhythm/clapback.ts'
import type { Hand } from '@core/notation/score.ts'
import type { AudioOutput, Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { makeTempoMap, type TempoMap } from '@core/timing/tempo.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import { useEffect, useMemo, useRef, useState } from 'react'

export type ClapbackUiPhase = 'idle' | 'listening' | 'tapping' | 'graded'

export type UseClapbackDrillOptions = {
  readonly level: ClapbackLevel
  readonly bars: number
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly rng?: Rng
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
  /** REQ-3.9.1-style: the click is on by default during the TAPPING half only — see the module doc. */
  readonly metronomeEnabled?: boolean
}

export type UseClapbackDrill = {
  readonly phase: ClapbackUiPhase
  /** The pattern being played/tapped, or the last one graded. Never engraved anywhere. */
  readonly pattern: RhythmPattern | undefined
  readonly grade: ClapbackGrade | undefined
  /** How many taps have been registered in the current (tapping) run. */
  readonly tapCount: number
  readonly position: PositionDisplay | undefined
  readonly midi: MidiConnection
  /** Generates a fresh pattern and starts listening. No-op mid-run. */
  readonly start: () => void
  /** One tap, from any source. No-op unless phase is 'tapping'. */
  readonly tap: () => void
}

const TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

/** Stable reference across renders — see `useRhythmDrill.ts`'s identical comment on why this matters
 *  (a fresh `['right']` literal would defeat `usePracticeEngine`'s `activeHands` memo every render). */
const ACTIVE_HANDS: readonly Hand[] = ['right']

export function useClapbackDrill(options: UseClapbackDrillOptions): UseClapbackDrill {
  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
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

  const [phase, setPhase] = useState<ClapbackUiPhase>('idle')
  const [pattern, setPattern] = useState<RhythmPattern | undefined>(undefined)
  const [grade, setGrade] = useState<ClapbackGrade | undefined>(undefined)
  const [tapCount, setTapCount] = useState(0)

  const patternRef = useRef<RhythmPattern | undefined>(undefined)
  const tempoMapRef = useRef<TempoMap | undefined>(undefined)
  const tapsRef = useRef<Millis[]>([])
  const anchorMsRef = useRef<Millis>(millis(0))
  /** Set by `start()`, consumed by the deferred play effect below — only the
   *  very first run ever needs this (see `useRhythmDrill.ts`'s identical
   *  comment for why): every later phase transition replays an ALREADY-BUILT
   *  transport via `rewindToTop()` + `play()`, which never defers. */
  const pendingPlayRef = useRef(false)
  /** True once the CURRENT run's `play()` has actually fired — gates the
   *  "run ended" effect exactly as `useRhythmDrill.ts` gates it. */
  const hasPlayedRef = useRef(false)
  /** Mirrors `phase` for the "run ended" effect, which only re-fires on
   *  `engine.phase` changes and so cannot read a state update this same pass
   *  just scheduled. */
  const phaseRef = useRef<ClapbackUiPhase>('idle')
  phaseRef.current = phase

  const engineAudioOutput = useMemo(() => {
    if (audioOutput === undefined) return undefined
    // Listening is the one moment this drill is allowed to sound the pattern
    // itself (REQ-3.6.2: "hear a phrase") — every other phase reuses the
    // silent-but-clicking wrapper `useRhythmDrill.ts`/the sight-reading
    // trainer both already rely on for the same reason (see
    // `silentAudioOutput`'s own module doc).
    return phase === 'listening' ? audioOutput : silentAudioOutput(audioOutput)
  }, [audioOutput, phase])

  const { score, tempo } = useMemo(() => {
    if (pattern === undefined) return { score: undefined, tempo: undefined }
    const generatedScore = rhythmToScore(pattern)
    return { score: generatedScore, tempo: makeTempoMap(generatedScore.tempos) }
  }, [pattern])

  useEffect(() => {
    tempoMapRef.current = tempo
  }, [tempo])

  const engine = usePracticeEngine({
    score,
    activeHands: ACTIVE_HANDS,
    tempoScale: 1,
    loop: undefined,
    // The click is deliberately OFF while listening (REQ-3.6.2: the phrase
    // itself is the only thing heard) and on by default while tapping —
    // "a tapping drill needs a pulse", `useRhythmDrill.ts`'s own reasoning,
    // applies identically to the tapping half of this drill.
    metronomeEnabled: phase === 'listening' ? false : (options.metronomeEnabled ?? true),
    metronomeSubdivision: 1,
    waitModeEnabled: false,
    clock,
    audioOutput: engineAudioOutput,
    midiInput: midi.input,
    ...(options.frameDriver === undefined ? {} : { frameDriver: options.frameDriver }),
  })

  // Covers ONLY the very first run ever — see `pendingPlayRef`'s own comment.
  useEffect(() => {
    if (!pendingPlayRef.current) return
    if (engine.position === undefined) return
    pendingPlayRef.current = false
    const anchor = engine.play()
    anchorMsRef.current = anchor ?? clock.now()
    hasPlayedRef.current = true
  }, [engine, clock])

  // The current run (listening OR tapping) just reached the end. Which one
  // decides what happens next: listening hands off to tapping on the SAME
  // transport instance; tapping grades the taps collected against it.
  useEffect(() => {
    if (!hasPlayedRef.current) return
    if (engine.phase !== 'stopped') return
    const currentPhase = phaseRef.current

    if (currentPhase === 'listening') {
      hasPlayedRef.current = false
      tapsRef.current = []
      setTapCount(0)
      // `rewindToTop` + `play` on the SAME transport instance — see the
      // module doc and `PracticeEngine.rewindToTop`'s own contract ("a
      // caller may `play()` straight after and be certain it starts at the
      // top of the whole piece"). The transport already exists (it just
      // finished the listening run), so `play()` here always reanchors for
      // real; no deferred-play case applies.
      engine.rewindToTop()
      const anchor = engine.play()
      anchorMsRef.current = anchor ?? clock.now()
      hasPlayedRef.current = true
      setPhase('tapping')
      return
    }

    if (currentPhase === 'tapping') {
      const currentPattern = patternRef.current
      const tempoMap = tempoMapRef.current
      if (currentPattern === undefined || tempoMap === undefined) return
      hasPlayedRef.current = false
      const result = gradeClapback(currentPattern, tapsRef.current, tempoMap, options.level)
      setGrade(result)
      setPhase('graded')
      practiceLogRef.current.stop({ accuracy: result.accuracy })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a transport-state transition should re-run this; options.level is read fresh each call
  }, [engine.phase])

  function start(): void {
    if (phase === 'listening' || phase === 'tapping') return
    if (audioOutputRef.current === undefined) {
      audioOutputRef.current = createDefaultAudioOutput()
      setAudioOutput(audioOutputRef.current)
    }
    const generated = generateRhythm(
      {
        bars: options.bars,
        timeSignature: TIME_SIGNATURE,
        complexity: options.level,
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
    practiceLogRef.current.start('eartraining', `Clap back — level ${options.level}`)

    // Same "play the OLD transport before the score changes" trick
    // `useRhythmDrill.ts` uses, for the identical reason (see its own long
    // comment): only the very first run ever has no previous transport to
    // carry `play()` over onto, which `pendingPlayRef` covers in the effect
    // above.
    const anchor = engine.play()
    if (anchor !== undefined) {
      anchorMsRef.current = anchor
      hasPlayedRef.current = true
      pendingPlayRef.current = false
    } else {
      pendingPlayRef.current = true
    }

    setPattern(generated)
    setPhase('listening')
  }

  function tap(): void {
    if (phase !== 'tapping') return
    const relative = millis(clock.now() - anchorMsRef.current)
    tapsRef.current = [...tapsRef.current, relative]
    setTapCount((count) => count + 1)
  }

  const tapRef = useRef(tap)
  tapRef.current = tap

  // The spacebar taps, exactly like the on-screen button — ignoring
  // auto-repeat — but only while actually 'tapping', for the same reasons
  // `useRhythmDrill.ts` gates it identically (keyboard activation of
  // Start/Again, and page scroll, must survive every other phase).
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
  // — any key counts, since timing, not pitch, is graded.
  useEffect(() => {
    if (midi.input === undefined) return undefined
    return midi.input.onEvent((event) => {
      if (event.type === 'noteOn') tapRef.current()
    })
  }, [midi.input])

  return {
    phase,
    pattern,
    grade,
    tapCount,
    position: engine.position,
    midi,
    start,
    tap,
  }
}
