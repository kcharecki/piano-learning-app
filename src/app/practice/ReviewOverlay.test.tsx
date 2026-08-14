/**
 * Roadmap 2.11, REQ-3.3.5 — the overlay is purely presentational (the hook
 * computes `problems`/`loops` from the real core modules), so these tests
 * check two things: a clean run reads as a deliberate, explained result
 * rather than a blank list, and clicking a suggested loop's button actually
 * fires the real `SuggestedLoop` object back to the caller — the one-click
 * path REQ-3.3.5 requires.
 */
import type { ProblemMeasure, SuggestedLoop } from '@core/practice/review.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewOverlay } from './ReviewOverlay.tsx'

afterEach(cleanup)

const PROBLEMS: readonly ProblemMeasure[] = [
  { measureIndex: 0, severity: 0.4, reasons: ['missed'] },
  { measureIndex: 1, severity: 0.2, reasons: ['accuracy'] },
]

const LOOPS: readonly SuggestedLoop[] = [
  { startMeasure: 0, endMeasure: 1, reason: 'measures 0-1: accuracy, missed' },
]

describe('ReviewOverlay — a clean run', () => {
  it('shows an explicit "nothing to review" message rather than an empty list', () => {
    render(<ReviewOverlay problems={[]} loops={[]} onPracticeLoop={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent(/clean run/i)
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ReviewOverlay — problem measures', () => {
  // Roadmap UI-10 (2026-08-12 UI audit): the problem list and loop
  // suggestions moved from always-inline content into a dialog behind one
  // trigger button — every test below opens it first.
  it('shows a trigger naming how many problem measures there are, not the list itself', () => {
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)
    expect(screen.getByRole('button', { name: /review 2 problem measures/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists every problem measure with its reasons, 1-based to match the printed score', async () => {
    const user = userEvent.setup()
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)

    await user.click(screen.getByRole('button', { name: /review 2 problem measures/i }))

    const dialog = screen.getByRole('dialog', { name: 'Review' })
    expect(within(dialog).getByText(/Measure 1:.*missed notes/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Measure 2:.*wrong notes/)).toBeInTheDocument()
  })

  it("renders the loop's own reason text from core, unmodified", async () => {
    const user = userEvent.setup()
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)

    await user.click(screen.getByRole('button', { name: /review 2 problem measures/i }))

    expect(screen.getByText('measures 0-1: accuracy, missed')).toBeInTheDocument()
  })

  it('clicking a suggested loop button fires the exact SuggestedLoop object back — the one-click path', async () => {
    const user = userEvent.setup()
    const onPracticeLoop = vi.fn()
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={onPracticeLoop} />)

    await user.click(screen.getByRole('button', { name: /review 2 problem measures/i }))
    await user.click(screen.getByRole('button', { name: /practice measures 1.2/i }))

    expect(onPracticeLoop).toHaveBeenCalledTimes(1)
    expect(onPracticeLoop).toHaveBeenCalledWith(LOOPS[0])
  })

  // Accessibility acceptance criteria (docs/ui-overhaul-brief.md): overlays
  // move focus in on open and restore it to the trigger on close.
  it('moves focus into the dialog on open, and Escape closes it and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)

    const trigger = screen.getByRole('button', { name: /review 2 problem measures/i })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Review' })
    expect(dialog).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('the Close button inside the dialog also closes it and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)

    const trigger = screen.getByRole('button', { name: /review 2 problem measures/i })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
