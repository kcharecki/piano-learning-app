import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at } from '@core/shared/invariant.ts'
import { letterIndex, spell, toMidi, type Letter, type SpelledPitch } from '@core/theory/pitch.ts'
import type { ScaleType } from '@core/theory/scales.ts'
import type { Hand, ScoreNoteInput } from '@core/notation/score.ts'
import { QUARTER, TRIPLET_EIGHTH } from '@core/shared/units.ts'
import {
  TRIAD_SEQUENCE_STEPS,
  triadSequenceDurationTicks,
  triadSequenceNotes,
  triadSequenceSteps,
  type TriadForm,
} from './triadSequence.ts'

const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const ALTERS = [-1, 0, 1] as const
const PROPERTY_SCALE_TYPES = ['major', 'naturalMinor'] as const satisfies readonly ScaleType[]

const tonicArb: fc.Arbitrary<SpelledPitch> = fc
  .record({
    letter: fc.constantFrom(...LETTERS),
    alter: fc.constantFrom(...ALTERS),
    octave: fc.integer({ min: 3, max: 5 }),
  })
  .map(({ letter, alter, octave }) => spell(letter, alter, octave))

const scaleTypeArb: fc.Arbitrary<ScaleType> = fc.constantFrom(...PROPERTY_SCALE_TYPES)
const handArb: fc.Arbitrary<Hand> = fc.constantFrom('left', 'right')
const formArb: fc.Arbitrary<TriadForm> = fc.constantFrom('broken', 'solid')

/** How many diatonic letter-steps `to` is above `from`, wrapping mod 7 (always 0..6). */
function letterStepsUp(from: Letter, to: Letter): number {
  return (letterIndex(to) - letterIndex(from) + 7) % 7
}

describe('triadSequenceSteps', () => {
  // Kills: a mutant that stacks fixed 4-and-7 semitone intervals for every
  // triad (i.e. always builds a major triad). That mutant reproduces every
  // step here EXCEPT degree 7 (B-D-F), which it would spell as B-D#-F#
  // (74/78 instead of 74/77) — a diminished triad is exactly what this test
  // pins down.
  it('C major, right hand: the eight triads are the exact ascending diatonic stack', () => {
    const steps = triadSequenceSteps(spell('C', 0, 4), 'major', 'right')
    const midis = steps.map((step) => step.notes.map((p) => toMidi(p)))
    expect(midis).toEqual([
      [60, 64, 67],
      [62, 65, 69],
      [64, 67, 71],
      [65, 69, 72],
      [67, 71, 74],
      [69, 72, 76],
      [71, 74, 77], // degree 7: diminished, 3 + 3 semitones, not 4 + 3
      [72, 76, 79],
    ])
    for (const step of steps) expect(step.fingers).toEqual([1, 3, 5])
  })

  it('C major, left hand: fingering is 5-3-1 bottom-to-top on every step', () => {
    const steps = triadSequenceSteps(spell('C', 0, 4), 'major', 'left')
    for (const step of steps) expect(step.fingers).toEqual([5, 3, 1])
  })

  // Kills: a mutant that hardcodes C major (ignores `tonic`/`scaleType` and
  // always builds the C-major triads). G major's leading-tone triad and
  // dominant triad both use F#, which no C-major output ever contains.
  it('G major, right hand: the F# appears — the drill generalises past C', () => {
    const steps = triadSequenceSteps(spell('G', 0, 4), 'major', 'right')
    const allNotes = steps.flatMap((step) => step.notes)
    expect(allNotes.some((p) => p.letter === 'F' && p.alter === 1)).toBe(true)
  })

  it('has TRIAD_SEQUENCE_STEPS steps', () => {
    expect(TRIAD_SEQUENCE_STEPS).toBe(8)
  })

  // Property: every step of every writable tonic/scale/hand combination is a
  // well-formed root-position triad, letter-stacked in thirds, ascending, with
  // roots that climb a full octave and hand-correct fingering throughout.
  it('property: every step is a root-position stack of thirds, ascending, correctly fingered', () => {
    fc.assert(
      fc.property(tonicArb, scaleTypeArb, handArb, (tonic, scaleType, hand) => {
        let steps
        try {
          steps = triadSequenceSteps(tonic, scaleType, hand)
        } catch {
          // Tonic/scale combination is unwritable or its notes fall outside
          // the MIDI range for this generated octave — not what this
          // property is about, skip it.
          return true
        }

        expect(steps).toHaveLength(TRIAD_SEQUENCE_STEPS)

        const expectedFingers = hand === 'right' ? [1, 3, 5] : [5, 3, 1]
        const roots: number[] = []
        for (const step of steps) {
          expect(step.notes).toHaveLength(3)
          expect(step.fingers).toHaveLength(3)
          // Kills: a mutant that swaps the fingering table per hand, or uses
          // one fixed table regardless of `hand`.
          expect(step.fingers).toEqual(expectedFingers)

          const bottom = at(step.notes, 0)
          const middle = at(step.notes, 1)
          const top = at(step.notes, 2)

          // Kills: a mutant that reads the triad off degrees d, d+1, d+3 (or
          // any other spacing) instead of d, d+2, d+4 — the letters would no
          // longer be two diatonic steps apart.
          expect(letterStepsUp(bottom.letter, middle.letter)).toBe(2)
          expect(letterStepsUp(middle.letter, top.letter)).toBe(2)

          const midis = step.notes.map((p) => toMidi(p))
          expect(at(midis, 0)).toBeLessThan(at(midis, 1))
          expect(at(midis, 1)).toBeLessThan(at(midis, 2))

          roots.push(toMidi(bottom))
        }

        for (let i = 1; i < roots.length; i++) {
          expect(at(roots, i)).toBeGreaterThan(at(roots, i - 1))
        }
        expect(at(roots, roots.length - 1) - at(roots, 0)).toBe(12)

        return true
      }),
    )
  })
})

