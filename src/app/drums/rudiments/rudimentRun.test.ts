import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { RUDIMENTS } from '@content/drums/rudiments.ts'
import type { GroovePadResult, GrooveRunResult } from '@core/drums/practice/grade.ts'
import { padDynamics, type GradedDynamicsMatch, type PadDynamicsResult } from '@core/drums/practice/dynamics.ts'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import type { Rudiment } from '@core/drums/rudiment/index.ts'
import type { TempoLadderState } from '@core/drums/rudiment/index.ts'
import { RUDIMENT_CLEAN_EVENNESS, rudimentToScore } from '@core/drums/rudiment/index.ts'
import {
  accentLine,
  barsOf,
  cyclesForBars,
  evennessText,
  isCleanPass,
  ladderText,
  measuresOnly,
  rudimentAccents,
  stickingPreview,
  type RudimentAccentResult,
} from './rudimentRun.ts'

const BAR_TICKS = 1920

function paradiddle(): Rudiment {
  const rudiment = RUDIMENTS.find((r) => r.id === 'single-paradiddle')
  if (rudiment === undefined) throw new Error('fixture missing: single-paradiddle')
  return rudiment
}

/** RED-A (round 3): the reviewer's own example of an unaccented rudiment — notates no 'accent' dynamics class at all. */
function singleStrokeRoll(): Rudiment {
  const rudiment = RUDIMENTS.find((r) => r.id === 'single-stroke-roll')
  if (rudiment === undefined) throw new Error('fixture missing: single-stroke-roll')
  return rudiment
}

function padRow(overrides: Partial<GroovePadResult> = {}): GroovePadResult {
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
    // DR-07 tail / DR-03 added this required field to `GroovePadResult`;
    // also unread here — this trainer has no dynamics-aware sentence.
    dynamics: {
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 0,
      normalInstants: 0,
      loudNormals: 0,
    },
    ...overrides,
  }
}

function result(overrides: Partial<GrooveRunResult> = {}): GrooveRunResult {
  return {
    steady: true,
    totalHits: 8,
    pads: [padRow()],
    unison: [],
    articulation: [],
    slipSteps: undefined,
    limits: { spreadMs: 20, driftMs: 20, flamMs: 30 },
    ...overrides,
  }
}

function ladder(overrides: Partial<TempoLadderState> = {}): TempoLadderState {
  return {
    bpm: 80,
    direction: 'up',
    cleanStreak: 0,
    failStreak: 0,
    bestCleanBpm: undefined,
    history: [],
    done: false,
    ...overrides,
  }
}

describe('cyclesForBars', () => {
  it('fills exactly `bars` bars for every bundled rudiment, whenever its patternTicks allows it', () => {
    for (const rudiment of RUDIMENTS) {
      const cycles = cyclesForBars(rudiment, 2)
      expect(cycles).toBeGreaterThanOrEqual(1)
      const bars = barsOf(rudiment, cycles)
      // Always a whole number of bars, whatever the count.
      expect(Number.isInteger(bars)).toBe(true)
      expect(bars).toBeGreaterThanOrEqual(1)
      // barsOf's own arithmetic must agree with the ticks cyclesForBars picked.
      expect((cycles * rudiment.patternTicks) / BAR_TICKS).toBe(bars)
    }
  })

  it('picks exactly 2 bars when patternTicks divides 2 bars evenly (single-stroke-roll: 960 ticks)', () => {
    const rudiment = RUDIMENTS.find((r) => r.id === 'single-stroke-roll')
    if (rudiment === undefined) throw new Error('fixture missing')
    const cycles = cyclesForBars(rudiment, 2)
    expect(barsOf(rudiment, cycles)).toBe(2)
  })

  it('falls back to the smallest whole-bar span when patternTicks does not divide 2 bars (double-paradiddle: 1440 ticks -> 3 bars)', () => {
    const rudiment = RUDIMENTS.find((r) => r.id === 'double-paradiddle')
    if (rudiment === undefined) throw new Error('fixture missing')
    expect(rudiment.patternTicks).toBe(1440)
    const cycles = cyclesForBars(rudiment, 2)
    expect(barsOf(rudiment, cycles)).toBe(3)
  })

  it('falls back for seventeen-stroke-roll (2400 ticks -> 5 bars)', () => {
    const rudiment = RUDIMENTS.find((r) => r.id === 'seventeen-stroke-roll')
    if (rudiment === undefined) throw new Error('fixture missing')
    expect(rudiment.patternTicks).toBe(2400)
    const cycles = cyclesForBars(rudiment, 2)
    expect(barsOf(rudiment, cycles)).toBe(5)
  })
})

