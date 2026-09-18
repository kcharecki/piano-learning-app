/**
 * `isValidDrumsKitMap` (roadmap DR-02): pins the strict/full validator —
 * every `learned.notes` entry checked, name and integer-string keys
 * required. `persistence.drums.test.ts`'s "the kit-map preset slice" covers
 * the restore-side behaviour (a lenient gate plus a re-check inside
 * `apply`) that this validator's strictness makes possible; see that file
 * and `persistence.drums.ts`'s `hasValidPresetName` doc comment for why the
 * two are deliberately different.
 */
import { describe, expect, it } from 'vitest'
import { isValidDrumsKitMap } from './persistedShapes.drumsKitMap.ts'

describe('isValidDrumsKitMap', () => {
  it('accepts a well-formed preset name with no learned map (the old shape)', () => {
    expect(isValidDrumsKitMap({ presetName: 'Roland TD family' })).toBe(true)
  })

  it('accepts a well-formed learned map — pad and hiHat entries, integer-string keys', () => {
    expect(
      isValidDrumsKitMap({
        presetName: 'Learned kit',
        learned: { name: 'Learned kit', notes: { 36: { kind: 'pad', pad: 'kick' }, 42: { kind: 'hiHat' } } },
      }),
    ).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['presetName missing', {}],
    ['presetName not a string', { presetName: 42 }],
    ['learned.name missing', { presetName: 'x', learned: { notes: {} } }],
    ['learned.notes not an object', { presetName: 'x', learned: { name: 'x', notes: 'nope' } }],
    [
      'a learned entry with an unknown pad',
      { presetName: 'x', learned: { name: 'x', notes: { 36: { kind: 'pad', pad: 'cowbell' } } } },
    ],
    [
      'a learned entry with a bad kind',
      { presetName: 'x', learned: { name: 'x', notes: { 36: { kind: 'nope' } } } },
    ],
    [
      'a learned key that is not an integer string',
      { presetName: 'x', learned: { name: 'x', notes: { 'not-a-note': { kind: 'hiHat' } } } },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(isValidDrumsKitMap(payload)).toBe(false)
  })
})
