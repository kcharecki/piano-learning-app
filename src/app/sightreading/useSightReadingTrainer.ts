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
 *
 * ## Abandoning a run (roadmap 2.31, REQ-3.4.3/3.4.4)
 *
 * The shell unmounts this screen on any nav click, which used to destroy an
 * in-progress session for free: two clicks and a butchered read was neither
 * graded nor retired, quietly undoing REQ-3.4.4's "no stopping" discipline.
 * The unmount effect near the bottom of this hook closes that hole: if the
 * session is still in `'preview'` or `'playing'` when this hook unmounts, it
 * is graded and retired exactly as a finished run is, via the SAME
 * `session.finish()` / `retire()` / `adaptLevel()` path — there is no second
 * code path for "abandoned" records, only a second caller of the normal one.
 *
 * Grading needs an `AssessmentResult`, and `useAssessment.result` is only
 * ever populated on a NATURAL end (`useAssessment.ts`'s own `finalizeRun`,
 * which this hook does not own and cannot invoke early) — so an abandoned
 * run cannot reuse it. Instead this hook keeps a second, independent
 * `NoteMatcher` (`matcherRef`) fed from the SAME MIDI events `useAssessment`
 * feeds its own, private one — precisely the "why this needs its own
 * matcher, not `useNoteFeedback`'s" reasoning `useAssessment.ts`'s module
 * comment gives for itself, one level further removed. Its anchor is
 * `clock.now()` read immediately after `useAssessment.start()` returns —
 * nothing yields to the event loop in between, so this can never disagree
 * with `useAssessment`'s own anchor by more than the cost of one JS
 * statement.
 *
 * On abandonment, that shadow matcher is force-closed all the way to the end
 * of the piece — `matcher.advanceTo(endOfScoreMs)`, exactly what
 * `useAssessment`'s `finalizeRun` does at a natural end — so every note not
 * already played becomes `missed`, never simply absent from the count. That
 * is what keeps quitting from ever being the smart play: an abandoned run
 * can at best tie a completed run that gets nothing else right from this
 * point on; it can never score better, because nothing still to come could
 * have hurt the score if left unplayed instead of attempted. Whatever WAS
 * played before quitting still counts as `correct`/`wrongPitch`, so
 * "accuracy as measured" is not simply zero unless nothing was played.
 *
 * ## Retirement keys on content, not just parameters (roadmap 2.31)
 *
 * `generateMelody`'s own id (`melody.ts`'s `scoreId`) is a pure function of
 * `GeneratorParams` alone — by that module's own doc, "never of anything its
 * `Rng` draws" — so re-rolling the exact same params against a fresh `Rng`
 * produces a different tune with the EXACT SAME id. Recording that id as the
 * retirement key (what `SightReadingSession.finish()` does, and what
 * `nextExerciseParams` checks via `isRetired`) therefore retires a PARAMETER
 * COMBINATION, not a piece: the second exercise ever drawn at a level would
 * find its own params already "seen" and be forced into a transposed/longer
 * variant, even though the actual notes were never played before.
 *
 * The correct fix is in `melody.ts`'s `scoreId` (fold a hash of the
 * generated notes into the id) — this hook may not edit that file, so
 * `contentPieceId` below does the app-side half instead: it appends a full
 * pitch/rhythm/hand signature of the ACTUAL generated notes onto the
 * generator's id, and that combined string — not `generateMelody`'s own
 * `.id` — is what this hook uses for the session's score, for the shadow
 * matcher, and for what ends up in `SightReadingRecord.pieceId` via
 * `session.finish()`. Two reads at identical params but different `Rng`
 * draws now get different signatures and are therefore recorded, retired
 * and displayed (the `score` this hook returns is the SAME content-keyed
 * copy) as two different pieces — see this file's build report for exactly
 * what `melody.ts` would need for the core-side fix.
 */
