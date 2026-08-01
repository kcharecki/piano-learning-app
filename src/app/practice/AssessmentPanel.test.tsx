/**
 * Roadmap 2.11, REQ-3.3.4 — a real `AssessmentResult` in, real numbers on
 * screen out. Every assertion here reads a value straight from the fixture
 * result rather than a hardcoded expectation, so a panel that stopped reading
 * `result` (e.g. rendered zeros, or the wrong field) fails these tests.
 */
import type { AssessmentResult } from '@core/practice/assessment.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssessmentPanel } from './AssessmentPanel.tsx'

afterEach(cleanup)

const RESULT: AssessmentResult = {
  scoreId: 'panel-test',
  accuracy: 0.75,
  timingConsistency: 0.6,
  meanAbsDeviationMs: 42,
  tempoBpm: 120,
  measures: [
    {
      measureIndex: 0,
      expected: 2,
      correct: 2,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
      accuracy: 1,
      meanAbsDeviationMs: 10,
    },
    {
      measureIndex: 1,
      expected: 2,
      correct: 1,
      wrongPitch: 1,
      missed: 0,
      extra: 0,
      accuracy: 0.5,
      meanAbsDeviationMs: 80,
    },
  ],
  counts: { correct: 3, wrongPitch: 1, missed: 0, extra: 0 },
  completedAt: 1_700_000_000_000,
}

// Below the default 0.9 accuracy / 0.7 timingConsistency thresholds.
const FAILING_RESULT = RESULT
const PASSING_RESULT: AssessmentResult = { ...RESULT, accuracy: 0.95, timingConsistency: 0.9 }

describe('AssessmentPanel — idle and running', () => {
  it('shows a start button, enabled only when a score is loaded', () => {
    render(<AssessmentPanel phase="idle" result={undefined} canStart={false} onStart={() => {}} />)
    expect(screen.getByRole('button', { name: 'Start assessment' })).toBeDisabled()
  })

  it('starting the run calls onStart', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(<AssessmentPanel phase="idle" result={undefined} canStart onStart={onStart} />)

    await user.click(screen.getByRole('button', { name: 'Start assessment' }))

    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('while running, shows a status and disables the start button', () => {
    render(<AssessmentPanel phase="running" result={undefined} canStart onStart={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent(/assessment running/i)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

describe('AssessmentPanel — a completed result', () => {
  it('renders the real accuracy and timing consistency from the result', () => {
    render(<AssessmentPanel phase="complete" result={RESULT} canStart onStart={() => {}} />)
    expect(screen.getByTestId('assessment-accuracy')).toHaveTextContent('75%')
    expect(screen.getByTestId('assessment-timing')).toHaveTextContent('60%')
  })

  it('shows a pass/fail verdict driven by passesThreshold, not a hardcoded label', () => {
    const { rerender } = render(
      <AssessmentPanel phase="complete" result={FAILING_RESULT} canStart onStart={() => {}} />,
    )
    expect(screen.getByTestId('assessment-verdict')).toHaveTextContent('Needs more practice')

    rerender(
      <AssessmentPanel phase="complete" result={PASSING_RESULT} canStart onStart={() => {}} />,
    )
    expect(screen.getByTestId('assessment-verdict')).toHaveTextContent('Passed')
  })

  it("renders one table row per measure, with that measure's own counts", () => {
    render(<AssessmentPanel phase="complete" result={RESULT} canStart onStart={() => {}} />)
    const rows = screen.getAllByRole('row')
    // Header row plus one row per measure.
    expect(rows).toHaveLength(1 + RESULT.measures.length)

    const secondMeasureRow = within(rows[2] as HTMLElement)
    const cells = secondMeasureRow.getAllByRole('cell').map((cell) => cell.textContent)
    // accuracy, correct, wrongPitch, missed, extra — straight from RESULT.measures[1].
    expect(cells).toEqual(['50%', '1', '1', '0', '0'])
  })

  it('numbers the measure column 1-based (measureIndex + 1), matching the printed score', () => {
    render(<AssessmentPanel phase="complete" result={RESULT} canStart onStart={() => {}} />)
    const rows = screen.getAllByRole('row')
    // RESULT.measures are measureIndex 0 and 1 (0-based core data); the
    // row header must read the printed 1-based measure number, 1 and 2.
    expect(within(rows[1] as HTMLElement).getByRole('rowheader')).toHaveTextContent('1')
    expect(within(rows[2] as HTMLElement).getByRole('rowheader')).toHaveTextContent('2')
  })

  it('offers to run the assessment again instead of "Start assessment"', () => {
    render(<AssessmentPanel phase="complete" result={RESULT} canStart onStart={() => {}} />)
    expect(screen.getByRole('button', { name: 'Run assessment again' })).toBeEnabled()
  })
})
