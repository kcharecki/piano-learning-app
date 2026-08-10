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
import { AnnotationPanel } from '@app/annotations/AnnotationPanel.tsx'
import { DEFAULT_NOTE_COLOR } from '@app/score/osmdEngraver.ts'
import { ScoreViewer, type ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import type { Subdivision } from '@core/timing/metronome.ts'
import { bpm, type Millis } from '@core/shared/units.ts'
import { useEffect, useRef, useState } from 'react'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { createBrowserClock } from './clock.ts'
import { createDefaultAudioOutput } from './createDefaultAudioOutput.ts'
import { HandMuteControl } from './HandMuteControl.tsx'
import { LoopRangeControl } from './LoopRangeControl.tsx'
import { MetronomeControl } from './MetronomeControl.tsx'
import { MicInputControl } from './MicInputControl.tsx'
import { MidiDeviceStatus } from './MidiDeviceStatus.tsx'
import { createPlayableInput, type PlayableMidiInput } from './playableInput.ts'
import { PracticeKeyboard } from './PracticeKeyboard.tsx'
import { RecordPanel } from './RecordPanel.tsx'
import { ReviewOverlay } from './ReviewOverlay.tsx'
import { TempoControl } from './TempoControl.tsx'
import { TempoRampControl } from './TempoRampControl.tsx'
import { TimingFeedback } from './TimingFeedback.tsx'
import { useTempoRamp } from './useTempoRamp.ts'
import { TransportControls } from './TransportControls.tsx'
import { useAssessment } from './useAssessment.ts'
import { usePracticeLog } from './usePracticeLog.ts'
import { useMidiConnection, type ConnectMidi } from './useMidiConnection.ts'
import { useMicInput, type ConnectMic } from './useMicInput.ts'
import { useNoteFeedback } from './useNoteFeedback.ts'
import { usePracticeEngine, type PracticeEngine } from './usePracticeEngine.ts'
import { useRecorder } from './useRecorder.ts'
import type { FrameDriver } from './useTransportLoop.ts'
import { WaitModeControl } from './WaitModeControl.tsx'
import { ReadAheadControl } from './ReadAheadControl.tsx'
import { useReadAhead } from './useReadAhead.ts'

/** Note accuracy at or above which a completed pass counts as a clean repetition (REQ-3.9.1). */
const CLEAN_ACCURACY = 0.95
/** Clean passes needed at a rung before the ramp steps up. */
const RAMP_REPS_PER_STEP = 1
/** The selected notehead's colour (roadmap 4.8a, REQ-3.2.6) — matches `--accent` in styles.css. */
const SELECTION_NOTE_COLOR = '#6ea8fe'

export type PracticeScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly connectMic?: ConnectMic
  readonly frameDriver?: FrameDriver
  /** Text to place under each measure of the engraving, keyed by 1-based
   *  measure number — forwarded verbatim to `ScoreViewer` (roadmap 3.18a).
   *  `ScoreScreen` passes the roman-numeral reading here, under the same
   *  theory-level gate the side panel uses; absent means today's behaviour. */
  readonly measureLabels?: ReadonlyMap<number, string>
}

