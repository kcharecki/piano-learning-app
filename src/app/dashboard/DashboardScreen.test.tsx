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
import type { AssessmentResult } from '@core/practice/assessment.ts'
import type { StoredAssessment } from '@app/state/progressStore.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import { techniqueLibrary } from '@core/technique/library.ts'
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
  useLevelStore.setState({ levelState: initialLevelState() })
  useTechniqueStore.setState({ attempts: [] })
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('DashboardScreen — empty state', () => {
  it('shows every REQ-3.10.1 section, each with an honest empty state, never a blank panel', () => {
    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByRole('region', { name: 'Current level per track' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Streak' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'This week' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Sight-reading accuracy trend' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Assessment accuracy' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Technique tempo trends' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Theory retention' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Repertoire status' })).toBeTruthy()

    const initial = initialLevelState()
    expect(screen.getByTestId('dashboard-level-playing').textContent).toContain(
      `level ${initial.levels.playing}`,
    )
    expect(screen.getByTestId('dashboard-level-theory').textContent).toContain(
      `level ${initial.levels.theory}`,
    )
    expect(screen.getByTestId('dashboard-level-sight-reading').textContent).toContain(
      `level ${initial.levels['sight-reading']}`,
    )
    expect(
      (screen.getByTestId('dashboard-level-select-playing') as HTMLSelectElement).value,
    ).toBe(String(initial.levels.playing))
    expect(
      (screen.getByTestId('dashboard-level-select-theory') as HTMLSelectElement).value,
    ).toBe(String(initial.levels.theory))
    expect(
      (screen.getByTestId('dashboard-level-select-sight-reading') as HTMLSelectElement).value,
    ).toBe(String(initial.levels['sight-reading']))
    // The shipped curriculum covers level 1 (every track starts there), so
    // this is NOT the "no curriculum content" empty state any more — it is a
    // real checklist with nothing yet met. See the dedicated describe block
    // below for the checklist/Advance-control assertions.
    expect(screen.queryByTestId('dashboard-criteria-empty-playing')).toBeNull()
    expect(screen.getByTestId('dashboard-criterion-status-playing-0').textContent).toBe('Not met')
    // Not every criterion is met, so no Advance button renders at all (UI-19:
    // the button renders ONLY when it would actually do something) and no
    // explainer box either — the checklist above already says which
    // criterion is unmet.
    expect(screen.queryByTestId('dashboard-advance-playing')).toBeNull()
    expect(screen.queryByTestId('dashboard-advance-disabled-reason-playing')).toBeNull()
    expect(screen.getByTestId('dashboard-weekly-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-sightreading-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-assessment-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-technique-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-retention-empty')).toBeTruthy()
    expect(screen.getByTestId('dashboard-repertoire-empty')).toBeTruthy()

    expect(screen.getByTestId('dashboard-streak-current').textContent).toBe('0 days')
    expect(screen.getByTestId('dashboard-retention-total').textContent).toBe('0')

    // Milestones (roadmap B.4): a fresh profile shows the honest "0 of 5"
    // empty state, never a fabricated achievement.
    expect(screen.getByRole('region', { name: 'Milestones' })).toBeTruthy()
    expect(screen.getByTestId('milestone-summary-count').textContent).toBe('0 of 5')
    expect(screen.getByTestId('milestone-achieved-empty')).toBeTruthy()
  })
})

