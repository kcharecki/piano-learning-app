/**
 * Screen-level composition for the clap-back drill (roadmap 3.21/5.21,
 * REQ-3.6.2; redesigned as a tap instrument roadmap UI-14). Per-hook
 * behaviour is covered by `useClapbackDrill.test.ts`; this file's one
 * load-bearing job is the proof the task exists to make: *the notation is
 * genuinely absent from the DOM* during listening and tapping — not merely
 * visually hidden — because a learner who can read the answer off the screen
 * is doing sight-reading again. This file does not mock `ScoreViewer`
 * (unlike `RhythmScreen.test.tsx`) because `RhythmClapback` and
 * `useClapbackDrill` never import it at all — asserting its absence from the
 * DOM is the real test, not a substitute for one.
 */
import { seededRng } from '@core/ports/rng.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { RhythmClapback } from './RhythmClapback.tsx'

afterEach(cleanup)
// `RhythmClapback` now sources its level from the shared ear-training session
// store (MAJOR-1 review fix, `useClapbackDrill.ts`) — reset it before every
// test so the "starts at Level 1" assertions below never see another test's
// leftover level.
beforeEach(() => {
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
})

/** Fixed 2 bars, 120bpm default tempo (`RhythmClapback`'s own `BARS` constant). */
const RUN_LENGTH_MS = 2 * 2000

/** The listening-phase tap pad's static accessible name. */
const LISTEN_PAD_NAME = 'Listen — a rhythm phrase is playing'
/** The tapping-phase tap pad's accessible name — deliberately starts with
 *  "Tap" so `e2e/metronome-drills.spec.ts`'s existing substring lookup for
 *  the sight-tap drill's own pad (a file this task may not edit) stays
 *  unambiguous: only one control anywhere in either mode's DOM ever contains
 *  "tap" in its accessible name at once, since listening and tapping never
 *  render simultaneously. */
const TAP_PAD_NAME = 'Now clap it back — or press Space'

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

/** No score container, no OSMD-authored note element — anywhere in the
 *  rendered tree. Asserted on presence/absence, never on visibility/opacity,
 *  which is exactly the distinction the task brief calls out as the part
 *  that "quietly fails".
 *
 *  The blanket "no <svg> anywhere" version of this check (pre-roadmap UI-14)
 *  is gone: this screen now legitimately renders decorative icons (the Start
 *  button's play glyph, the tap pad's per-hit checkmark flash) via the design
 *  system's `Icon` component, each a small `aria-hidden` `<svg>`. The
 *  replacement is stricter about what actually matters — an OSMD-rendered
 *  score is never `aria-hidden` (it is the primary content) — so any `<svg>`
 *  that is NOT `aria-hidden` still fails this exactly as before. */
