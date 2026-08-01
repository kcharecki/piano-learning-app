/**
 * `StaffNote` (roadmap 2.12) — the notehead lands at the position
 * `staffPosition.ts` computes, and ledger lines appear exactly when the note
 * is off the staff. `staffPosition.test.ts` already checks the geometry
 * itself; this only checks the component reads it correctly.
 */
import { midi } from '@core/shared/units.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StaffNote } from './StaffNote.tsx'

afterEach(cleanup)

describe('StaffNote', () => {
  it('places middle C two steps below the treble staff, with its ledger line', () => {
    render(<StaffNote midi={midi(60)} clef="treble" />)

    const note = screen.getByTestId('staff-note')
    expect(note).toHaveAttribute('data-step', '-2')
    expect(screen.getByTestId('ledger--2')).toBeInTheDocument()
  })

  it('draws no ledger line for a note on the staff itself', () => {
    render(<StaffNote midi={midi(67)} clef="treble" />) // G4, the second treble line

    expect(screen.getByTestId('staff-note')).toHaveAttribute('data-step', '2')
    expect(screen.queryByTestId(/^ledger-/)).toBeNull()
  })

  it('places middle C two steps above the bass staff', () => {
    render(<StaffNote midi={midi(60)} clef="bass" />)

    expect(screen.getByTestId('staff-note')).toHaveAttribute('data-step', '10')
    expect(screen.getByTestId('ledger-10')).toBeInTheDocument()
  })

  it('labels the clef for accessibility without naming the note', () => {
    render(<StaffNote midi={midi(65)} clef="treble" />)

    const note = screen.getByRole('img', { name: /treble staff/i })
    expect(note).toBeInTheDocument()
    expect(note.textContent).not.toMatch(/[A-G]/)
  })
})
