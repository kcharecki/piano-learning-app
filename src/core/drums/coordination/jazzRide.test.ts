import { describe, expect, it } from 'vitest'
import { jazzRideDrills } from './jazzRide.ts'

const RIDE_TICKS = [0, 480, 720, 960, 1440, 1680]

describe('jazzRideDrills', () => {
  it('returns six drills with exact ids and titles, in order', () => {
    const drills = jazzRideDrills()
    expect(drills).toHaveLength(6)
    expect(drills.map((d) => d.score.id)).toEqual([
      'jazz-ride-1',
      'jazz-ride-2',
      'jazz-ride-3',
      'jazz-ride-4',
      'jazz-ride-5',
      'jazz-ride-6',
    ])
    expect(drills.map((d) => d.score.title)).toEqual([
      'Jazz ride — ride alone',
      'Jazz ride — ride and hi-hat foot',
      'Jazz ride — comp on the & of 2',
      'Jazz ride — comp on 4',
      'Jazz ride — comp on the & of 1 and the & of 3',
      'Jazz ride — comp on 2 and the & of 4',
    ])
  })

  it('every score is swung at 67% eighth', () => {
    for (const drill of jazzRideDrills()) {
      expect(drill.score.swingPercent).toBe(67)
      expect(drill.score.swingUnit).toBe('eighth')
    }
  })

  it('the ride pattern is identical in all six drills', () => {
    for (const drill of jazzRideDrills()) {
      const rideTicks = drill.score.notes.filter((n) => n.pad === 'rideBow').map((n) => n.tick as number)
      expect(rideTicks).toEqual(RIDE_TICKS)
    }
  })

  it('the hi-hat pedal is on 2 and 4 in steps 2-6, and absent in step 1 ("ride alone")', () => {
    const drills = jazzRideDrills()
    const pedalTicks = (i: number) =>
      (drills[i]?.score.notes ?? []).filter((n) => n.pad === 'hhPedal').map((n) => n.tick as number)
    expect(pedalTicks(0)).toEqual([])
    for (let i = 1; i < 6; i++) expect(pedalTicks(i)).toEqual([480, 1440])
  })

  it('each step carries exactly the one snare figure its title names, not the previous steps stacked', () => {
    const drills = jazzRideDrills()
    const snareTicks = (i: number) =>
      (drills[i]?.score.notes ?? []).filter((n) => n.pad === 'snare').map((n) => n.tick as number)
    expect(snareTicks(0)).toEqual([]) // ride alone
    expect(snareTicks(1)).toEqual([]) // ride and hi-hat foot
    expect(snareTicks(2)).toEqual([720]) // comp on the & of 2
    expect(snareTicks(3)).toEqual([1440]) // comp on 4
    expect(snareTicks(4)).toEqual([240, 1200]) // comp on the & of 1 and the & of 3
    expect(snareTicks(5)).toEqual([480, 1680]) // comp on 2 and the & of 4
  })

  it('makeGrooveScore does not throw for any of the six drills (already true, since jazzRideDrills built them)', () => {
    expect(() => jazzRideDrills()).not.toThrow()
    expect(jazzRideDrills()).toHaveLength(6)
  })
})
