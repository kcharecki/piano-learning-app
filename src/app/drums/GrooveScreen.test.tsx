/**
 * `GrooveScreen` (roadmap DR-09): a thin render/wiring test over
 * `useGrooveDrill` — the transport, the grading and the pad-swap logic all
 * have their own suite in `useGrooveDrill.test.ts`. This only proves the
 * screen renders what the hook reports, that Start/Stop actually drives it,
 * and that both input paths (pointer and keyboard) reach `drill.hit`.
 *
 * `useDrumsHistoryStore` is a module singleton the screen reads
 * (`drill.lastAttempt`), so it is reset in `beforeEach` even though no test
 * here inspects it directly.
 *
 * The default groove is `Quarter-Note Rock` now (`referenceGrooves` orders
 * easiest-first and the hook opens on `grooves[0]`), not `Money Beat` — see
 * `useGrooveDrill.ts`'s own module comment. Both grooves happen to use the
 * same three pads (hi-hat, snare, kick) at the same tempo/tolerance/timing,
 * which is why `RUN_LENGTH_MS` below is unchanged from before that switch.
 *
 * The panel-review defects below are each one test, named for the defect,
 * plus the existing render/wiring tests adapted for the hi-hat/snare key
 * swap and the Quarter-Note Rock default.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { TIMING_CAVEAT } from '@core/drums/practice/attempt.ts'
import { grooveToleranceMs } from '@core/drums/practice/grooveGrader.ts'
import { referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { GrooveScreen } from './GrooveScreen.tsx'

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

/** Quarter-Note Rock (the default groove) at 80bpm: 3000ms count-in + two 3000ms graded bars + a 100ms tolerance tail. */
const RUN_LENGTH_MS = 9100

function renderScreen() {
  const clock = new FakeClock()
  const audioOutput = new RecordingAudioOutput(clock)
  const manual = manualDriver()
  render(<GrooveScreen clock={clock} audioOutput={audioOutput} frameDriver={manual.driver} date={clock} />)
  return { clock, audioOutput, manual }
}

/**
 * Plays every note of the default groove (Quarter-Note Rock, 2 repeats,
 * 80bpm) exactly on time via the window-level key bindings, so the run
 * finishes `steady`. Onset offsets from `origin` are `countInMs` (3000) plus
 * each note's own tick converted at 80bpm (1.5625 ms/tick) — see
 * `referenceGrooves.ts`'s `quarterHatRock` for the notes this walks.
 */
