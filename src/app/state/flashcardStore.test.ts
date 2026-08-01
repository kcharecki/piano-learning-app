/**
 * `flashcardStore` (roadmap 2.12) — state only, keyed by flashcard id.
 */
import type { Card } from '@core/srs/scheduler.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useFlashcardStore } from './flashcardStore.ts'

function resetStore(): void {
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(resetStore)

const CARD_A: Card = {
  id: 'staff-to-key-60',
  due: 100,
  intervalDays: 1,
  ease: 2.5,
  reps: 1,
  lapses: 0,
  introducedAt: 0,
}

describe('useFlashcardStore', () => {
  it('starts empty', () => {
    expect(useFlashcardStore.getState().cardsById).toEqual({})
  })

  it('upsertCard adds a new card by id', () => {
    useFlashcardStore.getState().upsertCard(CARD_A)
    expect(useFlashcardStore.getState().cardsById[CARD_A.id]).toEqual(CARD_A)
  })

  it('upsertCard replaces an existing card with the same id, leaving others untouched', () => {
    const other: Card = { ...CARD_A, id: 'staff-to-key-62' }
    useFlashcardStore.getState().upsertCard(CARD_A)
    useFlashcardStore.getState().upsertCard(other)

    const updated: Card = { ...CARD_A, reps: 2 }
    useFlashcardStore.getState().upsertCard(updated)

    expect(useFlashcardStore.getState().cardsById[CARD_A.id]).toEqual(updated)
    expect(useFlashcardStore.getState().cardsById[other.id]).toEqual(other)
  })

  // Kills a mutant that has `hydrate` merge into the existing map instead of
  // replacing it: this is a wholesale replace, used by `persistence.ts`'s
  // `restoreSession` to apply a previously-saved SRS state.
  it('hydrate replaces cardsById wholesale, not merge', () => {
    useFlashcardStore.getState().upsertCard(CARD_A)
    const other: Card = { ...CARD_A, id: 'staff-to-key-62' }

    useFlashcardStore.getState().hydrate({ [other.id]: other })

    expect(useFlashcardStore.getState().cardsById).toEqual({ [other.id]: other })
  })
})
