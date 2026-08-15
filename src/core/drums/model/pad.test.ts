import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  gmNoteOf,
  instrumentNameOf,
  isDrumPad,
  limbOf,
  MAPPED_PADS,
  padByInstrumentName,
  padOrderIndex,
  PADS,
  staffPositionOf,
  voiceOf,
} from './pad.ts'

const mappedPad = fc.constantFrom(...MAPPED_PADS)

describe('PADS/MAPPED_PADS', () => {
  it('has 16 mapped pads plus unmapped', () => {
    expect(MAPPED_PADS).toHaveLength(16)
    expect(PADS).toHaveLength(17)
    expect(PADS).toContain('unmapped')
  })

  it('has no duplicate pads', () => {
    expect(new Set(PADS).size).toBe(PADS.length)
  })

  it('isDrumPad accepts every pad and rejects nonsense', () => {
    for (const pad of PADS) expect(isDrumPad(pad)).toBe(true)
    expect(isDrumPad('tambourine')).toBe(false)
    expect(isDrumPad('')).toBe(false)
  })

  it('padOrderIndex is a strict order matching PADS', () => {
    PADS.forEach((pad, i) => expect(padOrderIndex(pad)).toBe(i))
  })
})

describe('limbOf/voiceOf', () => {
  it('unmapped has no limb or voice', () => {
    expect(limbOf('unmapped')).toBeUndefined()
    expect(voiceOf('unmapped')).toBeUndefined()
  })

  it('only kick and hi-hat pedal are feet', () => {
    for (const pad of MAPPED_PADS) {
      const expectedFoot = pad === 'kick' || pad === 'hhPedal'
      expect(limbOf(pad)).toBe(expectedFoot ? 'foot' : 'hand')
      expect(voiceOf(pad)).toBe(expectedFoot ? 'feet' : 'hands')
    }
  })

  it('property: voiceOf is derived from limbOf for every mapped pad', () => {
    fc.assert(
      fc.property(mappedPad, (pad) => {
        const limb = limbOf(pad)
        const voice = voiceOf(pad)
        expect(voice).toBe(limb === 'foot' ? 'feet' : 'hands')
      }),
    )
  })
})

describe('staffPositionOf', () => {
  it('unmapped has no staff position', () => {
    expect(staffPositionOf('unmapped')).toBeUndefined()
  })

  it('every mapped pad has a staff position', () => {
    for (const pad of MAPPED_PADS) expect(staffPositionOf(pad)).toBeDefined()
  })
})

describe('gmNoteOf', () => {
  it('unmapped has no GM note', () => {
    expect(gmNoteOf('unmapped')).toBeUndefined()
  })

  it('every mapped pad has a valid GM note 0..127', () => {
    for (const pad of MAPPED_PADS) {
      const note = gmNoteOf(pad)
      expect(note).toBeDefined()
      expect(Number.isInteger(note)).toBe(true)
      expect(note).toBeGreaterThanOrEqual(0)
      expect(note).toBeLessThanOrEqual(127)
    }
  })
})

describe('instrumentNameOf / padByInstrumentName', () => {
  it('unmapped has no instrument name', () => {
    expect(instrumentNameOf('unmapped')).toBeUndefined()
  })

  it('every mapped pad has a unique instrument name', () => {
    const names = MAPPED_PADS.map((pad) => instrumentNameOf(pad))
    expect(new Set(names).size).toBe(MAPPED_PADS.length)
  })

  it('an unknown name resolves to undefined', () => {
    expect(padByInstrumentName('Cowbell')).toBeUndefined()
  })

  it('property: padByInstrumentName(instrumentNameOf(pad)) round-trips for every mapped pad', () => {
    fc.assert(
      fc.property(mappedPad, (pad) => {
        const name = instrumentNameOf(pad)
        expect(name).toBeDefined()
        expect(padByInstrumentName(name as string)).toBe(pad)
      }),
    )
  })
})
