/**
 * The practice screen (roadmap 1.18) — where the user practises. Composes the
 * engine (`usePracticeEngine`) with the transport, tempo, loop, hand-mute,
 * metronome, wait-mode and MIDI-status controls below it.
 *
 * Roadmap 1.21 (REQ-4.6): the transport and tempo controls are lifted into
 * `.practice-toolbar` (`.toolbar` + feature-practice.css, roadmap UI-09), a
 * sticky strip rendered ABOVE `ScoreViewer` — a real score is several screens
 * tall, and those controls must stay reachable while the learner scrolls
 * through it. Setup controls (assessment, review, loop/hand/metronome/wait,
 * record/replay) stay below the score, unchanged.
 *
 * UI-09 (2026-08-12 UI audit): screen order top to bottom is now title (in
 * `ScoreScreen`'s `.page-header`) -> transport toolbar -> score -> the honest
 * feedback strip. The strip is a NEW element, not a move of the old one — it
 * renders under the score (status sits with what it describes) and only once
 * a run has started (`hasStartedRun`), never showing a fake 100% accuracy
 * before a single note is judged. "What this screen doesn't check" moved from
 * a permanent disclosure into a popover beside the strip's Accuracy stat.
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
import { GRADED_PIECES, PROVENANCE_LABELS } from '@content/repertoire/gradedPieces.ts'
import { ScoreViewer, type ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { beatTicks, type Subdivision } from '@core/timing/metronome.ts'
import { bpm, ticks as asTicks, type Millis } from '@core/shared/units.ts'
import { useEffect, useRef, useState } from 'react'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { createBrowserClock } from './clock.ts'
import { createDefaultAudioOutput } from './createDefaultAudioOutput.ts'
import { HandMuteControl } from './HandMuteControl.tsx'
import { LoopRangeControl } from './LoopRangeControl.tsx'
import { MetronomeControl } from './MetronomeControl.tsx'
import { MicInputControl } from './MicInputControl.tsx'
import { PianoRoll, type PianoRollHandle } from './PianoRoll.tsx'
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
import { usePracticeEngine, type PositionDisplay, type PracticeEngine } from './usePracticeEngine.ts'
import { useRecorder } from './useRecorder.ts'
import type { FrameDriver } from './useTransportLoop.ts'
import { WaitModeControl } from './WaitModeControl.tsx'
import { ReadAheadControl } from './ReadAheadControl.tsx'
import { useReadAhead } from './useReadAhead.ts'
import type { Score } from '@core/notation/score.ts'

/** Note accuracy at or above which a completed pass counts as a clean repetition (REQ-3.9.1). */
const CLEAN_ACCURACY = 0.95
/** Clean passes needed at a rung before the ramp steps up. */
const RAMP_REPS_PER_STEP = 1
/** The selected notehead's colour (roadmap 4.8a, REQ-3.2.6) — matches `--accent` in styles.css. */
const SELECTION_NOTE_COLOR = '#6ea8fe'

/**
 * Roadmap 5.17 (progressive disclosure gated by track level, the `playing`
 * track): a level-1 learner sees only transport, tempo, hand mute, loop,
 * metronome and record — everything this file already rendered before this
 * task. Two further tiers unlock as the learner's OWN level rises (read
 * through `levelStore`, raised either by real advancement or the dashboard's
 * manual override — see `docs/ux-pedagogy-review-2026-08-06.md`'s "the app
 * already tracks a per-track level and does not use it" finding, which this
 * task exists to fix).
 *
 * Curriculum content (`src/content/curriculum/curriculum.ts`) never names
 * "wait mode" or "assessment" against a level number — it is authored as
 * lesson prose, not a skills-per-level table — so these two thresholds are a
 * judgement call, not a derived fact, exactly like 5.35's fingering table
 * says of its own defensible-but-not-unique choices. What curriculum.ts DOES
 * say: level 1's own exit criterion (`LEVEL_1_EXIT_CRITERIA`) is playing
 * hands together, in level 1's LAST unit (`l1-u5-hands-together`) — REQ-3.3.3
 * ties wait mode directly to that same hands-together coordination. The app
 * tracks whole levels, not units within one, so the closest level boundary
 * to "just past hands-together" is entering level 2.
 */
const MIN_WAIT_MODE_LEVEL = 2
/**
 * Assessment, tempo ramp, read-ahead and annotations (behind "More tools")
 * assume the learner can already get through a piece — level 2's own units
 * (one-octave scales, tonic/dominant chords, first sight reading) are that
 * bar; level 3 is where they are worth surfacing unprompted.
 */
