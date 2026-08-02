import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { unwrap } from '@core/shared/result.ts'
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { makeScore, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { type Inversion, invertChord } from './chords.ts'
import { diatonicChords } from './harmony.ts'
import { CIRCLE_OF_FIFTHS, type Key, relativeKey } from './keys.ts'
import { toMidi } from './pitch.ts'
import { analyseScore, detectKey } from './analysis.ts'

const FIXTURE_PATH = fileURLToPath(
  new URL('../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
)

function loadTwinkle(): Score {
  return unwrap(parseMusicXml(readFileSync(FIXTURE_PATH, 'utf-8')))
}

// ---------------------------------------------------------------------------
// detectKey
// ---------------------------------------------------------------------------

describe('detectKey', () => {
  it('reads Twinkle Twinkle as C major, from its signature and its all-diatonic content', () => {
    const key = detectKey(loadTwinkle())
    expect(key.tonic.letter).toBe('C')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('major')
  })

  it('flips to the relative minor when all three votes agree: a raised leading tone, and the first and last bass both landing on the minor tonic', () => {
    // i - iv - V - i in A minor, signature 0 fifths (shared with C major).
    const score = makeScore({
      id: 'a-minor-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // i: A-C-E
        { midi: 57, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        // iv: D-F-A
        { midi: 62, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 65, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 69, startTick: 1920, durationTicks: 1920, hand: 'left' },
        // V: E-G#-B (the raised leading tone)
        { midi: 64, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 68, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 71, startTick: 3840, durationTicks: 1920, hand: 'left' },
        // i: A-C-E
        { midi: 57, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 5760, durationTicks: 1920, hand: 'left' },
      ],
    })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('A')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('minor')
  })

  it('stays major on a single vote: only the last bass note lands on the minor tonic', () => {
    const score = makeScore({
      id: 'one-vote-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // C major tonic — first bass is the MAJOR tonic, no leading tone.
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 0, durationTicks: 1920, hand: 'left' },
        // A minor tonic — last bass lands on the minor tonic, the only vote cast.
        { midi: 57, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 1920, durationTicks: 1920, hand: 'left' },
      ],
    })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('C')
    expect(key.mode).toBe('major')
  })

  it('returns the major key straight from the signature when the score has no notes at all', () => {
    const score = makeScore({ id: 'empty-probe', measures: [{ keyFifths: 2 }], notes: [] })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('D')
    expect(key.mode).toBe('major')
  })
})

// ---------------------------------------------------------------------------
// analyseScore — the bundled sample, named literally
// ---------------------------------------------------------------------------

describe('analyseScore — Twinkle Twinkle Little Star', () => {
  const score = loadTwinkle()
  const analysis = analyseScore(score, detectKey(score))

  it('names every measure I, V or IV — the I-V-IV-I skeleton this arrangement actually has, three times over', () => {
    // One left-hand block chord per measure, held under a moving right-hand melody:
    // I V IV I, repeated across mm1-4, 5-8 and 9-12. This is NOT the classic
    // I-IV-V-I cadential shape — this transcription's left hand never plays V
    // immediately before a final I; V is always followed by IV first.
    const numeralPerMeasure = new Map<number, string>()
    for (const chord of analysis.chords) {
      if (chord.numeral !== null) numeralPerMeasure.set(chord.measureIndex, chord.numeral.text)
    }
    const sequence = Array.from({ length: 12 }, (_, i) => numeralPerMeasure.get(i))
    expect(sequence).toEqual(['I', 'V', 'IV', 'I', 'I', 'V', 'IV', 'I', 'I', 'V', 'IV', 'I'])
  })

  it('ignores the right-hand passing tone rather than renaming the held left-hand chord', () => {
    // Measure 3 (index 2): left hand holds F-A-C (IV) as a whole note; the right hand
    // plays F then E (each re-attacked, so the melody alone yields several slices).
    // F is a chord tone; E is not, but read together with the held triad it happens to
    // spell a complete F major seventh (F-A-C-E). Because the core-pitches rule reads
    // the chord from the longest-held notes alone, the shorter-held E never gets a
    // vote: every slice in the measure reads IV, not IV7.
    const measure3 = analysis.chords.filter((c) => c.measureIndex === 2)
    expect(measure3.length).toBeGreaterThanOrEqual(2)
    for (const chord of measure3) expect(chord.numeral?.text).toBe('IV')

    // The passing E4 (MIDI 64) was seen, not silently dropped from the reported data —
    // it just did not get to rename the chord.
    expect(measure3.some((c) => c.midi.some((m) => Number(m) === 64))).toBe(true)
  })

  it('finds exactly the three real phrase-ending cadences, none of the false ones a naive every-barline reading would report', () => {
    // Grouping slices into harmonic runs and requiring a run to arrive on a barline,
    // materially outlast the one it replaces (or be the score's own final run),
    // eliminates the false "half" (I->V, mid-phrase) and "deceptive" (V->IV, mid-phrase)
    // readings a naive every-barline-chord-change rule would report, and correctly
    // finds the one genuine IV->I plagal cadence at the end of each of the three
    // 4-measure phrases.
    const types = analysis.cadences.map((c) => c.type)
    expect(types).toEqual(['plagal', 'plagal', 'plagal'])
  })

  it('reports the final phrase-ending cadence as plagal, landing on the last measure’s tonic', () => {
    const last = analysis.cadences[analysis.cadences.length - 1]
    expect(last?.type).toBe('plagal')
    const finalChord = last === undefined ? undefined : analysis.chords[last.atChordIndex]
    expect(finalChord?.numeral?.text).toBe('I')
    expect(finalChord?.measureIndex).toBe(11) // the last measure, 0-indexed
  })

  it('gives every chord a bass equal to the lowest of its reported pitches', () => {
    for (const chord of analysis.chords) {
      expect(chord.bass).toBe(Math.min(...chord.midi))
    }
  })

  it('detects its own key when none is supplied, instead of silently defaulting to C major', () => {
    const withoutKey = analyseScore(score)
    expect(withoutKey.key).toEqual(detectKey(score))
  })
})

