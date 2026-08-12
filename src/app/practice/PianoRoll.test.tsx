/**
 * Thin by design (docs/PROCESS.md's testing rule): render, wiring, roles.
 * The music-domain behaviour — visibility, overlap, monotonicity, degrade
 * cases — is proven in `@core/notation/pianoRoll.test.ts`, not here.
 */
import { buildTestScore } from '@test/fixtures.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PianoRoll, type PianoRollHandle } from './PianoRoll.tsx'

afterEach(cleanup)

const SCORE = buildTestScore(
  [
    { midi: 60, startTick: 0, durationTicks: 480, hand: 'right' },
    { midi: 48, startTick: 480, durationTicks: 480, hand: 'left' },
  ],
  { id: 'roll-test-score' },
)

describe('PianoRoll', () => {
  it('renders an accessible image with the notes visible in the initial window', () => {
    render(<PianoRoll score={SCORE} />)
    expect(screen.getByRole('img', { name: /piano roll/i })).toBeInTheDocument()
    const notes = screen.getAllByTestId('piano-roll-note')
    expect(notes.map((n) => n.getAttribute('data-note-id')).sort()).toEqual(
      [...SCORE.notes].map((n) => n.id).sort(),
    )
  })

  it('colours right- and left-hand notes with distinct classes', () => {
    render(<PianoRoll score={SCORE} />)
    const notes = screen.getAllByTestId('piano-roll-note')
    const right = notes.find((n) => n.getAttribute('data-hand') === 'right')
    const left = notes.find((n) => n.getAttribute('data-hand') === 'left')
    expect(right?.className).toContain('piano-roll-note-right')
    expect(left?.className).toContain('piano-roll-note-left')
    expect(right?.className).not.toBe(left?.className)
  })

  it('marks the note sounding at the initial position as lit, and others as not', () => {
    render(<PianoRoll score={SCORE} initialPositionTick={0} />)
    const notes = screen.getAllByTestId('piano-roll-note')
    const atZero = notes.find((n) => n.getAttribute('data-note-id') === SCORE.notes[0]?.id)
    const later = notes.find((n) => n.getAttribute('data-note-id') === SCORE.notes[1]?.id)
    expect(atZero?.getAttribute('data-lit')).toBe('true')
    expect(later?.getAttribute('data-lit')).toBe('false')
  })

  it('exposes setPositionTick through the ref, and it re-lights notes without a prop change', () => {
    const ref = createRef<PianoRollHandle>()
    render(<PianoRoll ref={ref} score={SCORE} initialPositionTick={0} />)

    act(() => {
      ref.current?.setPositionTick(480)
    })

    const notes = screen.getAllByTestId('piano-roll-note')
    const first = notes.find((n) => n.getAttribute('data-note-id') === SCORE.notes[0]?.id)
    const second = notes.find((n) => n.getAttribute('data-note-id') === SCORE.notes[1]?.id)
    expect(first?.getAttribute('data-lit')).toBe('false')
    expect(second?.getAttribute('data-lit')).toBe('true')
  })

  // The design (see the module comment): time flows past a FIXED now-line —
  // once past the very first frame's clamp-at-tick-0 (`pianoRollWindowAround`
  // never lets the window start go negative), the now-line's x stops moving
  // altogether and every note's x decreases by exactly the tick delta
  // instead. Sampled at 600 and 1200 — both comfortably past the lookbehind
  // window's clamp boundary (480, the default) — so this is the STEADY-STATE
  // behaviour, not an artefact of starting at tick 0.
  it('once past the initial clamp, a fixed note scrolls left by exactly the tick delta while the now-line itself stays put', () => {
    const longNoteScore = buildTestScore(
      [{ midi: 60, startTick: 0, durationTicks: 2000, hand: 'right' }],
      { id: 'roll-long-note-score', timeSignature: { beats: 100, beatType: 4 } },
    )
    const ref = createRef<PianoRollHandle>()
    render(<PianoRoll ref={ref} score={longNoteScore} initialPositionTick={600} />)

    const nowLineXAt600 = Number(screen.getByTestId('piano-roll-now-line').getAttribute('x'))
    const noteXAt600 = Number(screen.getByTestId('piano-roll-note').getAttribute('x'))

    act(() => ref.current?.setPositionTick(1200))

    const nowLineXAt1200 = Number(screen.getByTestId('piano-roll-now-line').getAttribute('x'))
    const noteXAt1200 = Number(screen.getByTestId('piano-roll-note').getAttribute('x'))

    expect(nowLineXAt1200).toBe(nowLineXAt600)
    expect(noteXAt600 - noteXAt1200).toBe(600) // exactly the 1200-600 tick delta
  })

  it('renders nothing but a valid, non-throwing empty roll for a score with no notes', () => {
    const empty = buildTestScore([], { id: 'roll-empty-score' })
    expect(() => render(<PianoRoll score={empty} />)).not.toThrow()
    expect(screen.queryAllByTestId('piano-roll-note')).toHaveLength(0)
    expect(screen.getByTestId('piano-roll-now-line')).toBeInTheDocument()
  })
})
