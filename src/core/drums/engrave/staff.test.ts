import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at, invariant } from '@core/shared/invariant.ts'
import { measureDurationTicks } from '@core/notation/score.ts'
import { SIXTEENTH } from '@core/shared/units.ts'
import { makeGrooveScore, type DynamicsClass, type GrooveScoreInput } from '@core/drums/model/groove.ts'
import { MAPPED_PADS, type MappedDrumPad } from '@core/drums/model/pad.ts'
import { ghostFunkBar, moneyBeat, moneyBeatOpenHat, quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import { engraveGroove } from './staff.ts'
import type { EngravedNote, StaffLayout } from './layout.ts'

// -------------------------------------------------------------------- helpers

function noteFor(layout: StaffLayout, pad: MappedDrumPad): EngravedNote {
  const note = layout.notes.find((n) => n.pad === pad)
  invariant(note !== undefined, `no note for pad "${pad}" in this layout`)
  return note
}

// ------------------------------------------------------------ example tests

describe('engraveGroove — moneyBeat', () => {
  it('has 12 notes, all eight hi-hats at one y, the kick below the snare, and an eighth-note count row', () => {
    const score = moneyBeat()
    const layout = engraveGroove(score)

    expect(layout.notes).toHaveLength(12)

    const hiHatYs = layout.notes.filter((n) => n.pad === 'hhClosed').map((n) => n.y)
    expect(hiHatYs).toHaveLength(8)
    expect(new Set(hiHatYs).size).toBe(1)

    const kick = noteFor(layout, 'kick')
    const snare = noteFor(layout, 'snare')
    // y grows downward, so "below" on the staff is the larger y.
    expect(kick.y).toBeGreaterThan(snare.y)

    expect(layout.counts.map((c) => c.text)).toEqual(['1', '&', '2', '&', '3', '&', '4', '&'])
  })
})

describe('engraveGroove — beams and flags', () => {
  it('beams the hi-hats on every beat of moneyBeat, including the two beats a quarter-note snare sits on', () => {
    // The regression: beaming used to require EVERY note in a beat to be
    // shorter than a quarter, so the snare on 2 and on 4 deleted those beats'
    // hi-hat beams. The eighths then rendered as bare, flagless stems —
    // quarter notes, to anyone reading the picture. Nothing in this suite
    // noticed; a screenshot did.
    const score = moneyBeat()
    const layout = engraveGroove(score)

    const handsBeams = layout.beams.filter((b) => b.voice === 'hands')
    expect(handsBeams).toHaveLength(4)

    const hiHatIds = new Set(score.notes.filter((n) => n.pad === 'hhClosed').map((n) => n.id))
    for (const beam of handsBeams) {
      expect(beam.noteIds.filter((id) => hiHatIds.has(id))).toHaveLength(2)
      expect(beam.count).toBe(1)
    }

    // Beamed notes carry no flag — the beam is the flag.
    for (const note of layout.notes.filter((n) => n.pad === 'hhClosed')) {
      expect(note.flags, `${note.id} has both a beam and a flag`).toBe(0)
    }
    // The snare rides the beam it shares a stem with, so it is flagless too,
    // and the quarter-note kick never had a flag to begin with.
    for (const note of layout.notes.filter((n) => n.pad === 'kick')) expect(note.flags).toBe(0)
  })

  it('flags a short note that no beam reaches, so a lone eighth never renders as a quarter', () => {
    // One eighth alone on beat 1, a quarter elsewhere: nothing to beam it to.
    const score = makeGrooveScore({
      id: 'lone-eighth',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 240, dynamics: 'normal' },
        { pad: 'snare', tick: 480, durationTicks: 480, dynamics: 'normal' },
        { pad: 'hhClosed', tick: 960, durationTicks: 120, dynamics: 'normal' },
      ],
    })
    const layout = engraveGroove(score)

    expect(layout.beams).toHaveLength(0)
    const flagsOf = (pad: MappedDrumPad, tick: number) => {
      const note = layout.notes.find((n) => n.pad === pad && n.tick === tick)
      invariant(note !== undefined, `no ${pad} at tick ${tick}`)
      return note.flags
    }
    expect(flagsOf('hhClosed', 0)).toBe(1)
    expect(flagsOf('snare', 480)).toBe(0)
    expect(flagsOf('hhClosed', 960)).toBe(2)
  })

  it('gives every note on one stem the same flag count, taken from the shortest of them', () => {
    // A sixteenth and an eighth struck together share a stem; one stem cannot
    // show two different flag counts without contradicting itself.
    const score = makeGrooveScore({
      id: 'shared-stem',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 240, dynamics: 'normal' },
        { pad: 'snare', tick: 0, durationTicks: 120, dynamics: 'normal' },
      ],
    })
    const layout = engraveGroove(score)

    expect(layout.beams).toHaveLength(0)
    expect(layout.notes.map((n) => n.flags)).toEqual([2, 2])
  })
})

