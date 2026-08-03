/**
 * The adaptive, SRS-backed ear-training session (roadmap 3.4/3.6, REQ-3.6.1).
 *
 * Three drill modules (`intervals.ts`, `chords.ts`, `dictation.ts`) each know
 * how to *generate* an `EarItem` for a kind and level. This module never
 * imports them — it is built purely against `EarItemKind` and the SRS
 * scheduler's `Card` — and answers the two questions that sit above all three
 * drills: which item should be asked next, and how hard should the next one
 * be. The caller (the practice screen) is the thing that actually generates a
 * fresh item when `nextDueItemId` says nothing is due.
 *
 * ## Adaptivity mirrors `adaptLevel` (sight-reading)
 *
 * `adaptEarLevel` follows the exact same rule as
 * `@core/sightreading/adaptive.ts`'s `adaptLevel`: hold the level inside a
 * target accuracy band, move it by exactly one step when a run of the most
 * recent `window` attempts *unanimously* lands outside the band — every
 * attempt in the run correct to promote, every attempt wrong to demote. The
 * only difference is the shape of the input — a sight-reading read reports
 * one continuous accuracy per piece, while an ear-training attempt is a
 * single correct/incorrect boolean — so unanimity here means "every boolean
 * in the run agrees", not "the run's success rate crosses the band". A mixed
 * run (some correct, some wrong) always holds, regardless of window or band.
 * Levels are tracked **per kind** (`EarSessionState.levels`), so a learner
 * strong on intervals is never held back by a weak dictation streak or vice
 * versa.
 *
 * ## Time is the caller's problem
 *
 * Every `now` in this module is epoch milliseconds, supplied by the caller
 * from a `DateSource` at the app edge. This module never reads a clock (core
 * purity forbids `Date.now()` here regardless), and the caller must never
 * pass `performance.now()` or any other monotonic-but-not-epoch clock —
 * roadmap 2.19's bug was exactly that substitution, and it made every
 * persisted SRS card due forever because `due` and `now` were measured from
 * different origins.
 *
 * ## Everything here is pure
 *
 * `recordEarAttempt` never mutates `state`; it returns a new
 * `EarSessionState` with the attempt appended, the relevant SRS card
 * reviewed, and that kind's level re-adapted. `emptyEarSession` is the only
 * constructor.
 *
 * ## A card's kind
 *
 * `Card` (from `@core/srs/scheduler.ts`) is drill-agnostic and carries only
 * an `id` — no `kind`. `EarSessionState.kinds` is the authoritative
 * `itemId -> EarItemKind` map, written by `recordEarAttempt` whenever a card
 * is created or reviewed, so `nextDueItemId` never has to infer a kind from
 * an opaque id or from replaying the attempt log. A card whose id is missing
 * from `kinds` (e.g. seeded from storage that persisted cards but not this
 * map) fails loudly via `invariant` rather than silently vanishing from
 * consideration.
 */
import type { Card, Grade } from '@core/srs/scheduler.ts'
import { dueCards, newCard, review } from '@core/srs/scheduler.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import type { Rng } from '@core/ports/rng.ts'
import { invariant } from '@core/shared/invariant.ts'

export type EarAttempt = {
  readonly itemId: string
  readonly kind: EarItemKind
  readonly correct: boolean
  /** Epoch ms, from a DateSource at the app edge — never performance.now(). */
  readonly at: number
  readonly level: number
}

export type EarSessionState = {
  /** Per-kind level, so a learner strong on intervals is not held back by dictation. */
  readonly levels: Readonly<Record<EarItemKind, number>>
  readonly attempts: readonly EarAttempt[]
  /** SRS cards, keyed by EarItem id. */
  readonly cards: readonly Card[]
  /** Authoritative itemId -> kind map, so a card's kind is never inferred or lost. */
  readonly kinds: Readonly<Record<string, EarItemKind>>
}

export const EAR_MIN_LEVEL = 1
export const EAR_MAX_LEVEL = 5

/**
 * Exhaustive over `EarItemKind`: adding a kind without adding it here is a compile error, unlike
 * a hand-maintained array literal typed as `readonly EarItemKind[]`.
 */
const KIND_SET: Record<EarItemKind, true> = {
  'interval-melodic': true,
  'interval-harmonic': true,
  'chord-quality': true,
  'scale-mode': true,
  'melodic-dictation': true,
  'rhythmic-dictation': true,
}
const ALL_KINDS = Object.keys(KIND_SET) as readonly EarItemKind[]

