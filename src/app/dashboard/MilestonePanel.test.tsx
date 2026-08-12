/**
 * `MilestonePanel` — thin render/wiring test. Behaviour (what counts as
 * achieved, honest progress) lives in `@core/progress/milestones.ts` and is
 * covered there; this file only checks the component groups, sorts and
 * renders `Milestone[]` correctly, including the collapsed-by-default
 * disclosure and every documented empty/edge state.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Milestone, MilestoneId } from '@core/progress/milestones.ts'
import { MilestonePanel } from './MilestonePanel.tsx'

afterEach(cleanup)

function milestone(id: MilestoneId, over: Partial<Milestone> = {}): Milestone {
  return {
    id,
    title: id,
    description: `Description for ${id}`,
    achieved: false,
    achievedAt: null,
    progress: 0,
    progressLabel: '0 of 1',
    ...over,
  }
}

describe('MilestonePanel — empty state', () => {
  it('renders a closed-by-default disclosure with an honest "0 of N achieved" summary and no fabricated content', () => {
    const milestones: Milestone[] = [
      milestone('twelve-major-scales'),
      milestone('repertoire-accuracy-90'),
      milestone('first-hands-together'),
      milestone('streak-7-days'),
      milestone('eartraining-level-3-all-kinds'),
    ]
    render(<MilestonePanel milestones={milestones} />)

    expect(screen.getByRole('region', { name: 'Milestones' })).toBeTruthy()
    const details = screen.getByTestId('milestone-panel-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(screen.getByTestId('milestone-summary-count').textContent).toBe('0 of 5')
    expect(screen.getByTestId('milestone-achieved-empty')).toBeTruthy()
    // All 5 are unachieved, so all 5 are eligible for "nearest" — capped at
    // the default of 3, never all 5 dumped onto the screen.
    expect(screen.getAllByTestId(/^milestone-progress-(?!label)/)).toHaveLength(3)
  })
})

describe('MilestonePanel — achieved and in-progress', () => {
  it('shows achieved milestones with their date, most recent first, and hides the empty state', () => {
    const milestones: Milestone[] = [
      milestone('streak-7-days', { achieved: true, achievedAt: Date.UTC(2026, 0, 1), progress: 1 }),
      milestone('first-hands-together', {
        achieved: true,
        achievedAt: Date.UTC(2026, 5, 15),
        progress: 1,
        progressLabel: 'C major scale, hands together',
      }),
      milestone('twelve-major-scales', { progress: 5 / 12, progressLabel: '5 of 12 major scales' }),
    ]
    render(<MilestonePanel milestones={milestones} />)

    expect(screen.queryByTestId('milestone-achieved-empty')).toBeNull()
    expect(screen.getByTestId('milestone-summary-count').textContent).toBe('2 of 3')

    const achievedItems = screen.getAllByRole('listitem').filter((li) =>
      li.getAttribute('data-testid')?.startsWith('milestone-achieved-'),
    )
    expect(achievedItems.map((li) => li.getAttribute('data-testid'))).toEqual([
      'milestone-achieved-first-hands-together', // June, more recent
      'milestone-achieved-streak-7-days', // January
    ])
    expect(screen.getByTestId('milestone-achieved-first-hands-together').textContent).toContain(
      'Jun',
    )
    expect(screen.getByTestId('milestone-achieved-streak-7-days').textContent).toContain('Jan')
  })

  it('sorts in-progress milestones nearest-to-completion first and renders the exact progress label', () => {
    const milestones: Milestone[] = [
      milestone('twelve-major-scales', { progress: 2 / 12, progressLabel: '2 of 12 major scales' }),
      milestone('streak-7-days', { progress: 5 / 7, progressLabel: '5 of 7 days' }),
      milestone('eartraining-level-3-all-kinds', { progress: 0, progressLabel: '0 of 6 kinds at level 3+' }),
    ]
    render(<MilestonePanel milestones={milestones} />)

    const progressItems = screen.getAllByRole('listitem').filter((li) =>
      li.getAttribute('data-testid')?.startsWith('milestone-progress-'),
    )
    expect(progressItems.map((li) => li.getAttribute('data-testid'))).toEqual([
      'milestone-progress-streak-7-days',
      'milestone-progress-twelve-major-scales',
      'milestone-progress-eartraining-level-3-all-kinds',
    ])
    expect(screen.getByTestId('milestone-progress-label-streak-7-days').textContent).toBe(
      '5 of 7 days',
    )
  })

  it('shows no "Nearest" heading once every milestone is achieved', () => {
    const milestones: Milestone[] = [
      milestone('streak-7-days', { achieved: true, achievedAt: Date.UTC(2026, 0, 1), progress: 1 }),
    ]
    render(<MilestonePanel milestones={milestones} />)

    expect(screen.queryByRole('heading', { name: 'Nearest' })).toBeNull()
  })

  it('respects a custom nearestCount', () => {
    const milestones: Milestone[] = [
      milestone('twelve-major-scales', { progress: 0.1 }),
      milestone('repertoire-accuracy-90', { progress: 0.2 }),
      milestone('first-hands-together', { progress: 0.3 }),
      milestone('streak-7-days', { progress: 0.4 }),
      milestone('eartraining-level-3-all-kinds', { progress: 0.5 }),
    ]
    render(<MilestonePanel milestones={milestones} nearestCount={2} />)

    const progressItems = screen.getAllByRole('listitem').filter((li) =>
      li.getAttribute('data-testid')?.startsWith('milestone-progress-'),
    )
    expect(progressItems).toHaveLength(2)
    // Highest progress first.
    expect(progressItems[0]?.getAttribute('data-testid')).toBe(
      'milestone-progress-eartraining-level-3-all-kinds',
    )
  })
})
