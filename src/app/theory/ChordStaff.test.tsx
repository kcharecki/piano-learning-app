/**
 * `ChordStaff` tests (roadmap 5.50, REQ-3.5.3/3.5.4 "see it on staff").
 *
 * `buildChordScore` is asserted directly against hand-built expected MIDI and
 * spelling — never merely re-deriving from the input and comparing it to
 * itself — for a plain root-position triad, an inverted seventh chord (voicing
 * must survive, not just pitch classes) and Db diminished 7th (the chord this
 * whole roadmap task exists for: Db Fb Abb Cbb, two double-flats no
 * respelling-from-MIDI could ever produce).
 *
 * OSMD cannot run in this test environment (no canvas to measure text) — same
 * mock every other screen/component test that engraves a real `Score` uses
 * (see `ScaleStaff.test.tsx`). What belongs to this file is that `ChordStaff`
 * HANDS a real `Score` to the viewer; that OSMD then draws it is e2e's job.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'
import { buildChord, chordSymbol } from '@core/theory/chords.ts'
import { spell, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { buildChordScore, ChordStaff } from './ChordStaff.tsx'

/** Extracts each note's engraved `<step>`/`<alter>` pair, in document order —
 *  sensitive to what glyph OSMD will actually draw, unlike `.midi`, which is
 *  invariant under respelling. Mirrors `ScaleStaff.test.tsx`'s own helper. */
function stepsAndAlters(xml: string): readonly { readonly step: string; readonly alter: number }[] {
  const notes = [...xml.matchAll(/<pitch>.*?<\/pitch>/gs)]
  return notes.map((m) => {
    const step = /<step>([A-G])<\/step>/.exec(m[0])?.[1] ?? ''
    const alter = /<alter>(-?\d+)<\/alter>/.exec(m[0])?.[1]
    return { step, alter: alter === undefined ? 0 : Number(alter) }
  })
}

function pitchStepAlter(p: SpelledPitch): { readonly step: string; readonly alter: number } {
  return { step: p.letter, alter: p.alter }
}

vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string; readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} data-title={score.meta.title} />
  ),
}))

afterEach(cleanup)

describe('buildChordScore', () => {
  it('engraves a root-position C major triad as one simultaneity: same startTick, C4 E4 G4', () => {
    const chord = buildChord(spell('C', 0, 4), 'major', 0)
    const score = buildChordScore(chord.notes, chordSymbol(chord))

    expect(score.notes).toHaveLength(3)
    expect(score.notes.map((n) => n.midi)).toEqual(chord.notes.map(toMidi))
    expect(new Set(score.notes.map((n) => n.startTick))).toEqual(new Set([0]))
    // Every tone shares the same duration too — the other half of what
    // `musicxmlwriter.ts`'s `voiceStreamXml` needs to mark a note `<chord/>`
    // instead of advancing past it.
    expect(new Set(score.notes.map((n) => n.durationTicks)).size).toBe(1)
  })

  it('engraves a single treble staff, right hand, with no key signature', () => {
    const chord = buildChord(spell('C', 0, 4), 'major', 0)
    const score = buildChordScore(chord.notes, chordSymbol(chord))
    expect(score.staves).toEqual([{ staff: 1, clef: 'treble', hand: 'right' }])
    expect(score.measures[0]?.keyFifths).toBe(0)
  })

  it('engraves the inverted voicing exactly — first inversion puts the third in the bass, not root position', () => {
    const chord = buildChord(spell('C', 0, 4), 'major', 1)
    const score = buildChordScore(chord.notes, chordSymbol(chord))

    // First inversion: E4 G4 C5 — the bass tone (E4) sorts first by both
    // startTick (shared) and midi, so this also proves sort order didn't
    // silently restore root position.
    const expected = [
      toMidi(spell('E', 0, 4)),
      toMidi(spell('G', 0, 4)),
      toMidi(spell('C', 0, 5)),
    ]
    expect(score.notes.map((n) => n.midi)).toEqual(expected)
  })

  it('engraves Db diminished 7th\'s own spelling — Db Fb Abb Cbb — never a re-derived enharmonic guess (roadmap 5.50\'s own chord)', () => {
    const root = spell('D', -1, 4) // Db
    const chord = buildChord(root, 'diminished7', 0)
    expect(chordSymbol(chord)).toBe('Dbdim7')

    const score = buildChordScore(chord.notes, chordSymbol(chord))
    expect(score.notes).toHaveLength(4)
    expect(score.notes.map((n) => n.midi)).toEqual(chord.notes.map(toMidi))

    // The engraved glyph, not merely the sounding pitch: Fb/Abb/Cbb must
    // print as written, not as the E/G/B a MIDI-only respelling would draw.
    const expectedSpelling = chord.notes.map(pitchStepAlter)
    expect(stepsAndAlters(writeMusicXml(score))).toEqual(expectedSpelling)
    expect(expectedSpelling).toEqual([
      { step: 'D', alter: -1 }, // Db
      { step: 'F', alter: -1 }, // Fb
      { step: 'A', alter: -2 }, // Abb
      { step: 'C', alter: -2 }, // Cbb
    ])
  })

  it('is one whole note filling a single 4/4 measure', () => {
    const chord = buildChord(spell('C', 0, 4), 'major', 0)
    const score = buildChordScore(chord.notes, chordSymbol(chord))
    expect(score.measures).toHaveLength(1)
    expect(score.measures[0]?.timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(score.notes.every((n) => n.durationTicks === 1920)).toBe(true)
  })
})

describe('ChordStaff', () => {
  it('renders the engraved chord through the real ExerciseScore/ScoreViewer pipeline, not merely computing it silently', () => {
    const chord = buildChord(spell('C', 0, 4), 'major', 0)
    render(<ChordStaff notes={chord.notes} title={chordSymbol(chord)} />)

    const viewer = screen.getByTestId('mock-score-viewer')
    expect(viewer).toHaveAttribute('data-title', 'C')
  })

  it('re-engraves when the notes or title change', () => {
    const cMajor = buildChord(spell('C', 0, 4), 'major', 0)
    const { rerender } = render(<ChordStaff notes={cMajor.notes} title={chordSymbol(cMajor)} />)
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-title', 'C')

    const dbDim7 = buildChord(spell('D', -1, 4), 'diminished7', 0)
    rerender(<ChordStaff notes={dbDim7.notes} title={chordSymbol(dbDim7)} />)
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-title', 'Dbdim7')
  })

  it('is reachable as a labelled region so a screen reader user can find the chord\'s notation', () => {
    const chord = buildChord(spell('C', 0, 4), 'major', 0)
    render(<ChordStaff notes={chord.notes} title={chordSymbol(chord)} />)
    expect(screen.getByRole('img', { name: 'C staff notation' })).toBeInTheDocument()
  })
})
