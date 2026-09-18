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
import {
  makeGrooveScore,
  type DynamicsClass,
  type GrooveScore,
  type GrooveScoreInput,
  type SwingUnit,
} from '../groove.ts'
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

  it('all four reference grooves are distinct and each has at least one note', () => {
    const grooves = referenceGrooves()
    expect(grooves).toHaveLength(4)
    for (const g of grooves) expect(g.notes.length).toBeGreaterThan(0)
    expect(new Set(grooves.map((g) => g.id)).size).toBe(4)
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

/**
 * `'open'` is dropped from any pad other than `hhOpen` — `makeGrooveScore`
 * rejects that combination outright (T.34), so this arbitrary must not hand
 * it input that can no longer occur. For `hhOpen` itself, `'open'` is left to
 * chance: `makeGrooveScore` derives it when absent and canonicalises every
 * note's articulations to `ARTICULATIONS` order (see `../groove.ts`), and
 * `parseDrumMusicXml` reconstructs that same canonical order off the XML, so
 * the fixture needs no special placement to round-trip byte-for-byte.
 */
/**
 * A4 superseded F4: being off the swing-unit grid is not itself invalid, so
 * ticks are arbitrary across the whole bar again (no grid constraint here).
 * The only rejection `grooveArb` below now filters for is a real same-pad
 * swung-tick collision, via `validateGrooveScore` itself.
 */
function noteInputArb(barTicks: number) {
  const tickArb = fc.integer({ min: 0, max: barTicks - 1 })
  return fc.tuple(mappedPadArb, tickArb).chain(([pad, tick]) =>
    fc.record(
      {
        pad: fc.constant(pad),
        tick: fc.constant(tick),
        durationTicks: fc.integer({ min: 1, max: barTicks - tick }),
        dynamics: fc.constantFrom<DynamicsClass>('accent', 'normal', 'ghost'),
        articulations: fc
          .subarray(ARTICULATIONS as unknown as Articulation[])
          .map((arts) => (pad === 'hhOpen' ? arts : arts.filter((a) => a !== 'open'))),
        sticking: fc.constantFrom(...STICKINGS) as fc.Arbitrary<Sticking>,
      },
      { requiredKeys: ['pad', 'tick', 'durationTicks', 'dynamics', 'articulations'] },
    ),
  )
}

/**
 * Drops any note that starts before the previous kept note on the same pad
 * ends — `validateGrooveScore` now rejects a duplicate/overlapping hit on one
 * pad (see `../groove.test.ts`), so this arbitrary must not generate input
 * that can no longer occur.
 */
function dedupeOverlaps<T extends { readonly pad: string; readonly tick: number; readonly durationTicks: number }>(
  notes: readonly T[],
): T[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick)
  const lastEndByPad = new Map<string, number>()
  const out: T[] = []
  for (const n of sorted) {
    const lastEnd = lastEndByPad.get(n.pad) ?? -1
    if (n.tick < lastEnd) continue
    lastEndByPad.set(n.pad, n.tick + n.durationTicks)
    out.push(n)
  }
  return out
}

const swingUnitArb: fc.Arbitrary<SwingUnit> = fc.constantFrom('eighth', 'sixteenth')

/**
 * A4: ticks are arbitrary (see `noteInputArb`), so a generated swung score
 * can now hit the one thing `validateGrooveScore` still rejects — two notes
 * on the SAME pad whose swung ticks collide (F4's old, broader "off the
 * swing-unit grid" rejection is gone; a lone off-grid note is fine). Rather
 * than re-deriving that collision rule here, this filters through
 * `makeGrooveScore` itself (which calls `validateGrooveScore`) and discards
 * whatever it rejects — the real validator decides, this arbitrary does not
 * guess at its rule.
 */
const grooveArb: fc.Arbitrary<GrooveScore> = fc
  .tuple(fc.uuid(), titleArb, timeSignatureArb, fc.integer({ min: 50, max: 75 }), swingUnitArb)
  .chain(([id, title, timeSignature, swingPercent, swingUnit]) => {
    const barTicks = measureDurationTicks(timeSignature)
    return fc.array(noteInputArb(barTicks), { maxLength: 12 }).map((notes): GrooveScoreInput => ({
      id,
      title,
      timeSignature,
      swingPercent,
      swingUnit,
      measureCount: 1,
      notes: dedupeOverlaps(notes),
    }))
  })
  .filter((input) => {
    try {
      makeGrooveScore(input)
      return true
    } catch {
      return false
    }
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
