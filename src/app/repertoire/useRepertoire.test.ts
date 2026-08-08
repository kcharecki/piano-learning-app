/**
 * useRepertoire (roadmap 2.33, REQ-3.8.2/3.8.3/3.8.4): every assertion here
 * either drives a real store round-trip (adding the loaded score, the
 * already-added/duplicate-id error path) or recomputes the expected value
 * with the same core function the hook uses (`maintenanceDue`,
 * `daysSincePractice`), so a hook that stopped calling through to core would
 * fail here even though the underlying domain module stays green.
 */
import type { DateSource } from '@core/ports/index.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import type { Score } from '@core/notation/score.ts'
import { ticks } from '@core/shared/units.ts'
import { GRADED_PIECES } from '@content/repertoire/gradedPieces.ts'
import { cleanup, renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useScoreStore, type LoadedScore } from '@app/state/scoreStore.ts'
import { useRepertoire } from './useRepertoire.ts'

class FakeDateSource implements DateSource {
  private readonly current: number
  constructor(current: number) {
    this.current = current
  }
  epochMillis(): number {
    return this.current
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
// Arbitrary fixed instant, far from epoch 0 — production onset/session
// timestamps are never 0-based, and a 0-based `now` would make an
// off-by-one in a `- daysAgo * DAY_MS` computation land on a suspiciously
// round number instead of visibly failing.
const NOW = 1_700_000_000_000

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

function load(score: Score, sourceName = 'imported.xml'): LoadedScore {
  return { score, sourceName, musicXml: '<score/>' }
}

/** A `RepertoirePiece` built directly (bypassing the store's own setters) so
 * `due`/`daysSince` tests can plant an exact practice history without going
 * through `recordSession`'s unknown-id invariant. */
function maintainedPiece(id: string, daysAgo: number | undefined): RepertoirePiece {
  return {
    id,
    title: `Piece ${id}`,
    composer: '',
    level: 1,
    status: 'maintained',
    sessions: daysAgo === undefined ? [] : [{ at: NOW - daysAgo * DAY_MS, minutes: 10 }],
    bestAccuracy: 0,
    notes: '',
  }
}

describe('useRepertoire', () => {
  it('adds the currently loaded score to the store under the score\'s own id', () => {
    const score = fakeScore('score-1', 'Für Elise', 'Beethoven')
    useScoreStore.setState({ loaded: load(score) })

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addLoadedScore(3))

    const pieces = useRepertoireStore.getState().pieces
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({
      id: 'score-1',
      scoreId: 'score-1',
      title: 'Für Elise',
      composer: 'Beethoven',
      level: 3,
    })
  })

  it('is a no-op when nothing is loaded', () => {
    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addLoadedScore(2))

    expect(useRepertoireStore.getState().pieces).toHaveLength(0)
    expect(result.current.addError).toBeUndefined()
  })

  it('sets addError and reports loadedScoreAlreadyAdded on a second add of the same score', () => {
    const score = fakeScore('score-2', 'Clair de Lune', 'Debussy')
    useScoreStore.setState({ loaded: load(score) })

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addLoadedScore(1))
    expect(result.current.addError).toBeUndefined()
    expect(result.current.loadedScoreAlreadyAdded).toBe(true)

    act(() => result.current.addLoadedScore(1))
    expect(result.current.addError).toBeDefined()
    expect(useRepertoireStore.getState().pieces).toHaveLength(1)
  })

  it('drives `due` from a fixed DateSource: 30 days since practice is due, 3 days is not', () => {
    useRepertoireStore.setState({
      pieces: [maintainedPiece('overdue', 30), maintainedPiece('recent', 3)],
    })

    const { result } = renderHook(() => useRepertoire({ date: new FakeDateSource(NOW) }))

    expect(result.current.due.map((p) => p.id)).toEqual(['overdue'])
  })

  it('daysSince returns null for a never-practised piece', () => {
    useRepertoireStore.setState({ pieces: [maintainedPiece('fresh', undefined)] })
    const { result } = renderHook(() => useRepertoire({ date: new FakeDateSource(NOW) }))

    const piece = result.current.pieces[0]
    if (piece === undefined) throw new Error('expected the seeded piece')
    expect(result.current.daysSince(piece)).toBeNull()
  })

  it('daysSince returns the real elapsed days for a practised piece', () => {
    useRepertoireStore.setState({ pieces: [maintainedPiece('practised', 3)] })
    const { result } = renderHook(() => useRepertoire({ date: new FakeDateSource(NOW) }))

    const piece = result.current.pieces[0]
    if (piece === undefined) throw new Error('expected the seeded piece')
    expect(result.current.daysSince(piece)).toBeCloseTo(3, 9)
  })

