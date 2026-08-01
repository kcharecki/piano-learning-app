/**
 * Shell navigation (roadmap 1.17, 2.12, REQ-4.6): five destinations —
 * Practice, Sight reading and Flashcards are real screens; Theory and
 * Progress are still honest placeholders. `ScoreScreen` pulls in the
 * OSMD-backed viewer, so it is mocked here — this file only asserts on
 * navigation wiring. Sight reading and Flashcards are cheap enough to render
 * for real (no OSMD, no audio/MIDI access started until a user acts), so
 * this is also the regression test for roadmap 1.18's own lesson: a screen
 * built and tested in isolation but never mounted by the shell is
 * unreachable. See `e2e/smoke.spec.ts` for the real-browser proof.
 */
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

const { Shell } = await import('./Shell.tsx')

function resetStores(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('Shell', () => {
  it('shows Practice as the active, live screen by default', () => {
    render(<Shell />)
    expect(screen.getByRole('button', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })

  it('reaches the real sight-reading trainer through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Sight reading' }))

    expect(screen.getByRole('button', { name: 'Sight reading' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Sight reading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start exercise' })).toBeInTheDocument()
  })

  it('reaches the real flashcard drill through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Flashcards' }))

    expect(screen.getByRole('button', { name: 'Flashcards' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Flashcards' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /staff/i })).toBeInTheDocument()
  })

  it.each([
    ['Theory', '3.8'],
    ['Progress', '4.7'],
  ])('renders an honest "not built yet" panel for %s naming task %s', async (label, task) => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.queryByTestId('mock-score-screen')).toBeNull()
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(/not built yet/i)).toBeInTheDocument()
    expect(screen.getByText(task)).toBeInTheDocument()
  })

  it('switches back to Practice', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Theory' }))
    await user.click(screen.getByRole('button', { name: 'Practice' }))

    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })
})
