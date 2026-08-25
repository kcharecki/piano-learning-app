import { describe, expect, it } from 'vitest'
import { validateGrooveScore } from './groove.ts'
import {
  ghostFunkBar,
  moneyBeat,
  moneyBeatOpenHat,
  quarterNoteRock,
  referenceGrooves,
} from './referenceGrooves.ts'

/**
 * Domain-level facts about the three bundled example grooves — distinct from
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

  describe('quarterNoteRock', () => {
    it('is the money beat with the hi-hat halved: one closed hat per beat', () => {
      const score = quarterNoteRock()
      expect(score.swingPercent).toBe(50)
      expect(score.notes.filter((n) => n.pad === 'hhClosed').map((n) => n.tick)).toEqual([
        0, 480, 960, 1440,
      ])
      expect(score.notes.filter((n) => n.pad === 'kick').map((n) => n.tick)).toEqual([0, 960])
      expect(score.notes.filter((n) => n.pad === 'snare').map((n) => n.tick)).toEqual([480, 1440])
      expect(score.notes).toHaveLength(8)
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
