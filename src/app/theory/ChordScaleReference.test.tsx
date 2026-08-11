/**
 * `ChordScaleReference` is a controlled component: these tests drive its own
 * pickers and assert the displayed scale/chord data actually changes to match
 * — never merely that the section renders. The harmonic/natural minor test in
 * particular would fail for a stub that always shows "the major scale of the
 * root", since it asserts the two minor forms differ from each other.
 *
 * The playback tests (roadmap 3.13, REQ-3.5.3/3.5.4) drive the same "Play"
 * controls a learner would press and assert on a `RecordingAudioOutput`
 * injected via the `audioOutput` prop — never that a function was called,
 * always the exact pitches and their timing, since REQ-3.5.3/3.5.4 is "hear
 * them"/"hear it", not "some sound occurs".
 */
import { chordForRomanNumeral, diatonicChords, romanNumeralFor } from '@core/theory/harmony.ts'
import { keyOf } from '@core/theory/keys.ts'
import { chordSymbol, chordTones } from '@core/theory/chords.ts'
import { pitchName as scalePitchName, spell, toMidi } from '@core/theory/pitch.ts'
import { buildScale, noteAtDegree, scaleNotes } from '@core/theory/scales.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChordScaleReference } from './ChordScaleReference.tsx'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import type { ScaleType } from '@core/theory/scales.ts'
import type { SpelledPitch } from '@core/theory/pitch.ts'
import type { AudioOutput } from '@core/ports/audio.ts'
import type { RecordedAudioCall } from '@test/fakes.ts'

// OSMD cannot run in this test environment (no canvas to measure text) — the
// same mock every other screen/component test that engraves a real `Score`
// uses (see TechniqueScreen.test.tsx, ScaleStaff.test.tsx). `ScaleStaff`
// (roadmap 3.14) hands a real Score down to `ExerciseScore` -> `ScoreViewer`;
// this proves it is actually MOUNTED with the reference's current
// root/scaleType, not merely computed and discarded — that OSMD then draws
// it correctly is ScaleStaff.test.tsx's and e2e's job, not this file's.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string; readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-title={score.meta.title} />
  ),
}))

/** Narrows a `RecordingAudioOutput.calls` entry to the `noteOn` variant, so its
 *  `velocity` field type-checks (the plain `c.kind === 'noteOn'` filters used
 *  elsewhere in this file only need the fields every variant shares). */
function isNoteOn(c: RecordedAudioCall): c is Extract<RecordedAudioCall, { kind: 'noteOn' }> {
  return c.kind === 'noteOn'
}

/** Mirrors the private `noteLabel` in ChordScaleReference.tsx — letter + accidental, no octave. */
function testNoteLabel(p: SpelledPitch): string {
  const sign = p.alter < 0 ? 'b'.repeat(-p.alter) : '#'.repeat(p.alter)
  return `${p.letter}${sign}`
}

afterEach(cleanup)