describe('triadSequenceNotes', () => {
  // Kills the mutant this drill actually shipped first: straight EIGHTHs
  // (240 ticks) instead of triplet eighths (160). That mutant ran the drill
  // for 12.0s instead of 8.0s at ♩=60 and started four of the eight triads
  // off the beat, while passing every pitch assertion in this file.
  it('C major, right hand, broken: 24 triplet eighths at ticks 0, 160, … 3680', () => {
    const notes = triadSequenceNotes(spell('C', 0, 4), 'major', 'right', 'broken')
    expect(notes).toHaveLength(24)
    expect(notes.map((n) => n.midi)).toEqual([
      60, 64, 67, 62, 65, 69, 64, 67, 71, 65, 69, 72, 67, 71, 74, 69, 72, 76, 71, 74, 77, 72, 76,
      79,
    ])
    expect(notes.map((n) => n.startTick)).toEqual(
      Array.from({ length: 24 }, (_, i) => i * TRIPLET_EIGHTH),
    )
    for (const n of notes) {
      expect(n.durationTicks).toBe(TRIPLET_EIGHTH)
      expect(n.hand).toBe('right')
    }
    expect(notes.map((n) => n.fingering)).toEqual(
      Array.from({ length: 8 }, () => [1, 3, 5]).flat(),
    )
  })

  // One triad per beat is the whole point of the triplet: the syllabus's
  // ♩=60 has to mean one chord per click, and no triad may straddle a bar.
  it('broken: every triad starts exactly on a beat, and none straddles a barline', () => {
    const notes = triadSequenceNotes(spell('C', 0, 4), 'major', 'right', 'broken')
    const triadStarts = notes.filter((_, i) => i % 3 === 0).map((n) => n.startTick)
    expect(triadStarts).toEqual(Array.from({ length: 8 }, (_, i) => i * QUARTER))
    for (const tick of triadStarts) expect(tick % QUARTER).toBe(0)
    const BAR = 4 * QUARTER
    for (const tick of triadStarts) {
      expect(Math.floor(tick / BAR)).toBe(Math.floor((tick + QUARTER - 1) / BAR))
    }
  })

  it('broken: every note carries a 3:2 tuplet, bracketed start/inner/stop per triad', () => {
    const notes = triadSequenceNotes(spell('C', 0, 4), 'major', 'right', 'broken')
    for (const n of notes) {
      expect(n.tuplet?.actual).toBe(3)
      expect(n.tuplet?.normal).toBe(2)
    }
    expect(notes.map((n) => n.tuplet?.position)).toEqual(
      Array.from({ length: 8 }, () => ['start', 'inner', 'stop']).flat(),
    )
  })

  // The solid form is NOT a tuplet — quarter plus quarter rest, per the same
  // syllabus cell. Guards against the triplet fix leaking across forms.
  it('solid: carries no tuplet at all', () => {
    const notes = triadSequenceNotes(spell('C', 0, 4), 'major', 'right', 'solid')
    for (const n of notes) expect(n.tuplet).toBeUndefined()
  })

  // Kills: a mutant that spaces solid blocks back-to-back with no rest gap
  // (QUARTER apart instead of 2*QUARTER) — the exact tick sequence 0, 960,
  // 1920, … 6720 would instead read 0, 480, 960, … 3360.
  it('C major, right hand, solid: 8 blocks of 3 at ticks 0, 960, … 6720, one quarter note each', () => {
    const notes = triadSequenceNotes(spell('C', 0, 4), 'major', 'right', 'solid')
    expect(notes).toHaveLength(24)
    const blockStarts = Array.from({ length: 8 }, (_, i) => i * 2 * QUARTER)
    expect(notes.map((n) => n.startTick)).toEqual(
      blockStarts.flatMap((tick) => [tick, tick, tick]),
    )
    for (const n of notes) {
      expect(n.durationTicks).toBe(QUARTER)
      expect(n.hand).toBe('right')
    }
    const midisByBlock = Array.from({ length: 8 }, (_, i) =>
      notes.slice(i * 3, i * 3 + 3).map((n) => n.midi),
    )
    expect(midisByBlock).toEqual([
      [60, 64, 67],
      [62, 65, 69],
      [64, 67, 71],
      [65, 69, 72],
      [67, 71, 74],
      [69, 72, 76],
      [71, 74, 77],
      [72, 76, 79],
    ])
  })

  it('durations: broken is 3840 ticks (2 bars of 4/4), solid is 7680 (4 bars)', () => {
    expect(triadSequenceDurationTicks('broken')).toBe(3840)
    expect(triadSequenceDurationTicks('solid')).toBe(7680)
  })

  // Property: whatever the writable tonic/scale/hand/form, the drill always
  // has 24 fully-fingered notes, ticks never go backwards, the right number
  // of distinct onsets exist for the form, and everything fits the declared
  // total duration.
  it('property: 24 fingered notes, non-decreasing ticks, correct onset count, fits the declared duration', () => {
    fc.assert(
      fc.property(tonicArb, scaleTypeArb, handArb, formArb, (tonic, scaleType, hand, form) => {
        let notes: readonly ScoreNoteInput[]
        try {
          notes = triadSequenceNotes(tonic, scaleType, hand, form)
        } catch {
          return true
        }

        expect(notes).toHaveLength(24)

        // Kills: a mutant that forgets to set `fingering` on some notes (e.g.
        // only the bottom note of a solid block) — REQ-3.7.1 requires every
        // note to carry one.
        for (const n of notes) expect(n.fingering).toBeDefined()

        for (let i = 1; i < notes.length; i++) {
          expect(at(notes, i).startTick).toBeGreaterThanOrEqual(at(notes, i - 1).startTick)
        }

        const distinctStarts = new Set(notes.map((n) => n.startTick)).size
        expect(distinctStarts).toBe(form === 'broken' ? 24 : 8)

        const last = at(notes, notes.length - 1)
        expect(last.startTick + last.durationTicks).toBeLessThanOrEqual(
          triadSequenceDurationTicks(form),
        )

        return true
      }),
    )
  })
})
