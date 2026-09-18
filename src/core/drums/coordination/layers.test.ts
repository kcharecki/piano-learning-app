import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeGrooveScore, type GrooveScore } from '@core/drums/model/groove.ts'
import { moneyBeat, moneyBeatOpenHat, quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import { layerGroupOf, layerStack } from './layers.ts'

describe('layerGroupOf', () => {
  it('groups cymbals', () => {
    for (const pad of [
      'hhClosed',
      'hhOpen',
      'rideBow',
      'rideBell',
      'rideEdge',
      'crash1',
      'crash2',
      'splash',
    ] as const) {
      expect(layerGroupOf(pad)).toBe('cymbals')
    }
  })

  it('groups feet', () => {
    expect(layerGroupOf('kick')).toBe('feet')
    expect(layerGroupOf('hhPedal')).toBe('feet')
  })

  it('groups snare-family', () => {
    for (const pad of [
      'snare',
      'snareRim',
      'crossStick',
      'tomHigh',
      'tomMid',
      'tomFloor',
    ] as const) {
      expect(layerGroupOf(pad)).toBe('snare')
    }
  })
})

describe('layerStack', () => {
  it('returns [] for a score with no notes', () => {
    const empty = makeGrooveScore({ id: 'empty', measureCount: 1, notes: [] })
    expect(layerStack(empty)).toEqual([])
  })

  it('builds three cumulative layers for a groove that uses all three groups', () => {
    const groove = moneyBeat()
    const stack = layerStack(groove)
    expect(stack).toHaveLength(3)
    expect(stack.map((l) => l.group)).toEqual(['cymbals', 'feet', 'snare'])
  })

  it('skips a group with no notes: a hats+kick-only groove yields two layers', () => {
    const hatsAndKick = makeGrooveScore({
      id: 'hats-kick',
      title: 'Hats and Kick',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 240 },
        { pad: 'hhClosed', tick: 240, durationTicks: 240 },
        { pad: 'kick', tick: 0, durationTicks: 480 },
      ],
    })
    const stack = layerStack(hatsAndKick)
    expect(stack).toHaveLength(2)
    expect(stack.map((l) => l.group)).toEqual(['cymbals', 'feet'])
    expect(stack.every((l) => l.count === 2)).toBe(true)
  })

  it('gives every layer id/title/label the documented shape', () => {
    const groove = moneyBeat()
    const stack = layerStack(groove)
    expect(stack).toHaveLength(3)
    expect(stack[0]?.score.id).toBe(`${groove.id}/layer-1`)
    expect(stack[0]?.score.title).toBe(`${groove.title} — layer 1 of 3: cymbals`)
    expect(stack[1]?.score.id).toBe(`${groove.id}/layer-2`)
    expect(stack[1]?.score.title).toBe(`${groove.title} — layer 2 of 3: cymbals + feet`)
    expect(stack[2]?.score.id).toBe(`${groove.id}/layer-3`)
    expect(stack[2]?.score.title).toBe(`${groove.title} — layer 3 of 3: cymbals + feet + snare`)
  })

  it('preserves timeSignature, swing and measures on every layer', () => {
    const groove = moneyBeat()
    for (const layer of layerStack(groove)) {
      expect(layer.score.timeSignature).toEqual(groove.timeSignature)
      expect(layer.score.swingPercent).toBe(groove.swingPercent)
      expect(layer.score.swingUnit).toBe(groove.swingUnit)
      expect(layer.score.measures).toEqual(groove.measures)
    }
  })

  it('leaves note identity untouched: ids, ticks, voices, dynamics carry over unchanged', () => {
    const groove = moneyBeat()
    const stack = layerStack(groove)
    const lastLayer = stack[stack.length - 1]
    expect(lastLayer?.score.notes).toEqual(groove.notes)
  })

  const grooveFixtures: readonly (() => GrooveScore)[] = [
    quarterNoteRock,
    moneyBeat,
    moneyBeatOpenHat,
  ]

  it('property: last layer equals the full note set, in order; every earlier layer is a subset; counts agree', () => {
    for (const makeGroove of grooveFixtures) {
      const groove = makeGroove()
      const stack = layerStack(groove)
      expect(stack.length).toBeGreaterThan(0)

      const last = stack[stack.length - 1]
      expect(last?.score.notes).toEqual(groove.notes)

      for (const layer of stack) {
        expect(layer.count).toBe(stack.length)
      }

      for (let i = 1; i < stack.length; i++) {
        const prevIds = new Set(stack[i - 1]?.score.notes.map((n) => n.id))
        const currIds = new Set(stack[i]?.score.notes.map((n) => n.id))
        for (const id of prevIds) expect(currIds.has(id)).toBe(true)
      }

      const allIds = stack.map((l) => l.score.id)
      expect(new Set(allIds).size).toBe(allIds.length)
    }
  })

  it('property: an arbitrary subset of a bundled groove chosen as notes still layers into a valid cumulative stack', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...grooveFixtures),
        // Fixed-length mask, at least as long as the largest fixture's note
        // list, so every note index has a defined keep/drop flag.
        fc.array(fc.boolean(), { minLength: 32, maxLength: 32 }),
        (makeGroove, keepMask) => {
          const groove = makeGroove()
          const notes = groove.notes.filter((_, i) => keepMask[i] === true)
          const subsetScore: GrooveScore = { ...groove, notes }
          const stack = layerStack(subsetScore)
          if (subsetScore.notes.length === 0) {
            expect(stack).toEqual([])
            return
          }
          const last = stack[stack.length - 1]
          expect(last?.score.notes).toEqual(subsetScore.notes)
          for (const layer of stack) expect(layer.count).toBe(stack.length)
        },
      ),
    )
  })
})
