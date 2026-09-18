/**
 * `loop.ts` — pure pass arithmetic for the groove trainer's loop mode
 * (roadmap DR-09 "loop"). No clock, no hook, no grading: only "which pass",
 * "when does it open", "when can it be graded".
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { passGradeableAt, passOfHit, passOrigin } from './loop.ts'

/**
 * A minimal, hand-built plan: one pad, whatever notated instants the test
 * needs, `gradedMs` and `windowMs` set explicitly rather than derived from a
 * tempo. Every real `GrooveRunPlan` keeps `windowMs` at most half of
 * `subdivisionMs` (`plan.ts`'s own invariant) and `gradedMs` — a whole bar or
 * more — far larger than that; the fixtures below keep the same shape so
 * "at most one boundary is ever in play" keeps holding.
 */
function makePlan(
  gradedMs: number,
  windowMs: number,
  expectedMs: readonly number[],
): GrooveRunPlan {
  const sorted = [...expectedMs].sort((a, b) => a - b)
  return {
    grooveId: 'test-groove',
    title: 'Test Groove',
    bpm: 80,
    beatMs: gradedMs / 8,
    barMs: gradedMs / 2,
    countInBars: 1,
    countInBeats: 4,
    gradedBars: 2,
    gradedMs,
    subdivisionMs: windowMs * 2,
    // Placeholder: loop.ts never reads ticks, so msPerTick 1 keeps
    // subdivisionMs === subdivisionTicks * msPerTick and expectedNominalTicks
    // numerically equal to the (straight) expectedMs below.
    subdivisionTicks: windowMs * 2,
    nominalSubdivisionTicks: windowMs * 2,
    nominalSubdivisionMs: windowMs * 2,
    msPerTick: 1,
    windowMs,
    toleranceMs: windowMs,
    // Straight fixture: nominal instants equal the swung ones (`swingPercent: 50` below).
    pads: [
      {
        pad: 'kick',
        loopTicks: [],
        expectedMs: sorted,
        expectedNominalMs: sorted,
        expectedNominalTicks: sorted,
      },
    ],
    unisonPairs: [],
    swingPercent: 50,
    swing: { percent: 50, unit: 'eighth', measureTicks: 1920, beats: 4, beatType: 4 },
  }
}

/**
 * Like `makePlan`, but spreads the given instant groups across 1-3 pads
 * instead of concentrating them all on one `kick` — used by the property
 * suite below (MINOR e).
 */
function makePlanWithPads(
  gradedMs: number,
  windowMs: number,
  padsExpectedMs: readonly (readonly number[])[],
): GrooveRunPlan {
  const padNames = ['kick', 'snare', 'hhClosed'] as const
  return {
    grooveId: 'test-groove',
    title: 'Test Groove',
    bpm: 80,
    beatMs: gradedMs / 8,
    barMs: gradedMs / 2,
    countInBars: 1,
    countInBeats: 4,
    gradedBars: 2,
    gradedMs,
    subdivisionMs: windowMs * 2,
    // Placeholder, as in `makePlan` above.
    subdivisionTicks: windowMs * 2,
    nominalSubdivisionTicks: windowMs * 2,
    nominalSubdivisionMs: windowMs * 2,
    msPerTick: 1,
    windowMs,
    toleranceMs: windowMs,
    // Straight fixture: nominal instants equal the swung ones (`swingPercent: 50` below).
    pads: padsExpectedMs.map((expectedMs, i) => {
      const sorted = [...expectedMs].sort((a, b) => a - b)
      return {
        pad: padNames[i % padNames.length] ?? 'kick',
        loopTicks: [],
        expectedMs: sorted,
        expectedNominalMs: sorted,
        expectedNominalTicks: sorted,
      }
    }),
    unisonPairs: [],
    swingPercent: 50,
    swing: { percent: 50, unit: 'eighth', measureTicks: 1920, beats: 4, beatType: 4 },
  }
}

describe('passOrigin', () => {
  it('is pass * gradedMs, so passes abut with no gap', () => {
    const plan = makePlan(6000, 100, [0, 1500, 3000, 4500])
    expect(passOrigin(plan, 0)).toBe(0)
    expect(passOrigin(plan, 1)).toBe(6000)
    expect(passOrigin(plan, 2)).toBe(12000)
  })
})

