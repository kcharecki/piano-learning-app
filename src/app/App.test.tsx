import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

const { App } = await import('./App.tsx')

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('renders the shell with the nav and the live Practice screen', () => {
    render(<App />)
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })
})
