/**
 * `KeyboardDiagram` is presentational: these tests drive it with real scale
 * data from core and assert the rendered keys highlight exactly the expected
 * pitch classes — not merely that the SVG renders.
 */
import { scaleNotes } from '@core/theory/scales.ts'
import { spell, spelledPitchClass, toMidi } from '@core/theory/pitch.ts'
import { midi } from '@core/shared/units.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { KeyboardDiagram } from './KeyboardDiagram.tsx'

afterEach(cleanup)

describe('KeyboardDiagram', () => {
  it('highlights exactly the pitch classes of a C major scale, and only those', () => {
    const notes = scaleNotes(spell('C', 0, 4), 'major')
    const pitchClasses = new Set(notes.map(spelledPitchClass))

    render(
      <KeyboardDiagram
        low={midi(60)}
        high={midi(71)}
        highlightedPitchClasses={pitchClasses}
        rootPitchClass={0}
      />,
    )

    // C major is all white keys: C D E F G A B (pitch classes 0 2 4 5 7 9 11).
    for (const note of [60, 62, 64, 65, 67, 69, 71]) {
      expect(screen.getByTestId(`keyboard-key-${note}`)).toHaveAttribute('data-highlighted', 'true')
    }
    // The black keys (61, 63, 66, 68, 70) are not in C major.
    for (const note of [61, 63, 66, 68, 70]) {
      expect(screen.getByTestId(`keyboard-key-${note}`)).toHaveAttribute('data-highlighted', 'false')
    }
    expect(screen.getByTestId('keyboard-key-60')).toHaveAttribute('data-root', 'true')
    expect(screen.getByTestId('keyboard-key-67')).toHaveAttribute('data-root', 'false')
  })

  it('renders a per-key label only on the key it is addressed to', () => {
    const cNote = toMidi(spell('C', 0, 4))
    const labels = new Map<number, string>([[cNote, '1']])

    render(
      <KeyboardDiagram
        low={midi(60)}
        high={midi(72)}
        highlightedPitchClasses={new Set([0])}
        labels={labels}
      />,
    )

    expect(screen.getByTestId('keyboard-key-60')).toHaveTextContent('1')
    expect(screen.getByTestId('keyboard-key-72')).not.toHaveTextContent('1')
  })

  it('exposes an accessible name via role=img', () => {
    render(
      <KeyboardDiagram
        low={midi(60)}
        high={midi(71)}
        highlightedPitchClasses={new Set()}
        ariaLabel="C major scale"
      />,
    )
    expect(screen.getByRole('img', { name: 'C major scale' })).toBeInTheDocument()
  })
})
