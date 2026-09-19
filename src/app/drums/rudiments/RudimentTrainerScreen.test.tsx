/**
 * `RudimentTrainerScreen` — thin, per the testing rules: what is asserted
 * here is wiring and accessible names (the library's 40 rows across 4 tiers,
 * Practise switching the trainer, the Ladder status reading back
 * `ladderText`), not grading (`rudimentRun.test.ts`) and not ladder timing
 * (`useRudimentTrainer.test.ts`).
 */
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { KEYBOARD_ACCENT_VELOCITY, KEYBOARD_NORMAL_VELOCITY } from '@app/drums/groove/groovePadHooks.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { ekitStatusText } from '@app/drums/input/useDrumMidiInput.ts'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { rudimentToScore } from '@core/drums/rudiment/index.ts'
import { midi, millis } from '@core/shared/units.ts'
import { rudimentById } from '@content/drums/rudiments.ts'
import { barsOf, cyclesForBars } from './rudimentRun.ts'
import { RudimentTrainerScreen, useKeyboardTap } from './RudimentTrainerScreen.tsx'

/**
 * One frame-time tick past a graded window's own close — `useGrooveRun`'s
 * finish check is `now >= gradedOrigin + gradedMs`, and a fake clock jump
 * landing exactly on that boundary is legitimate but leaves nothing to
 * spare, so tests that drive a run to completion add this before reading
 * the result.
 */
const EPSILON_MS = 1

/**
 * The exact onset plan `useRudimentTrainer` itself would build for Single
 * Stroke Roll at its own `bpmBand.start` (60 bpm, `DEFAULT_BARS` = 2) — used
 * below to script a genuinely clean, perfectly even run instead of guessing
 * onset times by hand. Computed the same way the hook does
 * (`cyclesForBars`/`barsOf`/`rudimentToScore`/`planGrooveRun`) rather than
 * duplicated as hardcoded numbers, so a change to any of those stays honest
 * here too.
 */
function singleStrokeRollPlan60bpm() {
  const rudiment = rudimentById('single-stroke-roll')
  if (rudiment === undefined) throw new Error('single-stroke-roll not found in content')
  const cycles = cyclesForBars(rudiment, 2)
  const scoreBars = barsOf(rudiment, cycles)
  const score = rudimentToScore(rudiment, cycles)
  return planGrooveRun(score, rudiment.bpmBand.start, { gradedBars: scoreBars })
}

/**
 * Same idea as `singleStrokeRollPlan60bpm`, for Single Paradiddle (DR-10
 * accents tests below) — the trainer's actual accented rudiment, computed
 * the same way `useRudimentTrainer` does rather than typed by hand.
 */
function singleParadiddlePlan60bpm() {
  const rudiment = rudimentById('single-paradiddle')
  if (rudiment === undefined) throw new Error('single-paradiddle not found in content')
  const cycles = cyclesForBars(rudiment, 2)
  const scoreBars = barsOf(rudiment, cycles)
  const score = rudimentToScore(rudiment, cycles)
  return planGrooveRun(score, rudiment.bpmBand.start, { gradedBars: scoreBars })
}

function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup(opts: { readonly midiInput?: FakeMidiInput } = {}) {
  const clock = new FakeClock()
  const audio = fakeDrumAudio(clock)
  let frame: (() => void) | undefined
  const frameDriver: FrameDriver = (cb) => {
    frame = cb
    return () => {
      frame = undefined
    }
  }
  const user = userEvent.setup()
  render(
    <RudimentTrainerScreen
      clock={clock}
      audio={() => audio}
      frameDriver={frameDriver}
      {...(opts.midiInput === undefined ? {} : { midiInput: opts.midiInput })}
    />,
  )
  return {
    user,
    clock,
    frameAt: (ms: number) =>
      act(() => {
        clock.setTime(ms)
        frame?.()
      }),
  }
}

beforeEach(() => {
  useDrumsRudimentStore.setState({ records: {} })
})

