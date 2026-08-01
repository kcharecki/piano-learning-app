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

function manualDriver(): { driver: FrameDriver; pump: () => void } {
  let callback: (() => void) | undefined
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      callback = undefined
    }
  }
  return { driver, pump: () => callback?.() }
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

  it('shows live note feedback (REQ-3.3.2) and clears it when the transport stops', async () => {
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

    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('0')
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('100%')
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

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Pause' }))

    // Still running: neither click actually stopped or paused the transport,
    // so the Play button — disabled only while playing/waiting — stays disabled.
    expect(screen.getByText(/assessment running/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
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
})
