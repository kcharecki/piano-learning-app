/**
 * `readingRun.ts`'s pure helpers — the arithmetic and the wording, tested
 * without a running trainer. `useReadingTrainer.test.ts` covers these wired
 * into a live run; this file covers the awkward cases and the exact wording.
 */
import { describe, expect, it } from 'vitest'
import { gradeGrooveRun, type GroovePadResult, type GrooveHit, type GrooveRunResult } from '@core/drums/practice/grade.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { generateReadingExercise } from '@core/drums/reading/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import { accuracyOf, nextSeed, readingResultLines, readingSlipQuantity } from './readingRun.ts'

/**
 * A stub plan for the verdict/detail tests below, which never read `slip` —
 * `readingResultLines` now requires a plan argument for the slip sentence,
 * but these fixed-result cases carry `slipSteps: undefined` and so never
 * reach it. The slip sentence itself gets its own `describe` block below,
 * built from a REAL plan via `planGrooveRun`.
 */
const UNUSED_PLAN: Pick<GrooveRunPlan, 'beatMs' | 'nominalSubdivisionMs'> = {
  beatMs: 500,
  nominalSubdivisionMs: 250,
}

function row(overrides: Partial<GroovePadResult> = {}): GroovePadResult {
  return {
    pad: 'snare',
    expected: 8,
    hits: 8,
    matched: 8,
    missed: 0,
    extra: 0,
    slipped: 0,
    meanOffsetMs: 0,
    spreadMs: 0,
    driftMs: 0,
    // DR-07 tail added this required field to `GroovePadResult`; unread here.
    displacementSteps: 0,
    // Velocity-dynamics builder made `dynamics` required on `GroovePadResult`;
    // zeroed and unread here — this file never asserts on dynamics wording.
    dynamics: { graded: 0, wrong: 0, softWanted: 0, loudWanted: 0, ghostInstants: 0, accentInstants: 0, unclassified: 0 },
    ...overrides,
  }
}

function result(overrides: Partial<GrooveRunResult> & { pads?: readonly GroovePadResult[] } = {}): GrooveRunResult {
  return {
    steady: true,
    totalHits: 8,
    pads: [row()],
    unison: [],
    articulation: [],
    slipSteps: undefined,
    limits: { spreadMs: 40, driftMs: 50, flamMs: 50 },
    ...overrides,
  }
}

describe('accuracyOf', () => {
  it('is matched over expected on the snare row', () => {
    expect(accuracyOf(result({ pads: [row({ expected: 8, matched: 6 })] }))).toBeCloseTo(0.75)
  })

  it('is 0 when nothing was expected, never a division by zero', () => {
    expect(accuracyOf(result({ pads: [row({ pad: 'snare', expected: 0, matched: 0 })] }))).toBe(0)
  })

  it('is 0 when the snare row is entirely absent', () => {
    expect(accuracyOf(result({ pads: [] }))).toBe(0)
  })

  it('ignores any non-snare row (pad-agnostic grading only ever produces one, but stay defensive)', () => {
    expect(
      accuracyOf(result({ pads: [row({ pad: 'kick', expected: 4, matched: 4 })] })),
    ).toBe(0)
  })
})