describe('stickingPreview', () => {
  it('reads a paradiddle as its letters, space separated', () => {
    expect(stickingPreview(paradiddle())).toBe('R L R R L R L L')
  })
})

describe('isCleanPass', () => {
  it('is true for a steady run with no missed or extra hits, played evenly', () => {
    expect(isCleanPass(result(), 1, 8)).toBe(true)
    expect(isCleanPass(result(), RUDIMENT_CLEAN_EVENNESS, 8)).toBe(true)
  })

  it('is false when the run was not steady, even with no missed/extra rows', () => {
    expect(isCleanPass(result({ steady: false }), 1, 8)).toBe(false)
  })

  it('is false when any pad missed a hit', () => {
    expect(isCleanPass(result({ pads: [padRow({ missed: 1 })] }), 1, 8)).toBe(false)
  })

  it('is false when any pad played an extra hit', () => {
    expect(isCleanPass(result({ pads: [padRow({ extra: 1 })] }), 1, 8)).toBe(false)
  })

  it('is false when the run was otherwise clean but the strokes were not even enough', () => {
    expect(isCleanPass(result(), RUDIMENT_CLEAN_EVENNESS - 0.01, 8)).toBe(false)
  })
})

describe('evennessText', () => {
  it('reports the percentage and an even-enough verdict at or above the clean bar', () => {
    expect(evennessText(1)).toBe('Evenness 100% — even enough')
    expect(evennessText(RUDIMENT_CLEAN_EVENNESS)).toBe('Evenness 80% — even enough')
  })

  it('reports the percentage and an uneven verdict below the clean bar', () => {
    expect(evennessText(0.5)).toBe('Evenness 50% — uneven: one gap was well off the rest')
  })
})

describe('measuresOnly', () => {
  it('is false for a rudiment with no articulated strokes', () => {
    expect(measuresOnly(paradiddle())).toBe(false)
  })

  it('is true for a rudiment with a flam/drag/buzz articulation', () => {
    const flam = RUDIMENTS.find((r) => r.id === 'flam')
    if (flam === undefined) throw new Error('fixture missing: flam')
    expect(measuresOnly(flam)).toBe(true)
  })
})

function dynamicsFixture(overrides: Partial<PadDynamicsResult> = {}): PadDynamicsResult {
  return {
    graded: 0,
    wrong: 0,
    softWanted: 0,
    loudWanted: 0,
    ghostInstants: 0,
    accentInstants: 0,
    unclassified: 0,
    normalInstants: 0,
    loudNormals: 0,
    ...overrides,
  }
}

describe('isCleanPass — DR-10 accents (dynamics.wrong gate)', () => {
  it('is false when a graded stroke on the row came out the wrong velocity class', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 2, wrong: 1 }) })]
    expect(isCleanPass(result({ pads }), 1, 8)).toBe(false)
  })

  it('is true when graded strokes all matched their notated velocity class (wrong 0)', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 2, wrong: 0 }) })]
    expect(isCleanPass(result({ pads }), 1, 8)).toBe(true)
  })

  it('is unaffected by unclassified (no-velocity) strokes on an accent instant — only `wrong` blocks a clean pass', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 0, unclassified: 3 }) })]
    expect(isCleanPass(result({ pads }), 1, 8)).toBe(true)
  })
})

describe('isCleanPass — RED-1 over-accenting gate (dynamics.loudNormals)', () => {
  it('is false for an otherwise-steady/complete/even run when any pad over-accented a plain stroke, even with wrong 0 — on a rudiment that DOES notate an accent', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 8, wrong: 0, normalInstants: 24, loudNormals: 1 }) })]
    expect(isCleanPass(result({ pads }), 1, 8)).toBe(false)
  })

  it('is true for a steady/complete/even run with wrong 0 and loudNormals 0, even with normal instants graded for velocity', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 8, wrong: 0, normalInstants: 24, loudNormals: 0 }) })]
    expect(isCleanPass(result({ pads }), 1, 8)).toBe(true)
  })
})

