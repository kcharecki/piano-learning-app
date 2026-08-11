/**
 * `PracticeSheet` (roadmap 5.47): thin wiring test — closed by default, the
 * toggle reveals a real preview built from `usePracticeSheet`'s data (never a
 * fixture), the empty state renders honestly when the week has nothing in
 * it, the accuracy caveat only appears alongside an actual accuracy number,
 * and "Print" calls the real `window.print()`. Aggregation itself is
 * `usePracticeSheet.test.ts`'s job, not this file's.
 */
import type { DateSource } from '@core/ports/index.ts'
import { DAY_MS } from '@core/srs/scheduler.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { useProgressStore, type StoredAssessment } from '@app/state/progressStore.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PracticeSheet } from './PracticeSheet.tsx'

class FakeDateSource implements DateSource {
  private current: number
  constructor(current: number) {
    this.current = current
  }
  epochMillis(): number {
    return this.current
  }
}

const NOW = 20_000 * DAY_MS + 12 * 60 * 60 * 1000

function resetStore(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
}

afterEach(() => {
  cleanup()
  resetStore()
})

describe('PracticeSheet — closed by default', () => {
  it('shows a "Show practice sheet" toggle and no printable content until clicked', () => {
    render(<PracticeSheet date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)
    expect(screen.getByRole('button', { name: /show practice sheet/i })).toBeInTheDocument()
    expect(screen.queryByTestId('practice-sheet-empty')).toBeNull()
    expect(screen.queryByTestId('practice-sheet-summary')).toBeNull()
  })
})

describe('PracticeSheet — empty week', () => {
  it('reveals an honest empty state, not a blank panel or a fabricated week', async () => {
    const user = userEvent.setup()
    render(<PracticeSheet date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    await user.click(screen.getByRole('button', { name: /show practice sheet/i }))

    expect(screen.getByTestId('practice-sheet-empty')).toHaveTextContent(/no practice recorded/i)
    expect(screen.queryByTestId('practice-sheet-summary')).toBeNull()
    expect(screen.getByRole('button', { name: /hide practice sheet/i })).toBeInTheDocument()
  })
})

describe('PracticeSheet — a week with real data', () => {
  function seed(): void {
    const entry: PracticeEntry = {
      id: 'pe-1',
      startedAt: NOW - 1 * DAY_MS,
      endedAt: NOW - 1 * DAY_MS + 12 * 60_000,
      kind: 'repertoire',
      itemId: 'minuet-g',
      itemName: 'Minuet in G',
    }
    useProgressStore.getState().addPracticeEntry(entry)
    const assessment: StoredAssessment = {
      id: 'assess-1',
      scoreId: 'minuet-g',
      scoreTitle: 'Minuet in G',
      at: NOW - 1 * DAY_MS,
      result: {
        scoreId: 'minuet-g',
        accuracy: 0.75,
        timingConsistency: 0.7,
        meanAbsDeviationMs: 20,
        tempoBpm: 90,
        measures: [],
        counts: { correct: 15, wrongPitch: 3, missed: 2, extra: 0 },
        completedAt: NOW - 1 * DAY_MS,
      },
    }
    useProgressStore.getState().addAssessment(assessment)
  }

  it('renders the real category, item and assessment rows, and an accuracy caveat', async () => {
    seed()
    const user = userEvent.setup()
    render(<PracticeSheet date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    await user.click(screen.getByRole('button', { name: /show practice sheet/i }))

    expect(screen.queryByTestId('practice-sheet-empty')).toBeNull()
    expect(screen.getByTestId('practice-sheet-category-repertoire')).toHaveTextContent('Repertoire')
    expect(screen.getByTestId('practice-sheet-category-repertoire')).toHaveTextContent('12')
    expect(screen.getByTestId('practice-sheet-item-0')).toHaveTextContent('Minuet in G')
    expect(screen.getByTestId('practice-sheet-assessment-0')).toHaveTextContent('Minuet in G')
    expect(screen.getByTestId('practice-sheet-assessment-0')).toHaveTextContent('75%')
    expect(screen.queryByTestId('practice-sheet-assessments-empty')).toBeNull()
    expect(screen.getByText(/does not measure tone/i)).toBeInTheDocument()
  })

  it('shows "no assessments" honestly when practice was logged but nothing was assessed', async () => {
    useProgressStore.getState().addPracticeEntry({
      id: 'pe-2',
      startedAt: NOW - 1 * DAY_MS,
      endedAt: NOW - 1 * DAY_MS + 10 * 60_000,
      kind: 'technique',
      itemName: 'Five-finger patterns',
    })
    const user = userEvent.setup()
    render(<PracticeSheet date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    await user.click(screen.getByRole('button', { name: /show practice sheet/i }))

    expect(screen.getByTestId('practice-sheet-summary')).toBeInTheDocument()
    expect(screen.getByTestId('practice-sheet-assessments-empty')).toHaveTextContent(
      /no assessments recorded/i,
    )
    expect(screen.queryByText(/does not measure tone/i)).toBeNull()
  })

  it('the Print button calls window.print()', async () => {
    seed()
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<PracticeSheet date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    await user.click(screen.getByRole('button', { name: /show practice sheet/i }))
    await user.click(screen.getByRole('button', { name: /^print$/i }))

    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })
})