describe('readingResultLines', () => {
  it('says Clean at or above 0.9 accuracy on a steady run', () => {
    const r = result({ steady: true, pads: [row({ expected: 8, matched: 8 })] })
    expect(readingResultLines(r, 1, UNUSED_PLAN).verdict).toBe('Clean')
  })

  it('says Getting there at or above 0.9 accuracy when the run was not steady', () => {
    const r = result({ steady: false, pads: [row({ expected: 8, matched: 8 })] })
    expect(readingResultLines(r, 1, UNUSED_PLAN).verdict).toBe('Getting there')
  })

  it('says Getting there between 0.6 and 0.9', () => {
    const r = result({ steady: true, pads: [row({ expected: 8, matched: 6 })] })
    expect(readingResultLines(r, 0.75, UNUSED_PLAN).verdict).toBe('Getting there')
  })

  it('says Not there yet below 0.6', () => {
    const r = result({ steady: false, pads: [row({ expected: 8, matched: 3 })] })
    expect(readingResultLines(r, 0.375, UNUSED_PLAN).verdict).toBe('Not there yet')
  })

  it('names the count, what was missed and extra, and the offset with its sign', () => {
    const r = result({
      pads: [row({ expected: 8, matched: 7, missed: 1, extra: 2, meanOffsetMs: -12.4 })],
    })
    expect(readingResultLines(r, 7 / 8, UNUSED_PLAN).detail).toBe(
      '7 of 8 onsets, 1 missed, 2 extra · early by 12 ms on average',
    )
  })

  it('reads late for a positive offset', () => {
    const r = result({ pads: [row({ expected: 4, matched: 4, meanOffsetMs: 9.6 })] })
    expect(readingResultLines(r, 1, UNUSED_PLAN).detail).toBe('4 of 4 onsets · late by 10 ms on average')
  })

  it('omits the offset clause entirely when nothing matched to average', () => {
    const r = result({
      steady: false,
      pads: [row({ expected: 4, matched: 0, missed: 4, meanOffsetMs: undefined })],
    })
    expect(readingResultLines(r, 0, UNUSED_PLAN).detail).toBe('0 of 4 onsets, 4 missed')
  })

  it('omits missed and extra clauses when both are zero', () => {
    const r = result({ pads: [row({ expected: 4, matched: 4, meanOffsetMs: 0 })] })
    expect(readingResultLines(r, 1, UNUSED_PLAN).detail).toBe('4 of 4 onsets · late by 0 ms on average')
  })
})

/**
 * A real generated exercise, planned at a fixed tempo — the slip tests below
 * play it back through the actual `gradeGrooveRun`, offsetting every hit by
 * whole `nominalSubdivisionMs` steps, so `slipSteps` come from the plan the
 * exercise actually produced, never a hand-typed number. Level 2 (`Eighths`)
 * at this seed puts at least one 'ee' (two eighths) cell in the score, so
 * `plan.nominalSubdivisionMs` lands on an eighth note rather than a whole
 * beat.
 */
const SEED = 1
const BPM = 80
const SCORE = generateReadingExercise({ level: 2, measures: 2, id: 'test' }, seededRng(SEED))
const PLAN = planGrooveRun(SCORE, BPM, { gradedBars: SCORE.measures.length })

/**
 * `useGrooveRun.hit()`'s own acceptance window, in ms relative to
 * `gradedOrigin` (which is what every `expectedMs` is already measured
 * from) — see that hook's module comment, "A hit is accepted by the clock,
 * not by the phase": `[-windowMs, gradedMs + windowMs]`. Round-2 review: a
 * hit list built without this bound can grade a shift the running app would
 * never actually record (the learner's stroke would simply not register),
 * so every hit list below is filtered through it before grading.
 */
function withinAcceptanceWindow(ms: number, plan: Pick<GrooveRunPlan, 'windowMs' | 'gradedMs'>): boolean {
  return ms >= -plan.windowMs && ms <= plan.gradedMs + plan.windowMs
}

/** Every onset `plan` expects on the snare row, shifted by `offsetMs` and dropped if that shift falls outside `withinAcceptanceWindow`. */
function shiftedSnareHits(plan: GrooveRunPlan, offsetMs: number): readonly GrooveHit[] {
  const padPlan = plan.pads.find((p) => p.pad === 'snare')
  return (padPlan?.expectedMs ?? [])
    .map((ms) => ms + offsetMs)
    .filter((ms) => withinAcceptanceWindow(ms, plan))
    .map((ms) => ({ pad: 'snare' as const, ms }))
}

