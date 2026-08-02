/**
 * Round-trip tests for `writeMusicXml`. The bar (see the module doc on
 * `musicxmlwriter.ts`): `parseMusicXml(writeMusicXml(score))` must be `ok`, and
 * must reproduce every fixture's measure count, note count, and note-for-note
 * midi/startTick/durationTicks/hand/measureIndex.
 *
 * `node:fs` is imported HERE and only here — the module under test is pure.
 */
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { writeMusicXml } from './musicxmlwriter.ts'
import { parseMusicXml } from './musicxml.ts'
import { makeScore, type Hand, type Score, type ScoreNoteInput, type ScoreInput } from './score.ts'

const load = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}.musicxml`, import.meta.url), 'utf8')

function parseFixture(name: string): Score {
  const result = parseMusicXml(load(name))
  if (!result.ok) throw new Error(`expected ${name} to parse, got: ${result.error}`)
  return result.value
}

/** The fields the round-trip bar names, in `score.notes` order (already startTick/midi sorted). */
const noteTuples = (score: Score): unknown[] =>
  score.notes.map((n) => [n.midi, n.startTick, n.durationTicks, n.hand, n.measureIndex])

/** Parses `writeMusicXml(score)` and asserts the round-trip bar on it. */
function assertRoundTrips(score: Score): Score {
  const xml = writeMusicXml(score)
  const result = parseMusicXml(xml)
  if (!result.ok) throw new Error(`writer produced unparsable XML: ${result.error}\n${xml}`)
  const reparsed = result.value
  expect(reparsed.measures).toHaveLength(score.measures.length)
  expect(reparsed.notes).toHaveLength(score.notes.length)
  expect(noteTuples(reparsed)).toEqual(noteTuples(score))
  expect(reparsed.tempos).toEqual(score.tempos)
  return reparsed
}

// ============================================================ fixture round trip

describe('writeMusicXml: round-trips every fixture', () => {
  it.each([
    'single-part',
    'two-staff-piano',
    'chords',
    'six-eight',
    'pickup-measure',
    'tie-across-barline',
    'mid-score-changes',
    'grace-and-voices',
    'implicit-mid-score',
  ])('%s', (name) => {
    assertRoundTrips(parseFixture(name))
  })

  it('preserves tie flags across the barline, not just the bar the fields cover', () => {
    const score = parseFixture('tie-across-barline')
    const xml = writeMusicXml(score)
    const reparsed = parseMusicXml(xml)
    if (!reparsed.ok) throw new Error(reparsed.error)
    expect(reparsed.value.notes.map((n) => [n.tiedTo, n.tiedFrom])).toEqual(
      score.notes.map((n) => [n.tiedTo, n.tiedFrom]),
    )
  })

  it('produces byte-identical output for a fixed score (pinned, not merely self-equal)', () => {
    // A hash, not the full XML, so this test does not itself become an
    // unreadable golden blob to maintain; it still fails the instant the
    // writer's output changes for this score at all.
    const score = makeScore({
      id: 'x',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })
    let hash = 0
    for (const ch of writeMusicXml(score)) hash = (hash * 31 + ch.charCodeAt(0)) | 0
    expect(hash).toBe(700_250_274)
  })

  it('starts with the XML declaration and the score-partwise root', () => {
    const xml = writeMusicXml(parseFixture('single-part'))
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">')).toBe(
      true,
    )
  })
})

// ================================================================== meta / escaping

describe('writeMusicXml: title, composer and escaping', () => {
  const scoreWith = (title: string, composer: string): Score =>
    makeScore({
      id: 'x',
      meta: { title, composer },
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })

  it('writes the title and composer, XML-escaped', () => {
    const xml = writeMusicXml(scoreWith('A & B <study> "quote\'s"', 'O\'Brien & Sons'))
    expect(xml).toContain('<work><work-title>A &amp; B &lt;study&gt; &quot;quote&apos;s&quot;</work-title></work>')
    expect(xml).toContain(
      '<identification><creator type="composer">O&apos;Brien &amp; Sons</creator></identification>',
    )
  })

  it('omits <work> and <identification> when title and composer are both empty', () => {
    const xml = writeMusicXml(scoreWith('', ''))
    expect(xml).not.toContain('<work>')
    expect(xml).not.toContain('<identification>')
  })

  it('round-trips title and composer through the parser', () => {
    const score = scoreWith('Étude & Study', 'Anon.')
    const reparsed = assertRoundTrips(score)
    expect(reparsed.meta).toEqual(score.meta)
  })
})

// =================================================================== accidentals

describe('writeMusicXml: key-aware spelling avoids spurious accidentals', () => {
  it('writes no <accidental> for a note the key signature already explains', () => {
    // G major (1 sharp): F#4 (midi 66) matches the signature.
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: 1 }],
      notes: [{ midi: 66, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })
    const xml = writeMusicXml(score)
    expect(xml).not.toContain('<accidental>')
    expect(xml).toContain('<step>F</step><alter>1</alter>')
  })

  it('writes a natural when a note contradicts the key signature', () => {
    // G major (1 sharp): F-natural4 (midi 65) contradicts the signature's F#.
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: 1 }],
      notes: [{ midi: 65, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })
    const xml = writeMusicXml(score)
    expect(xml).toContain('<accidental>natural</accidental>')
  })

  it('spells with flats in a flat key and writes no accidental on the key\'s own flat', () => {
    // F major (1 flat): Bb4 (midi 70) matches the signature.
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: -1 }],
      notes: [{ midi: 70, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })
    const xml = writeMusicXml(score)
    expect(xml).toContain('<step>B</step><alter>-1</alter>')
    expect(xml).not.toContain('<accidental>')
  })
})

// ======================================================================= tempo

describe('writeMusicXml: tempo marks', () => {
  it('round-trips multiple tempo marks, fractional bpm included', () => {
    const score = makeScore({
      id: 'x',
      measures: [{}, {}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
      tempos: [
        { tick: 0, bpm: 92.5 },
        { tick: 1920, bpm: 60 },
      ],
    })
    const xml = writeMusicXml(score)
    const reparsed = parseMusicXml(xml)
    if (!reparsed.ok) throw new Error(reparsed.error)
    expect(reparsed.value.tempos).toEqual(score.tempos)
  })
})

// =================================================================== properties

/** Tick-durations that always divide evenly and never round: an 8th up to a whole note. */
const durationArb = fc.constantFrom(240, 480, 960, 1920)

/**
 * One staff's notes for one measure: lay `tokens` end to end from tick 0,
 * stopping the moment one would overflow `measureLen` (leaving the rest as an
 * implicit trailing gap — exercise for the writer's rest-filling). Each note
 * may carry 0-2 extra `chord` pitches at the same onset and voice.
 */
function layoutMeasure(
  tokens: readonly number[],
  pitches: readonly number[],
  chordCounts: readonly number[],
  measureLen: number,
  hand: Hand,
  staff: number,
  voice: number,
  leadingGap = 0,
): ScoreNoteInput[] {
  const notes: ScoreNoteInput[] = []
  let cursor = Math.min(leadingGap, measureLen)
  for (let i = 0; i < tokens.length; i++) {
    const duration = tokens[i] ?? 240
    if (cursor + duration > measureLen) break
    const base = 48 + ((pitches[i] ?? 0) % 36)
    notes.push({ midi: base, startTick: cursor, durationTicks: duration, hand, voice, staff })
    const chords = chordCounts[i] ?? 0
    for (let c = 0; c < chords; c++) {
      const midi = Math.min(96, base + (c + 1) * 3)
      notes.push({ midi, startTick: cursor, durationTicks: duration, hand, voice, staff })
    }
    cursor += duration
  }
  return notes
}

/** 0, 240 or 480 ticks — a leading gap short enough to always leave room for a note. */
const leadingGapArb = fc.constantFrom(0, 240, 480)

const measureCountArb = fc.integer({ min: 1, max: 3 })
const keyFifthsArb = fc.integer({ min: -7, max: 7 })
const tokensArb = fc.array(durationArb, { minLength: 0, maxLength: 8 })
const pitchesArb = fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 0, maxLength: 8 })
const chordCountsArb = fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 0, maxLength: 8 })

function buildScore(
  keyFifthsList: readonly number[],
  perMeasure: readonly {
    readonly tokens: readonly number[]
    readonly pitches: readonly number[]
    readonly chords: readonly number[]
    readonly leadingGap?: number
  }[],
  staves: readonly { readonly hand: Hand; readonly staffNumber: number; readonly voice: number }[],
): Score {
  const measures = keyFifthsList.map((keyFifths) => ({ keyFifths }))
  const notes: ScoreNoteInput[] = []
  perMeasure.forEach((m, i) => {
    const offset = i * 1920
    for (const s of staves) {
      for (const n of layoutMeasure(
        m.tokens,
        m.pitches,
        m.chords,
        1920,
        s.hand,
        s.staffNumber,
        s.voice,
        m.leadingGap ?? 0,
      )) {
        notes.push({ ...n, startTick: n.startTick + offset })
      }
    }
  })
  const input: ScoreInput = { id: 'property', measures, notes }
  return makeScore(input)
}

describe('writeMusicXml properties', () => {
  it('round-trips a random single-staff score across random keys, gaps and chords', () => {
    fc.assert(
      fc.property(
        measureCountArb,
        fc.array(keyFifthsArb, { minLength: 1, maxLength: 3 }),
        fc.array(
          fc.record({ tokens: tokensArb, pitches: pitchesArb, chords: chordCountsArb, leadingGap: leadingGapArb }),
          { minLength: 1, maxLength: 3 },
        ),
        (count, keys, measureSpecs) => {
          const n = count
          const keyFifthsList = Array.from({ length: n }, (_, i) => keys[i % keys.length] ?? 0)
          const perMeasure = Array.from({ length: n }, (_, i) => {
            const spec = measureSpecs[i % measureSpecs.length]
            return spec ?? { tokens: [], pitches: [], chords: [], leadingGap: 0 }
          })
          const score = buildScore(keyFifthsList, perMeasure, [
            { hand: 'right', staffNumber: 1, voice: 1 },
          ])
          const xml = writeMusicXml(score)
          assertRoundTrips(score)
          // A note starting after tick 0 in its measure must be preceded by
          // something that fills the gap — a `<rest/>` — not silently skipped.
          const firstMeasureFirstNote = score.notes.find((note) => note.measureIndex === 0)
          if (firstMeasureFirstNote !== undefined && firstMeasureFirstNote.startTick > 0) {
            expect(xml).toContain('<rest/>')
          }
        },
      ),
      { numRuns: 50 },
    )
  })

  it('round-trips a random single-staff score with two overlapping voices sharing one staff', () => {
    fc.assert(
      fc.property(
        keyFifthsArb,
        fc.record({ tokens: tokensArb, pitches: pitchesArb, chords: chordCountsArb, leadingGap: leadingGapArb }),
        fc.record({ tokens: tokensArb, pitches: pitchesArb, chords: chordCountsArb, leadingGap: leadingGapArb }),
        (keyFifths, v1, v2) => {
          const score = buildScore([keyFifths], [v1], [
            { hand: 'right', staffNumber: 1, voice: 1 },
          ])
          const secondVoiceNotes = layoutMeasure(
            v2.tokens,
            v2.pitches,
            v2.chords,
            1920,
            'right',
            1,
            2,
            v2.leadingGap,
          )
          const combined = makeScore({
            id: 'two-voice',
            measures: [{ keyFifths }],
            notes: [...score.notes.map((n) => ({ ...n, staff: 1 })), ...secondVoiceNotes],
          })
          assertRoundTrips(combined)
        },
      ),
      { numRuns: 30 },
    )
  })

  it('round-trips a random two-hand piano score, keeping each hand on its own staff', () => {
    fc.assert(
      fc.property(
        fc.array(keyFifthsArb, { minLength: 1, maxLength: 2 }),
        fc.record({ tokens: tokensArb, pitches: pitchesArb, chords: chordCountsArb }),
        fc.record({ tokens: tokensArb, pitches: pitchesArb, chords: chordCountsArb }),
        (keys, rh, lh) => {
          const n = keys.length
          const measures = keys.map((keyFifths) => ({ keyFifths }))
          const notes: ScoreNoteInput[] = []
          for (let i = 0; i < n; i++) {
            const offset = i * 1920
            for (const note of layoutMeasure(rh.tokens, rh.pitches, rh.chords, 1920, 'right', 1, 1)) {
              notes.push({ ...note, startTick: note.startTick + offset })
            }
            for (const note of layoutMeasure(lh.tokens, lh.pitches, lh.chords, 1920, 'left', 2, 2)) {
              notes.push({ ...note, startTick: note.startTick + offset })
            }
          }
          const score = makeScore({ id: 'two-hand', measures, notes })
          assertRoundTrips(score)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('round-trips a single-staff hand switch (a mid-score clef change)', () => {
    fc.assert(
      fc.property(fc.constantFrom('right', 'left') as fc.Arbitrary<Hand>, keyFifthsArb, (firstHand, keyFifths) => {
        const secondHand: Hand = firstHand === 'right' ? 'left' : 'right'
        const score = makeScore({
          id: 'switch',
          measures: [{ keyFifths }, { keyFifths }],
          notes: [
            { midi: 60, startTick: 0, durationTicks: 1920, hand: firstHand },
            { midi: 48, startTick: 1920, durationTicks: 1920, hand: secondHand },
          ],
        })
        assertRoundTrips(score)
      }),
      { numRuns: 20 },
    )
  })

  it('ties a note across the barline and preserves both flags on reparse', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 48, max: 84 }),
        keyFifthsArb,
        fc.integer({ min: 240, max: 1920 }),
        fc.integer({ min: 240, max: 1920 }),
        (midi, keyFifths, firstDuration, secondDuration) => {
          const score = makeScore({
            id: 'tied',
            measures: [{ keyFifths }, { keyFifths }],
            notes: [
              { midi, startTick: 1920 - firstDuration, durationTicks: firstDuration, hand: 'right', tiedTo: true },
              { midi, startTick: 1920, durationTicks: secondDuration, hand: 'right', tiedFrom: true },
            ],
          })
          const reparsed = assertRoundTrips(score)
          expect(reparsed.notes.map((n) => [n.tiedTo, n.tiedFrom])).toEqual(
            score.notes.map((n) => [n.tiedTo, n.tiedFrom]),
          )
        },
      ),
      { numRuns: 30 },
    )
  })
})
