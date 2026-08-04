/**
 * `earTrainingStore` (roadmap 3.10) — state only: the shared `EarSessionState`
 * plus the generated-item cache `useEarTraining.ts` needs (see that module's
 * comment, and `earTrainingStore.ts`'s, for why the cache exists).
 */
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarAttempt } from '@core/eartraining/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import { ticks } from '@core/shared/units.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useEarTrainingStore, MAX_STORED_EAR_ATTEMPTS } from './earTrainingStore.ts'

function resetStore(): void {
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
}

afterEach(resetStore)

const CARD_A: Card = {
  id: 'interval-melodic:48:55:asc',
  due: 100,
  intervalDays: 1,
  ease: 2.5,
  reps: 1,
  lapses: 0,
  introducedAt: 0,
}

const ITEM_A: EarItem = {
  id: 'interval-melodic:48:55:asc',
  kind: 'interval-melodic',
  prompt: {
    id: 'interval-melodic:48:55:asc',
    meta: { title: '', composer: '' },
    measures: [],
    notes: [],
    tempos: [],
    staves: [],
    maxNoteDurationTicks: ticks(0),
  },
  answerKey: 'P5',
  level: 1,
}

describe('useEarTrainingStore', () => {
  it('starts with an empty session and no cached items', () => {
    expect(useEarTrainingStore.getState().session).toEqual(emptyEarSession())
    expect(useEarTrainingStore.getState().itemsById).toEqual({})
  })

  it('setSession replaces the session wholesale', () => {
    const next = { ...emptyEarSession(), cards: [CARD_A] }
    useEarTrainingStore.getState().setSession(next)
    expect(useEarTrainingStore.getState().session).toEqual(next)
  })

  it('rememberItem adds an item by id, leaving others untouched', () => {
    const other: EarItem = { ...ITEM_A, id: 'other-id' }
    useEarTrainingStore.getState().rememberItem(ITEM_A)
    useEarTrainingStore.getState().rememberItem(other)

    expect(useEarTrainingStore.getState().itemsById[ITEM_A.id]).toEqual(ITEM_A)
    expect(useEarTrainingStore.getState().itemsById[other.id]).toEqual(other)
  })

  it('pruneItems drops ids not in the keep list, leaving the rest untouched', () => {
    const other: EarItem = { ...ITEM_A, id: 'other-id' }
    useEarTrainingStore.getState().rememberItem(ITEM_A)
    useEarTrainingStore.getState().rememberItem(other)

    useEarTrainingStore.getState().pruneItems([other.id])

    expect(useEarTrainingStore.getState().itemsById).toEqual({ [other.id]: other })
  })

  describe('hydrate', () => {
    it('replaces session AND itemsById wholesale, in one call', () => {
      // Kills a mutant that hydrates only `session` (or only `itemsById`) —
      // both must come from the SAME call, matching sightReadingStore/
      // flashcardStore's own hydrate contract.
      const session = { ...emptyEarSession(), cards: [CARD_A], kinds: { [CARD_A.id]: ITEM_A.kind } }
      useEarTrainingStore.getState().hydrate(session, { [ITEM_A.id]: ITEM_A })

      expect(useEarTrainingStore.getState().session).toEqual(session)
      expect(useEarTrainingStore.getState().itemsById).toEqual({ [ITEM_A.id]: ITEM_A })
    })

    it('discards whatever was there before — replace, not merge', () => {
      // Kills a mutant that merges (spreads over existing state) instead of
      // replacing: a stale item from before a hydrate must not survive it.
      const stale: EarItem = { ...ITEM_A, id: 'stale-id' }
      useEarTrainingStore.getState().rememberItem(stale)

      useEarTrainingStore.getState().hydrate(emptyEarSession(), { [ITEM_A.id]: ITEM_A })

      expect(useEarTrainingStore.getState().itemsById).toEqual({ [ITEM_A.id]: ITEM_A })
      expect(useEarTrainingStore.getState().itemsById['stale-id']).toBeUndefined()
    })

    it('caps attempts at MAX_STORED_EAR_ATTEMPTS, keeping the most recent and dropping the oldest', () => {
      // Chronological (oldest first, matching recordEarAttempt's append order):
      // `at` runs 0..MAX_STORED_EAR_ATTEMPTS+4, so "most recent" means the
      // highest `at` values survive and the lowest are dropped.
      const attempts: EarAttempt[] = Array.from(
        { length: MAX_STORED_EAR_ATTEMPTS + 5 },
        (_, i): EarAttempt => ({ itemId: ITEM_A.id, kind: ITEM_A.kind, correct: true, at: i, level: 1 }),
      )
      const session = { ...emptyEarSession(), attempts }

      useEarTrainingStore.getState().hydrate(session, {})

      const stored = useEarTrainingStore.getState().session.attempts
      expect(stored).toHaveLength(MAX_STORED_EAR_ATTEMPTS)
      expect(stored[0]?.at).toBe(5)
      expect(stored[stored.length - 1]?.at).toBe(MAX_STORED_EAR_ATTEMPTS + 4)
    })

    it('leaves everything else on session untouched when capping attempts', () => {
      const session = { ...emptyEarSession(), cards: [CARD_A], kinds: { [CARD_A.id]: ITEM_A.kind } }

      useEarTrainingStore.getState().hydrate(session, {})

      expect(useEarTrainingStore.getState().session.cards).toEqual([CARD_A])
      expect(useEarTrainingStore.getState().session.kinds).toEqual({ [CARD_A.id]: ITEM_A.kind })
    })
  })
})
