/**
 * The practice screen (roadmap 1.18) — where the user practises. Composes the
 * engine (`usePracticeEngine`) with the transport, tempo, loop, hand-mute,
 * metronome, wait-mode and MIDI-status controls below it.
 *
 * Everything with browser/IO dependencies is an injection seam with a real
 * default, exactly like `ScoreViewer`'s `createEngraver`: `clock`,
 * `audioOutput`, `midiInput`/`connectMidi`, `frameDriver`. Tests pass fakes;
 * the shell (owned by another agent — see the roadmap-1.18 report) renders
 * this with no props at all.
 */
import { ScoreViewer, type ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { AudioOutput, Clock, MidiInput } from '@core/ports/index.ts'
import type { Subdivision } from '@core/timing/metronome.ts'
import { useEffect, useRef, useState } from 'react'
import { createBrowserClock } from './clock.ts'
import { createDefaultAudioOutput } from './createDefaultAudioOutput.ts'
import { HandMuteControl } from './HandMuteControl.tsx'
import { LoopRangeControl } from './LoopRangeControl.tsx'
import { MetronomeControl } from './MetronomeControl.tsx'
import { MidiDeviceStatus } from './MidiDeviceStatus.tsx'
import { TempoControl } from './TempoControl.tsx'
import { TransportControls } from './TransportControls.tsx'
import { useMidiConnection, type ConnectMidi } from './useMidiConnection.ts'
import { useNoteFeedback } from './useNoteFeedback.ts'
import { usePracticeEngine } from './usePracticeEngine.ts'
import type { FrameDriver } from './useTransportLoop.ts'
import { WaitModeControl } from './WaitModeControl.tsx'

export type PracticeScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
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

  if (loaded === undefined) {
    return <p>Load a score on the Practice tab to start practising.</p>
  }

  return (
    <div className="practice-screen">
      <MidiDeviceStatus
        connected={midi.input !== undefined}
        devices={midi.devices}
        selectedDeviceId={midi.selectedDeviceId}
        connectionError={midi.connectionError}
      />
      {loaded.musicXml !== undefined && (
        <ScoreViewer ref={scoreViewerRef} musicXml={loaded.musicXml} score={loaded.score} />
      )}
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
      <TransportControls
        phase={engine.phase}
        position={engine.position}
        onPlay={handlePlay}
        onPause={engine.pause}
        onStop={engine.stop}
      />
      <TempoControl
        tempoScale={settings.tempoScale}
        onChange={setTempoScale}
        writtenBpm={engine.writtenBpm}
        effectiveBpm={engine.effectiveBpm}
      />
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
