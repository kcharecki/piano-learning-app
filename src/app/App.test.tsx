import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App.tsx'

describe('App', () => {
  it('renders the app shell', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /piano learning app/i })).toBeInTheDocument()
    expect(screen.getByTestId('status')).toBeInTheDocument()
  })
})
