/**
 * The learner's chosen kit-map preset (roadmap DR-02) and its structural
 * validation — split out of `persistedShapes.ts` when that file hit the
 * 500-line limit. Same pure/total contract as every validator there: a
 * malformed value returns false, it never throws, because its input is
 * untrusted data off a disk a previous version of this app, or a hand edit,
 * may have written.
 */
import { isMappedDrumPad } from '@core/drums/model/pad.ts'
import type { KitMapEntry } from '@core/drums/kitmap/kitMap.ts'

/**
 * `learned`, when present, is the MIDI-learned custom map
 * (`@core/drums/kitmap/learn.ts`) in its persisted (string-keyed) form —
 * `KitMap.notes` itself is keyed by number, but every object key round-trips
 * through storage as a string, so the persisted shape says so rather than
 * lying about it.
 */
export type PersistedDrumsKitMap = {
  readonly presetName: string
  readonly learned?: {
    readonly name: string
    readonly notes: Readonly<Record<string, KitMapEntry>>
  }
}

function isValidPersistedKitMapEntry(value: unknown): value is KitMapEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  if (e.kind === 'hiHat') return true
  if (e.kind === 'pad') return typeof e.pad === 'string' && isMappedDrumPad(e.pad)
  return false
}

/** Every key an integer string (a raw MIDI note number, JSON round-trips it as a string) and every value a valid `KitMapEntry`. */
function isValidPersistedLearnedKitMap(value: unknown): value is NonNullable<PersistedDrumsKitMap['learned']> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.name !== 'string') return false
  if (typeof v.notes !== 'object' || v.notes === null || Array.isArray(v.notes)) return false
  return Object.entries(v.notes as Record<string, unknown>).every(
    ([key, entry]) => /^\d+$/.test(key) && isValidPersistedKitMapEntry(entry),
  )
}

/**
 * `presetName` is the only field the OLD shape ever had, so it is the only
 * one required here — a stored `learned` is validated too (see
 * `isValidPersistedLearnedKitMap`), but a malformed `learned` does not fail
 * this whole check: `persistence.drums.ts`'s restore re-checks `learned`
 * itself before trusting it, so a corrupt learned map degrades to "no
 * learned map" without also losing the (perfectly fine) preset name — the
 * same independence every other slice's "corrupt payload" test expects, one
 * level down.
 */
export function isValidDrumsKitMap(value: unknown): value is PersistedDrumsKitMap {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.presetName !== 'string') return false
  return v.learned === undefined || isValidPersistedLearnedKitMap(v.learned)
}
