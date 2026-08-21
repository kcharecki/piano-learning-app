/**
 * The ear-training slice's persisted shape and its validation — split out of
 * `persistedShapes.ts` when that file outgrew the 500-line limit, on the same
 * reasoning that produced `persistedShapes.ts` itself: this slice carries a
 * whole vocabulary of its own (`EarItemKind`, per-kind levels, the generated
 * item cache) that nothing else persists, so it is a concept, not a section.
 *
 * Everything here is pure and total — a validator returns false, it never
 * throws — because its input is untrusted data off a disk.
 */
import type { Card } from '@core/srs/scheduler.ts'
import type { EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { EAR_MAX_LEVEL, EAR_MIN_LEVEL, type EarAttempt, type EarSessionState } from '@core/eartraining/session.ts'
import { isValidCard, isValidScore } from '@app/state/persistedShapes.ts'

/**
 * The whole ear-training slice (roadmap 3.11, REQ-3.6.3): the shared
 * `EarSessionState` — per-kind levels, SRS cards, id -> kind map and attempt
 * log — plus the generated-item cache `itemsById` (see `earTrainingStore.ts`'s
 * module comment for why the cache must be persisted alongside the session:
 * some item ids have no reverse parser, so "what to play again for this due
 * card" is a question only the originally generated `EarItem` can answer).
 */
export type PersistedEarTraining = {
  readonly session: EarSessionState
  readonly itemsById: Readonly<Record<string, EarItem>>
}

/**
 * Exhaustive over `EarItemKind`, the same trick `@core/eartraining/session.ts`
 * uses for its own private `KIND_SET`: adding a kind without adding it here is
 * a compile error, unlike a hand-maintained array literal typed as
 * `readonly EarItemKind[]`.
 */
const EAR_ITEM_KIND_SET: Record<EarItemKind, true> = {
  'interval-melodic': true,
  'interval-harmonic': true,
  'chord-quality': true,
  'scale-mode': true,
  'melodic-dictation': true,
  'rhythmic-dictation': true,
}
const EAR_ITEM_KINDS = Object.keys(EAR_ITEM_KIND_SET) as readonly EarItemKind[]

function isEarItemKind(value: unknown): value is EarItemKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EAR_ITEM_KIND_SET, value)
}

/** Every `EarItemKind` must have an INTEGER level within `EAR_MIN_LEVEL..EAR_MAX_LEVEL` — no missing kind, no extra kind, no fractional level (e.g. `2.5`). */
function isValidEarLevels(value: unknown): value is Readonly<Record<EarItemKind, number>> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== EAR_ITEM_KINDS.length) return false
  return EAR_ITEM_KINDS.every((kind) => {
    const level = v[kind]
    return (
      typeof level === 'number' && Number.isInteger(level) && level >= EAR_MIN_LEVEL && level <= EAR_MAX_LEVEL
    )
  })
}

/**
 * Accepts BOTH shapes an `EarAttempt` has ever been persisted in (roadmap
 * 3.26): the current `{ accuracy: number }` shape, and a pre-3.26 record —
 * `{ correct: boolean }`, no `accuracy` at all — that real users have
 * sitting in IndexedDB right now. Rejecting the old shape here would
 * silently wipe a learner's whole ear-training history on the very next
 * load, exactly the failure mode `isValidEarSession`'s own doc warns about
 * for a missing `kinds` entry.
 *
 * `restoreSlice` (`persistence.ts`) takes this predicate's own `value`
 * argument as the restored data VERBATIM once this returns `true` (see its
 * doc comment: `raw = value`) — a boolean type guard has no way to hand back
 * a *different*, migrated object, and changing that signature is out of this
 * file's scope. So the migration happens as a side effect of validating: an
 * old record is normalised IN PLACE — `accuracy` written on to it, the
 * now-superseded `correct` dropped — before this returns `true`. That is a
 * deliberate, one-off exception to this file's "a validator never mutates"
 * rule (see the module doc); there is no other seam available to migrate
 * persisted data without touching `persistence.ts`.
 *
 * Mutating a value that ends up REJECTED (e.g. `isValidEarSession` fails a
 * later check on `cards`/`kinds`) is safe only because the sole production
 * `Store` (`createIdbStore`, see `App.tsx`) returns a fresh
 * `structuredClone()` from `get` — the mutation never reaches the persisted
 * record. A non-cloning store (e.g. a bare in-memory fake) would have its
 * stored payload corrupted by a validator that ultimately returns `false`.
 */
