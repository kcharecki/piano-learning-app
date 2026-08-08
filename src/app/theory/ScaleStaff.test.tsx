/**
 * `ScaleStaff` tests (roadmap 3.14, REQ-3.5.3/3.5.4).
 *
 * `buildScaleScore` is tested directly against hand-computed expected MIDI
 * sequences (never merely re-deriving from `scaleNotes` and comparing it to
 * itself) for the four named cases: A natural minor, A melodic minor
 * ascending (raised 6th/7th: F#, G#), F# major (a 6-sharp key) and a modal
 * type (D dorian) — proving the exact scale content, in order, actually
 * reaches the `Score`.
 *
 * OSMD cannot run in this test environment (no canvas to measure text) — the
 * same mock every other screen test that engraves a real `Score` uses (see
 * `TechniqueScreen.test.tsx`/`SightReadingScreen.test.tsx`). What belongs to
 * this file is that `ScaleStaff` HANDS a real `Score` to the viewer; that
 * OSMD then draws it is e2e's job.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyOf } from '@core/theory/keys.ts'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'
import { spell, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { scaleNotes } from '@core/theory/scales.ts'
import { buildScaleScore, ScaleStaff } from './ScaleStaff.tsx'

/** Extracts each note's engraved `<step>`/`<alter>` pair from the writer's
 *  MusicXML output, in document order — sensitive to what glyph OSMD will
 *  actually draw, unlike `.midi`, which is invariant under respelling. */
function stepsAndAlters(xml: string): readonly { readonly step: string; readonly alter: number }[] {
  const notes = [...xml.matchAll(/<pitch>.*?<\/pitch>/gs)]
  return notes.map((m) => {
    const step = /<step>([A-G])<\/step>/.exec(m[0])?.[1] ?? ''
    const alter = /<alter>(-?\d+)<\/alter>/.exec(m[0])?.[1]
    return { step, alter: alter === undefined ? 0 : Number(alter) }
  })
}

/** `{ step, alter }` for a spelled pitch, matching `stepsAndAlters`' shape. */
function pitchStepAlter(p: SpelledPitch): { readonly step: string; readonly alter: number } {
  return { step: p.letter, alter: p.alter }
}

vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string; readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} data-title={score.meta.title} />
  ),
}))

afterEach(cleanup)

/** Hand-built expected pitch, mirroring what a musician would write for each degree. */
function midiOf(letter: SpelledPitch['letter'], alter: SpelledPitch['alter'], octave: number): number {
  return toMidi(spell(letter, alter, octave))
}