describe('RudimentTrainerScreen', () => {
  it('opens on the Single Stroke Roll, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Rudiments' })).toBeInTheDocument()
    expect(
      screen.getByText('Single Stroke Roll', { selector: '.rudiment-title' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Ladder' })).toHaveTextContent(/at 60 bpm/)
    expect(screen.getByRole('status', { name: 'Run state' })).toHaveTextContent(
      'Ready when you are',
    )
  })

  it('lists all 40 rudiments across the four Wooton tiers', () => {
    setup()
    for (const tier of [1, 2, 3, 4]) {
      expect(screen.getByRole('region', { name: `Tier ${tier}` })).toBeInTheDocument()
    }
    const practiseButtons = screen.getAllByRole('button', { name: /^Practise /i })
    expect(practiseButtons).toHaveLength(40)
  })

  it('Practise switches the trainer to the chosen rudiment', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Practise Single Paradiddle' }))

    expect(
      screen.getByText('Single Paradiddle', { selector: '.rudiment-title' }),
    ).toBeInTheDocument()
    // Single Paradiddle shares tier 1's 60 bpm start with Single Stroke Roll.
    expect(screen.getByRole('status', { name: 'Ladder' })).toHaveTextContent(/at 60 bpm/)
  })

  it('shows the honesty line only for rudiments with a graded-onset-only articulation', async () => {
    const { user } = setup()
    expect(screen.queryByText(/Graded on onset timing only/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Practise Flam' }))
    expect(screen.getByText(/Graded on onset timing only/)).toBeInTheDocument()
  })

  it('shows the personal record on a library row once the store has one', () => {
    useDrumsRudimentStore.setState({
      records: { 'single-stroke-roll': { bestCleanBpm: 92, lastBpm: 90, at: 1 } },
    })
    setup()
    const row = screen.getByRole('button', { name: 'Practise Single Stroke Roll' })
    expect(within(row).getByText('PR 92 bpm')).toBeInTheDocument()
  })

  it('the Ladder mode toggle exposes a radiogroup with Up selected by default', () => {
    setup()
    const group = screen.getByRole('radiogroup', { name: 'Ladder mode' })
    expect(within(group).getByRole('radio', { name: 'Up' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: 'Up then down' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  /**
   * The evenness line (roadmap DR-10) — grading its arithmetic is
   * `rudimentRun.test.ts`'s and `useRudimentTrainer.test.ts`'s job; this only
   * pins that the line actually renders on a finished run, with the exact
   * words `evennessText` builds. The run is tapped onset for onset against
   * the plan the hook itself would build, so the score is a full 100%.
   */
  it('shows the evenness line after a finished run', async () => {
    const { user, frameAt, clock } = setup()
    const plan = singleStrokeRollPlan60bpm()
    const onsets = plan.pads[0]?.expectedMs ?? []
    expect(onsets.length).toBeGreaterThan(0)

    // The plan's OWN `barMs`/`gradedMs`, not the rounded 4000/8000 figure —
    // see the module comment: 60 bpm's ms-per-tick is a repeating decimal,
    // and a fake clock is monotonic, so taps scripted against the plan's
    // real onset times must never be preceded by a frame jump that overshot
    // past them.
    const gradedOrigin = plan.barMs
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(gradedOrigin)

    const pad = screen.getByRole('button', { name: 'Tap' })
    for (const onset of onsets) {
      act(() => {
        clock.setTime(gradedOrigin + onset)
        fireEvent.pointerDown(pad)
      })
    }

    frameAt(gradedOrigin + plan.gradedMs + EPSILON_MS)

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Clean pass')).toBeInTheDocument()
    const evenness = screen.getByText('Evenness 100% — even enough')
    expect(evenness).toHaveClass('rudiment-evenness')
    expect(evenness).toHaveAttribute('data-even', 'true')
  })

  /**
   * A failed pass steps the tempo ladder down, and the verdict must survive
   * that step: an earlier cut keyed the plan's grooveId on the bpm, so
   * `useGrooveRun` retired the result in the same commit it was graded and
   * the learner never saw "Not clean". A silent run has no evenness evidence,
   * so the line is absent rather than reading "100% even".
   */
  it('keeps the verdict on screen after a failed pass steps the tempo down', async () => {
    const { user, frameAt } = setup()
    const plan = singleStrokeRollPlan60bpm()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(plan.barMs)
    frameAt(plan.barMs + plan.gradedMs + EPSILON_MS)

    expect(screen.getByRole('status', { name: 'Ladder' })).toHaveTextContent(/next 55/)
    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Not clean')).toBeInTheDocument()
    expect(screen.getByText('Graded at 60 bpm')).toBeInTheDocument()
    expect(screen.queryByText(/Evenness/)).not.toBeInTheDocument()
  })
})

/**
 * `useKeyboardTap`'s own velocity wiring (DR-10 accents) — pinned in
 * isolation with `renderHook`/a spy, the same shape
 * `groovePadHooks.test.ts`'s `useKeyboardPads` suite uses, rather than
 * inferred from a full screen render: this is the one seam that decides
 * which velocity a keyboard tap carries, and a spy names it directly instead
 * of relying on a downstream grading verdict.
 */
function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

function mountKeyboardTap(tap: (velocity?: number) => void, running = true): void {
  renderHook(() => useKeyboardTap(tap, running))
}

describe('useKeyboardTap: velocity modifiers (DR-10 accents)', () => {
  it('a plain key press calls tap with KEYBOARD_NORMAL_VELOCITY', () => {
    const tap = vi.fn()
    mountKeyboardTap(tap)
    press('f')
    expect(tap).toHaveBeenCalledExactlyOnceWith(KEYBOARD_NORMAL_VELOCITY)
  })

  it('Shift+letter calls tap with KEYBOARD_ACCENT_VELOCITY — event.key arrives as the uppercase letter (Shift+f -> "F")', () => {
    const tap = vi.fn()
    mountKeyboardTap(tap)
    press('F', { shiftKey: true })
    expect(tap).toHaveBeenCalledExactlyOnceWith(KEYBOARD_ACCENT_VELOCITY)
  })

  it('Shift held alone is excluded — never itself a tap', () => {
    const tap = vi.fn()
    mountKeyboardTap(tap)
    press('Shift', { shiftKey: true })
    expect(tap).not.toHaveBeenCalled()
  })
})

describe('RudimentTrainerScreen — DR-10 accents', () => {
  it('shows "Shift = accent" only for a rudiment that notates one — absent for the default Single Stroke Roll, present for Single Paradiddle', async () => {
    const { user } = setup()
    expect(screen.queryByText('Shift = accent')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Practise Single Paradiddle' }))
    expect(screen.getByText('Shift = accent')).toBeInTheDocument()
  })

  /**
   * The on-screen Tap pad presses with no velocity at all (same as the
   * groove trainer's own pads) — a mouse learner on an accented rudiment
   * must be told the accents were not graded, never marked as failed for a
   * signal their input device cannot express (`isCleanPass`'s own contract:
   * unclassified strokes never block a clean pass).
   */
  it('a run played through the on-screen Tap pad grades its accents as unclassified, not failed', async () => {
    const { user, frameAt, clock } = setup()
    await user.click(screen.getByRole('button', { name: 'Practise Single Paradiddle' }))
    const plan = singleParadiddlePlan60bpm()
    const snarePlan = plan.pads.find((padPlan) => padPlan.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: single-paradiddle plan has no snare row')
    expect(snarePlan.expectedDynamics.some((dynamicsClass) => dynamicsClass === 'accent')).toBe(true)

    const gradedOrigin = plan.barMs
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(gradedOrigin)

    const pad = screen.getByRole('button', { name: 'Tap' })
    for (const onset of snarePlan.expectedMs) {
      act(() => {
        clock.setTime(gradedOrigin + onset)
        fireEvent.pointerDown(pad)
      })
    }
    frameAt(gradedOrigin + plan.gradedMs + EPSILON_MS)

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Clean pass')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Accents were not graded: the on-screen pad carries no velocity. Hold Shift on the keyboard for an accent, or use an e-kit.',
      ),
    ).toBeInTheDocument()
  })

  /**
   * DR-02: the screen had NO e-kit input at all before this slice. Proves
   * both halves of the fix at once — a real MIDI stroke reaches the trainer,
   * and it carries the e-kit's OWN velocity into dynamics grading, not a
   * hardcoded/default one — by striking GM note 36 (kick, mapped by the
   * default General MIDI kit map), a DIFFERENT pad than the rudiment's own
   * snare: the rudiment is one voice, so any mapped pad counts as its stroke
   * (spec decision, `RudimentTrainerScreen.tsx`'s own comment on the
   * `useDrumMidiInput` call). Every stroke at velocity 40 — below
   * `DEFAULT_VELOCITY_THRESHOLDS.ghostMax` (50), so it classifies 'ghost'
   * against every notated 'accent' instant, and every one of them comes back
   * wrong. If the e-kit path silently dropped `raw.velocity` (or ignored a
   * non-snare pad), this run would read as an unclassified or missing input.
   */
  it('a real e-kit stroke on ANY mapped pad counts as this rudiment’s one voice, and forwards its own MIDI velocity into dynamics grading', async () => {
    const kit = new FakeMidiInput()
    const { user, clock, frameAt } = setup({ midiInput: kit })
    await user.click(screen.getByRole('button', { name: 'Practise Single Paradiddle' }))
    const plan = singleParadiddlePlan60bpm()
    const snarePlan = plan.pads.find((padPlan) => padPlan.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: single-paradiddle plan has no snare row')
    const accentCount = snarePlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'accent').length
    // The sentence below is written for the plural branch — guard the
    // fixture's own shape rather than silently asserting the wrong sentence
    // if a future content change ever made Single Paradiddle's own accent
    // count come out to exactly 1.
    expect(accentCount).toBeGreaterThan(1)

    const gradedOrigin = plan.barMs
    await user.click(screen.getByRole('button', { name: 'Start' }))
    frameAt(gradedOrigin)

    for (const onset of snarePlan.expectedMs) {
      act(() => {
        clock.setTime(gradedOrigin + onset)
        kit.emit({ type: 'noteOn', note: midi(36), velocity: 40, time: millis(clock.now()) })
      })
    }
    frameAt(gradedOrigin + plan.gradedMs + EPSILON_MS)

    expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Not clean')).toBeInTheDocument()
    expect(
      screen.getByText('Every accent you hit came out soft. Lean into them.'),
    ).toBeInTheDocument()
  })
})

/**
 * AMBER (review): the rudiment screen had NO e-kit status line at all — a
 * learner on an unmapped pad got a silent "0 of 32" with no hint why. Mirrors
 * `GrooveTrainerScreen.test.tsx`'s and `CoordinationTrainerScreen.test.tsx`'s
 * own e-kit status coverage: the same `role="status"`/`aria-label="E-kit"`
 * line, reusing `ekitStatusText`'s own copy rather than a hand-typed
 * sentence, so a threshold/copy change in that function cannot silently
 * desync this fixture.
 */
describe('RudimentTrainerScreen — e-kit status line (DR-02 AMBER)', () => {
  it('says no kit is connected when Web MIDI is unavailable, and that the pads still work', async () => {
    setup()
    const status = screen.getByRole('status', { name: 'E-kit' })
    // Same fixture GrooveTrainerScreen.test.tsx's own "e-kit input" suite
    // pins: jsdom has no Web MIDI API, so `useMidiConnection` reports a
    // connectionError rather than the (different) "not connected" default.
    expect(status.textContent).toMatch(/^No e-kit/)
    await screen.findByText(/^No e-kit: Web MIDI API is not available/)
  })

  it('names a connected e-kit and its map', () => {
    const kit = new FakeMidiInput()
    setup({ midiInput: kit })
    const name = kit.listDevices()[0]?.name ?? ''
    expect(screen.getByRole('status', { name: 'E-kit' })).toHaveTextContent(
      ekitStatusText(
        { connected: true, deviceName: name, deviceId: kit.listDevices()[0]?.id, connectionError: undefined, lastUnmappedNote: undefined, lastNoteOn: undefined },
        'General MIDI',
      ),
    )
  })
})
