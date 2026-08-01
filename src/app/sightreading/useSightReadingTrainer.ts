/**
 * The sight-reading trainer's screen wiring (roadmap 2.12, REQ-3.4.1/3/4/6).
 * Composes the core state machine (`SightReadingSession`,
 * `core/sightreading/session.ts`) and the generator/adaptive pickers
 * (`core/sightreading/adaptive.ts`) with the SAME transport/assessment
 * machinery the practice screen uses (`usePracticeEngine`, `useAssessment`,
 * both `@app/practice`, imported — not owned or modified — exactly as
 * `ScoreScreen` already imports `PracticeScreen`).
 *
 * ## Discipline first, wiring second
 *
 * `SightReadingSession` alone enforces "no going back to preview" and
 * produces the retirement record; it knows nothing about a transport. This
 * hook is the glue: it drives `session.update()` every frame while previewing
 * (via `useTransportLoop`, the same pump `usePracticeEngine` uses for
 * playback), and the instant the session's own phase leaves `'preview'`
 * (timeout, or the learner's own `skipPreview`), it starts `useAssessment`'s
 * run — fixed tempo, no pausing, one pass top to bottom, exactly REQ-3.4.4's
 * "no stopping". `useAssessment` already knows how to detect that run ending
 * (the transport playing off the end) and reduces it to an `AssessmentResult`;
 * this hook's own job ends at forwarding that result into
 * `SightReadingSession.finish()`, which is what stamps the retirement record
 * and closes the state machine.
 *
 * ## No shadowing the notation with sound
 *
 * `usePracticeEngine`'s `dispatchAudio` sounds the score's own notes whenever
 * an `AudioOutput` is present — exactly right for ordinary practice, where the
 * point is to play along with what you hear, but exactly wrong for sight
 * reading, where hearing the piece first is the discipline REQ-3.4.4 exists to
 * prevent. `silentAudioOutput` wraps whatever real output this hook is given
 * so only the metronome click survives; see that module's comment.
 *
 * ## Level adaptation
 *
 * On a finished run, `adaptLevel` (`core/sightreading/adaptive.ts`) reads the
 * store's updated history (this run's own record included, via `retire`) and
 * decides whether the level moves. The store (`sightReadingStore.ts`) never
 * makes that decision itself — it only holds `level` and `history` — so this
 * hook is the one and only caller of `adaptLevel`.
 */
import type { Hand, Score } from '@core/notation/score.ts'
import type { AudioOutput, Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import type { AssessmentResult } from '@core/practice/assessment.ts'
import { adaptLevel, nextExerciseParams } from '@core/sightreading/adaptive.ts'
import { generateMelody } from '@core/generator/melody.ts'
import {
  retire,
  SightReadingSession,
  type SightReadingPhase,
  type SightReadingRecord,
} from '@core/sightreading/session.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import { useAssessment } from '@app/practice/useAssessment.ts'
import {
  useMidiConnection,
  type ConnectMidi,
  type MidiConnection,
} from '@app/practice/useMidiConnection.ts'
import { usePracticeEngine, type PositionDisplay } from '@app/practice/usePracticeEngine.ts'
import { useTransportLoop, type FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserRng } from './rng.ts'
import { silentAudioOutput } from './silentAudioOutput.ts'

/** `'idle'` (nothing generated yet) sits in front of `SightReadingSession`'s own phases. */
export type SightReadingUiPhase = 'idle' | SightReadingPhase

export type UseSightReadingTrainerOptions = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
  readonly rng?: Rng
}

export type UseSightReadingTrainer = {
  readonly phase: SightReadingUiPhase
  readonly level: number
  readonly score: Score | undefined
  /** Which hands this exercise uses — `filterHands`'s input, so the note list matches what plays. */
  readonly activeHands: readonly Hand[]
  readonly previewRemainingMs: number
  readonly position: PositionDisplay | undefined
  readonly result: AssessmentResult | undefined
  readonly lastRecord: SightReadingRecord | undefined
  /** The level before this run's adaptation — `undefined` until a run has finished. */
  readonly previousLevel: number | undefined
  readonly error: string | undefined
  readonly midi: MidiConnection
  /** Generates a fresh exercise at the current level and begins the preview. */
  readonly start: () => void
  /** Ends the preview early — REQ-3.4.4 allows starting before the timer runs out. */
  readonly skipPreview: () => void
}