const MIN_ADVANCED_TOOLS_LEVEL = 3

/**
 * Roadmap 5.18 — the design plan for what 5.17 left behind. What the screen
 * shows: a pinned, sticky transport/tempo/status strip above the score (1.21,
 * unchanged), the score and its on-screen keyboard as the main content, and
 * everything else gathered into two named, collapsible `<details>` sections
 * instead of five flat top-level siblings. What is primary: Play, inside that
 * sticky strip — nothing below the score competes with it for weight any
 * more, because nothing below the score is a top-level sibling of it any
 * more either. What is behind disclosure: Loop range, hand mute, metronome,
 * wait mode and record/replay — every control 5.17 kept unconditionally
 * visible at level 1 — move from five flat top-level groups into ONE new
 * `.practice-setup` section (see its own comment below for why it defaults
 * OPEN rather than closed); Assessment, tempo ramp, read ahead and the
 * annotation editors keep 5.17's pre-existing "More tools" section,
 * untouched. Net demotion: five flat groups collapse into one.
 *
 * Roadmap B.3 adds a sixth control — "Piano roll" — into that SAME
 * `.practice-setup` group rather than a new top-level sibling, so nothing
 * else on the screen is demoted: it takes the same already-collapsible slot
 * loop range/hand mute/metronome/wait mode/record already share, off by
 * default like they were before 5.17 named them the level-1 baseline.
 */

/**
 * The piano roll starts drawing from wherever the score cursor already IS,
 * not always tick 0 — otherwise turning it on mid-pause (say, right after
 * Stop rewound to a loop's start, or simply before ever pressing Play on a
 * freshly-opened piece) would flash to the top of the piece before the next
 * frame corrects it. `usePracticeEngine` exposes only the beat/measure
 * display it already computes (`PositionDisplay`), never a raw tick — so
 * this reverses that same display back into an approximate tick using
 * `beatTicks`, the one piece of tick math this file already imports for
 * nothing else. This is a ONE-TIME snapshot for the very first paint, not a
 * running clock: every position after it comes from the SAME per-frame
 * `moveCursorTo` call the score cursor rides on (see the `engineCursorRef`
 * comment below).
 */
