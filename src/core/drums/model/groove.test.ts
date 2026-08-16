import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { InvariantError } from '@core/shared/invariant.ts'
import { ARTICULATIONS, type Articulation } from './articulation.ts'
import {
  makeGrooveScore,
  notesInMeasure,
  validateGrooveScore,
  type DynamicsClass,
  type GrooveScoreInput,
  type SwingUnit,
} from './groove.ts'
import { MAPPED_PADS, voiceOf } from './pad.ts'

describe('makeGrooveScore', () => {
  it('builds a minimal single-measure groove with defaults', () => {
    const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [{ pad: 'kick', tick: 0, durationTicks: 480 }] })
    expect(score.timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(score.swingPercent).toBe(50)
    expect(score.title).toBe('')
    expect(score.measures).toHaveLength(1)
    expect(score.measures[0]).toEqual({ index: 0, startTick: 0, durationTicks: 1920 })
    expect(score.notes).toHaveLength(1)
    expect(score.notes[0]).toMatchObject({ pad: 'kick', tick: 0, voice: 'feet', dynamics: 'normal' })
  })

  it('sorts notes by tick then pad order, and gives every note a stable id', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 480, durationTicks: 240 },
        { pad: 'kick', tick: 0, durationTicks: 480 },
        { pad: 'snare', tick: 480, durationTicks: 480 },
      ],
    })
    expect(score.notes.map((n) => n.pad)).toEqual(['kick', 'snare', 'hhClosed'])
    expect(new Set(score.notes.map((n) => n.id)).size).toBe(3)
  })

  it('rejects two notes for the same pad landing on the same tick (a duplicate/overlapping hit is never a real groove)', () => {
    expect(() =>
      makeGrooveScore({
        id: 'g',
        measureCount: 1,
        notes: [
          { pad: 'kick', tick: 0, durationTicks: 240 },
          { pad: 'kick', tick: 0, durationTicks: 240 },
          { pad: 'kick', tick: 0, durationTicks: 240 },
        ],
      }),
    ).toThrow(InvariantError)
  })

  it('rejects two notes for the same pad that overlap without sharing a tick', () => {
    expect(() =>
      makeGrooveScore({
        id: 'g',
        measureCount: 1,
        notes: [
          { pad: 'kick', tick: 0, durationTicks: 480 },
          { pad: 'kick', tick: 240, durationTicks: 240 },
        ],
      }),
    ).toThrow(InvariantError)
  })

  it('accepts two notes for the same pad that are back-to-back with no overlap', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 240 },
        { pad: 'kick', tick: 240, durationTicks: 240 },
      ],
    })
    expect(score.notes.map((n) => n.tick)).toEqual([0, 240])
  })

  it('derives voice from pad, never accepting it as input', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 240 },
        { pad: 'snare', tick: 240, durationTicks: 240 },
      ],
    })
    expect(score.notes.find((n) => n.pad === 'kick')?.voice).toBe('feet')
    expect(score.notes.find((n) => n.pad === 'snare')?.voice).toBe('hands')
  })

  it('throws on a note that runs past the end of its measure', () => {
    expect(() =>
      makeGrooveScore({ id: 'g', measureCount: 1, notes: [{ pad: 'kick', tick: 1800, durationTicks: 480 }] }),
    ).toThrow(InvariantError)
  })

  it('throws on a note outside every measure', () => {
    expect(() =>
      makeGrooveScore({ id: 'g', measureCount: 1, notes: [{ pad: 'kick', tick: 1920, durationTicks: 240 }] }),
    ).toThrow(InvariantError)
  })

  it.each([49, 76, 50.5, Number.NaN])('rejects swingPercent %s outside the whole 50..75 range', (swingPercent) => {
    expect(() => makeGrooveScore({ id: 'g', measureCount: 1, notes: [], swingPercent })).toThrow(
      InvariantError,
    )
  })

  it.each([50, 62, 75])('accepts swingPercent %s', (swingPercent) => {
    const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [], swingPercent })
    expect(score.swingPercent).toBe(swingPercent)
  })

  it('throws on an empty id', () => {
    expect(() => makeGrooveScore({ id: '', measureCount: 1, notes: [] })).toThrow(InvariantError)
  })
})

describe('swingUnit', () => {
  it('defaults to eighth', () => {
    const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [] })
    expect(score.swingUnit).toBe('eighth')
  })

  it('canonicalises to eighth whenever swingPercent is straight (50), regardless of the input swingUnit', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [],
      swingPercent: 50,
      swingUnit: 'sixteenth',
    })
    expect(score.swingUnit).toBe('eighth')
  })

  it('keeps sixteenth when the groove actually swings', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [],
      swingPercent: 62,
      swingUnit: 'sixteenth',
    })
    expect(score.swingUnit).toBe('sixteenth')
  })

  it('rejects an invalid swingUnit', () => {
    expect(() =>
      makeGrooveScore({ id: 'g', measureCount: 1, notes: [], swingPercent: 62, swingUnit: 'quarter' as SwingUnit }),
    ).toThrow(InvariantError)
  })
})