describe('buildScaleScore', () => {
  it('engraves A natural minor with the key\'s own (0-sharp) signature and exactly A B C D E F G A', () => {
    const root = spell('A', 0, 4)
    const score = buildScaleScore(root, 'naturalMinor')

    const expected = [
      midiOf('A', 0, 4),
      midiOf('B', 0, 4),
      midiOf('C', 0, 5),
      midiOf('D', 0, 5),
      midiOf('E', 0, 5),
      midiOf('F', 0, 5),
      midiOf('G', 0, 5),
      midiOf('A', 0, 5),
    ]
    expect(score.notes.map((n) => n.midi)).toEqual(expected)

    const key = keyOf(root, 'minor')
    expect(key.ok).toBe(true)
    if (key.ok) expect(score.measures[0]?.keyFifths).toBe(key.value.signature.fifths)
    expect(score.measures[0]?.keyFifths).toBe(0)
  })

  it('engraves a single treble staff, right hand', () => {
    expect(buildScaleScore(spell('C', 0, 4), 'major').staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
    ])
  })

  it('engraves harmonic and melodic minor against the parallel natural-minor key signature, not fifths = 0', () => {
    expect(buildScaleScore(spell('C', 0, 4), 'harmonicMinor').measures[0]?.keyFifths).toBe(-3)
    expect(buildScaleScore(spell('C', 0, 4), 'melodicMinor').measures[0]?.keyFifths).toBe(-3)
  })

  it('engraves A melodic minor ascending with the raised 6th and 7th (F#, G#) — not natural minor\'s F/G', () => {
    const root = spell('A', 0, 4)
    const score = buildScaleScore(root, 'melodicMinor')

    const expected = [
      midiOf('A', 0, 4),
      midiOf('B', 0, 4),
      midiOf('C', 0, 5),
      midiOf('D', 0, 5),
      midiOf('E', 0, 5),
      midiOf('F', 1, 5), // F#
      midiOf('G', 1, 5), // G#
      midiOf('A', 0, 5),
    ]
    expect(score.notes.map((n) => n.midi)).toEqual(expected)

    // Distinguishes this from a stub that always shows natural minor: the
    // 6th/7th degrees must differ.
    const naturalScore = buildScaleScore(root, 'naturalMinor')
    expect(score.notes.map((n) => n.midi)).not.toEqual(naturalScore.notes.map((n) => n.midi))
  })

  it('engraves F# major with its own 6-sharp key signature and the scale\'s exact pitches', () => {
    const root = spell('F', 1, 4) // F#
    const score = buildScaleScore(root, 'major')

    const expected = [
      midiOf('F', 1, 4), // F#
      midiOf('G', 1, 4), // G#
      midiOf('A', 1, 4), // A#
      midiOf('B', 0, 4), // B
      midiOf('C', 1, 5), // C#
      midiOf('D', 1, 5), // D#
      midiOf('E', 1, 5), // E# — sounds as F5 (midi 77); see ScaleStaff.tsx's
      // "Spelling limitation" doc comment for why the on-screen glyph cannot
      // show the E# spelling even though this Score's sounding pitch does.
      midiOf('F', 1, 5), // F# (octave)
    ]
    expect(score.notes.map((n) => n.midi)).toEqual(expected)

    const key = keyOf(root, 'major')
    expect(key.ok).toBe(true)
    if (key.ok) {
      expect(key.value.signature.fifths).toBe(6)
      expect(score.measures[0]?.keyFifths).toBe(6)
    }
  })

  it('engraves a modal scale (D dorian) with no key signature, one octave ascending in quarter notes', () => {
    const root = spell('D', 0, 4)
    const score = buildScaleScore(root, 'dorian')

    const expected = [
      midiOf('D', 0, 4),
      midiOf('E', 0, 4),
      midiOf('F', 0, 4),
      midiOf('G', 0, 4),
      midiOf('A', 0, 4),
      midiOf('B', 0, 4),
      midiOf('C', 0, 5),
      midiOf('D', 0, 5),
    ]
    expect(score.notes.map((n) => n.midi)).toEqual(expected)
    expect(score.measures[0]?.keyFifths).toBe(0)
    expect(score.notes.every((n) => n.durationTicks === 480)).toBe(true)
    expect(score.notes.map((n) => n.startTick)).toEqual(expected.map((_, i) => i * 480))
  })

  it('is one octave ascending for scales of any length: degree count plus the octave repeat', () => {
    expect(buildScaleScore(spell('C', 0, 4), 'majorPentatonic').notes).toHaveLength(6) // 5 + octave
    expect(buildScaleScore(spell('C', 0, 4), 'chromatic').notes).toHaveLength(13) // 12 + octave
    expect(buildScaleScore(spell('C', 0, 4), 'wholeTone').notes).toHaveLength(7) // 6 + octave
  })

  it('engraves the WRITTEN spelling, not merely an enharmonically-equivalent one, for a flat modal scale', () => {
    // Bb dorian: table/scaleNotes reads Bb C Db Eb F G Ab Bb. A fifths = 0 (or
    // any sharp-biased) signature would make the engraver draw A# C C# D# F G
    // G# A# instead — right pitches, wrong letters.
    const root = spell('B', -1, 4) // Bb
    const score = buildScaleScore(root, 'dorian')
    const expected = scaleNotes(root, 'dorian', 1).map(pitchStepAlter)
    expect(stepsAndAlters(writeMusicXml(score))).toEqual(expected)
  })

  // A second spelling-sensitive case for a raised-leading-tone scale (e.g. G
  // harmonic minor) is deliberately NOT added here: that one is the
  // known-and-flagged limitation documented in this file's "Spelling
  // limitation" doc comment (`preferFlats` is a per-measure, not per-note,
  // decision) — asserting the correct spelling for it would fail, and fixing
  // it needs a spelling field on `ScoreNote` outside this component's owned
  // files. See that doc comment for the full 42/51-combination breakdown.

  it('matches core\'s own scaleNotes exactly, note for note, for every scale type it engraves', () => {
    // A second, independent check across the whole SCALE_TYPES surface (not
    // just the four named cases above): every engraved pitch is exactly
    // `scaleNotes`'s own sounding value, in the same order.
    const root = spell('E', -1, 4) // Eb
    for (const type of ['harmonicMinor', 'lydian', 'blues', 'minorPentatonic'] as const) {
      const score = buildScaleScore(root, type)
      const expected = scaleNotes(root, type, 1).map(toMidi)
      expect(score.notes.map((n) => n.midi)).toEqual(expected)
    }
  })
})

describe('ScaleStaff', () => {
  it('renders the engraved scale through the real ExerciseScore/ScoreViewer pipeline, not merely computing it silently', () => {
    render(<ScaleStaff root={spell('C', 0, 4)} scaleType="major" />)

    const viewer = screen.getByTestId('mock-score-viewer')
    expect(viewer).toHaveAttribute('data-title', 'C major')
  })

  it('re-engraves when the root or scale type changes', () => {
    const { rerender } = render(<ScaleStaff root={spell('C', 0, 4)} scaleType="major" />)
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-title', 'C major')

    rerender(<ScaleStaff root={spell('G', 0, 4)} scaleType="harmonicMinor" />)
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-title', 'G harmonic minor')
  })

  it('is reachable as a labelled region so a screen reader user can find the scale\'s notation', () => {
    render(<ScaleStaff root={spell('C', 0, 4)} scaleType="major" />)
    expect(screen.getByRole('img', { name: 'C major staff notation' })).toBeInTheDocument()
  })
})
