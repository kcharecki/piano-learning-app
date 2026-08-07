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
 * ## Adaptivity mirrors `adaptLevel` (sight-reading) — now for real (roadmap 3.26)
 *
 * `adaptEarLevel` follows the same unanimity-against-a-band rule as
 * `@core/sightreading/adaptive.ts`'s `adaptLevel`: hold the level unless the
 * most recent `window` attempts unanimously clear one side of an `EarBand` —
 * `run.every(a => a.accuracy > band.high)` promotes, `run.every(a => a.accuracy
 * < band.low)` demotes, anything mixed (or merely inside the band) holds.
 * This is the exact same expression `adaptLevel` uses, over `EarAttempt`
 * instead of `SightReadingRecord`.
 *
 * Until roadmap 3.26, `EarAttempt.correct` was a boolean (exactly `1` or `0`
 * as an "accuracy"), which made a band structurally inert: `1 > high` holds
 * for any `high < 1` and `0 < low` holds for any `low > 0`, so no band edge
 * could ever sit between the only two values that occurred. A previous
 * version of this module (roadmap 3.22) tried to compensate by comparing an
 * aggregate success RATE against a band instead of per-attempt unanimity, on
 * the mistaken premise that the pre-existing code's unused `band` was a bug
 * rather than a consequence of the boolean domain. That rate rule was reverted
 * (roadmap 3.24) — with window 5 and band `[0.8, 0.9]`, the only reachable
 * rates are multiples of 0.2, so `high` was unreachable, the ladder's
 * equilibrium sat below the band, and the level moved on the MAJORITY of
 * attempts at the target accuracy instead of holding.
 *
 * Roadmap 3.26 fixes the actual cause instead: `EarAttempt.accuracy` is now a
 * real number in `[0,1]`, not a boolean. A multiple-choice kind (interval,
 * chord, scale) has no partial credit to give, so its accuracy is still
 * exactly `1` or `0` — for that domain, the band-unanimity rule above is
 * PROVABLY identical to the old plain `run.every(a => a.correct)` /
 * `run.every(a => !a.correct)` rule, for any band with `0 < low <= high < 1`
 * (the default `DEFAULT_EAR_BAND` and every band this module accepts satisfy
 * that): `1 > high` and `0 < low` always hold, exactly as before. That
 * equivalence is pinned by test, not just asserted here — see
 * `session.test.ts`'s "pins the pre-3.26 boolean-domain behaviour exactly"
 * tests, including a property test over arbitrary valid bands. Dictation is
 * where the band finally does real work: `dictation.ts` computes
 * `pitchAccuracy`/`rhythmAccuracy` per attempt, `useEarTraining.ts` wires the
 * kind-appropriate one through as `EarAttempt.accuracy`, and a dictation
 * learner steady at, say, 0.85 (inside the default band) now correctly HOLDS
 * instead of oscillating the way a boolean domain forced it to. Levels are
 * still tracked **per kind** (`EarSessionState.levels`), so a learner strong
 * on intervals is never held back by a weak dictation streak or vice versa.
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
  /** Continuous accuracy in [0,1]. Multiple-choice kinds (interval, chord,
   *  scale) record exactly 1 or 0 — there is no partial credit in a
   *  multiple-choice answer to invent. Dictation records its real
   *  pitch/rhythm accuracy. Replaces the former boolean `correct` (roadmap
   *  3.26) — see the module doc's "Adaptivity mirrors adaptLevel" section. */
  readonly accuracy: number
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

/** The adaptation target band, meaningful again now that `EarAttempt.accuracy` is continuous (roadmap 3.26). */
export type EarBand = { readonly low: number; readonly high: number }

/** Mirrors sight-reading's own default band (`@core/sightreading/adaptive.ts`'s `DEFAULT_BAND`,
 *  REQ-3.4.6) so both trainers target the same accuracy window. */
export const DEFAULT_EAR_BAND: EarBand = { low: 0.8, high: 0.9 }

export type EarAdaptOptions = {
  /** How many of the most recent attempts must agree before the level moves. Defaults to 5. */
  readonly window?: number
  /** Target accuracy band. Defaults to `DEFAULT_EAR_BAND` ([0.8, 0.9]). */
  readonly band?: EarBand
}

/**
 * REQ-3.6.1/3.6.3 adaptivity: hold the level unless the most recent `window`
 * attempts unanimously clear one side of `band` — every one above `band.high`
 * promotes, every one below `band.low` demotes, anything mixed (or merely
 * inside the band) holds. See the module doc's "Adaptivity mirrors
 * `adaptLevel`" section for why this is both the correct mirror of the
 * sight-reading trainer's rule AND, for a multiple-choice kind whose accuracy
 * is always exactly 1 or 0, provably identical to the pre-3.26 plain-unanimity
 * rule.
 */
export function adaptEarLevel(
  current: number,
  recent: readonly EarAttempt[],
  opts: EarAdaptOptions = {},
): number {
  const window = opts.window ?? DEFAULT_WINDOW
  const band = opts.band ?? DEFAULT_EAR_BAND
  invariant(
    Number.isInteger(window) && window >= 1,
    `adaptEarLevel: window must be a positive integer, got ${window}`,
  )
  invariant(
    band.low > 0 && band.low <= band.high && band.high < 1,
    `adaptEarLevel: band must satisfy 0 < low <= high < 1, got { low: ${band.low}, high: ${band.high} } — ` +
      'an edge at 0 or 1 makes the multiple-choice domain (accuracy always exactly 1 or 0) inert.',
  )

  const clamped = clampLevel(current)
  invariant(Number.isFinite(clamped), `adaptEarLevel: current level must be finite, got ${current}`)
  if (recent.length < window) return clamped

  const run = recent.slice(-window)
  if (run.every((a) => a.accuracy > band.high)) return clampLevel(clamped + 1)
  if (run.every((a) => a.accuracy < band.low)) return clampLevel(clamped - 1)
  return clamped
}

/**
 * A perfect attempt (`accuracy` exactly 1) reviews 'good' (no change to
 * ease); anything else reviews 'again' (fixed short relearning step). For
 * every multiple-choice kind this is bit-for-bit the pre-3.26 mapping, since
 * their accuracy is always exactly 1 or 0. For dictation this is stricter
 * than the band used for LEVEL adaptation (which only needs the accuracy on
 * the right side of a target, not perfect) — a deliberate decoupling: how
 * hard to make the SRS scheduler work on an item, and whether the level
 * itself should move, are different questions.
 */
function gradeFor(accuracy: number): Grade {
  return accuracy >= 1 ? 'good' : 'again'
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
  invariant(
    Number.isFinite(attempt.accuracy) && attempt.accuracy >= 0 && attempt.accuracy <= 1,
    `recordEarAttempt: attempt.accuracy must be a finite number in [0,1], got ${attempt.accuracy}`,
  )
  const attempts = [...state.attempts, attempt]
  const cards = reviewCard(state.cards, attempt.itemId, gradeFor(attempt.accuracy), now, rng)
  const kinds = { ...state.kinds, [attempt.itemId]: attempt.kind }
  // Only attempts taken at the kind's CURRENT level count as evidence for the
  // next adaptation — `attempt.level` exists exactly for this filter. Without
  // it, answers from a level the learner has since been promoted or demoted
  // away from would keep counting toward the next decision forever.
  const currentLevel = state.levels[attempt.kind]
  const kindAttempts = attempts.filter(
    (a) => a.kind === attempt.kind && a.level === currentLevel,
  )
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
