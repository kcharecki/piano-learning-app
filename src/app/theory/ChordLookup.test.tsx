/**
 * `ChordLookup` is REQ-3.5.4's "look up ANY chord": these tests drive its own
 * root/quality/inversion pickers and assert the displayed symbol, figured
 * bass, spelled tones and keyboard highlight all change to match — not merely
 * that the section renders — and, like `ChordScaleReference`'s own playback
 * tests, assert the exact recorded `AudioOutput` calls for "hear it" rather
 * than that some sound occurred.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { buildChord, chordSymbol, figuredBass } from '@core/theory/chords.ts'
import { pitchName, spell, spelledPitchClass, toMidi } from '@core/theory/pitch.ts'
import { ChordLookup } from './ChordLookup.tsx'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import type { RecordedAudioCall } from '@test/fakes.ts'

afterEach(cleanup)

function isNoteOn(c: RecordedAudioCall): c is Extract<RecordedAudioCall, { kind: 'noteOn' }> {
  return c.kind === 'noteOn'
}

const C4 = spell('C', 0, 4)

describe('ChordLookup', () => {
  it('shows a root-position C major triad by default, matching core exactly', () => {
    render(<ChordLookup initialRoot={C4} />)

    const chord = buildChord(C4, 'major', 0)
    expect(screen.getByTestId('chord-lookup-symbol')).toHaveTextContent(chordSymbol(chord))
    expect(screen.getByTestId('chord-lookup-figures')).toHaveTextContent('root position')
    const tonesList = screen.getByRole('list', { name: 'Chord tones' })
    const items = within(tonesList).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(chord.notes.map(pitchName))
  })

  it('changing the root picker rebuilds the chord on the new root', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    await user.selectOptions(screen.getByLabelText('Chord root'), 'G')

    const expected = buildChord(spell('G', 0, 4), 'major', 0)
    expect(screen.getByTestId('chord-lookup-symbol')).toHaveTextContent(chordSymbol(expected))
  })

  it('looking up an arbitrary root + quality reaches a chord no key\'s diatonic triads could ever show: Db diminished 7th', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    await user.selectOptions(screen.getByLabelText('Chord root'), 'Db')
    await user.selectOptions(screen.getByLabelText('Chord quality'), 'Diminished 7th')

    const expected = buildChord(spell('D', -1, 4), 'diminished7', 0)
    expect(screen.getByTestId('chord-lookup-symbol')).toHaveTextContent(chordSymbol(expected))
    expect(chordSymbol(expected)).toBe('Dbdim7')
    expect(screen.getByTestId('chord-lookup-figures')).toHaveTextContent('7')
  })

  it('changing the inversion picker re-voices the same chord and updates the figured bass', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    await user.selectOptions(screen.getByLabelText('Inversion'), 'First inversion')

    const expected = buildChord(C4, 'major', 1)
    expect(screen.getByTestId('chord-lookup-symbol')).toHaveTextContent(chordSymbol(expected))
    expect(screen.getByTestId('chord-lookup-figures')).toHaveTextContent('6')
    // First inversion voices the third in the bass — the spelled tones list
    // must show the re-voiced order, not the root-position one, or this
    // assertion (E before C or G) fails.
    const tonesList = screen.getByRole('list', { name: 'Chord tones' })
    const items = within(tonesList).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('E4')
  })

  it('a third inversion is only offered once a seventh chord is selected, and is not offered for a triad', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    const inversionSelect = screen.getByLabelText('Inversion') as HTMLSelectElement
    const triadOptions = within(inversionSelect).getAllByRole('option').map((o) => o.textContent)
    expect(triadOptions).toEqual(['Root position', 'First inversion', 'Second inversion'])

    await user.selectOptions(screen.getByLabelText('Chord quality'), 'Dominant 7th')
    const seventhOptions = within(inversionSelect).getAllByRole('option').map((o) => o.textContent)
    expect(seventhOptions).toEqual([
      'Root position',
      'First inversion',
      'Second inversion',
      'Third inversion',
    ])
  })

  it('switching from a seventh chord\'s third inversion back to a triad falls back to root position instead of crashing', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    await user.selectOptions(screen.getByLabelText('Chord quality'), 'Dominant 7th')
    await user.selectOptions(screen.getByLabelText('Inversion'), 'Third inversion')
    expect(screen.getByTestId('chord-lookup-figures')).toHaveTextContent('4/2')

    // A triad has no third inversion (buildChord would throw); switching
    // straight to one must not leave the picker on an inversion the new
    // quality cannot build.
    await user.selectOptions(screen.getByLabelText('Chord quality'), 'Minor')

    const expected = buildChord(C4, 'minor', 0)
    expect(screen.getByTestId('chord-lookup-symbol')).toHaveTextContent(chordSymbol(expected))
    expect(screen.getByTestId('chord-lookup-figures')).toHaveTextContent('root position')
    expect((screen.getByLabelText('Inversion') as HTMLSelectElement).value).toBe('0')
  })

  it('highlights exactly the chord\'s pitch classes and root on the keyboard diagram', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    await user.selectOptions(screen.getByLabelText('Chord quality'), 'Diminished')

    const chord = buildChord(C4, 'diminished', 0)
    const diagram = screen.getByLabelText(`${chordSymbol(chord)} on the keyboard`)
    const expectedPcs = new Set(chord.notes.map(spelledPitchClass))
    for (let note = 60; note <= 71; note++) {
      const pc = note % 12
      expect(within(diagram).getByTestId(`keyboard-key-${note}`)).toHaveAttribute(
        'data-highlighted',
        String(expectedPcs.has(pc)),
      )
    }
    expect(within(diagram).getByTestId('keyboard-key-60')).toHaveAttribute('data-root', 'true')
  })

  describe('playback', () => {
    it('pressing "Play the C chord" sends the chord\'s exact tones as a simultaneity, ringing for the chord duration', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      const chord = buildChord(C4, 'major', 0)
      const expected = chord.notes.map(toMidi)

      await user.click(screen.getByRole('button', { name: 'Play the C chord' }))

      const noteOnCalls = audioOutput.calls.filter(isNoteOn)
      expect(noteOnCalls.map((c) => c.note).sort((a, b) => a - b)).toEqual(
        [...expected].sort((a, b) => a - b),
      )
      const timestamps = new Set(noteOnCalls.map((c) => c.at))
      expect(timestamps.size).toBe(1)
      for (const call of noteOnCalls) {
        expect(call.velocity).toBeGreaterThan(0)
      }

      const noteOffCalls = audioOutput.calls.filter((c) => c.kind === 'noteOff')
      const [sharedOnMs] = [...timestamps]
      expect(noteOffCalls).toHaveLength(noteOnCalls.length)
      expect(noteOffCalls.map((c) => c.at)).toEqual(noteOnCalls.map(() => (sharedOnMs ?? 0) + 800))
    })

    it('changing the quality and pressing Play again sends the new chord\'s tones, not the old ones', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      await user.click(screen.getByRole('button', { name: 'Play the C chord' }))
      const cMajor = buildChord(C4, 'major', 0).notes.map(toMidi)
      expect(audioOutput.calls.filter(isNoteOn).map((c) => c.note).sort()).toEqual(
        [...cMajor].sort(),
      )

      audioOutput.reset()
      await user.selectOptions(screen.getByLabelText('Chord quality'), 'Minor 7th')
      await user.click(screen.getByRole('button', { name: 'Play the Cm7 chord' }))

      const cMinor7 = buildChord(C4, 'minor7', 0).notes.map(toMidi)
      expect(cMinor7).not.toEqual(cMajor)
      expect(audioOutput.calls.filter(isNoteOn).map((c) => c.note).sort()).toEqual(
        [...cMinor7].sort(),
      )
    })

    it('pressing Play a second time cancels the first performance instead of stacking on top of it', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      const button = screen.getByRole('button', { name: 'Play the C chord' })
      await user.click(button)
      await user.click(button)

      const panicIndices = audioOutput.calls.reduce<number[]>(
        (acc, c, i) => (c.kind === 'allNotesOff' ? [...acc, i] : acc),
        [],
      )
      expect(panicIndices).toHaveLength(2)
      expect(panicIndices[0]).toBe(0)
      // C major's 3 notes each send one noteOn + one noteOff: 1 (panic) + 6.
      expect(panicIndices[1]).toBe(7)
    })

    it('changing the inversion while a chord is still ringing panics the audio output', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      await user.click(screen.getByRole('button', { name: 'Play the C chord' }))
      audioOutput.reset()

      await user.selectOptions(screen.getByLabelText('Inversion'), 'First inversion')

      expect(audioOutput.calls).toHaveLength(1)
      expect(audioOutput.calls[0]?.kind).toBe('allNotesOff')
    })

    it('changing the root while a chord is still ringing panics the audio output', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      await user.click(screen.getByRole('button', { name: 'Play the C chord' }))
      audioOutput.reset()

      await user.selectOptions(screen.getByLabelText('Chord root'), 'G')

      expect(audioOutput.calls).toHaveLength(1)
      expect(audioOutput.calls[0]?.kind).toBe('allNotesOff')
    })

    it('changing a picker without ever pressing Play does not panic — nothing here is ringing to cancel, and a stray panic on the shared output would silence ChordScaleReference\'s still-playing scale/chord above it', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      await user.selectOptions(screen.getByLabelText('Chord quality'), 'Minor')

      expect(audioOutput.calls).toHaveLength(0)
    })

    it('unmounting while a chord is still ringing panics the audio output', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      const { unmount } = render(<ChordLookup initialRoot={C4} audioOutput={audioOutput} />)

      await user.click(screen.getByRole('button', { name: 'Play the C chord' }))
      audioOutput.reset()

      unmount()

      expect(audioOutput.calls).toHaveLength(1)
      expect(audioOutput.calls[0]?.kind).toBe('allNotesOff')
    })
  })

  it('initialRoot only seeds the picker; changing the prop after mount does not move the selection', () => {
    const { rerender } = render(<ChordLookup initialRoot={C4} />)
    expect((screen.getByLabelText('Chord root') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('C')

    rerender(<ChordLookup initialRoot={spell('G', 0, 4)} />)
    expect((screen.getByLabelText('Chord root') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('C')
  })

  it('offers flat-spelled roots for the black keys a learner actually reads', () => {
    render(<ChordLookup initialRoot={C4} />)
    const options = within(screen.getByLabelText('Chord root') as HTMLSelectElement).getAllByRole('option')
    const labels = options.map((o) => o.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Db', 'Eb', 'Ab', 'Bb']))
    expect(labels).not.toEqual(expect.arrayContaining(['D#', 'G#', 'A#']))
  })

  it('offers every ChordQuality (all 6 triads and all 7 sevenths), so every seventh chord is reachable', () => {
    render(<ChordLookup initialRoot={C4} />)
    const options = within(screen.getByLabelText('Chord quality') as HTMLSelectElement).getAllByRole(
      'option',
    )
    expect(options).toHaveLength(13)
  })

  it('is reachable by role and accessible name', () => {
    render(<ChordLookup initialRoot={C4} />)
    expect(screen.getByRole('region', { name: 'Chord lookup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play the C chord' })).toBeInTheDocument()
  })

  it('figuredBass and chordSymbol from core match what is rendered, for a non-default quality/inversion combination', async () => {
    const user = userEvent.setup()
    render(<ChordLookup initialRoot={C4} />)

    await user.selectOptions(screen.getByLabelText('Chord root'), 'F#')
    await user.selectOptions(screen.getByLabelText('Chord quality'), 'Half-diminished 7th')
    await user.selectOptions(screen.getByLabelText('Inversion'), 'Second inversion')

    const expected = buildChord(spell('F', 1, 4), 'halfDiminished7', 2)
    expect(screen.getByTestId('chord-lookup-symbol')).toHaveTextContent(chordSymbol(expected))
    expect(screen.getByTestId('chord-lookup-figures')).toHaveTextContent(figuredBass(expected))
  })
})
