/**
 * The practice screen (roadmap 1.18) — where the user practises. Composes the
 * engine (`usePracticeEngine`) with the transport, tempo, loop, hand-mute,
 * metronome, wait-mode and MIDI-status controls below it.
 *
 * Roadmap 1.21 (REQ-4.6): the MIDI status, transport, tempo and live-accuracy
 * controls are lifted into `.practice-controls`, a sticky strip rendered
 * ABOVE `ScoreViewer` (see `styles.css`) — a real score is several screens
 * tall, and those controls must stay reachable while the learner scrolls
 * through it. Setup controls (assessment, review, loop/hand/metronome/wait)
 * stay below the score, unchanged.
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
import { useEffect, useRef, useState } from 'react'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { createBrowserClock } from './clock.ts'
import { createDefaultAudioOutput } from './createDefaultAudioOutput.ts'
import { HandMuteControl } from './HandMuteControl.tsx'
import { LoopRangeControl } from './LoopRangeControl.tsx'
import { MetronomeControl } from './MetronomeControl.tsx'
import { MidiDeviceStatus } from './MidiDeviceStatus.tsx'
import { ReviewOverlay } from './ReviewOverlay.tsx'
import { TempoControl } from './TempoControl.tsx'
import { TransportControls } from './TransportControls.tsx'
import { useAssessment } from './useAssessment.ts'
import { useMidiConnection, type ConnectMidi } from './useMidiConnection.ts'
import { useNoteFeedback } from './useNoteFeedback.ts'
import { usePracticeEngine } from './usePracticeEngine.ts'
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

  // Owns the matcher and colours the score imperatively (REQ-3.3.2, REQ-4.1) —
  // see the module comment on `useNoteFeedback` for why `feedback.cursorRef`,
  // not `scoreViewerRef` itself, is what `usePracticeEngine` gets below.
  const feedback = useNoteFeedback({
    score: loaded?.score,
    activeHands: settings.activeHands,
    midiInput: midi.input,
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
    midiInput: midi.input,
    scoreViewerRef: feedback.cursorRef,
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
  })

  // `usePracticeEngine` stops pumping frames the instant it stops, so the
  // frame-driven wiring above can never observe the reset itself — see the
  // module comment on `useNoteFeedback`.
  const clearFeedback = feedback.clear
  useEffect(() => {
    if (engine.phase === 'stopped') clearFeedback()
  }, [engine.phase, clearFeedback])

  function handlePlay(): void {
    setAudioOutput((current) => current ?? createDefaultAudioOutput())
    engine.play()
  }

  // The end-of-run story (roadmap 2.11, REQ-3.3.4/3.3.5): a fixed-tempo,
  // no-wait-mode pass, reduced once it finishes into the review screen's
  // problem measures and one-click loops. `handlePlay` is reused so an
  // assessment run gets the same lazy audio-output setup ordinary play does.
  const assessment = useAssessment({
    score: loaded?.score,
    activeHands: settings.activeHands,
    midiInput: midi.input,
    clock,
    date,
    phase: engine.phase,
    play: handlePlay,
    stop: engine.stop,
    setTempoScale,
    setWaitModeEnabled,
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
          // REQ-3.3.4: an assessment run cannot be paused or stopped once started.
          onPause={assessmentRunning ? () => {} : engine.pause}
          onStop={assessmentRunning ? () => {} : engine.stop}
        />
        <TempoControl
          tempoScale={settings.tempoScale}
          onChange={setTempoScale}
          writtenBpm={engine.writtenBpm}
          effectiveBpm={engine.effectiveBpm}
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
      <LoopRangeControl score={loaded.score} loop={settings.loop} onChange={setLoop} />
      <HandMuteControl activeHands={settings.activeHands} onChange={setActiveHands} />
      <MetronomeControl
        enabled={settings.metronomeEnabled}
        onToggle={setMetronomeEnabled}
        subdivision={subdivision}
        onSubdivisionChange={setSubdivision}
      />
      <WaitModeControl enabled={waitModeEnabled} onToggle={setWaitModeEnabled} wait={engine.wait} />
    </div>
  )
}
