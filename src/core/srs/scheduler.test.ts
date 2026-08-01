import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { InvariantError } from '@core/shared/invariant.ts'
import { scriptedRng } from '@test/fakes.ts'
import {
  AGAIN_INTERVAL_DAYS,
  DAY_MS,
  DEFAULT_EASE,
  dueCards,
  EASE_FLOOR,
  MATURE_THRESHOLD_DAYS,
  newCard,
  nextReviewIn,
  retentionStats,
  review,
  type Card,
  type Grade,
} from './scheduler.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000 // an arbitrary but fixed epoch-ms anchor

const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy']

/** Apply a sequence of grades in order, starting from a fresh card, all at T0. */
const reviewAll = (card: Card, grades: readonly Grade[], now = T0): Card =>
  grades.reduce((c, g) => review(c, g, now), card)

const arbGrade = fc.constantFrom(...GRADES)

/** Cards shaped like ones this module would actually produce. */
const arbCard: fc.Arbitrary<Card> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    introducedAt: fc.integer({ min: 0, max: 1_700_000_000_000 }),
    dueOffsetDays: fc.integer({ min: -30, max: 30 }),
    intervalDays: fc.double({ min: 0, max: 1000, noNaN: true }),
    ease: fc.double({ min: EASE_FLOOR, max: 5, noNaN: true }),
    reps: fc.integer({ min: 0, max: 50 }),
    lapses: fc.integer({ min: 0, max: 50 }),
  })
  .map(({ dueOffsetDays, introducedAt, ...rest }) => ({
    ...rest,
    introducedAt,
    due: introducedAt + dueOffsetDays * DAY_MS,
  }))

/** Cards that have graduated past their first review, so `intervalDays >= 1`. */
const arbGraduatedCard: fc.Arbitrary<Card> = arbCard.filter(
  (c) => c.reps >= 1 && c.intervalDays >= 1,
)

const arbNow = fc.integer({ min: 0, max: 2_000_000_000_000 })

// ---------------------------------------------------------------------------
// newCard
// ---------------------------------------------------------------------------

describe('newCard', () => {
  it('is due immediately, with SM-2 defaults and no history', () => {
    expect(newCard('c1', T0)).toEqual<Card>({
      id: 'c1',
      due: T0,
      intervalDays: 0,
      ease: DEFAULT_EASE,
      reps: 0,
      lapses: 0,
      introducedAt: T0,
    })
  })
})

// ---------------------------------------------------------------------------
// review — exact-number examples (no rng)
// ---------------------------------------------------------------------------

describe('review — graduated ladder on repeated "good"', () => {
  it('goes 1 day, 6 days, then previous * ease — the classic SM-2 ladder', () => {
    let card = newCard('c1', T0)
    card = review(card, 'good', T0)
    expect(card.intervalDays).toBe(1)
    expect(card.reps).toBe(1)
    expect(card.ease).toBe(DEFAULT_EASE) // 'good' is ease-neutral

    card = review(card, 'good', T0)
    expect(card.intervalDays).toBe(6)
    expect(card.reps).toBe(2)

    card = review(card, 'good', T0)
    expect(card.intervalDays).toBe(15) // 6 * 2.5
    expect(card.reps).toBe(3)

    card = review(card, 'good', T0)
    expect(card.intervalDays).toBe(37.5) // 15 * 2.5
    expect(card.reps).toBe(4)
  })

  it('sets due to now + intervalDays * DAY_MS exactly', () => {
    const card = review(newCard('c1', T0), 'good', T0)
    expect(card.due).toBe(T0 + 1 * DAY_MS)
  })
})

describe('review — hard', () => {
  it('on a graduated card (reps >= 2), multiplies the previous interval by exactly 1.2, independent of ease', () => {
    // Build a card with a known interval and a non-default ease so the
    // cancellation documented in nextIntervalDays is actually exercised.
    let card = newCard('c1', T0)
    card = review(card, 'good', T0) // reps 1, interval 1
    card = review(card, 'good', T0) // reps 2, interval 6
    card = review(card, 'easy', T0) // reps 3, ease bumped, interval changes
    const before = card.intervalDays
    const after = review(card, 'hard', T0)
    expect(after.intervalDays).toBeCloseTo(before * 1.2, 9)
  })

  it('on the very first review, clamps to the 1-day floor rather than going below it', () => {
    const card = review(newCard('c1', T0), 'hard', T0)
    expect(card.intervalDays).toBe(1)
  })
})

