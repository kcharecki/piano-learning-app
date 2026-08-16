/**
 * Last-used instrument (DR-01): which of the two apps — Piano or Drums — the
 * learner opens into. A plain state container, mirroring `themeStore.ts`'s
 * shape and reasoning almost exactly (both are "one tiny persisted choice,
 * restored before the rest of the app needs it") — no decision logic of its
 * own. `persistence.ts` restores and persists it through the EXISTING
 * versioned-shape mechanism: `COLLECTIONS.settings` under its own key, same
 * "no IndexedDB migration needed" pattern `THEME_KEY`/`LEVELS_KEY` already
 * use.
 *
 * `INSTRUMENT_HINT_KEY` is the same "paint hint" trick as
 * `THEME_PAINT_HINT_KEY`: IndexedDB cannot be read synchronously, so
 * `App.tsx`'s `restoreSession` (a `useEffect`, which by definition runs after
 * React's first commit) is too late for the router's OWN first render — a
 * bare `/` has to pick an instrument on that very first render, or a learner
 * who left off in Drums sees Piano's whole nav+screen flash before swapping
 * over. `routing.ts`'s `useRoute` reads this hint synchronously (via
 * `readInstrumentHint`) as `parseAppRoute`'s `defaultInstrument` argument, so
 * the first render already lands in the right instrument for that one
 * ambiguous case (a bare root path — every other path names its instrument
 * explicitly and needs no hint at all, see `route.ts`'s own module comment).
 * Deliberately NOT read back by the app the way IndexedDB is: `hydrate`
 * still applies IndexedDB's own value on top once `restoreSession` resolves,
 * so a stale hint (cleared localStorage, a hand-edited value) only ever
 * costs one wrong first paint, never a permanently wrong instrument — and,
 * unlike theme, this store deliberately does NOT force a corrective
 * navigation once IndexedDB's real value lands: swapping the learner's
 * whole nav and screen out from under them mid-interaction, after they may
 * already have started using whatever instrument the hint picked, would be
 * far more disruptive than theme's cosmetic self-heal.
 */
import { create } from 'zustand'
import type { Instrument } from '@app/shell/route.ts'

export type InstrumentStoreState = {
  readonly lastInstrument: Instrument
}

export type InstrumentStoreActions = {
  /** The learner's own choice (or any navigation that changes instrument) — see persistence.ts's write-queue subscription. */
  setLastInstrument(instrument: Instrument): void
  /** Replaces the slice for persistence restore — see persistence.ts. Restore-only. */
  hydrate(instrument: Instrument): void
}

export type InstrumentStore = InstrumentStoreState & InstrumentStoreActions

export const INSTRUMENT_HINT_KEY = 'piano-instrument'

function writeHint(instrument: Instrument): void {
  // Best-effort: a browser with storage disabled still routes correctly, it
  // just loses the zero-flash guarantee on a bare-root reload. Never let a
  // cache write break the actual navigation.
  try {
    localStorage.setItem(INSTRUMENT_HINT_KEY, instrument)
  } catch {
    /* storage unavailable — the app is fully functional without the hint */
  }
}

export const useInstrumentStore = create<InstrumentStore>((set) => ({
  lastInstrument: 'piano',

  setLastInstrument: (instrument) => {
    writeHint(instrument)
    set({ lastInstrument: instrument })
  },

  hydrate: (instrument) => {
    writeHint(instrument)
    set({ lastInstrument: instrument })
  },
}))

/** Synchronous read of the paint-time hint, for `routing.ts`'s first render — see the module comment. */
export function readInstrumentHint(): Instrument {
  try {
    return localStorage.getItem(INSTRUMENT_HINT_KEY) === 'drums' ? 'drums' : 'piano'
  } catch {
    return 'piano'
  }
}
