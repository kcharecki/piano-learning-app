/**
 * Shared spaced-repetition scheduler (roadmap 2.7, REQ-3.9.4).
 *
 * One engine behind theory drills, ear training, note flashcards and
 * repertoire-maintenance prompts — each of those just needs "what is due, and
 * how does a grade move it", so the shared surface is deliberately small: a
 * `Card`, `newCard`, `review`, `dueCards`, `nextReviewIn` and `retentionStats`.
 *
 * ## Algorithm: Anki-style four-grade SM-2
 *
 * This is SuperMemo-2's ease-factor mechanic (an easiness factor that grows or
 * shrinks the interval multiplicatively, floored so a card can never spiral to
 * a zero or negative interval) wearing Anki's UI-driven grading instead of
 * SM-2's original six-point 0–5 quality scale. Four buttons — again / hard /
 * good / easy — is what a practice screen actually presents, so the internal
 * quality score SM-2 was designed around is skipped entirely in favour of
 * grading straight off `Grade`. `again` does not reset the card to the very
 * start of a graduation ladder from scratch (as strict SM-2 would); instead it
 * drops to one short fixed relearning step, which is the behaviour every
 * modern SRS converged on because re-teaching a briefly-forgotten card from
 * zero wastes the review budget on cards that are actually still mostly known.
 *
 * State kept per card is the minimum the four call sites share: `ease`,
 * `intervalDays`, `reps` (successful reviews since the last lapse) and
 * `lapses` (times graded `again`, ever). Nothing here is drill-specific —
 * question content, card selection beyond "is it due" and per-drill-type
 * metadata all live above this module.
 *
 * ## Time
 *
 * `due`, `now` and `introducedAt` are all epoch milliseconds, supplied by the
 * caller from a `DateSource` port — this module never reads a clock, so it
 * stays in `src/core` and stays deterministic under test.
 *
 * Scheduling is **millisecond-granular, anchored at `now`**, not calendar-day
 * or "midnight rollover" granular: `due = now + intervalDays * DAY_MS` exactly,
 * whatever `now` is. `intervalDays` is a *duration* used by the algorithm and
 * shown to the learner ("next: 4 days") — it is not a count of calendar days
 * crossed. A card reviewed at 23:59 and an identical card reviewed two minutes
 * later at 00:01 the next day get due times two minutes apart, not fast-
 * forwarded to a new calendar day; there is no day-boundary special case to
 * get wrong.
 *
 * ## Interval fuzz
 *
 * `review` takes an optional `Rng`. When present, the computed interval (never
 * the `again` relearning step, which must stay short) is jittered by up to
 * `FUZZ_FRACTION` so that cards introduced together do not all come due on the
 * same future day and pile up. Omitting the `Rng` skips fuzzing entirely and
 * yields the exact algorithmic number, which is what makes the scheduler's
 * tests assertable without a seeded generator.
 */
import type { Rng } from '@core/ports/index.ts'
import { invariant } from '@core/shared/invariant.ts'

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export type Card = {
  readonly id: string
  /** Epoch ms this card next comes up for review. */
  readonly due: number
  /** Current interval, in days — a duration, not a calendar-day count. */
  readonly intervalDays: number
  /** SM-2 easiness factor. Floored at `EASE_FLOOR`, otherwise unbounded. */
  readonly ease: number
  /** Successful reviews (any grade but `again`) since the last lapse. */
  readonly reps: number
  /** Total times this card has been graded `again`. */
  readonly lapses: number
  /** Epoch ms the card was first introduced. */
  readonly introducedAt: number
}

export type RetentionStats = {
  readonly total: number
  readonly due: number
  readonly young: number
  readonly mature: number
  readonly averageEase: number
}

// --------------------------------------------------------------------- tuning

export const DEFAULT_EASE = 2.5
/** SM-2's documented floor — an ease factor cannot fall below this however many lapses. */
export const EASE_FLOOR = 1.3
/** Ease delta applied per grade, before flooring. `good` is neutral, as in Anki. */
const EASE_DELTA: Readonly<Record<Grade, number>> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
}

/** First graduated interval, on a card's first successful review. */
const FIRST_INTERVAL_DAYS = 1
/** Second graduated interval, on a card's second successful review. */
const SECOND_INTERVAL_DAYS = 6
/** Fixed multiplier `hard` applies to the previous interval once a card is past graduation. */
const HARD_MULTIPLIER = 1.2
/** Extra multiplier `easy` applies on top of the normal ease-driven growth. */
const EASY_MULTIPLIER = 1.3
/** No graduated interval is ever shorter than this, whatever grade or ease produced it. */
const MIN_INTERVAL_DAYS = 1
/**
 * Fixed relearning step for `again`: about 10 minutes. Always well under a day,
 * which is what keeps "never schedules beyond one day" true unconditionally.
 */
