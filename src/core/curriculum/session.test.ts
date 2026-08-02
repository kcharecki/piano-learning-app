import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { Exercise, ExerciseKind } from '@core/curriculum/types.ts'
import { isOk } from '@core/shared/result.ts'
import {
  SESSION_LENGTHS,
  planSession,
  type SessionPlanOptions,
  type SessionSegmentKind,
} from './session.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SEGMENTS: readonly SessionSegmentKind[] = [
  'technique',
  'sight-reading',
  'lesson',
  'theory-ear',
]

const KIND_OF: Readonly<Record<SessionSegmentKind, ExerciseKind>> = {
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

/** Full candidate set: a few exercises per segment, each ~5 minutes. */
function fullCandidates(): SessionPlanOptions['candidates'] {
  return {
    technique: [exercise('technique', 1), exercise('technique', 2)],
    'sight-reading': [exercise('sight-reading', 1), exercise('sight-reading', 2)],
    lesson: [exercise('lesson', 1), exercise('lesson', 2)],
    'theory-ear': [exercise('theory-ear', 1), exercise('theory-ear', 2)],
  }
}

const sumItems = (items: readonly { minutes: number }[]): number =>
  items.reduce((sum, item) => sum + item.minutes, 0)

const sumBySegment = (bySegment: Readonly<Record<SessionSegmentKind, number>>): number =>
  SEGMENTS.reduce((sum, seg) => sum + bySegment[seg], 0)

// ---------------------------------------------------------------------------
// worked examples — DEFAULT_MIX, literal expected minutes
// ---------------------------------------------------------------------------

describe('planSession — worked examples against DEFAULT_MIX', () => {
  it('15 minutes: 3/3/6/3', () => {
    const result = planSession(15, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      technique: 3,
      'sight-reading': 3,
      lesson: 6,
      'theory-ear': 3,
    })
    expect(result.value.totalMinutes).toBe(15)
    expect(sumItems(result.value.items)).toBe(15)
  })

  it('30 minutes: 6/6/12/6', () => {
    const result = planSession(30, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      technique: 6,
      'sight-reading': 6,
      lesson: 12,
      'theory-ear': 6,
    })
    expect(sumItems(result.value.items)).toBe(30)
  })

  it('60 minutes: 12/12/24/12', () => {
    const result = planSession(60, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      technique: 12,
      'sight-reading': 12,
      lesson: 24,
      'theory-ear': 12,
    })
    expect(sumItems(result.value.items)).toBe(60)
  })

  it('plans every SESSION_LENGTHS entry to the exact 20/20/40/20 split, summing to the length', () => {
    for (const length of SESSION_LENGTHS) {
      const result = planSession(length, { candidates: fullCandidates() })
      expect(isOk(result)).toBe(true)
      if (!result.ok) continue
      expect(sumItems(result.value.items)).toBe(length)
      expect(result.value.bySegment).toEqual({
        technique: Math.round(length * 0.2),
        'sight-reading': Math.round(length * 0.2),
        lesson: Math.round(length * 0.4),
        'theory-ear': Math.round(length * 0.2),
      })
    }
  })

  it('7 minutes: exercises the largest-remainder tie-break literally (2/1/3/1)', () => {
    // exact shares: 1.4 / 1.4 / 2.8 / 1.4 — floors 1/1/2/1 (sum 5), remainder 2.
    // largest remainder is lesson (0.8) -> +1. Remaining tie at 0.4 among
    // technique/sight-reading/theory-ear broken by segment order -> technique +1.
    const result = planSession(7, { candidates: fullCandidates() })
    expect(isOk(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.bySegment).toEqual({
      technique: 2,
      'sight-reading': 1,
      lesson: 3,
      'theory-ear': 1,
    })
    expect(sumItems(result.value.items)).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// redistribution when a segment has no candidates
// ---------------------------------------------------------------------------

describe('planSession — redistribution over segments with candidates', () => {
  it('gives a learner with no repertoire a full-length session, redistributed proportionally', () => {
    const candidates: SessionPlanOptions['candidates'] = {
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
          expect(sumBySegment(result.value.bySegment)).toBe(totalMinutes)
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
            technique: emptySegments.includes('technique') ? [] : full.technique,
            'sight-reading': emptySegments.includes('sight-reading')
              ? []
              : full['sight-reading'],
            lesson: emptySegments.includes('lesson') ? [] : full.lesson,
            'theory-ear': emptySegments.includes('theory-ear') ? [] : full['theory-ear'],
          }
          const result = planSession(totalMinutes, { candidates, mix })
          // planSession legitimately rejects a plan it cannot fill at all:
          // every segment emptied out, or — the subtler case, and the one that
          // made this property fail intermittently before it was written down
          // — a mix whose shares happen to be zero for exactly the segments
          // that DO still have candidates. There is nothing to redistribute
          // toward in either case, and inventing an even split would silently
          // override an explicit "none of this" from the learner.
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
        for (const seg of SEGMENTS) {
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
})