describe('review — easy', () => {
  it('on the very first review, applies the easy bonus on top of the 1-day base', () => {
    const card = review(newCard('c1', T0), 'easy', T0)
    expect(card.intervalDays).toBeCloseTo(1.3, 9) // FIRST_INTERVAL_DAYS * EASY_MULTIPLIER
  })
})

describe('review — again', () => {
  it('schedules a fixed ~10 minute relearning step, resets reps, and counts a lapse', () => {
    let card = newCard('c1', T0)
    card = review(card, 'good', T0)
    card = review(card, 'good', T0)
    expect(card.reps).toBe(2)
    expect(card.lapses).toBe(0)

    const lapsed = review(card, 'again', T0)
    expect(lapsed.intervalDays).toBe(AGAIN_INTERVAL_DAYS)
    expect(lapsed.due).toBe(T0 + 600_000) // exactly 10 minutes
    expect(lapsed.reps).toBe(0)
    expect(lapsed.lapses).toBe(1)
  })

  it('lowers ease by the documented delta, floored at EASE_FLOOR', () => {
    const card = newCard('c1', T0)
    const lapsed = review(card, 'again', T0)
    expect(lapsed.ease).toBeCloseTo(DEFAULT_EASE - 0.2, 9)
  })
})

// ---------------------------------------------------------------------------
// nextReviewIn — must match what review() computes, unfuzzed
// ---------------------------------------------------------------------------

describe('nextReviewIn', () => {
  it('previews the exact interval review() would apply for the same card and grade', () => {
    fc.assert(
      fc.property(arbCard, arbGrade, arbNow, (card, grade, now) => {
        const previewed = nextReviewIn(card, grade)
        const applied = review(card, grade, now).intervalDays
        expect(previewed).toBe(applied)
      }),
    )
  })

  it('never asks for a rng and stays deterministic', () => {
    const card = newCard('c1', T0)
    expect(nextReviewIn(card, 'good')).toBe(nextReviewIn(card, 'good'))
  })
})

// ---------------------------------------------------------------------------
// interval fuzz
// ---------------------------------------------------------------------------

describe('review — interval fuzz', () => {
  it('is skipped entirely when no rng is passed (exact numbers)', () => {
    const card = review(newCard('c1', T0), 'good', T0)
    expect(card.intervalDays).toBe(1)
  })

  it('jitters the interval by at most +/-5% when a rng is passed', () => {
    const card = { ...newCard('c1', T0), reps: 2, intervalDays: 10, ease: 2.5 }
    // rng.next() = 1 -> +5%, = 0 -> -5%, = 0.5 -> unchanged
    const high = review(card, 'good', T0, scriptedRng([1]))
    const low = review(card, 'good', T0, scriptedRng([0]))
    const mid = review(card, 'good', T0, scriptedRng([0.5]))
    expect(high.intervalDays).toBeCloseTo(25 * 1.05, 9) // 10 * ease(2.5) * 1.05
    expect(low.intervalDays).toBeCloseTo(25 * 0.95, 9)
    expect(mid.intervalDays).toBeCloseTo(25, 9)
  })

  it('never fuzzes the "again" relearning step', () => {
    const card = { ...newCard('c1', T0), reps: 2, intervalDays: 10, ease: 2.5 }
    const lapsed = review(card, 'again', T0, scriptedRng([1]))
    expect(lapsed.intervalDays).toBe(AGAIN_INTERVAL_DAYS)
  })
})

// ---------------------------------------------------------------------------
// dueCards
// ---------------------------------------------------------------------------

