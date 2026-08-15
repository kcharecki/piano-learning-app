import { describe, expect, it } from 'vitest'
import { MAPPED_PADS } from '../pad.ts'
import { instrumentIdFor, padByGmNote, padByInstrumentName, padInstrumentName, usedPads } from './instrument.ts'

describe('usedPads', () => {
  it('returns pads present in the notes, in canonical MAPPED_PADS order', () => {
    const score = { notes: [{ pad: 'hhClosed' as const }, { pad: 'kick' as const }, { pad: 'kick' as const }] }
    expect(usedPads(score)).toEqual(['kick', 'hhClosed'])
  })

  it('returns an empty list for a score with no notes', () => {
    expect(usedPads({ notes: [] })).toEqual([])
  })
})

describe('instrumentIdFor', () => {
  it('is 1-based P1-IN', () => {
    expect(instrumentIdFor(0)).toBe('P1-I1')
    expect(instrumentIdFor(4)).toBe('P1-I5')
  })
})

describe('padByGmNote (foreign-file fallback)', () => {
  it('resolves an unambiguous GM note', () => {
    expect(padByGmNote(36)).toBe('kick') // GM kick
    expect(padByGmNote(37)).toBe('crossStick') // GM side stick
  })

  it('on a GM collision (snare/snareRim both 38), the canonical-order pad wins', () => {
    expect(padByGmNote(38)).toBe('snare')
  })

  it('returns undefined for a GM note no pad uses', () => {
    expect(padByGmNote(1)).toBeUndefined()
  })
})

describe('padInstrumentName / padByInstrumentName', () => {
  it('round-trips every mapped pad through its instrument name', () => {
    for (const pad of MAPPED_PADS) {
      expect(padByInstrumentName(padInstrumentName(pad))).toBe(pad)
    }
  })
})
