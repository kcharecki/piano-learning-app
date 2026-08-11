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

  // roadmap 5.26 — the clef glyph must be wired to the bundled-font class, not
  // left to render in whatever the OS happens to fall back to. This only
  // proves the wiring; feature-music-font.css and the e2e spec prove the font
  // itself is present, self-hosted, and actually changes the rendered glyph.
  it('renders the clef glyph with the bundled music-font class (roadmap 5.26)', () => {
    render(<StaffNote midi={midi(60)} clef="treble" />)

    expect(screen.getByTestId('clef-glyph')).toHaveClass('music-glyph')
  })

  it('renders an accidental glyph with the bundled music-font class', () => {
    render(<StaffNote midi={midi(66)} clef="treble" />) // F#4 — has an accidental

    const note = screen.getByTestId('staff-note')
    const accidental = note.querySelector('text.music-glyph:not([data-testid="clef-glyph"])')
    expect(accidental).not.toBeNull()
  })
})

describe('StaffNote — an interval card (two noteheads, one staff)', () => {
  const low = { letter: 'C', alter: 0, octave: 4 } as const
  const high = { letter: 'E', alter: 0, octave: 4 } as const

  it('places both pitches at their real staff positions', () => {
    render(<StaffNote low={low} high={high} clef="treble" />)

    expect(screen.getByTestId('staff-note-low')).toHaveAttribute('data-step', '-2')
    expect(screen.getByTestId('staff-note-high')).toHaveAttribute('data-step', '0')
  })

  it('draws the two noteheads side by side (different x)', () => {
    render(<StaffNote low={low} high={high} clef="treble" />)

    const lowX = screen.getByTestId('staff-note-low').querySelector('ellipse')?.getAttribute('cx')
    const highX = screen.getByTestId('staff-note-high').querySelector('ellipse')?.getAttribute('cx')
    expect(lowX).toBeDefined()
    expect(highX).toBeDefined()
    expect(lowX).not.toBe(highX)
  })

  it('draws the ledger line for a note off the staff', () => {
    // Middle C (step -2) needs a ledger line; E4 (step 0, the bottom line) does not.
    render(<StaffNote low={low} high={high} clef="treble" />)

    expect(screen.getByTestId(/^ledger--2-/)).toBeInTheDocument()
  })

  it('gives each ledger line at a distinct notehead a distinct testid', () => {
    // B1 (step -5) and D2 (step -3), bass clef: both need the step -2 ledger,
    // but at two different x's — they must not collide on one testid.
    const b1 = { letter: 'B', alter: 0, octave: 1 } as const
    const d2 = { letter: 'D', alter: 0, octave: 2 } as const
    render(<StaffNote low={b1} high={d2} clef="bass" />)

    expect(screen.getAllByTestId(/^ledger--2-/)).toHaveLength(2)
  })

  it('never renders a letter name anywhere in the SVG', () => {
    render(<StaffNote low={low} high={high} clef="treble" />)

    const note = screen.getByRole('img', { name: /treble staff/i })
    expect(note.textContent).not.toMatch(/[A-G]/)
  })
})
