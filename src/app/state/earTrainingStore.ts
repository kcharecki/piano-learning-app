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
 * `hydrate` (roadmap 3.11, REQ-3.6.3) replaces `session` AND `itemsById`
 * wholesale in one `set`, matching `sightReadingStore.ts`/`flashcardStore.ts`'s
 * own `hydrate` actions. It exists only for `persistence.ts`'s `restoreSession`
 * (and `snapshot.ts`'s `applyProgressSnapshot`) to apply a previously-saved
 * session + item cache — every other caller keeps using `setSession` /
 * `rememberItem` / `pruneItems`. Without this, the adapted per-kind levels,
 * the SRS cards, the id -> kind map and the attempt log all reset to
 * `emptyEarSession()` on every reload — an adaptive difficulty that forgets
 * everything every time the tab closes is not adaptive.
 *
 * ## `attempts` is capped on `hydrate`, not left to grow forever
 *
 * `recordEarAttempt` (`@core/eartraining/session.ts`) appends to
 * `session.attempts` without bound, and `pruneItems` above only bounds
 * `itemsById` — nothing in this store's own actions bounds the attempt log,
 * unlike `techniqueStore.ts`'s `addAttempt`, which caps at
 * `MAX_STORED_TECHNIQUE_ATTEMPTS` on every push. Before this slice was
 * persisted (roadmap 3.11), a page life was the de-facto bound; now that
 * `persistence.ts` re-serializes the whole session on every answer, an
 * unbounded log grows the saved blob forever. `hydrate` is the one choke
 * point both `persistence.ts`'s restore and `snapshot.ts`'s
 * `applyProgressSnapshot` go through, so capping there — keep the most
 * recent `MAX_STORED_EAR_ATTEMPTS`, drop the oldest — bounds it without
 * touching `@core/eartraining/session.ts`, which is not this module's file.
 */
import type { EarItem } from '@core/eartraining/item.ts'
import { emptyEarSession, type EarSessionState } from '@core/eartraining/session.ts'
import { create } from 'zustand'

/** See the module comment's "`attempts` is capped on `hydrate`" section. */
export const MAX_STORED_EAR_ATTEMPTS = 200

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
  /** Replace the whole persisted slice at startup. Restore-only; see persistence.ts. */
  hydrate(session: EarSessionState, itemsById: Readonly<Record<string, EarItem>>): void
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
  hydrate: (session, itemsById) =>
    set({
      // `attempts` is chronological (oldest first, see `recordEarAttempt`), so
      // "keep the most recent, drop the oldest" is the tail of the array.
      session: { ...session, attempts: session.attempts.slice(-MAX_STORED_EAR_ATTEMPTS) },
      itemsById,
    }),
}))
