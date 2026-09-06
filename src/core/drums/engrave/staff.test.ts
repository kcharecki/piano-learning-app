import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at, invariant } from '@core/shared/invariant.ts'
import { measureDurationTicks } from '@core/notation/score.ts'
import { SIXTEENTH } from '@core/shared/units.ts'
import { makeGrooveScore, type DynamicsClass, type GrooveScoreInput } from '@core/drums/model/groove.ts'
import { MAPPED_PADS, type MappedDrumPad } from '@core/drums/model/pad.ts'
import { ghostFunkBar, moneyBeat, moneyBeatOpenHat, quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import { engraveGroove } from './staff.ts'
import { CLEF_WIDTH, REPEAT_BARLINE_RESERVE, SLOT_WIDTH, TIME_SIGNATURE_WIDTH, type EngravedNote, type StaffLayout } from './layout.ts'

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
      // Straight eighths only — nothing here is shorter than an eighth, so
      // there is no secondary beam, just the one primary segment.
      expect(beam.segments).toHaveLength(1)
      expect(at(beam.segments, 0).level).toBe(1)
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
        { pad: 'hhClosed', tick: 0, durationTicks: 240 },
        { pad: 'snare', tick: 480, durationTicks: 480 },
        { pad: 'hhClosed', tick: 960, durationTicks: 120 },
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
        { pad: 'hhClosed', tick: 0, durationTicks: 240 },
        { pad: 'snare', tick: 0, durationTicks: 120 },
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

// ------------------------------------------------------- horizontal layout

describe('engraveGroove — horizontal layout', () => {
  it('places the first notehead strictly right of the clef and time signature, with no barline at or before it', () => {
    const score = moneyBeat()
    const layout = engraveGroove(score)
    const firstNoteX = Math.min(...layout.notes.map((n) => n.x))

    expect(firstNoteX).toBeGreaterThan(CLEF_WIDTH + TIME_SIGNATURE_WIDTH)
    expect(layout.barlines.every((x) => x > firstNoteX)).toBe(true)
  })

  it('draws exactly one barline for a one-measure score', () => {
    const layout = engraveGroove(moneyBeat())
    expect(layout.barlines).toHaveLength(1)
  })

  it('draws two barlines for a two-measure score, the first strictly between bar 1s last note and bar 2s first', () => {
    const score = makeGrooveScore({
      id: 'two-bar-hats',
      measureCount: 2,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 480 },
        { pad: 'hhClosed', tick: 1920, durationTicks: 480 },
      ],
    })
    const layout = engraveGroove(score)
    expect(layout.barlines).toHaveLength(2)

    const bar1Note = layout.notes.find((n) => n.tick === 0)
    const bar2Note = layout.notes.find((n) => n.tick === 1920)
    invariant(bar1Note !== undefined && bar2Note !== undefined, 'expected one note in each bar')

    const firstBarline = at(layout.barlines, 0)
    expect(firstBarline).toBeGreaterThan(bar1Note.x)
    expect(firstBarline).toBeLessThan(bar2Note.x)
  })
})

describe('engraveGroove — time signature', () => {
  it('states the meter once, between the clef and the first notehead, at the top staff lines y', () => {
    const score = moneyBeat()
    const layout = engraveGroove(score)
    const firstNoteX = Math.min(...layout.notes.map((n) => n.x))
    const topLineY = Math.min(...layout.staffLines.map((l) => l.y))

    expect(layout.timeSignature.beats).toBe(score.timeSignature.beats)
    expect(layout.timeSignature.beatType).toBe(score.timeSignature.beatType)
    expect(layout.timeSignature.x).toBeGreaterThan(0)
    expect(layout.timeSignature.x).toBeLessThan(firstNoteX)
    expect(layout.timeSignature.y).toBe(topLineY)
  })
})

// ------------------------------------------------------- playCount & repeat

