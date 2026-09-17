import { describe, expect, it } from 'vitest'
import { midi, type Midi } from '@core/shared/units.ts'
import { invertChord } from '@core/theory/chords.ts'
import { chordForRomanNumeral } from '@core/theory/harmony.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { toMidi, pitchClass } from '@core/theory/pitch.ts'
import { cadenceGroupVerdict, describeCadenceRule, type CadenceAnswer, type CadenceRule } from './cadenceGrading.ts'

const C_MAJOR = keyFromFifths(0, 'major')

function chord(numeral: string) {
  const result = chordForRomanNumeral(numeral, C_MAJOR)
  if (!result.ok) throw new Error(`'${numeral}' must be diatonic in C major: ${result.error}`)
  return result.value
}

function answer(type: CadenceAnswer['type'], first: string, second: string): CadenceAnswer {
  return {
    type,
    chords: [chord(first), chord(second)],
    tonicPitchClass: pitchClass(toMidi(C_MAJOR.tonic)),
  }
}

const notes = (...ns: readonly number[]): readonly Midi[] => ns.map((n) => midi(n))

const PAC = answer('perfect-authentic', 'V', 'I')

/**
 * The accept/refuse half of the verdict. Most of this file asks WHETHER a
 * group is the cadence, which is a true/false claim and reads best as one;
 * which rule a refusal applied is pinned in its own block at the bottom.
 */
const matches = (cadence: CadenceAnswer, index: number, played: readonly Midi[]): boolean =>
  cadenceGroupVerdict(cadence, index, played).ok

/** The rule behind a refusal. Throws on a match rather than returning a sentinel. */
const ruleFor = (cadence: CadenceAnswer, index: number, played: readonly Midi[]): CadenceRule => {
  const verdict = cadenceGroupVerdict(cadence, index, played)
  if (verdict.ok) throw new Error('expected this group to be refused, but it matched')
  return verdict.rule
}

describe('cadenceGroupVerdict — is this the chord?', () => {
  it('accepts the complete triad, in any octave arrangement', () => {
    expect(matches(PAC, 0, notes(67, 71, 74))).toBe(true)
    // G2 D4 B5 — same three pitch classes, spread over three octaves, bass
    // still the root.
    expect(matches(PAC, 0, notes(43, 62, 83))).toBe(true)
  })

  it('accepts any doubling of chord tones', () => {
    expect(matches(PAC, 0, notes(55, 67, 71, 74, 79))).toBe(true)
  })

  it('accepts a chord with the fifth omitted — root, third, doubled root', () => {
    expect(matches(PAC, 1, notes(60, 64, 72))).toBe(true)
  })

  it('refuses a chord missing its third, which is what fixes the quality', () => {
    // C4 G4 C5: an open fifth is not a triad.
    expect(matches(PAC, 1, notes(60, 67, 72))).toBe(false)
  })

  it('refuses a chord missing its root', () => {
    // E4 G4 E5 — the third and fifth alone.
    expect(matches(PAC, 1, notes(64, 67, 76))).toBe(false)
  })

  it('refuses any note that is not a chord tone', () => {
    // C4 E4 G4 A4 — A belongs to neither chord.
    expect(matches(PAC, 1, notes(60, 64, 67, 69))).toBe(false)
  })

  it('refuses an empty group', () => {
    expect(matches(PAC, 0, [])).toBe(false)
  })
})

