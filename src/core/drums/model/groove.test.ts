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

describe('a swung score rejects a real swing collision, not merely being off-grid (F4/A4)', () => {
  /**
   * Ghost Funk Bar's own hi-hat plays all 16 sixteenths (`referenceGrooves.ts`).
   * `swungTick` only ever moves the second cell of an eighth pair — ticks 240,
   * 720, 1200, 1680 — to `round(480 * swingPercent / 100)` past its pair
   * start. Probed directly (`swungTick(t, p, 'eighth', 1920, 4, 4)` for
   * `t` in [240, 720, 1200, 1680]): at swingPercent 75 those land on
   * [360, 840, 1320, 1800] — EXACTLY the hi-hat's own existing sixteenths at
   * those ticks (multiples of 120), a real same-pad collision. At
   * swingPercent 67 they land on [322, 802, 1282, 1762] — none a multiple of
   * 120, so nothing collides. This is A4's whole point: being off the
   * swingUnit grid is not itself an error (F4's old rule over-rejected every
   * percent from 55 to 74 here); only an actual collision is.
   */
  it('rejects ghost-funk-bar\'s all-sixteenths hi-hat at swingPercent 75 (a real collision) naming the pad and the shared tick', () => {
    const SIXTEENTH = 120
    const idxToTick = (idx: number): number => idx * SIXTEENTH
    const allSixteenths = Array.from({ length: 16 }, (_, idx) => idxToTick(idx))
    const build = () =>
      makeGrooveScore({
        id: 'ghost-funk-bar-swung',
        measureCount: 1,
        swingPercent: 75,
        swingUnit: 'eighth',
        notes: allSixteenths.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: SIXTEENTH })),
      })
    expect(build).toThrow(InvariantError)
    let caught: unknown
    try {
      build()
    } catch (cause) {
      caught = cause
    }
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).toContain('hhClosed')
    expect(message).toContain('360')
  })

  it('accepts the identical all-sixteenths hi-hat at swingPercent 67 (probed: no swung tick collides)', () => {
    const SIXTEENTH = 120
    const idxToTick = (idx: number): number => idx * SIXTEENTH
    const allSixteenths = Array.from({ length: 16 }, (_, idx) => idxToTick(idx))
    expect(() =>
      makeGrooveScore({
        id: 'ghost-funk-bar-swung-67',
        measureCount: 1,
        swingPercent: 67,
        swingUnit: 'eighth',
        notes: allSixteenths.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: SIXTEENTH })),
      }),
    ).not.toThrow()
  })

  it('a minimal two-note reproduction of the same collision: tick 240 and tick 360 on hhClosed both swing to 360 at 75%', () => {
    expect(() =>
      makeGrooveScore({
        id: 'g',
        measureCount: 1,
        swingPercent: 75,
        swingUnit: 'eighth',
        notes: [
          { pad: 'hhClosed', tick: 240, durationTicks: 120 },
          { pad: 'hhClosed', tick: 360, durationTicks: 120 },
        ],
      }),
    ).toThrow(InvariantError)
  })

  it('validateGrooveScore reports the same rejection as a Result err, not a throw, for a hand-built score', () => {
    const straight = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 240, durationTicks: 120 },
        { pad: 'hhClosed', tick: 360, durationTicks: 120 },
      ],
    })
    const swung = { ...straight, swingPercent: 75, swingUnit: 'eighth' as SwingUnit }
    const result = validateGrooveScore(swung)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('hhClosed')
      expect(result.error).toContain('360')
    }
  })

  it('a lone off-grid note with nothing to collide with is NOT rejected (A4: off-grid alone is not an error)', () => {
    // Single hhClosed note at tick 120 — off the eighth-swing grid (cell 240)
    // the same way F4's old, over-broad rule would have rejected it — but
    // with no sibling note on the same pad, nothing can collide.
    expect(() =>
      makeGrooveScore({
        id: 'g',
        measureCount: 1,
        swingPercent: 75,
        swingUnit: 'eighth',
        notes: [{ pad: 'hhClosed', tick: 120, durationTicks: 120 }],
      }),
    ).not.toThrow()
  })

  it('a swung score whose notes already sit on the swingUnit grid, and never collide, is unaffected (jazz-ride-shaped eighth-grid notes at 67%)', () => {
    expect(() =>
      makeGrooveScore({
        id: 'g',
        measureCount: 1,
        swingPercent: 67,
        swingUnit: 'eighth',
        notes: [
          { pad: 'rideBow', tick: 0, durationTicks: 240 },
          { pad: 'rideBow', tick: 240, durationTicks: 240 },
          { pad: 'snare', tick: 720, durationTicks: 240 },
        ],
      }),
    ).not.toThrow()
  })

  /**
   * A3: a 6/8 bar groups its eighths in threes — `swungTick`'s duple pairing
   * (F6) is already the identity there, so this loop's swing-collision check
   * must be skipped entirely, not merely fail to fire by coincidence. Two
   * hhClosed sixteenths (120, 240 — off the eighth grid, and NOT identical
   * ticks, so the plain duplicate-tick check does not catch this on its own)
   * in a 6/8 bar at swingPercent 67 must build cleanly.
   */
  it('skips the swing-collision check entirely for a compound meter (6/8) — F4/A4 never fires where F6 already makes swing the identity', () => {
    expect(() =>
      makeGrooveScore({
        id: 'g',
        measureCount: 1,
        timeSignature: { beats: 6, beatType: 8 },
        swingPercent: 67,
        swingUnit: 'eighth',
        notes: [
          { pad: 'hhClosed', tick: 120, durationTicks: 120 },
          { pad: 'hhClosed', tick: 240, durationTicks: 120 },
        ],
      }),
    ).not.toThrow()
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

describe('hhOpen <-> "open" articulation (roadmap T.34)', () => {
  it.each(MAPPED_PADS)(
    'a one-note score on %s built through makeGrooveScore always validates ok',
    (pad) => {
      const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [{ pad, tick: 0, durationTicks: 240 }] })
      expect(validateGrooveScore(score).ok).toBe(true)
    },
  )

  it('derives "open" on hhOpen when absent', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'hhOpen', tick: 0, durationTicks: 240 }],
    })
    const note = score.notes[0]
    expect(note).toBeDefined()
    if (note === undefined) return
    expect(note.articulations).toEqual(['open'])
  })

  it('never duplicates "open" when it is already given for hhOpen', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'hhOpen', tick: 0, durationTicks: 240, articulations: ['open'] }],
    })
    const note = score.notes[0]
    expect(note).toBeDefined()
    if (note === undefined) return
    expect(note.articulations).toEqual(['open'])
  })

  it('dedupes an input that already holds "open" twice for hhOpen', () => {
    const score = makeGrooveScore({
      id: 'g',
      measureCount: 1,
      notes: [{ pad: 'hhOpen', tick: 0, durationTicks: 240, articulations: ['open', 'open'] }],
    })
    const note = score.notes[0]
    expect(note).toBeDefined()
    if (note === undefined) return
    expect(note.articulations).toEqual(['open'])
  })

  it('rejects "open" on every pad other than hhOpen', () => {
    for (const pad of MAPPED_PADS) {
      if (pad === 'hhOpen') continue
      expect(() =>
        makeGrooveScore({
          id: 'g',
          measureCount: 1,
          notes: [{ pad, tick: 0, durationTicks: 240, articulations: ['open'] }],
        }),
      ).toThrow(InvariantError)
    }
  })

  it.each(MAPPED_PADS)(
    'property: a hand-built copy of a %s note is err exactly when it breaks the hhOpen<->open tie',
    (pad) => {
      const score = makeGrooveScore({ id: 'g', measureCount: 1, notes: [{ pad, tick: 0, durationTicks: 240 }] })
      expect(validateGrooveScore(score).ok).toBe(true)

      const note = score.notes[0]
      expect(note).toBeDefined()
      if (note === undefined) return

      if (pad === 'hhOpen') {
        // a copy with 'open' removed from an hhOpen note is err
        const stripped = { ...note, articulations: [] }
        const bad = { ...score, notes: [stripped] }
        expect(validateGrooveScore(bad).ok).toBe(false)
      } else {
        // a copy with 'open' added to any other pad is err
        const withOpen = { ...note, articulations: ['open' as const] }
        const bad = { ...score, notes: [withOpen] }
        expect(validateGrooveScore(bad).ok).toBe(false)
      }
    },
  )
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

