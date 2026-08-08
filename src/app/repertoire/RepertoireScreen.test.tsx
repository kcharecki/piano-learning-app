/**
 * RepertoireScreen (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4): thin wiring
 * assertions only — the two required regions render with their accessible
 * roles/labels, the Add control is honestly disabled/enabled, a Status
 * change round-trips through the store into the rendered option, and the
 * "Review due" section (REQ-3.8.4, roadmap 4.5's own proof action) shows an
 * overdue 'maintained' piece but not a recently-practised one. Behaviour
 * itself (what counts as due, status validity) is core's job and is tested
 * there and in `useRepertoire.test.ts`.
 */
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import type { Score } from '@core/notation/score.ts'
import { DAY_MS } from '@core/srs/scheduler.ts'
import { ticks } from '@core/shared/units.ts'
import { GRADED_PIECES } from '@content/repertoire/gradedPieces.ts'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useScoreStore, type LoadedScore } from '@app/state/scoreStore.ts'
import { RepertoireScreen } from './RepertoireScreen.tsx'

function resetStores(): void {
  useRepertoireStore.setState({ pieces: [] })
  useScoreStore.setState({ loaded: undefined, importError: undefined })
}

afterEach(() => {
  cleanup()
  resetStores()
})

function fakeScore(id: string, title: string, composer: string): Score {
  return {
    id,
    meta: { title, composer },
    measures: [],
    notes: [],
    tempos: [],
    staves: [],
    maxNoteDurationTicks: ticks(0),
  }
}

function load(score: Score): LoadedScore {
  return { score, sourceName: 'imported.xml', musicXml: '<score/>' }
}

function maintainedPiece(id: string, title: string, daysAgo: number): RepertoirePiece {
  return {
    id,
    title,
    composer: 'Composer',
    level: 1,
    status: 'maintained',
    sessions: [{ at: Date.now() - daysAgo * DAY_MS, minutes: 10 }],
    bestAccuracy: 0,
    notes: '',
  }
}

function renderScreen(onOpenInPractice: () => void = () => {}) {
  return render(<RepertoireScreen onOpenInPractice={onOpenInPractice} />)
}

