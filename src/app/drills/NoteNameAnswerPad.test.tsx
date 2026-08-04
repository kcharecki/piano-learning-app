/**
 * `NoteNameAnswerPad` (roadmap 3.11, REQ-3.5.2) — every pitch class
 * `buildNoteNameDeck` can draw gets a real, labelled, keyboard-reachable
 * button, and clicking one calls `onAnswer` with exactly that
 * `{ letter, alter }` — the same canonical (sharps-preferred) spelling the
 * deck itself answers with.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteNameAnswerPad } from './NoteNameAnswerPad.tsx'

afterEach(cleanup)

describe('NoteNameAnswerPad', () => {
  it('is an accessible, named group', () => {
    render(<NoteNameAnswerPad onAnswer={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Note name answer' })).toBeInTheDocument()
  })

  it('renders a readable button for every pitch class the deck can draw: 7 naturals and 5 sharps', () => {
    render(<NoteNameAnswerPad onAnswer={vi.fn()} />)

    for (const letter of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
      expect(screen.getByRole('button', { name: letter })).toBeInTheDocument()
    }
    for (const label of ['C♯', 'D♯', 'F♯', 'G♯', 'A♯']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // Never offers a flat spelling or a double accidental — buildNoteNameDeck
    // always answers with fromMidi's canonical sharps-preferred spelling, so
    // a stub that also renders flat buttons would fail this (12 total).
    expect(screen.getAllByRole('button')).toHaveLength(12)
  })

  it('clicking a natural button answers with alter 0', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<NoteNameAnswerPad onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'E' }))

    expect(onAnswer).toHaveBeenCalledWith({ letter: 'E', alter: 0 })
  })

  it('clicking a sharp button answers with alter 1, distinct from the natural of the same letter', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<NoteNameAnswerPad onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'F♯' }))

    // Kills a mutant that always answers alter: 0 regardless of which button
    // fired, which the plain 'F' assertion alone could not catch.
    expect(onAnswer).toHaveBeenCalledWith({ letter: 'F', alter: 1 })
    expect(onAnswer).not.toHaveBeenCalledWith({ letter: 'F', alter: 0 })
  })

  it('is keyboard reachable — tabbing to a button and pressing Enter activates it', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<NoteNameAnswerPad onAnswer={onAnswer} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'C' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onAnswer).toHaveBeenCalledWith({ letter: 'C', alter: 0 })
  })
})