describe('dueCards', () => {
  it('returns only cards due at or before now, ordered by due, and respects a limit', () => {
    fc.assert(
      fc.property(
        fc.array(arbCard, { maxLength: 30 }),
        arbNow,
        fc.option(fc.nat(30)),
        (cards, now, limit) => {
          const result = dueCards(cards, now, limit ?? undefined)

          for (const c of result) expect(c.due).toBeLessThanOrEqual(now)
          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1]!.due).toBeLessThanOrEqual(result[i]!.due)
          }
          const expectedCount = cards.filter((c) => c.due <= now).length
          expect(result.length).toBe(
            limit === null ? expectedCount : Math.min(expectedCount, limit),
          )
        },
      ),
    )
  })

  it('rejects a negative limit as programmer error', () => {
    expect(() => dueCards([], T0, -1)).toThrow(InvariantError)
  })

  it('excludes cards due strictly after now, at the millisecond', () => {
    const cards = [newCard('a', T0), { ...newCard('b', T0), due: T0 + 1 }]
    expect(dueCards(cards, T0).map((c) => c.id)).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// retentionStats
// ---------------------------------------------------------------------------

describe('retentionStats', () => {
  it('buckets new, young and mature cards and averages ease', () => {
    const fresh = newCard('new', T0)
    const young = { ...newCard('young', T0), reps: 3, intervalDays: 5, ease: 2.0 }
    const mature = {
      ...newCard('mature', T0),
      reps: 10,
      intervalDays: MATURE_THRESHOLD_DAYS,
      ease: 3.0,
    }
    const stats = retentionStats([fresh, young, mature], T0)
    expect(stats.total).toBe(3)
    expect(stats.due).toBe(3) // all due at T0 (newCard is due immediately)
    expect(stats.young).toBe(1)
    expect(stats.mature).toBe(1)
    expect(stats.averageEase).toBeCloseTo((DEFAULT_EASE + 2.0 + 3.0) / 3, 9)
  })

  it('reports zeros for an empty deck', () => {
    expect(retentionStats([], T0)).toEqual({
      total: 0,
      due: 0,
      young: 0,
      mature: 0,
      averageEase: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// property tests
// ---------------------------------------------------------------------------

describe('properties', () => {
  it('"again" never schedules beyond one day out, for any card', () => {
    fc.assert(
      fc.property(arbCard, arbNow, (card, now) => {
        const lapsed = review(card, 'again', now)
        expect(lapsed.due - now).toBeLessThanOrEqual(DAY_MS)
        expect(lapsed.intervalDays).toBeLessThanOrEqual(1)
      }),
    )
  })

  it('"again" always shortens the interval of a card that has already graduated', () => {
    fc.assert(
      fc.property(arbGraduatedCard, arbNow, (card, now) => {
        const lapsed = review(card, 'again', now)
        expect(lapsed.intervalDays).toBeLessThan(card.intervalDays)
      }),
    )
  })

  it('"good" graded repeatedly gives strictly increasing intervals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), (n) => {
        let card = newCard('c1', T0)
        let previous = -Infinity
        for (let i = 0; i < n; i++) {
          card = review(card, 'good', T0)
          expect(card.intervalDays).toBeGreaterThan(previous)
          previous = card.intervalDays
        }
      }),
    )
  })

  it('ease never falls below EASE_FLOOR, however many lapses', () => {
    fc.assert(
      fc.property(fc.array(arbGrade, { minLength: 0, maxLength: 40 }), (grades) => {
        const card = reviewAll(newCard('c1', T0), grades)
        expect(card.ease).toBeGreaterThanOrEqual(EASE_FLOOR)
      }),
    )
  })

  it('intervals are always positive and finite, and due is always finite', () => {
    fc.assert(
      fc.property(arbCard, arbGrade, arbNow, (card, grade, now) => {
        const after = review(card, grade, now)
        expect(after.intervalDays).toBeGreaterThan(0)
        expect(Number.isFinite(after.intervalDays)).toBe(true)
        expect(Number.isFinite(after.due)).toBe(true)
      }),
    )
  })

  it('review is pure: the input card is never mutated', () => {
    fc.assert(
      fc.property(arbCard, arbGrade, arbNow, (card, grade, now) => {
        const before = { ...card }
        review(card, grade, now)
        expect(card).toEqual(before)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// day boundary
// ---------------------------------------------------------------------------

describe('day boundary', () => {
  it('scheduling is millisecond-granular, not calendar-day-granular: a card due at 23:59 and reviewed two minutes later, at 00:01 the next day, is scheduled from the review instant, not from midnight', () => {
    const midnight = Date.UTC(2026, 0, 2, 0, 0, 0) // fixture instant only, not a live clock read
    const dueAt2359 = midnight - 60_000 // 23:59 the day before
    const reviewedAt0001 = midnight + 60_000 // 00:01 the day after

    const card: Card = {
      ...newCard('c1', dueAt2359 - 10 * DAY_MS),
      due: dueAt2359,
      intervalDays: 10,
      reps: 3,
    }
    const after = review(card, 'good', reviewedAt0001)

    // Anchored at the review instant, not snapped to any day boundary.
    expect(after.due).toBe(reviewedAt0001 + after.intervalDays * DAY_MS)
    // Two minutes of "lateness" changes nothing about how far out the next
    // review is scheduled — no midnight rollover logic exists to trip over.
    const onTime = review(card, 'good', dueAt2359)
    expect(after.intervalDays).toBe(onTime.intervalDays)
  })
})