export function emptyEarSession(): EarSessionState {
  const levels = Object.fromEntries(ALL_KINDS.map((kind) => [kind, EAR_MIN_LEVEL])) as Record<
    EarItemKind,
    number
  >
  return { levels, attempts: [], cards: [], kinds: {} }
}

const clampLevel = (level: number): number => Math.min(EAR_MAX_LEVEL, Math.max(EAR_MIN_LEVEL, level))

const DEFAULT_WINDOW = 5
const DEFAULT_BAND: readonly [number, number] = [0.8, 0.9]

export type EarAdaptOptions = {
  /** How many of the most recent attempts must agree before the level moves. Defaults to 5. */
  readonly window?: number
  /** Target accuracy (success-rate) band, `[low, high]`. Defaults to `[0.8, 0.9]`. */
  readonly band?: readonly [number, number]
}

/** REQ-3.6.1 adaptivity: hold inside the band, move one step on a unanimous run outside it. */
export function adaptEarLevel(
  current: number,
  recent: readonly EarAttempt[],
  opts: EarAdaptOptions = {},
): number {
  const window = opts.window ?? DEFAULT_WINDOW
  const [low, high] = opts.band ?? DEFAULT_BAND
  invariant(
    Number.isInteger(window) && window >= 1,
    `adaptEarLevel: window must be a positive integer, got ${window}`,
  )
  invariant(low <= high, `adaptEarLevel: band low (${low}) must be <= band high (${high})`)

  const clamped = clampLevel(current)
  invariant(Number.isFinite(clamped), `adaptEarLevel: current level must be finite, got ${current}`)
  if (recent.length < window) return clamped

  const run = recent.slice(-window)
  if (run.every((a) => a.correct)) return clampLevel(clamped + 1)
  if (run.every((a) => !a.correct)) return clampLevel(clamped - 1)
  return clamped
}

/** correct -> 'good' (no change to ease), wrong -> 'again' (fixed short relearning step). */
function gradeFor(correct: boolean): Grade {
  return correct ? 'good' : 'again'
}

/** `cards` with the card for `itemId` reviewed, creating it first if it does not exist yet. */
function reviewCard(
  cards: readonly Card[],
  itemId: string,
  grade: Grade,
  now: number,
  rng?: Rng,
): readonly Card[] {
  const existing = cards.find((c) => c.id === itemId)
  const base = existing ?? newCard(itemId, now)
  const reviewed = review(base, grade, now, rng)
  return existing ? cards.map((c) => (c.id === itemId ? reviewed : c)) : [...cards, reviewed]
}

/**
 * Record one graded attempt: appends it, reviews its SRS card with a grade derived from
 * correctness, and re-adapts that kind's level. Pure — returns the next state.
 */
export function recordEarAttempt(
  state: EarSessionState,
  attempt: EarAttempt,
  now: number,
  rng?: Rng,
): EarSessionState {
  invariant(
    now === attempt.at,
    `recordEarAttempt: now (${now}) must equal attempt.at (${attempt.at}) — the SRS card is ` +
      'scheduled from now, so a mismatch silently schedules from the wrong origin (see roadmap 2.19).',
  )
  const attempts = [...state.attempts, attempt]
  const cards = reviewCard(state.cards, attempt.itemId, gradeFor(attempt.correct), now, rng)
  const kinds = { ...state.kinds, [attempt.itemId]: attempt.kind }
  const kindAttempts = attempts.filter((a) => a.kind === attempt.kind)
  const levels = {
    ...state.levels,
    [attempt.kind]: adaptEarLevel(state.levels[attempt.kind], kindAttempts),
  }
  return { levels, attempts, cards, kinds }
}

/**
 * What to ask next: the id of the most overdue SRS card among `kinds`, or null when nothing is
 * due and a fresh item should be generated instead. The caller generates the item; this module
 * never does, which is why it does not import the drills.
 */
export function nextDueItemId(
  state: EarSessionState,
  kinds: readonly EarItemKind[],
  now: number,
): string | null {
  const wanted = new Set(kinds)
  const relevant = state.cards.filter((c) => {
    const kind = state.kinds[c.id]
    invariant(kind !== undefined, `nextDueItemId: card ${c.id} has no entry in state.kinds`)
    return wanted.has(kind)
  })
  // dueCards sorts earliest-due-first, so the head of the list is the most overdue.
  const due = dueCards(relevant, now)
  const mostOverdue = due[0]
  return mostOverdue === undefined ? null : mostOverdue.id
}
