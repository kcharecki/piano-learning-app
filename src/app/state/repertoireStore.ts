/**
 * Repertoire library store (roadmap 4.5, REQ-3.8.2/3.8.3/3.8.4) — the store a
 * future consumer screen wires up (see `@core/repertoire/repertoire.ts`'s
 * module comment: no screen calls this yet). Mirrors `techniqueStore.ts`'s
 * shape: a plain state container, tested the same way.
 *
 * STATE ONLY: every decision about a piece — whether an add is valid, how
 * `bestAccuracy` updates, what an unknown id means — belongs to
 * `@core/repertoire/repertoire.ts`. This store just holds the array and calls
 * through.
 *
 * Frozen decisions (see the roadmap brief for this module):
 * - `addPiece` returns core's `Result<..., string>` (narrowed to `Result<void,
 *   string>` here) rather than the new array, so the caller learns WHY an add
 *   failed (duplicate id, blank title, level outside 1..5). The array itself
 *   is already the store's own state on `ok`; handing it back too would just
 *   invite a second source of truth for the same collection.
 * - `recordSession` does NOT catch core's `invariant` throw for an unknown
 *   id. Per this project's error convention an unknown id here is programmer
 *   error (a stale reference from the UI, not user input), and silently
 *   dropping the session would leave maintenance prompts firing with no
 *   signal — exactly what core's own doc comment warns against.
 * - The `MAX_STORED_REPERTOIRE_PIECES` cap keeps the FIRST that many entries
 *   (oldest kept), the opposite of `techniqueStore`'s newest-first history.
 *   A repertoire library is a curated list the learner built one piece at a
 *   time, not a rolling log of attempts — so the cap never silently removes
 *   a piece that's already there to make room. The trade-off this accepts:
 *   once the library is at the cap, the newest add is the one truncated away
 *   rather than an existing piece being evicted for it.
 */
import {
  addPiece as addPieceCore,
  recordSession as recordSessionCore,
  setNotes as setNotesCore,
  setStatus as setStatusCore,
  type NewPieceInput,
  type RepertoirePiece,
  type RepertoireSession,
  type RepertoireStatus,
} from '@core/repertoire/repertoire.ts'
import { ok, type Result } from '@core/shared/result.ts'
import { create } from 'zustand'

/** See the module comment on why this is capped at all — mirrors techniqueStore.ts. */
export const MAX_STORED_REPERTOIRE_PIECES = 200

export type RepertoireStoreState = {
  /** Insertion order, as `addPiece` appends. Capped at `MAX_STORED_REPERTOIRE_PIECES`. */
  readonly pieces: readonly RepertoirePiece[]
}

export type RepertoireStoreActions = {
  /**
   * Delegates to core `addPiece`. Returns its `Result` so the caller can show
   * the real reason (duplicate id, blank title, level out of 1..5) instead of
   * failing silently; state is only replaced on `ok`.
   */
  addPiece(input: NewPieceInput): Result<void, string>
  setStatus(id: string, status: RepertoireStatus): void
  setNotes(id: string, notes: string): void
  /** Delegates to core `recordSession`, which THROWS on an unknown id — see the note below. */
  recordSession(id: string, session: RepertoireSession): void
  /** Replaces the whole collection — used by `persistence.ts`'s restore, mirroring `techniqueStore.hydrate`. */
  hydrate(state: Partial<RepertoireStoreState>): void
}

export type RepertoireStore = RepertoireStoreState & RepertoireStoreActions

export const useRepertoireStore = create<RepertoireStore>((set, get) => ({
  pieces: [],

  addPiece: (input) => {
    const result = addPieceCore(get().pieces, input)
    if (!result.ok) return result
    // Cap by keeping the FIRST MAX_STORED_REPERTOIRE_PIECES entries — see the
    // module comment for why this store never evicts an existing piece.
    set({ pieces: result.value.slice(0, MAX_STORED_REPERTOIRE_PIECES) })
    return ok(undefined)
  },

  setStatus: (id, status) =>
    set((state) => ({ pieces: setStatusCore(state.pieces, id, status) })),

  setNotes: (id, notes) => set((state) => ({ pieces: setNotesCore(state.pieces, id, notes) })),

  // Note: if `id` is unknown, core's `recordSession` throws via `invariant`
  // before returning, so the updater below throws too — zustand's `set` runs
  // the updater synchronously, so the throw propagates out of this call
  // without touching `state`. See the module comment for why that's correct.
  recordSession: (id, session) =>
    set((state) => ({ pieces: recordSessionCore(state.pieces, id, session) })),

  hydrate: (state) => set(state),
}))
