import type { MatchSummary } from '@core/practice/matcher.ts'
import { midi } from '@core/shared/units.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { TimingFeedback } from './TimingFeedback.tsx'
import type { Judgement } from './useNoteFeedback.ts'

function summary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    correct: 0,
    wrongPitch: 0,
    missed: 0,
    extra: 0,
    accuracy: 1,
    meanAbsDeviationMs: 0,
    ...overrides,
  }
}

afterEach(cleanup)

describe('TimingFeedback', () => {
  // UI-09 (2026-08-12 UI audit): never a fake 100% — `MatchSummary.accuracy`
  // reads 1 by default (matcher.ts's own divide-by-zero-safe value), but the
  // on-screen reading must say so honestly instead of repeating that default.
  it('shows an em dash for Accuracy before any note has been judged, never a fake 100%', () => {
    render(<TimingFeedback summary={summary({ accuracy: 1 })} lastJudgement={undefined} />)
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('—')
  })

  it('shows the real accuracy percentage once at least one note has been judged', () => {
    render(
      <TimingFeedback
        summary={summary({ correct: 3, wrongPitch: 1, accuracy: 0.75 })}
        lastJudgement={undefined}
      />,
    )
    expect(screen.getByTestId('feedback-accuracy')).toHaveTextContent('75%')
    expect(screen.getByTestId('feedback-correct')).toHaveTextContent('3')
    expect(screen.getByTestId('feedback-wrong-pitch')).toHaveTextContent('1')
    expect(screen.getByTestId('feedback-missed')).toHaveTextContent('0')
    expect(screen.getByTestId('feedback-extra')).toHaveTextContent('0')
  })

  it('renders a placeholder and the mean deviation before any press is judged', () => {
    render(<TimingFeedback summary={summary()} lastJudgement={undefined} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('—')
    expect(screen.getByTestId('timing-mean')).toHaveTextContent(/^avg 0 ms$/)
  })

  it('reports a late press with its rounded, signed deviation', () => {
    const late: Judgement = { midi: midi(62), timing: 'late', deviationMs: 120, correct: true }
    render(<TimingFeedback summary={summary({ meanAbsDeviationMs: 45.6 })} lastJudgement={late} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('late (+120 ms)')
    expect(screen.getByTestId('timing-mean')).toHaveTextContent(/^avg 46 ms$/)
  })

  it('reports an early press with its mirror-image negative deviation', () => {
    const early: Judgement = { midi: midi(64), timing: 'early', deviationMs: -45, correct: true }
    render(<TimingFeedback summary={summary({ meanAbsDeviationMs: 12 })} lastJudgement={early} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('early (-45 ms)')
  })

  it('reports on-time with no signed number attached', () => {
    const onTime: Judgement = { midi: midi(60), timing: 'on-time', deviationMs: 0, correct: true }
    render(<TimingFeedback summary={summary()} lastJudgement={onTime} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('on time')
  })

  it('marks a wrong-pitch judgement distinctly, even when its timing is on-time', () => {
    const wrongPitch: Judgement = {
      midi: midi(61),
      timing: 'on-time',
      deviationMs: 0,
      correct: false,
    }
    render(<TimingFeedback summary={summary()} lastJudgement={wrongPitch} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent(/wrong pitch/i)
  })

  it('exposes the readout as an accessible, named status region whose content updates', () => {
    const { rerender } = render(<TimingFeedback summary={summary()} lastJudgement={undefined} />)

    const region = screen.getByRole('status', { name: /note timing feedback/i })
    expect(within(region).getByTestId('timing-last')).toHaveTextContent('—')

    const late: Judgement = { midi: midi(62), timing: 'late', deviationMs: 120, correct: true }
    rerender(<TimingFeedback summary={summary()} lastJudgement={late} />)

    expect(within(region).getByTestId('timing-last')).toHaveTextContent('late (+120 ms)')
  })

  // UI-09: "What this screen doesn't check" moved from a permanent
  // disclosure into a popover beside Accuracy — still one click away, still
  // reachable and closable by keyboard, focus restored to its trigger.
  it('opens the "what this screen doesn\'t check" info popover from a button beside Accuracy, and Escape closes it', async () => {
    const user = userEvent.setup()
    render(<TimingFeedback summary={summary()} lastJudgement={undefined} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: "What this screen doesn't check" })

    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: "What this screen doesn't check" })
    expect(within(dialog).getByText(/not how long you held them/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/hand position, wrist, or posture/i)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