/**
 * RED-A (round 3): the round-2 over-accenting gate above was unconditional,
 * so an UNACCENTED rudiment — 7 of the 40 bundled rudiments, e.g. Single
 * Stroke Roll, notate none — could never pass once played loud, even though
 * there is no accent to over-hit; every one of its strokes is "plain" only
 * because the rudiment itself never notates a louder class. `notatedAccents`
 * gates the loudNormals check off entirely when the plan notates zero.
 */
describe('isCleanPass — RED-A: the over-accenting gate only applies when the rudiment notates an accent', () => {
  it('is true for an otherwise-clean run with loudNormals > 0 when notatedAccents is 0 — an unaccented rudiment is not graded on touch at all', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 0, wrong: 0, normalInstants: 16, loudNormals: 16 }) })]
    expect(isCleanPass(result({ pads }), 1, 0)).toBe(true)
  })

  it('is false for the same loudNormals > 0 run once notatedAccents > 0 — unchanged round-2 behaviour on an accented rudiment', () => {
    const pads = [padRow({ dynamics: dynamicsFixture({ graded: 0, wrong: 0, normalInstants: 16, loudNormals: 16 }) })]
    expect(isCleanPass(result({ pads }), 1, 8)).toBe(false)
  })

  it('rudimentRun-level real plan: Single Stroke Roll (notated 0 accents) played with Shift on every stroke — over-accents every plain stroke, but isCleanPass is true because notatedAccents is 0', () => {
    const rudiment = singleStrokeRoll()
    const cycles = cyclesForBars(rudiment, 2)
    const bars = barsOf(rudiment, cycles)
    const score = rudimentToScore(rudiment, cycles)
    const plan = planGrooveRun(score, 60, { gradedBars: bars })
    const snarePlan = plan.pads.find((pad) => pad.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: snare row')

    const notatedAccents = snarePlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'accent').length
    expect(notatedAccents).toBe(0) // guard: this is the "default rudiment, no accents" the review flagged

    const SHIFT_VELOCITY = 110
    const matches: readonly GradedDynamicsMatch[] = snarePlan.expectedDynamics.map((_dynamicsClass, expectedIndex) => ({
      expectedIndex,
      velocity: SHIFT_VELOCITY,
    }))
    const dynamics = padDynamics(matches, snarePlan.expectedDynamics)
    expect(dynamics.loudNormals).toBeGreaterThan(0) // guard: this run really did over-accent every stroke

    expect(isCleanPass(result({ pads: [padRow({ dynamics })] }), 1, notatedAccents)).toBe(true)
  })

  it('rudimentRun-level real plan: single-paradiddle (notated accents present) played with Shift on every stroke still fails isCleanPass — RED-A does not weaken RED-1 on an accented rudiment', () => {
    const rudiment = paradiddle()
    const cycles = cyclesForBars(rudiment, 2)
    const bars = barsOf(rudiment, cycles)
    const score = rudimentToScore(rudiment, cycles)
    const plan = planGrooveRun(score, 60, { gradedBars: bars })
    const snarePlan = plan.pads.find((pad) => pad.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: snare row')

    const notatedAccents = snarePlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'accent').length
    expect(notatedAccents).toBeGreaterThan(0)

    const SHIFT_VELOCITY = 110
    const matches: readonly GradedDynamicsMatch[] = snarePlan.expectedDynamics.map((_dynamicsClass, expectedIndex) => ({
      expectedIndex,
      velocity: SHIFT_VELOCITY,
    }))
    const dynamics = padDynamics(matches, snarePlan.expectedDynamics)

    expect(isCleanPass(result({ pads: [padRow({ dynamics })] }), 1, notatedAccents)).toBe(false)
  })
})