describe('engraveGroove — moneyBeatOpenHat', () => {
  it('marks exactly one note open, and it is the last hi-hat by x', () => {
    const score = moneyBeatOpenHat()
    const layout = engraveGroove(score)

    const openNotes = layout.notes.filter((n) => n.marks.includes('open'))
    expect(openNotes).toHaveLength(1)

    const hiHats = layout.notes.filter((n) => n.pad === 'hhClosed' || n.pad === 'hhOpen')
    const lastByX = [...hiHats].sort((a, b) => b.x - a.x)
    const last = at(lastByX, 0)
    expect(at(openNotes, 0).id).toBe(last.id)
  })
})

describe('engraveGroove — quarterNoteRock', () => {
  it('has a quarter-note count row, and its hi-hats are not beamed', () => {
    const score = quarterNoteRock()
    const layout = engraveGroove(score)

    expect(layout.counts.map((c) => c.text)).toEqual(['1', '2', '3', '4'])

    const hiHatIds = new Set(score.notes.filter((n) => n.pad === 'hhClosed').map((n) => n.id))
    for (const beam of layout.beams) {
      expect(beam.noteIds.some((id) => hiHatIds.has(id))).toBe(false)
    }
  })
})

describe('engraveGroove — ghostFunkBar', () => {
  it('has a sixteenth-note count row, ghost marks on exactly the ghost notes, and four four-note hi-hat beams', () => {
    const score = ghostFunkBar()
    const layout = engraveGroove(score)

    expect(layout.counts.map((c) => c.text)).toEqual([
      '1', 'e', '&', 'a',
      '2', 'e', '&', 'a',
      '3', 'e', '&', 'a',
      '4', 'e', '&', 'a',
    ])

    const ghostIds = new Set(score.notes.filter((n) => n.dynamics === 'ghost').map((n) => n.id))
    for (const note of layout.notes) {
      expect(note.marks.includes('ghost')).toBe(ghostIds.has(note.id))
    }

    // Beams are grouped by voice, not pad (see staff.ts's module doc), so a
    // hands-voice beam in this bar can also carry a coincident snare ghost —
    // what's guaranteed is that each of the four beats' hands-beam carries
    // exactly its four hi-hat notes.
    const hiHatIds = new Set(score.notes.filter((n) => n.pad === 'hhClosed').map((n) => n.id))
    const handsBeams = layout.beams.filter((b) => b.voice === 'hands')
    expect(handsBeams).toHaveLength(4)
    for (const beam of handsBeams) {
      expect(beam.noteIds.filter((id) => hiHatIds.has(id))).toHaveLength(4)
    }
  })
})

// ------------------------------------------------------------ property tests

const noteSpecArb = fc.record({
  pad: fc.constantFrom(...MAPPED_PADS),
  slot: fc.integer({ min: 0, max: 15 }),
  dynamics: fc.constantFrom<DynamicsClass>('normal', 'accent', 'ghost'),
  open: fc.boolean(),
})

/**
 * Builds a valid, single-measure 4/4 `GrooveScore` on the sixteenth-note
 * grid — deliberately "inside the 4/4 grid" so it always passes
 * `validateGrooveScore`: every note is exactly one sixteenth long, so two
 * notes on the same pad are either identical slots (de-duplicated below) or
 * strictly back-to-back, never overlapping.
 *
 * Every one of the 16 mapped pads is generated, `splash` and `hhPedal`
 * included. That is the point of the on-canvas property below: those two are
 * the extremes of the pad table (two spaces above the top line, and a foot
 * pad below the bottom one), and under the fixed geometry this module used to
 * assume, `splash`'s stem tip landed at y = -0.5 — off the canvas. The box is
 * derived from the score now, so no pad needs excusing.
 */
