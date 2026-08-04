/**
 * `KeySignatureAnswerPad` (roadmap 3.11, REQ-3.5.2) — every fifths count
 * `buildKeySignatureDeck` can draw across the full writable range gets a
 * real, labelled, keyboard-reachable button naming BOTH the major tonic and
 * its relative minor, and clicking one calls `onAnswer` with exactly that
 * `{ majorTonic, minorTonic }` pair.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeySignatureAnswerPad } from './KeySignatureAnswerPad.tsx'

afterEach(cleanup)

describe('KeySignatureAnswerPad', () => {
  it('is an accessible, named group', () => {
    render(<KeySignatureAnswerPad onAnswer={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Key signature answer' })).toBeInTheDocument()
  })

  it('renders one readable button per fifths count in the full -7..+7 writable range (15 total)', () => {
    render(<KeySignatureAnswerPad onAnswer={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'C major / A minor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'G major / E minor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'C♭ major / A♭ minor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'C♯ major / A♯ minor' })).toBeInTheDocument()
    // 15 fifths values, -7..+7 inclusive — a stub that only offers the
    // level-1 subset (-1..1) would fail this count.
    expect(screen.getAllByRole('button')).toHaveLength(15)
  })

  it('clicking a button answers with exactly that major/minor tonic pair', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<KeySignatureAnswerPad onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'G major / E minor' }))

    expect(onAnswer).toHaveBeenCalledWith({
      majorTonic: { letter: 'G', alter: 0 },
      minorTonic: { letter: 'E', alter: 0 },
    })
  })

  it('a sharp-signature button answers with the sharp tonics, not the naturals of the same letters', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<KeySignatureAnswerPad onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'C♯ major / A♯ minor' }))

    // Kills a mutant that drops the accidental and always answers alter: 0.
    expect(onAnswer).toHaveBeenCalledWith({
      majorTonic: { letter: 'C', alter: 1 },
      minorTonic: { letter: 'A', alter: 1 },
    })
    expect(onAnswer).not.toHaveBeenCalledWith({
      majorTonic: { letter: 'C', alter: 0 },
      minorTonic: { letter: 'A', alter: 0 },
    })
  })

  it('is keyboard reachable — tabbing to a button and pressing Enter activates it', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<KeySignatureAnswerPad onAnswer={onAnswer} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'C♭ major / A♭ minor' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onAnswer).toHaveBeenCalledWith({
      majorTonic: { letter: 'C', alter: -1 },
      minorTonic: { letter: 'A', alter: -1 },
    })
  })
})
