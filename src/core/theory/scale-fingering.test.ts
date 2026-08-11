/**
 * `scaleFingering` is defined over pitch classes, `buildScale` over writable
 * keys, and the two domains genuinely differ: G## major has a fingering but no
 * spelling. That divergence is a deliberate decision rather than an oversight,
 * so it is pinned here — in its own file, next to the module, because
 * `scales.test.ts` covers the notation side.
 */
import { describe, expect, it } from 'vitest'
import { unwrap } from '@core/shared/result.ts'
import { at, InvariantError } from '@core/shared/invariant.ts'
import {
  type Alter,
  LETTERS,
  parsePitch,
  pitchName,
  spell,
  type SpelledPitch,
  spelledPitchClass,
} from './pitch.ts'
import { buildScale, scaleFingering } from './scales.ts'

const p = (text: string): SpelledPitch => unwrap(parsePitch(text))

/** Every letter with every accidental — 35 tonics, most of them theoretical. */
const ALL_TONICS: readonly SpelledPitch[] = LETTERS.flatMap((letter) =>
  ([-2, -1, 0, 1, 2] as readonly Alter[]).map((alter) => spell(letter, alter, 4)),
)

const unwritable = (tonic: SpelledPitch): boolean => {
  try {
    buildScale(tonic, 'major')
    return false
  } catch {
    return true
  }
}

describe('scaleFingering over pitch classes', () => {
  it('answers for G## major, which buildScale refuses', () => {
    // The hand plays the A major scale either way; only the staff objects.
    expect(() => buildScale(p('G##4'), 'major')).toThrow(InvariantError)
    expect(scaleFingering(p('G##4'), 'major')).toEqual(scaleFingering(p('A4'), 'major'))
    expect(scaleFingering(p('G##4'), 'major')).toEqual({
      rightHand: [1, 2, 3, 1, 2, 3, 4, 5],
      leftHand: [5, 4, 3, 2, 1, 3, 2, 1],
    })
  })

  it('answers for every tonic buildScale refuses, not just G##', () => {
    const refused = ALL_TONICS.filter(unwritable)
    expect(refused.map(pitchName)).toEqual(['D##4', 'E##4', 'Fbb4', 'G##4', 'A##4', 'B##4'])
    for (const tonic of refused) {
      // Whatever the staff thinks, the hand is on some writable key's notes.
      const writable = at(
        ALL_TONICS.filter(
          (other) => !unwritable(other) && spelledPitchClass(other) === spelledPitchClass(tonic),
        ),
        0,
      )
      expect({ tonic: pitchName(tonic), fingering: scaleFingering(tonic, 'major') }).toEqual({
        tonic: pitchName(tonic),
        fingering: scaleFingering(writable, 'major'),
      })
    }
  })

  it('answers the minor forms over pitch classes too', () => {
    // G## harmonic minor is as unwritable as G## major — its 7th would need
    // F###. The hand is on A harmonic minor either way.
    expect(() => buildScale(p('G##4'), 'harmonicMinor')).toThrow(InvariantError)
    expect(scaleFingering(p('G##4'), 'harmonicMinor')).toEqual(
      scaleFingering(p('A4'), 'harmonicMinor'),
    )
    expect(scaleFingering(p('G##4'), 'melodicMinor')).toEqual({
      rightHand: [1, 2, 3, 1, 2, 3, 4, 5],
      leftHand: [5, 4, 3, 2, 1, 3, 2, 1],
    })
  })

  it('still returns null for the scale types it has no fingering for', () => {
    expect(scaleFingering(p('G##4'), 'dorian')).toBeNull()
    expect(scaleFingering(p('G##4'), 'aeolian')).toBeNull()
    expect(scaleFingering(p('G##4'), 'blues')).toBeNull()
  })
})
