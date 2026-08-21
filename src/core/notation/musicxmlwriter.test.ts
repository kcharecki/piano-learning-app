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
import { makeScore, type Hand, type Score, type ScoreNoteInput, type ScoreInput, type Tuplet } from './score.ts'
import { TRIPLET_EIGHTH } from '@core/shared/units.ts'

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

// ===================================================================== fingering

describe('writeMusicXml: fingering (roadmap 5.22, REQ-3.7.1)', () => {
  it('writes fingering above the right hand and below the left, and round-trips it', () => {
    const score = makeScore({
      id: 'fingering',
      measures: [{}],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 480, hand: 'right', fingering: 1 },
        { midi: 48, startTick: 0, durationTicks: 480, hand: 'left', fingering: 5 },
      ],
    })
    const xml = writeMusicXml(score)
    expect(xml).toContain('<technical><fingering placement="above">1</fingering></technical>')
    expect(xml).toContain('<technical><fingering placement="below">5</fingering></technical>')

    const reparsed = assertRoundTrips(score)
    expect(reparsed.notes.map((n) => n.fingering)).toEqual(score.notes.map((n) => n.fingering))
  })

  it('writes no <notations> at all for a note with neither a tie nor a fingering', () => {
    const score = makeScore({
      id: 'no-notations',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
    })
    expect(writeMusicXml(score)).not.toContain('<notations>')
  })
})

// ======================================================================= tuplets

/**
 * Three eighth-note triplets (160 ticks each, 3:2) filling the first quarter
 * of a 4/4 measure — the group the frozen `Tuplet` contract describes in its
 * own doc comment.
 */
function tripletGroup(): ScoreNoteInput[] {
  const of = (position: Tuplet['position']): Tuplet => ({ actual: 3, normal: 2, position })
  return [
    { midi: 60, startTick: 0, durationTicks: TRIPLET_EIGHTH, hand: 'right', tuplet: of('start') },
    { midi: 62, startTick: TRIPLET_EIGHTH, durationTicks: TRIPLET_EIGHTH, hand: 'right', tuplet: of('inner') },
    { midi: 64, startTick: TRIPLET_EIGHTH * 2, durationTicks: TRIPLET_EIGHTH, hand: 'right', tuplet: of('stop') },
  ]
}