/**
 * A note input guaranteed to fit inside a single 4/4 bar. `'open'` is dropped
 * from any pad other than `hhOpen` — `makeGrooveScore` now rejects that
 * combination outright (T.34), so, same as `dedupeOverlaps` below for
 * overlapping hits, the arbitrary must not hand it input that can no longer
 * occur.
 */
const noteInputArb = fc
  .tuple(mappedPadArb, fc.integer({ min: 0, max: BAR_TICKS - 1 }))
  .chain(([pad, tick]) =>
    fc.record({
      pad: fc.constant(pad),
      tick: fc.constant(tick),
      durationTicks: fc.integer({ min: 1, max: BAR_TICKS - tick }),
      dynamics: fc.constantFrom<DynamicsClass>('accent', 'normal', 'ghost'),
      articulations: fc
        .subarray(ARTICULATIONS as unknown as Articulation[])
        .map((arts) => (pad === 'hhOpen' ? arts : arts.filter((a) => a !== 'open'))),
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

describe('property: articulations are always deduplicated and canonically ordered', () => {
  /**
   * `ARTICULATIONS` (`./articulation.ts`) is the single canonical order the
   * MusicXML bridge reads and writes in — see `canonicalizeArticulations` in
   * `./groove.ts`. For any pad and any input articulation list ('open' only
   * ever legal on hhOpen), `makeGrooveScore` must produce exactly the subset
   * of `ARTICULATIONS`, in that order, that the input carries — plus 'open'
   * itself whenever the pad is hhOpen, since it is derived unconditionally.
   */
  it('makeGrooveScore produces exactly ARTICULATIONS.filter(present-or-derived-open)', () => {
    fc.assert(
      fc.property(
        mappedPadArb,
        fc.subarray(ARTICULATIONS as unknown as Articulation[]),
        (pad, rawArticulations) => {
          const input = pad === 'hhOpen' ? rawArticulations : rawArticulations.filter((a) => a !== 'open')
          const score = makeGrooveScore({
            id: 'g',
            measureCount: 1,
            notes: [{ pad, tick: 0, durationTicks: 240, articulations: input }],
          })
          const note = score.notes[0]
          expect(note).toBeDefined()
          if (note === undefined) return
          const expected = ARTICULATIONS.filter((a) => input.includes(a) || (pad === 'hhOpen' && a === 'open'))
          expect(note.articulations).toEqual(expected)
        },
      ),
    )
  })
})
