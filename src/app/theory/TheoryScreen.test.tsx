/**
 * `TheoryScreen` composition (roadmap 3.8, UI-17): four tabs — Drills, Circle
 * of fifths, Scales & chords, Chord lookup — behind local `useState`, no
 * route change. Per-module behaviour (grading, scale/chord math, playback) is
 * covered by each tool's own test file; this file proves the SCREEN-level
 * wiring: which tab is selected by default and after a deep link, that the
 * circle and the reference still drive each other across a tab switch, and
 * that the chord lookup still seeds from the reference's current root.
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

// The reference tab mounts `ScaleStaff`/`ChordStaff` (roadmap 3.14/5.50), i.e.
// real OSMD engraves. happy-dom has no canvas, so OSMD's text measurer
// throws — and `autoResize: true` makes OSMD re-render on a timer it owns, so
// that throw lands OUTSIDE the `load()` promise `ScoreViewer` catches, as an
// unhandled exception that fails the whole run while every test still
// passes. Same mock as ChordScaleReference.test.tsx / ScaleStaff.test.tsx.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-title={score.meta.title} />
  ),
}))

function tab(name: string) {
  return screen.getByRole('tab', { name })
}

afterEach(cleanup)

describe('TheoryScreen', () => {
  it('defaults to the Drills tab, selected in both the tab bar and the panel it controls', async () => {
    render(<TheoryScreen />)

    expect(tab('Drills')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Circle of fifths')).toHaveAttribute('aria-selected', 'false')
    // The drill panel's own content (proven in TheoryDrillPanel.test.tsx) is
    // actually mounted, not merely a tab bar that claims to be selected.
    // `findByTestId` (rather than `getByTestId`) flushes the panel's own
    // deferred practice-log `setTimeout(0)` (see TheoryDrillPanel.tsx's own
    // comment on why it's deferred) inside `act`, same as every caller that
    // awaits a user event already does incidentally.
    expect(await screen.findByTestId('theory-prompt')).toBeInTheDocument()
  })

  it('a deep link to a drill (initialDrillKind/initialDrillLevel) still opens that drill, with the Drills tab preselected', async () => {
    render(<TheoryScreen initialDrillKind="build-chord" initialDrillLevel={2} />)

    expect(tab('Drills')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Topic')).toHaveValue('build-chord')
    // The `.stepper` primitive's canonical shape (normalised across all five
    // screens that adopted it): the word "Level" is a <label> OUTSIDE the
    // group, and the value cell holds the bare numeral. Asserting through the
    // group's accessible name proves both halves at once, so splitting them
    // did not weaken this check.
    await screen.findByTestId('theory-level')
    expect(
      within(screen.getByRole('group', { name: 'Level' })).getByTestId('theory-level'),
    ).toHaveTextContent('2')
  })

  it('only the active tab is mounted — switching away unmounts the drill panel entirely', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)
    expect(screen.getByTestId('theory-prompt')).toBeInTheDocument()

    await user.click(tab('Circle of fifths'))

    expect(screen.queryByTestId('theory-prompt')).not.toBeInTheDocument()
    expect(tab('Circle of fifths')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Drills')).toHaveAttribute('aria-selected', 'false')
  })

  it('the tab bar is keyboard-operable: tabbing to a tab and pressing Enter selects it', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    tab('Circle of fifths').focus()
    expect(tab('Circle of fifths')).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(tab('Circle of fifths')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('circle-of-fifths')).toBeInTheDocument()
  })

  it('the Scales & chords tab defaults to showing C major in the reference', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.click(tab('Scales & chords'))

    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('C major')
  })

  it('clicking G major on the circle drives the reference to G major notes and roman numerals once that tab is opened', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.click(tab('Circle of fifths'))
    await user.click(screen.getByRole('button', { name: 'G major' }))

    await user.click(tab('Scales & chords'))
    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('G major')

    const gMajor = buildScale(spell('G', 0, 4), 'major')
    for (const [i, note] of gMajor.notes.entries()) {
      expect(screen.getByTestId(`scale-degree-${i + 1}`)).toHaveTextContent(pitchName(note))
    }

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

  it('changing the Root picker on the reference updates the circle selection once that tab is opened, not just the heading', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.click(tab('Scales & chords'))
    await user.selectOptions(screen.getByLabelText('Root'), 'G')
    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('G major')

    await user.click(tab('Circle of fifths'))
    expect(screen.getByTestId('circle-key-major-1')).toHaveAttribute('data-highlight', 'selected')
    expect(screen.getByTestId('circle-key-major-0')).toHaveAttribute('data-highlight', 'related')
  })

  it('clicking a minor wedge switches the reference to the natural-minor reading', async () => {
    const user = userEvent.setup()
    render(<TheoryScreen />)

    await user.click(tab('Circle of fifths'))
    await user.click(screen.getByRole('button', { name: 'E minor' }))

    await user.click(tab('Scales & chords'))
    expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('E natural minor')
  })

  describe('Chord lookup tab (roadmap UI-17: moved out of ChordScaleReference to its own tab)', () => {
    it('seeds the lookup from the reference default (C) the first time it is opened', async () => {
      const user = userEvent.setup()
      render(<TheoryScreen />)

      await user.click(tab('Chord lookup'))

      const lookup = screen.getByRole('region', { name: 'Chord lookup' })
      expect(
        (within(lookup).getByLabelText('Chord root') as HTMLSelectElement).selectedOptions[0],
      ).toHaveTextContent('C')
    })

    it('re-seeds the lookup root when the reference root changes between visits to the tab', async () => {
      const user = userEvent.setup()
      render(<TheoryScreen />)

      await user.click(tab('Scales & chords'))
      await user.selectOptions(screen.getByLabelText('Root'), 'A')

      await user.click(tab('Chord lookup'))
      const lookup = screen.getByRole('region', { name: 'Chord lookup' })
      expect(
        (within(lookup).getByLabelText('Chord root') as HTMLSelectElement).selectedOptions[0],
      ).toHaveTextContent('A')
    })

    it('can look up a chord no diatonic-chords section could ever show, e.g. Db diminished 7th', async () => {
      const user = userEvent.setup()
      render(<TheoryScreen />)

      await user.click(tab('Chord lookup'))
      const lookup = screen.getByRole('region', { name: 'Chord lookup' })
      await user.selectOptions(within(lookup).getByLabelText('Chord root'), 'Db')
      await user.selectOptions(within(lookup).getByLabelText('Chord quality'), 'Diminished 7th')

      expect(within(lookup).getByTestId('chord-lookup-symbol')).toHaveTextContent('Dbdim7')
    })
  })
})
