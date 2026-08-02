/**
 * The practice screen (roadmap 1.18) — where the user practises. Composes the
 * engine (`usePracticeEngine`) with the transport, tempo, loop, hand-mute,
 * metronome, wait-mode and MIDI-status controls below it.
 *
 * Roadmap 1.21 (REQ-4.6): the MIDI status, transport, tempo and live-accuracy
 * controls are lifted into `.practice-controls`, a sticky strip rendered
 * ABOVE `ScoreViewer` (see `styles.css`) — a real score is several screens
 * tall, and those controls must stay reachable while the learner scrolls
 * through it. Setup controls (assessment, review, loop/hand/metronome/wait,
 * record/replay) stay below the score, unchanged.
 *
 * Roadmap 2.14 (REQ-3.9.2): `useRecorder` sits between the raw MIDI input and
 * every consumer on this screen (`useNoteFeedback`, `usePracticeEngine`,
 * `useAssessment` all get `recorder.input`, never `midi.input` directly) so a
 * replay drives the score colouring through the exact same path a live
 * performance does — see `useRecorder`'s own module comment. That creates a
 * cycle: `useRecorder` needs the engine's `rewindToTop`/`play`/`stop`, but the
 * engine needs the recorder's fanned-out input to exist first. It is broken
 * with `engineRef`, filled in right after `usePracticeEngine` runs — every
 * callback handed to `useRecorder` reaches the engine through that ref instead
 * of a value closed over at render time.
 *
 * Everything with browser/IO dependencies is an injection seam with a real
 * default, exactly like `ScoreViewer`'s `createEngraver`: `clock`,
 * `audioOutput`, `midiInput`/`connectMidi`, `frameDriver`. Tests pass fakes;
 * the shell (owned by another agent — see the roadmap-1.18 report) renders
 * this with no props at all.
 */
import { ScoreViewer, type ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import type { Subdivision } from '@core/timing/metronome.ts'
import type { Millis } from '@core/shared/units.ts'
import { useEffect, useRef, useState } from 'react'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { createBrowserClock } from './clock.ts'
import { createDefaultAudioOutput } from './createDefaultAudioOutput.ts'
import { HandMuteControl } from './HandMuteControl.tsx'
import { LoopRangeControl } from './LoopRangeControl.tsx'
import { MetronomeControl } from './MetronomeControl.tsx'
import { MidiDeviceStatus } from './MidiDeviceStatus.tsx'
import { RecordPanel } from './RecordPanel.tsx'
import { ReviewOverlay } from './ReviewOverlay.tsx'
import { TempoControl } from './TempoControl.tsx'
import { TimingFeedback } from './TimingFeedback.tsx'
import { TransportControls } from './TransportControls.tsx'
import { useAssessment } from './useAssessment.ts'
import { usePracticeLog } from './usePracticeLog.ts'
import { useMidiConnection, type ConnectMidi } from './useMidiConnection.ts'
import { useNoteFeedback } from './useNoteFeedback.ts'
import { usePracticeEngine, type PracticeEngine } from './usePracticeEngine.ts'
import { useRecorder } from './useRecorder.ts'
import type { FrameDriver } from './useTransportLoop.ts'
import { WaitModeControl } from './WaitModeControl.tsx'

export type PracticeScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
}

