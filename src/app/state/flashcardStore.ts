/**
 * Flashcard drill state (roadmap 2.12, REQ-3.4.5): the SRS `Card` for every
 * flashcard the learner has ever seen, keyed by the flashcard's own `id`.
 *
 * STATE ONLY, matching `scoreStore.ts`'s rule: grading (`gradeAnswer`) and
 * scheduling (`review`, both `core/srs/scheduler.ts` /
 * `core/drills/flashcards.ts`) happen in `useFlashcardDrill.ts`, which reads
 * `cards` and writes the result back through `upsertCard`. Flashcard ids are
 * namespaced by kind (`note-name-64`, `staff-to-key-64`, ...), so one flat map
 * safely holds every kind and level without collision.
 */
import type { Card } from '@core/srs/scheduler.ts'
import { create } from 'zustand'

export type FlashcardStoreState = {
  readonly cardsById: Readonly<Record<string, Card>>
}

export type FlashcardStoreActions = {
  upsertCard(card: Card): void
}

export type FlashcardStore = FlashcardStoreState & FlashcardStoreActions

export const useFlashcardStore = create<FlashcardStore>((set) => ({
  cardsById: {},

  upsertCard: (card) => set((state) => ({ cardsById: { ...state.cardsById, [card.id]: card } })),
}))