const grooveScoreArb = fc
  .array(noteSpecArb, { maxLength: 24 })
  .map((specs) => {
    const seen = new Set<string>()
    const notes = specs.filter((spec) => {
      const key = `${spec.pad}:${spec.slot}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const input: GrooveScoreInput = {
      id: 'prop-groove',
      measureCount: 1,
      notes: notes.map((spec) => ({
        pad: spec.pad,
        tick: spec.slot * SIXTEENTH,
        durationTicks: SIXTEENTH,
        dynamics: spec.dynamics,
        ...(spec.open ? { articulations: ['open' as const] } : {}),
      })),
    }
    return makeGrooveScore(input)
  })

describe('engraveGroove — properties', () => {
  it('every layout note id appears exactly once, and the set equals the score note ids', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        expect(layout.notes.map((n) => n.id).sort()).toEqual(score.notes.map((n) => n.id).sort())
        expect(new Set(layout.notes.map((n) => n.id)).size).toBe(layout.notes.length)
      }),
    )
  })

  it('x is non-decreasing in tick, and strictly increasing between distinct ticks', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        const sorted = [...layout.notes].sort((a, b) => a.tick - b.tick)
        for (let i = 1; i < sorted.length; i++) {
          const prev = at(sorted, i - 1)
          const cur = at(sorted, i)
          expect(cur.x).toBeGreaterThanOrEqual(prev.x)
          if (cur.tick !== prev.tick) expect(cur.x).toBeGreaterThan(prev.x)
        }
      }),
    )
  })

  it('hands notes always stem up (stemToY < y), feet notes always stem down (stemToY > y)', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        for (const note of layout.notes) {
          if (note.voice === 'hands') expect(note.stemToY).toBeLessThan(note.y)
          else expect(note.stemToY).toBeGreaterThan(note.y)
        }
      }),
    )
  })

  it('no beam spans more than one beat, and every beam has at least two notes', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        const beatTicks = measureDurationTicks(score.timeSignature) / score.timeSignature.beats
        const noteById = new Map(score.notes.map((n) => [n.id, n]))
        for (const beam of layout.beams) {
          expect(beam.noteIds.length).toBeGreaterThanOrEqual(2)
          const beats = new Set(
            beam.noteIds.map((id) => {
              const note = noteById.get(id)
              invariant(note !== undefined, `beam references unknown note ${id}`)
              const measure = at(score.measures, note.measureIndex)
              return `${note.measureIndex}:${Math.floor((note.tick - measure.startTick) / beatTicks)}`
            }),
          )
          expect(beats.size).toBe(1)
        }
      }),
    )
  })

  it('a note carries the ghost mark iff its dynamics is ghost', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        for (const note of layout.notes) {
          expect(note.marks.includes('ghost')).toBe(note.dynamics === 'ghost')
        }
      }),
    )
  })

  it('every coordinate is finite, x stays within [0, width], y stays within [0, height]', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        const xs = [
          ...layout.barlines,
          ...layout.notes.map((n) => n.x),
          ...layout.counts.map((c) => c.x),
          ...layout.staffLines.flatMap((l) => [l.fromX, l.toX]),
          ...layout.beams.flatMap((b) => [b.fromX, b.toX]),
        ]
        const ys = [
          ...layout.notes.flatMap((n) => [n.y, n.stemToY]),
          ...layout.staffLines.map((l) => l.y),
          ...layout.counts.map((c) => c.y),
          ...layout.beams.map((b) => b.y),
        ]
        for (const value of [...xs, ...ys]) expect(Number.isFinite(value)).toBe(true)
        for (const value of xs) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(layout.width)
        }
        for (const value of ys) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(layout.height)
        }
      }),
    )
  })

  it('the count row clears every stem tip, so a label is never struck through by a stem', () => {
    // The bug this pins: the kick sits in the bottom space and stems DOWN, so
    // under the old fixed count-row y its stem ran half a space past the
    // labels — on every groove the trainer ships, all of which have a kick.
    // `y <= height` alone never caught it: the stem was inside the canvas,
    // just on top of the text.
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        if (layout.counts.length === 0) return
        const countY = Math.min(...layout.counts.map((c) => c.y))
        for (const note of layout.notes) {
          expect(note.stemToY, `${note.pad} stem reaches the count row`).toBeLessThan(countY)
          expect(note.y).toBeLessThan(countY)
        }
        for (const beam of layout.beams) expect(beam.y).toBeLessThan(countY)
      }),
    )
  })

  it('a note is flagged exactly when it is short and no beam carries it', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        const beamed = new Set(layout.beams.flatMap((b) => b.noteIds))
        const durationById = new Map(score.notes.map((n) => [n.id, n.durationTicks]))
        for (const note of layout.notes) {
          if (beamed.has(note.id)) {
            expect(note.flags, `${note.id} is beamed and flagged`).toBe(0)
            continue
          }
          const duration = durationById.get(note.id)
          invariant(duration !== undefined, `no duration for ${note.id}`)
          // Flags come from the stem, not the note, so the bound is "at least
          // what my own duration needs" — a shorter neighbour on the same
          // stem can raise it.
          const own = duration >= 480 ? 0 : duration >= 240 ? 1 : 2
          expect(note.flags).toBeGreaterThanOrEqual(own)
          expect(note.flags).toBeLessThanOrEqual(2)
        }
      }),
    )
  })

  it('engraving the same score twice gives a deep-equal layout', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        expect(engraveGroove(score)).toEqual(engraveGroove(score))
      }),
    )
  })
})