export function PracticeScreen(props: PracticeScreenProps) {
  const loaded = useScoreStore((s) => s.loaded)
  const settings = useScoreStore((s) => s.settings)
  const setTempoScale = useScoreStore((s) => s.setTempoScale)
  const setActiveHands = useScoreStore((s) => s.setActiveHands)
  const setMetronomeEnabled = useScoreStore((s) => s.setMetronomeEnabled)
  const setLoop = useScoreStore((s) => s.setLoop)

  const [subdivision, setSubdivision] = useState<Subdivision>(1)
  const [waitModeEnabled, setWaitModeEnabled] = useState(false)
  const [clock] = useState<Clock>(() => props.clock ?? createBrowserClock())
  const [date] = useState<DateSource>(() => props.date ?? { epochMillis: () => Date.now() })
  const [audioOutput, setAudioOutput] = useState<AudioOutput | undefined>(props.audioOutput)

  const midi = useMidiConnection(
    props.midiInput !== undefined
      ? { midiInput: props.midiInput }
      : props.connectMidi !== undefined
        ? { connect: props.connectMidi }
        : {},
  )

  const scoreViewerRef = useRef<ScoreViewerHandle>(null)

  // `useRecorder` needs the engine's transport primitives, and the engine needs
  // the recorder's fanned-out input — so the engine is reached through a ref
  // that is filled in below, after it exists. (roadmap 2.14)
  const engineRef = useRef<PracticeEngine | undefined>(undefined)

  // Lazily creates the real audio output on first Play — shared by ordinary
  // Play (`handlePlay`, below) and the recorder's own `play`, so the
  // lazy-creation logic exists in exactly one place, not duplicated.
  function ensureAudioOutput(): void {
    setAudioOutput((current) => current ?? createDefaultAudioOutput())
  }

  const recorder = useRecorder({
    // The raw live input — the recorder wraps it, it does not consume the fan-out.
    source: midi.input,
    clock,
    date,
    scoreId: loaded?.score.id,
    // `engine` does not exist yet at this point in the render (see the
    // `engineRef` comment above), so this reads whatever `usePracticeEngine`
    // published to the ref on the PREVIOUS render — one render stale. In
    // practice that only matters on the render where the written tempo itself
    // just changed; it settles by the next commit. Chosen over recomputing
    // `usePracticeEngine`'s own tick-to-tempo logic a second time here, which
    // would be duplicated music-timing logic in `src/app` for no real gain.
    tempoBpm: engineRef.current?.writtenBpm,
    rewindToTop: () => engineRef.current?.rewindToTop(),
    play: () => {
      ensureAudioOutput()
      return engineRef.current?.play()
    },
    stop: () => engineRef.current?.stop(),
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
  })

  // Owns the matcher and colours the score imperatively (REQ-3.3.2, REQ-4.1) —
  // see the module comment on `useNoteFeedback` for why `feedback.cursorRef`,
  // not `scoreViewerRef` itself, is what `usePracticeEngine` gets below.
  // `recorder.input`, not the raw live `midi.input`: a replay must drive the
  // score colouring through the exact same path a live performance does
  // (roadmap 2.14, REQ-3.9.2) — see `useRecorder`'s module comment.
  const feedback = useNoteFeedback({
    score: loaded?.score,
    activeHands: settings.activeHands,
    midiInput: recorder.input,
    clock,
    scoreViewerRef,
  })

  const engine = usePracticeEngine({
    score: loaded?.score,
    activeHands: settings.activeHands,
    tempoScale: settings.tempoScale,
    loop: settings.loop,
    metronomeEnabled: settings.metronomeEnabled,
    metronomeSubdivision: subdivision,
    waitModeEnabled,
    clock,
    audioOutput,
    midiInput: recorder.input,
    scoreViewerRef: feedback.cursorRef,
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
  })
  engineRef.current = engine

  // Clear stale colouring/counters when a NEW run STARTS, not when one ends
  // (roadmap 2.14): the counters from a just-finished run must survive onto
  // screen — the learner reads them, and a replay's own counters have to be
  // compared against the live take's, which is impossible if the take's
  // result was erased the instant it stopped. "New run" means `engine.phase`
  // entering a running state (`'playing'`, or `'waiting'` for wait mode) FROM
  // `'stopped'`. A pause/resume (`'paused'` -> `'playing'`) is explicitly NOT
  // a new run and must leave the in-progress counters alone, so the check is
  // against the PREVIOUS phase (`previousPhaseRef`), not just the current one
  // — `engine.phase === 'stopped'` alone can't distinguish a fresh start from
  // "still running", but comparing against what it was last commit can.
  //
  // Effect ordering guarantees the clear lands before the new run's first
  // note is judged: `useTransportLoop` (inside `usePracticeEngine`, which
  // renders before this effect is even declared) only REGISTERS a
  // `requestAnimationFrame` callback when ITS effect runs in this same commit
  // — registering never invokes the callback synchronously — so the actual
  // frame (and therefore the first `moveCursorTo` that could judge a note)
  // cannot fire until the browser's next paint, strictly after every effect
  // in this commit, including this one, has already run. See the module
  // comment on `useNoteFeedback` for the other half of this story.
  // REQ-3.9.5: the same start/stop edge that clears the feedback also opens and
  // closes a practice-log session, so what/how long/tempo/accuracy is recorded
  // without the learner pressing anything extra. Held in a ref because the hook
  // returns a fresh object each render and this effect must fire on the PHASE
  // edge only — putting the hook's own identity in the dependency list would
  // restart the timer on every unrelated re-render.
  const practiceLog = usePracticeLog({ clock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog

  const clearFeedback = feedback.clear
  const previousPhaseRef = useRef(engine.phase)
  const accuracyRef = useRef(feedback.summary.accuracy)
  accuracyRef.current = feedback.summary.accuracy
  const bpmRef = useRef(engine.effectiveBpm)
  bpmRef.current = engine.effectiveBpm
  const itemRef = useRef(loaded)
  itemRef.current = loaded
  useEffect(() => {
    const previousPhase = previousPhaseRef.current
    previousPhaseRef.current = engine.phase
    const justStarted =
      previousPhase === 'stopped' && (engine.phase === 'playing' || engine.phase === 'waiting')
    const justStopped = previousPhase !== 'stopped' && engine.phase === 'stopped'
    if (justStarted) {
      clearFeedback()
      const item = itemRef.current
      if (item !== undefined) {
        const title =
          item.score.meta.title.length > 0 ? item.score.meta.title : item.sourceName
        practiceLogRef.current.start('repertoire', title, { itemId: item.score.id })
      }
    }
    if (justStopped) {
      const bpm = bpmRef.current
      practiceLogRef.current.stop({
        accuracy: accuracyRef.current,
        ...(bpm === undefined ? {} : { tempoBpm: bpm }),
      })
    }
  }, [engine.phase, clearFeedback])

  function handlePlay(): Millis | undefined {
    ensureAudioOutput()
    return engine.play()
  }

  // The end-of-run story (roadmap 2.11, REQ-3.3.4/3.3.5): a fixed-tempo,
  // no-wait-mode pass, reduced once it finishes into the review screen's
  // problem measures and one-click loops. `handlePlay` is reused so an
  // assessment run gets the same lazy audio-output setup ordinary play does.
  const assessment = useAssessment({
    score: loaded?.score,
    activeHands: settings.activeHands,
    midiInput: recorder.input,
    clock,
    date,
    phase: engine.phase,
    play: handlePlay,
    rewindToTop: engine.rewindToTop,
    playLoop: engine.playLoop,
    setTempoScale,
    setWaitModeEnabled,
    // REQ-3.3.4's "used for level checks and progress history": this is the
    // one caller whose runs are real repertoire assessments worth keeping.
    recordHistory: true,
    setLoop,
  })
  const assessmentRunning = assessment.phase === 'running'

  if (loaded === undefined) {
    return <p>Load a score on the Practice tab to start practising.</p>
  }

  return (
    <div className="practice-screen">
      <div className="practice-controls">
        <MidiDeviceStatus
          connected={midi.input !== undefined}
          devices={midi.devices}
          selectedDeviceId={midi.selectedDeviceId}
          connectionError={midi.connectionError}
        />
        <TransportControls
          phase={engine.phase}
          position={engine.position}
          onPlay={handlePlay}
          // REQ-3.3.4: an assessment run cannot be paused or stopped once
          // started — enforced by disabling the buttons (`disabled` below),
          // not by swallowing the click in a no-op handler, so a click during
          // a run visibly does nothing instead of silently doing nothing.
          onPause={engine.pause}
          onStop={engine.stop}
          disabled={assessmentRunning}
        />
        <TempoControl
          tempoScale={settings.tempoScale}
          onChange={setTempoScale}
          writtenBpm={engine.writtenBpm}
          effectiveBpm={engine.effectiveBpm}
          disabled={assessmentRunning}
        />
        <dl className="note-feedback" role="status" aria-live="polite" aria-label="Note feedback">
          <dt>Accuracy</dt>
          <dd data-testid="feedback-accuracy">{Math.round(feedback.summary.accuracy * 100)}%</dd>
          <dt>Correct</dt>
          <dd data-testid="feedback-correct">{feedback.summary.correct}</dd>
          <dt>Wrong pitch</dt>
          <dd data-testid="feedback-wrong-pitch">{feedback.summary.wrongPitch}</dd>
          <dt>Missed</dt>
          <dd data-testid="feedback-missed">{feedback.summary.missed}</dd>
          <dt>Extra</dt>
          <dd data-testid="feedback-extra">{feedback.summary.extra}</dd>
        </dl>
        {/* REQ-3.3.2's other half: the matcher has always computed early/late
            and a signed deviation for every attributed press, and until now
            nothing displayed either (roadmap 2.23). */}
        <TimingFeedback
          lastJudgement={feedback.lastJudgement}
          meanAbsDeviationMs={feedback.summary.meanAbsDeviationMs}
        />
      </div>
      {loaded.musicXml !== undefined && (
        <ScoreViewer ref={scoreViewerRef} musicXml={loaded.musicXml} score={loaded.score} />
      )}
      <AssessmentPanel
        phase={assessment.phase}
        result={assessment.result}
        canStart
        onStart={assessment.start}
      />
      {assessment.phase === 'complete' && (
        <ReviewOverlay
          problems={assessment.problems}
          loops={assessment.loops}
          onPracticeLoop={assessment.practiceLoop}
        />
      )}
      {/* `LoopRangeControl` has no `disabled` prop of its own (owned by another
          agent) — a native `<fieldset disabled>` disables every form control
          inside it, which is the only lever available without touching that
          file. */}
      <fieldset disabled={assessmentRunning}>
        <LoopRangeControl score={loaded.score} loop={settings.loop} onChange={setLoop} />
      </fieldset>
      <HandMuteControl
        activeHands={settings.activeHands}
        onChange={setActiveHands}
        disabled={assessmentRunning}
      />
      <MetronomeControl
        enabled={settings.metronomeEnabled}
        onToggle={setMetronomeEnabled}
        subdivision={subdivision}
        onSubdivisionChange={setSubdivision}
        disabled={assessmentRunning}
      />
      <WaitModeControl
        enabled={waitModeEnabled}
        onToggle={setWaitModeEnabled}
        wait={engine.wait}
        disabled={assessmentRunning}
      />
      <RecordPanel
        phase={recorder.phase}
        recording={recorder.recording}
        canRecord={midi.input !== undefined}
        onStartRecording={recorder.startRecording}
        onStopRecording={recorder.stopRecording}
        onStartReplay={recorder.startReplay}
        onStopReplay={recorder.stopReplay}
      />
    </div>
  )
}
