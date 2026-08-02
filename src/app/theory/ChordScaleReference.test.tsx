/**
 * `ChordScaleReference` is a controlled component: these tests drive its own
 * pickers and assert the displayed scale/chord data actually changes to match
 * — never merely that the section renders. The harmonic/natural minor test in
 * particular would fail for a stub that always shows "the major scale of the
 * root", since it asserts the two minor forms differ from each other.
 */
import { chordForRomanNumeral, diatonicChords, romanNumeralFor } from '@core/theory/harmony.ts'
import { keyOf } from '@core/theory/keys.ts'
import { chordSymbol } from '@core/theory/chords.ts'
import { pitchName as scalePitchName, spell } from '@core/theory/pitch.ts'
import { buildScale } from '@core/theory/scales.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChordScaleReference } from './ChordScaleReference.tsx'
import type { ScaleType } from '@core/theory/scales.ts'
import type { SpelledPitch } from '@core/theory/pitch.ts'

afterEach(cleanup)

/** A tiny controlled-state wrapper, mirroring how `TheoryScreen` owns this data. */
function Controlled({
  initialRoot = spell('C', 0, 4),
  initialType = 'major',
}: {
  readonly initialRoot?: SpelledPitch
  readonly initialType?: ScaleType
}) {
  const [root, setRoot] = useState(initialRoot)
  const [scaleType, setScaleType] = useState<ScaleType>(initialType)
  return (
    <ChordScaleReference
      root={root}
      scaleType={scaleType}
      onRootChange={setRoot}
      onScaleTypeChange={setScaleType}
    />
  )
}