// ---------------------------------------------------------------------------
// the non-chord-tone fallback, and the case respellForKey cannot reach
// ---------------------------------------------------------------------------

describe('analyseScore — core-too-thin fallback and unspellable keys', () => {
  it('names a chord from the full sounding set when the longest-held note alone is just a single pitch', () => {
    // A held melody note (the longest-held pitch, so it alone is the "core") over a
    // shorter accompaniment triad — the core alone names nothing, so every sounding
    // pitch must get a look for the fallback to name the chord at all.
    const score = makeScore({
      id: 'thin-core-probe',
      measures: [{ keyFifths: 0 }],
      notes: [
        { midi: 67, startTick: 0, durationTicks: 1920, hand: 'right' }, // G, held the whole measure
        { midi: 60, startTick: 0, durationTicks: 960, hand: 'left' }, // C
        { midi: 64, startTick: 0, durationTicks: 960, hand: 'left' }, // E
      ],
    })
    const key = detectKey(score)
    const analysis = analyseScore(score, key)
    expect(analysis.chords[0]?.numeral?.text).toBe('I')
  })

  it('reports null rather than a guess when nothing sounding is recognisable as a chord at all', () => {
    // A tight chromatic cluster: no root/quality combination shares enough of its
    // pitch classes to clear identifyChord's confidence floor, in ANY key, so both
    // the core and the full-sounding-set fallback come back empty.
    const score = makeScore({
      id: 'unrecognisable-probe',
      measures: [{ keyFifths: 0 }],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 61, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 62, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 63, startTick: 0, durationTicks: 1920, hand: 'right' },
      ],
    })
    const key = detectKey(score)
    const analysis = analyseScore(score, key)
    expect(analysis.chords[0]?.numeral).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// property: a score built entirely from known diatonic triads never comes back null
// ---------------------------------------------------------------------------

/** Keys whose diatonic roots stay inside the standard 12 default pitch-class spellings
 *  (naturals and single sharps/flats) — excludes the handful of exotic keys (Cb/C#
 *  major and their relatives) whose diatonic degrees need a letter no MIDI pitch class
 *  is ever spelled with by default (Fb, B#, E#, Cb), a documented limitation of
 *  `respellForKey`. */
const SAFE_MAJOR_KEYS: readonly Key[] = CIRCLE_OF_FIFTHS.filter(
  (k) => Math.abs(k.signature.fifths) <= 5,
)
const SAFE_KEYS: readonly Key[] = [...SAFE_MAJOR_KEYS, ...SAFE_MAJOR_KEYS.map(relativeKey)]

const TRIAD_INVERSIONS: readonly Inversion[] = [0, 1, 2]

/** One measure per plan entry: a solid whole-note triad, no melody, no passing tones. */
function scoreFromTriadPlan(
  key: Key,
  plan: readonly { readonly degree: number; readonly inversion: Inversion }[],
): Score {
  const diatonic = diatonicChords(key)
  const notes: ScoreNoteInput[] = []
  plan.forEach(({ degree, inversion }, measureIndex) => {
    const base = diatonic[degree]
    if (base === undefined) throw new Error(`degree ${degree} out of range for ${diatonic.length}`)
    const chord = invertChord(base, inversion)
    for (const pitch of chord.notes) {
      notes.push({
        midi: toMidi(pitch),
        startTick: measureIndex * 1920,
        durationTicks: 1920,
        hand: 'right',
      })
    }
  })
  return makeScore({
    id: 'property-fixture',
    measures: plan.map(() => ({ keyFifths: key.signature.fifths })),
    notes,
  })
}

describe('property: known diatonic triads always analyse to a non-null numeral', () => {
  it('every slice of a score built from random diatonic triads, any inversion, any of the common keys, gets a numeral', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SAFE_KEYS),
        fc.array(
          fc.record({
            degree: fc.integer({ min: 0, max: 6 }),
            inversion: fc.constantFrom(...TRIAD_INVERSIONS),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (key, plan) => {
          const score = scoreFromTriadPlan(key, plan)
          const analysis = analyseScore(score, key)

          expect(analysis.chords.length).toBe(plan.length)
          plan.forEach(({ degree, inversion }, i) => {
            const chord = analysis.chords[i]
            expect(chord?.numeral).not.toBeNull()
            // Not just "some numeral came back" — the exact planted degree and
            // inversion, so a respelling or inversion bug can't hide behind a
            // merely-non-null assertion.
            expect(chord?.numeral?.degree).toBe(degree + 1)
            expect(chord?.numeral?.inversion).toBe(inversion)
          })
        },
      ),
    )
  })
})
