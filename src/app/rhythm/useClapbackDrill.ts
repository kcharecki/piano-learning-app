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
 *
 * ## Level: sourced from and persisted to the ear-training session (roadmap
 * 3.21/5.21 review fix, MAJOR-1)
 *
 * Earlier this drill's `level` was plain `useState` owned by `RhythmClapback`,
 * initialised to `MIN_LEVEL` on every mount and never written anywhere —
 * `gradeClapback`'s own result fed only `practiceLog.stop`, so the level
 * reset to 1 on every remount and the level-scaled tolerance table in
 * `core/rhythm/clapback.ts` (`BASE_TOLERANCE_TICKS`) was, in practice, always
 * row 1. This hook now owns `level` itself, exactly the way
 * `app/eartraining/useEarTraining.ts` owns `session.levels[kind]`: sourced
 * from `useEarTrainingStore` at mount, re-adapted with `adaptEarLevel`
 * (`core/eartraining/session.ts`) whenever a tapping run reaches `'graded'`,
 * and written back to the same store so it survives a remount exactly like
 * every other ear-training level does.
 *
 * `'rhythmic-dictation'` is the `EarItemKind` bucket this reuses — the
 * closest existing one, not a new one invented for this drill: both drills
 * generate a `core/generator/rhythm.ts` pattern at a 1-5 `complexity`/`level`
 * and grade how well the learner reproduced its onsets from memory, so
 * sharing one adaptive ladder for "reproduce a rhythm you just heard" is the
 * more defensible reading of "reuse it" than inventing a second `EarItemKind`
 * would be — which would also mean editing `core/eartraining/item.ts` and
 * `session.ts`'s `KIND_SET`, files this task's brief does not own and says
 * not to touch unless genuinely unavoidable. Only `EarSessionState.levels` is
 * read/written here, deliberately never `recordEarAttempt` or an SRS `Card`:
 * a clap-back pattern has no stable, reconstructable id the way a dictation
 * item's `answerKey`-derived id does (see `dictation.ts`'s own module doc on
 * why that id has to be stable), so creating a card for one would leave
 * `nextDueItemId` recommending "due" reviews `useEarTraining.ts` could never
 * actually replay. The pure band-unanimity ladder function itself
 * (`adaptEarLevel`) is reused directly instead, fed a recent-attempt window
 * this hook keeps locally (never merged into `session.attempts`, which stays
 * exclusively the real ear-training drill's own history) and filtered to the
 * current level only — mirroring `recordEarAttempt`'s own `kindAttempts`
 * filter so a level change never lets stale evidence from a level the learner
 * has since left keep counting.
 *
 * `options.level` remains as a test-only escape hatch: when a caller passes
 * it explicitly, this hook never reads or writes the store at all, so
 * `useClapbackDrill.test.ts`'s existing level-controlled tests stay exactly
 * as deterministic as before.
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
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { generateRhythm, rhythmToScore, type RhythmPattern, type TimeSignature } from '@core/generator/rhythm.ts'
import {
  gradeClapback,
  toleranceTicksForLevel,
  type ClapbackGrade,
  type ClapbackLevel,
} from '@core/rhythm/clapback.ts'
import type { Hand } from '@core/notation/score.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import { EAR_MAX_LEVEL, EAR_MIN_LEVEL, adaptEarLevel, type EarAttempt } from '@core/eartraining/session.ts'
import type { AudioOutput, Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { makeTempoMap, msToTick, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { millis, ticks, type Millis, type Ticks } from '@core/shared/units.ts'
import {
  classifyTap,
  closeExpiredOnsets,
  defaultHitWindowTicks,
  initTapClassifierState,
  snapshotGrade,
  type TapClassifierOptions,
  type TapClassifierState,
  type TapVerdict,
} from '@core/rhythm/tapClassifier.ts'
import { useEffect, useMemo, useRef, useState } from 'react'

export type ClapbackUiPhase = 'idle' | 'listening' | 'tapping' | 'graded'

export type UseClapbackDrillOptions = {
  readonly bars: number
  /** Test-only escape hatch: pins the level and skips the ear-training store
   *  entirely (no read at mount, no write on grade) — see the module doc's
   *  "Level" section. Production (`RhythmClapback.tsx`) never passes this. */
  readonly level?: ClapbackLevel
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
  /** Sourced from and persisted to the ear-training session — see the module doc's "Level" section. */
  readonly level: ClapbackLevel
  /** The pattern being played/tapped, or the last one graded. Never engraved anywhere. */
  readonly pattern: RhythmPattern | undefined
  readonly grade: ClapbackGrade | undefined
  /** How many taps have been registered in the current (tapping) run. */
  readonly tapCount: number
  /** Roadmap U.3: the live verdict of the MOST RECENT tap ('hit'/'early'/'late'),
   *  or `undefined` for a tap that matched no onset (an "extra" tap), or before
   *  any tap has happened this run. Reset to `undefined` by `start()`. Only
   *  ever set while 'tapping' — the 'listening' half never taps. */
  readonly lastTapVerdict: TapVerdict | undefined
  readonly position: PositionDisplay | undefined
  readonly midi: MidiConnection
  /** Generates a fresh pattern and starts listening. No-op mid-run. */
  readonly start: () => void
  /** One tap, from any source. No-op unless phase is 'tapping'. */
  readonly tap: () => void
  /** Roadmap U.3: end the tapping run early. Grades only the elapsed prefix —
   *  every onset whose matching window had not yet closed at the moment Stop
   *  was pressed is left ungraded, never counted as missed (see
   *  `core/rhythm/tapClassifier.ts`'s `closeExpiredOnsets`). No-op unless
   *  phase is 'tapping' (there is nothing to grade while only 'listening'). */
  readonly stop: () => void
  /** A manual override (e.g. the level +/- buttons) — persists exactly like an adapted level. */
  readonly setLevel: (level: ClapbackLevel) => void
}

const TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

/** The `EarItemKind` bucket this drill's level is sourced from and adapted into — see the module
 *  doc's "Level" section for why this reuses an existing kind rather than inventing one. */
const CLAPBACK_LEVEL_KIND: EarItemKind = 'rhythmic-dictation'

/** Clamp+round into the `ClapbackLevel` union — mirrors `dictation.ts`'s own `clampComplexity`,
 *  needed because `adaptEarLevel`/the store both traffic in a plain `number`. `EAR_MIN_LEVEL`/
 *  `EAR_MAX_LEVEL` (1/5) are numerically identical to `ClapbackLevel`'s own bounds, which is what
 *  makes sharing the ladder possible at all. */
function toClapbackLevel(level: number): ClapbackLevel {
  return Math.min(EAR_MAX_LEVEL, Math.max(EAR_MIN_LEVEL, Math.round(level))) as ClapbackLevel
}

/** How many random draws `start()` tries before forcing rests off — see the "regenerate while the
 *  whole pattern is a rest" review fix (MINOR-4) below. */
const MAX_REGENERATE_ATTEMPTS = 20

/**
 * A pattern with at least one real onset, never all-rest. `generateRhythm({ allowRests: true })`
 * can legitimately draw a pattern whose every onset is a rest (measured, roadmap 3.21 review: 59
 * of 3000 seeds at level 2, 7 of 3000 at level 3, bars: 1) — ungraded before this fix because
 * `RhythmClapback.tsx` hardcodes `bars: 2`, which made it unreachable in practice but not
 * impossible, and `gradeClapback`'s own `accuracy: total === 0 ? 1 : ...` would score a learner
 * who tapped nothing at all a perfect 100% against it. Retried like
 * `core/eartraining/dictation.ts`'s own bar-growth retry (same underlying cause: a rest-heavy draw
 * clearing a floor is a matter of odds, not a guarantee) — but WITHOUT growing `bars`, since a
 * clap-back pattern's length is deliberately fixed for the level being practised. Forcing rests off
 * on the final attempt (mirroring `dictation.ts`'s identical fallback) guarantees termination.
 */
function generateNonEmptyPattern(bars: number, level: ClapbackLevel, rng: Rng): RhythmPattern {
  for (let attempt = 0; attempt < MAX_REGENERATE_ATTEMPTS; attempt++) {
    const candidate = generateRhythm(
      { bars, timeSignature: TIME_SIGNATURE, complexity: level, allowRests: true, allowTies: true },
      rng,
    )
    if (candidate.onsets.some((o) => !o.isRest)) return candidate
  }
  return generateRhythm(
    { bars, timeSignature: TIME_SIGNATURE, complexity: level, allowRests: false, allowTies: true },
    rng,
  )
}

/** Stable reference across renders — see `useRhythmDrill.ts`'s identical comment on why this matters
 *  (a fresh `['right']` literal would defeat `usePracticeEngine`'s `activeHands` memo every render). */
const ACTIVE_HANDS: readonly Hand[] = ['right']

/**
 * `rhythmToScore` never passes `tempos`, so — exactly as `useRhythmDrill.ts`'s
 * identical `FIXED_TEMPO` documents — every clap-back run plays against a
 * fixed single 120bpm mark at tick 0 regardless of level or pattern. Used
 * only to convert ms-domain quantities (a live tap's `clock.now() -
 * anchorMs`, a manual Stop's elapsed time) into ticks for the live
 * classifier, and back.
 */
const FIXED_TEMPO: TempoMap = makeTempoMap([])

export function useClapbackDrill(options: UseClapbackDrillOptions): UseClapbackDrill {
  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
  const [date] = useState<DateSource>(() => ({ epochMillis: () => Date.now() }))
  const practiceLog = usePracticeLog({ clock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog
  const [rng] = useState<Rng>(() => options.rng ?? createBrowserRng())
  const [audioOutput, setAudioOutput] = useState<AudioOutput | undefined>(options.audioOutput)
  const audioOutputRef = useRef<AudioOutput | undefined>(options.audioOutput)

  // See the module doc's "Level" section: `options.level`, when passed, pins the level and
  // opts this hook instance out of the store entirely — used only by tests.
  const externalLevel = options.level
  const [level, setLevelState] = useState<ClapbackLevel>(
    () => externalLevel ?? toClapbackLevel(useEarTrainingStore.getState().session.levels[CLAPBACK_LEVEL_KIND]),
  )
  /** Recent clap-back attempts at the CURRENT level only — never written into
   *  `earTrainingStore`'s own `session.attempts`, which stays exclusively the
   *  real ear-training drills' history (see the module doc). Reset whenever
   *  the level moves, mirroring `recordEarAttempt`'s own same-level filter. */
  const levelAttemptsRef = useRef<EarAttempt[]>([])

  /** A manual override (e.g. the level +/- buttons): sets the level directly, no `adaptEarLevel`
   *  involved, and persists it exactly like an adapted level so it survives a remount too. */
  function setLevel(next: ClapbackLevel): void {
    setLevelState(next)
    levelAttemptsRef.current = []
    if (externalLevel !== undefined) return
    const store = useEarTrainingStore.getState()
    store.setSession({
      ...store.session,
      levels: { ...store.session.levels, [CLAPBACK_LEVEL_KIND]: next },
    })
  }

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
  /** The level `start()` generated the CURRENT pattern at — read by the
   *  score-title memo below instead of `level` directly, mirroring
   *  `useRhythmDrill.ts`'s identical `patternComplexityRef`: `level` can
   *  change (the +/- buttons, or adaptation on grading) without a fresh
   *  `start()`, and this score must never be relabelled with a level it was
   *  not actually drawn at. The title is not user-visible today (this hook
   *  deliberately never hands its `Score` out — see the module doc) but is
   *  kept real anyway, the same class-level guarantee `rhythmToScore` now
   *  makes for every caller (roadmap 5.56). */
  const patternLevelRef = useRef<ClapbackLevel>(externalLevel ?? level)
  const tempoMapRef = useRef<TempoMap | undefined>(undefined)
  const tapsRef = useRef<Millis[]>([])
  const anchorMsRef = useRef<Millis>(millis(0))
  /** Roadmap U.3: the CURRENT run's onsets (rests excluded, ascending), the
   *  FIFO classifier cursor over them, and the level-scaled matching window
   *  it was built with (`toleranceTicksForLevel`, the SAME table
   *  `gradeClapback` grades a finished run against) — read/written by `tap()`
   *  and `stop()`, reset by `start()`. */
  const onsetTicksRef = useRef<readonly Ticks[]>([])
  const classifierStateRef = useRef<TapClassifierState>(initTapClassifierState(0))
  const initialToleranceTicks = toleranceTicksForLevel(patternLevelRef.current)
  const classifierOptsRef = useRef<TapClassifierOptions>({
    toleranceTicks: initialToleranceTicks,
    hitWindowTicks: defaultHitWindowTicks(initialToleranceTicks),
  })
  const [lastTapVerdict, setLastTapVerdict] = useState<TapVerdict | undefined>(undefined)
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
    // roadmap 5.56: name the drill and the level it was drawn at, mirroring
    // `useRhythmDrill.ts`'s identical title — see `patternLevelRef`'s own
    // comment for why the ref, not `level` directly.
    const generatedScore = rhythmToScore(pattern, {
      title: `Clap back — level ${patternLevelRef.current}`,
    })
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

  /**
   * Apply a finished tapping grade — shared by the normal "run reached the
   * end" path (below) and the manual `stopRun()` path (roadmap U.3), so a
   * learner who presses Stop gets exactly the same practice-log entry and
   * level re-adaptation as one who lets the pattern run out, from whichever
   * grade the caller computed.
   */
  function finishTapping(result: ClapbackGrade): void {
    setGrade(result)
    setPhase('graded')
    practiceLogRef.current.stop({ accuracy: result.accuracy })

    // MAJOR-1 review fix: re-adapt the level from the graded accuracy — see the
    // module doc's "Level" section. Skipped entirely when a caller pins the level
    // (`options.level`, test-only), matching `setLevel`'s identical guard.
    if (externalLevel === undefined) {
      const attempt: EarAttempt = {
        itemId: 'clapback',
        kind: CLAPBACK_LEVEL_KIND,
        accuracy: result.accuracy,
        at: date.epochMillis(),
        level,
      }
      // Only attempts at the level this WAS drawn from count as evidence for the
      // next decision — mirrors `recordEarAttempt`'s own `kindAttempts` filter.
      const relevant = [...levelAttemptsRef.current, attempt].filter((a) => a.level === level)
      levelAttemptsRef.current = relevant
      const nextLevel = toClapbackLevel(adaptEarLevel(level, relevant))
      if (nextLevel !== level) {
        levelAttemptsRef.current = []
        setLevelState(nextLevel)
      }
      const store = useEarTrainingStore.getState()
      store.setSession({
        ...store.session,
        levels: { ...store.session.levels, [CLAPBACK_LEVEL_KIND]: nextLevel },
      })
    }
  }

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
      const result = gradeClapback(currentPattern, tapsRef.current, tempoMap, level)
      finishTapping(result)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a transport-state transition should re-run this; level/date/externalLevel are read fresh each call
  }, [engine.phase])

  function start(): void {
    if (phase === 'listening' || phase === 'tapping') return
    if (audioOutputRef.current === undefined) {
      audioOutputRef.current = createDefaultAudioOutput()
      setAudioOutput(audioOutputRef.current)
    }
    // MINOR-4 review fix: never hand the learner an all-rest pattern — see
    // `generateNonEmptyPattern`'s own doc.
    const generated = generateNonEmptyPattern(options.bars, level, rng)
    patternRef.current = generated
    patternLevelRef.current = level
    tapsRef.current = []
    hasPlayedRef.current = false
    const onsetTicks = generated.onsets.filter((o) => !o.isRest).map((o) => o.tick)
    onsetTicksRef.current = onsetTicks
    const toleranceTicks = toleranceTicksForLevel(level)
    classifierOptsRef.current = { toleranceTicks, hitWindowTicks: defaultHitWindowTicks(toleranceTicks) }
    classifierStateRef.current = initTapClassifierState(onsetTicks.length)
    setGrade(undefined)
    setTapCount(0)
    setLastTapVerdict(undefined)
    practiceLogRef.current.start('eartraining', `Clap back — level ${level}`)

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

    // Roadmap U.3: live per-tap verdict — pure function of `onsetTicksRef`/
    // `classifierStateRef`/`classifierOptsRef`, so this never affects (and is
    // never affected by) `gradeClapback`'s own read of `tapsRef` above.
    const tapTick = msToTick(FIXED_TEMPO, relative)
    const result = classifyTap(onsetTicksRef.current, classifierStateRef.current, tapTick, classifierOptsRef.current)
    classifierStateRef.current = result.state
    setLastTapVerdict(result.classification?.verdict)
  }

  /**
   * Roadmap U.3: manual Stop. Grades only the elapsed prefix — see this
   * function's own use of `closeExpiredOnsets` and the `UseClapbackDrill.stop`
   * doc comment above.
   *
   * Deliberately does NOT run `gradeClapback`'s tempo-scale fit
   * (`fitTempoScale`/`DEFAULT_MAX_TEMPO_SCALE`, see `clapback.ts`'s module
   * doc): that fit needs the FULL tap list to find a single scale factor that
   * best explains every gap at once, which is exactly what a Stop mid-pattern
   * does not have. Grading the elapsed prefix directly against the level's
   * own (unscaled) tolerance window is the same trade `tapClassifier.ts`
   * already makes for live per-tap feedback, just applied to the summary too.
   */
  function stopRun(): void {
    if (phase !== 'tapping') return

    // MUST be read before `engine.stop()` — see `useRhythmDrill.ts`'s
    // identical comment on why: `PracticeEngine.stop()` rewinds the
    // transport's position before returning, so anything derived from it
    // AFTER that call describes where the transport landed, not where the
    // learner actually stopped it.
    const elapsedMs = millis(clock.now() - anchorMsRef.current)
    const elapsedTick = msToTick(FIXED_TEMPO, elapsedMs)

    // Gate the "run ended" effect BEFORE `engine.stop()` — see
    // `useRhythmDrill.ts`'s identical comment.
    hasPlayedRef.current = false
    engine.stop()

    const finalState = closeExpiredOnsets(
      onsetTicksRef.current,
      classifierStateRef.current,
      elapsedTick,
      classifierOptsRef.current,
    )
    classifierStateRef.current = finalState
    const snapshot = snapshotGrade(finalState)
    // `FIXED_TEMPO` is a single mark anchored at tick 0, so `tickToMs` is a
    // pure linear scale with no offset — applying it to a ticks MAGNITUDE (a
    // mean deviation, not a position) is exactly as valid as applying it to a
    // tick position, which is what makes this safe (see `useRhythmDrill.ts`'s
    // identical reasoning).
    const result: ClapbackGrade = {
      matched: snapshot.matched,
      missed: snapshot.missed,
      extra: snapshot.extra,
      accuracy: snapshot.accuracy,
      meanAbsDeviationMs: Number(tickToMs(FIXED_TEMPO, ticks(snapshot.meanAbsDeviationTicks))),
      tempoScale: 1,
    }
    finishTapping(result)
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
    level,
    pattern,
    grade,
    tapCount,
    lastTapVerdict,
    position: engine.position,
    midi,
    start,
    tap,
    stop: stopRun,
    setLevel,
  }
}
