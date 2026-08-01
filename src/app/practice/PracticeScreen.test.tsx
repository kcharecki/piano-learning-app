/**
 * Screen-level composition (roadmap 1.18): the store, the engine and every
 * control are wired together correctly, and the screen renders — and stays
 * usable — with no MIDI keyboard connected. Per-control behaviour is already
 * covered by each control's own test file; this only asserts the wiring
 * between them.
 */
import { useScoreStore } from '@app/state/scoreStore.ts'
import { C_MAJOR_SCALE_RH } from '@test/fixtures.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import type { FrameDriver } from './useTransportLoop.ts'

// `ScoreViewer` wraps OSMD, which does not run in happy-dom (see
// ScoreScreen.test.tsx) — mocked out here too, only for the DOM-order test
// below that needs an actual score-viewer element to compare positions
// against. Every other test in this file loads a score with `musicXml:
// undefined`, so the branch that renders `ScoreViewer` never runs for them
// and this mock changes nothing about their behaviour. The forwarded ref is
// wired to a minimal handle matching `ScoreViewerHandle` so a future test
// that presses Play with a loaded score exercises the same call surface the
// real component does, instead of silently hitting a null ref.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: forwardRef(function MockScoreViewer(
    _props: { readonly musicXml: string },
    ref: React.ForwardedRef<ScoreViewerHandle>,
  ) {
    useImperativeHandle(ref, () => ({
      moveCursorTo: () => {},
      setNoteColor: () => {},
      clearNoteColors: () => {},
    }))
    return <div data-testid="mock-score-viewer" className="score-viewer" />
  }),
}))

const { PracticeScreen } = await import('./PracticeScreen.tsx')

// A Set, not a single slot: with the recorder wired in (roadmap 2.14),
// `usePracticeEngine`'s own frame loop and `useRecorder`'s replay loop can
// both be active on this SAME shared driver at once (e.g. during a replay,
// the transport is 'playing' while the recorder is 'replaying') — exactly
// like the real `rafFrameDriver`, where every active `useTransportLoop`
// caller gets its own independent loop. A single-slot fake would silently
// drop whichever loop registered first every time `pump()` is called.
function manualDriver(): { driver: FrameDriver; pump: () => void } {
  const callbacks = new Set<() => void>()
  const driver: FrameDriver = (cb) => {
    callbacks.add(cb)
    return () => {
      callbacks.delete(cb)
    }
  }
  return { driver, pump: () => callbacks.forEach((cb) => cb()) }
}

function resetStore(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
}

function loadSampleScore(): void {
  useScoreStore
    .getState()
    .loadScore({ score: C_MAJOR_SCALE_RH, sourceName: 'Test Score', musicXml: undefined })
}

