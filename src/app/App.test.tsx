import { useScoreStore } from '@app/state/scoreStore.ts'
import { SESSION_COLLECTION, SESSION_KEY } from '@app/state/persistence.ts'
import type { Store } from '@core/ports/index.ts'
import { C_MAJOR_SCALE_RH } from '@test/fixtures.ts'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

const { App } = await import('./App.tsx')

/** In-memory `Store`, enough to prove the app talks to the port at all. */
function fakeStore(seed?: unknown): Store & { readonly writes: unknown[] } {
  const data = new Map<string, unknown>()
  if (seed !== undefined) data.set(`${SESSION_COLLECTION}/${SESSION_KEY}`, seed)
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
})
