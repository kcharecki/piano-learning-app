import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { Exercise, ExerciseKind } from '@core/curriculum/types.ts'
import { isOk } from '@core/shared/result.ts'
import {
  SESSION_LENGTHS,
  WARMUP_MINUTES,
  planSession,
  type MixableSegmentKind,
  type SessionPlanOptions,
  type SessionSegmentKind,
} from './session.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The four mixable segments — everything except warm-up (see session.ts's module doc). */
const SEGMENTS: readonly MixableSegmentKind[] = [
  'technique',
  'sight-reading',
  'lesson',
  'theory-ear',
]

/** All five segments `bySegment`/`items` can name, warm-up first. */
const ALL_SEGMENTS: readonly SessionSegmentKind[] = ['warmup', ...SEGMENTS]

const KIND_OF: Readonly<Record<SessionSegmentKind, ExerciseKind>> = {
  warmup: 'technique',
  technique: 'technique',
  'sight-reading': 'sight-read',
  lesson: 'play',
  'theory-ear': 'theory-quiz',
}

const exercise = (segment: SessionSegmentKind, n: number, estimatedMinutes = 5): Exercise => ({
  id: `${segment}-${n}`,
  kind: KIND_OF[segment],
  title: `${segment} exercise ${n}`,
  estimatedMinutes,
})

/** Full candidate set: a few exercises per segment, each ~5 minutes, warm-up included. */
function fullCandidates(): SessionPlanOptions['candidates'] {
  return {
    warmup: [exercise('warmup', 1)],
    technique: [exercise('technique', 1), exercise('technique', 2)],
    'sight-reading': [exercise('sight-reading', 1), exercise('sight-reading', 2)],
    lesson: [exercise('lesson', 1), exercise('lesson', 2)],
    'theory-ear': [exercise('theory-ear', 1), exercise('theory-ear', 2)],
  }
}

const sumItems = (items: readonly { minutes: number }[]): number =>
  items.reduce((sum, item) => sum + item.minutes, 0)

const sumAllSegments = (bySegment: Readonly<Record<SessionSegmentKind, number>>): number =>
  ALL_SEGMENTS.reduce((sum, seg) => sum + bySegment[seg], 0)

// ---------------------------------------------------------------------------
// worked examples — DEFAULT_MIX, literal expected minutes
//
// Roadmap 4.10: warm-up no longer reserves WARMUP_MINUTES off the top of the
// raw budget. `technique`'s own 20% share IS the combined warm-up/technique
// bucket REQ-3.1.4 names; that bucket is apportioned over the FULL budget
// exactly like sight-reading/lesson/theory-ear, and warm-up then claims up
// to WARMUP_MINUTES of technique's own bucket, technique keeping the rest.
// See session.ts's module doc, "Warm-up shares technique's bucket".
// ---------------------------------------------------------------------------

