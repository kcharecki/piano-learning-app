/**
 * Roadmap 2.11, REQ-3.3.5 — the overlay is purely presentational (the hook
 * computes `problems`/`loops` from the real core modules), so these tests
 * check two things: a clean run reads as a deliberate, explained result
 * rather than a blank list, and clicking a suggested loop's button actually
 * fires the real `SuggestedLoop` object back to the caller — the one-click
 * path REQ-3.3.5 requires.
 */
import type { ProblemMeasure, SuggestedLoop } from '@core/practice/review.ts'
import { cleanup, render, screen } from '@testing-library/react'
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
  it('lists every problem measure with its reasons', () => {
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)
    expect(screen.getByText(/Measure 0:.*missed notes/)).toBeInTheDocument()
    expect(screen.getByText(/Measure 1:.*wrong notes/)).toBeInTheDocument()
  })

  it("renders the loop's own reason text from core, unmodified", () => {
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={() => {}} />)
    expect(screen.getByText('measures 0-1: accuracy, missed')).toBeInTheDocument()
  })

  it('clicking a suggested loop button fires the exact SuggestedLoop object back — the one-click path', async () => {
    const user = userEvent.setup()
    const onPracticeLoop = vi.fn()
    render(<ReviewOverlay problems={PROBLEMS} loops={LOOPS} onPracticeLoop={onPracticeLoop} />)

    await user.click(screen.getByRole('button', { name: /practice measures 0.1/i }))

    expect(onPracticeLoop).toHaveBeenCalledTimes(1)
    expect(onPracticeLoop).toHaveBeenCalledWith(LOOPS[0])
  })
})