function assertNoNotationInDom(): void {
  expect(screen.queryByTestId('score-container')).not.toBeInTheDocument()
  expect(document.querySelector('[data-note-id]')).toBeNull()
  document.querySelectorAll('svg').forEach((svg) => {
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
}

describe('RhythmClapback', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    // Roadmap UI-14: `MidiDeviceStatus` (and its "No MIDI keyboard connected"
    // copy) is no longer rendered here at all — roadmap UI-04b already moved
    // that status into the shell's topbar input-status chip for every other
    // note-answered screen; this was the last of the seven still rendering it
    // in-flow, out of that task's file list. This screen's own job is simply
    // to stay usable with no MIDI connected, which it does — Start still
    // works with no keyboard.
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<RhythmClapback connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.queryByText(/no MIDI keyboard connected/i)).not.toBeInTheDocument()
  })

  it('the tap pad does not exist before a run starts', () => {
    render(<RhythmClapback midiInput={new FakeMidiInput()} rng={seededRng(1)} />)
    expect(screen.queryByRole('button', { name: TAP_PAD_NAME })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: LISTEN_PAD_NAME })).not.toBeInTheDocument()
  })

  it('the pattern is heard and never shown: no notation exists in the DOM through listening, tapping, or graded', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={midiInput}
        audioOutput={audioOutput}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )
    assertNoNotationInDom()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByTestId('clapback-listening-status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: LISTEN_PAD_NAME })).toBeDisabled()
    assertNoNotationInDom()

    // Listening ends and hands off to tapping automatically.
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    expect(screen.getByTestId('clapback-tapping-status')).toBeInTheDocument()
    assertNoNotationInDom()

    const tapPad = screen.getByRole('button', { name: TAP_PAD_NAME })
    expect(tapPad).toBeEnabled()
    await user.click(tapPad)
    expect(screen.getByTestId('clapback-tap-count')).toHaveTextContent('1')
    assertNoNotationInDom()

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    expect(screen.getByTestId('clapback-accuracy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Again' })).toBeInTheDocument()
    assertNoNotationInDom()
  })

  it('the tap pad responds identically to a click and to Space while tapping (roadmap UI-14)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    const tapPad = screen.getByRole('button', { name: TAP_PAD_NAME })
    await user.click(tapPad)
    await user.click(tapPad)
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'Space' })

    expect(screen.getByTestId('clapback-tap-count')).toHaveTextContent('4')
  })

  it('the pattern is heard, for real: listening dispatches real note-on calls, not silence', () => {
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={audioOutput}
        rng={seededRng(3)}
        frameDriver={manual.driver}
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'Start' }).click()
    })
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(audioOutput.calls.some((c) => c.kind === 'noteOn')).toBe(true)
  })

  it('running a full drill through to the end shows the real grade and an Again button', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    const tapPad = screen.getByRole('button', { name: TAP_PAD_NAME })
    await user.click(tapPad)

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByTestId('clapback-matched')).toBeInTheDocument()
    expect(screen.getByTestId('clapback-missed')).toBeInTheDocument()
    expect(screen.getByTestId('clapback-extra')).toBeInTheDocument()
    expect(screen.getByTestId('clapback-accuracy')).toHaveTextContent(/^\d+%$/)
    expect(screen.getByTestId('clapback-deviation')).toHaveTextContent(/^\d+ms$/)
    const matched = Number(screen.getByTestId('clapback-matched').textContent)
    const extra = Number(screen.getByTestId('clapback-extra').textContent)
    expect(matched + extra).toBe(1)
    expect(screen.getByRole('button', { name: 'Again' })).toBeInTheDocument()
  })

  it('changing level is reflected immediately, and locked while listening or tapping', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(1)}
      />,
    )

    expect(screen.getByTestId('clapback-level')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: 'Increase level' }))
    expect(screen.getByTestId('clapback-level')).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: 'Start' }))

    // Progressive disclosure (rule 2): the idle configuration card — the
    // level stepper included — is not rendered at all once a run is live.
    expect(screen.queryByRole('button', { name: 'Increase level' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decrease level' })).not.toBeInTheDocument()
  })

  // MAJOR-1 review fix: the level used to be plain `useState(MIN_LEVEL)` —
  // reset to Level 1 on every mount, no matter what the learner had reached.
  // It is now sourced from `useEarTrainingStore` (`useClapbackDrill.ts`'s own
  // module doc, "Level" section), so a fresh mount of the SAME component
  // picks the level back up instead of resetting it.
  it('the level survives an unmount and remount — it no longer resets to Level 1', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const { unmount } = render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(1)}
      />,
    )
    expect(screen.getByTestId('clapback-level')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: 'Increase level' }))
    await user.click(screen.getByRole('button', { name: 'Increase level' }))
    expect(screen.getByTestId('clapback-level')).toHaveTextContent('3')

    unmount()
    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={new RecordingAudioOutput(clock)}
        rng={seededRng(1)}
      />,
    )

    expect(screen.getByTestId('clapback-level')).toHaveTextContent('3')
  })

  it('the metronome checkbox is on by default and only sounds during tapping, never listening', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const manual = manualDriver()
    const audioOutput = new RecordingAudioOutput(clock)

    render(
      <RhythmClapback
        clock={clock}
        midiInput={new FakeMidiInput()}
        audioOutput={audioOutput}
        rng={seededRng(7)}
        frameDriver={manual.driver}
      />,
    )
    expect(screen.getByRole('checkbox', { name: /Metronome click/i })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
    })
    // Still within the listening run at this point in wall time — no clicks yet.
    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(0)

    act(() => manual.pump())
    expect(screen.getByTestId('clapback-tapping-status')).toBeInTheDocument()

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })
    expect(audioOutput.calls.filter((c) => c.kind === 'click').length).toBeGreaterThan(0)
  })
})