/** A tiny controlled-state wrapper, mirroring how `TheoryScreen` owns this data. */
function Controlled({
  initialRoot = spell('C', 0, 4),
  initialType = 'major',
  audioOutput,
}: {
  readonly initialRoot?: SpelledPitch
  readonly initialType?: ScaleType
  readonly audioOutput?: AudioOutput
}) {
  const [root, setRoot] = useState(initialRoot)
  const [scaleType, setScaleType] = useState<ScaleType>(initialType)
  return (
    <ChordScaleReference
      root={root}
      scaleType={scaleType}
      onRootChange={setRoot}
      onScaleTypeChange={setScaleType}
      {...(audioOutput === undefined ? {} : { audioOutput })}
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

  describe('ScaleStaff wiring (roadmap 3.14, REQ-3.5.3 "see it on staff")', () => {
    // A component nobody renders is the defect class this task exists to
    // fix (see the module comment on ScaleStaff.tsx) — this proves
    // `ScaleStaff` is actually mounted with the reference's current
    // root/scaleType, both at first render and after the pickers change it,
    // not merely computed and thrown away.
    it('renders the looked-up scale engraved on a staff, matching the default C major', () => {
      render(<Controlled />)
      expect(screen.getByLabelText('C major staff notation')).toBeInTheDocument()
      expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-title', 'C major')
    })

    it('re-engraves the staff when the scale-type picker changes', async () => {
      const user = userEvent.setup()
      render(<Controlled />)

      await user.selectOptions(screen.getByLabelText('Scale'), 'harmonicMinor')

      expect(screen.getByLabelText('C harmonic minor staff notation')).toBeInTheDocument()
      expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute(
        'data-title',
        'C harmonic minor',
      )
    })

    it('re-engraves the staff when the root picker changes', async () => {
      const user = userEvent.setup()
      render(<Controlled />)

      await user.selectOptions(screen.getByLabelText('Root'), 'G')

      expect(screen.getByLabelText('G major staff notation')).toBeInTheDocument()
    })
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

  it('shows real fingering numbers for the minor forms, not dashes (roadmap 5.35)', () => {
    // C minor takes the C-major pattern: RH 1 2 3 1 2 3 4 5, LH 5 4 3 2 1 3 2 1.
    render(<Controlled initialType="harmonicMinor" />)
    const expected = [
      ['1', '5'],
      ['2', '4'],
      ['3', '3'],
      ['1', '2'],
      ['2', '1'],
      ['3', '3'],
      ['4', '2'],
    ]
    for (const [i, [right, left]] of expected.entries()) {
      const cells = within(screen.getByTestId(`scale-degree-${i + 1}`)).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent(String(right))
      expect(cells[3]).toHaveTextContent(String(left))
    }
  })

  it('still shows a dash for every fingering cell when the scale type has no defined fingering', () => {
    // The modes are deliberately out of scope, so the fallback still has to work.
    render(<Controlled initialType="dorian" />)
    for (let degree = 1; degree <= 7; degree++) {
      const row = screen.getByTestId(`scale-degree-${degree}`)
      const cells = within(row).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('—')
      expect(cells[3]).toHaveTextContent('—')
    }
  })

  it('a mode not in the graded syllabi reads that sentence instead of a bare dash (roadmap 5.37)', () => {
    render(<Controlled initialType="dorian" />)
    const row = screen.getByTestId('scale-degree-1')
    expect(row).toHaveTextContent('no standard fingering — modes are not in the graded syllabi')
    // Minor scales are a different case (roadmap 5.35, not this task) — they
    // still read a bare dash, never this sentence, because minor scales ARE
    // in the graded syllabi.
  })

  it('substitutes the raised-leading-tone V and vii° chords for harmonic minor instead of the natural-minor reading', async () => {
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

    // Finding 5's tripwire: the same raised-leading-tone substitution must
    // also apply to sevenths (V7/vii°7), not just triads — a mutant that
    // collapses `chordForRomanNumeral(seventh ? 'V7' : 'V', key)` to always
    // request the triad form previously survived the scoped suite because
    // triads and sevenths were never asserted together here.
    await userEvent.setup().click(screen.getByLabelText('Show seventh chords'))
    const raisedV7 = chordForRomanNumeral('V7', key.value)
    const raisedViio7 = chordForRomanNumeral('vii°7', key.value)
    if (!raisedV7.ok || !raisedViio7.ok) throw new Error('C harmonic minor must have V7 and vii°7')
    expect(screen.getByTestId('diatonic-chord-V7')).toHaveTextContent(chordSymbol(raisedV7.value))
    expect(screen.getByTestId('diatonic-chord-vii°7')).toHaveTextContent(
      chordSymbol(raisedViio7.value),
    )
  })

  describe('chords for scale types with no key (roadmap 3.15)', () => {
    // The old bug: the whole chords section vanished for these ten scale
    // types. A stub that brings back a `null`/empty render here (rather than
    // `scaleDegreeStacks`' real per-degree chords) is killed below.
    it('shows chords built from the scale\'s own degrees instead of a false key, for a mode with no diatonic reading', () => {
      render(<Controlled initialType="dorian" />)

      // Not the key-based section — that name is reserved for a real key.
      expect(screen.queryByRole('list', { name: 'Diatonic chords' })).not.toBeInTheDocument()

      const list = screen.getByRole('list', { name: 'Chords from scale degrees' })
      const dorian = buildScale(spell('C', 0, 4), 'dorian')
      expect(within(list).getAllByRole('listitem')).toHaveLength(dorian.notes.length)

      // Degree 1's chord is literally the scale's own 1st/3rd/5th degrees
      // stacked — not some invented major/minor label.
      const firstRow = screen.getByTestId('diatonic-chord-1')
      const expectedSymbol = [1, 3, 5]
        .map((d) => noteAtDegree(dorian, d))
        .map(testNoteLabel)
        .join('–')
      expect(firstRow).toHaveTextContent(expectedSymbol)

      // Degree 2's chord differs from degree 1's — proves every degree is
      // actually stacked from its own scale position, not one fixed triad
      // repeated seven times.
      const secondRow = screen.getByTestId('diatonic-chord-2')
      const secondSymbol = [2, 4, 6]
        .map((d) => noteAtDegree(dorian, d))
        .map(testNoteLabel)
        .join('–')
      expect(secondRow).toHaveTextContent(secondSymbol)
      expect(secondSymbol).not.toBe(expectedSymbol)
    })

    it('works for a pentatonic scale (5 degrees, not 7)', () => {
      render(<Controlled initialType="majorPentatonic" />)
      const list = screen.getByRole('list', { name: 'Chords from scale degrees' })
      const scale = buildScale(spell('C', 0, 4), 'majorPentatonic')
      expect(scale.notes).toHaveLength(5)
      expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    })

    it('works for the chromatic scale (12 degrees)', () => {
      render(<Controlled initialType="chromatic" />)
      const list = screen.getByRole('list', { name: 'Chords from scale degrees' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(12)
    })

    it('the "hear it" Play button for a scale-degree chord sends that chord\'s exact tones as a simultaneity', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled initialType="dorian" audioOutput={audioOutput} />)

      const dorian = buildScale(spell('C', 0, 4), 'dorian')
      const expected = [1, 3, 5].map((d) => toMidi(noteAtDegree(dorian, d)))
      const numeralText = '1'
      const row = screen.getByTestId(`diatonic-chord-${numeralText}`)
      await user.click(within(row).getByRole('button'))

      const noteOnCalls = audioOutput.calls.filter(isNoteOn)
      expect(noteOnCalls.map((c) => c.note).sort((a, b) => a - b)).toEqual(
        [...expected].sort((a, b) => a - b),
      )
      const timestamps = new Set(noteOnCalls.map((c) => c.at))
      expect(timestamps.size).toBe(1)
    })

    it('toggling "Show seventh chords" builds a four-note stack per degree instead of a triad', async () => {
      const user = userEvent.setup()
      render(<Controlled initialType="dorian" />)

      await user.click(screen.getByLabelText('Show seventh chords'))

      const dorian = buildScale(spell('C', 0, 4), 'dorian')
      const expectedSymbol = [1, 3, 5, 7]
        .map((d) => noteAtDegree(dorian, d))
        .map(testNoteLabel)
        .join('–')
      expect(screen.getByTestId('diatonic-chord-1')).toHaveTextContent(expectedSymbol)
    })
  })

  it('toggling "Show seventh chords" switches the key-based diatonic chords to sevenths', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    const key = keyOf(spell('C', 0, 4), 'major')
    if (!key.ok) throw new Error('C major must be a valid key')
    const triads = diatonicChords(key.value)
    const vTriad = triads[4]
    if (vTriad === undefined) throw new Error('C major must have a V chord')
    // Sanity: the V triad is a plain "G" before the toggle.
    expect(screen.getByTestId('diatonic-chord-V')).toHaveTextContent(chordSymbol(vTriad))

    await user.click(screen.getByLabelText('Show seventh chords'))

    const sevenths = diatonicChords(key.value, true)
    const vSeventh = sevenths[4]
    if (vSeventh === undefined) throw new Error('C major must have a V7 chord')
    const numeral = romanNumeralFor(vSeventh, key.value)
    expect(numeral?.text).toBe('V7')
    expect(screen.getByTestId(`diatonic-chord-${numeral?.text}`)).toHaveTextContent(
      chordSymbol(vSeventh),
    )
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

  it('falls back to the scale-degree chords, not a vanished section, for an unwritable root/mode', () => {
    // D# major has no standard key signature (would need 9 sharps) — `keyOf`
    // fails even though `mode` ('major') is non-null. Finding 3: this used
    // to render only an error paragraph and no chords at all; now it falls
    // back to the same honest scale-degree stacking the mode === null scale
    // types already use, so the chords section never silently vanishes.
    render(<Controlled initialRoot={spell('D', 1, 4)} initialType="major" />)
    expect(screen.queryByRole('list', { name: 'Diatonic chords' })).not.toBeInTheDocument()
    expect(screen.queryByText(/is not a writable key/)).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Chords from scale degrees' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
  })

  it('falls back to scale-degree chords for Db minor (Db is a writable major key but not a writable minor one)', () => {
    // Finding 3: `keyOf(Db, 'minor')` fails while `keyModeFor('naturalMinor')`
    // is still 'minor' (non-null) — the exact "mode exists but the key is
    // unwritable" case that used to reach `DiatonicChords`'s error branch
    // even though the scale table and keyboard above it render Db natural
    // minor's seven notes just fine.
    render(<Controlled initialRoot={spell('D', -1, 4)} initialType="naturalMinor" />)
    expect(screen.queryByRole('list', { name: 'Diatonic chords' })).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Chords from scale degrees' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
  })

  describe('playback (REQ-3.5.3/3.5.4)', () => {
    // A stub that always plays a C major scale regardless of the looked-up
    // root/type would pass every other test in this file (none of them touch
    // audio) but is killed here: it would send [60,62,64,65,67,69,71,72]
    // instead of G major's own pitches.
    //
    // `playedNotes` alone (pitches only) lets three mutants survive:
    // `SCALE_NOTE_SPACING_MS = 0` (every note fires as one cluster),
    // deleting both `noteOff` calls (every note rings 8s to the adapter's
    // safety net), and `PLAY_VELOCITY = 0` (the feature would be completely
    // silent). This asserts the raw recorded `calls` instead — timestamps,
    // a matching `noteOff` per `noteOn`, and an audible velocity — so all
    // three fail here (see the roadmap finding).
    it('pressing "Play G major scale" sends exactly G major\'s pitches, ascending and spaced, with a note-off for each and an audible velocity', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled audioOutput={audioOutput} />)

      await user.selectOptions(screen.getByLabelText('Root'), 'G')
      expect(screen.getByTestId('reference-scale-name')).toHaveTextContent('G major')

      const button = screen.getByRole('button', { name: 'Play G major scale' })
      await user.click(button)

      const expected = scaleNotes(spell('G', 0, 4), 'major', 1).map((n) => toMidi(n))
      expect(audioOutput.playedNotes).toEqual(expected)

      const noteOnCalls = audioOutput.calls.filter(isNoteOn)
      const noteOffCalls = audioOutput.calls.filter((c) => c.kind === 'noteOff')
      expect(noteOnCalls.map((c) => c.note)).toEqual(expected)
      // Ascending, spaced 400ms apart from the base reading — kills the
      // `SCALE_NOTE_SPACING_MS = 0` mutant (which would send [0,0,0,...]).
      expect(noteOnCalls.map((c) => c.at)).toEqual(expected.map((_, i) => i * 400))
      // A matching noteOff per noteOn, one per note — kills the mutant that
      // deletes both `noteOff` calls (every note would ring to the adapter's
      // 8s safety net with no `noteOff` sent at all).
      expect(noteOffCalls).toHaveLength(noteOnCalls.length)
      for (const [i, offCall] of noteOffCalls.entries()) {
        const onCall = noteOnCalls[i]
        expect(onCall).toBeDefined()
        expect(offCall.at).toBeGreaterThan(onCall?.at ?? -1)
      }
      // Every recorded velocity is audible — kills the `PLAY_VELOCITY = 0`
      // mutant (silent, but every other assertion in this file still passes).
      for (const call of noteOnCalls) {
        expect(call.velocity).toBeGreaterThan(0)
      }
    })

    // A stub that ignores the root/scale-type pickers (e.g. hard-codes the
    // scale it schedules) would pass the first assertion below by accident if
    // it happened to default to C major, but fails the second: after
    // switching to D harmonic minor the exact same button must send D
    // harmonic minor's pitches, not C major's again.
    it('changing the root and scale type and pressing Play again sends the new pitches, not the old ones', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled audioOutput={audioOutput} />)

      await user.click(screen.getByRole('button', { name: 'Play C major scale' }))
      const cMajor = scaleNotes(spell('C', 0, 4), 'major', 1).map((n) => toMidi(n))
      expect(audioOutput.playedNotes).toEqual(cMajor)

      audioOutput.reset()
      await user.selectOptions(screen.getByLabelText('Root'), 'D')
      await user.selectOptions(screen.getByLabelText('Scale'), 'harmonicMinor')
      await user.click(screen.getByRole('button', { name: 'Play D harmonic minor scale' }))

      const dHarmonicMinor = scaleNotes(spell('D', 0, 4), 'harmonicMinor', 1).map((n) => toMidi(n))
      expect(dHarmonicMinor).not.toEqual(cMajor)
      expect(audioOutput.playedNotes).toEqual(dHarmonicMinor)
    })

    // A stub that arpeggiates the chord (staggers each tone's `atMs` instead
    // of stacking them) is killed by the `at` assertion: every noteOn below
    // must share one timestamp, not three increasing ones.
    it('pressing a chord row\'s Play button sends that chord\'s exact tones at the same timestamp, ringing for the chord duration', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled audioOutput={audioOutput} />)

      const key = keyOf(spell('C', 0, 4), 'major')
      if (!key.ok) throw new Error('C major must be a valid key')
      const chords = diatonicChords(key.value)
      const vChord = chords[4]
      if (vChord === undefined) throw new Error('C major must have a V chord')
      const numeral = romanNumeralFor(vChord, key.value)
      expect(numeral?.text).toBe('V')
      const expectedTones = chordTones(vChord).map((t) => toMidi(t))

      await user.click(screen.getByRole('button', { name: 'Play the V chord' }))

      const noteOnCalls = audioOutput.calls.filter(isNoteOn)
      expect(noteOnCalls.map((c) => c.note).sort((a, b) => a - b)).toEqual(
        [...expectedTones].sort((a, b) => a - b),
      )
      const timestamps = new Set(noteOnCalls.map((c) => c.at))
      expect(timestamps.size).toBe(1)

      // `timestamps.size === 1` alone doesn't prove the component derived and
      // passed an explicit `atMs`: `RecordingAudioOutput.at()` falls back to
      // `clock.now()` when `atMs` is omitted, and the never-advancing
      // `FakeClock` would record that same fallback value for every tone too
      // — a stub calling `noteOn(note, velocity)` with no third argument at
      // all would pass the assertion above. What only the real component does
      // is also pass an explicit `noteOff` `atMs` derived from that base plus
      // the chord's ring duration, which a same-fallback stub cannot produce
      // (its `noteOff()` would default to `clock.now()`, equal to the onset,
      // not onset + a ring duration).
      const noteOffCalls = audioOutput.calls.filter((c) => c.kind === 'noteOff')
      const [sharedOnMs] = [...timestamps]
      const CHORD_RING_MS = 800 // mirrors the private CHORD_DURATION_MS in ChordScaleReference.tsx
      expect(noteOffCalls).toHaveLength(noteOnCalls.length)
      expect(noteOffCalls.map((c) => c.at)).toEqual(
        noteOnCalls.map(() => (sharedOnMs ?? 0) + CHORD_RING_MS),
      )
    })

    it('a chord row\'s Play button and the scale Play button are reachable by role and accessible name', () => {
      render(<Controlled />)
      expect(screen.getByRole('button', { name: 'Play C major scale' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Play the V chord' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Play the ii chord' })).toBeInTheDocument()
    })

    // Without an `allNotesOff()` panic at the top of the play functions, a
    // second press stacks its notes on top of the first performance's still-
    // ringing ones instead of restarting — see the finding-3 report ("press
    // Play, press Play again" produces a cluster). This proves the second
    // press cancels the first: exactly one panic per press, and the second
    // panic lands before that press's own notes are scheduled, not after.
    it('pressing Play a second time cancels the first performance instead of stacking on top of it', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled audioOutput={audioOutput} />)

      const button = screen.getByRole('button', { name: 'Play C major scale' })
      await user.click(button)
      await user.click(button)

      const kinds = audioOutput.calls.map((c) => c.kind)
      const panicIndices = kinds.reduce<number[]>(
        (acc, kind, i) => (kind === 'allNotesOff' ? [...acc, i] : acc),
        [],
      )
      expect(panicIndices).toHaveLength(2)
      // The first press's panic (nothing to cancel yet) is the very first call.
      expect(panicIndices[0]).toBe(0)
      // C major's 8 notes (7 degrees + octave) each send one noteOn + one
      // noteOff, so the first press contributes 1 (panic) + 16 (8 note pairs)
      // = 17 calls before the second press's own panic.
      const cMajorNoteCount = scaleNotes(spell('C', 0, 4), 'major', 1).length
      expect(panicIndices[1]).toBe(1 + cMajorNoteCount * 2)
    })

    // The cleanup effect (not the play functions themselves) is what cancels
    // a still-ringing performance when the looked-up root/scale changes out
    // from under it — see the finding-3 report ("press Play, then select a
    // different root while it's running" leaves the old scale audibly
    // finishing under the new selection). This drives that exact sequence.
    it('changing the root while a scale is still ringing panics the audio output', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled audioOutput={audioOutput} />)

      await user.click(screen.getByRole('button', { name: 'Play C major scale' }))
      audioOutput.reset()

      await user.selectOptions(screen.getByLabelText('Root'), 'G')

      expect(audioOutput.calls).toHaveLength(1)
      expect(audioOutput.calls[0]?.kind).toBe('allNotesOff')
    })
  })

  describe('shared AudioContext (roadmap finding 4)', () => {
    // A structural fake, just enough for `createWebAudioOutput` to build its
    // master gain node without touching real Web Audio (happy-dom has no
    // AudioContext at all). Only identity matters here, not sound.
    class FakeAudioContext {
      currentTime = 0
      readonly destination = {}
      createGain(): { connect: () => void } {
        return { connect: () => {} }
      }
    }

    it('createDefaultAudioOutput shares one AudioContext across every caller instead of building a new one per call', () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      try {
        const first = createDefaultAudioOutput()
        const second = createDefaultAudioOutput()
        expect(second).toBe(first)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('ChordLookup wiring (roadmap 3.15, REQ-3.5.4 "look up ANY chord")', () => {
    // A component nobody renders is the defect class this task exists to
    // fix — this proves `ChordLookup` is actually mounted, not merely
    // written, by driving its own pickers to a chord the diatonic-chords
    // section of a major-key reference could never reach.
    it('renders a chord lookup that can look up a chord no diatonic-chords section could show, e.g. Db diminished 7th', async () => {
      const user = userEvent.setup()
      render(<Controlled />)

      const lookup = screen.getByRole('region', { name: 'Chord lookup' })
      await user.selectOptions(within(lookup).getByLabelText('Chord root'), 'Db')
      await user.selectOptions(within(lookup).getByLabelText('Chord quality'), 'Diminished 7th')

      expect(within(lookup).getByTestId('chord-lookup-symbol')).toHaveTextContent('Dbdim7')
      expect(
        screen.queryByRole('list', { name: 'Diatonic chords' }),
      ).not.toHaveTextContent('Dbdim7')
    })

    it('seeds the lookup\'s root from the reference\'s current root, and re-seeds it when the reference\'s root changes', async () => {
      // Finding 1: `initialRoot` used to be read only at mount, and
      // ChordScaleReference never remounted ChordLookup while its own root
      // changed (same element position, no `key`) — so a learner who
      // selected e.g. A on the circle of fifths still saw the lookup seeded
      // on whatever root the screen first mounted with, making the "seeds
      // from the reference's current root" contract unobservable outside
      // tests. Keying ChordLookup on the reference's root makes it re-seed
      // (and reset quality/inversion — a new reference root is a fresh
      // lookup session, not a mid-edit of the old one).
      const user = userEvent.setup()
      render(<Controlled initialRoot={spell('G', 0, 4)} />)

      const lookupRootLabel = () =>
        (
          within(screen.getByRole('region', { name: 'Chord lookup' })).getByLabelText(
            'Chord root',
          ) as HTMLSelectElement
        ).selectedOptions[0]

      expect(lookupRootLabel()).toHaveTextContent('G')

      await user.selectOptions(screen.getByLabelText('Root'), 'A')
      expect(lookupRootLabel()).toHaveTextContent('A')
    })

    it('shares the injected audioOutput with the reference, rather than building its own second audio path', async () => {
      const user = userEvent.setup()
      const clock = new FakeClock(0)
      const audioOutput = new RecordingAudioOutput(clock)
      render(<Controlled audioOutput={audioOutput} />)

      const lookup = screen.getByRole('region', { name: 'Chord lookup' })
      await user.click(within(lookup).getByRole('button', { name: /^Play the .* chord$/ }))

      // The chord lookup's own Play button reached the very same injected
      // RecordingAudioOutput the rest of the screen uses, not a second,
      // unobserved one.
      expect(audioOutput.calls.some((c) => c.kind === 'noteOn')).toBe(true)
    })
  })
})