describe('readingResultLines slip sentence (DR-08, round 2 review)', () => {
  it('has no slip key when every onset lands exactly on the grid', () => {
    const result = gradeGrooveRun(PLAN, shiftedSnareHits(PLAN, 0))
    expect(result.slipSteps === undefined || result.slipSteps === 0).toBe(true)
    const lines = readingResultLines(result, accuracyOf(result), PLAN)
    expect('slip' in lines).toBe(false)
  })

  it('has no slip key for a flat offset smaller than the match window', () => {
    const result = gradeGrooveRun(PLAN, shiftedSnareHits(PLAN, PLAN.windowMs / 2))
    expect(result.slipSteps === undefined || result.slipSteps === 0).toBe(true)
    const lines = readingResultLines(result, accuracyOf(result), PLAN)
    expect('slip' in lines).toBe(false)
  })

  // Hard-coded expected strings below (never built with `stepName`/`plural`
  // in-test) — the review found the round-1 tests tautological because they
  // computed the expected sentence with the SAME helpers production uses.

  it('level 2 seed 1: one nominal step late names "1 eighth" on both halves of the sentence', () => {
    const result = gradeGrooveRun(PLAN, shiftedSnareHits(PLAN, PLAN.nominalSubdivisionMs))
    expect(result.slipSteps).toBe(1)
    const lines = readingResultLines(result, accuracyOf(result), PLAN)
    expect(lines.slip).toBe(
      'You sat 1 eighth behind the click. Most of your onsets were on the grid, 1 eighth late.',
    )
  })

  it('level 2 seed 1: two nominal steps late names "2 eighths" on both halves (R3 — no more hard-coded "one")', () => {
    const result = gradeGrooveRun(PLAN, shiftedSnareHits(PLAN, 2 * PLAN.nominalSubdivisionMs))
    expect(result.slipSteps).toBe(2)
    const lines = readingResultLines(result, accuracyOf(result), PLAN)
    expect(lines.slip).toBe(
      'You sat 2 eighths behind the click. Most of your onsets were on the grid, 2 eighths late.',
    )
  })

  it('level 1 seed 5 bpm 80: one nominal step early names "2 beats", not "1 beat" (R1)', () => {
    const score = generateReadingExercise({ level: 1, measures: 2, id: 'r1-fixture' }, seededRng(5))
    const plan = planGrooveRun(score, 80, { gradedBars: score.measures.length })
    // The review's own fixture: a gap of two beats (four eighths) between
    // notated onsets at this level/seed/tempo, so a one-nominal-step slip is
    // a two-BEAT slip, not one — the bug `readingSlipQuantity` exists to fix.
    // Fail loudly, not silently, if the generator or planner ever changes
    // this exercise out from under the hard-coded sentence below.
    if (plan.beatMs !== 750 || plan.nominalSubdivisionMs !== 1500) {
      throw new Error(
        'fixture drift: level 1 seed 5 bpm 80 no longer plans to beatMs 750 / ' +
          `nominalSubdivisionMs 1500 (got ${plan.beatMs} / ${plan.nominalSubdivisionMs}) — ` +
          'recompute the hard-coded sentence in this test against the new plan',
      )
    }
    const result = gradeGrooveRun(plan, shiftedSnareHits(plan, -plan.nominalSubdivisionMs))
    expect(result.slipSteps).toBe(-1)
    const lines = readingResultLines(result, accuracyOf(result), plan)
    expect(lines.slip).toBe(
      'You sat 2 beats ahead of the click. Most of your onsets were on the grid, 2 beats early.',
    )
  })

  it('R2: never claims every onset was on the grid, and the detail line drops "on average" once a slip fires', () => {
    // Exactly `SLIP_COVERAGE`'s own floor (0.75): 6 of this plan's 8 onsets
    // played, one nominal step late. `runSlipSteps`'s gate is `< expectedTotal
    // * SLIP_COVERAGE`, not `<=`, so 6/8 === 0.75 still agrees on a
    // whole-pattern slip — but 2 of 8 expected instants got no hit at all,
    // so "Every onset was on the grid" was a false claim for this exact run.
    const allOnsetsLate = shiftedSnareHits(PLAN, PLAN.nominalSubdivisionMs)
    const playedSixOfEight = allOnsetsLate.slice(0, 6)
    const result = gradeGrooveRun(PLAN, playedSixOfEight)
    expect(result.slipSteps).toBe(1)

    const lines = readingResultLines(result, accuracyOf(result), PLAN)
    expect(lines.slip).toContain('Most of your onsets were on the grid')
    expect(lines.slip).not.toContain('Every onset')
    expect(lines.detail).toContain('missed')
    expect(lines.detail).not.toContain('on average')
  })
})