import { scoreDurationTicks, type Hand, type Score } from '@core/notation/score.ts'
import type { AudioOutput, Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { assess, type AssessmentResult } from '@core/practice/assessment.ts'
import { MATCHER_DEFAULTS, NoteMatcher } from '@core/practice/matcher.ts'
import { bpmAtTick, makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { millis as asMillis, ticks as asTicks } from '@core/shared/units.ts'
import { invariant } from '@core/shared/invariant.ts'
import { adaptLevel, nextExerciseParams } from '@core/sightreading/adaptive.ts'
import { defaultParamsForLevel, generateMelody } from '@core/generator/melody.ts'
import { applyCustomization, isCustomizationActive, type SightReadingCustomization } from './customization.ts'
import {
  isRetired,
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

/**
 * `score` with its id replaced by one that folds in every note's own
 * pitch/rhythm/hand — see the module comment's "Retirement keys on content"
 * section for why. Order-preserving and total (covers every note, not just a
 * sample), so two note lists that differ anywhere at all produce different
 * signatures; `melody.ts`'s own id is kept as a human-readable prefix purely
 * for debugging, never relied on for uniqueness.
 */
function contentPieceId(score: Score): string {
  const signature = score.notes
    .map((n) => `${n.startTick}.${n.durationTicks}.${n.midi}.${n.hand}`)
    .join('|')
  return `${score.id}#${signature}`
}

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
  /** REQ-3.9.1: on by default (a no-stopping run needs a pulse to keep to) but must be switchable. */
  readonly metronomeEnabled?: boolean
  /** REQ-3.4.2: overrides `start()` applies on top of the level's own default params. */
  readonly customization?: SightReadingCustomization
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
  const customizationRef = useRef<SightReadingCustomization>(options.customization ?? {})
  customizationRef.current = options.customization ?? {}

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
  // The content-keyed copy of whatever `score` state below holds — see the
  // module comment. Assigned directly in `start()`, never derived from
  // `score` on a later render, so it is never one commit behind (an unmount
  // effect's cleanup cannot wait for a render that may never come).
  const runScoreRef = useRef<Score | undefined>(undefined)
  // The shadow matcher an abandoned run is graded from — see the module
  // comment's "Abandoning a run" section. Built fresh alongside the session
  // in `start()`, so it exists exactly when `sessionRef.current` does.
  const matcherRef = useRef<NoteMatcher | undefined>(undefined)
  // The instant the shadow matcher's tick-0 is anchored to; `undefined` until
  // the run actually starts playing (matching `useAssessment`'s own start).
  const matcherAnchorRef = useRef<number | undefined>(undefined)
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
    metronomeEnabled: options.metronomeEnabled ?? true,
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
      // The shadow matcher's anchor — see the module comment's "Abandoning a
      // run" section for why reading it here, right after `start()` returns
      // rather than inside it, is indistinguishable from the true anchor.
      // Valid ONLY while `usePracticeEngine`'s transport is rewound to tick 0
      // with no count-in (the default, and the only mode this hook uses):
      // `useAssessment` anchors to `engine.play()`'s own return value, which
      // is `clock.now() - tickToMs(tempo, transport.positionTicks)`, so the
      // two anchors coincide only because `positionTicks` is 0 here. If a
      // count-in or a non-zero start position is ever wired in, this anchor
      // must be sourced the same way `useAssessment` does instead.
      matcherAnchorRef.current = clock.now()
    }
  }, [uiPhase, clock])

  // Feeds the shadow matcher from the SAME MIDI events `useAssessment` feeds
  // its own private one — see the module comment. A no-op until a run is
  // actually playing: `matcherAnchorRef.current` stays `undefined` through
  // `'idle'` and `'preview'`, exactly like `useAssessment`'s own `runRef`.
  useEffect(() => {
    if (midi.input === undefined) return undefined
    return midi.input.onEvent((event) => {
      const matcher = matcherRef.current
      const anchor = matcherAnchorRef.current
      if (matcher === undefined || anchor === undefined) return
      const estimated = asMillis(event.time - anchor)
      if (event.type === 'noteOn') matcher.noteOn(event.note, estimated)
      else if (event.type === 'noteOff') matcher.noteOff(event.note, estimated)
    })
  }, [midi.input])

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

  // REQ-3.4.3/3.4.4: this hook unmounting mid-run (the shell unmounts the
  // screen on any nav click) must not let the run escape ungraded — see the
  // module comment's "Abandoning a run" section. Runs once, on mount, purely
  // to register this cleanup for the eventual unmount; every value it reads
  // is a ref (always current) or a store action/DateSource that never
  // changes identity after mount, so the empty dependency array cannot make
  // this stale.
  useEffect(() => {
    return () => {
      const session = sessionRef.current
      if (session === undefined || session.phase === 'finished') return
      // A run abandoned mid-preview never reached 'playing' at all; forcing
      // that transition first (legal: preview -> playing) is what lets
      // `session.finish()` below run — `finish()` requires 'playing', by
      // design, so there is no separate "abandoned from preview" method to
      // bypass that invariant, only this hook driving the SAME two calls a
      // completed run would have made anyway.
      //
      // This is a deliberate choice, not an oversight: grading (and
      // retiring) a preview-only abandonment at accuracy 0 costs the
      // learner nothing extra beyond what quitting mid-play already costs
      // (see "Abandoning a run" above — an abandoned run can never score
      // better than a completed one), and the alternative — letting a
      // preview-and-quit escape ungraded — would let a learner "shop" for
      // an easy piece by previewing several and only playing the one they
      // like. Pinned by the "unmounting mid-preview" test below.
      if (session.phase === 'preview') session.beginPlaying()
      const score = runScoreRef.current
      const matcher = matcherRef.current
      invariant(
        score !== undefined && matcher !== undefined,
        'useSightReadingTrainer: a session without its shadow matcher/score — start() must set both together',
      )
      // Force every note not already decided to `missed` — see the module
      // comment's "Abandoning a run" section for why this, not merely
      // reporting whatever happened to be decided already, is what keeps
      // quitting from ever outscoring a completed-but-botched run.
      const tempo = makeTempoMap(score.tempos)
      const endMs =
        (tickToMs(tempo, scoreDurationTicks(score)) as number) + MATCHER_DEFAULTS.toleranceMs + 1
      matcher.advanceTo(asMillis(endMs))
      const result = assess(score, matcher.results, {
        tempoBpm: bpmAtTick(tempo, asTicks(0)),
        date,
        scoreId: score.id,
      })
      const record = session.finish(result)
      const updatedHistory = retire(historyRef.current, record)
      const newLevel = adaptLevel(levelRef.current, updatedHistory)
      addRecord(record)
      setLevel(newLevel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-once; see the comment above
  }, [])

  function start(): void {
    setAudioOutput((current) => current ?? createDefaultAudioOutput())
    setError(undefined)
    const customization = customizationRef.current
    // A customized run picks its own key/hands/rhythm/etc. directly off the
    // level's own default shape — the retirement-aware variant search in
    // `nextExerciseParams` exists to vary an AUTO-drawn exercise away from an
    // already-seen id, which is a different problem from "the learner asked
    // for exactly this". See the customization module doc.
    const params = isCustomizationActive(customization)
      ? applyCustomization(defaultParamsForLevel(levelRef.current), customization)
      : nextExerciseParams(levelRef.current, rng, historyRef.current)
    let generated = generateMelody(params, rng)
    if (!generated.ok) {
      setError(generated.error)
      return
    }
    // REQ-3.4.3: `nextExerciseParams`'s own variant search is keyed on
    // `generateMelody`'s bare (parameter-only) id, which this hook never
    // stores — the retirement key it actually persists is the content key
    // below. So redraw here, against the SAME content key, in a small bounded
    // loop: re-rolling the same params against the same `Rng` draws different
    // notes each time, and most redraws will already be unretired. Giving up
    // after a fixed number of attempts and proceeding with the last draw
    // mirrors `nextExerciseParams`'s own bounded-search fallback.
    for (
      let attempt = 0;
      attempt < 16 && isRetired(historyRef.current, contentPieceId(generated.value));
      attempt++
    ) {
      generated = generateMelody(params, rng)
      if (!generated.ok) {
        setError(generated.error)
        return
      }
    }
    const hands: readonly Hand[] = params.hands === 'both' ? ['left', 'right'] : [params.hands]
    // REQ-3.4.3: retire the piece actually drawn, not the parameter
    // combination — see the module comment's "Retirement keys on content"
    // section. Every consumer below (the session, the shadow matcher, and
    // the `score` this hook returns) uses this SAME content-keyed copy, so
    // there is only ever one id in play for a given run.
    const contentScore: Score = { ...generated.value, id: contentPieceId(generated.value) }
    const session = new SightReadingSession({
      score: contentScore,
      clock,
      level: levelRef.current,
    })
    session.beginPreview()
    sessionRef.current = session
    runScoreRef.current = contentScore
    matcherRef.current = new NoteMatcher(contentScore, makeTempoMap(contentScore.tempos), { hands })
    matcherAnchorRef.current = undefined
    setScore(contentScore)
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