  it('addFromCatalogue lands a real RepertoirePiece preserving the catalogue level and composer', () => {
    const catalogueEntry = GRADED_PIECES.find((p) => p.level === 5)
    if (catalogueEntry === undefined) throw new Error('expected a seeded catalogue entry')

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addFromCatalogue(catalogueEntry.id))

    const pieces = useRepertoireStore.getState().pieces
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({
      id: catalogueEntry.id,
      title: catalogueEntry.title,
      composer: catalogueEntry.composer,
      level: catalogueEntry.level,
      status: 'learning',
    })
    expect(result.current.addError).toBeUndefined()
    expect(result.current.catalogueAddedIds.has(catalogueEntry.id)).toBe(true)
  })

  it('addFromCatalogue twice surfaces the duplicate error instead of throwing or double-inserting', () => {
    const catalogueEntry = GRADED_PIECES[0]
    if (catalogueEntry === undefined) throw new Error('expected a seeded catalogue entry')

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addFromCatalogue(catalogueEntry.id))
    expect(result.current.addError).toBeUndefined()

    act(() => result.current.addFromCatalogue(catalogueEntry.id))
    expect(result.current.addError).toBeDefined()
    expect(useRepertoireStore.getState().pieces).toHaveLength(1)
  })

  it('exposes the full catalogue, sorted ascending by level then title', () => {
    const { result } = renderHook(() => useRepertoire())
    const catalogue = result.current.catalogue
    const sorted = [...catalogue].sort(
      (a, b) => a.level - b.level || a.title.localeCompare(b.title),
    )
    expect(catalogue).toEqual(sorted)
    expect(catalogue.length).toBeGreaterThanOrEqual(20)
    expect(result.current.catalogueAddedIds.size).toBe(0)
  })

  it('addFromCatalogue is a no-op for an id not in GRADED_PIECES', () => {
    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addFromCatalogue('not-a-catalogue-id'))

    expect(useRepertoireStore.getState().pieces).toHaveLength(0)
    expect(result.current.addError).toBeUndefined()
  })

  it('canOpenInPractice is true for a piece added from the graded catalogue', () => {
    const catalogueEntry = GRADED_PIECES[0]
    if (catalogueEntry === undefined) throw new Error('expected a seeded catalogue entry')

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addFromCatalogue(catalogueEntry.id))

    const piece = result.current.pieces.find((p) => p.id === catalogueEntry.id)
    if (piece === undefined) throw new Error('expected the added piece')
    expect(result.current.canOpenInPractice(piece)).toBe(true)
  })

  it('canOpenInPractice is false for a piece with no scoreId, and for one with a scoreId that resolves to no bundled file', () => {
    useRepertoireStore.setState({
      pieces: [
        {
          id: 'no-score-id',
          title: 'No score id',
          composer: '',
          level: 1,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
        },
        {
          id: 'unresolvable',
          title: 'Unresolvable',
          composer: '',
          level: 1,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
          scoreId: 'not-a-bundled-score-id',
        },
      ],
    })

    const { result } = renderHook(() => useRepertoire())
    const [noScoreId, unresolvable] = result.current.pieces
    if (noScoreId === undefined || unresolvable === undefined) {
      throw new Error('expected both seeded pieces')
    }
    expect(result.current.canOpenInPractice(noScoreId)).toBe(false)
    expect(result.current.canOpenInPractice(unresolvable)).toBe(false)
  })

  it('openInPractice loads the piece\'s bundled score into scoreStore under the piece\'s title', () => {
    const catalogueEntry = GRADED_PIECES[0]
    if (catalogueEntry === undefined) throw new Error('expected a seeded catalogue entry')

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.addFromCatalogue(catalogueEntry.id))
    act(() => result.current.openInPractice(catalogueEntry.id))

    const loaded = useScoreStore.getState().loaded
    if (loaded === undefined) throw new Error('expected openInPractice to load a score')
    expect(loaded.sourceName).toBe(catalogueEntry.title)
    expect(loaded.score.id).toBe(catalogueEntry.scoreId)
    expect(loaded.musicXml).toBeDefined()
  })

  it('openInPractice is a no-op when the piece cannot be opened in practice', () => {
    useRepertoireStore.setState({
      pieces: [
        {
          id: 'no-score-id',
          title: 'No score id',
          composer: '',
          level: 1,
          status: 'learning',
          sessions: [],
          bestAccuracy: 0,
          notes: '',
        },
      ],
    })

    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.openInPractice('no-score-id'))

    expect(useScoreStore.getState().loaded).toBeUndefined()
  })

  it('openInPractice is a no-op for an unknown piece id', () => {
    const { result } = renderHook(() => useRepertoire())
    act(() => result.current.openInPractice('not-a-piece-id'))

    expect(useScoreStore.getState().loaded).toBeUndefined()
  })
})