describe('ChordScaleReference', () => {
  it('shows C major scale degrees by default, matching core exactly', () => {
    render(<Controlled />)

    const scale = buildScale(spell('C', 0, 4), 'major')
    for (const [i, note] of scale.notes.entries()) {
      const row = screen.getByTestId(`scale-degree-${i + 1}`)
      expect(row).toHaveTextContent(scalePitchName(note))
    }
  })

  it('switching the scale-type picker to harmonic minor changes the displayed notes from natural minor', async () => {
    const user = userEvent.setup()
    render(<Controlled initialType="naturalMinor" />)

    const naturalNotes = buildScale(spell('C', 0, 4), 'naturalMinor').notes.map(scalePitchName)
    for (const [i, name] of naturalNotes.entries()) {
      expect(screen.getByTestId(`scale-degree-${i + 1}`)).toHaveTextContent(name)
    }

    await user.selectOptions(screen.getByLabelText('Scale'), 'harmonicMinor')

    const harmonicNotes = buildScale(spell('C', 0, 4), 'harmonicMinor').notes.map(scalePitchName)
    // The two forms differ (raised 7th), so this assertion distinguishes a real
    // scale-type switch from a stub that ignores the picker.
    expect(harmonicNotes).not.toEqual(naturalNotes)
    for (const [i, name] of harmonicNotes.entries()) {
      expect(screen.getByTestId(`scale-degree-${i + 1}`)).toHaveTextContent(name)
    }
  })

  it('changing the root picker updates the scale name and degree notes', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    await user.selectOptions(screen.getByLabelText('Root'), 'G')

    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('G major')
    const gMajor = buildScale(spell('G', 0, 4), 'major')
    for (const [i, note] of gMajor.notes.entries()) {
      expect(screen.getByTestId(`scale-degree-${i + 1}`)).toHaveTextContent(scalePitchName(note))
    }
  })

  it('shows the seven diatonic chords of the key with correct roman numerals and symbols', () => {
    render(<Controlled />)

    const key = keyOf(spell('C', 0, 4), 'major')
    if (!key.ok) throw new Error('C major must be a valid key')
    const chords = diatonicChords(key.value)

    const list = screen.getByRole('list', { name: 'Diatonic chords' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(7)

    for (const chord of chords) {
      const numeral = romanNumeralFor(chord, key.value)
      expect(numeral).not.toBeNull()
      const row = screen.getByTestId(`diatonic-chord-${numeral?.text}`)
      expect(row).toHaveTextContent(chordSymbol(chord))
    }
  })

  it('highlights exactly the scale pitch classes and root on the scale keyboard diagram', () => {
    render(<Controlled />)

    const diagram = screen.getByLabelText('C major on the keyboard')
    for (const note of [60, 62, 64, 65, 67, 69, 71]) {
      expect(within(diagram).getByTestId(`keyboard-key-${note}`)).toHaveAttribute(
        'data-highlighted',
        'true',
      )
    }
    for (const note of [61, 63, 66, 68, 70]) {
      expect(within(diagram).getByTestId(`keyboard-key-${note}`)).toHaveAttribute(
        'data-highlighted',
        'false',
      )
    }
    expect(within(diagram).getByTestId('keyboard-key-60')).toHaveAttribute('data-root', 'true')
  })

  it('shows fingering only for scale types that have one, and the right values for C major', () => {
    render(<Controlled />)
    // C major degree 4 (F): right hand finger 1, left hand finger 2 (C_PATTERN index 3).
    const row = screen.getByTestId('scale-degree-4')
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('1')
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('2')
  })

  it('shows a dash for every fingering cell when the scale type has no defined fingering', () => {
    render(<Controlled initialType="naturalMinor" />)
    for (let degree = 1; degree <= 7; degree++) {
      const row = screen.getByTestId(`scale-degree-${degree}`)
      const cells = within(row).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('—')
      expect(cells[3]).toHaveTextContent('—')
    }
  })

  it('substitutes the raised-leading-tone V and vii° chords for harmonic minor instead of the natural-minor reading', () => {
    render(<Controlled initialType="harmonicMinor" />)

    const key = keyOf(spell('C', 0, 4), 'minor')
    if (!key.ok) throw new Error('C minor must be a valid key')
    const raisedV = chordForRomanNumeral('V', key.value)
    const raisedViio = chordForRomanNumeral('vii°', key.value)
    if (!raisedV.ok || !raisedViio.ok) throw new Error('C harmonic minor must have V and vii°')

    expect(screen.getByTestId('diatonic-chord-V')).toHaveTextContent(chordSymbol(raisedV.value))
    expect(screen.getByTestId('diatonic-chord-vii°')).toHaveTextContent(
      chordSymbol(raisedViio.value),
    )
  })

  it('omits the diatonic chords section for a mode whose chords are not the major/minor reading', () => {
    render(<Controlled initialType="dorian" />)
    expect(screen.queryByRole('list', { name: 'Diatonic chords' })).not.toBeInTheDocument()
  })

  it('offers flat-spelled roots for the black keys a learner actually reads, and every root yields a chord list', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    const options = within(screen.getByLabelText('Root') as HTMLSelectElement).getAllByRole(
      'option',
    )
    const labels = options.map((o) => o.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Db', 'Eb', 'Ab', 'Bb']))
    expect(labels).not.toEqual(expect.arrayContaining(['D#', 'G#', 'A#']))

    await user.selectOptions(screen.getByLabelText('Root'), 'Eb')
    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('Eb major')
    expect(screen.getByRole('list', { name: 'Diatonic chords' })).toBeInTheDocument()
  })

  it('shows the Root picker in the flat spelling a Db-major selection actually uses', () => {
    render(<Controlled initialRoot={spell('D', -1, 4)} />)
    const select = screen.getByLabelText('Root') as HTMLSelectElement
    expect(select.selectedOptions[0]).toHaveTextContent('Db')
    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('Db major')
  })

  it('shows a plain explanatory message, not a live-announced core error, for an unwritable root/mode', () => {
    render(<Controlled initialRoot={spell('D', 1, 4)} initialType="major" />)
    // D# major has no standard key signature (would need 9 sharps).
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Diatonic chords' })).not.toBeInTheDocument()
    expect(screen.getByText(/is not a writable key/)).toBeInTheDocument()
  })
})