describe('engraveGroove — playCount and the repeat', () => {
  it('reports playCount 1 and no repeat label by default', () => {
    const layout = engraveGroove(moneyBeat())
    expect(layout.playCount).toBe(1)
    expect(layout.repeatLabel).toBeUndefined()
  })

  it('reports playCount 2 and a ×2 label above the top staff line when asked to repeat', () => {
    const layout = engraveGroove(moneyBeat(), { playCount: 2 })
    expect(layout.playCount).toBe(2)
    invariant(layout.repeatLabel !== undefined, 'expected a repeat label')
    expect(layout.repeatLabel.text).toBe('×2')
    const topLineY = Math.min(...layout.staffLines.map((l) => l.y))
    expect(layout.repeatLabel.y).toBeLessThan(topLineY)
  })

  // Both of the next two were drawn on top of the music before they were
  // written: the label crossed the last hi-hat's stem, and the renderer's
  // repeat dots landed on the beat-4 snare, which reads as a dotted notehead
  // rather than as a repeat.
  it('puts the repeat label above every stem and every mark in the score', () => {
    const layout = engraveGroove(moneyBeatOpenHat(), { playCount: 2 })
    invariant(layout.repeatLabel !== undefined, 'expected a repeat label')
    for (const note of layout.notes) {
      expect(layout.repeatLabel.y).toBeLessThan(note.stemToY)
      if (note.marks.length > 0) expect(layout.repeatLabel.y).toBeLessThan(note.markAnchorY)
    }
  })

  it('leaves the repeat barline its own width, clear of the last notehead', () => {
    const plain = engraveGroove(moneyBeat())
    const repeated = engraveGroove(moneyBeat(), { playCount: 2 })
    const tailOf = (layout: StaffLayout): number =>
      at(layout.barlines, layout.barlines.length - 1) - Math.max(...layout.notes.map((n) => n.x))

    // The whole reserve is spent on the gap the dots need, and on nothing
    // else: the notes do not move, and a bar that is not repeated pays
    // nothing for the apparatus it never draws.
    expect(tailOf(repeated) - tailOf(plain)).toBeCloseTo(REPEAT_BARLINE_RESERVE)
    expect(tailOf(plain)).toBeCloseTo(SLOT_WIDTH / 2)
    expect(repeated.width - plain.width).toBeCloseTo(REPEAT_BARLINE_RESERVE)
    expect(Math.max(...repeated.notes.map((n) => n.x))).toBeCloseTo(
      Math.max(...plain.notes.map((n) => n.x)),
    )
  })
})

// --------------------------------------------------------------- markAnchorY

describe('engraveGroove — markAnchorY', () => {
  it('anchors an open hi-hats mark above its own stem tip', () => {
    const score = moneyBeatOpenHat()
    const layout = engraveGroove(score)
    const openNote = layout.notes.find((n) => n.marks.includes('open'))
    invariant(openNote !== undefined, 'expected an open note')
    expect(openNote.markAnchorY).toBeLessThan(openNote.stemToY)
  })

  it('anchors a beamed open hi-hats mark above its beam, not just its own pre-beam stem', () => {
    // moneyBeatOpenHat's open hat rides the beat-4 hi-hat beam; its stemToY
    // IS that beam's y once beaming has settled, so this pins the same fact
    // the renderer actually reads off.
    const score = moneyBeatOpenHat()
    const layout = engraveGroove(score)
    const openNote = layout.notes.find((n) => n.marks.includes('open'))
    invariant(openNote !== undefined, 'expected an open note')
    const beam = layout.beams.find((b) => b.noteIds.includes(openNote.id))
    invariant(beam !== undefined, 'expected the open hi-hat to be beamed')
    expect(openNote.markAnchorY).toBeLessThan(beam.y)
  })
})

// ----------------------------------------------------------- beam segments

describe('engraveGroove — beam segments', () => {
  it("ghostFunkBar's kick beat-1 beam ('1' and '1 a') gets one level-1 segment and two opposite half-slot stubs", () => {
    const score = ghostFunkBar()
    const layout = engraveGroove(score)

    const kickAt0 = layout.notes.find((n) => n.pad === 'kick' && n.tick === 0)
    const kickAt360 = layout.notes.find((n) => n.pad === 'kick' && n.tick === 360)
    invariant(kickAt0 !== undefined && kickAt360 !== undefined, 'expected kicks on "1" and "1 a"')

    const beam = layout.beams.find((b) => b.noteIds.includes(kickAt0.id) && b.noteIds.includes(kickAt360.id))
    invariant(beam !== undefined, 'expected the two kicks to share a beam')

    const level1 = beam.segments.filter((s) => s.level === 1)
    expect(level1).toHaveLength(1)

    const level2 = beam.segments.filter((s) => s.level === 2)
    expect(level2).toHaveLength(2)
    for (const segment of level2) expect(segment.toX - segment.fromX).toBeCloseTo(SLOT_WIDTH / 2)

    // "1" has no earlier beam member, so its stub points right; "1 a" has an
    // earlier member (tick 0), so its stub points left.
    const rightStub = level2.find((s) => s.fromX === kickAt0.x)
    const leftStub = level2.find((s) => s.toX === kickAt360.x)
    expect(rightStub).toBeDefined()
    expect(leftStub).toBeDefined()
  })

  it('beams four consecutive sixteenths as one level-2 segment spanning all four, not four stubs', () => {
    const score = ghostFunkBar()
    const layout = engraveGroove(score)

    const hiHatAt0 = layout.notes.find((n) => n.pad === 'hhClosed' && n.tick === 0)
    const hiHatAt360 = layout.notes.find((n) => n.pad === 'hhClosed' && n.tick === 360)
    invariant(hiHatAt0 !== undefined && hiHatAt360 !== undefined, 'expected hi-hats on beat 1s four sixteenths')

    const beam = layout.beams.find((b) => b.noteIds.includes(hiHatAt0.id))
    invariant(beam !== undefined, 'expected the hi-hat to be beamed')

    const level2 = beam.segments.filter((s) => s.level === 2)
    expect(level2).toHaveLength(1)
    expect(at(level2, 0).fromX).toBe(hiHatAt0.x)
    expect(at(level2, 0).toX).toBe(hiHatAt360.x)
  })
})