export const AGAIN_INTERVAL_DAYS = 1 / 144

/** Anki's standard cutoff: an interval at or beyond this many days is "mature". */
export const MATURE_THRESHOLD_DAYS = 21

/** Max fractional jitter applied to a fuzzed interval, each direction. */
const FUZZ_FRACTION = 0.05

export const DAY_MS = 24 * 60 * 60 * 1000

// ----------------------------------------------------------------------- API

export function newCard(id: string, now: number): Card {
  return {
    id,
    due: now,
    intervalDays: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    introducedAt: now,
  }
}

/**
 * Grade a card and return the card as it stands after the review. `card` is
 * never mutated. Passing `rng` fuzzes the resulting interval (never the
 * `again` step); omitting it yields the exact, reproducible interval that
 * `nextReviewIn` previews.
 */
export function review(card: Card, grade: Grade, now: number, rng?: Rng): Card {
  const ease = nextEase(card, grade)
  const rawIntervalDays =
    grade === 'again' ? AGAIN_INTERVAL_DAYS : nextIntervalDays(card, grade, ease)
  const intervalDays = grade === 'again' || !rng ? rawIntervalDays : fuzz(rawIntervalDays, rng)
  return {
    ...card,
    ease,
    intervalDays,
    due: now + intervalDays * DAY_MS,
    reps: grade === 'again' ? 0 : card.reps + 1,
    lapses: grade === 'again' ? card.lapses + 1 : card.lapses,
  }
}

/** Cards with `due <= now`, earliest first, capped at `limit` if given. Read-only view. */
export function dueCards(cards: readonly Card[], now: number, limit?: number): readonly Card[] {
  invariant(limit === undefined || limit >= 0, `dueCards: limit ${limit} must not be negative`)
  const due = cards
    .filter((c) => c.due <= now)
    .sort((a, b) => a.due - b.due || a.id.localeCompare(b.id))
  return limit === undefined ? due : due.slice(0, limit)
}

/**
 * Days until the next review if `card` were graded `grade` right now, for
 * display ("next: 4 days") without committing to the review. Matches the
 * un-fuzzed interval `review` would produce for the same card and grade.
 */
export function nextReviewIn(card: Card, grade: Grade): number {
  if (grade === 'again') return AGAIN_INTERVAL_DAYS
  return nextIntervalDays(card, grade, nextEase(card, grade))
}

export function retentionStats(cards: readonly Card[], now: number): RetentionStats {
  const total = cards.length
  const due = cards.filter((c) => c.due <= now).length
  const young = cards.filter((c) => c.reps > 0 && c.intervalDays < MATURE_THRESHOLD_DAYS).length
  const mature = cards.filter((c) => c.intervalDays >= MATURE_THRESHOLD_DAYS).length
  const averageEase = total === 0 ? 0 : cards.reduce((sum, c) => sum + c.ease, 0) / total
  return { total, due, young, mature, averageEase }
}

// ------------------------------------------------------------------ internals

function nextEase(card: Card, grade: Grade): number {
  return Math.max(EASE_FLOOR, card.ease + EASE_DELTA[grade])
}

/**
 * The graduated-ladder part of SM-2: 1 day, then 6 days, then `previous * ease`
 * — using `ease` as already updated for this grade, so `hard`'s fixed 1.2×
 * multiplier (below) cancels the ease term back out once a card is past
 * graduation, and `easy` stacks its bonus on top of the normal ease growth.
 */
function nextIntervalDays(card: Card, grade: Exclude<Grade, 'again'>, ease: number): number {
  const base =
    card.reps === 0
      ? FIRST_INTERVAL_DAYS
      : card.reps === 1
        ? SECOND_INTERVAL_DAYS
        : card.intervalDays * ease
  const multiplier =
    grade === 'hard' ? HARD_MULTIPLIER / ease : grade === 'easy' ? EASY_MULTIPLIER : 1
  return Math.max(base * multiplier, MIN_INTERVAL_DAYS)
}

/** ±`FUZZ_FRACTION` jitter, so cards introduced together spread out over their due day. */
function fuzz(intervalDays: number, rng: Rng): number {
  const jitter = 1 + (rng.next() * 2 - 1) * FUZZ_FRACTION
  return Math.max(intervalDays * jitter, MIN_INTERVAL_DAYS * (1 - FUZZ_FRACTION))
}