// The mocked `ScoreViewer` above only renders when `musicXml` is defined —
// needed for the DOM-order test, which must have an actual score-viewer
// element in the tree to compare positions against.
function loadSampleScoreWithMusicXml(): void {
  useScoreStore.getState().loadScore({
    score: C_MAJOR_SCALE_RH,
    sourceName: 'Test Score',
    musicXml: '<score-partwise/>',
  })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

describe('PracticeScreen', () => {
  it('asks the user to load a score before showing any controls', () => {
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)
    expect(screen.getByText(/load a score/i)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Transport' })).toBeNull()
  })

  it('is fully usable with no MIDI keyboard connected — REQ-4.1', async () => {
    loadSampleScore()
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<PracticeScreen connectMidi={neverResolves} />)

    expect(screen.getByText(/^No MIDI keyboard connected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
  })

  it('composes the store, the engine and every control into one working screen', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    expect(screen.getByText(/^MIDI keyboard connected: Fake Digital Piano/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump())
    expect(audio.playedNotes.length).toBeGreaterThan(0)

    await user.click(screen.getByRole('radio', { name: 'Right hand only' }))
    expect(useScoreStore.getState().settings.activeHands).toEqual(['right'])

    await user.click(screen.getByRole('checkbox', { name: 'Metronome' }))
    expect(useScoreStore.getState().settings.metronomeEnabled).toBe(true)
  })

  it('shows live note feedback (REQ-3.3.2) and keeps it on screen once the transport stops (roadmap 2.14)', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    // Before anything is played, the panel reads a clean slate.
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump()) // parks the cursor on tick 0, arming the matcher

    // C_MAJOR_SCALE_RH's first note is C4 (60) at tick 0.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    // Kills a mutant that restores the old clear-on-stop effect: the run just
    // ended, but its counters must stay readable on screen — see the module
    // comment on `useNoteFeedback`'s "Discontinuities" section (roadmap 2.14).
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')
  })

  // Kills a mutant that drops the clear() call from the start-of-run
  // transition entirely (e.g. hardcoding the new effect's `justStarted` to
  // `false`) — starting a fresh run must wipe the PREVIOUS run's counters,
  // and must do so on the phase transition itself: this asserts the wipe
  // immediately after the click that starts the second run, before that run
  // has pumped a single frame or judged a single note.
  it('wipes note feedback the instant a new run starts, before its first note is judged (roadmap 2.14)', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump())
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1') // survives the stop

    await user.click(screen.getByRole('button', { name: 'Play' }))
    // No pump yet — the wipe already happened, on the phase transition itself.
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')
  })

  // Kills a mutant that widens the clear condition to fire on ANY transition
  // into a running phase (dropping the "previous phase was 'stopped'" guard)
  // — a resume from 'paused' is explicitly not a new run and must not wipe
  // the run already in progress.
  it("does not wipe note feedback on a pause/resume — 'paused' -> 'playing' is not a new run (roadmap 2.14)", async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump())
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Play' })) // resume

    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
  })

  it('runs an assessment end to end and shows a clean review on a flawless pass (roadmap 2.11)', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start assessment' }))
    expect(screen.getByText(/assessment running/i)).toBeInTheDocument()
    act(() => manual.pump())

    // C_MAJOR_SCALE_RH: 8 quarter notes at 120bpm, 500ms apart, midi 60..72.
    const scaleMidis = [60, 62, 64, 65, 67, 69, 71, 72]
    for (let i = 0; i < scaleMidis.length; i++) {
      if (i > 0) act(() => clock.advance(500))
      act(() =>
        midiInput.emit({
          type: 'noteOn',
          note: midi(at(scaleMidis, i)),
          velocity: 80,
          time: millis(clock.now()),
        }),
      )
      act(() => manual.pump())
    }
    // Past the end of the piece (measure 2 ends at 4000ms) — the transport
    // plays off the end, which is what finishes the assessment run.
    act(() => clock.advance(1000))
    act(() => manual.pump())

    expect(screen.getByTestId('assessment-accuracy')).toHaveTextContent('100%')
    expect(screen.getByTestId('assessment-timing')).toHaveTextContent('100%')
    expect(screen.getByText(/clean run/i)).toBeInTheDocument()
  })

  it('an assessment run cannot be paused or stopped once started (REQ-3.3.4)', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start assessment' }))
    act(() => manual.pump())

    // The fix for REQ-3.3.4's silent failure mode: Pause and Stop are
    // actually DISABLED during a run, not wired to no-op handlers that
    // swallow the click invisibly — see PracticeScreen's TransportControls
    // wiring and the bug this task fixes.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Pause' }))

    // Still running: neither click actually stopped or paused the transport,
    // so the Play button — disabled only while playing/waiting — stays disabled.
    expect(screen.getByText(/assessment running/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  })

  // The bug this task fixes (REQ-3.3.4, M2 acceptance audit): tempo, loop,
  // hand-mute, wait-mode and metronome all stayed live during a run, so
  // changing any of them silently invalidated the assessment's fixed-tempo
  // anchor arithmetic — moving the tempo mid-run mistimed every later note
  // with no indication anything went wrong, and setting a loop mid-run made
  // the transport loop forever, so the 'stopped' transition that finalises
  // the run never fired (a stuck run, un-recoverable short of a reload).
  // Kills any mutant that drops one `disabled={assessmentRunning}` wire, or
  // that swaps the fieldset's `disabled` condition for a constant.
  it('disables every control that could invalidate a run while the assessment is running, and re-enables them once it completes (REQ-3.3.4)', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    // These five are gated purely on `assessmentRunning` and stay enabled
    // through ordinary (non-assessment) transport phases, so they are
    // checked independently of Pause/Stop below, which are ALSO gated on
    // `phase` (only enabled while playing/waiting) — conflating the two
    // would make this test depend on incidental phase timing instead of the
    // one thing REQ-3.3.4 actually requires.
    function assertNonTransportEnabled(): void {
      expect(screen.getByLabelText('Tempo')).toBeEnabled()
      expect(screen.getByLabelText('From measure')).toBeEnabled()
      expect(screen.getByLabelText('to measure')).toBeEnabled()
      expect(screen.getByRole('checkbox', { name: 'Loop' })).toBeEnabled()
      expect(screen.getByRole('radio', { name: 'Left hand only' })).toBeEnabled()
      expect(screen.getByRole('checkbox', { name: 'Wait for me' })).toBeEnabled()
      expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeEnabled()
    }

    function assertNonTransportDisabled(): void {
      expect(screen.getByLabelText('Tempo')).toBeDisabled()
      expect(screen.getByLabelText('From measure')).toBeDisabled()
      expect(screen.getByLabelText('to measure')).toBeDisabled()
      expect(screen.getByRole('checkbox', { name: 'Loop' })).toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Left hand only' })).toBeDisabled()
      expect(screen.getByRole('checkbox', { name: 'Wait for me' })).toBeDisabled()
      expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeDisabled()
    }

    // Not running yet: every non-transport control is enabled (Pause/Stop
    // are disabled too, but that is `phase === 'stopped'` doing its
    // ordinary job, not this task's fix — checked separately below).
    assertNonTransportEnabled()

    // Ordinary (non-assessment) Play: phase becomes 'playing' with
    // assessmentRunning still false, so Pause/Stop must be enabled — proves
    // the new `disabled` wiring does not neuter them outside a run.
    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump())
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    await user.click(screen.getByRole('button', { name: 'Start assessment' }))
    act(() => manual.pump())

    // Now running an assessment: phase is 'playing' again (an assessment run
    // IS a play), but this time assessmentRunning is true — Pause/Stop must
    // be disabled by that alone, not by phase.
    assertNonTransportDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()

    // Play the scale correctly and past the end of the piece, exactly as the
    // "runs an assessment end to end" test does, so the run reaches
    // 'complete' for real rather than being asserted stuck.
    const scaleMidis = [60, 62, 64, 65, 67, 69, 71, 72]
    for (let i = 0; i < scaleMidis.length; i++) {
      if (i > 0) act(() => clock.advance(500))
      act(() =>
        midiInput.emit({
          type: 'noteOn',
          note: midi(at(scaleMidis, i)),
          velocity: 80,
          time: millis(clock.now()),
        }),
      )
      act(() => manual.pump())
    }
    act(() => clock.advance(1000))
    act(() => manual.pump())

    expect(screen.getByTestId('assessment-accuracy')).toBeInTheDocument()
    assertNonTransportEnabled()

    // The run finishing also returns the transport to 'stopped', so Pause
    // and Stop read disabled again here too — but for the ordinary reason
    // (`!running`), not because they are stuck. Prove they are not stuck by
    // pressing Play once more and seeing them come back.
    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump())
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  it('lifts the playing controls into one strip above the score (roadmap 1.21, REQ-4.6)', () => {
    loadSampleScoreWithMusicXml()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const controls = document.querySelector('.practice-controls')
    invariant(controls instanceof HTMLElement, '.practice-controls missing')

    // The MIDI status, transport, tempo and live accuracy readout all live
    // inside the sticky strip — not scattered across the screen.
    expect(controls).toContainElement(screen.getByText(/^MIDI keyboard connected:/))
    expect(controls).toContainElement(screen.getByRole('group', { name: 'Transport' }))
    expect(controls).toContainElement(screen.getByLabelText('Tempo'))
    expect(controls).toContainElement(screen.getByTestId('feedback-accuracy'))

    // The strip precedes the score in actual DOM order — this fails if
    // someone moves the controls back below the score, even though both
    // elements would still exist. It also fails if the score is instead
    // nested INSIDE the sticky strip (which would make the whole score
    // sticky too): `compareDocumentPosition` reports a contained descendant
    // as both FOLLOWING and NOT PRECEDING, so the two direction checks alone
    // pass for that mutant — the explicit `not.toContainElement` below is
    // what catches it.
    const scoreViewer = screen.getByTestId('mock-score-viewer')
    const relation = controls.compareDocumentPosition(scoreViewer)
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(relation & Node.DOCUMENT_POSITION_PRECEDING).toBeFalsy()
    expect(controls).not.toContainElement(scoreViewer)

    // The setup controls stay below the score, outside the sticky strip.
    const startAssessment = screen.getByRole('button', { name: 'Start assessment' })
    expect(controls).not.toContainElement(startAssessment)
  })

  it('keeps .practice-controls pinned on screen while the score scrolls (roadmap 1.21, REQ-4.6)', () => {
    // styles.css is never loaded by the vitest/happy-dom module graph (no
    // setup file imports CSS), so nothing above would fail if the sticky
    // rule were deleted. Read the stylesheet directly and pin its content —
    // this fails if `position: sticky`, `top: 0`, `background` or `z-index`
    // are removed from `.practice-controls`.
    const cssPath = join(process.cwd(), 'src', 'styles.css')
    const css = readFileSync(cssPath, 'utf-8')
    const ruleMatch = /\.practice-controls\s*\{([^}]*)\}/.exec(css)
    invariant(ruleMatch !== null, '.practice-controls rule missing from styles.css')
    const rule = at(ruleMatch, 1)

    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/top:\s*0/)
    expect(rule).toMatch(/background:\s*var\(--bg\)/)
    expect(rule).toMatch(/z-index:\s*10/)
  })

  // Kills a mutant that hardcodes `canRecord` to `true` (or drops the prop,
  // which defaults RecordPanel's own `disabled` check to enabled) — Record
  // must actually reflect whether a MIDI keyboard is connected.
  it('disables Record when no MIDI keyboard is connected (roadmap 2.14)', () => {
    loadSampleScore()
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<PracticeScreen connectMidi={neverResolves} />)

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
  })

  // Kills a mutant that hardcodes `canRecord` to `false` — the flip side of
  // the test above; both are needed because `!==` and `===` mutants each only
  // fail one direction.
  it('enables Record once a MIDI keyboard is connected (roadmap 2.14)', () => {
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled()
  })

  // Proves `useNoteFeedback` (and, transitively, `usePracticeEngine`) is
  // wired to `recorder.input`, not the raw live `midi.input` — the swap this
  // whole task exists to make (roadmap 2.14, REQ-3.9.2). The live `midiInput`
  // fake is never touched again after the recording is captured; the ONLY way
  // the second note-on below can move the feedback counter is through the
  // replay's own re-emission, which is delivered exclusively via the
  // recorder's fan-out. If `PracticeScreen` were wired back to `midi.input`
  // directly (the bug this task fixes), the counter would stay at 0 forever
  // after Replay starts it (the replay's own start-of-run clear), because
  // nothing calls `midiInput.emit` again.
  //
  // What this does NOT prove: it doesn't inspect `recorder.input`'s object
  // identity directly (an internal of `useRecorder`, not reachable from
  // outside), and it doesn't cover `usePracticeEngine`'s OWN consumption of
  // `midiInput` (wait-mode note-on/off) separately from `useNoteFeedback`'s —
  // both hooks are given the same `recorder.input` value in one prop, so a
  // mutant that swapped just one of the two call sites back to `midi.input`
  // would still be caught here only insofar as it broke the ONE call site this
  // test happens to observe (`useNoteFeedback`, via the accuracy panel).
  it('feeds live and replayed MIDI to note feedback through the recorder, never the raw live input directly (roadmap 2.14)', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()

    render(
      <PracticeScreen
        clock={clock}
        date={clock}
        audioOutput={audio}
        midiInput={midiInput}
        frameDriver={manual.driver}
      />,
    )

    // Record a single correct note (C4, the scale's first note) starting 50ms
    // into the take and released 50ms later, plus 200ms of trailing silence —
    // via the LIVE input, the only place in the test `midiInput.emit` is ever
    // called. The trailing silence matters: it keeps the recording's total
    // duration well past the note-on's own restamped time below, so replaying
    // past the note does not ALSO end the replay (and so clear feedback) in
    // that same frame.
    await user.click(screen.getByRole('button', { name: 'Record' }))
    act(() => manual.pump()) // parks the cursor on tick 0, arming the matcher
    act(() => clock.advance(50))
    act(() =>
      midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(clock.now()) }),
    )
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
    act(() => clock.advance(50))
    act(() => midiInput.emit({ type: 'noteOff', note: midi(60), time: millis(clock.now()) }))
    act(() => clock.advance(200))

    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    // Stopping no longer wipes the take's counters (roadmap 2.14) — the
    // learner, and the replay comparison below, need to be able to read what
    // the live take actually scored.
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
    expect(screen.getByTestId('record-event-count')).toHaveTextContent('2')

    // Starting the replay is itself a new run (`rewindToTop` + `play`, same
    // as the live take's own start) — this wipes the take's counters BEFORE
    // any replayed note is judged, or they would stack on top of the live
    // take's and could never end up equal to it.
    await user.click(screen.getByRole('button', { name: 'Replay' }))
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')

    // First pump only re-arms the matcher at tick 0 — the recorded note-on
    // (restamped to 50ms after this replay's own anchor) isn't due yet, so
    // nothing is emitted on this frame.
    act(() => manual.pump())
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')

    // Advancing 50ms makes the replay's own frame loop emit the recorded
    // note-on (and only that — the note-off is still 50ms further out, and
    // the recording's own trailing silence keeps the whole replay from ending
    // on this frame) through the fan-out. `midiInput.emit` is never called
    // again in this test, so this can only be the recorder's replayed event
    // reaching feedback.
    act(() => {
      clock.advance(50)
      manual.pump()
    })
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
  })
})