describe('planSession — worked examples against DEFAULT_MIX', () => {
  it('15 minutes: technique bucket 3 (20% of 15) -> warm-up 3, technique 0; others their plain 20/40/20', () => {
    const result = planSession(15, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      warmup: 3,
      technique: 0,
      'sight-reading': 3,
      lesson: 6,
      'theory-ear': 3,
    })
    expect(result.value.totalMinutes).toBe(15)
    expect(result.value.items[0]?.segment).toBe('warmup')
    expect(sumItems(result.value.items)).toBe(15)
  })

  it('30 minutes: technique bucket 6 -> warm-up 5 (its full length fits), technique keeps 1', () => {
    const result = planSession(30, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      warmup: 5,
      technique: 1,
      'sight-reading': 6,
      lesson: 12,
      'theory-ear': 6,
    })
    expect(sumItems(result.value.items)).toBe(30)
  })

  it('60 minutes: technique bucket 12 -> warm-up 5, technique keeps 7', () => {
    const result = planSession(60, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      warmup: 5,
      technique: 7,
      'sight-reading': 12,
      lesson: 24,
      'theory-ear': 12,
    })
    expect(sumItems(result.value.items)).toBe(60)
  })

  it('plans every SESSION_LENGTHS entry so warm-up+technique together equal the plain 20% share of the FULL budget', () => {
    for (const length of SESSION_LENGTHS) {
      const result = planSession(length, { candidates: fullCandidates() })
      expect(isOk(result)).toBe(true)
      if (!result.ok) continue
      expect(sumItems(result.value.items)).toBe(length)
      const techniqueBucket = Math.round(length * 0.2)
      expect(result.value.bySegment.warmup + result.value.bySegment.technique).toBe(techniqueBucket)
      expect(result.value.bySegment.warmup).toBe(Math.min(WARMUP_MINUTES, techniqueBucket))
      expect(result.value.bySegment).toMatchObject({
        'sight-reading': Math.round(length * 0.2),
        lesson: Math.round(length * 0.4),
        'theory-ear': Math.round(length * 0.2),
      })
    }
  })

  it('7 minutes: technique bucket floors/apportions to 2 -> warm-up 2 (bucket too small for its full 5), technique 0', () => {
    // Full budget of 7 across all four shares (.2/.2/.4/.2): exact
    // 1.4/1.4/2.8/1.4 -> floors 1/1/2/1 (sum 5), remainder 2. Largest
    // fractional remainder is lesson (0.8) -> +1. Remaining tie at 0.4 among
    // technique/sight-reading/theory-ear broken by segment order -> technique
    // +1. So the pre-warm-up technique bucket is 2 (allocateWholeMinutes is
    // unchanged by roadmap 4.10 — only what total it is fed changed).
    // Warm-up then claims min(5, 2) = 2 of that bucket, leaving technique 0.
    const result = planSession(7, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      warmup: 2,
      technique: 0,
      'sight-reading': 1,
      lesson: 3,
      'theory-ear': 1,
    })
    expect(sumItems(result.value.items)).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// warm-up segment (roadmap 5.45)
// ---------------------------------------------------------------------------

describe('planSession — warm-up segment', () => {
  it('is emitted first at every SESSION_LENGTHS budget when it has a candidate', () => {
    for (const length of SESSION_LENGTHS) {
      const result = planSession(length, { candidates: fullCandidates() })
      expect(isOk(result)).toBe(true)
      if (!result.ok) continue
      expect(result.value.items.length).toBeGreaterThan(0)
      expect(result.value.items[0]?.segment).toBe('warmup')
      expect(result.value.bySegment.warmup).toBeGreaterThan(0)
    }
  })

  it('clamps to the technique bucket when it is shorter than WARMUP_MINUTES', () => {
    // Mix isolated to technique (share 1, others 0) so the whole 3-minute
    // budget IS technique's bucket — the same shape the pre-4.10 flat
    // reservation test exercised, just via an isolated bucket instead of the
    // raw budget (see session.ts's module doc: warm-up now only ever draws
    // from technique's own share, never the budget directly).
    const result = planSession(3, {
      candidates: fullCandidates(),
      mix: { technique: 1, 'sight-reading': 0, lesson: 0, 'theory-ear': 0 },
    })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment.warmup).toBe(3)
    // Nothing left for technique, and the other three have a zero mix share.
    expect(result.value.bySegment.technique).toBe(0)
    expect(result.value.bySegment['sight-reading']).toBe(0)
    expect(result.value.bySegment.lesson).toBe(0)
    expect(result.value.bySegment['theory-ear']).toBe(0)
    expect(result.value.items).toEqual([
      { segment: 'warmup', exercise: fullCandidates().warmup[0], minutes: 3 },
    ])
  })

  it('gets zero minutes and no items when it has no candidate, and leaves the other four untouched', () => {
    const withWarmup = fullCandidates()
    const withoutWarmup: SessionPlanOptions['candidates'] = { ...withWarmup, warmup: [] }

    const a = planSession(30, { candidates: withWarmup })
    const b = planSession(30, { candidates: withoutWarmup })
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!a.ok || !b.ok) return

    expect(b.value.bySegment.warmup).toBe(0)
    expect(b.value.items.some((item) => item.segment === 'warmup')).toBe(false)
    // Technique keeps its WHOLE 6-minute bucket when warm-up declines (`a`,
    // which has a warm-up candidate, splits that same 6-minute bucket into
    // warmup 5 + technique 1 — see the worked example above) — declining
    // warm-up is exactly "technique keeps 100% of its own share", unaffected
    // by warm-up existing as a segment kind at all.
    expect(b.value.bySegment).toEqual({
      warmup: 0,
      technique: 6,
      'sight-reading': 6,
      lesson: 12,
      'theory-ear': 6,
    })
    expect(sumItems(b.value.items)).toBe(30)
  })

  it('does not rescue a plan whose four mixable segments all lack candidates', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [exercise('warmup', 1)],
      technique: [],
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(30, { candidates })
    expect(result.ok).toBe(false)
  })

  it('fills from its own candidates via the same repeat/at-least-one-item rule as any segment', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [exercise('warmup', 1, 2), exercise('warmup', 2, 2)],
      technique: [exercise('technique', 1)],
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(30, { candidates, mix: { technique: 1 } })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    const warmupItems = result.value.items.filter((item) => item.segment === 'warmup')
    // WARMUP_MINUTES (5) filled 2 + 2 + 1 (repeats from the start, never
    // splitting a minute) — identical to fillSegment's contract elsewhere.
    expect(warmupItems.map((item) => `${item.exercise.id}:${item.minutes}`)).toEqual([
      'warmup-1:2',
      'warmup-2:2',
      'warmup-1:1',
    ])
    expect(sumItems(warmupItems)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// redistribution when a segment has no candidates
// ---------------------------------------------------------------------------

describe('planSession — redistribution over segments with candidates', () => {
  it('gives a learner with no repertoire a full-length session, redistributed proportionally', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [], // isolate this case from warm-up's own reservation
      technique: [exercise('technique', 1)],
      'sight-reading': [exercise('sight-reading', 1)],
      lesson: [], // no repertoire / lesson loaded
      'theory-ear': [exercise('theory-ear', 1)],
    }
    const result = planSession(30, { candidates })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    // remaining raw shares 0.2/0.2/0.2 renormalise to 1/3 each of 30 = 10 each.
    expect(result.value.bySegment).toEqual({
      warmup: 0,
      technique: 10,
      'sight-reading': 10,
      lesson: 0,
      'theory-ear': 10,
    })
    expect(sumItems(result.value.items)).toBe(30)
    expect(result.value.items.every((item) => item.segment !== 'lesson')).toBe(true)
  })

  it('errs when no segment has any candidates at all', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [],
      technique: [],
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(30, { candidates })
    expect(result.ok).toBe(false)
  })

  it('errs when every candidate-bearing segment has a zero mix share', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [],
      technique: [],
      'sight-reading': [exercise('sight-reading', 1)],
      lesson: [exercise('lesson', 1)],
      'theory-ear': [],
    }
    // All weight nominally on technique/theory-ear, which have no candidates.
    const result = planSession(
      20,
      { candidates, mix: { technique: 1, 'sight-reading': 0, lesson: 0, 'theory-ear': 0 } },
    )
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// filling from candidates: repeat, never split a minute, at least one item
// ---------------------------------------------------------------------------

describe('planSession — filling a segment from its candidates', () => {
  it('repeats candidates from the start once they run out', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [],
      technique: [exercise('technique', 1, 5), exercise('technique', 2, 3)],
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(12, { candidates, mix: { technique: 1 } })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    const techItems = result.value.items.filter((item) => item.segment === 'technique')
    expect(techItems.map((item) => `${item.exercise.id}:${item.minutes}`)).toEqual([
      'technique-1:5',
      'technique-2:3',
      'technique-1:4',
    ])
    expect(sumItems(techItems)).toBe(result.value.bySegment.technique)
  })

  it('gives at least one item whenever a segment budget is >= 1 minute', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [],
      technique: [exercise('technique', 1, 999)], // estimate far exceeds budget
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(15, { candidates, mix: { technique: 1 } })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    const techItems = result.value.items.filter((item) => item.segment === 'technique')
    expect(techItems.length).toBe(1)
    expect(techItems[0]?.minutes).toBe(15)
  })

  it('floors the estimate to at least one minute, never hanging on a zero/sub-minute estimate', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [],
      technique: [exercise('technique', 1, 0)],
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(15, { candidates, mix: { technique: 1 } })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    const techItems = result.value.items.filter((item) => item.segment === 'technique')
    expect(techItems.length).toBe(15)
    expect(techItems.every((item) => item.minutes === 1)).toBe(true)
  })

  it('rounds a sub-minute estimate rather than flooring it to zero', () => {
    const candidates: SessionPlanOptions['candidates'] = {
      warmup: [],
      technique: [exercise('technique', 1, 0.4)],
      'sight-reading': [],
      lesson: [],
      'theory-ear': [],
    }
    const result = planSession(10, { candidates, mix: { technique: 1 } })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    const techItems = result.value.items.filter((item) => item.segment === 'technique')
    expect(techItems.every((item) => item.minutes === 1)).toBe(true)
    expect(techItems.length).toBe(10)
  })

  it('never allocates a fractional minute to any item', () => {
    const result = planSession(11, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    for (const item of result.value.items) {
      expect(Number.isInteger(item.minutes)).toBe(true)
      expect(item.minutes).toBeGreaterThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe('planSession — validation', () => {
  it.each([0, -1, -0.5, NaN, Infinity, -Infinity])(
    'errs on a non-positive or non-finite budget: %p',
    (bad) => {
      const result = planSession(bad, { candidates: fullCandidates() })
      expect(result.ok).toBe(false)
    },
  )

  // A fractional budget (e.g. derived from elapsed seconds) is floored to
  // whole minutes rather than rejected — the contract names no such error.
  it('floors a fractional budget to whole minutes instead of erring', () => {
    const result = planSession(15.5, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.totalMinutes).toBe(15)
    expect(sumItems(result.value.items)).toBe(15)
  })

  it('errs when the mix normalises to zero', () => {
    const result = planSession(30, {
      candidates: fullCandidates(),
      mix: { technique: 0, 'sight-reading': 0, lesson: 0, 'theory-ear': 0 },
    })
    expect(result.ok).toBe(false)
  })

  it('errs on a negative share', () => {
    const result = planSession(30, {
      candidates: fullCandidates(),
      mix: { technique: -0.1 },
    })
    expect(result.ok).toBe(false)
  })

  it('accepts a budget outside SESSION_LENGTHS (adjustable by the user)', () => {
    const result = planSession(45, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// property tests
// ---------------------------------------------------------------------------

const shareArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

const mixArb = fc
  .record({
    technique: shareArb,
    'sight-reading': shareArb,
    lesson: shareArb,
    'theory-ear': shareArb,
  })
  .filter((mix) => SEGMENTS.reduce((sum, seg) => sum + mix[seg], 0) > 0)

describe('planSession — properties', () => {
  it('item minutes always sum to exactly totalMinutes, for any budget 5..120 and any valid mix', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 120 }),
        mixArb,
        (totalMinutes, mix) => {
          const result = planSession(totalMinutes, { candidates: fullCandidates(), mix })
          expect(isOk(result)).toBe(true)
          if (!result.ok) return
          expect(sumItems(result.value.items)).toBe(totalMinutes)
          expect(sumAllSegments(result.value.bySegment)).toBe(totalMinutes)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('is deterministic: identical inputs produce an identical plan', () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 120 }), mixArb, (totalMinutes, mix) => {
        const candidates = fullCandidates()
        const a = planSession(totalMinutes, { candidates, mix })
        const b = planSession(totalMinutes, { candidates, mix })
        expect(a).toEqual(b)
      }),
      { numRuns: 200 },
    )
  })

  it('redistributes away from any segment with no candidates, keeping the total exact', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 120 }),
        mixArb,
        fc.subarray([...SEGMENTS], { minLength: 1 }),
        (totalMinutes, mix, emptySegments) => {
          const full = fullCandidates()
          const candidates: SessionPlanOptions['candidates'] = {
            warmup: full.warmup,
            technique: emptySegments.includes('technique') ? [] : full.technique,
            'sight-reading': emptySegments.includes('sight-reading')
              ? []
              : full['sight-reading'],
            lesson: emptySegments.includes('lesson') ? [] : full.lesson,
            'theory-ear': emptySegments.includes('theory-ear') ? [] : full['theory-ear'],
          }
          const result = planSession(totalMinutes, { candidates, mix })
          // planSession legitimately rejects a plan it cannot fill at all:
          // every mixable segment emptied out, or — the subtler case, and the
          // one that made this property fail intermittently before it was
          // written down — a mix whose shares happen to be zero for exactly
          // the segments that DO still have candidates. Warm-up (always
          // present here) cannot rescue either case — see session.ts's module
          // doc — so the expectation is unaffected by it.
          const remainingShare = SEGMENTS.filter((seg) => !emptySegments.includes(seg)).reduce(
            (sum, seg) => sum + mix[seg],
            0,
          )
          if (emptySegments.length === SEGMENTS.length || remainingShare === 0) {
            expect(result.ok).toBe(false)
            return
          }
          expect(isOk(result)).toBe(true)
          if (!result.ok) return
          for (const seg of emptySegments) {
            expect(result.value.bySegment[seg]).toBe(0)
          }
          expect(sumItems(result.value.items)).toBe(totalMinutes)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('every item minute count is a positive integer, and every segment with budget >= 1 has an item', () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 120 }), mixArb, (totalMinutes, mix) => {
        const result = planSession(totalMinutes, { candidates: fullCandidates(), mix })
        expect(isOk(result)).toBe(true)
        if (!result.ok) return
        for (const item of result.value.items) {
          expect(Number.isInteger(item.minutes)).toBe(true)
          expect(item.minutes).toBeGreaterThanOrEqual(1)
        }
        for (const seg of ALL_SEGMENTS) {
          const budget = result.value.bySegment[seg]
          const segItems = result.value.items.filter((item) => item.segment === seg)
          if (budget >= 1) {
            expect(segItems.length).toBeGreaterThanOrEqual(1)
          } else {
            expect(segItems.length).toBe(0)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  it('warm-up is present and first whenever it has a candidate and technique\'s isolated bucket is the whole budget, at any budget 1..120', () => {
    // Mix isolated to technique (share 1, others 0), same isolation trick as
    // the "clamps to the technique bucket" unit test above — this is what
    // makes "the bucket IS the whole budget" true so `Math.min(WARMUP_MINUTES,
    // totalMinutes)` is the right-hand side, reproducing the pre-4.10
    // invariant exactly for this isolated case.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), (totalMinutes) => {
        const result = planSession(totalMinutes, {
          candidates: fullCandidates(),
          mix: { technique: 1, 'sight-reading': 0, lesson: 0, 'theory-ear': 0 },
        })
        expect(isOk(result)).toBe(true)
        if (!result.ok) return
        expect(result.value.bySegment.warmup).toBe(Math.min(WARMUP_MINUTES, totalMinutes))
        if (result.value.bySegment.warmup > 0) {
          expect(result.value.items[0]?.segment).toBe('warmup')
        }
      }),
      { numRuns: 200 },
    )
  })

  it('warm-up never exceeds WARMUP_MINUTES nor technique\'s own shared bucket, at any budget and any valid mix (roadmap 4.10)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), mixArb, (totalMinutes, mix) => {
        const result = planSession(totalMinutes, { candidates: fullCandidates(), mix })
        expect(isOk(result)).toBe(true)
        if (!result.ok) return
        const techniqueBucket = result.value.bySegment.warmup + result.value.bySegment.technique
        expect(result.value.bySegment.warmup).toBeLessThanOrEqual(WARMUP_MINUTES)
        expect(result.value.bySegment.warmup).toBe(Math.min(WARMUP_MINUTES, techniqueBucket))
      }),
      { numRuns: 300 },
    )
  })
})