/**
 * Round-3 review RED-4: `stepName(beatMs, nominalSubdivisionMs)` only has
 * three buckets (>=3.5 sixteenth, >=1.5 eighth, else beat), so it silently
 * misnamed two of the ratios levels 5–7 actually produce — 160 ticks
 * (triplet eighth, ratio 3) read as "eighth", and 360 ticks (dotted eighth,
 * ratio 4/3) read as "beat". `readingSlipQuantity` no longer calls it.
 *
 * `TICKS_PER_QUARTER` is 480 — see `@core/shared/units.ts` — so each named
 * grid's `beatMs / nominalSubdivisionMs` ratio is fixed regardless of tempo:
 * this table is that fixed mapping, independent of `readingRun.ts`'s own
 * `SUB_BEAT_GRID_NAMES` (typed out again here, not imported, so a mistake in
 * one does not launder the other).
 */
const TICKS_TO_UNIT_NAME: ReadonlyMap<number, string> = new Map([
  [60, 'thirty-second'],
  [80, 'triplet sixteenth'],
  [120, 'sixteenth'],
  [160, 'triplet eighth'],
  [240, 'eighth'],
  [360, 'dotted eighth'],
])

/** `ticks * msPerTick`, `msPerTick = beatMs / TICKS_PER_QUARTER` (480). */
function ticksToMs(ticks: number, beatMs: number): number {
  return (ticks / 480) * beatMs
}

describe('readingSlipQuantity unit words (round 3 review, hard-coded table)', () => {
  const BEAT_MS = 750 // bpm 80

  // Typed out by hand from the review's own fixture ticks, never computed
  // through `readingSlipQuantity`, `stepName` or `plural` — a table test
  // that built its expectations with the same helpers under test would pass
  // even if both were wrong the same way (this is exactly how round 1's
  // sub-beat property test slipped through vacuous).
  const EXPECTED: ReadonlyArray<readonly [ticks: number, steps: number, expected: string]> = [
    [120, 1, '1 sixteenth'],
    [120, 2, '2 sixteenths'],
    [160, 1, '1 triplet eighth'],
    [160, 2, '2 triplet eighths'],
    [240, 1, '1 eighth'],
    [240, 2, '2 eighths'],
    [360, 1, '1 dotted eighth'],
    [360, 2, '2 dotted eighths'],
    [480, 1, '1 beat'],
    [480, 2, '2 beats'],
    [720, 1, '1.5 beats'],
    [720, 2, '3 beats'],
    [960, 1, '2 beats'],
    [960, 2, '4 beats'],
    [1440, 1, '3 beats'],
    [1440, 2, '6 beats'],
    [1920, 1, '4 beats'],
    [1920, 2, '8 beats'],
  ]

  it.each(EXPECTED)('ticks=%i steps=%i -> %s', (ticks, steps, expected) => {
    const nominalSubdivisionMs = ticksToMs(ticks, BEAT_MS)
    expect(readingSlipQuantity(steps, BEAT_MS, nominalSubdivisionMs)).toBe(expected)
  })
})

