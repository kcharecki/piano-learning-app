import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import {
  FLASHCARDS_COLLECTION,
  FLASHCARDS_KEY,
  SESSION_COLLECTION,
  SESSION_KEY,
  SIGHT_READING_COLLECTION,
  SIGHT_READING_KEY,
  type PersistedFlashcards,
  type PersistedSightReadingHistory,
} from '@app/state/persistence.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { Store } from '@core/ports/index.ts'
import { C_MAJOR_SCALE_RH } from '@test/fixtures.ts'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

const { App } = await import('./App.tsx')

/** In-memory `Store`, enough to prove the app talks to the port at all. */
function fakeStore(
  seed?: unknown,
  extraSeeds: Readonly<Record<string, unknown>> = {},
): Store & { readonly writes: unknown[] } {
  const data = new Map<string, unknown>()
  if (seed !== undefined) data.set(`${SESSION_COLLECTION}/${SESSION_KEY}`, seed)
  for (const [key, value] of Object.entries(extraSeeds)) data.set(key, value)
  const writes: unknown[] = []
  return {
    writes,
    get: async <T,>(collection: string, id: string) =>
      data.get(`${collection}/${id}`) as T | undefined,
    getAll: async <T,>() => [...data.values()] as T[],
    put: async (collection: string, id: string, value: unknown) => {
      data.set(`${collection}/${id}`, value)
      writes.push(value)
    },
    delete: async (collection: string, id: string) => void data.delete(`${collection}/${id}`),
    clear: async () => data.clear(),
    collections: async () => [SESSION_COLLECTION],
  }
}

const SAVED_SESSION = {
  score: C_MAJOR_SCALE_RH,
  sourceName: 'a score saved in an earlier session',
  musicXml: undefined,
  settings: {
    tempoScale: 0.75,
    activeHands: ['right'],
    metronomeEnabled: true,
    loop: undefined,
  },
}

afterEach(() => {
  cleanup()
  useScoreStore.setState({
    loaded: undefined,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
})

describe('App', () => {
  it('renders the shell with the nav and the live Practice screen', () => {
    render(<App openStore={async () => fakeStore()} />)
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })

  // Roadmap 1.23. These two are the reachability tests for persistence: the
  // module and the IndexedDB adapter behind it were both fully built and tested
  // while NOTHING constructed them, which is this project's most expensive
  // defect class. Deleting either half of the effect in `App.tsx` fails one.
  it('restores the previous session on start', async () => {
    render(<App openStore={async () => fakeStore(SAVED_SESSION)} />)

    await waitFor(() => {
      expect(useScoreStore.getState().loaded?.sourceName).toBe(SAVED_SESSION.sourceName)
    })
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.75)
    expect(useScoreStore.getState().settings.activeHands).toEqual(['right'])
    expect(useScoreStore.getState().settings.metronomeEnabled).toBe(true)
  })

  it('writes the session back when the practice settings change', async () => {
    const store = fakeStore(SAVED_SESSION)
    render(<App openStore={async () => store} />)
    await waitFor(() => {
      expect(useScoreStore.getState().loaded).toBeDefined()
    })

    useScoreStore.getState().setTempoScale(1.5)

    await waitFor(() => {
      expect(store.writes).toHaveLength(1)
    })
    expect(store.writes[0]).toMatchObject({ settings: { tempoScale: 1.5 } })
  })

  // Roadmap 1.24 — the same reachability concern as the two tests above,
  // now for the two slices added to fix REQ-3.4.3/3.4.6 (sight-reading level
  // + retirement history) and REQ-3.9.4 (SRS flashcard state) not persisting
  // at all: it is not enough for `persistence.ts` to know how to restore
  // them if `App.tsx` never actually calls it with real data present.
  it('restores the sight-reading and flashcard state on start', async () => {
    const savedHistory: PersistedSightReadingHistory = {
      level: 3,
      history: [{ pieceId: 'p1', readAt: 111, accuracy: 0.95, level: 2 }],
    }
    const savedCards: PersistedFlashcards = {
      cardsById: {
        'staff-to-key-60': {
          id: 'staff-to-key-60',
          due: 222,
          intervalDays: 6,
          ease: 2.6,
          reps: 2,
          lapses: 0,
          introducedAt: 100,
        },
      },
    }
    const store = fakeStore(undefined, {
      [`${SIGHT_READING_COLLECTION}/${SIGHT_READING_KEY}`]: savedHistory,
      [`${FLASHCARDS_COLLECTION}/${FLASHCARDS_KEY}`]: savedCards,
    })

    render(<App openStore={async () => store} />)

    await waitFor(() => {
      expect(useSightReadingStore.getState().level).toBe(3)
    })
    expect(useSightReadingStore.getState().history).toEqual(savedHistory.history)
    expect(useFlashcardStore.getState().cardsById).toEqual(savedCards.cardsById)
  })
})