describe('RepertoireScreen', () => {
  it('renders the Repertoire and Review due regions', () => {
    renderScreen()

    expect(screen.getByRole('region', { name: 'Repertoire' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Review due' })).toBeInTheDocument()
  })

  it('disables Add loaded score until a score is loaded and not yet in the library', async () => {
    renderScreen()
    expect(screen.getByRole('button', { name: 'Add loaded score' })).toBeDisabled()

    act(() => {
      useScoreStore.setState({ loaded: load(fakeScore('score-x', 'Test Piece', 'Composer X')) })
    })
    expect(screen.getByRole('button', { name: 'Add loaded score' })).toBeEnabled()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add loaded score' }))
    expect(screen.getByRole('button', { name: 'Add loaded score' })).toBeDisabled()
  })

  it('changing the Status select calls through to the store and updates the rendered status', async () => {
    useRepertoireStore.setState({ pieces: [maintainedPiece('piece-1', 'Moonlight Sonata', 0)] })
    renderScreen()
    const user = userEvent.setup()

    const statusSelect = screen.getByRole('combobox', { name: 'Status' })
    expect(statusSelect).toHaveValue('maintained')

    await user.selectOptions(statusSelect, 'learning')

    expect(statusSelect).toHaveValue('learning')
    expect(useRepertoireStore.getState().pieces[0]?.status).toBe('learning')
  })

  it('lists an overdue maintained piece under Review due but not a recently-practised one', () => {
    useRepertoireStore.setState({
      pieces: [
        maintainedPiece('overdue', 'Overdue Piece', 30),
        maintainedPiece('recent', 'Recent Piece', 3),
      ],
    })
    renderScreen()

    const dueRegion = screen.getByRole('region', { name: 'Review due' })
    expect(within(dueRegion).getByText(/Overdue Piece/)).toBeInTheDocument()
    expect(within(dueRegion).queryByText(/Recent Piece/)).not.toBeInTheDocument()
  })

  it('renders the Graded library region listing the shipped catalogue', () => {
    renderScreen()

    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })
    const firstEntry = GRADED_PIECES[0]
    if (firstEntry === undefined) throw new Error('expected a seeded catalogue entry')
    expect(within(catalogueRegion).getByText(firstEntry.title)).toBeInTheDocument()
    expect(within(catalogueRegion).getByText(firstEntry.composer)).toBeInTheDocument()

    const row = within(catalogueRegion).getByText(firstEntry.title).closest('li')
    if (row === null) throw new Error('expected the catalogue row to render as a list item')
    expect(within(row as HTMLElement).getByText(`Level ${firstEntry.level}`)).toBeInTheDocument()
  })

  it('an Add click on a catalogue piece reaches the store and the row flips to already-added', async () => {
    renderScreen()
    const user = userEvent.setup()
    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })
    const firstEntry = GRADED_PIECES[0]
    if (firstEntry === undefined) throw new Error('expected a seeded catalogue entry')
    const row = within(catalogueRegion).getByText(firstEntry.title).closest('li')
    if (row === null) throw new Error('expected the catalogue row to render as a list item')

    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Add' }))

    expect(useRepertoireStore.getState().pieces.map((p) => p.id)).toContain(firstEntry.id)
    expect(within(row as HTMLElement).getByText('Already in your library')).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('a catalogue piece already in the library renders as already-added on first render', () => {
    const firstEntry = GRADED_PIECES[0]
    if (firstEntry === undefined) throw new Error('expected a seeded catalogue entry')
    useRepertoireStore.setState({
      pieces: [
        {
          id: firstEntry.id,
          title: firstEntry.title,
          composer: firstEntry.composer,
          level: firstEntry.level,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
        },
      ],
    })
    renderScreen()

    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })
    const row = within(catalogueRegion).getByText(firstEntry.title).closest('li')
    if (row === null) throw new Error('expected the catalogue row to render as a list item')
    expect(within(row as HTMLElement).getByText('Already in your library')).toBeInTheDocument()
  })

  it('shows Open in Practice for a piece with a resolvable scoreId but not for one without', () => {
    const firstEntry = GRADED_PIECES[0]
    if (firstEntry === undefined) throw new Error('expected a seeded catalogue entry')
    if (firstEntry.scoreId === undefined) throw new Error('expected the seeded entry to carry a scoreId')
    useRepertoireStore.setState({
      pieces: [
        {
          id: firstEntry.id,
          title: firstEntry.title,
          composer: firstEntry.composer,
          level: firstEntry.level,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
          scoreId: firstEntry.scoreId,
        },
        {
          id: 'loaded-score-piece',
          title: 'No bundled score',
          composer: 'Composer',
          level: 1,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
          // Mirrors addLoadedScore's convention of using the loaded score's own
          // id as scoreId — never a bundled catalogue file.
          scoreId: 'loaded-score-piece',
        },
      ],
    })
    renderScreen()

    const libraryRegion = screen.getByRole('list', { name: 'Repertoire pieces' })
    const openableRow = within(libraryRegion).getByText(firstEntry.title).closest('li')
    const unopenableRow = within(libraryRegion).getByText('No bundled score').closest('li')
    if (openableRow === null || unopenableRow === null) {
      throw new Error('expected both piece rows to render as list items')
    }

    expect(
      within(openableRow as HTMLElement).getByRole('button', { name: 'Open in Practice' }),
    ).toBeInTheDocument()
    expect(
      within(unopenableRow as HTMLElement).queryByRole('button', { name: 'Open in Practice' }),
    ).not.toBeInTheDocument()
  })

  it('clicking Open in Practice loads the score then calls onOpenInPractice', async () => {
    const firstEntry = GRADED_PIECES[0]
    if (firstEntry === undefined) throw new Error('expected a seeded catalogue entry')
    if (firstEntry.scoreId === undefined) throw new Error('expected the seeded entry to carry a scoreId')
    useRepertoireStore.setState({
      pieces: [
        {
          id: firstEntry.id,
          title: firstEntry.title,
          composer: firstEntry.composer,
          level: firstEntry.level,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
          scoreId: firstEntry.scoreId,
        },
      ],
    })
    const onOpenInPractice = vi.fn()
    renderScreen(onOpenInPractice)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Open in Practice' }))

    expect(useScoreStore.getState().loaded?.sourceName).toBe(firstEntry.title)
    expect(useScoreStore.getState().loaded?.score.id).toBe(firstEntry.scoreId)
    expect(onOpenInPractice).toHaveBeenCalledTimes(1)
  })
})
