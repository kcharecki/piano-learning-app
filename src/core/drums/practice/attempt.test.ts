import { describe, expect, it } from 'vitest'
import type { DrumsGrooveAttempt } from './attempt.ts'

/**
 * `attempt.ts` is types only, so this file's job is to pin the one invariant
 * that type carries and that nothing else can enforce: the required surface
 * is the five identity fields, and everything else is optional (T.17.5). If a
 * later slice makes an added field required, the first assignment below stops
 * compiling — which is the point. `persistence.ts` drops a whole slice whose
 * validator says no, so a record written before that field existed would take
 * the learner's entire history with it.
 */
describe('DrumsGrooveAttempt', () => {
  it('is constructible from the five identity fields alone', () => {
    const minimal: DrumsGrooveAttempt = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bpm: 80,
      at: 1_700_000_000_000,
      steady: true,
    }
    expect(minimal.pads).toBeUndefined()
    expect(minimal.grooveTitle).toBe('Money Beat')
  })

  it('carries per-pad detail when the run produced any', () => {
    const full: DrumsGrooveAttempt = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bpm: 80,
      at: 1_700_000_000_000,
      steady: false,
      pads: [
        { pad: 'hhClosed', expected: 16, matched: 16, meanOffsetMs: 12 },
        { pad: 'snare', expected: 4, matched: 0 },
      ],
    }
    expect(full.pads).toHaveLength(2)
    expect(full.pads?.[1]?.meanOffsetMs).toBeUndefined()
  })
})