function assessmentResult(accuracy: number, completedAt: number): AssessmentResult {
  return {
    scoreId: 'irrelevant',
    accuracy,
    timingConsistency: 1,
    meanAbsDeviationMs: 0,
    tempoBpm: 120,
    measures: [],
    counts: { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt,
  }
}

function storedAssessment(
  id: string,
  scoreId: string,
  scoreTitle: string,
  at: number,
  accuracy: number,
): StoredAssessment {
  return { id, scoreId, scoreTitle, at, result: assessmentResult(accuracy, at) }
}

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
    expect(screen.getByTestId('dashboard-streak-current').textContent).toBe('2 days')
    expect(screen.getByTestId('dashboard-streak-longest').textContent).toBe('2 days')
    expect(screen.getByTestId('dashboard-weekly-minutes').textContent).toBe('45 min')
    expect(screen.getByTestId('dashboard-minutes-technique').textContent).toBe('Technique: 30 min')
    expect(screen.getByTestId('dashboard-minutes-sightreading').textContent).toBe(
      'Sight reading: 15 min',
    )
    expect(screen.queryByTestId('dashboard-weekly-empty')).toBeNull()
  })

  it('renders the real sight-reading level and accuracy trend from the seeded history', () => {
    const history: SightReadingRecord[] = [
      { pieceId: 'p1', readAt: NOW - 5_000, accuracy: 0.6, level: 2 },
      { pieceId: 'p2', readAt: NOW - 1_000, accuracy: 0.95, level: 3 },
    ]
    // Deliberately DIFFERENT from the curriculum track level below — the
    // adaptive trainer level (this store) and the curriculum sight-reading
    // level (useLevelStore) are never the same number, see useDashboard's
    // module comment.
    useSightReadingStore.setState({ level: 3, history })
    useLevelStore.setState({
      levelState: {
        levels: { playing: 1, 'sight-reading': 5, theory: 1 },
        overridden: { playing: false, 'sight-reading': false, theory: false },
      },
    })

    const { container } = render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    // roadmap 5.57: distinct wording for the two "level" numbers — the
    // trainer's own adaptive level (this panel) versus the curriculum track
    // level (the "Current level per track" row below), seeded to DIFFERENT
    // values above specifically so a naive shared label would be caught here.
    expect(screen.getByTestId('dashboard-sightreading-level').textContent).toBe(
      'Sight-reading trainer level: 3',
    )
    expect(screen.getByTestId('dashboard-level-sight-reading').textContent).toContain('level 5')
    expect(screen.getByTestId('dashboard-level-sight-reading').textContent).toContain(
      '(curriculum track)',
    )
    expect(screen.getByTestId('dashboard-sightreading-level-note').textContent).toMatch(
      /trainer.*accuracy per run/i,
    )
    expect(screen.queryByTestId('dashboard-sightreading-empty')).toBeNull()
    expect(
      screen.getByRole('img', { name: 'Sight-reading trainer accuracy over time' }),
    ).toBeTruthy()
    // Presence alone cannot tell a correctly-plotted trend from a mislabelled
    // one (unscaled accuracy, wrong point order) — read the actual values back.
    const titles = [...container.querySelectorAll('circle title')].map((t) => t.textContent)
    expect(titles).toEqual(['Run 1: 60%', 'Run 2: 95%'])
  })

  it('renders the real assessment accuracy trend and per-piece best accuracy from the seeded assessment history (roadmap 4.7c)', () => {
    // 'piece-a's best run is in the MIDDLE (0.95) — a "latest" or "first"
    // readout would display 0.7 or 0.6 instead.
    const assessments: StoredAssessment[] = [
      storedAssessment('a3', 'piece-a', 'Fur Elise', NOW - 1_000, 0.7),
      storedAssessment('b1', 'piece-b', 'Clair de Lune', NOW - 2_000, 0.5),
      storedAssessment('a2', 'piece-a', 'Fur Elise', NOW - 3_000, 0.95),
      storedAssessment('a1', 'piece-a', 'Fur Elise', NOW - 5_000, 0.6),
    ]
    useProgressStore.setState({ assessments })

    const { container } = render(
      <DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />,
    )

    expect(screen.queryByTestId('dashboard-assessment-empty')).toBeNull()
    expect(screen.getByRole('img', { name: 'Assessment accuracy over time' })).toBeTruthy()
    const titles = [...container.querySelectorAll('circle title')].map((t) => t.textContent)
    expect(titles).toEqual([
      'Fur Elise run 1: 60%',
      'Fur Elise run 2: 95%',
      'Clair de Lune run 1: 50%',
      'Fur Elise run 3: 70%',
    ])

    expect(screen.getByTestId('dashboard-assessment-best-piece-a').textContent).toBe(
      'Fur Elise: 95%',
    )
    expect(screen.getByTestId('dashboard-assessment-best-piece-b').textContent).toBe(
      'Clair de Lune: 50%',
    )
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

describe('DashboardScreen — milestones (roadmap B.4, REQ-3.10.3)', () => {
  it('flips the first-hands-together milestone from in-progress to achieved once a real clean two-handed attempt is seeded', () => {
    const bothHandsDrill = techniqueLibrary(3).find((d) => d.hands === 'both')
    if (bothHandsDrill === undefined) {
      throw new Error('fixture assumption failed: no both-hands level-3 drill in the technique library')
    }
    const attempt: TechniqueAttempt = {
      drillId: bothHandsDrill.id,
      at: NOW - 1_000,
      bpm: bothHandsDrill.targetBpm,
      evenness: 1,
      accuracy: 1,
      clean: true,
    }
    useTechniqueStore.setState({ attempts: [attempt] })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('milestone-summary-count').textContent).toBe('1 of 5')
    expect(
      screen.getByTestId('milestone-achieved-detail-first-hands-together').textContent,
    ).toBe(bothHandsDrill.title)
    expect(screen.queryByTestId('milestone-progress-first-hands-together')).toBeNull()
  })
})

describe('DashboardScreen — level per track (roadmap 2.36, REQ-2.1/REQ-2.3)', () => {
  it('renders the real curriculum level and an "(overridden)" marker per track from useLevelStore', () => {
    useLevelStore.setState({
      levelState: {
        levels: { playing: 3, 'sight-reading': 2, theory: 4 },
        overridden: { playing: true, 'sight-reading': false, theory: false },
      },
    })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-level-playing').textContent).toContain('level 3')
    expect(screen.getByTestId('dashboard-level-playing').textContent).toContain('(overridden)')
    expect(screen.getByTestId('dashboard-level-theory').textContent).toContain('level 4')
    expect(screen.getByTestId('dashboard-level-theory').textContent).not.toContain('(overridden)')
    expect(screen.getByTestId('dashboard-level-sight-reading').textContent).toContain('level 2')
    expect(
      (screen.getByTestId('dashboard-level-select-playing') as HTMLSelectElement).value,
    ).toBe('3')
    expect(
      (screen.getByTestId('dashboard-level-select-theory') as HTMLSelectElement).value,
    ).toBe('4')
  })

  it('lets the learner override a track level (REQ-2.3): the select drives useLevelStore.setTrackLevel and the row follows', async () => {
    const user = userEvent.setup()
    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    // The override select lives behind the "Adjust level…" disclosure now
    // (UI-19: an escape hatch, not the primary UI) — open it before
    // interacting with the select inside.
    await user.click(screen.getByText('Adjust level…'))

    const playingSelect = screen.getByTestId('dashboard-level-select-playing') as HTMLSelectElement
    expect(screen.getByRole('combobox', { name: 'Playing level' })).toBe(playingSelect)
    expect([...playingSelect.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])

    await user.selectOptions(playingSelect, '5')

    expect(useLevelStore.getState().levelState.levels.playing).toBe(5)
    expect(useLevelStore.getState().levelState.overridden.playing).toBe(true)
    expect(screen.getByTestId('dashboard-level-playing').textContent).toContain('level 5')
    expect(screen.getByTestId('dashboard-level-playing').textContent).toContain('(overridden)')

    // The other two tracks are untouched — the override is per-track only.
    expect(useLevelStore.getState().levelState.levels.theory).toBe(
      initialLevelState().levels.theory,
    )
    expect(useLevelStore.getState().levelState.overridden.theory).toBe(false)
  })
})

describe('DashboardScreen — exit criteria checklist and Advance control (roadmap 2.36 second half, REQ-2.2)', () => {
  it('renders met and unmet criteria distinguishably, and disables Advance while a criterion is unmet', () => {
    // 'playing' at level 1 has an assessment check (met) and a technique
    // check (left unmet — no technique attempts seeded).
    useProgressStore.setState({
      assessments: [
        storedAssessment(
          'a1',
          'demo-five-finger-c-major-hands-separately',
          'Simple piece',
          NOW - 1_000,
          0.9,
        ),
      ],
    })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-criterion-status-playing-0').textContent).toBe('Met')
    expect(screen.getByTestId('dashboard-criterion-status-playing-1').textContent).toBe('Not met')

    // UI-19: the Advance button renders ONLY when it is actually enabled —
    // while a criterion is unmet, no button and no explainer box render at
    // all; the checklist above already shows which criterion is unmet.
    expect(screen.queryByTestId('dashboard-advance-playing')).toBeNull()
    expect(screen.queryByTestId('dashboard-advance-disabled-reason-playing')).toBeNull()
  })

  it('shows a per-track honest empty state, with no Advance control, for a track whose level has no authored content', () => {
    // Roadmap 3.24 authored levels 4-5 for THEORY only, so the uncovered case
    // is now a playing track placed there by override — theory at 5 has real
    // criteria and would no longer exercise this state at all.
    useLevelStore.setState({
      levelState: {
        levels: { playing: 5, 'sight-reading': 1, theory: 1 },
        overridden: { playing: true, 'sight-reading': false, theory: false },
      },
    })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-criteria-empty-playing')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-advance-playing')).toBeNull()
    // The other tracks still get a real checklist (whether or not any
    // criterion happens to be met yet is a separate question from whether the
    // curriculum covers this level at all — see the Advance-control describe
    // block above for that).
    expect(screen.queryByTestId('dashboard-criteria-empty-theory')).toBeNull()
    expect(screen.getByTestId('dashboard-criterion-theory-0')).toBeTruthy()
  })

  it('disables Advance on an overridden track even when every criterion is met, and states why', () => {
    // 'sight-reading' at level 1 needs level >= 1 and mean recent accuracy
    // >= 0.8 — both cleared, so every criterion is met, but the track was
    // placed manually, so advanceTrack no-ops and the control must say so.
    useSightReadingStore.setState({
      level: 1,
      history: [
        { pieceId: 'p1', readAt: NOW - 3_000, accuracy: 0.9, level: 1 },
        { pieceId: 'p2', readAt: NOW - 2_000, accuracy: 0.85, level: 1 },
        { pieceId: 'p3', readAt: NOW - 1_000, accuracy: 0.8, level: 1 },
      ],
    })
    useLevelStore.setState({
      levelState: {
        levels: { playing: 1, 'sight-reading': 1, theory: 1 },
        overridden: { playing: false, 'sight-reading': true, theory: false },
      },
    })

    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-criterion-status-sight-reading-0').textContent).toBe(
      'Met',
    )
    // UI-19: overridden means no Advance button renders at all (it would
    // no-op), but the reason IS still shown — unlike the "criteria not met"
    // case, nothing else on this card already says "manually placed".
    expect(screen.queryByTestId('dashboard-advance-sight-reading')).toBeNull()
    expect(
      screen.getByTestId('dashboard-advance-disabled-reason-sight-reading').textContent,
    ).toBe('This track was placed manually and will not auto-advance.')

    expect(useLevelStore.getState().levelState.levels['sight-reading']).toBe(1)
  })

  it('makes REQ-2.2 real: clicking Advance when every criterion is met moves the level in the store', async () => {
    // Same fully-met 'sight-reading' evidence as above, but NOT overridden —
    // Advance must be enabled and clicking it must actually move the level.
    useSightReadingStore.setState({
      level: 1,
      history: [
        { pieceId: 'p1', readAt: NOW - 3_000, accuracy: 0.9, level: 1 },
        { pieceId: 'p2', readAt: NOW - 2_000, accuracy: 0.85, level: 1 },
        { pieceId: 'p3', readAt: NOW - 1_000, accuracy: 0.8, level: 1 },
      ],
    })

    const user = userEvent.setup()
    render(<DashboardScreen date={new FakeDateSource(NOW)} utcOffsetMinutes={0} />)

    expect(screen.getByTestId('dashboard-criterion-status-sight-reading-0').textContent).toBe(
      'Met',
    )
    const advanceButton = screen.getByTestId(
      'dashboard-advance-sight-reading',
    ) as HTMLButtonElement
    expect(advanceButton.disabled).toBe(false)
    expect(
      screen.queryByTestId('dashboard-advance-disabled-reason-sight-reading'),
    ).toBeNull()

    expect(useLevelStore.getState().levelState.levels['sight-reading']).toBe(1)
    await user.click(advanceButton)
    expect(useLevelStore.getState().levelState.levels['sight-reading']).toBe(2)
    expect(useLevelStore.getState().levelState.overridden['sight-reading']).toBe(false)
  })
})
