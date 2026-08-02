/**
 * `earTrainingStore` (roadmap 3.10) — state only: the shared `EarSessionState`
 * plus the generated-item cache `useEarTraining.ts` needs (see that module's
 * comment, and `earTrainingStore.ts`'s, for why the cache exists).
 */
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import type { Card } from '@core/srs/scheduler.ts'
import { ticks } from '@core/shared/units.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useEarTrainingStore } from './earTrainingStore.ts'

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
})