function isValidEarAttempt(value: unknown): value is EarAttempt {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  if (typeof a.itemId !== 'string') return false
  if (!isEarItemKind(a.kind)) return false
  if (typeof a.at !== 'number' || !Number.isFinite(a.at)) return false
  if (typeof a.level !== 'number' || !Number.isFinite(a.level)) return false

  if (typeof a.accuracy === 'number' && Number.isFinite(a.accuracy) && a.accuracy >= 0 && a.accuracy <= 1) {
    return true
  }
  if (typeof a.correct === 'boolean') {
    a.accuracy = a.correct ? 1 : 0
    delete a.correct
    return true
  }
  return false
}

/** `kinds` is the authoritative itemId -> kind map — any key is a valid id, but every value must be a real `EarItemKind`. */
function isValidEarKinds(value: unknown): value is Readonly<Record<string, EarItemKind>> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value as Record<string, unknown>).every(isEarItemKind)
}

/**
 * `cards` and `kinds` are cross-checked, not validated independently: every
 * card's id must have an entry in `kinds`, the authoritative itemId -> kind
 * map (`@core/eartraining/session.ts`'s own module comment names this exact
 * failure mode). A session accepted without this check lets a card with no
 * `kinds` entry through, and `nextDueItemId` then throws an `InvariantError`
 * on every single Start — forever, because the bad record stays in IndexedDB.
 */
function isValidEarSession(value: unknown): value is EarSessionState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isValidEarLevels(v.levels)) return false
  if (!Array.isArray(v.attempts) || !v.attempts.every(isValidEarAttempt)) return false
  if (!Array.isArray(v.cards) || !v.cards.every(isValidCard)) return false
  if (!isValidEarKinds(v.kinds)) return false
  const kinds = v.kinds as Readonly<Record<string, EarItemKind>>
  return (v.cards as readonly Card[]).every((card) => Object.hasOwn(kinds, card.id))
}

function isValidEarItem(value: unknown): value is EarItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    isEarItemKind(item.kind) &&
    isValidScore(item.prompt) &&
    typeof item.answerKey === 'string' &&
    typeof item.level === 'number' &&
    Number.isFinite(item.level)
  )
}

/**
 * The only thing standing between a corrupt IndexedDB record and a crash at
 * startup (see `persistence.ts`'s `restoreSlice`, which never throws but also
 * never applies a payload this rejects). Checks every level of STRUCTURE — a
 * missing `session`, a non-object `itemsById`, an item missing
 * `prompt`/`id`/`level`, a level that is not a finite number, or an
 * `itemsById` entry whose key does not match the item's own `id`, all reject
 * the whole payload — but NOT every level of CONTENT: an item's `prompt` is
 * checked by `isValidScore`, which (see that function's own doc comment) is
 * structural-only and never validates individual note/measure/tempo/staff
 * entries, so e.g. a `prompt.notes` of `[null, 42]` still passes here. The
 * caller falls back to `emptyEarSession()` / `{}` on outright rejection,
 * never a half-applied state.
 */
export function isValidEarTraining(value: unknown): value is PersistedEarTraining {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isValidEarSession(v.session)) return false
  if (typeof v.itemsById !== 'object' || v.itemsById === null || Array.isArray(v.itemsById)) return false
  return Object.entries(v.itemsById as Record<string, unknown>).every(
    ([id, item]) => isValidEarItem(item) && item.id === id,
  )
}
