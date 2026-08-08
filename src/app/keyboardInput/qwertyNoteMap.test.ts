import { midi as asMidi } from '@core/shared/units.ts'
import { describe, expect, it } from 'vitest'
import { defaultBaseNote, noteForCode } from './qwertyNoteMap.ts'

describe('noteForCode', () => {
  it('maps the bottom row to an ascending white-key scale from the base note', () => {
    const base = asMidi(60)
    const codes = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
    const notes = codes.map((code) => noteForCode(code, base))
    expect(notes).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76])
  })

  it('maps the top row to the black keys sitting over their white-key gap', () => {
    const base = asMidi(60)
    expect(noteForCode('KeyW', base)).toBe(61) // over A-S (C-D)
    expect(noteForCode('KeyE', base)).toBe(63) // over S-D (D-E)
    expect(noteForCode('KeyT', base)).toBe(66) // over F-G (F-G)
    expect(noteForCode('KeyY', base)).toBe(68) // over G-H (G-A)
    expect(noteForCode('KeyU', base)).toBe(70) // over H-J (A-B)
    expect(noteForCode('KeyO', base)).toBe(73) // over K-L (C-D, +octave)
    expect(noteForCode('KeyP', base)).toBe(75) // over L-; (D-E, +octave)
  })

  it('has no key over the D-F (E-F) or J-K (B-C) gaps, matching a real keyboard', () => {
    // Physical keys that sit directly above D and J on a QWERTY board are R and I;
    // neither is in the map, because there is no black key there on a real piano.
    expect(noteForCode('KeyR', asMidi(60))).toBeUndefined()
    expect(noteForCode('KeyI', asMidi(60))).toBeUndefined()
  })

  it('is always baseNote + a fixed offset, regardless of baseNote', () => {
    expect(noteForCode('KeyA', asMidi(48))).toBe(48)
    expect(noteForCode('KeyA', asMidi(72))).toBe(72)
    expect(noteForCode('Semicolon', asMidi(48))).toBe(64)
  })

  it('returns undefined for a key outside the mapped set', () => {
    expect(noteForCode('KeyZ', asMidi(60))).toBeUndefined()
    expect(noteForCode('Digit1', asMidi(60))).toBeUndefined()
    expect(noteForCode('Space', asMidi(60))).toBeUndefined()
  })
})

describe('defaultBaseNote', () => {
  it('is always the range low, regardless of where middle C sits', () => {
    expect(defaultBaseNote(asMidi(48), asMidi(84))).toBe(48)
    expect(defaultBaseNote(asMidi(65), asMidi(90))).toBe(65)
    expect(defaultBaseNote(asMidi(30), asMidi(50))).toBe(30)
    expect(defaultBaseNote(asMidi(60), asMidi(60))).toBe(60)
  })

  it('puts a chord below middle C within reach — the bug a middle-C anchor had', () => {
    // The bundled sample's first beat: 48, 52, 55, 60. With `low` as the
    // anchor, all four are within the mapping's 0..16 span; anchored at 60,
    // three of them (48, 52, 55) would be unreachable no matter what was typed.
    const base = defaultBaseNote(asMidi(48), asMidi(84))
    for (const pitch of [48, 52, 55, 60]) {
      const reachable = Object.entries({
        KeyA: 0,
        KeyS: 2,
        KeyD: 4,
        KeyF: 5,
        KeyG: 7,
        KeyH: 9,
        KeyJ: 11,
        KeyK: 12,
      }).some(([, offset]) => base + offset === pitch)
      expect(reachable).toBe(true)
    }
  })
})
