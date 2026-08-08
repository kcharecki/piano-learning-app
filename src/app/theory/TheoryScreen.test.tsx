/**
 * `TheoryScreen` composition: clicking a key on the circle must actually drive
 * the reference below it, not merely render both side by side. This is the
 * roadmap 3.8 proof action in miniature (the e2e drives the real shell; this
 * asserts the same wiring at the React level).
 */
import { chordSymbol } from '@core/theory/chords.ts'
import { diatonicChords, romanNumeralFor } from '@core/theory/harmony.ts'
import { keyOf } from '@core/theory/keys.ts'
import { buildScale } from '@core/theory/scales.ts'
import { pitchName, spell } from '@core/theory/pitch.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TheoryScreen } from './TheoryScreen.tsx'

// The reference below the circle mounts `ScaleStaff` (roadmap 3.14), i.e. a
// real OSMD engrave. happy-dom has no canvas, so OSMD's text measurer throws —
// and `autoResize: true` makes OSMD re-render on a timer it owns, so that
// throw lands OUTSIDE the `load()` promise `ScoreViewer` catches, as an
// unhandled exception that fails the whole run while every test still passes.
// Same mock as ChordScaleReference.test.tsx / ScaleStaff.test.tsx; this file
// asserts circle -> reference wiring, and the engraving is proved by e2e.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-title={score.meta.title} />
  ),
}))

afterEach(cleanup)

describe('TheoryScreen', () => {
  it('defaults to showing C major in the reference', () => {
    render(<TheoryScreen />)
    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('C major')
  })

  it('clicking G major on the circle updates the reference to G major notes and roman numerals', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.click(screen.getByRole('button', { name: 'G major' }))

    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('G major')

    const gMajor = buildScale(spell('G', 0, 4), 'major')
    for (const [i, note] of gMajor.notes.entries()) {
      expect(screen.getByTestId(`scale-degree-${i + 1}`)).toHaveTextContent(pitchName(note))
    }

    // Assert the exact chord symbol and the full roman-numeral sequence, not a
    // substring match — a mutant showing sevenths or reordering the chord
    // array would still contain the letter "G" somewhere in "I".
    const key = keyOf(spell('G', 0, 4), 'major')
    if (!key.ok) throw new Error('G major must be a valid key')
    const chords = diatonicChords(key.value)
    const numerals = chords.map((chord) => romanNumeralFor(chord, key.value)?.text ?? '')
    expect(numerals).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'])
    const tonicChord = chords[0]
    if (tonicChord === undefined) throw new Error('diatonicChords must return 7 chords')
    expect(screen.getByTestId('diatonic-chord-I')).toHaveTextContent(chordSymbol(tonicChord))

    const list = screen.getByRole('list', { name: 'Diatonic chords' })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.dataset['testid'])).toEqual(
      numerals.map((n) => `diatonic-chord-${n}`),
    )
  })

  it('changing the Root picker updates the circle selection, not just the heading below', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.selectOptions(screen.getByLabelText('Root'), 'G')

    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('G major')
    expect(screen.getByTestId('circle-key-major-1')).toHaveAttribute('data-highlight', 'selected')
    expect(screen.getByTestId('circle-key-major-0')).toHaveAttribute('data-highlight', 'related')
  })

  it('clicking a minor wedge switches the reference to the natural-minor reading', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.click(screen.getByRole('button', { name: 'E minor' }))

    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('E natural minor')
  })
})