describe('rudimentAccents — notated count comes from the plan, not the raw rudiment', () => {
  it("matches the accent instants single-paradiddle's own plan notates on the snare row", () => {
    const rudiment = paradiddle()
    const cycles = cyclesForBars(rudiment, 2)
    const bars = barsOf(rudiment, cycles)
    const score = rudimentToScore(rudiment, cycles)
    const plan = planGrooveRun(score, 60, { gradedBars: bars })
    const snarePlan = plan.pads.find((pad) => pad.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: snare row')
    const expectedNotated = snarePlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'accent').length

    const accents = rudimentAccents(snarePlan.expectedDynamics, dynamicsFixture({ graded: expectedNotated }))
    expect(accents.notated).toBe(expectedNotated)
    // Single paradiddle accents its first stroke of four ('R L R R L R L L' -> R and L lead
    // each half) — this only holds if the fixture rudiment content actually notates accents,
    // which this assertion proves rather than assumes.
    expect(accents.notated).toBeGreaterThan(0)
  })

  /**
   * RED-1's exact scenario: the reviewer's "Single Paradiddle played with
   * Shift held on EVERY stroke" — built from a REAL `padDynamics` run
   * against the rudiment's own plan, not a hand-typed `PadDynamicsResult`,
   * so the over-accent counts below are exactly what the grading code itself
   * produces for this input, never guessed.
   */
  it('rudimentAccents on the real single-paradiddle plan, played with Shift on every stroke: over-accents every plain stroke, misses no accent, and fails isCleanPass', () => {
    const rudiment = paradiddle()
    const cycles = cyclesForBars(rudiment, 2)
    const bars = barsOf(rudiment, cycles)
    const score = rudimentToScore(rudiment, cycles)
    const plan = planGrooveRun(score, 60, { gradedBars: bars })
    const snarePlan = plan.pads.find((pad) => pad.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: snare row')

    const SHIFT_VELOCITY = 110 // above DEFAULT_VELOCITY_THRESHOLDS.accentMin (100) — classifies 'accent'
    const matches: readonly GradedDynamicsMatch[] = snarePlan.expectedDynamics.map((_dynamicsClass, expectedIndex) => ({
      expectedIndex,
      velocity: SHIFT_VELOCITY,
    }))
    const dynamics = padDynamics(matches, snarePlan.expectedDynamics)

    const notatedNormalCount = snarePlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'normal').length
    expect(notatedNormalCount).toBeGreaterThan(0) // guard: this plan really does notate plain strokes to over-accent
    expect(dynamics.normalInstants).toBe(notatedNormalCount)
    expect(dynamics.loudNormals).toBe(notatedNormalCount)

    const accents = rudimentAccents(snarePlan.expectedDynamics, dynamics)
    expect(accents.normalInstants).toBe(notatedNormalCount)
    expect(accents.loudNormals).toBe(notatedNormalCount)
    expect(accents.loudNormals).toBe(accents.normalInstants)
    expect(accents.missedAccents).toBe(0)
    expect(accents.notated).toBeGreaterThan(0) // guard: RED-A's gate is live on this rudiment, not bypassed

    expect(isCleanPass(result({ pads: [padRow({ dynamics })] }), 1, accents.notated)).toBe(false)
  })

  /**
   * RED-C's exact scenario (review round 4): the reviewer's "learner plays 16
   * of 32 strokes hard" case — a REAL `padDynamics` run against the
   * paradiddle's own plan, matching only the FIRST 16 of 32 expected instants
   * (the rest dropped entirely, never struck), at Shift velocity. Proves the
   * fix reaches `accentLine`'s real denominator, not a hand-typed fixture:
   * `normalInstants` on this run is 12 (the plain strokes among the first 16
   * that were actually hit), not the plan's full 24 notated plain strokes —
   * the exact gap RED-C's fix closes.
   */
  it('R24 (RED-C, real plan): single paradiddle, Shift on only the first 16 of 32 strokes, the rest dropped — accent line names "every plain stroke you hit", not the full notated total', () => {
    const rudiment = paradiddle()
    const cycles = cyclesForBars(rudiment, 2)
    const bars = barsOf(rudiment, cycles)
    const score = rudimentToScore(rudiment, cycles)
    const plan = planGrooveRun(score, 60, { gradedBars: bars })
    const snarePlan = plan.pads.find((pad) => pad.pad === 'snare')
    if (snarePlan === undefined) throw new Error('fixture missing: snare row')
    expect(snarePlan.expectedDynamics.length).toBe(32) // guard: this is really the 32-stroke, 2-bar plan RED-C's numbers assume

    const SHIFT_VELOCITY = 110 // above DEFAULT_VELOCITY_THRESHOLDS.accentMin (100) — classifies 'accent'
    const STRUCK_COUNT = 16
    const matches: readonly GradedDynamicsMatch[] = snarePlan.expectedDynamics
      .slice(0, STRUCK_COUNT)
      .map((_dynamicsClass, expectedIndex) => ({ expectedIndex, velocity: SHIFT_VELOCITY }))
    const dynamics = padDynamics(matches, snarePlan.expectedDynamics)

    const accents = rudimentAccents(snarePlan.expectedDynamics, dynamics)
    expect(accents.notated).toBe(8)
    expect(accents.graded).toBe(4) // 4 of the 8 notated accents fall within the first 16 strokes struck
    expect(accents.missedAccents).toBe(0)
    expect(accents.normalInstants).toBe(12) // the plain strokes actually struck — NOT the plan's full 24
    expect(accents.loudNormals).toBe(12)

    expect(accentLine(accents)).toBe(
      '4 accents landed, but every plain stroke you hit came out as an accent. Keep them soft. 4 accents were missed.',
    )
  })
})

