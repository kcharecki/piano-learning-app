import { describe, expect, it } from 'vitest'
import { validateGrooveScore } from './groove.ts'
import {
  ghostFunkBar,
  moneyBeat,
  moneyBeatOpenHat,
  quarterHatRock,
  referenceGrooves,
} from './referenceGrooves.ts'

/**
 * Domain-level facts about the four bundled example grooves — distinct from
 * `musicxml/roundTrip.test.ts`, which proves they survive the MusicXML bridge
 * byte-stable. This file is these grooves' own co-located test (every module
 * in `src/core/**` needs one), and checks the musical content itself.
 */
describe('referenceGrooves', () => {
  it('has exactly four grooves, each with a distinct id and at least one note, all independently valid', () => {
    const grooves = referenceGrooves()
    expect(grooves).toHaveLength(4)
    expect(new Set(grooves.map((g) => g.id)).size).toBe(4)
    for (const g of grooves) {
      expect(g.notes.length).toBeGreaterThan(0)
      expect(validateGrooveScore(g).ok).toBe(true)
    }
  })

  it('returns the grooves easiest-first, in the exact ids order', () => {
    const grooves = referenceGrooves()
    expect(grooves.map((g) => g.id)).toEqual([
      'quarter-hat-rock',
      'money-beat',
      'money-beat-open-hat',
      'ghost-funk-bar',
    ])
  })

  it('the ordering is justified: note count is non-decreasing across the array', () => {
    const grooves = referenceGrooves()
    for (let i = 1; i < grooves.length; i++) {
      const prev = grooves[i - 1]
      const cur = grooves[i]
      expect(prev).toBeDefined()
      expect(cur).toBeDefined()
      expect(cur!.notes.length).toBeGreaterThanOrEqual(prev!.notes.length)
    }
  })

  it('every groove has a unique id and a unique title', () => {
    const grooves = referenceGrooves()
    expect(new Set(grooves.map((g) => g.id)).size).toBe(grooves.length)
    expect(new Set(grooves.map((g) => g.title)).size).toBe(grooves.length)
  })

  describe('quarterHatRock', () => {
    it('is one straight 4/4 bar: 4 closed hi-hats on the quarters, kick on 1 and 3, snare on 2 and 4', () => {
      const score = quarterHatRock()
      expect(score.swingPercent).toBe(50)
      expect(score.timeSignature).toEqual({ beats: 4, beatType: 4 })
      expect(score.notes.filter((n) => n.pad === 'hhClosed').map((n) => n.tick)).toEqual([
        0, 480, 960, 1440,
      ])
      expect(score.notes.filter((n) => n.pad === 'kick').map((n) => n.tick)).toEqual([0, 960])
      expect(score.notes.filter((n) => n.pad === 'snare').map((n) => n.tick)).toEqual([480, 1440])
      expect(score.notes).toHaveLength(8)
    })

    it('has a 480-tick hi-hat gap — a full quarter — the property that makes it the easiest groove here', () => {
      const hatTicks = quarterHatRock()
        .notes.filter((n) => n.pad === 'hhClosed')
        .map((n) => n.tick)
      const gaps = hatTicks.slice(1).map((tick, i) => tick - hatTicks[i]!)
      expect(gaps.every((gap) => gap === 480)).toBe(true)

      const moneyBeatHatTicks = moneyBeat()
        .notes.filter((n) => n.pad === 'hhClosed')
        .map((n) => n.tick)
      const moneyBeatGaps = moneyBeatHatTicks.slice(1).map((tick, i) => tick - moneyBeatHatTicks[i]!)
      expect(moneyBeatGaps.every((gap) => gap === 240)).toBe(true)
    })

    it('never stacks kick and snare on the same tick', () => {
      const score = quarterHatRock()
      const kickTicks = new Set(score.notes.filter((n) => n.pad === 'kick').map((n) => n.tick))
      const snareTicks = score.notes.filter((n) => n.pad === 'snare').map((n) => n.tick)
      for (const tick of snareTicks) expect(kickTicks.has(tick)).toBe(false)
    })
  })

  describe('moneyBeat', () => {
    it('is one straight 4/4 bar: 8 closed hi-hats, kick on 1 and 3, snare on 2 and 4', () => {
      const score = moneyBeat()
      expect(score.swingPercent).toBe(50)
      expect(score.timeSignature).toEqual({ beats: 4, beatType: 4 })
      expect(score.notes.filter((n) => n.pad === 'hhClosed')).toHaveLength(8)
      expect(score.notes.filter((n) => n.pad === 'kick').map((n) => n.tick)).toEqual([0, 960])
      expect(score.notes.filter((n) => n.pad === 'snare').map((n) => n.tick)).toEqual([480, 1440])
      expect(score.notes).toHaveLength(12)
    })
  })

  describe('moneyBeatOpenHat', () => {
    it('opens the last "and" of beat 4 instead of closed', () => {
      const score = moneyBeatOpenHat()
      expect(score.notes.filter((n) => n.pad === 'hhClosed')).toHaveLength(7)
      const openNote = score.notes.find((n) => n.pad === 'hhOpen')
      expect(openNote).toBeDefined()
      expect(openNote?.tick).toBe(1680)
      expect(openNote?.articulations).toEqual(['open'])
    })
  })

  describe('ghostFunkBar', () => {
    it('sits entirely on the sixteenth-note grid: 16 hi-hats, 4 kicks, 2 accented snares, 8 ghosted snares', () => {
      const score = ghostFunkBar()
      expect(score.notes.filter((n) => n.pad === 'hhClosed')).toHaveLength(16)
      expect(score.notes.filter((n) => n.pad === 'kick')).toHaveLength(4)
      expect(score.notes.filter((n) => n.pad === 'snare' && n.dynamics === 'accent')).toHaveLength(2)
      expect(score.notes.filter((n) => n.pad === 'snare' && n.dynamics === 'ghost')).toHaveLength(8)
      expect(score.notes.every((n) => n.tick % 120 === 0)).toBe(true)
    })
  })
})
