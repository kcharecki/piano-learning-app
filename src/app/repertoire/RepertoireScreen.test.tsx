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
import { GRADED_PIECES, PROVENANCE_LABELS } from '@content/repertoire/gradedPieces.ts'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialLevelState } from '@core/progress/levels.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useScoreStore, type LoadedScore } from '@app/state/scoreStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { RepertoireScreen } from './RepertoireScreen.tsx'

function resetStores(): void {
  useRepertoireStore.setState({ pieces: [] })
  useScoreStore.setState({ loaded: undefined, importError: undefined })
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
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

  it('roadmap 5.52: a catalogue row discloses its own piece-specific provenance, not a generic disclaimer', () => {
    renderScreen()
    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })

    // A source-verified piece and a stylistic-excerpt piece must read
    // differently — proving the line is per-piece, not boilerplate true of
    // every row (the same standard e2e/repertoire-provenance.spec.ts holds
    // the running app to).
    const verified = GRADED_PIECES.find((p) => p.provenance.tier === 'source-verified')
    const excerpt = GRADED_PIECES.find((p) => p.provenance.tier === 'stylistic-excerpt')
    if (verified === undefined || excerpt === undefined) {
      throw new Error('expected both a source-verified and a stylistic-excerpt catalogue entry')
    }

    const verifiedRow = within(catalogueRegion).getByText(verified.title).closest('li')
    const excerptRow = within(catalogueRegion).getByText(excerpt.title).closest('li')
    if (verifiedRow === null || excerptRow === null) {
      throw new Error('expected both catalogue rows to render as list items')
    }

    const verifiedText = within(verifiedRow as HTMLElement).getByText(
      new RegExp(PROVENANCE_LABELS['source-verified']),
    ).textContent
    const excerptText = within(excerptRow as HTMLElement).getByText(
      new RegExp(PROVENANCE_LABELS['stylistic-excerpt']),
    ).textContent

    expect(verifiedText).not.toBe(excerptText)
    expect(excerptText).toMatch(/not a verified transcription/i)
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

  it('the "Below my level" filter shows only catalogue pieces strictly below the playing track level (roadmap 5.3)', async () => {
    act(() => {
      useLevelStore.getState().setTrackLevel('playing', 3)
    })
    renderScreen()
    const user = userEvent.setup()
    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })

    const level1Entry = GRADED_PIECES.find((p) => p.level === 1)
    const level4Entry = GRADED_PIECES.find((p) => p.level === 4)
    if (level1Entry === undefined || level4Entry === undefined) {
      throw new Error('expected seeded catalogue entries at level 1 and level 4')
    }
    // Unfiltered: both a below-level and an at-or-above-level piece show.
    expect(within(catalogueRegion).getByText(level1Entry.title)).toBeInTheDocument()
    expect(within(catalogueRegion).getByText(level4Entry.title)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Below my level/ }))

    expect(within(catalogueRegion).getByText(level1Entry.title)).toBeInTheDocument()
    expect(within(catalogueRegion).queryByText(level4Entry.title)).not.toBeInTheDocument()
  })

  it('the "Below my level" filter shows an honest empty state for a level-1 learner (nothing exists below level 1)', async () => {
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /Below my level/ }))

    expect(screen.getByText('No catalogue pieces below level 1 yet.')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // Roadmap UI-18 (2026-08-12 UI audit): "the worst screen in the app" —
  // catalogue rows concatenated title + attribution + level with no
  // separators, the two library sections had no visual distinction, and there
  // was no search or level grouping. The tests below are the new acceptance
  // criteria this redesign adds; every test above this comment still covers
  // the pre-existing wiring (add/status/notes/due/provenance/filter), now
  // driven against the redesigned markup.
  // ---------------------------------------------------------------------

  it('keeps a catalogue row\'s title, composer and level as separate DOM elements, not one concatenated text node (acceptance criterion 1)', () => {
    renderScreen()
    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })
    const firstEntry = GRADED_PIECES[0]
    if (firstEntry === undefined) throw new Error('expected a seeded catalogue entry')
    const row = within(catalogueRegion).getByText(firstEntry.title).closest('li')
    if (row === null) throw new Error('expected the catalogue row to render as a list item')

    const titleEl = within(row as HTMLElement).getByText(firstEntry.title)
    const composerEl = within(row as HTMLElement).getByText(firstEntry.composer)
    const levelEl = within(row as HTMLElement).getByText(`Level ${firstEntry.level}`)

    // Three distinct DOM nodes, not one merged string that CSS alone splits
    // apart visually.
    expect(titleEl).not.toBe(composerEl)
    expect(composerEl).not.toBe(levelEl)
    expect(titleEl.textContent).toBe(firstEntry.title)
    expect(composerEl.textContent).toBe(firstEntry.composer)
    expect(titleEl.textContent).not.toContain(firstEntry.composer)
    expect(composerEl.textContent).not.toContain(firstEntry.title)
  })

  it('groups the catalogue by level, with a header per level read from the curriculum\'s own labels (acceptance criterion 3)', () => {
    renderScreen()
    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })

    expect(within(catalogueRegion).getByText(/^Level 1 —/)).toBeInTheDocument()
    expect(within(catalogueRegion).getByText(/^Level 5 —/)).toBeInTheDocument()
  })

  it('searching the Library narrows the catalogue to matching pieces live (acceptance criterion 3)', async () => {
    renderScreen()
    const user = userEvent.setup()
    const catalogueRegion = screen.getByRole('region', { name: 'Graded library' })

    await user.type(screen.getByLabelText('Search'), 'twinkle')

    const rows = within(catalogueRegion)
      .getAllByRole('listitem')
      .filter((li) => !li.classList.contains('repertoire-level-header'))
    expect(rows).toHaveLength(1)
    expect(within(catalogueRegion).getByText('Twinkle, Twinkle, Little Star')).toBeInTheDocument()
  })

  it('an unmatched search shows an honest empty state naming the query', async () => {
    renderScreen()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Search'), 'not-a-real-piece-xyz')

    expect(screen.getByText('No pieces match "not-a-real-piece-xyz".')).toBeInTheDocument()
  })

  it('the My pieces and Review due empty states each teach the next action (rule 6)', () => {
    renderScreen()
    const screenRegion = screen.getByRole('region', { name: 'Repertoire' })
    expect(
      within(screenRegion).getByText(/No pieces in your library yet — add the score you have loaded above\./),
    ).toBeInTheDocument()

    const dueRegion = screen.getByRole('region', { name: 'Review due' })
    expect(within(dueRegion).getByText('Nothing due for review.')).toBeInTheDocument()
    expect(within(dueRegion).getByText(/maintained/i)).toBeInTheDocument()
  })

  it('shows a review-due badge on the My pieces row for an overdue maintained piece, and not for a recently-practised one', () => {
    useRepertoireStore.setState({
      pieces: [maintainedPiece('overdue', 'Overdue Piece', 30), maintainedPiece('recent', 'Recent Piece', 3)],
    })
    renderScreen()
    const library = screen.getByRole('list', { name: 'Repertoire pieces' })

    const overdueRow = within(library).getByText('Overdue Piece').closest('li')
    const recentRow = within(library).getByText('Recent Piece').closest('li')
    if (overdueRow === null || recentRow === null) {
      throw new Error('expected both piece rows to render as list items')
    }

    expect(within(overdueRow as HTMLElement).getByText('Review due')).toBeInTheDocument()
    expect(within(recentRow as HTMLElement).queryByText('Review due')).not.toBeInTheDocument()
  })
})