function accentFixture(overrides: Partial<RudimentAccentResult> = {}): RudimentAccentResult {
  return { notated: 1, graded: 0, unclassified: 0, missedAccents: 0, normalInstants: 0, loudNormals: 0, ...overrides }
}

/**
 * `accentLine` regimes (DR-10 accents review — round 2: RED-2 hidden
 * denominator, RED-3 branch shadowing; round 3: RED-B, the `graded === 0`
 * early return dropping TAILS). Every fixture below is a CONTRACT REGIME,
 * not a real run: the six input numbers are hand-picked to exercise one
 * combination of HEAD + TAIL each, and the expected sentence is a
 * hard-coded literal string pinning the exact learner-facing copy — per the
 * digest, these numbers are deliberately typed by hand, unlike every other
 * count in this test file. R1-R17 carry over from round 2 (R9 and R10's own
 * expected text changed under the round-3 spec — see their comments); R18-23
 * are new round-3 regimes covering `graded === 0` combined with
 * over-accenting.
 */
describe('accentLine — regimes R1-R23', () => {
  it('R1: all accents landed, no over-accenting — plural landed, no tails', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 8, unclassified: 0, missedAccents: 0, normalInstants: 24, loudNormals: 0 })),
    ).toBe('All 8 accents landed.')
  })

  it('R2: the one accent landed — singular landed, no tails', () => {
    expect(
      accentLine(accentFixture({ notated: 1, graded: 1, unclassified: 0, missedAccents: 0, normalInstants: 7, loudNormals: 0 })),
    ).toBe('The accent landed.')
  })

  it('R3: half the accents landed, the rest never struck — landed + missed tail', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 4, unclassified: 0, missedAccents: 0, normalInstants: 12, loudNormals: 0 })),
    ).toBe('4 accents landed. 4 accents were missed.')
  })

  it('R4: one accent landed of many notated — singular-count landed + plural missed tail', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 1, unclassified: 0, missedAccents: 0, normalInstants: 3, loudNormals: 0 })),
    ).toBe('1 accent landed. 7 accents were missed.')
  })

  it('R5: some landed, the rest unclassified (mouse taps) — landed + unclassified tail, no missed tail', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 2, unclassified: 6, missedAccents: 0, normalInstants: 6, loudNormals: 0 })),
    ).toBe('2 accents landed. 6 on-screen taps carry no velocity.')
  })

  it('R6: some landed, some missed entirely, some unclassified — all three tails: landed + missed + unclassified', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 2, unclassified: 5, missedAccents: 0, normalInstants: 6, loudNormals: 0 })),
    ).toBe('2 accents landed. 1 accent was missed. 5 on-screen taps carry no velocity.')
  })

  it('R7: every accent struck but all came out soft — soft-accent HEAD, plural, no tails', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 8, unclassified: 0, missedAccents: 3, normalInstants: 24, loudNormals: 0 })),
    ).toBe('3 of the 8 accents you hit came out soft. Lean into them.')
  })

  it('R8: the one accent struck came out soft, and the rest were never struck — singular soft HEAD + missed tail', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 1, unclassified: 0, missedAccents: 1, normalInstants: 3, loudNormals: 0 })),
    ).toBe('The accent you hit came out soft. Lean into it. 7 accents were missed.')
  })

  it('R9: RED-3 exact case — soft HEAD must survive alongside a coverage (unclassified) tail; round 3 adds the missedAccents === graded "Every" form', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 2, unclassified: 6, missedAccents: 2, normalInstants: 6, loudNormals: 0 })),
    ).toBe('Every accent you hit came out soft. Lean into them. 6 on-screen taps carry no velocity.')
  })

  it('R10: RED-1 exact case — every accent landed but every plain stroke was over-accented; round 3 switches the all-loud HEAD to the "every/them" form', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 8, unclassified: 0, missedAccents: 0, normalInstants: 24, loudNormals: 24 })),
    ).toBe('All 8 accents landed, but every plain stroke you hit came out as an accent. Keep them soft.')
  })

  it('R11: soft accents AND over-accented plain strokes at once — soft HEAD + plain-stroke tail', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 8, unclassified: 0, missedAccents: 2, normalInstants: 24, loudNormals: 3 })),
    ).toBe('2 of the 8 accents you hit came out soft. Lean into them. 3 plain strokes came out as accents too.')
  })

  it('R12: the one accent landed but the one over-accented plain stroke is singular throughout', () => {
    expect(
      accentLine(accentFixture({ notated: 1, graded: 1, unclassified: 0, missedAccents: 0, normalInstants: 7, loudNormals: 1 })),
    ).toBe('The accent landed, but 1 of the 7 plain strokes you hit came out as an accent. Keep it soft.')
  })

  it('R13: landed + over-accented plain strokes + missed accents — three-part sentence, no soft-accent HEAD', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 4, unclassified: 0, missedAccents: 0, normalInstants: 12, loudNormals: 5 })),
    ).toBe('4 accents landed, but 5 of the 12 plain strokes you hit came out as accents. Keep them soft. 4 accents were missed.')
  })

  it('R14: nothing graded, everything unclassified — the not-graded literal, no tails', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 0, unclassified: 8, missedAccents: 0, normalInstants: 0, loudNormals: 0 })),
    ).toBe(
      'Accents were not graded: the on-screen pad carries no velocity. Hold Shift on the keyboard for an accent, or use an e-kit.',
    )
  })

  it('R15: an unaccented rudiment (notated 0) — undefined regardless of anything else', () => {
    expect(
      accentLine(accentFixture({ notated: 0, graded: 0, unclassified: 0, missedAccents: 0, normalInstants: 32, loudNormals: 0 })),
    ).toBeUndefined()
  })

  it('R16: nothing matched an accent instant at all, and nothing over-accented either — undefined', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 0, unclassified: 0, missedAccents: 0, normalInstants: 0, loudNormals: 0 })),
    ).toBeUndefined()
  })

  it('R17: soft HEAD + over-accented plain-stroke tail + missed tail + unclassified tail, all four parts at once', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 2, unclassified: 1, missedAccents: 1, normalInstants: 6, loudNormals: 1 })),
    ).toBe(
      '1 of the 2 accents you hit came out soft. Lean into them. 1 plain stroke came out as an accent too. 5 accents were missed. 1 on-screen tap carries no velocity.',
    )
  })

  it('R18: RED-B exact case — nothing graded, no unclassified taps, but every plain stroke over-accented: no HEAD, loud TAIL opens the sentence', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 0, unclassified: 0, missedAccents: 0, normalInstants: 24, loudNormals: 24 })),
    ).toBe('Every plain stroke you hit came out as an accent. Keep them soft. 8 accents were missed.')
  })

  it('R19: RED-B exact case — not-graded HEAD (unclassified > 0) plus over-accenting; the unclassified TAIL is suppressed as redundant with the HEAD', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 0, unclassified: 1, missedAccents: 0, normalInstants: 24, loudNormals: 24 })),
    ).toBe(
      'Accents were not graded: the on-screen pad carries no velocity. Hold Shift on the keyboard for an accent, or use an e-kit. Every plain stroke you hit came out as an accent. Keep them soft. 7 accents were missed.',
    )
  })

  it('R20: the singular over-accented-plain-stroke HEAD form, notated 1', () => {
    expect(
      accentLine(accentFixture({ notated: 1, graded: 1, unclassified: 0, missedAccents: 0, normalInstants: 1, loudNormals: 1 })),
    ).toBe('The accent landed, but the plain stroke you hit came out as an accent. Keep it soft.')
  })

  it('R21: no HEAD, partial over-accenting as the opening TAIL, plus a missed TAIL', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 0, unclassified: 0, missedAccents: 0, normalInstants: 24, loudNormals: 3 })),
    ).toBe('3 plain strokes came out as accents. Keep them soft. 8 accents were missed.')
  })

  it('R22: every graded accent came out soft, all of them, with over-accenting absent — the "Every" HEAD form alone', () => {
    expect(
      accentLine(accentFixture({ notated: 8, graded: 8, unclassified: 0, missedAccents: 8, normalInstants: 24, loudNormals: 0 })),
    ).toBe('Every accent you hit came out soft. Lean into them.')
  })

  it('R23: notated 0 wins over everything else, including live over-accenting — undefined', () => {
    expect(
      accentLine(accentFixture({ notated: 0, graded: 0, unclassified: 0, missedAccents: 0, normalInstants: 24, loudNormals: 24 })),
    ).toBeUndefined()
  })
})

