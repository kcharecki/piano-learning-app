/**
 * `DashboardScreen` (roadmap 4.7, REQ-3.10.1/REQ-3.10.2): thin wiring test —
 * seed the stores, render, and assert the DISPLAYED numbers are the ones the
 * core functions compute for that data (never a hardcoded "0"), plus the
 * honest empty state for every section with no writer yet.
 */
import type { DateSource } from '@core/ports/index.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { DAY_MS } from '@core/srs/scheduler.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { DashboardScreen } from './DashboardScreen.tsx'

class FakeDateSource implements DateSource {
  private current: number
  constructor(current: number) {
    this.current = current
  }
  epochMillis(): number {
    return this.current
  }
}

// Deliberately NOT a midnight instant — see useDashboard.test.ts's fixture comment.
const NOW = 20_000 * DAY_MS + 20 * 60 * 60 * 1000

function resetStores(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useSightReadingStore.setState({ level: 1, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useRepertoireStore.setState({ pieces: [] })
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('DashboardScreen — empty state', () => {
  it('shows every REQ-3.10.1 section, each with an honest empty state, never a blank panel', () => {
    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByRole('region', { name: 'Current level per track' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Practice streak and weekly time' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Sight-reading accuracy trend' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Technique tempo trends' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Theory retention stats' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Repertoire status' })).toBeTruthy()

    expect(screen.getByTestId('dashboard-level-playing').textContent).toContain('not tracked yet')
    expect(screen.getByTestId('dashboard-level-theory').textContent).toContain('not tracked yet')
    expect(screen.getByTestId('dashboard-level-sight-reading').textContent).toContain('level 1')
    expect(screen.getByTestId('dashboard-criteria-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-weekly-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-sightreading-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-technique-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-retention-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-repertoire-empty')).toBeTruthy()

    expect(screen.getByTestId('dashboard-streak-current').textContent).toBe('0 day(s)')
    expect(screen.getByTestId('dashboard-retention-total').textContent).toBe('0')
  })
})

describe('DashboardScreen — seeded data', () => {
  it('renders the real streak and weekly minutes computed from the seeded practice log', () => {
    const entries: PracticeEntry[] = [
      {
        id: 'pe-1',
        startedAt: NOW - 30 * 60_000,
        endedAt: NOW,
        kind: 'technique',
        itemName: 'Scales',
      },
      {
        id: 'pe-2',
        // Ends at the same time-of-day one day earlier, so a 15-minute
        // session before it stays on that same local day.
        startedAt: NOW - DAY_MS - 15 * 60_000,
        endedAt: NOW - DAY_MS,
        kind: 'sightreading',
        itemName: 'Level 2 piece',
      },
    ]
    useProgressStore.setState({ practiceEntries: entries })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    // Two consecutive practiced days (today + yesterday), nothing further back.
    expect(screen.getByTestId('dashboard-streak-current').textContent).toBe('2 day(s)')
    expect(screen.getByTestId('dashboard-streak-longest').textContent).toBe('2 day(s)')
    expect(screen.getByTestId('dashboard-weekly-minutes').textContent).toBe('45 min')
    expect(screen.getByTestId('dashboard-minutes-technique').textContent).toBe('technique: 30 min')
    expect(screen.getByTestId('dashboard-minutes-sightreading').textContent).toBe(
      'sightreading: 15 min',
    )
    expect(screen.queryByTestId('dashboard-weekly-empty')).toBeNull()
  })

  it('renders the real sight-reading level and accuracy trend from the seeded history', () => {
    const history: SightReadingRecord[] = [
      { pieceId: 'p1', readAt: NOW - 5_000, accuracy: 0.6, level: 2 },
      { pieceId: 'p2', readAt: NOW - 1_000, accuracy: 0.95, level: 3 },
    ]
    useSightReadingStore.setState({ level: 3, history })

    const { container } = render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-sightreading-level').textContent).toBe('Level 3')
    expect(screen.getByTestId('dashboard-level-sight-reading').textContent).toContain('level 3')
    expect(screen.queryByTestId('dashboard-sightreading-empty')).toBeNull()
    expect(
      screen.getByRole('img', { name: 'Sight-reading accuracy over time' }),
    ).toBeTruthy()
    // Presence alone cannot tell a correctly-plotted trend from a mislabelled
    // one (unscaled accuracy, wrong point order) — read the actual values back.
    const titles = [...container.querySelectorAll('circle title')].map((t) => t.textContent)
    expect(titles).toEqual(['Run 1: 60%', 'Run 2: 95%'])
  })

  it('renders the real retention stats from the seeded flashcard SRS state, theory cards only', () => {
    useFlashcardStore.setState({
      cardsById: {
        'key-signature-0': {
          id: 'key-signature-0',
          due: NOW - 1,
          intervalDays: 25,
          ease: 2.4,
          reps: 4,
          lapses: 0,
          introducedAt: NOW - 60 * DAY_MS,
        },
        // A reading-drill card (not theory) — must not be counted in "Theory retention".
        'note-name-60': {
          id: 'note-name-60',
          due: NOW - 1,
          intervalDays: 25,
          ease: 1.5,
          reps: 4,
          lapses: 0,
          introducedAt: NOW - 60 * DAY_MS,
        },
      },
    })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-retention-total').textContent).toBe('1')
    expect(screen.getByTestId('dashboard-retention-due').textContent).toBe('1')
    expect(screen.getByTestId('dashboard-retention-young').textContent).toBe('0')
    expect(screen.getByTestId('dashboard-retention-mature').textContent).toBe('1')
    expect(screen.getByTestId('dashboard-retention-ease').textContent).toBe('2.40')
    expect(screen.queryByTestId('dashboard-retention-empty')).toBeNull()
  })

  it('renders the seeded repertoire library and its due-for-review sub-list from useRepertoireStore', () => {
    const pieces: RepertoirePiece[] = [
      {
        id: 'piece-1',
        title: 'Fur Elise',
        composer: 'Beethoven',
        level: 3,
        status: 'maintained',
        // Practised 30 days ago — past the 21-day maintenance interval, so due.
        sessions: [{ at: NOW - 30 * DAY_MS, minutes: 20, accuracy: 0.9 }],
        bestAccuracy: 0.9,
        notes: '',
      },
    ]
    useRepertoireStore.setState({ pieces })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-repertoire-piece-piece-1').textContent).toBe(
      'Fur Elise: maintained',
    )
    expect(screen.getByRole('list', { name: 'Repertoire pieces' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Repertoire pieces due for review' })).toBeTruthy()
    expect(screen.getByTestId('dashboard-repertoire-due-piece-1').textContent).toBe('Fur Elise')
    expect(screen.queryByTestId('dashboard-repertoire-empty')).toBeNull()
  })
})