describe('passGradeableAt', () => {
  it('is the pass end plus the window, so a late last stroke still counts', () => {
    const plan = makePlan(6000, 100, [0, 1500, 3000, 4500])
    expect(passGradeableAt(plan, 0)).toBe(6100)
    expect(passGradeableAt(plan, 1)).toBe(12100)
  })
})

describe('passOfHit', () => {
  it('is floor(ms / gradedMs) away from every boundary', () => {
    const plan = makePlan(6000, 100, [0, 1500, 3000, 4500])
    expect(passOfHit(plan, 3000)).toBe(0)
    expect(passOfHit(plan, 6500)).toBe(1)
    expect(passOfHit(plan, 11800)).toBe(1)
    expect(passOfHit(plan, 12500)).toBe(2)
  })

  it('never goes below 0, even for a hit well before the first origin', () => {
    const plan = makePlan(6000, 100, [0, 1500, 3000, 4500])
    expect(passOfHit(plan, -50)).toBe(0)
    expect(passOfHit(plan, -6000)).toBe(0)
  })

  it('assigns a hit exactly on an expected instant of pass k to k', () => {
    const plan = makePlan(6000, 100, [0, 1500, 3000, 4500])
    // Pass 2's instant at offset 1500 -> absolute ms 2*6000+1500 = 13500.
    expect(passOfHit(plan, 13500)).toBe(2)
  })

  /**
   * The scenario the module comment calls out by name: pass k has a notated
   * instant right at its own start (0), and pass k-1 has nothing anywhere
   * near the boundary (its instants are far from its own end) — so a hit at
   * the boundary, or within the window past it, goes to k, not k-1.
   */
  it('sends a boundary hit to pass k when k has an instant at 0 and k-1 has none nearby', () => {
    const plan = makePlan(6000, 100, [0, 3000])
    // Boundary between pass 0 and pass 1 is at 6000. Pass 1's instant at
    // offset 0 is exactly there; pass 0's nearest instant is at 3000 (offset
    // 3000), 3000 ms away — nowhere near windowMs. A hit right at the
    // boundary, and one 80 ms after it, both belong to pass 1.
    expect(passOfHit(plan, 6000)).toBe(1)
    expect(passOfHit(plan, 6080)).toBe(1)
  })

  /**
   * The mirror scenario: pass k-1 has a notated instant right at its own end
   * (gradedMs) and pass k has nothing near its own start — a late last stroke
   * of pass k-1 stays in k-1.
   */
  it('keeps a late last stroke in pass k-1 when k has no instant near its own start', () => {
    const plan = makePlan(6000, 100, [3000, 5990])
    // Pass 0's instant at offset 5990 sits 10 ms before the boundary at 6000;
    // pass 1's nearest instant is at offset 3000 (absolute 9000), nowhere
    // near the boundary. A hit 5 ms past pass 0's own late instant stays in
    // pass 0.
    expect(passOfHit(plan, 5995)).toBe(0)
  })

  it('breaks a genuine tie by choosing the later pass', () => {
    // Pass 0's instant at offset 5950 sits 50 ms before the boundary; pass
    // 1's instant at offset 50 sits 50 ms after it (absolute 6050) —
    // equidistant from a hit exactly on the boundary. The later pass wins:
    // it is the only one of the two still ungraded when a hit like this
    // arrives (MINOR a).
    const plan = makePlan(6000, 100, [50, 5950])
    expect(passOfHit(plan, 6000)).toBe(1)
  })
})