describe('accentLine — property', () => {
  it('property: whenever anything matched an accent instant, the line is a real sentence — never undefined, never a zero/NaN/undefined leak', () => {
    fc.assert(
      fc.property(
        fc.record({
          notated: fc.integer({ min: 1, max: 20 }),
          graded: fc.integer({ min: 0, max: 20 }),
          unclassified: fc.integer({ min: 0, max: 20 }),
          missedAccents: fc.integer({ min: 0, max: 20 }),
          normalInstants: fc.integer({ min: 0, max: 20 }),
          loudNormals: fc.integer({ min: 0, max: 20 }),
        }),
        ({ notated, graded, unclassified, missedAccents, normalInstants, loudNormals }) => {
          // missedAccents is only meaningful up to graded, and loudNormals only
          // up to normalInstants (padDynamics' own invariant) — clamp so the
          // fixture stays representable by a real dynamics result.
          const clampedMissed = Math.min(missedAccents, graded)
          const clampedLoudNormals = Math.min(loudNormals, normalInstants)
          const accents = accentFixture({
            notated,
            graded,
            unclassified,
            missedAccents: clampedMissed,
            normalInstants,
            loudNormals: clampedLoudNormals,
          })
          const line = accentLine(accents)

          // RED-B (round 3): `graded === 0` no longer means undefined by
          // itself — only when unclassified AND the (clamped) loud count are
          // also both zero is there truly nothing to say.
          if (graded === 0 && unclassified === 0 && clampedLoudNormals === 0) {
            expect(line).toBeUndefined()
            return
          }

          expect(line).toBeDefined()
          const text = line ?? ''
          // Word-boundary regexes, not `.toContain` — a real count like "10 of"
          // must not false-positive on the digit "0" inside it.
          expect(text).not.toMatch(/\b0 of\b/)
          expect(text).not.toMatch(/\bAll 0\b/)
          expect(text).not.toMatch(/\bNaN\b/)
          expect(text).not.toMatch(/\bundefined\b/)
          // RED-2 (hidden denominator): a zero-count clause must never be
          // stated at all — it should have been omitted as a tail, not
          // printed as "0 accents were missed" / "0 on-screen taps" / "0
          // plain strokes".
          expect(text).not.toMatch(/ 0 accents were missed/)
          expect(text).not.toMatch(/ 0 on-screen/)
          expect(text).not.toMatch(/ 0 plain/)
          // Round 3: a denominator of 1 must always take the singular
          // ("the plain stroke", "an accent"), never fall through to the
          // "N of the 1" counted form (R12/R20's own point).
          expect(text).not.toMatch(/of the 1 /)
          // Round 3: a numerator equal to its own denominator must always
          // take the "every/all" form, never the counted "N of the N" form
          // (R9/R10's own point) — checked for ANY n, not just the fixed
          // examples the regimes hard-code.
          expect(text).not.toMatch(/(\d+) of the \1 /)
        },
      ),
    )
  })

  it('property: never undefined when notated > 0 and there is anything at all to report (graded, unclassified, or loud over-accenting)', () => {
    fc.assert(
      fc.property(
        fc.record({
          notated: fc.integer({ min: 1, max: 20 }),
          graded: fc.integer({ min: 0, max: 20 }),
          unclassified: fc.integer({ min: 0, max: 20 }),
          missedAccents: fc.integer({ min: 0, max: 20 }),
          normalInstants: fc.integer({ min: 0, max: 20 }),
          loudNormals: fc.integer({ min: 0, max: 20 }),
        }),
        ({ notated, graded, unclassified, missedAccents, normalInstants, loudNormals }) => {
          const clampedMissed = Math.min(missedAccents, graded)
          const clampedLoudNormals = Math.min(loudNormals, normalInstants)
          fc.pre(graded > 0 || unclassified > 0 || clampedLoudNormals > 0)
          const line = accentLine(
            accentFixture({
              notated,
              graded,
              unclassified,
              missedAccents: clampedMissed,
              normalInstants,
              loudNormals: clampedLoudNormals,
            }),
          )
          expect(line).toBeDefined()
        },
      ),
    )
  })
})

