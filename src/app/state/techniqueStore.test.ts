/**
 * techniqueStore (roadmap 4.4a, REQ-3.7.2/3.7.3) — a plain state container,
 * tested the same way `progressStore.test.ts` tests its own collections:
 * prepend, cap, and a passthrough `hydrate`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import { MAX_STORED_TECHNIQUE_ATTEMPTS, useTechniqueStore } from './techniqueStore.ts'

function resetStore(): void {
  useTechniqueStore.setState({ attempts: [] })
}

afterEach(resetStore)

function attemptAt(at: number, drillId = 'drill-a'): TechniqueAttempt {
  return { drillId, at, bpm: 80, evenness: 1, accuracy: 1, clean: true }
}

describe('techniqueStore', () => {
  it('prepends new attempts, newest first', () => {
    useTechniqueStore.getState().addAttempt(attemptAt(1))
    useTechniqueStore.getState().addAttempt(attemptAt(2))

    expect(useTechniqueStore.getState().attempts.map((a) => a.at)).toEqual([2, 1])
  })

  it('caps the collection at MAX_STORED_TECHNIQUE_ATTEMPTS, dropping the oldest', () => {
    for (let i = 0; i < MAX_STORED_TECHNIQUE_ATTEMPTS + 5; i++) {
      useTechniqueStore.getState().addAttempt(attemptAt(i))
    }

    const attempts = useTechniqueStore.getState().attempts
    expect(attempts).toHaveLength(MAX_STORED_TECHNIQUE_ATTEMPTS)
    // Newest first: the most recently added is at the front, and the cap
    // dropped the OLDEST entries, not the newest.
    expect(attempts[0]?.at).toBe(MAX_STORED_TECHNIQUE_ATTEMPTS + 4)
    expect(attempts[attempts.length - 1]?.at).toBe(5)
  })

  it('hydrate replaces the collection wholesale', () => {
    useTechniqueStore.getState().addAttempt(attemptAt(1))

    useTechniqueStore.getState().hydrate({ attempts: [attemptAt(9)] })

    expect(useTechniqueStore.getState().attempts).toEqual([attemptAt(9)])
  })
})
