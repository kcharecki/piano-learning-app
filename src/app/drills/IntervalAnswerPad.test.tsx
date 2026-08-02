/**
 * `IntervalAnswerPad` (roadmap 2.25) — every interval `buildIntervalDeck` can
 * draw gets a real, labelled, keyboard-reachable button, and clicking one
 * calls `onAnswer` with exactly that `{ number, quality }`.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntervalAnswerPad } from './IntervalAnswerPad.tsx'

afterEach(cleanup)

describe('IntervalAnswerPad', () => {
  it('is an accessible, named group', () => {
    render(<IntervalAnswerPad onAnswer={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()
  })

  it('renders a readable button for every interval the deck can draw, and none for a unison', () => {
    render(<IntervalAnswerPad onAnswer={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Major 3rd' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minor 3rd' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minor 2nd' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Major 2nd' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perfect 4th' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Augmented 4th' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perfect 5th' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perfect 8th' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /1st/ })).toBeNull()
  })

  it('clicking a button answers with exactly that number and quality', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerPad onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'Major 3rd' }))

    expect(onAnswer).toHaveBeenCalledWith({ number: 3, quality: 'major' })
  })

  it('is keyboard reachable — tabbing to a button and pressing Enter activates it', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerPad onAnswer={onAnswer} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Minor 2nd' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onAnswer).toHaveBeenCalledWith({ number: 2, quality: 'minor' })
  })
})