describe('ladderText', () => {
  it('reads a fresh ladder as ready, before any run', () => {
    expect(ladderText(ladder({ bpm: 60 }))).toBe('Ready at 60 bpm')
  })

  it('reports progress mid clean-streak, same bpm as the pass just graded', () => {
    const state = ladder({ bpm: 80, cleanStreak: 1, history: [{ bpm: 80, clean: true }] })
    expect(ladderText(state)).toBe('Clean 1 of 2 at 80 bpm')
  })

  it('reports the completed streak and the next bpm once the ladder steps up', () => {
    const state = ladder({
      bpm: 85,
      cleanStreak: 0,
      failStreak: 0,
      history: [
        { bpm: 80, clean: true },
        { bpm: 80, clean: true },
      ],
    })
    expect(ladderText(state)).toBe('Clean 2 of 2 at 80 bpm — next 85')
  })

  it('reports a miss and the tempo it drops to', () => {
    const state = ladder({ bpm: 75, failStreak: 1, history: [{ bpm: 80, clean: false }] })
    expect(ladderText(state)).toBe('Missed 1 of 3 at 80 bpm — next 75')
  })

  it('reports a plateau by reason, at the bpm the streak actually failed at', () => {
    const state = ladder({
      bpm: 70,
      done: true,
      reason: 'plateau',
      history: [
        { bpm: 75, clean: false },
        { bpm: 75, clean: false },
        { bpm: 75, clean: false },
      ],
    })
    expect(ladderText(state)).toBe('Plateau at 75 bpm: 3 failed passes')
  })

  it('reports a ceiling by reason', () => {
    const state = ladder({
      bpm: 200,
      done: true,
      reason: 'ceiling',
      history: [
        { bpm: 200, clean: true },
        { bpm: 200, clean: true },
      ],
    })
    expect(ladderText(state)).toBe('Ceiling at 200 bpm: top tempo held clean')
  })

  it('reports a floor by reason', () => {
    const state = ladder({
      bpm: 40,
      done: true,
      reason: 'floor',
      history: [{ bpm: 40, clean: false }],
    })
    expect(ladderText(state)).toBe('Floor at 40 bpm: cannot drop further')
  })

  it('reports completion by reason, at the bpm the descent finished on', () => {
    const state = ladder({
      bpm: 60,
      done: true,
      reason: 'completed',
      history: [
        { bpm: 60, clean: true },
        { bpm: 60, clean: true },
      ],
    })
    expect(ladderText(state)).toBe('Completed the ladder back down to 60 bpm')
  })
})
