/**
 * Ear-training session state (roadmap 3.10, REQ-3.6.1/3.6.2): the single
 * `EarSessionState` from `core/eartraining/session.ts` — per-kind levels, the
 * SRS cards, the id -> kind map and the attempt log — plus a cache of every
 * `EarItem` this session has ever generated.
 *
 * STATE ONLY, matching `flashcardStore.ts`'s rule: item generation, playback
 * and grading all happen in `useEarTraining.ts`, which reads this store and
 * writes the graded result back through `setSession`.
 *
 * ## Why `itemsById` exists
 *
 * `nextDueItemId` (session.ts) hands back only an item's *id* — it never
 * regenerates the item itself, and by design it cannot: `eartraining/chords.ts`
 * documents that a chord-quality/scale-mode item's id is an opaque handle with
 * no reverse parser, so "what to play again for this due card" is a question
 * only the originally generated `EarItem` can answer. That module's own doc
 * says the caller must persist the generated item, not regenerate it from id —
 * this store, and `itemsById` specifically, is where `useEarTraining.ts` does
 * exactly that.
 *
 * Persisting this store (session AND itemsById) through the `Store` port is
 * an explicit follow-up, not this task — no `hydrate`/`hydrateItems` action
 * exists yet because nothing outside this module's own tests would call it;
 * add it back alongside that follow-up, not before.
 */
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarSessionState } from '@core/eartraining/session.ts'
import { create } from 'zustand'

export type EarTrainingStoreState = {
  readonly session: EarSessionState
  /** Every `EarItem` ever generated this session, keyed by id — see the module comment. */
  readonly itemsById: Readonly<Record<string, EarItem>>
}

export type EarTrainingStoreActions = {
  setSession(session: EarSessionState): void
  rememberItem(item: EarItem): void
  /** Drop every cached item whose id is not in `keepIds` — keeps the cache bounded to live SRS cards. */
  pruneItems(keepIds: readonly string[]): void
}

export type EarTrainingStore = EarTrainingStoreState & EarTrainingStoreActions

export const useEarTrainingStore = create<EarTrainingStore>((set) => ({
  session: emptyEarSession(),
  itemsById: {},

  setSession: (session) => set({ session }),
  rememberItem: (item) => set((state) => ({ itemsById: { ...state.itemsById, [item.id]: item } })),
  pruneItems: (keepIds) =>
    set((state) => {
      const keep = new Set(keepIds)
      const next: Record<string, EarItem> = {}
      for (const [id, item] of Object.entries(state.itemsById)) {
        if (keep.has(id)) next[id] = item
      }
      return { itemsById: next }
    }),
}))