function approxTickFromPosition(score: Score, position: PositionDisplay | undefined) {
  if (position === undefined) return asTicks(0)
  const measure = score.measures[position.measureNumber - 1]
  if (measure === undefined) return asTicks(0)
  const unit = beatTicks(measure.timeSignature)
  return asTicks(measure.startTick + (position.beat - 1) * unit)
}

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

  // Roadmap 5.17: gates below read `playingLevel` directly, never a copy —
  // a dashboard override or real advancement must be reflected the next
  // render, not just at mount. `levelsHydrated` guards against a flash of
  // the advanced groups for a level 3+ learner while the async restore is
  // still in flight (same reasoning as `ScoreScreen`'s theory-level gate,
  // roadmap 3.18) — false here reads as "not settled yet", not "level 1".
  const playingLevel = useLevelStore((s) => s.levelState.levels.playing)
  const levelsHydrated = useLevelStore((s) => s.hydrated)

  const [subdivision, setSubdivision] = useState<Subdivision>(1)
  const [rampFromBpm, setRampFromBpm] = useState(60)
  const [rampToBpm, setRampToBpm] = useState(80)
  const [rampStepBpm, setRampStepBpm] = useState(2)
  const [waitModeEnabled, setWaitModeEnabled] = useState(false)
  const [readAheadEnabled, setReadAheadEnabled] = useState(false)
  // Roadmap B.3 (REQ-3.2.4's optional half): off by default — see the
  // `.practice-setup` module comment above for why this lives in that
  // existing group rather than a new top-level control.
  const [pianoRollEnabled, setPianoRollEnabled] = useState(false)
  const pianoRollRef = useRef<PianoRollHandle>(null)
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
  // UI-09 (2026-08-12 UI audit): the honest feedback strip is absent entirely
  // until a run has started — never a fake 100% accuracy before a single note
  // is played. Flips true on the SAME phase edge that already clears the
  // feedback counters below (`justStarted`), and resets on a new score the
  // same way `selectedNoteId` does just above.
  const [hasStartedRun, setHasStartedRun] = useState(false)
  useEffect(() => {
    setHasStartedRun(false)
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

  // Roadmap B.3: the piano roll's position comes from the SAME per-frame
  // `moveCursorTo` call `usePracticeEngine` already makes to drive the score
  // cursor — never a second clock. This borrows `useNoteFeedback`'s own
  // trick one layer further: `feedback.cursorRef` already intercepts that
  // call for note-matching and forwards it to the real `ScoreViewer`; this
  // wraps `feedback.cursorRef` ITSELF the same way, forwarding every call
  // unchanged after also handing the tick to the roll. Built once (the
  // `if (current === null)` guard, matching `useNoteFeedback`'s own
  // `cursorRef` construction) so its identity never changes across renders —
  // `usePracticeEngine` only rebuilds its frame-loop subscription when this
  // ref's IDENTITY changes, not its contents.
  const engineCursorRef = useRef<ScoreViewerHandle | null>(null)
  if (engineCursorRef.current === null) {
    engineCursorRef.current = {
      moveCursorTo(measureIndex, tick) {
        pianoRollRef.current?.setPositionTick(tick)
        feedback.cursorRef.current?.moveCursorTo(measureIndex, tick)
      },
      setNoteColor: (noteId, color) => feedback.cursorRef.current?.setNoteColor(noteId, color),
      clearNoteColors: () => feedback.cursorRef.current?.clearNoteColors(),
      setNoteHidden: (noteId, hidden) => feedback.cursorRef.current?.setNoteHidden(noteId, hidden),
      clearHiddenNotes: () => feedback.cursorRef.current?.clearHiddenNotes(),
    }
  }

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
    scoreViewerRef: engineCursorRef,
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
      // UI-09: this is the moment the honest feedback strip should become
      // visible — the same edge that already resets the counters it shows.
      setHasStartedRun(true)
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
    if (at !== undefined) {
      scoreViewerRef.current?.moveCursorTo(at.measureIndex, at.tick)
      // This bypasses `engineCursorRef` on purpose, same as the raw
      // `scoreViewerRef` call above — the roll still needs to know where the
      // playhead landed, so it is told directly rather than by duplicating
      // the interception here too.
      pianoRollRef.current?.setPositionTick(at.tick)
    }
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

  // Roadmap 5.17: each gate also stays open once its OWN feature is already
  // active — without this, a learner using wait mode/read-ahead/the ramp/an
  // in-progress assessment at level 3+ would have its control vanish out
  // from under them the instant a dashboard override drops their level back
  // down, with no way left on screen to turn it off.
  const showWaitMode = waitModeEnabled || (levelsHydrated && playingLevel >= MIN_WAIT_MODE_LEVEL)
  const showAdvancedTools =
    readAheadEnabled ||
    ramp.enabled ||
    assessment.phase !== 'idle' ||
    (levelsHydrated && playingLevel >= MIN_ADVANCED_TOOLS_LEVEL)

  if (loaded === undefined) {
    return <p>Load a score on the Practice tab to start practising.</p>
  }

  // Roadmap 5.52: the same disclosure the Repertoire catalogue row shows
  // (`RepertoireScreen.tsx`'s `provenanceText`), read here off the LOADED
  // score rather than a prop, so it follows the piece wherever it was opened
  // from (Repertoire's "Open in Practice", a lesson demo, or a plain file
  // import). `GRADED_PIECES` entries set their bundled `Score.id` to their
  // own `id`/`scoreId` (`gradedScoreById`, `gradedPieces.test.ts`), so this
  // lookup is exact, not a title match. Undefined for any score that is NOT
  // a catalogue piece — a learner's own imported file or a manually added
  // piece with no catalogue entry — which is the correct, explicit "not
  // applicable" state: nothing renders rather than a guessed provenance.
  //
  // Deliberately NOT a new heading with the piece title: `ScoreScreen.tsx`
  // (the only production caller of `PracticeScreen`, outside this task's
  // file boundary) already renders the loaded piece's title as its own
  // `<h2>` directly above this component. A second element repeating that
  // same title text created an ambiguous duplicate — caught by
  // `ScoreScreen.test.tsx` failing on `findByText('Twinkle, Twinkle, Little
  // Star')` matching two nodes once this landed. This renders ONLY the
  // provenance line itself, immediately under that existing heading, so the
  // disclosure follows the piece into Practice without repeating its title.
  const cataloguePiece = GRADED_PIECES.find((piece) => piece.id === loaded.score.id)

  return (
    <div className="practice-screen">
      {cataloguePiece !== undefined && (
        <p className="practice-piece-provenance">
          {PROVENANCE_LABELS[cataloguePiece.provenance.tier]}
          {cataloguePiece.provenance.excerptNote !== undefined
            ? ` — ${cataloguePiece.provenance.excerptNote}`
            : ''}
        </p>
      )}
      {/* UI-09 (2026-08-12 UI audit): title -> transport toolbar -> score.
          Sticky below the topbar while the score scrolls (feature-practice.css).
          Two groups so the toolbar wraps as designed units, not one control at
          a time, at 768px (acceptance criterion 4) — transport stays together
          on its own line before tempo/mic wrap to a second. */}
      <div className="toolbar practice-toolbar">
        <div className="practice-toolbar-transport">
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
        <div className="practice-toolbar-tempo">
          <TempoControl
            tempoScale={settings.tempoScale}
            onChange={setTempoScale}
            writtenBpm={engine.writtenBpm}
            effectiveBpm={engine.effectiveBpm}
            disabled={assessmentRunning}
          />
          <MicInputControl
            enabled={mic.enabled}
            connected={mic.input !== undefined}
            error={mic.error}
            onToggle={(next) => (next ? mic.enable() : mic.disable())}
          />
        </div>
      </div>
      {/* Roadmap B.3 (REQ-3.2.4's optional half): ABOVE the engraving, not
          instead of it — both stay visible together, which is the whole
          pedagogical point (a bridge from roll to notation, not a
          replacement). `key={loaded.score.id}` remounts on a new piece so
          its internal position resets instead of carrying over the old
          piece's tick range; `loaded.score`, matching what `ScoreViewer`
          itself draws below (unfiltered by hand mute — mute affects sound
          and matching, never what is printed or rolled). */}
      {pianoRollEnabled && loaded.musicXml !== undefined && (
        <PianoRoll
          key={loaded.score.id}
          ref={pianoRollRef}
          score={loaded.score}
          initialPositionTick={approxTickFromPosition(loaded.score, engine.position)}
        />
      )}
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
      {/* UI-09 (2026-08-12 UI audit): the honest feedback strip. Under the
          score, not above it — status sits with the thing it describes
          (DESIGN.md rule 4) — and absent entirely until a run has started,
          rather than a permanent row that opens on a fake 100%. Accuracy,
          the correct/wrong/missed/extra counts, the timing readout and the
          "What this screen doesn't check" info popover all live inside
          `TimingFeedback` now — see its own module comment. */}
      {hasStartedRun && (
        <TimingFeedback summary={feedback.summary} lastJudgement={feedback.lastJudgement} />
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
      {/* Roadmap 5.18: Loop range, hand mute, metronome, wait mode and
          record/replay were five flat top-level siblings — every control 5.17
          kept unconditionally visible at level 1, none of them Play, all of
          them at Play's own visual weight. One collapsible section, titled
          for what it is.
          Roadmap UI-10 (2026-08-12 UI audit): `.card--sunken` (primitives.css)
          replaces the section's own hand-rolled border/background — the
          disclosure chrome (summary marker, body spacing) stays in
          feature-practice-sections.css.

          Roadmap UI-24 (2026-08-15 final visual pass): defaults CLOSED. It
          shipped `open`, on the reasoning that 5.17/5.18 had promised a level-1
          learner these controls without an extra click and that nine e2e specs
          reached inside with no expand step. That put Practice at 21 visible
          interactive controls (measured, piano keys excluded) against
          DESIGN.md rule 2's stated bar of ~6 — and left Record, the one
          control rule 2 names by name as never-open-by-default, open on load.
          Closing it is what makes the written rule true on the screen the rule
          was written for: DESIGN.md's own opening paragraph cites this
          screen's density (30 controls, 13 groups, ~5100px) as the failure the
          whole rule set exists to fix, so an exception here would empty the
          rule rather than qualify it. The 5.18 promise is kept by the level
          gate, not by the default state — every one of these controls is
          present, named and one click away at level 1, which is what "theirs
          from the first session" meant. Closed, the screen measures 10 visible
          controls: Change piece, Play, Pause, Stop, tempo, Use microphone,
          On-screen keyboard, Hold keys down, Show keys, Practice setup. Counted
          with `Element.checkVisibility()` — a closed `<details>` still reports a
          non-zero bounding rect in Chromium, so a rect-based count reads 20 and
          silently includes everything the learner cannot see. The fourteen e2e
          specs that reached inside now open it first, via `openPracticeSetup`
          in `e2e/practice-setup.ts`. */}
      <details className="practice-setup card--sunken">
        <summary>Practice setup</summary>
        <div className="practice-setup-body">
          {/* Roadmap UI-10: Range/Hands/Sound as three titled groups
              (`<fieldset><legend>`) rather than three flat top-level
              controls — `<legend>` gives each one the same visible label
              treatment `.field > label` uses elsewhere, and `<fieldset>` is
              the correct native primitive for "a titled group of controls"
              (each control inside already carries its own `role="group"`/
              `radiogroup` for its OWN name — "Loop range", "Hands" — this
              adds the outer section title the audit asked for without
              fighting either). `LoopRangeControl` has no `disabled` prop of
              its own (owned by another agent) — the fieldset's native
              `disabled` is the only lever available without touching that
              file; Hands/Sound already take their own `disabled` prop, so
              the fieldset's `disabled` here is redundant-but-harmless
              belt-and-suspenders, not the only mechanism. */}
          <fieldset className="practice-setup-group" disabled={assessmentRunning}>
            <legend>Range</legend>
            <LoopRangeControl
              score={loaded.score}
              loop={settings.loop}
              onChange={setLoop}
              tempoScale={settings.tempoScale}
            />
          </fieldset>
          <fieldset className="practice-setup-group" disabled={assessmentRunning}>
            <legend>Hands</legend>
            <HandMuteControl
              activeHands={settings.activeHands}
              onChange={setActiveHands}
              disabled={assessmentRunning}
            />
          </fieldset>
          <fieldset className="practice-setup-group" disabled={assessmentRunning}>
            <legend>Sound</legend>
            <MetronomeControl
              enabled={settings.metronomeEnabled}
              onToggle={setMetronomeEnabled}
              subdivision={subdivision}
              onSubdivisionChange={setSubdivision}
              disabled={assessmentRunning}
            />
          </fieldset>
          {/* Roadmap B.3 (REQ-3.2.4's optional half) — the falling-note view,
              synchronized with the score below rather than a second clock
              (see `engineCursorRef` above). Off by default: sight reading is
              the target skill, so a beginner leaning on the roll instead of
              the staff is an opt-in, not the default experience.
              Roadmap UI-24: wrapped in its own "View" fieldset. It was a bare
              sibling of the Range/Hands/Sound fieldsets, so it rendered flush
              under Sound's legend and read as a third sound setting — a
              falling-note display filed under audio. It is what you SEE, not
              what you hear. */}
          <fieldset className="practice-setup-group" disabled={assessmentRunning}>
            <legend>View</legend>
            <div className="piano-roll-control" role="group" aria-label="Piano roll">
              <label>
                <input
                  type="checkbox"
                  checked={pianoRollEnabled}
                  onChange={(event) => setPianoRollEnabled(event.target.checked)}
                />
                Piano roll
              </label>
            </div>
          </fieldset>
          {/* Roadmap 5.17: wait mode is the one tier between the level-1
              basics above and "More tools" below — REQ-3.3.3 ties it to
              hands-together, which the curriculum introduces before
              assessment/ramp/read-ahead/annotations become relevant (see
              `MIN_WAIT_MODE_LEVEL`'s comment). */}
          {showWaitMode && (
            <WaitModeControl
              enabled={waitModeEnabled}
              onToggle={setWaitModeEnabled}
              wait={engine.wait}
              disabled={assessmentRunning}
            />
          )}
          <RecordPanel
            phase={recorder.phase}
            recording={recorder.recording}
            // Roadmap 5.4: a recording no longer needs hardware — on-screen
            // notes go through the same input. Still false when there is
            // neither a device nor a visible keyboard, because then nothing
            // can be played and an enabled Record button would capture an
            // empty take.
            canRecord={deviceAttached || showKeyboard}
            onStartRecording={recorder.startRecording}
            onStopRecording={recorder.stopRecording}
            onStartReplay={recorder.startReplay}
            onStopReplay={recorder.stopReplay}
          />
        </div>
      </details>
      {/* Roadmap 5.17: absent below `MIN_ADVANCED_TOOLS_LEVEL` — not merely
          collapsed — per docs/ux-pedagogy-review-2026-08-06.md's finding that
          these four sit at the same visual weight as Play for a learner who
          has never once needed them. Collapsed by default even once it DOES
          render, matching `SightReadingCustomizer`'s and `AnalysisPanel`'s
          own `<details>` disclosures (roadmap 5.12, 3.18a). */}
      {showAdvancedTools && (
        <details className="practice-more-tools">
          <summary>More tools</summary>
          <div className="practice-more-tools-body">
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
            <ReadAheadControl
              enabled={readAheadEnabled}
              onToggle={setReadAheadEnabled}
              disabled={assessmentRunning}
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
            {/* Per-measure notes attach to wherever the playhead is; fingering
                and highlight edits need a selected note — clicking a notehead
                in the viewer above provides one (roadmap 4.8a). */}
            <AnnotationPanel
              measureIndex={Math.max(0, (engine.position?.measureNumber ?? 1) - 1)}
              {...(selectedNoteId === undefined ? {} : { selectedNoteId })}
            />
          </div>
        </details>
      )}
    </div>
  )
}
