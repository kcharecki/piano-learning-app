import { midi } from '@core/shared/units.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TimingFeedback } from './TimingFeedback.tsx'
import type { Judgement } from './useNoteFeedback.ts'

afterEach(cleanup)

describe('TimingFeedback', () => {
  it('renders a placeholder and the mean deviation before any press is judged', () => {
    render(<TimingFeedback lastJudgement={undefined} meanAbsDeviationMs={0} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('—')
    expect(screen.getByTestId('timing-mean')).toHaveTextContent(/^avg 0 ms$/)
  })

  it('reports a late press with its rounded, signed deviation', () => {
    const late: Judgement = { midi: midi(62), timing: 'late', deviationMs: 120, correct: true }
    render(<TimingFeedback lastJudgement={late} meanAbsDeviationMs={45.6} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('late (+120 ms)')
    expect(screen.getByTestId('timing-mean')).toHaveTextContent(/^avg 46 ms$/)
  })

  it('reports an early press with its mirror-image negative deviation', () => {
    const early: Judgement = { midi: midi(64), timing: 'early', deviationMs: -45, correct: true }
    render(<TimingFeedback lastJudgement={early} meanAbsDeviationMs={12} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('early (-45 ms)')
  })

  it('reports on-time with no signed number attached', () => {
    const onTime: Judgement = { midi: midi(60), timing: 'on-time', deviationMs: 0, correct: true }
    render(<TimingFeedback lastJudgement={onTime} meanAbsDeviationMs={0} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent('on time')
  })

  it('marks a wrong-pitch judgement distinctly, even when its timing is on-time', () => {
    const wrongPitch: Judgement = {
      midi: midi(61),
      timing: 'on-time',
      deviationMs: 0,
      correct: false,
    }
    render(<TimingFeedback lastJudgement={wrongPitch} meanAbsDeviationMs={0} />)

    expect(screen.getByTestId('timing-last')).toHaveTextContent(/wrong pitch/i)
  })

  it('exposes the readout as an accessible, named status region whose content updates', () => {
    const { rerender } = render(<TimingFeedback lastJudgement={undefined} meanAbsDeviationMs={0} />)

    const region = screen.getByRole('status', { name: /note timing feedback/i })
    expect(within(region).getByTestId('timing-last')).toHaveTextContent('—')

    const late: Judgement = { midi: midi(62), timing: 'late', deviationMs: 120, correct: true }
    rerender(<TimingFeedback lastJudgement={late} meanAbsDeviationMs={0} />)

    expect(within(region).getByTestId('timing-last')).toHaveTextContent('late (+120 ms)')
  })
})
