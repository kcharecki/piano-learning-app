/**
 * Theme preference (roadmap UI-05): the learner's explicit choice between
 * the OS-driven theme and a manual override. A plain state container,
 * mirroring `earTrainingStore.ts`'s shape — no decision logic of its own.
 * `persistence.ts` restores and persists it through the EXISTING
 * versioned-shape mechanism: `COLLECTIONS.settings` under its own key, the
 * same "no IndexedDB migration needed" pattern `LEVELS_KEY`/`EAR_TRAINING_KEY`
 * already use (see that file's module comment) — this is a new KEY in an
 * object store that already exists, not a new object store, so no
 * `DB_VERSION` bump.
 *
 * `applyTheme` is the one DOM touch in this module: writing (or removing)
 * `data-theme` on the root element is exactly what
 * `src/design-system/tokens/colors.css` keys its light/dark palette
 * selection off (see that file's own header comment — dark is the bare
 * `:root` default, `[data-theme="light"]` and the `prefers-color-scheme`
 * fallback are the two light paths). `'system'` REMOVES the attribute so
 * `prefers-color-scheme` decides, rather than this store hardcoding a
 * palette for "system" — hardcoding dark here would be indistinguishable
 * from a real choice of Dark, and would stop a learner's OS light mode from
 * ever taking effect.
 */
import { create } from 'zustand'

export type ThemePreference = 'system' | 'dark' | 'light'

export type ThemeStoreState = {
  readonly theme: ThemePreference
}

export type ThemeStoreActions = {
  /** The learner's own choice: applies to the DOM immediately, and is picked up by persistence.ts's write-queue subscription like every other slice. */
  setTheme(theme: ThemePreference): void
  /** Replaces the slice for persistence restore, applying it to the DOM too — see the module comment. Restore-only; see persistence.ts. */
  hydrate(theme: ThemePreference): void
}

export type ThemeStore = ThemeStoreState & ThemeStoreActions

/** Writes or clears `data-theme` on the root element — see the module comment. */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'system',

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },

  hydrate: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
}))