describe('cadenceGroupVerdict — root position', () => {
  it('refuses an inverted dominant', () => {
    // B3 D4 G4 — V6.
    expect(matches(PAC, 0, notes(59, 62, 67))).toBe(false)
  })

  it('refuses an inverted tonic even when the soprano is right', () => {
    // E4 G4 C5 C6 — tonic on top, third in the bass.
    expect(matches(PAC, 1, notes(64, 67, 72, 84))).toBe(false)
  })

  it('does not impose root position on the PENULTIMATE chord of a half, plagal or deceptive cadence', () => {
    const half = answer('half', 'I', 'V')
    const plagal = answer('plagal', 'IV', 'I')
    const deceptive = answer('deceptive', 'V', 'vi')
    // I6 — third in the bass — opening a half cadence is still a half cadence.
    expect(matches(half, 0, notes(64, 67, 72))).toBe(true)
    // IV6.
    expect(matches(plagal, 0, notes(69, 72, 77))).toBe(true)
    // V6 into a deceptive cadence.
    expect(matches(deceptive, 0, notes(59, 62, 67))).toBe(true)
  })

  // Panel r1 skeptic drove all three of these on the running app and was told
  // `Correct`. A cadence's FINAL chord is root position whatever the type: a
  // phrase that stops over the third or the fifth has not cadenced there.
  it('refuses an inverted FINAL chord on a plagal cadence', () => {
    const plagal = answer('plagal', 'IV', 'I')
    // E4 G4 C5 — I6 after IV. Not a plagal cadence in any text.
    expect(matches(plagal, 1, notes(64, 67, 72))).toBe(false)
    expect(matches(plagal, 1, notes(60, 64, 67))).toBe(true)
  })

  it('refuses an inverted FINAL chord on a half cadence', () => {
    const half = answer('half', 'I', 'V')
    // D4 G4 B4 — a 6/4 over the dominant is the chord BEFORE a half cadence.
    expect(matches(half, 1, notes(62, 67, 71))).toBe(false)
    expect(matches(half, 1, notes(67, 71, 74))).toBe(true)
  })

  it('refuses an inverted FINAL chord on a deceptive cadence', () => {
    const deceptive = answer('deceptive', 'V', 'vi')
    // C4 E4 A4 — vi6.
    expect(matches(deceptive, 1, notes(60, 64, 69))).toBe(false)
    // A3 C4 E4 — root position.
    expect(matches(deceptive, 1, notes(57, 60, 64))).toBe(true)
  })
})

describe('cadenceGroupVerdict — the leading tone is not doubled', () => {
  it('refuses a dominant with its leading tone doubled', () => {
    // G4 B4 B5 — the fifth dropped and the leading tone doubled instead. The
    // one doubling every harmony text forbids, in the chord whose whole
    // function is that leading tone (panel r1 skeptic, driven: `Correct`).
    expect(matches(PAC, 0, notes(67, 71, 83))).toBe(false)
  })

  it('still accepts a dominant with its ROOT doubled — how four voices write it', () => {
    // G3 G4 B4 D5.
    expect(matches(PAC, 0, notes(55, 67, 71, 74))).toBe(true)
  })

  it('refuses a doubled leading tone on a half cadence, whose final chord is V', () => {
    const half = answer('half', 'I', 'V')
    expect(matches(half, 1, notes(67, 71, 74, 83))).toBe(false)
  })

  it('leaves every other doubling free, the tonic own third included', () => {
    // C4 E4 E5 C6 — a thin final tonic, not a wrong one: no leading tone in it.
    expect(matches(PAC, 1, notes(60, 64, 76, 84))).toBe(true)
  })

  it('accepts a leading tone STRUCK TWICE — a repeat is one note, not a doubling', () => {
    // G4 B4 B4 D5. `played` is a press list, so the cadence panel hands a
    // re-struck key over as a repeat. Failing that is failing a slip of the
    // hand (panel r2 skeptic, driven: lapses 12 -> 13).
    expect(matches(PAC, 0, notes(67, 71, 71, 74))).toBe(true)
  })

  it('still refuses the leading tone in two DIFFERENT octaves, repeats or not', () => {
    // G4 B4 B4 B5 D5 — one repeat AND one real doubling. The repeat must not
    // launder the doubling away.
    expect(matches(PAC, 0, notes(67, 71, 71, 83, 74))).toBe(false)
  })
})

describe('cadenceGroupVerdict — the third is found by interval, not by position', () => {
  // `Chord.notes` is in SOUNDING order with the inversion applied, so on a
  // second-inversion chord its second entry is the ROOT and reading "the third"
  // positionally landed on the fifth (panel r1 skeptic). Unreachable through
  // the drill today — every recipe numeral is root position — so this is the
  // only place that can hold the line.
  const invertedFinal: CadenceAnswer = {
    type: 'plagal',
    chords: [chord('IV'), invertChord(chord('I'), 2)],
    tonicPitchClass: pitchClass(toMidi(C_MAJOR.tonic)),
  }

  it('accepts root and third of a second-inversion chord', () => {
    expect(matches(invertedFinal, 1, notes(60, 64))).toBe(true)
  })

  it('refuses root and fifth, which do not fix the quality', () => {
    expect(matches(invertedFinal, 1, notes(60, 67))).toBe(false)
  })
})

