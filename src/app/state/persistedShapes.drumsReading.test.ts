/**
 * `isValidDrumsReading` (roadmap DR-11 review, Minor c) — the rhythm reading
 * trainer's persisted blob. Kept in its own file rather than added to
 * `persistedShapes.test.ts` because that file, like `persistedShapes.ts`
 * itself, is main-thread-owned while this slice is in flight; this is a new
 * file, not an edit to one already claimed.
 */
import { describe, expect, it } from 'vitest'
import { isValidDrumsReading } from '@app/state/persistedShapes.ts'

describe('isValidDrumsReading', () => {
  it('accepts a well-formed blob', () => {
    expect(
      isValidDrumsReading({
        level: 3,
        runs: [
          { level: 3, accuracy: 0.8 },
          { level: 2, accuracy: 1 },
        ],
      }),
    ).toBe(true)
  })

  it('rejects a level outside 1..7', () => {
    expect(isValidDrumsReading({ level: 8, runs: [] })).toBe(false)
  })

  it('rejects a run whose accuracy is outside 0..1', () => {
    expect(isValidDrumsReading({ level: 3, runs: [{ level: 3, accuracy: 1.4 }] })).toBe(false)
  })
})