function playDefaultGrooveSteadily(clock: FakeClock): void {
  const hits: ReadonlyArray<{ readonly atMs: number; readonly code: string }> = [
    { atMs: 3000, code: 'KeyJ' },
    { atMs: 3000, code: 'Space' },
    { atMs: 3750, code: 'KeyJ' },
    { atMs: 3750, code: 'KeyF' },
    { atMs: 4500, code: 'KeyJ' },
    { atMs: 4500, code: 'Space' },
    { atMs: 5250, code: 'KeyJ' },
    { atMs: 5250, code: 'KeyF' },
    { atMs: 6000, code: 'KeyJ' },
    { atMs: 6000, code: 'Space' },
    { atMs: 6750, code: 'KeyJ' },
    { atMs: 6750, code: 'KeyF' },
    { atMs: 7500, code: 'KeyJ' },
    { atMs: 7500, code: 'Space' },
    { atMs: 8250, code: 'KeyJ' },
    { atMs: 8250, code: 'KeyF' },
  ]
  let elapsed = 0
  for (const h of hits) {
    act(() => clock.advance(h.atMs - elapsed))
    elapsed = h.atMs
    fireEvent.keyDown(window, { code: h.code })
  }
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

afterEach(() => {
  cleanup()
})

describe('GrooveScreen', () => {
  it('renders the heading, the groove name, the tempo spinbutton and a Start button', () => {
    renderScreen()

    expect(screen.getByRole('heading', { name: 'Groove trainer' })).toBeInTheDocument()
    expect(screen.getByText('Quarter-Note Rock')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(80)
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('renders one pad button per pad the groove uses, named for that pad', () => {
    renderScreen()

    expect(screen.getByRole('button', { name: 'Hi-hat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Snare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kick' })).toBeInTheDocument()
    // Quarter-Note Rock never asks for the open hi-hat, so no pad button for it exists.
    expect(screen.queryByRole('button', { name: 'Open hi-hat' })).not.toBeInTheDocument()
  })

  it('clicking Start swaps the transport to Stop, and the run state moves from count-in to playing', () => {
    const { clock, manual } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    const runState = screen.getByRole('status', { name: 'Run state' })
    expect(runState).toHaveTextContent(/count in/i)

    act(() => {
      clock.advance(3000)
      manual.pump()
    })

    expect(runState).toHaveTextContent(/playing/i)
  })

  it('a pointerdown on a pad during a run is recorded — the pad flashes', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    const hiHatPad = screen.getByRole('button', { name: 'Hi-hat' })
    expect(hiHatPad.querySelector('.groove-pad-flash')).toBeNull()

    fireEvent.pointerDown(hiHatPad)

    expect(hiHatPad.querySelector('.groove-pad-flash')).not.toBeNull()
  })

  it('the J, F and Space keys register hi-hat, snare and kick hits during a run', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    const hiHatPad = screen.getByRole('button', { name: 'Hi-hat' })
    const snarePad = screen.getByRole('button', { name: 'Snare' })
    const kickPad = screen.getByRole('button', { name: 'Kick' })

    fireEvent.keyDown(window, { code: 'KeyJ' })
    fireEvent.keyDown(window, { code: 'KeyF' })
    fireEvent.keyDown(window, { code: 'Space' })

    expect(hiHatPad.querySelector('.groove-pad-flash')).not.toBeNull()
    expect(snarePad.querySelector('.groove-pad-flash')).not.toBeNull()
    expect(kickPad.querySelector('.groove-pad-flash')).not.toBeNull()
  })

  it('shows a "Result" region only once a run has finished', () => {
    const { clock, manual } = renderScreen()

    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument()

    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
  })

  // ---------- Panel-review defects, one test each ----------

  it('defect 1: Space is not stolen by a focused pad — Enter still activates it', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    const hiHatPad = screen.getByRole('button', { name: 'Hi-hat' })
    const kickPad = screen.getByRole('button', { name: 'Kick' })
    hiHatPad.focus()
    expect(hiHatPad).toHaveFocus()

    fireEvent.keyDown(window, { code: 'Space', key: ' ' })

    expect(kickPad.querySelector('.groove-pad-flash')).not.toBeNull()
    expect(hiHatPad.querySelector('.groove-pad-flash')).toBeNull()

    // Enter still activates whichever pad has focus.
    fireEvent.keyDown(hiHatPad, { key: 'Enter' })
    expect(hiHatPad.querySelector('.groove-pad-flash')).not.toBeNull()
  })

  it('defect 2: the key hint and each pad agree with the hi-hat/snare swap (J = hi-hat/right hand, F = snare/left hand)', () => {
    renderScreen()

    const hint = screen.getByText(/^Keys:/)
    expect(hint).toHaveTextContent('J hi-hat')
    expect(hint).toHaveTextContent('F snare')
    expect(hint).not.toHaveTextContent('F hi-hat')
    expect(hint).not.toHaveTextContent('J snare')

    const hiHatPad = screen.getByRole('button', { name: 'Hi-hat' })
    const snarePad = screen.getByRole('button', { name: 'Snare' })
    const kickPad = screen.getByRole('button', { name: 'Kick' })

    expect(hiHatPad.querySelector('.groove-pad-key')).toHaveTextContent('J')
    expect(snarePad.querySelector('.groove-pad-key')).toHaveTextContent('F')
    expect(hiHatPad).toHaveAccessibleDescription(/right hand/i)
    expect(snarePad).toHaveAccessibleDescription(/left hand/i)
    expect(kickPad).toHaveAccessibleDescription(/right foot/i)

    // And the binding is functional, not just labelled.
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    fireEvent.keyDown(window, { code: 'KeyJ' })
    fireEvent.keyDown(window, { code: 'KeyF' })
    expect(hiHatPad.querySelector('.groove-pad-flash')).not.toBeNull()
    expect(snarePad.querySelector('.groove-pad-flash')).not.toBeNull()
  })

  it('defect 3: the timing caveat is rendered once a run has finished, next to the result numbers', () => {
    const { clock, manual } = renderScreen()

    expect(screen.queryByText(TIMING_CAVEAT)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    const result = screen.getByRole('region', { name: 'Result' })
    expect(within(result).getByText(TIMING_CAVEAT)).toBeInTheDocument()
  })

  it('defect 4: the word "clean" never appears, in any state — the verdict comes from verdictText', () => {
    const { clock, manual } = renderScreen()
    expect(document.body.textContent).not.toMatch(/clean/i)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(document.body.textContent).not.toMatch(/clean/i)

    act(() => {
      clock.advance(3000)
      manual.pump()
    })
    expect(document.body.textContent).not.toMatch(/clean/i)

    act(() => {
      clock.advance(RUN_LENGTH_MS - 3000)
      manual.pump()
    })
    expect(document.body.textContent).not.toMatch(/clean/i)
    // A run with no hits at all is "Not there yet", not a clean/not-clean binary.
    expect(screen.getByText('Not there yet')).toBeInTheDocument()
  })

  it('defect 5a: the subtitle prints the tolerance the hook actually derived, not a hardcoded 100 — as the finest drum\'s own window', () => {
    renderScreen()

    const defaultGroove = referenceGrooves()[0]
    if (defaultGroove === undefined) throw new Error('no default groove bundled')
    const expectedToleranceMs = grooveToleranceMs(defaultGroove, 80, 2)

    const subtitle = screen.getByText(/finest drum in this pattern/i)
    expect(subtitle).toHaveTextContent(`${expectedToleranceMs} ms`)
  })

  it('the subtitle says each DRUM is timed on its own, not "limb" — two hi-hat rows are one hand, and the hi-hat pedal has no pad at all', () => {
    renderScreen()

    const subtitle = screen.getByText(/each drum is timed on its own/i)
    expect(subtitle).not.toHaveTextContent(/limb/i)
  })

  it('the ghost-note disclosure renders only for a groove that notates ghost notes, and says plainly they are not graded', () => {
    renderScreen()

    // Quarter-Note Rock (the default groove) has no ghost notes.
    expect(
      screen.queryByText('This trainer hears when you hit, not how hard — the ghost notes are notated but not graded.'),
    ).not.toBeInTheDocument()

    // Step to Ghost Funk Bar: quarter-hat-rock -> money-beat -> money-beat-open-hat -> ghost-funk-bar.
    const nextGroove = screen.getByRole('button', { name: 'Next groove' })
    fireEvent.click(nextGroove)
    fireEvent.click(nextGroove)
    fireEvent.click(nextGroove)
    expect(screen.getByText('Ghost Funk Bar')).toBeInTheDocument()

    // The notation still says ghost notes are taught — that mention is not deleted.
    expect(screen.getByText(/teaches:.*ghost notes/i)).toBeInTheDocument()
    // But right below it, in the learner's own words, the app admits it cannot grade them.
    expect(
      screen.getByText('This trainer hears when you hit, not how hard — the ghost notes are notated but not graded.'),
    ).toBeInTheDocument()
  })

  it('defect 5b: a repeats control offers repeatChoices and calls setRepeats', () => {
    renderScreen()

    const group = screen.getByRole('group', { name: 'Repeats' })
    expect(within(group).getByText('2')).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: 'More repeats' }))
    expect(within(group).getByText('4')).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: 'More repeats' }))
    expect(within(group).getByText('8')).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'More repeats' })).toBeDisabled()
  })

  it('defect 5c: an unsteady run that was actually played suggests a concrete slower tempo, and the suggestion sets it', () => {
    const { clock, manual } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => clock.advance(3000))
    // One on-time hi-hat hit — attempted, but nowhere near complete, so !steady.
    fireEvent.keyDown(window, { code: 'KeyJ' })
    act(() => {
      clock.advance(RUN_LENGTH_MS - 3000)
      manual.pump()
    })

    // 80bpm, 20% slower, rounded: 64bpm.
    const suggestion = screen.getByRole('button', { name: /64 bpm/i })
    fireEvent.click(suggestion)

    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(64)
  })

  it('teacher-seat finding: a run with NOTHING played says so, instead of prescribing "slower" — and offers no tempo control', () => {
    const { clock, manual } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      // No hits at all: nothing matched on any pad.
      clock.advance(RUN_LENGTH_MS)
      manual.pump()
    })

    expect(screen.getByText('Not there yet')).toBeInTheDocument()
    expect(
      screen.getByText('Nothing registered on any pad this run — try the pattern before changing the tempo.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/uneven pulse/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /bpm/i })).not.toBeInTheDocument()
  })

  it('defect 5c: a steady run offers a faster tempo instead of a slow-down suggestion', () => {
    const { clock, manual } = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    playDefaultGrooveSteadily(clock)
    act(() => {
      clock.advance(RUN_LENGTH_MS - 8250)
      manual.pump()
    })

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Steady run')).toBeInTheDocument()
    expect(screen.queryByText(/uneven pulse/i)).not.toBeInTheDocument()

    // 80bpm, 20% faster, rounded: 96bpm.
    const suggestion = screen.getByRole('button', { name: /96 bpm/i })
    fireEvent.click(suggestion)

    expect(screen.getByRole('spinbutton', { name: /tempo/i })).toHaveValue(96)
  })

  it('teacher-seat finding: Space does not get stolen from a focused non-pad button — Start still activates on it', () => {
    renderScreen()
    const startButton = screen.getByRole('button', { name: 'Start' })
    const kickPad = screen.getByRole('button', { name: 'Kick' })
    startButton.focus()
    expect(startButton).toHaveFocus()

    // Dispatched on the focused button itself (not window) so `event.target`
    // is what it would be in a real browser — bubbling preserves the target,
    // it does not rewrite it to `window`.
    const notPrevented = fireEvent.keyDown(startButton, { code: 'Space', key: ' ' })

    expect(notPrevented).toBe(true)
    expect(kickPad.querySelector('.groove-pad-flash')).toBeNull()
  })
})