export function useSightReadingTrainer(
  options: UseSightReadingTrainerOptions = {},
): UseSightReadingTrainer {
  const level = useSightReadingStore((s) => s.level)
  const history = useSightReadingStore((s) => s.history)
  const setLevel = useSightReadingStore((s) => s.setLevel)
  const addRecord = useSightReadingStore((s) => s.addRecord)

  const levelRef = useRef(level)
  levelRef.current = level
  const historyRef = useRef(history)
  historyRef.current = history

  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
  const [date] = useState<DateSource>(() => options.date ?? { epochMillis: () => Date.now() })
  const [rng] = useState<Rng>(() => options.rng ?? createBrowserRng())
  const [audioOutput, setAudioOutput] = useState<AudioOutput | undefined>(options.audioOutput)

  const midi = useMidiConnection(
    options.midiInput !== undefined
      ? { midiInput: options.midiInput }
      : options.connectMidi !== undefined
        ? { connect: options.connectMidi }
        : {},
  )

  const sessionRef = useRef<SightReadingSession | undefined>(undefined)
  const [uiPhase, setUiPhase] = useState<SightReadingUiPhase>('idle')
  const [score, setScore] = useState<Score | undefined>(undefined)
  const [activeHands, setActiveHands] = useState<readonly Hand[]>(['left', 'right'])
  const [previewRemainingMs, setPreviewRemainingMs] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [lastRecord, setLastRecord] = useState<SightReadingRecord | undefined>(undefined)
  const [previousLevel, setPreviousLevel] = useState<number | undefined>(undefined)

  const engineAudioOutput = useMemo(
    () => (audioOutput === undefined ? undefined : silentAudioOutput(audioOutput)),
    [audioOutput],
  )

  const engine = usePracticeEngine({
    score,
    activeHands,
    tempoScale: 1,
    loop: undefined,
    metronomeEnabled: true,
    metronomeSubdivision: 1,
    waitModeEnabled: false,
    clock,
    audioOutput: engineAudioOutput,
    midiInput: midi.input,
    ...(options.frameDriver === undefined ? {} : { frameDriver: options.frameDriver }),
  })

  const assessment = useAssessment({
    score,
    activeHands,
    midiInput: midi.input,
    clock,
    date,
    phase: engine.phase,
    play: engine.play,
    rewindToTop: engine.rewindToTop,
    // Sight reading has no loop UI and never calls `practiceLoop` (this hook's
    // own return type doesn't even expose it) — but `engine.playLoop` is the
    // real, working transport primitive, so forwarding it is more honest than
    // a no-op that would silently do nothing if that ever changed.
    playLoop: engine.playLoop,
    // Sight reading fixes tempo, loop and wait mode — there is no slider for
    // any of them here, but `useAssessment.start()` sets all three anyway.
    setTempoScale: () => {},
    setWaitModeEnabled: () => {},
    setLoop: () => {},
  })

  const assessmentRef = useRef(assessment)
  assessmentRef.current = assessment

  // The pump for the preview countdown — the same shape `usePracticeEngine`
  // uses for playback, driving `session.update()` instead of a transport
  // tick. `update()` flips the session to `'playing'` the instant its timer
  // runs out; that flip is picked up below and starts the assessment run.
  useTransportLoop({
    active: uiPhase === 'preview',
    onFrame: () => {
      const session = sessionRef.current
      if (session === undefined) return
      session.update()
      setPreviewRemainingMs(session.previewRemainingMs)
      if (session.phase !== 'preview') setUiPhase(session.phase)
    },
    ...(options.frameDriver === undefined ? {} : { driver: options.frameDriver }),
  })

  // The preview just ended (by timeout above, or `skipPreview` below) — begin
  // the one-pass, no-stopping run.
  useEffect(() => {
    if (uiPhase === 'playing' && assessmentRef.current.phase === 'idle') {
      assessmentRef.current.start()
    }
  }, [uiPhase])

  // The run just finished (the transport played off the end) — close out the
  // session, retire the piece, and adapt the level.
  useEffect(() => {
    if (assessment.phase !== 'complete' || assessment.result === undefined) return
    const session = sessionRef.current
    if (session === undefined || session.phase !== 'playing') return
    const result = assessment.result
    const record = session.finish(result)
    const updatedHistory = retire(historyRef.current, record)
    const newLevel = adaptLevel(levelRef.current, updatedHistory)
    addRecord(record)
    setPreviousLevel(levelRef.current)
    setLevel(newLevel)
    setLastRecord(record)
    setUiPhase('finished')
  }, [assessment.phase, assessment.result, addRecord, setLevel])

  function start(): void {
    setAudioOutput((current) => current ?? createDefaultAudioOutput())
    setError(undefined)
    const params = nextExerciseParams(levelRef.current, rng, historyRef.current)
    const generated = generateMelody(params, rng)
    if (!generated.ok) {
      setError(generated.error)
      return
    }
    const hands: readonly Hand[] = params.hands === 'both' ? ['left', 'right'] : [params.hands]
    const session = new SightReadingSession({
      score: generated.value,
      clock,
      level: levelRef.current,
    })
    session.beginPreview()
    sessionRef.current = session
    setScore(generated.value)
    setActiveHands(hands)
    setPreviewRemainingMs(session.previewRemainingMs)
    setLastRecord(undefined)
    setPreviousLevel(undefined)
    setUiPhase('preview')
  }

  function skipPreview(): void {
    const session = sessionRef.current
    if (session === undefined || session.phase !== 'preview') return
    session.beginPlaying()
    setPreviewRemainingMs(0)
    setUiPhase('playing')
  }

  return {
    phase: uiPhase,
    level,
    score,
    activeHands,
    previewRemainingMs,
    position: engine.position,
    result: assessment.result,
    lastRecord,
    previousLevel,
    error,
    midi,
    start,
    skipPreview,
  }
}
