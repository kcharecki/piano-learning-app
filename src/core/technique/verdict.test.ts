import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { midi, millis, ticks, type Midi } from '@core/shared/units.ts'
import type { MatchResult, NoteVerdict } from '@core/practice/matcher.ts'
import type { ScoreNote } from '@core/notation/score.ts'
import { parsePitch, spell, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { unwrap } from '@core/shared/result.ts'
import {
  describeTechniqueMistake,
  diagnoseTechnique,
  type TechniqueKey,
  type TechniqueMistake,
} from './verdict.ts'

const p = (text: string): SpelledPitch => unwrap(parsePitch(text))
const C_MAJOR: TechniqueKey = { tonic: p('C4'), scaleType: 'major' }

function note(spelling: SpelledPitch, index = 0): ScoreNote {
  return {
    id: `m1.r.${String(index * 480)}.${String(toMidi(spelling))}`,
    midi: toMidi(spelling),
    startTick: ticks(index * 480),
    durationTicks: ticks(480),
    hand: 'right',
    voice: 1,
    staff: 1,
    measureIndex: 0,
    velocity: 80,
    tiedFrom: false,
    tiedTo: false,
    spelling,
  }
}

/** The same note as `note`, with no written spelling — what a builder that
 *  does not know one actually emits (the key is absent, not undefined). */
function unspelled(midiNumber: number, index = 0): ScoreNote {
  const { spelling: _dropped, ...rest } = note(spell('C', 0, 4), index)
  return { ...rest, midi: midi(midiNumber) }
}

/** A wrong-pitch result: the score asked for `expected`, the learner played `played`. */
function wrong(expected: SpelledPitch, played: Midi, index = 0): MatchResult {
  return {
    verdict: 'wrongPitch',
    expected: note(expected, index),
    playedMidi: played,
    atMs: millis(index * 500),
  }
}

function plain(verdict: NoteVerdict, index = 0): MatchResult {
  return verdict === 'extra'
    ? { verdict, playedMidi: midi(60), atMs: millis(index * 500) }
    : { verdict, expected: note(p('C4'), index), atMs: millis(index * 500) }
}

// ---------------------------------------------------------------------------
// diagnoseTechnique
// ---------------------------------------------------------------------------

describe('diagnoseTechnique', () => {
  it('names the note played and the note that belonged there', () => {
    const [only] = diagnoseTechnique([wrong(p('E4'), midi(63))], C_MAJOR).mistakes
    expect(only?.expectedName).toBe('E4')
    expect(only?.playedName).toBe('E♭4')
  })

  it('places the expected note on its degree of the drill key', () => {
    const at = (text: string): number | null =>
      diagnoseTechnique([wrong(p(text), midi(toMidi(p(text)) + 1))], C_MAJOR).mistakes[0]?.degree ??
      null
    expect(at('C4')).toBe(1)
    expect(at('E4')).toBe(3)
    expect(at('G4')).toBe(5)
    expect(at('B4')).toBe(7)
  })

  it('reads the degree in the drill key, not in C', () => {
    // The same wrong note means something different in another key: E-flat is
    // the third of C and the tonic of E-flat major. A hardcoded C dies here.
    const inEFlat = diagnoseTechnique([wrong(p('Eb4'), midi(64))], {
      tonic: p('Eb4'),
      scaleType: 'major',
    })
    expect(inEFlat.mistakes[0]?.degree).toBe(1)
    const inC = diagnoseTechnique([wrong(p('E4'), midi(63))], C_MAJOR)
    expect(inC.mistakes[0]?.degree).toBe(3)
  })

  it('spells a flattened note as a flat, not as the sharp below it', () => {
    // `fromMidi(63)` is D#4. A learner flattening the third of a C triad
    // played E-flat, and "you played D♯4 where E4 belongs" is a sentence about
    // two unrelated notes rather than about one note played wrong.
    const [only] = diagnoseTechnique([wrong(p('E4'), midi(63))], C_MAJOR).mistakes
    expect(only?.playedName).toBe('E♭4')
    expect(only?.playedName).not.toBe('D♯4')
  })

  it('spells a sharpened note as a sharp', () => {
    const [only] = diagnoseTechnique([wrong(p('F4'), midi(66))], C_MAJOR).mistakes
    expect(only?.playedName).toBe('F♯4')
  })

  it('crosses the octave correctly when the alteration does', () => {
    // C4 flattened is C-flat 4, which SOUNDS as B3. Keeping the letter is the
    // musically right name and must not silently move the octave with it.
    const [only] = diagnoseTechnique([wrong(p('C4'), midi(59))], C_MAJOR).mistakes
    expect(only?.playedName).toBe('C♭4')
    expect(only?.playedMidi).toBe(59)
  })

  it('falls back to an absolute spelling when the notes are not neighbours', () => {
    // Four semitones out is not "that note played wrong", it is a different
    // note; naming it E-triple-flat would be nonsense.
    const [only] = diagnoseTechnique([wrong(p('G4'), midi(63))], C_MAJOR).mistakes
    expect(only?.playedName).toBe('D♯4')
  })

  it('counts a repeated substitution once, with its count', () => {
    // The case the roadmap was filed for: eight triads played minor is ONE
    // correction, not eight lines of it.
    const run = [0, 1, 2, 3].map((i) => wrong(p('E4'), midi(63), i))
    const { mistakes } = diagnoseTechnique(run, C_MAJOR)
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.count).toBe(4)
  })

  it('keeps distinct substitutions apart', () => {
    const { mistakes } = diagnoseTechnique(
      [wrong(p('E4'), midi(63), 0), wrong(p('G4'), midi(66), 1)],
      C_MAJOR,
    )
    expect(mistakes.map((m) => m.expectedName)).toEqual(['E4', 'G4'])
  })

  it('puts the most frequent mistake first', () => {
    const run = [
      wrong(p('G4'), midi(66), 0),
      wrong(p('E4'), midi(63), 1),
      wrong(p('E4'), midi(63), 2),
      wrong(p('E4'), midi(63), 3),
    ]
    const { mistakes } = diagnoseTechnique(run, C_MAJOR)
    expect(mistakes.map((m) => m.expectedName)).toEqual(['E4', 'G4'])
    expect(mistakes.map((m) => m.count)).toEqual([3, 1])
  })

  it('breaks a tie by where the mistake first appeared', () => {
    const run = [
      wrong(p('G4'), midi(66), 0),
      wrong(p('E4'), midi(63), 1),
      wrong(p('E4'), midi(63), 2),
      wrong(p('G4'), midi(66), 3),
    ]
    expect(diagnoseTechnique(run, C_MAJOR).mistakes.map((m) => m.expectedName)).toEqual([
      'G4',
      'E4',
    ])
  })

  it('counts missed and extra notes without naming them', () => {
    const run = [plain('missed', 0), plain('extra', 1), plain('missed', 2), plain('correct', 3)]
    const d = diagnoseTechnique(run, C_MAJOR)
    expect(d.missed).toBe(2)
    expect(d.extra).toBe(1)
    expect(d.mistakes).toEqual([])
  })

  it('says nothing about a clean run', () => {
    const d = diagnoseTechnique([plain('correct', 0), plain('correct', 1)], C_MAJOR)
    expect(d).toEqual({ mistakes: [], missed: 0, extra: 0 })
  })

  it('leaves the degree null for a note outside the drill key', () => {
    // A chromatic drill still gets the two note names; it just cannot claim a
    // degree, and inventing one would be worse than omitting it.
    const [only] = diagnoseTechnique([wrong(p('F#4'), midi(67))], C_MAJOR).mistakes
    expect(only?.degree).toBeNull()
    expect(only?.expectedName).toBe('F♯4')
  })

  it('re-derives a spelling when the score note carries none', () => {
    const bare: MatchResult = {
      verdict: 'wrongPitch',
      expected: unspelled(64),
      playedMidi: midi(63),
      atMs: millis(0),
    }
    const [only] = diagnoseTechnique([bare], C_MAJOR).mistakes
    expect(only?.expectedName).toBe('E4')
    expect(only?.degree).toBe(3)
  })

  it('property: every mistake names two different sounding pitches', () => {
    // A wrong note that names the same pitch twice would read as nonsense
    // ("you played E4 where E4 belongs"), and is the shape a spelling bug
    // takes when the alteration arithmetic loses the delta.
    fc.assert(
      fc.property(
        fc.integer({ min: 48, max: 84 }),
        fc.integer({ min: -12, max: 12 }).filter((d) => d !== 0),
        (base, delta) => {
          const run: readonly MatchResult[] = [
            {
              verdict: 'wrongPitch',
              expected: unspelled(base),
              playedMidi: midi(base + delta),
              atMs: millis(0),
            },
          ]
          const [only] = diagnoseTechnique(run, C_MAJOR).mistakes
          expect(only).toBeDefined()
          expect(only?.expectedMidi).toBe(base)
          expect(only?.playedMidi).toBe(base + delta)
          expect(only?.playedName).not.toBe(only?.expectedName)
        },
      ),
    )
  })

  it('property: the counts add up to the run', () => {
    // Nothing is dropped and nothing is double-counted, whatever the mix.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<NoteVerdict>('correct', 'wrongPitch', 'missed', 'extra'), {
          maxLength: 30,
        }),
        (verdicts) => {
          const run = verdicts.map((v, i) =>
            v === 'wrongPitch' ? wrong(p('E4'), midi(63), i) : plain(v, i),
          )
          const d = diagnoseTechnique(run, C_MAJOR)
          const named = d.mistakes.reduce((n, m) => n + m.count, 0)
          expect(named).toBe(verdicts.filter((v) => v === 'wrongPitch').length)
          expect(d.missed).toBe(verdicts.filter((v) => v === 'missed').length)
          expect(d.extra).toBe(verdicts.filter((v) => v === 'extra').length)
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// describeTechniqueMistake
// ---------------------------------------------------------------------------

describe('describeTechniqueMistake', () => {
  const mistake = (over: Partial<TechniqueMistake> = {}): TechniqueMistake => ({
    expectedMidi: midi(64),
    playedMidi: midi(63),
    expectedName: 'E4',
    playedName: 'E♭4',
    degree: 3,
    count: 1,
    ...over,
  })

  it('names the degree, the note it is, and the note played instead', () => {
    expect(describeTechniqueMistake(mistake())).toBe('You played E♭4 where the 3rd (E4) belongs.')
  })

  it('says how many times, once it happened more than once', () => {
    expect(describeTechniqueMistake(mistake({ count: 8 }))).toBe(
      'You played E♭4 where the 3rd (E4) belongs — 8 times.',
    )
  })

  it('does not say "1 times"', () => {
    expect(describeTechniqueMistake(mistake({ count: 1 }))).not.toContain('1 times')
  })

  it('drops the degree when there is none, keeping the note names', () => {
    expect(describeTechniqueMistake(mistake({ degree: null, expectedName: 'F♯4' }))).toBe(
      'You played E♭4 where F♯4 belongs.',
    )
  })

  it('writes each ordinal the way it is said', () => {
    const said = (degree: number): string =>
      describeTechniqueMistake(mistake({ degree })).replace(/^You played E♭4 where the /, '')
    expect(said(1).startsWith('1st')).toBe(true)
    expect(said(2).startsWith('2nd')).toBe(true)
    expect(said(3).startsWith('3rd')).toBe(true)
    expect(said(4).startsWith('4th')).toBe(true)
    expect(said(7).startsWith('7th')).toBe(true)
  })

  it('property: always contains both note names and ends in a full stop', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 7 }), fc.integer({ min: 1, max: 40 }), (degree, count) => {
        const text = describeTechniqueMistake(mistake({ degree, count }))
        expect(text).toContain('E♭4')
        expect(text).toContain('E4')
        expect(text.endsWith('.')).toBe(true)
      }),
    )
  })
})