describe('validateGrooveScore: backstops for a hand-built (not makeGrooveScore-built) score', () => {
  it('rejects a straight score that claims a non-eighth swingUnit', () => {
    const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [] })
    const bad = { ...score, swingUnit: 'sixteenth' as SwingUnit }
    const result = validateGrooveScore(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('swingUnit')
  })

  it('rejects a note that references a pad that is not one of the 16 mapped pads', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 0, durationTicks: 240 }],
    })
    const firstNote = score.notes[0]
    expect(firstNote).toBeDefined()
    if (firstNote === undefined) return
    const badNote = { ...firstNote, pad: 'cowbell' } as unknown as (typeof score.notes)[number]
    const bad = { ...score, notes: [badNote] }
    const result = validateGrooveScore(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('mapped drum pad')
  })

  it('rejects two notes for the same pad at the same tick', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 0, durationTicks: 240 }],
    })
    const firstNote = score.notes[0]
    expect(firstNote).toBeDefined()
    if (firstNote === undefined) return
    const duplicate = { ...firstNote, id: 'g0.kick.0-dup' }
    const bad = { ...score, notes: [firstNote, duplicate] }
    const result = validateGrooveScore(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('same tick')
  })
})

describe('notesInMeasure', () => {
  it('returns only the notes in that measure, empty for an out-of-range index', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 2,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 240 },
        { pad: 'snare', tick: 1920, durationTicks: 240 },
      ],
    })
    expect(notesInMeasure(score, 0).map((n) => n.pad)).toEqual(['kick'])
    expect(notesInMeasure(score, 1).map((n) => n.pad)).toEqual(['snare'])
    expect(notesInMeasure(score, 5)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// property tests
// ---------------------------------------------------------------------------

const mappedPadArb = fc.constantFrom(...MAPPED_PADS)
const BAR_TICKS = 1920 // one 4/4 bar at TICKS_PER_QUARTER=480

/** A note input guaranteed to fit inside a single 4/4 bar. */
const noteInputArb = fc
  .tuple(mappedPadArb, fc.integer({ min: 0, max: BAR_TICKS - 1 }))
  .chain(([pad, tick]) =>
    fc.record({
      pad: fc.constant(pad),
      tick: fc.constant(tick),
      durationTicks: fc.integer({ min: 1, max: BAR_TICKS - tick }),
      dynamics: fc.constantFrom<DynamicsClass>('accent', 'normal', 'ghost'),
      articulations: fc.subarray(ARTICULATIONS as unknown as Articulation[]),
    }),
  )

/**
 * Drops any note that starts before the previous kept note on the same pad
 * ends. `validateGrooveScore` now rejects a duplicate/overlapping hit on one
 * pad (see the "rejects two notes for the same pad..." tests above), so the
 * arbitrary must not hand `makeGrooveScore` input that can no longer occur.
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

const grooveInputArb: fc.Arbitrary<GrooveScoreInput> = fc
  .array(noteInputArb, { maxLength: 15 })
  .map((notes) => ({ id: 'g', measureCount: 1, notes: dedupeOverlaps(notes) }))

describe('property: any well-formed input builds a self-consistent GrooveScore', () => {
  it('makeGrooveScore(input) always passes validateGrooveScore', () => {
    fc.assert(
      fc.property(grooveInputArb, (input) => {
        const score = makeGrooveScore(input)
        expect(validateGrooveScore(score).ok).toBe(true)
      }),
    )
  })

  it('notes are always sorted by tick then pad order', () => {
    fc.assert(
      fc.property(grooveInputArb, (input) => {
        const score = makeGrooveScore(input)
        for (let i = 1; i < score.notes.length; i++) {
          const prev = score.notes[i - 1]
          const cur = score.notes[i]
          expect(prev !== undefined && cur !== undefined).toBe(true)
          if (prev === undefined || cur === undefined) return
          expect(prev.tick <= cur.tick).toBe(true)
        }
      }),
    )
  })

  it('"feet never stems-up": every note\'s voice matches voiceOf(pad) exactly', () => {
    fc.assert(
      fc.property(grooveInputArb, (input) => {
        const score = makeGrooveScore(input)
        for (const note of score.notes) {
          expect(note.voice).toBe(voiceOf(note.pad))
          if (note.voice === 'feet') expect(note.pad === 'kick' || note.pad === 'hhPedal').toBe(true)
        }
      }),
    )
  })

  it('every note id is unique', () => {
    fc.assert(
      fc.property(grooveInputArb, (input) => {
        const score = makeGrooveScore(input)
        expect(new Set(score.notes.map((n) => n.id)).size).toBe(score.notes.length)
      }),
    )
  })
})
