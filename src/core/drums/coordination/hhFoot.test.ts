import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeGrooveScore, type GrooveScore } from '@core/drums/model/groove.ts'
import { moneyBeat, moneyBeatOpenHat, referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { hhFootDrills } from './hhFoot.ts'

/** A groove with no hats at all — already ride-based, plus a kick and a snare. */
function rideBasedGroove(): GrooveScore {
  return makeGrooveScore({
    id: 'ride-based',
    title: 'Ride Based',
    measureCount: 1,
    notes: [
      { pad: 'rideBow', tick: 0, durationTicks: 240 },
      { pad: 'rideBow', tick: 240, durationTicks: 240 },
      { pad: 'kick', tick: 0, durationTicks: 480 },
      { pad: 'snare', tick: 480, durationTicks: 480 },
    ],
  })
}

describe('hhFootDrills', () => {
  it('moneyBeat: 3 steps; step 1 is ride notes at the hat ticks plus 2 pedal notes and nothing else', () => {
    const groove = moneyBeat()
    const drills = hhFootDrills(groove)
    expect(drills).toHaveLength(3)

    const step1 = drills[0]?.score
    expect(step1?.notes).toHaveLength(10)
    expect(step1?.notes.every((n) => n.pad === 'rideBow' || n.pad === 'hhPedal')).toBe(true)
    expect(step1?.notes.filter((n) => n.pad === 'rideBow').map((n) => n.tick)).toEqual([
      0, 240, 480, 720, 960, 1200, 1440, 1680,
    ])
    expect(step1?.notes.filter((n) => n.pad === 'hhPedal').map((n) => n.tick)).toEqual([480, 1440])

    const step2 = drills[1]?.score
    expect(step2?.notes.filter((n) => n.pad === 'kick').map((n) => n.tick)).toEqual([0, 960])
    expect(step2?.notes).toHaveLength(12)

    const step3 = drills[2]?.score
    expect(new Set(step3?.notes.map((n) => n.pad))).toEqual(
      new Set(['rideBow', 'hhPedal', 'kick', 'snare']),
    )
    expect(step3?.notes).toHaveLength(14)

    for (const drill of drills) {
      expect(drill.score.notes.some((n) => n.pad === 'hhClosed' || n.pad === 'hhOpen')).toBe(false)
    }

    expect(drills.map((d) => d.score.title)).toEqual([
      'Money Beat — ride and foot on 2 and 4',
      'Money Beat — add the kick',
      'Money Beat — add the snare',
    ])
    expect(new Set(drills.map((d) => d.score.id)).size).toBe(3)
  })

  it('moneyBeatOpenHat: the open hat becomes a plain ride note with no articulations', () => {
    const drills = hhFootDrills(moneyBeatOpenHat())
    const step1 = drills[0]?.score
    expect(step1?.notes.some((n) => n.pad === 'hhOpen')).toBe(false)
    const rideAtOpenTick = step1?.notes.find((n) => n.tick === 1680 && n.pad === 'rideBow')
    expect(rideAtOpenTick).toBeDefined()
    expect(rideAtOpenTick?.articulations).toEqual([])
  })

  it('a ride and a hat on the same tick collapse to one ride note after the swap', () => {
    const groove = makeGrooveScore({
      id: 'ride-and-hat',
      title: 'Ride And Hat',
      measureCount: 1,
      notes: [
        { pad: 'rideBow', tick: 0, durationTicks: 480 },
        { pad: 'hhClosed', tick: 0, durationTicks: 480 },
        { pad: 'hhClosed', tick: 960, durationTicks: 480 },
      ],
    })
    const [step1] = hhFootDrills(groove)
    expect(step1?.score.notes.filter((n) => n.pad === 'rideBow').map((n) => n.tick)).toEqual([0, 960])
  })

  it('6/8: the pedal lands on eighth-note beats 2, 4 and 6, not on a quarter grid', () => {
    const groove = makeGrooveScore({
      id: 'six-eight',
      title: 'Six Eight',
      measureCount: 1,
      timeSignature: { beats: 6, beatType: 8 },
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 240 },
        { pad: 'kick', tick: 0, durationTicks: 720 },
        { pad: 'snare', tick: 720, durationTicks: 720 },
      ],
    })
    const step1 = hhFootDrills(groove)[0]?.score
    expect(step1?.notes.filter((n) => n.pad === 'hhPedal').map((n) => n.tick)).toEqual([240, 720, 1200])
    expect(step1?.notes.filter((n) => n.pad === 'hhPedal').every((n) => n.durationTicks === 240)).toBe(true)
  })

  it('a groove with no hats at all skips the swap but still gets the pedal notes', () => {
    const drills = hhFootDrills(rideBasedGroove())
    expect(drills).toHaveLength(3)
    const step1 = drills[0]?.score
    expect(step1?.notes.filter((n) => n.pad === 'rideBow').map((n) => n.tick)).toEqual([0, 240])
    expect(step1?.notes.filter((n) => n.pad === 'hhPedal').map((n) => n.tick)).toEqual([480, 1440])
  })

  it('skips the "add the kick" step (without renumbering) when the groove has no kick notes', () => {
    const groove = moneyBeat()
    const noKick: GrooveScore = { ...groove, notes: groove.notes.filter((n) => n.pad !== 'kick') }
    const drills = hhFootDrills(noKick)
    expect(drills).toHaveLength(2)
    expect(drills.map((d) => d.score.title)).toEqual([
      'Money Beat — ride and foot on 2 and 4',
      'Money Beat — add the snare',
    ])
  })

  it('skips the "add the snare" step when the groove has no snare-family notes', () => {
    const groove = moneyBeat()
    const noSnare: GrooveScore = { ...groove, notes: groove.notes.filter((n) => n.pad !== 'snare') }
    const drills = hhFootDrills(noSnare)
    expect(drills).toHaveLength(2)
    expect(drills.map((d) => d.score.title)).toEqual([
      'Money Beat — ride and foot on 2 and 4',
      'Money Beat — add the kick',
    ])
  })

  it('property: every step is cumulative, no step carries a closed/open hi-hat, and every measure has one pedal per even beat', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves()),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
        (groove, keepFlags) => {
          const reduced: GrooveScore = {
            ...groove,
            notes: groove.notes.filter((_, i) => keepFlags[i] ?? true),
          }
          const drills = hhFootDrills(reduced)

          // No step ever carries a hand hi-hat note.
          for (const drill of drills) {
            expect(drill.score.notes.some((n) => n.pad === 'hhClosed' || n.pad === 'hhOpen')).toBe(
              false,
            )
          }

          // Every step's notes are a subset of the next step's (by id, which
          // `makeGrooveScore` derives purely from measureIndex/pad/tick, so a
          // note carried forward unchanged keeps the same id across steps).
          for (let i = 0; i + 1 < drills.length; i++) {
            const idsHere = new Set(drills[i]?.score.notes.map((n) => n.id))
            const idsNext = new Set(drills[i + 1]?.score.notes.map((n) => n.id))
            for (const id of idsHere) expect(idsNext.has(id)).toBe(true)
          }

          // Every measure of every step (all 4/4 reference grooves) has
          // exactly one hhPedal on each even beat (2 and 4): ticks 480/1440.
          for (const drill of drills) {
            for (const measure of drill.score.measures) {
              const pedalTicksInMeasure = drill.score.notes
                .filter((n) => n.pad === 'hhPedal' && n.measureIndex === measure.index)
                .map((n) => n.tick - measure.startTick)
              expect(pedalTicksInMeasure).toEqual([480, 1440])
            }
          }

          // Every step's title carries the groove's own title.
          for (const drill of drills) expect(drill.score.title.startsWith(groove.title)).toBe(true)
        },
      ),
    )
  })
})