describe('readingSlipQuantity (round 3 property test, non-vacuous on the sub-beat half)', () => {
  it('the quantity names the grid a test-local table (keyed on nominalSubdivisionTicks) predicts, for levels 1-7, seeds 1..40, bpm 80, steps 1..3', () => {
    const bpm = 80
    const gridHistogram = new Map<number, number>()

    for (const level of [1, 2, 3, 4, 5, 6, 7] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const score = generateReadingExercise({ level, measures: 2, id: `prop3-${level}-${seed}` }, seededRng(seed))
        const plan = planGrooveRun(score, bpm, { gradedBars: score.measures.length })
        const ticks = plan.nominalSubdivisionTicks
        gridHistogram.set(ticks, (gridHistogram.get(ticks) ?? 0) + 1)

        for (let steps = 1; steps <= 3; steps++) {
          const quantity = readingSlipQuantity(steps, plan.beatMs, plan.nominalSubdivisionMs)

          if (ticks < 480) {
            // Sub-beat grid: the word must be the ONE this ticks value names
            // (or its plural) — never silently accepted as "beat" or as some
            // other sub-beat name, which is what made round 1's version of
            // this property vacuous (it only ever checked the ms value, and
            // a wrong unit word still multiplies out to the right ms).
            const name = TICKS_TO_UNIT_NAME.get(ticks)
            expect(name, `unnamed sub-beat ticks value ${ticks} at level ${level} seed ${seed}`).toBeDefined()
            const wordForm = steps === 1 ? (name as string) : `${name as string}s`
            expect(quantity).toBe(`${steps} ${wordForm}`)
          } else {
            expect(quantity).toMatch(/ beats?$/)
          }

          // The ms invariant still holds regardless of wording.
          const match = /^(\d+(?:\.\d+)?)/.exec(quantity)
          expect(match).not.toBeNull()
          const count = Number(match?.[1])
          const unitMs = ticks < 480 ? plan.nominalSubdivisionMs : plan.beatMs
          expect(count * unitMs).toBeCloseTo(steps * plan.nominalSubdivisionMs, 5)
        }
      }
    }

    // The histogram itself (how many (level, seed) pairs hit each grid) is
    // reported in the RETURN, not printed here — `no-console` only allows
    // warn/error, and this is informational, not a failure signal. Assert
    // it is non-empty so `gridHistogram` stays a real check, not dead code.
    expect(gridHistogram.size).toBeGreaterThan(0)
  })
})

describe('readingRun slip sentence, round-3 hard-coded triplet-eighth fixture', () => {
  it('finds a level-7 seed whose grid is 160 ticks (triplet eighth) and names it correctly', () => {
    const bpm = 80
    let found: { seed: number; plan: GrooveRunPlan } | undefined
    for (let seed = 1; seed <= 200 && found === undefined; seed++) {
      const score = generateReadingExercise({ level: 7, measures: 2, id: `r3-${seed}` }, seededRng(seed))
      const plan = planGrooveRun(score, bpm, { gradedBars: score.measures.length })
      if (plan.nominalSubdivisionTicks === 160) found = { seed, plan }
    }
    if (found === undefined) {
      throw new Error('fixture drift: no level-7 seed in 1..200 plans to a 160-tick (triplet eighth) grid any more')
    }

    const result = gradeGrooveRun(found.plan, shiftedSnareHits(found.plan, found.plan.nominalSubdivisionMs))
    expect(result.slipSteps).toBe(1)
    const lines = readingResultLines(result, accuracyOf(result), found.plan)
    expect(lines.slip).toBe(
      'You sat 1 triplet eighth behind the click. Most of your onsets were on the grid, 1 triplet eighth late.',
    )
  })
})

describe('nextSeed', () => {
  it('is deterministic: the same seed always advances to the same next seed', () => {
    expect(nextSeed(1)).toBe(nextSeed(1))
  })

  it('advances to a different seed than it started from', () => {
    expect(nextSeed(1)).not.toBe(1)
  })

  it('is a pure function of its input only, independent of call order', () => {
    const a = nextSeed(42)
    const b = nextSeed(7)
    expect(nextSeed(42)).toBe(a)
    expect(nextSeed(7)).toBe(b)
  })
})