describe('cadenceGroupVerdict — the tonic on top, for the final chord only', () => {
  it('accepts the tonic in the highest voice', () => {
    expect(matches(PAC, 1, notes(60, 64, 67, 72))).toBe(true)
  })

  it('refuses the fifth in the highest voice — that is an IMPERFECT authentic cadence', () => {
    expect(matches(PAC, 1, notes(60, 64, 67, 79))).toBe(false)
  })

  it('refuses the third in the highest voice', () => {
    expect(matches(PAC, 1, notes(60, 64, 67, 76))).toBe(false)
  })

  it('does not require a tonic soprano on the PENULTIMATE chord', () => {
    // D5 on top of the dominant — the requirement is about the tonic chord.
    expect(matches(PAC, 0, notes(67, 71, 74))).toBe(true)
  })

  it('does not require a tonic soprano at all on a half cadence', () => {
    const half = answer('half', 'I', 'V')
    expect(matches(half, 1, notes(67, 71, 74))).toBe(true)
  })
})

/**
 * Roadmap `T.39`. Which condition a refusal applied is the only thing the
 * learner cannot work out for themselves, and until this existed it was the
 * one thing the grader threw away — `G4 B4 B5` is a V chord, root position,
 * every stated requirement met, and it was refused for a convention the prompt
 * never mentions.
 */
describe('cadenceGroupVerdict — a refusal names the condition it applied', () => {
  it.each([
    ['a foreign note', PAC, 1, notes(60, 64, 67, 69), 'foreign-note'],
    ['no notes at all', PAC, 0, notes(), 'no-notes'],
    ['the root missing', PAC, 1, notes(64, 67, 76), 'missing-root'],
    ['the third missing', PAC, 1, notes(60, 67, 72), 'missing-third'],
    ['the leading tone doubled', PAC, 0, notes(67, 71, 83), 'doubled-leading-tone'],
    ['an inverted chord', PAC, 0, notes(59, 62, 67), 'not-root-position'],
    ['the fifth in the soprano', PAC, 1, notes(60, 64, 67, 79), 'tonic-not-on-top'],
  ] as const)('names %s', (_case, cadence, index, played, rule) => {
    expect(ruleFor(cadence, index, played)).toBe(rule)
  })

  /**
   * Order matters where two conditions are broken at once, and this is the
   * pair a learner actually hits: an inverted chord is usually also something
   * else. The chord's identity is graded first, because "that note is not in
   * the chord" is the correction to make before its bass note is worth
   * discussing.
   */
  it('reports the broken chord before the broken position, when both are wrong', () => {
    // A4 in the bass of a tonic chord — inverted AND not a chord tone.
    expect(ruleFor(PAC, 1, notes(69, 72, 76))).toBe('foreign-note')
  })
})

describe('describeCadenceRule — the sentence a learner reads', () => {
  it('names the doubled leading tone and why it is the doubling that is out', () => {
    const text = describeCadenceRule(PAC, 0, 'doubled-leading-tone')
    expect(text).toContain('leading tone, B')
    expect(text).toContain('only once')
  })

  it('names the root the chord has to sit on', () => {
    expect(describeCadenceRule(PAC, 0, 'not-root-position')).toContain('its root, G, as the lowest note')
  })

  it('names the tonic that has to be on top, and what the answer would be instead', () => {
    const text = describeCadenceRule(PAC, 1, 'tonic-not-on-top')
    expect(text).toContain('tonic, C')
    expect(text).toContain('imperfect authentic cadence')
  })

  it('spells out the chord when a note came from outside it', () => {
    expect(describeCadenceRule(PAC, 1, 'foreign-note')).toContain('C, E, G')
  })

  it('names the third by note, since which note that is depends on the chord', () => {
    expect(describeCadenceRule(PAC, 0, 'missing-third')).toContain('third, B')
    expect(describeCadenceRule(PAC, 1, 'missing-third')).toContain('third, E')
  })

  it('names the root by note for a missing root', () => {
    expect(describeCadenceRule(PAC, 1, 'missing-root')).toContain('root, C')
  })

  /**
   * The tonic's spelling is read back off whichever chord is rooted on it, so
   * a cadence whose FINAL chord is not the tonic can still name it. Only
   * `'perfect-authentic'` reaches the rule in practice; this pins the lookup
   * rather than the reachability.
   */
  it('finds the tonic on the penultimate chord when the final one is not it', () => {
    const half = answer('half', 'I', 'V')
    expect(describeCadenceRule(half, 1, 'tonic-not-on-top')).toContain('tonic, C')
  })

  it('says something for every rule, so no refusal can render an empty line', () => {
    const rules: readonly CadenceRule[] = [
      'no-notes',
      'foreign-note',
      'missing-root',
      'missing-third',
      'doubled-leading-tone',
      'not-root-position',
      'tonic-not-on-top',
    ]
    for (const rule of rules) {
      expect(describeCadenceRule(PAC, 1, rule).length).toBeGreaterThan(10)
    }
  })
})
