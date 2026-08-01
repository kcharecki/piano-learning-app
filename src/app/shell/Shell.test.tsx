/**
 * Shell navigation (roadmap 1.17, REQ-4.6): four destinations, only Practice
 * live. `ScoreScreen` pulls in the OSMD-backed viewer, so it is mocked here —
 * this file only asserts on navigation wiring.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

const { Shell } = await import('./Shell.tsx')

afterEach(() => {
  cleanup()
})

describe('Shell', () => {
  it('shows Practice as the active, live screen by default', () => {
    render(<Shell />)
    expect(screen.getByRole('button', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })

  it.each([
    ['Sight reading', '2.12'],
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
