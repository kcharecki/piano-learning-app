import { beforeEach, describe, expect, it } from 'vitest'
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import {
  lastAttempt,
  MAX_STORED_DRUMS_ATTEMPTS,
  useDrumsHistoryStore,
} from './drumsHistoryStore.ts'

function attempt(overrides: Partial<DrumsGrooveAttempt> = {}): DrumsGrooveAttempt {
  return {
    grooveId: 'money-beat',
    grooveTitle: 'Money Beat',
    bpm: 80,
    at: 1_700_000_000_000,
    steady: true,
    ...overrides,
  }
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

describe('useDrumsHistoryStore', () => {
  it('starts empty', () => {
    expect(useDrumsHistoryStore.getState().attempts).toEqual([])
  })

  it('keeps the newest run first, which is the order the screen reads', () => {
    const first = attempt({ at: 1 })
    const second = attempt({ at: 2, grooveId: 'quarter-note-rock' })
    useDrumsHistoryStore.getState().addAttempt(first)
    useDrumsHistoryStore.getState().addAttempt(second)
    expect(useDrumsHistoryStore.getState().attempts).toEqual([second, first])
  })

  /** This store is written to disk on every change; an uncapped history grows the blob without bound. */
  it('drops the oldest run past the cap', () => {
    for (let i = 0; i <= MAX_STORED_DRUMS_ATTEMPTS; i++) {
      useDrumsHistoryStore.getState().addAttempt(attempt({ at: i }))
    }
    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(MAX_STORED_DRUMS_ATTEMPTS)
    expect(attempts[0]?.at).toBe(MAX_STORED_DRUMS_ATTEMPTS)
    expect(attempts.some((a) => a.at === 0)).toBe(false)
  })

  it('hydrate replaces the whole collection', () => {
    useDrumsHistoryStore.getState().addAttempt(attempt({ at: 1 }))
    const restored = attempt({ at: 9 })
    useDrumsHistoryStore.getState().hydrate({ attempts: [restored] })
    expect(useDrumsHistoryStore.getState().attempts).toEqual([restored])
  })
})

describe('lastAttempt', () => {
  const money = attempt({ at: 2 })
  const rock = attempt({ at: 1, grooveId: 'quarter-note-rock', grooveTitle: 'Quarter-Note Rock' })

  /**
   * Unfiltered is what the screen shows: a learner who comes back sees the run
   * they actually last played, not whatever the picker happens to be sitting
   * on after a reload.
   */
  it('returns the most recent run of any groove when no id is given', () => {
    expect(lastAttempt([money, rock])).toBe(money)
  })

  it('returns the most recent run of one groove when an id is given', () => {
    expect(lastAttempt([money, rock], 'quarter-note-rock')).toBe(rock)
    expect(lastAttempt([money, rock], 'money-beat-open-hat')).toBeUndefined()
  })

  it('returns undefined for an empty history', () => {
    expect(lastAttempt([])).toBeUndefined()
    expect(lastAttempt([], 'money-beat')).toBeUndefined()
  })
})
