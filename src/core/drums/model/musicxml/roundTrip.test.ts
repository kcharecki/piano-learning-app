/**
 * DR-04's headline gate: reference grooves parse from MusicXML to an exact
 * `GrooveScore` and back, byte-stable — plus the same property proven for
 * arbitrary generated grooves, not just the three bundled examples.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { unwrap } from '@core/shared/result.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import { ARTICULATIONS, STICKINGS, type Articulation, type Sticking } from '../articulation.ts'
import { makeGrooveScore, type DynamicsClass, type GrooveScore, type GrooveScoreInput } from '../groove.ts'
import { MAPPED_PADS } from '../pad.ts'
import { ghostFunkBar, moneyBeat, moneyBeatOpenHat, referenceGrooves } from '../referenceGrooves.ts'
import { parseDrumMusicXml } from './parse.ts'
import { writeDrumMusicXml } from './write.ts'

describe('reference grooves: MusicXML round trip is exact and byte-stable', () => {
  const cases: readonly [string, () => GrooveScore][] = [
    ['moneyBeat', moneyBeat],
    ['moneyBeatOpenHat', moneyBeatOpenHat],
    ['ghostFunkBar', ghostFunkBar],
  ]

  it.each(cases)('%s parses back to the exact GrooveScore', (_name, build) => {
    const score = build()
    const xml = writeDrumMusicXml(score)
    const parsed = parseDrumMusicXml(xml, { id: score.id })
    expect(parsed.ok).toBe(true)
    expect(parsed).toEqual({ ok: true, value: score })
  })

  it.each(cases)('%s re-serialises byte-identical XML after a parse round trip', (_name, build) => {
    const score = build()
    const xml = writeDrumMusicXml(score)
    const roundTripped = unwrap(parseDrumMusicXml(xml, { id: score.id }))
    expect(writeDrumMusicXml(roundTripped)).toBe(xml)
  })

  it('all three reference grooves are distinct and each has at least one note', () => {
    const grooves = referenceGrooves()
    expect(grooves).toHaveLength(3)
    for (const g of grooves) expect(g.notes.length).toBeGreaterThan(0)
    expect(new Set(grooves.map((g) => g.id)).size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// property: MusicXML round-trip on generated grooves
// ---------------------------------------------------------------------------

const mappedPadArb = fc.constantFrom(...MAPPED_PADS)
const timeSignatureArb: fc.Arbitrary<TimeSignature> = fc.constantFrom(
  { beats: 4, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 4, beatType: 8 },
)
// Printable ASCII plus the five XML-special characters, so escaping is actually exercised.
const titleCharArb = fc.constantFrom(..." abcXYZ019&<>\"'-_.!?".split(''))
const titleArb = fc
  .array(titleCharArb, { maxLength: 20 })
  .map((chars) => chars.join('').trim())

function noteInputArb(barTicks: number) {
  return fc.tuple(mappedPadArb, fc.integer({ min: 0, max: barTicks - 1 })).chain(([pad, tick]) =>
    fc.record(
      {
        pad: fc.constant(pad),
        tick: fc.constant(tick),
        durationTicks: fc.integer({ min: 1, max: barTicks - tick }),
        dynamics: fc.constantFrom<DynamicsClass>('accent', 'normal', 'ghost'),
        articulations: fc.subarray(ARTICULATIONS as unknown as Articulation[]),
        sticking: fc.constantFrom(...STICKINGS) as fc.Arbitrary<Sticking>,
      },
      { requiredKeys: ['pad', 'tick', 'durationTicks', 'dynamics', 'articulations'] },
    ),
  )
}

const grooveArb: fc.Arbitrary<GrooveScore> = fc
  .tuple(fc.uuid(), titleArb, timeSignatureArb, fc.integer({ min: 50, max: 75 }))
  .chain(([id, title, timeSignature, swingPercent]) => {
    const barTicks = measureDurationTicks(timeSignature)
    return fc.array(noteInputArb(barTicks), { maxLength: 12 }).map((notes): GrooveScoreInput => ({
      id,
      title,
      timeSignature,
      swingPercent,
      measureCount: 1,
      notes,
    }))
  })
  .map((input) => makeGrooveScore(input))

describe('property: MusicXML round trip on generated grooves', () => {
  it('parseDrumMusicXml(writeDrumMusicXml(score)) equals the original score', () => {
    fc.assert(
      fc.property(grooveArb, (score) => {
        const xml = writeDrumMusicXml(score)
        const parsed = parseDrumMusicXml(xml, { id: score.id })
        expect(parsed).toEqual({ ok: true, value: score })
      }),
      { numRuns: 200 },
    )
  })

  it('re-serialising a parsed score reproduces byte-identical XML', () => {
    fc.assert(
      fc.property(grooveArb, (score) => {
        const xml = writeDrumMusicXml(score)
        const roundTripped = unwrap(parseDrumMusicXml(xml, { id: score.id }))
        expect(writeDrumMusicXml(roundTripped)).toBe(xml)
      }),
      { numRuns: 200 },
    )
  })
})