export function PracticeScreen(props: PracticeScreenProps) {
  const loaded = useScoreStore((s) => s.loaded)
  const settings = useScoreStore((s) => s.settings)
  const setTempoScale = useScoreStore((s) => s.setTempoScale)
  const setActiveHands = useScoreStore((s) => s.setActiveHands)
  const setMetronomeEnabled = useScoreStore((s) => s.setMetronomeEnabled)
  const setLoop = useScoreStore((s) => s.setLoop)

  const [subdivision, setSubdivision] = useState<Subdivision>(1)
  const [rampFromBpm, setRampFromBpm] = useState(60)
  const [rampToBpm, setRampToBpm] = useState(80)
  const [rampStepBpm, setRampStepBpm] = useState(2)
  const [waitModeEnabled, setWaitModeEnabled] = useState(false)
  const [readAheadEnabled, setReadAheadEnabled] = useState(false)
  // The note selected in the score viewer (roadmap 4.8a, REQ-3.2.6) — feeds
  // AnnotationPanel's fingering/highlight controls, which are disabled
  // without one.
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(undefined)
  // Roadmap-review finding 5: ids are position-derived
  // (`m<measure>.<hand>.<tick>.<midi>`), so a stale selection from a
  // previously loaded score very often still resolves against a NEW one —
  // without this, loading a different piece left the panel enabled and
  // writing fingering edits against an arbitrary note of the new score, with
  // no visible highlight showing which note was being edited.
  useEffect(() => {
    setSelectedNoteId(undefined)
  }, [loaded?.score.id])
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

  // The microphone fallback (roadmap 5.7 / B.1, REQ-3.3.7) — opt-in, unlike
  // MIDI: requesting the mic holds the browser's recording indicator lit, so
  // it only connects once the learner explicitly asks via the toggle below.
  // On iPadOS (no Web MIDI in any browser shell, see B.7) this is not a
  // fallback, it is the only way to play at all.
  const mic = useMicInput(props.connectMic !== undefined ? { connect: props.connectMic } : {})

  // The input everything downstream actually reads (roadmap 5.4, REQ-3.3.7).
  // NOT `midi.input`: that is `undefined` wherever Web MIDI is absent — Safari,
  // Firefox, every browser on iPadOS — and `useRecorder` builds no fan-out from
  // an absent source, which left matching, feedback colouring, wait mode,
  // assessment, timing feedback, recording and the tempo ramp all inert on the
  // one screen where playing is the point. `createPlayableInput` is always
  // present, forwards the device when there is one, and lets the on-screen
  // keyboard below emit through the same seam. See `playableInput.ts`.
  //
  // `mic.input` takes priority over `midi.input` while the mic toggle is on
  // (roadmap 5.7): the learner turned it on to use it, and a struck MIDI
  // note arriving mid-session should not silently steal the active input.
  // While the mic is enabled but still connecting (or errored), the device is
  // `undefined` rather than falling back to `midi.input` — an explicit "use
  // the microphone" choice degrading silently back to hardware is exactly
  // the failure roadmap 5.6 exists to stop.
  const activeDevice = mic.enabled ? mic.input : midi.input

  // Held in state and rebuilt only when the device changes (the pattern
  // `useRecorder` uses for its own fan-out, and for the same reason): every
  // consumer's subscription must stay pinned to one object across plain
  // re-renders, which a `useMemo` React may discard cannot promise.
  const [playableInput, setPlayableInput] = useState<PlayableMidiInput | undefined>(undefined)
  useEffect(() => {
    const next = createPlayableInput(activeDevice, clock)
    setPlayableInput(next)
    return () => next.dispose()
  }, [activeDevice, clock])

  // Shown by default exactly when it is the learner's only way to play, and
  // hidden by default when a keyboard is plugged in — but `undefined` until
  // the learner touches the toggle, so that an explicit choice is never undone
  // by a device connecting or dropping mid-session.
  const [showKeyboardChoice, setShowKeyboardChoice] = useState<boolean | undefined>(undefined)
  // "Is there a keyboard to play?" is NOT `midi.input !== undefined`: on Chrome
  // with Web MIDI granted and nothing plugged in, the input exists and the
  // device list is empty — the commonest no-hardware case there is, and the one
  // that would have been left with no way to play at all. This is the same
  // predicate `MidiDeviceStatus` prints from, so the status line and the
  // keyboard can never disagree about whether a keyboard is attached.
  //
  // A connected microphone counts too (roadmap 5.7): it is a real way to
  // play, not the on-screen keyboard, so it hides the on-screen keyboard by
  // default and enables Record the same way a MIDI keyboard does.
  const deviceAttached =
    (midi.input !== undefined && midi.devices.some((device) => device.id === midi.selectedDeviceId)) ||
    (mic.enabled && mic.input !== undefined)
  const showKeyboard = showKeyboardChoice ?? !deviceAttached
  // Latched keys stay down until pressed again, which is the only way a
  // single-pointer device can hold a chord — see `OnScreenKeyboard`.
  const [latchKeys, setLatchKeys] = useState(false)

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
    // The raw live input — the recorder wraps it, it does not consume the
    // fan-out. `playableInput` (device + on-screen keys) rather than
    // `midi.input`, so a clicked note is recorded and replayed exactly as a
    // played one is (roadmap 5.4).
    source: playableInput,
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
    stop: handleStop,
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

  useReadAhead({
    enabled: readAheadEnabled,
    score: loaded?.score,
    currentMeasureIndex: Math.max(0, (engine.position?.measureNumber ?? 1) - 1),
    scoreViewerRef,
  })

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

  // REQ-3.9.1 tempo ramping (roadmap 2.27). The ramp owns the bpm ladder; the
  // screen owns the form fields it is started from, and pushes the ramp's
  // scale into the same `tempoScale` the slider writes, so there is still
  // exactly one number the transport reads.
  const ramp = useTempoRamp(engine.writtenBpm)
  const rampRef = useRef(ramp)
  rampRef.current = ramp
  const rampScale = ramp.tempoScale
  useEffect(() => {
    if (rampScale !== undefined) setTempoScale(rampScale)
  }, [rampScale, setTempoScale])

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
      // `clearFeedback` -> `clearNoteColors()` shares the engraver's single
      // colour channel with the selection highlight (see `handleSelectNote`
      // below) — it just wiped the selected note back to default along with
      // every feedback colour. Reasserting it is NOT done here (see the
      // `reassertSelectionColor` effect below, roadmap-review finding 3):
      // this is only ONE of THREE places `clearNoteColors()` can fire
      // (`useNoteFeedback`'s score/activeHands effect and its backward-jump
      // branch are the other two, neither followed by a reassert), so a
      // one-shot fix bounded to this branch left the highlight vanishing on
      // a hand-mute toggle or a loop wrap while `selectedNoteId` still held
      // the note.
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
      // REQ-3.9.1's "+2 BPM per clean repetition": a completed pass is one
      // repetition, and it counts as clean at or above CLEAN_ACCURACY. A
      // failed pass is reported too — `useTempoRamp` never lowers the tempo
      // for one, it just does not advance.
      rampRef.current.reportRepetition(accuracyRef.current >= CLEAN_ACCURACY)
    }
  }, [engine.phase, clearFeedback])

  // Roadmap-review finding 3: re-applies the selection highlight after EVERY
  // commit that could have run one of `clearNoteColors()`'s three call sites
  // (the `justStarted` branch above; `useNoteFeedback`'s score/activeHands
  // rebuild effect; and its backward-jump branch, which fires on every loop
  // wrap/seek via the advancing `engine.position`). `setNoteColor` is
  // idempotent (`paint` returns `'unchanged'` and schedules no render when
  // the colour already matches), so reasserting on commits where nothing was
  // actually cleared costs nothing visible and no wasted render.
  useEffect(() => {
    if (selectedNoteId !== undefined) {
      scoreViewerRef.current?.setNoteColor(selectedNoteId, SELECTION_NOTE_COLOR)
    }
  }, [selectedNoteId, engine.phase, engine.position, loaded?.score.id, settings.activeHands])

  function handlePlay(): Millis | undefined {
    ensureAudioOutput()
    return engine.play()
  }

  // Stop must move the score cursor to where the playhead landed through the
  // RAW `scoreViewerRef`, bypassing `useNoteFeedback`'s intercepting
  // `feedback.cursorRef` that `usePracticeEngine` is wired to above — a
  // backward move through THAT ref reads as a loop wrap and wipes the run's
  // just-finished counters (see `useNoteFeedback`'s module comment). Reading
  // `engineRef.current`, not the closed-over `engine`, because `useRecorder`'s
  // `stop:` option (above) is built before `engine` exists on this render.
  function handleStop(): void {
    const at = engineRef.current?.stop()
    if (at !== undefined) scoreViewerRef.current?.moveCursorTo(at.measureIndex, at.tick)
  }

  // Click-to-select (roadmap 4.8a, REQ-3.2.6): feeds AnnotationPanel's
  // fingering/highlight controls, which were permanently disabled without a
  // way to select a note. The visible highlight goes through the SAME
  // `setNoteColor`/`clearNoteColors` channel `useNoteFeedback` already
  // colours correct/wrong/missed notes with (`engraver.ts` has exactly one
  // colouring mechanism, by design) — there is no stacking of colours per
  // note, only "last write wins", the same rule the engraver already applies
  // between `setNoteColor` and `setNoteHidden`. Concretely: selecting a note
  // overrides whatever feedback colour it held; moving the selection away
  // restores DEFAULT_NOTE_COLOR, not the feedback colour it may have held.
  // That is an accepted, bounded loss rather than a fight: selection is a
  // paused-state editing action, and a note's feedback colour is entirely
  // recomputed live from a run's first judged note onward — see `justStarted`
  // above, which re-asserts the current selection right after `clearFeedback`
  // wipes it via the same `clearNoteColors()` call. `setNoteHidden` (the
  // read-ahead drill) is untouched by any of this: the engraver's own `paint`
  // already makes hidden win over any requested colour, selection included.
  function handleSelectNote(noteId: string | undefined): void {
    const handle = scoreViewerRef.current
    if (selectedNoteId !== undefined && selectedNoteId !== noteId) {
      handle?.setNoteColor(selectedNoteId, DEFAULT_NOTE_COLOR)
    }
    if (noteId !== undefined) handle?.setNoteColor(noteId, SELECTION_NOTE_COLOR)
    setSelectedNoteId(noteId)
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
        <div className="transport-group">
          <TransportControls
            phase={engine.phase}
            position={engine.position}
            onPlay={handlePlay}
            // REQ-3.3.4: an assessment run cannot be paused or stopped once
            // started — enforced by disabling the buttons (`disabled` below),
            // not by swallowing the click in a no-op handler, so a click during
            // a run visibly does nothing instead of silently doing nothing.
            onPause={engine.pause}
            onStop={handleStop}
            disabled={assessmentRunning}
          />
        </div>
        <div className="tempo-group">
          <TempoControl
            tempoScale={settings.tempoScale}
            onChange={setTempoScale}
            writtenBpm={engine.writtenBpm}
            effectiveBpm={engine.effectiveBpm}
            disabled={assessmentRunning}
          />
          <TempoRampControl
            enabled={ramp.enabled}
            onToggle={(on) => {
              if (on) {
                ramp.start({
                  startBpm: bpm(rampFromBpm),
                  targetBpm: bpm(rampToBpm),
                  stepBpm: rampStepBpm,
                  repsPerStep: RAMP_REPS_PER_STEP,
                })
              } else {
                ramp.stop()
              }
            }}
            fromBpm={rampFromBpm}
            onFromBpmChange={setRampFromBpm}
            toBpm={rampToBpm}
            onToBpmChange={setRampToBpm}
            stepBpm={rampStepBpm}
            onStepBpmChange={setRampStepBpm}
            repsPerStep={ramp.repsPerStep ?? RAMP_REPS_PER_STEP}
            state={ramp.state}
            nextBpm={ramp.nextBpm}
            disabled={assessmentRunning}
          />
        </div>
        <div className="status-group">
          <MidiDeviceStatus
            connected={midi.input !== undefined}
            devices={midi.devices}
            selectedDeviceId={midi.selectedDeviceId}
            connectionError={midi.connectionError}
          />
          <MicInputControl
            enabled={mic.enabled}
            connected={mic.input !== undefined}
            error={mic.error}
            onToggle={(next) => (next ? mic.enable() : mic.disable())}
          />
          <dl className="note-feedback" role="status" aria-live="polite" aria-label="Note feedback">
            <dt>Accuracy</dt>
            <dd className="accuracy-value" data-testid="feedback-accuracy">
              {Math.round(feedback.summary.accuracy * 100)}%
            </dd>
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
      </div>
      {loaded.musicXml !== undefined && (
        <ScoreViewer
          ref={scoreViewerRef}
          musicXml={loaded.musicXml}
          // Deliberately `loaded.score`, NOT `annotations.annotatedScore`
          // (roadmap-review finding 2): the engraver only reads `score` to
          // build its id map (`buildNoteIdMap`), which does not depend on
          // `fingering`/`highlight` at all — nothing on the render path draws
          // them yet (see `useAnnotations.ts`'s module comment for that gap).
          // `annotatedScore` is a NEW object identity on every fingering/
          // highlight edit, and `score` sits in `ScoreViewer`'s load-effect
          // dependency list, so passing it here would tear down and
          // re-engrave the WHOLE score (osmd.clear() + full re-parse) on
          // every "Set fingering" click — ruinous on a large score (roadmap
          // 2.32's perf work). Keep this in step if the engraver ever learns
          // to draw fingering/highlight for real.
          score={loaded.score}
          onSelectNote={handleSelectNote}
          // Spread, not `measureLabels={props.measureLabels}`: under
          // `exactOptionalPropertyTypes` an explicit `undefined` is not an
          // absent prop, and absent is what makes `ScoreViewer` skip the
          // label effect entirely for every caller that passes nothing.
          {...(props.measureLabels === undefined ? {} : { measureLabels: props.measureLabels })}
        />
      )}
      {/* Directly under the engraving — where the hands go — rather than as a
          fourteenth entry in the control column below (roadmap 5.4; 5.17/5.18
          hold the record that this screen is already too dense). Notes pressed
          here enter `playableInput`, the same seam the MIDI device feeds, so
          they are graded by the real matcher and advance wait mode. */}
      <PracticeKeyboard
        score={loaded.score}
        onPress={(note) => playableInput?.press(note)}
        onRelease={(note) => playableInput?.release(note)}
        deviceConnected={deviceAttached}
        visible={showKeyboard}
        onVisibleChange={setShowKeyboardChoice}
        latch={latchKeys}
        // `OnScreenKeyboard` releases everything still latched when this
        // changes, so port state and what is drawn as down cannot diverge.
        onLatchChange={setLatchKeys}
        // Deliberately NOT disabled during an assessment run, unlike every
        // control around it: an assessment is a pass the learner PLAYS, and
        // this is how they play it when there is no MIDI keyboard. Locking it
        // with the rest would make assessment unreachable on exactly the
        // browsers roadmap 5.4 exists for.
      />
      {/* Per-measure notes attach to wherever the playhead is; fingering and
          highlight edits need a selected note — clicking a notehead in the
          viewer above provides one (roadmap 4.8a). */}
      <AnnotationPanel
        measureIndex={Math.max(0, (engine.position?.measureNumber ?? 1) - 1)}
        {...(selectedNoteId === undefined ? {} : { selectedNoteId })}
      />
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
        <LoopRangeControl
          score={loaded.score}
          loop={settings.loop}
          onChange={setLoop}
          tempoScale={settings.tempoScale}
        />
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
      <ReadAheadControl
        enabled={readAheadEnabled}
        onToggle={setReadAheadEnabled}
        disabled={assessmentRunning}
      />
      <RecordPanel
        phase={recorder.phase}
        recording={recorder.recording}
        // Roadmap 5.4: a recording no longer needs hardware — on-screen notes
        // go through the same input. Still false when there is neither a
        // device nor a visible keyboard, because then nothing can be played
        // and an enabled Record button would capture an empty take.
        canRecord={deviceAttached || showKeyboard}
        onStartRecording={recorder.startRecording}
        onStopRecording={recorder.stopRecording}
        onStartReplay={recorder.startReplay}
        onStopReplay={recorder.stopReplay}
      />
    </div>
  )
}
