import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeGrooveScore, type GrooveScore } from '@core/drums/model/groove.ts'
import { moneyBeat, moneyBeatOpenHat, quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import { openingDrills } from './openings.ts'

describe('openingDrills', () => {
  it('moneyBeat: 3 cumulative steps, open ticks growing from [1680] to [720,1680] to [240,720,1200,1680]', () => {
    const groove = moneyBeat()
    const drills = openingDrills(groove)
    expect(drills).toHaveLength(3)

    function openTicksOf(score: GrooveScore): number[] {
      return score.notes.filter((n) => n.pad === 'hhOpen').map((n) => n.tick).sort((a, b) => a - b)
    }

    expect(openTicksOf(drills[0]!.score)).toEqual([1680])
    expect(openTicksOf(drills[1]!.score)).toEqual([720, 1680])
    expect(openTicksOf(drills[2]!.score)).toEqual([240, 720, 1200, 1680])

    for (const drill of drills) {
      // note count preserved: 8 hats + 2 kicks + 2 snares
      expect(drill.score.notes).toHaveLength(12)
      const hatTicks = drill.score.notes
        .filter((n) => n.pad === 'hhClosed' || n.pad === 'hhOpen')
        .map((n) => n.tick)
        .sort((a, b) => a - b)
      expect(hatTicks).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680])
      expect(drill.score.notes.filter((n) => n.pad === 'kick').map((n) => n.tick)).toEqual([0, 960])
      expect(drill.score.notes.filter((n) => n.pad === 'snare').map((n) => n.tick)).toEqual([480, 1440])
      // every hat not in this step's open set is closed
      const openTicks = new Set(openTicksOf(drill.score))
      for (const note of drill.score.notes) {
        if (note.pad === 'hhClosed' || note.pad === 'hhOpen') {
          expect(note.pad === 'hhOpen').toBe(openTicks.has(note.tick))
        }
      }
    }

    expect(drills.map((d) => d.score.title)).toEqual([
      'Money Beat — open on the & of 4',
      'Money Beat — open on the & of 2 and 4',
      'Money Beat — open on every &',
    ])
    expect(new Set(drills.map((d) => d.score.id)).size).toBe(3)
  })

  it("moneyBeatOpenHat: step 1's open set is [1680], not duplicated", () => {
    const drills = openingDrills(moneyBeatOpenHat())
    const step1 = drills[0]!.score
    const openNotes = step1.notes.filter((n) => n.pad === 'hhOpen')
    expect(openNotes.map((n) => n.tick)).toEqual([1680])
    expect(step1.notes).toHaveLength(12)
  })

  it('quarterNoteRock: no hat sits on an &, so no drills', () => {
    expect(openingDrills(quarterNoteRock())).toEqual([])
  })

  it('a hat on the & of 4 only produces exactly 1 step (steps 2 and 3 dedupe away)', () => {
    const groove = makeGrooveScore({
      id: 'and-of-4-only',
      title: 'And Of Four Only',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 480 },
        { pad: 'hhClosed', tick: 1680, durationTicks: 240 },
        { pad: 'kick', tick: 0, durationTicks: 480 },
      ],
    })
    const drills = openingDrills(groove)
    expect(drills).toHaveLength(1)
    expect(drills[0]?.score.title).toBe('And Of Four Only — open on the & of 4')
    expect(drills[0]?.score.notes.filter((n) => n.pad === 'hhOpen').map((n) => n.tick)).toEqual([1680])
  })

  it('6/8: the & positions follow the eighth-note beat (beatLength 240, & = +120)', () => {
    const groove = makeGrooveScore({
      id: 'six-eight',
      title: 'Six Eight',
      measureCount: 1,
      timeSignature: { beats: 6, beatType: 8 },
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 120 },
        { pad: 'hhClosed', tick: 120, durationTicks: 120 },
        { pad: 'hhClosed', tick: 240, durationTicks: 120 },
        { pad: 'hhClosed', tick: 360, durationTicks: 120 },
        { pad: 'hhClosed', tick: 1320, durationTicks: 120 },
        { pad: 'kick', tick: 0, durationTicks: 240 },
      ],
    })
    // beats: 1..6 at ticks 0,240,480,720,960,1200; & = +120: 120,360,600,840,1080,1320
    // hats present on an & at 120 (& of 1), 360 (& of 2) and 1320 (& of 6, the last beat)
    const drills = openingDrills(groove)
    expect(drills.length).toBeGreaterThan(0)
    expect(drills[0]?.score.title).toBe('Six Eight — open on the & of 6')
    expect(drills[0]?.score.notes.filter((n) => n.pad === 'hhOpen').map((n) => n.tick)).toEqual([1320])
    const last = drills[drills.length - 1]!.score
    expect(last.notes.filter((n) => n.pad === 'hhOpen').map((n) => n.tick).sort((a, b) => a - b)).toEqual([
      120, 360, 1320,
    ])
  })

  it('a step whose open set exactly repeats the previous emitted step is skipped without renumbering', () => {
    // Only one beat (4) has a hat on its &, so step 2 (evens 2 and 4) and
    // step 3 (every &) both reduce to the same single-tick open set as step 1.
    const groove = makeGrooveScore({
      id: 'renumber-check',
      title: 'Renumber Check',
      measureCount: 1,
      notes: [{ pad: 'hhClosed', tick: 1680, durationTicks: 240 }],
    })
    const drills = openingDrills(groove)
    expect(drills.map((d) => d.score.id)).toEqual(['renumber-check-open-1'])
  })

  it('property: every emitted step preserves note count, opens exactly its own tick set, sets grow strictly, and no hhClosed note carries "open"', () => {
    const SIXTEENTH = 120
    const SIXTEENTHS_PER_BAR = 16

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 }),
        fc.array(fc.boolean(), { minLength: SIXTEENTHS_PER_BAR * 2, maxLength: SIXTEENTHS_PER_BAR * 2 }),
        (measureCount, hatFlags) => {
          const slots = measureCount * SIXTEENTHS_PER_BAR
          const notes = []
          for (let i = 0; i < slots; i++) {
            if (hatFlags[i] ?? false) {
              notes.push({ pad: 'hhClosed' as const, tick: i * SIXTEENTH, durationTicks: SIXTEENTH })
            }
          }
          if (notes.length === 0) return
          const groove = makeGrooveScore({
            id: 'prop',
            title: 'Prop',
            measureCount,
            notes,
          })
          const drills = openingDrills(groove)

          for (const drill of drills) {
            expect(drill.score.notes).toHaveLength(groove.notes.length)
            for (const note of drill.score.notes) {
              if (note.pad === 'hhClosed') expect(note.articulations.includes('open')).toBe(false)
            }
          }

          function openTicksOf(score: GrooveScore): Set<number> {
            return new Set(score.notes.filter((n) => n.pad === 'hhOpen').map((n) => n.tick))
          }

          for (let i = 0; i + 1 < drills.length; i++) {
            const here = openTicksOf(drills[i]!.score)
            const next = openTicksOf(drills[i + 1]!.score)
            expect(here.size).toBeLessThan(next.size)
            for (const t of here) expect(next.has(t)).toBe(true)
          }
        },
      ),
    )
  })
})
