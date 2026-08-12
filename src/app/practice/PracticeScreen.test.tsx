/**
 * Screen-level composition (roadmap 1.18): the store, the engine and every
 * control are wired together correctly, and the screen renders — and stays
 * usable — with no MIDI keyboard connected. Per-control behaviour is already
 * covered by each control's own test file; this only asserts the wiring
 * between them.
 */
import { useLevelStore } from '@app/state/levelStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { C_MAJOR_SCALE_RH } from '@test/fixtures.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { measureRange } from '@core/notation/score.ts'
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
//
// `moveCursorToSpy` is hoisted so both the mock factory (which runs before
// this module's own top-level code, per `vi.mock`'s hoisting) and the tests
// below can share the exact same function identity — it is what the
// roadmap-2.20a stop-cursor test reads to prove `PracticeScreen` moves the
// cursor through this RAW handle, not through `useNoteFeedback`'s
// intercepting `cursorRef`.
// `setNoteHiddenSpy`/`clearHiddenNotesSpy` (roadmap 2.26 finding 6): real
// `vi.fn()` spies, not the inert `() => {}` stubs this mock used to carry —
// those would leave `useReadAhead` wired to nothing observable, so a screen
// that dropped `<ReadAheadControl>` or hardcoded `enabled: false` would still
// pass every other test in this file.
const { moveCursorToSpy, setNoteHiddenSpy, clearHiddenNotesSpy } = vi.hoisted(() => ({
  moveCursorToSpy: vi.fn(),
  setNoteHiddenSpy: vi.fn(),
  clearHiddenNotesSpy: vi.fn(),
}))
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: forwardRef(function MockScoreViewer(
    _props: { readonly musicXml: string },
    ref: React.ForwardedRef<ScoreViewerHandle>,
  ) {
    useImperativeHandle(ref, () => ({
      moveCursorTo: moveCursorToSpy,
      setNoteColor: () => {},
      clearNoteColors: () => {},
      setNoteHidden: setNoteHiddenSpy,
      clearHiddenNotes: clearHiddenNotesSpy,
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
  // Every test in this file except the "progressive disclosure" describe
  // block below (roadmap 5.17) predates the level gate and exercises wait
  // mode/assessment/read-ahead/annotations directly — hydrated at a level
  // past both thresholds so those tests see the same screen they always did.
  // The gate's own tests set the level explicitly, the way ScoreScreen.test's
  // `setTheoryLevel` does for its own gate (roadmap 3.18).
  useLevelStore.setState({
    levelState: { ...initialLevelState(), levels: { ...initialLevelState().levels, playing: 3 } },
    hydrated: true,
  })
}

/** Seeds the `playing` track to `level` directly, the way roadmap 3.18's
 *  unit tests are asked to: through the store, not through a UI flow (that
 *  is what e2e/round6.spec.ts is for). `undefined` sets `hydrated: false`
 *  instead, for the hydration-race case. */
function setPlayingLevel(level: number | undefined): void {
  const current = useLevelStore.getState().levelState
  useLevelStore.setState({
    levelState: { ...current, levels: { ...current.levels, playing: level ?? current.levels.playing } },
    hydrated: level !== undefined,
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
  moveCursorToSpy.mockClear()
  setNoteHiddenSpy.mockClear()
  clearHiddenNotesSpy.mockClear()
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
    // Roadmap 5.4: "usable" has to mean PLAYABLE, not just readable — without
    // a keyboard on screen there is no way to enter a note on this browser.
    expect(screen.getByRole('group', { name: 'Play the score' })).toBeInTheDocument()
  })

  it('shows the on-screen keyboard when Web MIDI works but NO keyboard is plugged in (roadmap 5.4)', () => {
    // The commonest no-hardware case, and the one an "is the Web MIDI API
    // present" check gets wrong: on Chrome with permission granted and nothing
    // plugged in, `midi.input` EXISTS and the device list is empty. Keying the
    // default off the input would leave this learner with no way to play at
    // all, on the browser most of them are using.
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput([])} />)

    expect(screen.getByText(/^No MIDI keyboard connected/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Play the score' })).toBeInTheDocument()
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
    const cssPath = join(process.cwd(), 'src', 'design-system', 'css', 'domain.css')
    const css = readFileSync(cssPath, 'utf-8')
    const ruleMatch = /\.practice-controls\s*\{([^}]*)\}/.exec(css)
    invariant(ruleMatch !== null, '.practice-controls rule missing from domain.css')
    const rule = at(ruleMatch, 1)

    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/top:\s*0/)
    expect(rule).toMatch(/background:\s*var\(--bg-1\)/)
    expect(rule).toMatch(/z-index:\s*var\(--z-sticky\)/)
  })

  // Kills a mutant that hardcodes `canRecord` to `true` (or drops the prop,
  // which defaults RecordPanel's own `disabled` check to enabled) — Record
  // must actually reflect whether the learner has any way to play.
  //
  // Roadmap 5.4 CHANGED what that means. It used to be "is a MIDI keyboard
  // connected"; with the on-screen keyboard it is "is there a device OR a
  // visible on-screen keyboard", because on-screen notes now go through the
  // same input and record identically. With no device the keyboard is shown by
  // default, so Record is enabled — the case that must stay disabled is the
  // one where the learner has hidden it and has no device either.
  it('disables Record only when there is neither a device nor an on-screen keyboard (roadmap 5.4)', async () => {
    loadSampleScore()
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<PracticeScreen connectMidi={neverResolves} />)

    // No device, keyboard shown by default: playable, therefore recordable.
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled()

    await userEvent.click(screen.getByRole('checkbox', { name: /on-screen keyboard/i }))

    expect(screen.queryByRole('group', { name: 'Play the score' })).not.toBeInTheDocument()
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

  // Roadmap 2.20a: after Stop, the score cursor must land where the
  // transport actually stopped, not stay wherever it last was while the
  // position readout has already rewound to bar 1. The obvious fix — moving
  // the cursor from inside `usePracticeEngine.stop()` through
  // `feedback.cursorRef` (the ref `usePracticeEngine` is actually given,
  // above) — was reverted: that ref reads ANY backward cursor move as a loop
  // wrap and resets `useNoteFeedback`'s matcher, wiping the run's counters.
  // This is the regression guard for exactly that: a test that only checked
  // the cursor moved would still pass the broken implementation.
  it('Stop moves the score cursor through the RAW handle to the rewound position, without resetting the note-feedback counters (roadmap 2.20a)', async () => {
    loadSampleScoreWithMusicXml()
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
    act(() => manual.pump()) // parks the cursor on tick 0, arming the matcher

    // C_MAJOR_SCALE_RH's first note is C4 (60) at tick 0.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')

    act(() => {
      clock.advance(700) // well off tick 0, so a real rewind is observable
      manual.pump()
    })

    // Only the call Stop itself makes matters here — clear out every prior
    // forwarded call from `useNoteFeedback`'s interception during the pumps
    // above.
    moveCursorToSpy.mockClear()

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    // The cursor was moved, through the raw handle, to exactly where the
    // transport's playhead landed: tick 0, measure index 0 (no loop armed).
    expect(moveCursorToSpy).toHaveBeenCalledWith(0, 0)

    // The regression guard: the run's counters survive the stop. If the
    // naive fix (routing this move through `feedback.cursorRef`) were used
    // instead, the backward jump to tick 0 would read as a loop wrap and
    // reset the matcher, wiping this to 0.
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('1')
  })

  // Kills the mutant that hardcodes `handleStop` to
  // `scoreViewerRef.current?.moveCursorTo(0, 0)` regardless of `at`: with a
  // loop armed, `Transport.stop()` rewinds to `loopRange.startTick`, not tick
  // 0, so the cursor must follow it there.
  it('Stop with a loop armed moves the score cursor to the loop start, not bar 1 (roadmap 2.20a)', async () => {
    loadSampleScoreWithMusicXml()
    const loop = measureRange(C_MAJOR_SCALE_RH, 1, 1) // second measure: tick 1920
    useScoreStore.setState((prev) => ({
      settings: { ...prev.settings, loop },
    }))
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
    act(() => {
      clock.advance(2200) // into the loop, off its start tick
      manual.pump()
    })

    moveCursorToSpy.mockClear()

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(moveCursorToSpy).toHaveBeenCalledWith(1, loop.startTick)
  })

  // Roadmap 2.26 finding 6 (test-coverage gap): nothing previously proved
  // `ReadAheadControl` is actually rendered and wired to `useReadAhead` with a
  // real `currentMeasureIndex`/`scoreViewerRef` — stubbing
  // `currentMeasureIndex: 0`, dropping `<ReadAheadControl>`, or hardcoding
  // `enabled: false` would have left the whole suite green. Checking the box
  // while the cursor sits at rest (measure 1, i.e. index 0) hides nothing —
  // that's the scope change in `useReadAhead` (there's no measure before the
  // first one) — so playback is advanced past the first measure boundary
  // BEFORE the checkbox is checked, which gives `useReadAhead` a real,
  // non-empty measure-0 to hide once read-ahead turns on.
  it('wires the Read ahead control to the real score viewer, not a stub (roadmap 2.26)', async () => {
    loadSampleScoreWithMusicXml()
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

    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => manual.pump()) // parks the cursor on tick 0, measure 1

    // C_MAJOR_SCALE_RH is two 4-note measures at 120bpm (500ms/quarter) — past
    // 2000ms puts the cursor in measure 2, so measure 1 (index 0) is now
    // strictly behind it.
    act(() => {
      clock.advance(2100)
      manual.pump()
    })

    await user.click(screen.getByRole('checkbox', { name: 'Read ahead' }))

    expect(setNoteHiddenSpy.mock.calls.some(([, hidden]) => hidden === true)).toBe(true)
  })
})

// Roadmap 5.17: progressive disclosure gated by the `playing` track's level.
describe('PracticeScreen — progressive disclosure by track level (roadmap 5.17)', () => {
  it('hides wait mode and "More tools" at level 1 — ABSENT, not merely collapsed', () => {
    setPlayingLevel(1)
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    // Base controls a level-1 learner keeps: transport, tempo, hands, metronome.
    expect(screen.getByRole('group', { name: 'Transport' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tempo')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Right hand only' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeInTheDocument()

    // The gated tiers: absent from the DOM entirely, not just closed inside
    // a <details> — queryBy* (not getBy*/queryAllBy*) is the failure signal
    // for "still rendered, just collapsed".
    expect(screen.queryByRole('checkbox', { name: 'Wait for me' })).not.toBeInTheDocument()
    expect(screen.queryByText('More tools')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start assessment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Read ahead' })).not.toBeInTheDocument()
  })

  it('reveals wait mode once the level reaches MIN_WAIT_MODE_LEVEL, "More tools" still absent', () => {
    setPlayingLevel(2)
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    expect(screen.getByRole('checkbox', { name: 'Wait for me' })).toBeInTheDocument()
    expect(screen.queryByText('More tools')).not.toBeInTheDocument()
  })

  it('reveals "More tools" — collapsed by default — once the level reaches MIN_ADVANCED_TOOLS_LEVEL', async () => {
    setPlayingLevel(3)
    loadSampleScore()
    const user = userEvent.setup()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const summary = screen.getByText('More tools')
    // Collapsed by default (roadmap 5.12/3.18a's `<details>` convention) —
    // its content exists in the DOM (findable by role) but the disclosure
    // itself is closed.
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Start assessment' })).toBeInTheDocument()

    await user.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
  })

  it('stays hidden while the level restore is still in flight, even at a qualifying level (no flash, roadmap 3.18 pattern)', () => {
    useLevelStore.setState({
      levelState: { ...initialLevelState(), levels: { ...initialLevelState().levels, playing: 3 } },
      hydrated: false,
    })
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    expect(screen.queryByRole('checkbox', { name: 'Wait for me' })).not.toBeInTheDocument()
    expect(screen.queryByText('More tools')).not.toBeInTheDocument()
  })

  it('keeps an already-enabled Read ahead control on screen after a level drop, rather than orphaning it on', async () => {
    setPlayingLevel(3)
    loadSampleScoreWithMusicXml()
    const user = userEvent.setup()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    await user.click(screen.getByText('More tools'))
    await user.click(screen.getByRole('checkbox', { name: 'Read ahead' }))
    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).toBeChecked()

    act(() => setPlayingLevel(1))

    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).toBeChecked()
  })
})

// Roadmap 5.18: the controls 5.17 left ungated (loop range, hands, metronome,
// wait mode, record/replay) move from five flat top-level siblings into one
// collapsible "Practice setup" section.
describe('PracticeScreen — control hierarchy (roadmap 5.18)', () => {
  it('groups loop range, hand mute, metronome and record/replay inside one "Practice setup" disclosure, open by default', () => {
    setPlayingLevel(3)
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const summary = screen.getByText('Practice setup')
    const section = summary.closest('details')
    expect(section).not.toBeNull()
    // Open by default (unlike "More tools"): these are the controls 5.17
    // already promises a level-1 learner sees without an extra click.
    expect(section).toHaveAttribute('open')

    invariant(section !== null, 'Practice setup <details> must exist')
    expect(section).toContainElement(screen.getByRole('group', { name: 'Loop range' }))
    expect(section).toContainElement(screen.getByRole('radio', { name: 'Right hand only' }))
    expect(section).toContainElement(screen.getByRole('checkbox', { name: 'Metronome' }))
    expect(section).toContainElement(screen.getByRole('group', { name: 'Record and replay' }))
  })

  it('is a real, closable disclosure — not just a styled wrapper', async () => {
    setPlayingLevel(3)
    loadSampleScore()
    const user = userEvent.setup()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const summary = screen.getByText('Practice setup')
    await user.click(summary)
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })

  it('includes wait mode inside "Practice setup" once it is unlocked', () => {
    setPlayingLevel(2)
    loadSampleScore()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const section = screen.getByText('Practice setup').closest('details')
    invariant(section !== null, 'Practice setup <details> must exist')
    expect(section).toContainElement(screen.getByRole('checkbox', { name: 'Wait for me' }))
  })
})

// Roadmap 5.48 (REQ-3.3.2): the matcher judges onset pitch and timing only —
// duration is never scored — and the screen has to say so, reachable from
// Practice in one click.
describe('PracticeScreen — accuracy caveat (roadmap 5.48)', () => {
  it('states the onsets-only limitation behind a one-click, closed-by-default disclosure', async () => {
    loadSampleScore()
    const user = userEvent.setup()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const summary = screen.getByText("What this screen doesn't check")
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    // Closed by default — not a permanent block of prose (roadmap 5.18's own
    // decluttering goal). Native `<details>` keeps its body in the DOM even
    // while closed (the browser hides it at the rendering layer, which is
    // exactly what the `open` attribute check below stands in for here), so
    // this asserts the `open` state rather than the body's DOM presence — the
    // same pattern the "More tools" disclosure (roadmap 5.17) already uses.
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)

    expect(details).toHaveAttribute('open')
    expect(screen.getByText(/not how long you held them/i)).toBeInTheDocument()
    expect(screen.getByText(/hand position, wrist, or posture/i)).toBeInTheDocument()
  })
})

// Roadmap B.3 (REQ-3.2.4's optional half): the falling-note piano roll.
describe('PracticeScreen — piano roll (roadmap B.3)', () => {
  it('is off by default and lives inside "Practice setup", not as a new top-level control', () => {
    loadSampleScoreWithMusicXml()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Piano roll' })
    expect(checkbox).not.toBeChecked()
    const section = screen.getByText('Practice setup').closest('details')
    invariant(section !== null, 'Practice setup <details> must exist')
    expect(section).toContainElement(checkbox)
    expect(screen.queryByTestId('piano-roll')).not.toBeInTheDocument()
  })

  it('renders the roll once toggled on, and removes it when toggled back off', async () => {
    loadSampleScoreWithMusicXml()
    const user = userEvent.setup()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)

    await user.click(screen.getByRole('checkbox', { name: 'Piano roll' }))
    expect(screen.getByTestId('piano-roll')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /piano roll/i })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Piano roll' }))
    expect(screen.queryByTestId('piano-roll')).not.toBeInTheDocument()
  })

  // Design constraint: the roll is meant to sit ABOVE the engraving, never
  // alone — when there is no MusicXML to engrave (`ScoreViewer` itself does
  // not render either, see `loadSampleScore` vs `loadSampleScoreWithMusicXml`
  // above), showing the roll by itself would defeat the "bridge from roll to
  // notation" point, so it stays gated on the exact same condition.
  it('stays hidden when there is no notation to sit above, even with the toggle checked from a prior score', async () => {
    loadSampleScoreWithMusicXml()
    const user = userEvent.setup()
    render(<PracticeScreen midiInput={new FakeMidiInput()} />)
    await user.click(screen.getByRole('checkbox', { name: 'Piano roll' }))
    expect(screen.getByTestId('piano-roll')).toBeInTheDocument()

    act(() => loadSampleScore()) // same score, musicXml now undefined
    expect(screen.queryByTestId('piano-roll')).not.toBeInTheDocument()
  })

  it("advances from the SAME per-frame call that moves the real score cursor — never a second clock", async () => {
    loadSampleScoreWithMusicXml()
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

    await user.click(screen.getByRole('checkbox', { name: 'Piano roll' }))
    // C_MAJOR_SCALE_RH's first note: `m0.r.0.60` (measure 0, right hand, tick
    // 0, C4) — see `score.ts`'s `noteId`. The roll scrolls right-to-left as
    // time advances (a FIXED note's x strictly decreases, see PianoRoll.tsx's
    // module comment), so this is the general, always-true observable —
    // unlike the now-line itself, whose x only moves during the very first
    // frame's clamp-at-tick-0 transition (see PianoRoll.test.tsx).
    const noteRect = () => screen.getByTestId('piano-roll-svg').querySelector('[data-note-id="m0.r.0.60"]')
    const xAtStart = Number(noteRect()?.getAttribute('x'))

    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => {
      clock.advance(700)
      manual.pump()
    })

    // The SAME frame that moved the real score cursor (the mocked
    // `ScoreViewer`'s `moveCursorToSpy`) also moved the roll — proof this is
    // the one existing call site, not an independent timer.
    expect(moveCursorToSpy).toHaveBeenCalled()
    expect(Number(noteRect()?.getAttribute('x'))).toBeLessThan(xAtStart)
  })

  it('Stop moves the roll back to the rewound position too, not just the score cursor (roadmap 2.20a\'s pattern, extended)', async () => {
    loadSampleScoreWithMusicXml()
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

    await user.click(screen.getByRole('checkbox', { name: 'Piano roll' }))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    act(() => {
      clock.advance(700)
      manual.pump()
    })
    // Same note/reasoning as the previous test.
    const noteRect = () => screen.getByTestId('piano-roll-svg').querySelector('[data-note-id="m0.r.0.60"]')
    const xWhilePlaying = Number(noteRect()?.getAttribute('x'))

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    // Stop rewinds the transport to tick 0 — the window follows it back, so
    // the SAME note's x rises back toward where it started.
    expect(Number(noteRect()?.getAttribute('x'))).toBeGreaterThan(xWhilePlaying)
  })
})