// ---------------------------------------------------------------------- rests

describe('engraveGroove — rests', () => {
  it("emits feet rests on moneyBeat's silent beats (2 and 4) and no hands rests", () => {
    const score = moneyBeat()
    const layout = engraveGroove(score)

    expect(layout.rests.filter((r) => r.voice === 'hands')).toHaveLength(0)
    const feetRests = layout.rests.filter((r) => r.voice === 'feet')
    expect(feetRests).toHaveLength(2)

    const snareAt480 = layout.notes.find((n) => n.pad === 'snare' && n.tick === 480)
    const snareAt1440 = layout.notes.find((n) => n.pad === 'snare' && n.tick === 1440)
    invariant(snareAt480 !== undefined && snareAt1440 !== undefined, 'expected the two backbeats')
    expect(feetRests.map((r) => r.x).sort((a, b) => a - b)).toEqual(
      [snareAt480.x, snareAt1440.x].sort((a, b) => a - b),
    )
  })

  it('emits no feet rests at all when the score has no feet note', () => {
    const score = makeGrooveScore({
      id: 'no-feet',
      measureCount: 1,
      notes: [{ pad: 'hhClosed', tick: 0, durationTicks: 480 }],
    })
    const layout = engraveGroove(score)
    expect(layout.rests.some((r) => r.voice === 'feet')).toBe(false)
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

  it('every beam has exactly one level-1 segment, and every segment has fromX <= toX', () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        for (const beam of layout.beams) {
          expect(beam.segments.filter((s) => s.level === 1)).toHaveLength(1)
          for (const segment of beam.segments) expect(segment.fromX).toBeLessThanOrEqual(segment.toX)
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

  it('marks an open or accented note above its own head, clearing its stem', () => {
    // `ghost` is excluded on purpose: it draws beside the head, not stacked
    // off `markAnchorY` (see `EngravedNote.markAnchorY`'s doc), so nothing
    // guarantees its anchor clears anything — it is simply unused.
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        for (const note of layout.notes) {
          if (!note.marks.includes('open') && !note.marks.includes('accent')) continue
          expect(note.markAnchorY).toBeLessThan(note.y)
          if (note.voice === 'hands') expect(note.markAnchorY).toBeLessThan(note.stemToY)
          else expect(note.markAnchorY).toBeLessThan(note.y)
        }
      }),
    )
  })

  it("every rest's y sits strictly inside the five staff lines", () => {
    fc.assert(
      fc.property(grooveScoreArb, (score) => {
        const layout = engraveGroove(score)
        const lineYs = layout.staffLines.map((l) => l.y)
        const top = Math.min(...lineYs)
        const bottom = Math.max(...lineYs)
        for (const rest of layout.rests) {
          expect(rest.y).toBeGreaterThan(top)
          expect(rest.y).toBeLessThan(bottom)
        }
      }),
    )
  })

  it('every coordinate is finite, x stays within [0, width], y stays within [0, height]', () => {
    // Extended (rather than duplicated) for the new fields: `timeSignature`,
    // `rests`, `beams[].segments` and, since it is only ever drawn for a note
    // carrying `open`/`accent`, `markAnchorY` restricted to those notes — see
    // the "marks an open or accented note" property above for why an
    // unmarked note's `markAnchorY` is exempt. `repeatLabel` is only ever
    // present when `playCount > 1`, so this generates one alongside the
    // score to actually exercise it instead of leaving it perpetually absent.
    fc.assert(
      fc.property(grooveScoreArb, fc.integer({ min: 1, max: 4 }), (score, playCount) => {
        const layout = engraveGroove(score, { playCount })
        const markedYs = layout.notes
          .filter((n) => n.marks.includes('open') || n.marks.includes('accent'))
          .map((n) => n.markAnchorY)
        const xs = [
          ...layout.barlines,
          layout.timeSignature.x,
          ...layout.notes.map((n) => n.x),
          ...layout.counts.map((c) => c.x),
          ...layout.rests.map((r) => r.x),
          ...layout.staffLines.flatMap((l) => [l.fromX, l.toX]),
          ...layout.beams.flatMap((b) => [b.fromX, b.toX, ...b.segments.flatMap((s) => [s.fromX, s.toX])]),
          ...(layout.repeatLabel === undefined ? [] : [layout.repeatLabel.x]),
        ]
        const ys = [
          layout.timeSignature.y,
          ...layout.notes.flatMap((n) => [n.y, n.stemToY]),
          ...markedYs,
          ...layout.staffLines.map((l) => l.y),
          ...layout.counts.map((c) => c.y),
          ...layout.rests.map((r) => r.y),
          ...layout.beams.map((b) => b.y),
          ...(layout.repeatLabel === undefined ? [] : [layout.repeatLabel.y]),
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
