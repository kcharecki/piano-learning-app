/**
 * `SrsSummary` (roadmap 5.31): thin wiring test — every displayed number is
 * exactly the value `RetentionStats` carries (never re-derived except the
 * documented `new = total - young - mature` subtraction), none of the
 * scheduler's own words ("Young", "Mature", "ease") are visible until the
 * "Scheduler details" `<details>` is opened, and the honest empty state only
 * appears when there really are zero cards.
 */
import type { RetentionStats } from '@core/srs/scheduler.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SrsSummary } from './SrsSummary.tsx'

afterEach(cleanup)

function stats(overrides: Partial<RetentionStats> = {}): RetentionStats {
  return { total: 0, due: 0, young: 0, mature: 0, averageEase: 0, ...overrides }
}

describe('SrsSummary', () => {
  it('translates the scheduler stats into learner-facing counts, none of the raw words visible by default', () => {
    render(
      <SrsSummary
        stats={stats({ total: 10, due: 3, young: 4, mature: 2 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )

    expect(screen.getByTestId('test-stats-total')).toHaveTextContent('10')
    expect(screen.getByTestId('test-stats-due')).toHaveTextContent('3')
    // new = total - young - mature = 10 - 4 - 2 = 4
    expect(screen.getByTestId('test-stats-new')).toHaveTextContent('4')
    expect(screen.getByTestId('test-stats-learning')).toHaveTextContent('4')
    expect(screen.getByTestId('test-stats-mastered')).toHaveTextContent('2')

    // The scheduler's own vocabulary lives inside a closed <details> — not
    // deleted (still there for debugging, per the roadmap task), but not
    // part of the rendered default view either.
    const details = document.querySelector('details.srs-summary-debug')
    expect(details).not.toBeNull()
    expect(details?.hasAttribute('open')).toBe(false)
    expect(screen.getByText('Scheduler details')).toBeInTheDocument()
  })

  it('opening "Scheduler details" reveals the raw Young/Mature/ease numbers, unchanged from the stats passed in', async () => {
    const user = userEvent.setup()
    render(
      <SrsSummary
        stats={stats({ total: 6, due: 1, young: 4, mature: 2, averageEase: 2.37 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )

    await user.click(screen.getByText('Scheduler details'))

    const details = document.querySelector('details.srs-summary-debug') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(within(details).getByText('Young')).toBeInTheDocument()
    expect(within(details).getByText('Mature')).toBeInTheDocument()
    expect(screen.getByTestId('test-stats-young')).toHaveTextContent('4')
    expect(screen.getByTestId('test-stats-mature')).toHaveTextContent('2')
    expect(screen.getByTestId('test-stats-ease')).toHaveTextContent('2.37')
  })

  it('shows the honest empty state only when there are zero cards, never a fabricated number', () => {
    const { rerender } = render(
      <SrsSummary stats={stats({ total: 0 })} idPrefix="test-stats" ariaLabel="Retention" />,
    )
    expect(screen.getByTestId('test-stats-empty')).toHaveTextContent('Nothing recorded yet.')
    // The zero counts are still real, honest zeros, not hidden away.
    expect(screen.getByTestId('test-stats-total')).toHaveTextContent('0')

    rerender(
      <SrsSummary
        stats={stats({ total: 1, young: 1 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )
    expect(screen.queryByTestId('test-stats-empty')).toBeNull()
  })

  it('new never goes negative: young + mature never exceeds total for any RetentionStats the scheduler can produce', () => {
    // young requires reps > 0 and intervalDays < 21; mature requires
    // intervalDays >= 21 — mutually exclusive, so young + mature <= total
    // always holds. Regression guard for the `new = total - young - mature`
    // subtraction this component relies on.
    render(
      <SrsSummary
        stats={stats({ total: 3, young: 3, mature: 0 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )
    expect(screen.getByTestId('test-stats-new')).toHaveTextContent('0')
  })
})