describe('passOfHit — properties', () => {
  /**
   * A plan with 1-3 pads (MINOR e: a single pad hid any bug that only shows
   * up when a boundary hit has to pick among several pads' instants) whose
   * instants range across the WHOLE pass — up to `gradedMs - subdivisionMs`,
   * so the late-final-stroke branch (a notated instant close to a pass's own
   * end, not just near its start) is actually generated for the larger
   * `gradedMs` values, not only ones under 2000.
   */
  const planArb = fc
    .record({
      gradedMs: fc.integer({ min: 2000, max: 8000 }),
      windowMs: fc.integer({ min: 10, max: 100 }),
      padCount: fc.integer({ min: 1, max: 3 }),
    })
    .chain(({ gradedMs, windowMs, padCount }) =>
      fc
        .array(
          fc.uniqueArray(fc.integer({ min: 0, max: gradedMs - windowMs * 2 }), {
            minLength: 1,
            maxLength: 6,
          }),
          { minLength: padCount, maxLength: padCount },
        )
        .map((padsExpectedMs) => makePlanWithPads(gradedMs, windowMs, padsExpectedMs)),
    )

  it('is never negative', () => {
    fc.assert(
      fc.property(planArb, fc.integer({ min: -20_000, max: 40_000 }), (plan, ms) => {
        expect(passOfHit(plan, ms)).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  it('equals floor(ms / gradedMs) whenever ms is more than windowMs from every boundary', () => {
    fc.assert(
      fc.property(planArb, fc.integer({ min: -20_000, max: 40_000 }), (plan, ms) => {
        const nearestBoundaryDistance = Math.abs(
          ms - Math.round(ms / plan.gradedMs) * plan.gradedMs,
        )
        fc.pre(nearestBoundaryDistance > plan.windowMs)
        fc.pre(ms >= 0)
        expect(passOfHit(plan, ms)).toBe(Math.floor(ms / plan.gradedMs))
      }),
    )
  })

  it('is non-decreasing in ms', () => {
    fc.assert(
      fc.property(
        planArb,
        fc.integer({ min: -20_000, max: 40_000 }),
        fc.integer({ min: -20_000, max: 40_000 }),
        (plan, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a]
          expect(passOfHit(plan, lo)).toBeLessThanOrEqual(passOfHit(plan, hi))
        },
      ),
    )
  })

  it('assigns a hit exactly on an expected instant of pass k to k', () => {
    fc.assert(
      fc.property(planArb, fc.integer({ min: 0, max: 5 }), (plan, pass) => {
        const instant = plan.pads[0]?.expectedMs[0]
        if (instant === undefined) return
        const ms = passOrigin(plan, pass) + instant
        expect(passOfHit(plan, ms)).toBe(pass)
      }),
    )
  })

  /**
   * The load-bearing property (MINOR e): whichever pass a hit is filed
   * under, its offset from THAT pass's own origin is never more than one
   * window early or one whole pass-plus-window late. A `passOfHit` that
   * assigned a hit to some far-off pass — the kind of bug a fixed, narrow
   * example set would not surface — fails this immediately.
   */
  it('keeps a hit within one pass width (plus the boundary windows) of its own pass origin', () => {
    fc.assert(
      fc.property(
        planArb.chain((plan) =>
          fc.tuple(fc.constant(plan), fc.integer({ min: -plan.windowMs, max: 40_000 })),
        ),
        ([plan, ms]) => {
          const pass = passOfHit(plan, ms)
          const offset = ms - passOrigin(plan, pass)
          expect(offset).toBeGreaterThanOrEqual(-plan.windowMs)
          expect(offset).toBeLessThanOrEqual(plan.gradedMs + plan.windowMs)
        },
      ),
    )
  })
})

describe('passGradeableAt — properties', () => {
  const planArb = fc
    .record({
      gradedMs: fc.integer({ min: 2000, max: 8000 }),
      windowMs: fc.integer({ min: 10, max: 100 }),
    })
    .map(({ gradedMs, windowMs }) => makePlan(gradedMs, windowMs, [0]))

  /** MINOR e: a pass only ever becomes MORE gradeable as time moves forward, and never before it has even closed. */
  it('is strictly increasing in pass, and always after that pass has closed', () => {
    fc.assert(
      fc.property(planArb, fc.integer({ min: 0, max: 20 }), (plan, pass) => {
        expect(passGradeableAt(plan, pass + 1)).toBeGreaterThan(passGradeableAt(plan, pass))
        expect(passGradeableAt(plan, pass)).toBeGreaterThan(passOrigin(plan, pass + 1))
      }),
    )
  })
})