describe('writeMusicXml: tuplets (frozen Tuplet contract)', () => {
  it('writes <type>eighth</type> for a 160-tick triplet eighth, not 16th (the bug this fixes)', () => {
    // Raw duration alone (160 ticks = 0.333 quarters) would match <16th>
    // (0.25) before <eighth> (0.5); the written duration via the 3:2 ratio
    // (160 * 3 / 2 = 240 ticks = an eighth) is what must win.
    const score = makeScore({ id: 'triplet-type', measures: [{}], notes: tripletGroup() })
    const xml = writeMusicXml(score)
    expect(xml.match(/<type>eighth<\/type>/g)).toHaveLength(3)
    expect(xml).not.toContain('<type>16th</type>')
  })

  it('emits <time-modification> 3:2 on every note of the group, including the inner one', () => {
    const score = makeScore({ id: 'triplet-timemod', measures: [{}], notes: tripletGroup() })
    const xml = writeMusicXml(score)
    const matches = xml.match(
      /<time-modification><actual-notes>3<\/actual-notes><normal-notes>2<\/normal-notes><\/time-modification>/g,
    )
    expect(matches).toHaveLength(3)
  })

  it('brackets only the edges: one tuplet type="start", one type="stop", none on the inner note', () => {
    const score = makeScore({ id: 'triplet-bracket', measures: [{}], notes: tripletGroup() })
    const xml = writeMusicXml(score)
    expect(xml.match(/<tuplet type="start" number="1"\/>/g)).toHaveLength(1)
    expect(xml.match(/<tuplet type="stop" number="1"\/>/g)).toHaveLength(1)
    expect(xml).not.toContain('<tuplet type="inner"')
  })

  it('beams the group begin / continue / end', () => {
    const score = makeScore({ id: 'triplet-beam', measures: [{}], notes: tripletGroup() })
    const xml = writeMusicXml(score)
    expect(xml).toContain('<beam number="1">begin</beam>')
    expect(xml).toContain('<beam number="1">continue</beam>')
    expect(xml).toContain('<beam number="1">end</beam>')
  })

  it('keeps schema order: time-modification before <staff>, beam before <notations>', () => {
    const notes = tripletGroup()
    const startNote = notes[0]
    if (startNote === undefined) throw new Error('tripletGroup() returned no notes')
    const score = makeScore({ id: 'triplet-order', measures: [{}], notes: [startNote] })
    const xml = writeMusicXml(score)
    const timeModAt = xml.indexOf('<time-modification>')
    const staffAt = xml.indexOf('<staff>')
    const beamAt = xml.indexOf('<beam number="1">')
    const notationsAt = xml.indexOf('<notations>')
    expect(timeModAt).toBeGreaterThan(-1)
    expect(staffAt).toBeGreaterThan(-1)
    expect(beamAt).toBeGreaterThan(-1)
    expect(notationsAt).toBeGreaterThan(-1)
    expect(timeModAt).toBeLessThan(staffAt)
    expect(staffAt).toBeLessThan(beamAt)
    expect(beamAt).toBeLessThan(notationsAt)
  })

  it('round-trips the tuplet itself, not merely three odd durations (roadmap T.8)', () => {
    // Before this, `parseMusicXml` dropped <time-modification>: the ticks came
    // back right and the NOTATION did not, so a triplet written by us and read
    // back by us re-engraved as sixteenths. Playback was never the victim here;
    // the score the learner reads was.
    const score = makeScore({ id: 'triplet-rt', measures: [{}], notes: tripletGroup() })
    const reparsed = parseMusicXml(writeMusicXml(score))
    if (!reparsed.ok) throw new Error(`expected the triplet to re-parse: ${reparsed.error}`)
    expect(reparsed.value.notes.map((n) => n.durationTicks)).toEqual([
      TRIPLET_EIGHTH,
      TRIPLET_EIGHTH,
      TRIPLET_EIGHTH,
    ])
    expect(reparsed.value.notes.map((n) => n.tuplet)).toEqual([
      { actual: 3, normal: 2, position: 'start' },
      { actual: 3, normal: 2, position: 'inner' },
      { actual: 3, normal: 2, position: 'stop' },
    ])
    // The proof that survives a second pass: writing the re-parsed score
    // reproduces the same XML, so the tuplet is not decaying one trip at a time.
    expect(writeMusicXml(reparsed.value)).toBe(writeMusicXml(score))
  })

  it('leaves a plain (non-tuplet) note byte-identical to before tuplet support', () => {
    // Same score, same pinned hash, as the "produces byte-identical output for
    // a fixed score" test above — proves the non-tuplet path emits nothing new.
    const score = makeScore({
      id: 'x',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })
    let hash = 0
    for (const ch of writeMusicXml(score)) hash = (hash * 31 + ch.charCodeAt(0)) | 0
    expect(hash).toBe(700_250_274)
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

// ============================================================== note.spelling

describe('writeMusicXml: a note\'s own spelling (roadmap 3.14a)', () => {
  it('engraves E# for midi 65, which fromMidi alone can never spell', () => {
    // F# major (6 sharps): the 7th degree sounds F5 (midi 77) but is written E#.
    // fromMidi's tables have no E# entry at all — this only works via note.spelling.
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: 6 }],
      notes: [
        { midi: 77, startTick: 0, durationTicks: 1920, hand: 'right', spelling: { letter: 'E', alter: 1, octave: 5 } },
      ],
    })
    expect(writeMusicXml(score)).toContain('<step>E</step><alter>1</alter><octave>5</octave>')
  })

  it('overrides the measure\'s flat-biased preferFlats when the note\'s own spelling is sharp', () => {
    // 2 flats -> fromMidi(preferFlats=true) would write midi 66 as Gb; the
    // note's own spelling (F#, this scale's raised leading tone) wins instead.
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: -2 }],
      notes: [
        { midi: 66, startTick: 0, durationTicks: 1920, hand: 'right', spelling: { letter: 'F', alter: 1, octave: 4 } },
      ],
    })
    expect(writeMusicXml(score)).toContain('<step>F</step><alter>1</alter><octave>4</octave>')
  })

  it('falls back to fromMidi when a note carries no spelling', () => {
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: -2 }],
      notes: [{ midi: 66, startTick: 0, durationTicks: 1920, hand: 'right' }],
    })
    // Same midi/key as the previous case, no spelling given: falls back to the
    // old per-measure-only behaviour (flat key -> Gb).
    expect(writeMusicXml(score)).toContain('<step>G</step><alter>-1</alter><octave>4</octave>')
  })

  it('names a double-sharp accidental when the note\'s own spelling needs one', () => {
    const score = makeScore({
      id: 'x',
      measures: [{ keyFifths: 0 }],
      notes: [
        { midi: 62, startTick: 0, durationTicks: 1920, hand: 'right', spelling: { letter: 'C', alter: 2, octave: 4 } },
      ],
    })
    const xml = writeMusicXml(score)
    expect(xml).toContain('<step>C</step><alter>2</alter><octave>4</octave>')
    expect(xml).toContain('<accidental>double-sharp</accidental>')
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
