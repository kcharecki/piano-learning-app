/**
 * `RudimentTrainerScreen` — thin, per the testing rules: what is asserted
 * here is wiring and accessible names (the library's 40 rows across 4 tiers,
 * Practise switching the trainer, the Ladder status reading back
 * `ladderText`), not grading (`rudimentRun.test.ts`) and not ladder timing
 * (`useRudimentTrainer.test.ts`).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { FakeClock } from '@test/fakes.ts'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { rudimentToScore } from '@core/drums/rudiment/index.ts'
import { rudimentById } from '@content/drums/rudiments.ts'
import { barsOf, cyclesForBars } from './rudimentRun.ts'
import { RudimentTrainerScreen } from './RudimentTrainerScreen.tsx'

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

function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup() {
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
  render(<RudimentTrainerScreen clock={clock} audio={() => audio} frameDriver={frameDriver} />)
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
