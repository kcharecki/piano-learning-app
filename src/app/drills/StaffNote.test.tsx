/**
 * `StaffNote` (roadmap 2.12) — the notehead lands at the position
 * `staffPosition.ts` computes, and ledger lines appear exactly when the note
 * is off the staff. `staffPosition.test.ts` already checks the geometry
 * itself; this only checks the component reads it correctly.
 */
import { buildDeck } from '@core/drills/flashcards.ts'
import { midi } from '@core/shared/units.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_STEP_RANGE, StaffNote, stepRangeForDeck } from './StaffNote.tsx'

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

/** Parses `viewBox="minX minY width height"` into its four numbers. */
function parseViewBox(el: Element): { minX: number; minY: number; width: number; height: number } {
  const viewBox = el.getAttribute('viewBox')
  expect(viewBox).not.toBeNull()
  const parts = (viewBox ?? '').split(' ').map(Number)
  const [minX, minY, width, height] = parts
  expect(parts).toHaveLength(4)
  return { minX: minX ?? 0, minY: minY ?? 0, width: width ?? 0, height: height ?? 0 }
}

// roadmap UI-32 — a previous attempt assumed the graded-answer pill caused
// the page to change height between cards; the pill was never the cause (it
// is permanently mounted with a token-derived min-height). The real cause:
// the viewBox used to fit tight to whatever a card drew, so a note with more
// ledger lines got a taller viewBox, and since the SVG renders at
// `height: auto` off a fixed CSS width, a taller viewBox meant a taller
// rendered staff and a taller page.
//
// A first fix pinned the viewBox to the whole app's worst case (the piano's
// own extremes) for every render — correct, but it meant a level-1 deck's
// staff rendered ~2.5x its old size for a C8 the learner would not meet for
// months. The actual requirement is narrower: the staff must not resize
// BETWEEN CARDS the learner is answering, not across every level the app can
// ever reach — a level change is a deliberate action, so the staff changing
// size at that moment is legible feedback, not jitter. So the step range is
// now an input (`stepRange`), computed ONCE per deck by `stepRangeForDeck`
// and shared by every card in that deck; `FlashcardScreen` is what actually
// memoizes it per deck (see its own comment). `DEFAULT_STEP_RANGE` (the old
// whole-app worst case) is now only the fallback for a caller that renders
// `StaffNote` without computing a deck-specific range.
describe('StaffNote — one viewBox per deck (roadmap UI-32)', () => {
  it('gives every card the SAME viewBox height when they share one stepRange (far-below, mid-staff, far-above)', () => {
    // A level-6 deck's own range already reaches the piano's extremes (see
    // the "level-6/7" test below), so one range computed from it must cover
    // a far-below note, a mid-staff note, and a far-above note identically.
    const range = stepRangeForDeck(buildDeck('staff-to-key', 6))

    const { unmount: u1 } = render(<StaffNote midi={midi(21)} clef="bass" stepRange={range} />) // A0
    const farBelow = parseViewBox(screen.getByTestId('staff-note'))
    u1()

    const { unmount: u2 } = render(<StaffNote midi={midi(67)} clef="treble" stepRange={range} />) // G4
    const midStaff = parseViewBox(screen.getByTestId('staff-note'))
    u2()

    const { unmount: u3 } = render(<StaffNote midi={midi(108)} clef="treble" stepRange={range} />) // C8
    const farAbove = parseViewBox(screen.getByTestId('staff-note'))
    u3()

    expect(farBelow.height).toBe(midStaff.height)
    expect(midStaff.height).toBe(farAbove.height)
  })

  it('gives a single-note card and an interval card the SAME viewBox height when they share one deck-derived stepRange', () => {
    const range = stepRangeForDeck(buildDeck('interval-on-staff', 6))

    const { unmount: u1 } = render(<StaffNote midi={midi(67)} clef="treble" stepRange={range} />)
    const singleHeight = parseViewBox(screen.getByTestId('staff-note')).height
    u1()

    const { unmount: u2 } = render(
      <StaffNote
        low={{ letter: 'C', alter: 0, octave: 4 }}
        high={{ letter: 'E', alter: 0, octave: 4 }}
        clef="treble"
        stepRange={range}
      />,
    )
    const intervalHeight = parseViewBox(screen.getByTestId('staff-note')).height
    u2()

    expect(singleHeight).toBe(intervalHeight)
  })

  it("a level-6/7 deck's own range covers the piano's extremes, and nothing clips there", () => {
    // Level 7 is `MAX_DRILL_LEVEL` (FlashcardScreen.tsx) — the widest a
    // learner can actually reach — and its note range spans the whole
    // 88-key piano, so its own `stepRangeForDeck` must already equal the
    // true worst case, not just approximate it.
    const range = stepRangeForDeck(buildDeck('staff-to-key', 7))
    expect(range).toEqual({ min: -13, max: 26 })

    for (const [note, clef] of [
      [21, 'bass'],
      [108, 'treble'],
    ] as const) {
      const { unmount } = render(<StaffNote midi={midi(note)} clef={clef} stepRange={range} />)
      const svg = screen.getByTestId('staff-note')
      const box = parseViewBox(svg)
      const notehead = svg.querySelector('ellipse')
      expect(notehead).not.toBeNull()
      const cy = Number(notehead?.getAttribute('cy'))
      const ry = Number(notehead?.getAttribute('ry'))
      expect(cy - ry).toBeGreaterThanOrEqual(box.minY)
      expect(cy + ry).toBeLessThanOrEqual(box.minY + box.height)
      unmount()
    }
  })

  it("a level-1 deck's own range stays close to its pre-fix size, not the whole-piano size", () => {
    // Pre-fix, a level-1 card's own viewBox height varied roughly 88-100
    // (the measured defect table in the roadmap task). A deck-scoped range
    // should land close to that neighbourhood, nowhere near the 274 the
    // whole-piano DEFAULT_STEP_RANGE produces.
    const range = stepRangeForDeck(buildDeck('staff-to-key', 1))
    expect(range).toEqual({ min: -2, max: 9 })

    const { unmount } = render(<StaffNote midi={midi(60)} clef="treble" stepRange={range} />)
    const height = parseViewBox(screen.getByTestId('staff-note')).height
    unmount()

    expect(height).toBe(106)
    expect(height).toBeLessThan(150) // nowhere near the 274 whole-piano height
  })

  it('never recomputes a wider box mid-deck: two different cards from the SAME level-1 range still match exactly', () => {
    // This is the actual acceptance bar: answer-to-answer, within one deck,
    // the box must not move — regardless of how far apart two cards' own
    // notes are within that deck's own (already-bounded) range.
    const range = stepRangeForDeck(buildDeck('staff-to-key', 1))

    const { unmount: u1 } = render(<StaffNote midi={midi(56)} clef="bass" stepRange={range} />)
    const first = parseViewBox(screen.getByTestId('staff-note'))
    u1()

    const { unmount: u2 } = render(<StaffNote midi={midi(64)} clef="treble" stepRange={range} />)
    const second = parseViewBox(screen.getByTestId('staff-note'))
    u2()

    expect(first).toEqual(second)
  })

  it('falls back to the whole-app worst case (DEFAULT_STEP_RANGE) when no stepRange prop is given, and still does not clip the piano extremes', () => {
    const { unmount: u1 } = render(<StaffNote midi={midi(21)} clef="bass" />)
    const withoutProp = parseViewBox(screen.getByTestId('staff-note'))
    u1()

    const { unmount: u2 } = render(<StaffNote midi={midi(21)} clef="bass" stepRange={DEFAULT_STEP_RANGE} />)
    const withDefaultExplicit = parseViewBox(screen.getByTestId('staff-note'))
    u2()

    expect(withoutProp).toEqual(withDefaultExplicit)
  })
})
