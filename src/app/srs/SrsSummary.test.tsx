/**
 * `SrsSummary` (roadmap UI-07 rework of 5.31): headline shows learner
 * language only; the five-way breakdown and the scheduler's own words
 * (Young/Mature/ease) live behind one closed-by-default disclosure; the
 * empty state is exactly one teaching sentence, never a row of zeros.
 * Every displayed number is exactly the value `RetentionStats` carries
 * (never re-derived except the documented `new = total - young - mature`
 * subtraction).
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
  it('zero-data state is exactly one teaching sentence, never a row of zeros', () => {
    render(<SrsSummary stats={stats({ total: 0 })} idPrefix="test-stats" ariaLabel="Retention" />)

    expect(screen.getByTestId('test-stats-empty')).toHaveTextContent(
      'Answers you give here come back for review at the right moment — play the first card to start.',
    )
    // No headline row, and only one "empty" element in the whole render —
    // never a second empty box alongside it.
    expect(screen.queryByTestId('test-stats-headline')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    // The zero counts are still real, honest zeros — present for callers
    // that assert them (e.g. dashboard-retention-total) — but not shown as
    // a visible "0 · 0 · 0 · 0 · 0" line; they live inside the closed
    // disclosure below.
    expect(screen.getByTestId('test-stats-total')).toHaveTextContent('0')
    const details = document.querySelector('details.srs-summary-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
  })

  it('non-zero state shows a learner-language headline; no scheduler jargon visible before the disclosure opens', () => {
    render(
      <SrsSummary
        stats={stats({ total: 12, due: 3, young: 4, mature: 2, averageEase: 2.37 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )

    expect(screen.getByTestId('test-stats-headline')).toHaveTextContent('12 cards · 3 to review')
    expect(screen.queryByTestId('test-stats-empty')).toBeNull()

    // The disclosure is closed by default — the scheduler's own words are
    // not part of the default rendered view.
    const details = document.querySelector('details.srs-summary-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(screen.getByText('Review breakdown')).toBeInTheDocument()

    // Nothing outside the (closed) details node uses scheduler jargon.
    const headline = screen.getByTestId('test-stats-headline')
    expect(headline.textContent).not.toMatch(/ease|young|mature|SRS/i)
  })

  it('opening the disclosure reveals both the breakdown and the raw scheduler figures, unchanged from the stats passed in', async () => {
    const user = userEvent.setup()
    render(
      <SrsSummary
        stats={stats({ total: 10, due: 3, young: 4, mature: 2, averageEase: 2.37 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )

    await user.click(screen.getByText('Review breakdown'))

    const details = document.querySelector('details.srs-summary-details') as HTMLDetailsElement
    expect(details.open).toBe(true)

    expect(screen.getByTestId('test-stats-total')).toHaveTextContent('10')
    expect(screen.getByTestId('test-stats-due')).toHaveTextContent('3')
    // new = total - young - mature = 10 - 4 - 2 = 4
    expect(screen.getByTestId('test-stats-new')).toHaveTextContent('4')
    expect(screen.getByTestId('test-stats-learning')).toHaveTextContent('4')
    expect(screen.getByTestId('test-stats-mastered')).toHaveTextContent('2')

    expect(within(details).getByText('Young')).toBeInTheDocument()
    expect(within(details).getByText('Mature')).toBeInTheDocument()
    expect(screen.getByTestId('test-stats-young')).toHaveTextContent('4')
    expect(screen.getByTestId('test-stats-mature')).toHaveTextContent('2')
    expect(screen.getByTestId('test-stats-ease')).toHaveTextContent('2.37')

    const group = within(details).getByRole('group', { name: 'Retention' })
    expect(group).toBeInTheDocument()
  })

  it('the headline omits a clause whose count is zero, never rendering "0 to review"', () => {
    render(
      <SrsSummary
        stats={stats({ total: 5, due: 0 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )
    expect(screen.getByTestId('test-stats-headline')).toHaveTextContent('5 cards')
    expect(screen.queryByText(/to review/)).toBeNull()
  })

  it('pluralizes the card count correctly, never a bare "1 cards"', () => {
    render(
      <SrsSummary
        stats={stats({ total: 1, due: 1 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )
    expect(screen.getByTestId('test-stats-headline')).toHaveTextContent('1 card · 1 to review')
  })

  it('new never goes negative: young + mature never exceeds total for any RetentionStats the scheduler can produce', async () => {
    const user = userEvent.setup()
    render(
      <SrsSummary
        stats={stats({ total: 3, young: 3, mature: 0 })}
        idPrefix="test-stats"
        ariaLabel="Retention"
      />,
    )
    await user.click(screen.getByText('Review breakdown'))
    expect(screen.getByTestId('test-stats-new')).toHaveTextContent('0')
  })
})
