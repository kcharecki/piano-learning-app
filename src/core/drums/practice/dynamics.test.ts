/**
 * `padDynamics` (roadmap DR-07 tail / DR-03). Every velocity below is
 * produced by `velocityClassOf`/`defaultVelocityForClass` themselves, never
 * hand-typed, so a threshold change can't silently desync the fixtures from
 * the code they exercise.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_VELOCITY_THRESHOLDS, defaultVelocityForClass, velocityClassOf, type VelocityThresholds } from '@core/drums/model/velocity.ts'
import type { DynamicsClass } from '@core/drums/model/groove.ts'
import { padDynamics, type GradedDynamicsMatch } from './dynamics.ts'

const ACCENT_VELOCITY = defaultVelocityForClass('accent')
const GHOST_VELOCITY = defaultVelocityForClass('ghost')
const NORMAL_VELOCITY = defaultVelocityForClass('normal')

/**
 * Independent oracle for the two over-accenting fields (RED-1), built from
 * the same public `velocityClassOf` the SUT reads — never a re-typed
 * threshold — so every fixture below states what the function must produce
 * rather than a hand-picked number. Mirrors the shape of the property test's
 * own oracle further down.
 */
function expectedNormalCounts(
  matches: readonly GradedDynamicsMatch[],
  expectedDynamics: readonly DynamicsClass[],
  thresholds?: VelocityThresholds,
): { normalInstants: number; loudNormals: number } {
  let normalInstants = 0
  let loudNormals = 0
  for (const match of matches) {
    if (expectedDynamics[match.expectedIndex] !== 'normal' || match.velocity === undefined) continue
    normalInstants += 1
    if (velocityClassOf(match.velocity, thresholds) === 'accent') loudNormals += 1
  }
  return { normalInstants, loudNormals }
}

describe('padDynamics', () => {
  it('grades nothing and reports nothing wrong when there are no matches', () => {
    expect(padDynamics([], [])).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts([], []),
    })
  })

  it('never grades a note notated normal, no matter the velocity — but DOES count it for over-accenting (RED-1)', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['normal']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: ACCENT_VELOCITY }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('counts a correctly-played accent as graded and not wrong', () => {
    expect(velocityClassOf(ACCENT_VELOCITY)).toBe('accent') // sanity: the fixture actually is an accent velocity
    const expectedDynamics: readonly DynamicsClass[] = ['accent']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: ACCENT_VELOCITY }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 1,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 1,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('counts a correctly-played ghost as graded and not wrong', () => {
    expect(velocityClassOf(GHOST_VELOCITY)).toBe('ghost')
    const expectedDynamics: readonly DynamicsClass[] = ['ghost']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: GHOST_VELOCITY }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 1,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 1,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('counts a ghost played too loud as wrong + softWanted, not loudWanted', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['ghost']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: ACCENT_VELOCITY }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 1,
      wrong: 1,
      softWanted: 1,
      loudWanted: 0,
      ghostInstants: 1,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('counts an accent played too soft as wrong + loudWanted, not softWanted', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['accent']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: GHOST_VELOCITY }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 1,
      wrong: 1,
      softWanted: 0,
      loudWanted: 1,
      ghostInstants: 0,
      accentInstants: 1,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  // Review round 3, RED 3: a mouse-clicked on-screen pad carries no velocity
  // at all, and that stroke must be UNCLASSIFIED — excluded from grading
  // entirely — not assumed 'normal'. Assuming 'normal' told a mouse learner
  // on a ghost-funk groove "16 of 16 ghost notes came out full" with no way
  // to have played it wrong (or right): a false, unactionable verdict.

  it('an absent velocity against an expected ghost is excluded from grading but counted as unclassified', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['ghost']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: undefined }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 1,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('an absent velocity against an expected accent is excluded from grading but counted as unclassified', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['accent']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: undefined }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 1,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('an absent velocity against an expected normal is excluded too, and is NOT counted as unclassified — a normal instant is never anyone\'s business', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['normal']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: undefined }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('an absent velocity never contributes to graded/ghostInstants/accentInstants even mixed with graded strokes, but does contribute to unclassified', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['ghost', 'accent']
    const matches: readonly GradedDynamicsMatch[] = [
      { expectedIndex: 0, velocity: undefined }, // ghost instant, unclassified — excluded from grading
      { expectedIndex: 1, velocity: ACCENT_VELOCITY }, // accent instant, correctly played
    ]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 1,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 1,
      unclassified: 1,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('a mid-band velocity ("normal") is wrong against either an accent or a ghost', () => {
    expect(velocityClassOf(NORMAL_VELOCITY)).toBe('normal')
    const accentDynamics: readonly DynamicsClass[] = ['accent']
    const ghostDynamics: readonly DynamicsClass[] = ['ghost']
    const accentMatches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: NORMAL_VELOCITY }]
    const ghostMatches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: NORMAL_VELOCITY }]
    const accentMatch = padDynamics(accentMatches, accentDynamics)
    const ghostMatch = padDynamics(ghostMatches, ghostDynamics)
    expect(accentMatch).toEqual({
      graded: 1,
      wrong: 1,
      softWanted: 0,
      loudWanted: 1,
      ghostInstants: 0,
      accentInstants: 1,
      unclassified: 0,
      ...expectedNormalCounts(accentMatches, accentDynamics),
    })
    expect(ghostMatch).toEqual({
      graded: 1,
      wrong: 1,
      softWanted: 1,
      loudWanted: 0,
      ghostInstants: 1,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts(ghostMatches, ghostDynamics),
    })
  })

  it('sums independently over several matched strokes on the same pad', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['accent', 'ghost', 'ghost', 'normal']
    const matches: readonly GradedDynamicsMatch[] = [
      { expectedIndex: 0, velocity: ACCENT_VELOCITY }, // correct accent
      { expectedIndex: 1, velocity: GHOST_VELOCITY }, // correct ghost
      { expectedIndex: 2, velocity: ACCENT_VELOCITY }, // ghost played too loud
      { expectedIndex: 3, velocity: ACCENT_VELOCITY }, // normal: never graded, but IS an over-accented plain stroke
    ]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 3,
      wrong: 1,
      softWanted: 1,
      loudWanted: 0,
      ghostInstants: 2,
      accentInstants: 1,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  it('ignores a match whose expectedIndex is out of range for expectedDynamics', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['accent']
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 5, velocity: ACCENT_VELOCITY }]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 0,
      ...expectedNormalCounts(matches, expectedDynamics),
    })
  })

  describe('over-accenting (RED-1): normalInstants/loudNormals', () => {
    it('an all-normal plan with every instant played loud: every instant counted, none graded/wrong', () => {
      const expectedDynamics: readonly DynamicsClass[] = ['normal', 'normal', 'normal', 'normal']
      const loudEverywhere = defaultVelocityForClass('accent')
      expect(velocityClassOf(loudEverywhere)).toBe('accent') // sanity: this fixture's velocity really is loud
      const matches: readonly GradedDynamicsMatch[] = expectedDynamics.map((_dynamicsClass, expectedIndex) => ({
        expectedIndex,
        velocity: loudEverywhere,
      }))
      const { normalInstants, loudNormals } = expectedNormalCounts(matches, expectedDynamics)
      expect(padDynamics(matches, expectedDynamics)).toEqual({
        graded: 0,
        wrong: 0,
        softWanted: 0,
        loudWanted: 0,
        ghostInstants: 0,
        accentInstants: 0,
        unclassified: 0,
        normalInstants,
        loudNormals,
      })
      // Both new fields cover every instant in this all-normal, all-loud fixture.
      expect(normalInstants).toBe(expectedDynamics.length)
      expect(loudNormals).toBe(expectedDynamics.length)
    })

    it('a mixed plan: over-accenting is counted only on the normal instants, never on the accent/ghost ones', () => {
      const expectedDynamics: readonly DynamicsClass[] = ['accent', 'normal', 'ghost', 'normal']
      const matches: readonly GradedDynamicsMatch[] = [
        { expectedIndex: 0, velocity: ACCENT_VELOCITY }, // correct accent — not a normal instant
        { expectedIndex: 1, velocity: ACCENT_VELOCITY }, // normal instant played loud — over-accented
        { expectedIndex: 2, velocity: GHOST_VELOCITY }, // correct ghost — not a normal instant
        { expectedIndex: 3, velocity: GHOST_VELOCITY }, // normal instant played soft — not over-accented
      ]
      const { normalInstants, loudNormals } = expectedNormalCounts(matches, expectedDynamics)
      expect(padDynamics(matches, expectedDynamics)).toEqual({
        graded: 2,
        wrong: 0,
        softWanted: 0,
        loudWanted: 0,
        ghostInstants: 1,
        accentInstants: 1,
        unclassified: 0,
        normalInstants,
        loudNormals,
      })
      expect(normalInstants).toBe(2)
      expect(loudNormals).toBe(1)
    })

    it('an unclassified normal instant (no velocity) is not counted in normalInstants either', () => {
      const expectedDynamics: readonly DynamicsClass[] = ['normal']
      const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 0, velocity: undefined }]
      const { normalInstants, loudNormals } = expectedNormalCounts(matches, expectedDynamics)
      expect(padDynamics(matches, expectedDynamics)).toEqual({
        graded: 0,
        wrong: 0,
        softWanted: 0,
        loudWanted: 0,
        ghostInstants: 0,
        accentInstants: 0,
        unclassified: 0,
        normalInstants,
        loudNormals,
      })
      expect(normalInstants).toBe(0)
      expect(loudNormals).toBe(0)
    })
  })

  const dynamicsClass = fc.constantFrom<DynamicsClass>('accent', 'normal', 'ghost')
  const velocityOrAbsent = fc.option(fc.integer({ min: 1, max: 127 }), { nil: undefined })

  it('property: wrong is always exactly softWanted + loudWanted, graded is always exactly ghostInstants + accentInstants, and softWanted/loudWanted never exceed their own kind\'s instant count', () => {
    fc.assert(
      fc.property(
        fc.array(dynamicsClass, { minLength: 0, maxLength: 12 }),
        fc.array(velocityOrAbsent, { minLength: 0, maxLength: 12 }),
        (expectedDynamics, velocities) => {
          const matches: readonly GradedDynamicsMatch[] = velocities.map((velocity, expectedIndex) => ({
            expectedIndex,
            velocity,
          }))
          const result = padDynamics(matches, expectedDynamics)
          expect(result.wrong).toBe(result.softWanted + result.loudWanted)
          expect(result.wrong).toBeLessThanOrEqual(result.graded)
          expect(result.graded).toBeLessThanOrEqual(matches.length)
          expect(result.softWanted).toBeGreaterThanOrEqual(0)
          expect(result.loudWanted).toBeGreaterThanOrEqual(0)
          // Coordinator fix: graded splits exactly into the two per-kind
          // instant counts, and each kind's wrong count is bounded by its
          // own denominator — never by `graded` (both kinds combined),
          // which is what let the resultLines sentence overstate ghost
          // notes against a denominator that also counted accents.
          expect(result.graded).toBe(result.ghostInstants + result.accentInstants)
          expect(result.softWanted).toBeLessThanOrEqual(result.ghostInstants)
          expect(result.loudWanted).toBeLessThanOrEqual(result.accentInstants)
          expect(result.ghostInstants).toBeGreaterThanOrEqual(0)
          expect(result.accentInstants).toBeGreaterThanOrEqual(0)
          // Review round 3, RED 3: an unclassified (absent-velocity) match is
          // excluded from grading entirely, so `graded` can never exceed the
          // count of matches that both (a) point at a non-'normal' instant and
          // (b) carry a velocity.
          const classifiable = velocities.filter(
            (velocity, expectedIndex) => velocity !== undefined && expectedDynamics[expectedIndex] !== undefined && expectedDynamics[expectedIndex] !== 'normal',
          ).length
          expect(result.graded).toBeLessThanOrEqual(classifiable)

          // RED (mouse-only ghost-funk false pass): `unclassified` is the
          // OTHER half of every matched non-'normal' stroke — never negative,
          // never counting a stroke on a 'normal' instant (there is nothing to
          // classify there, graded or not), and together with `graded` it
          // accounts for every matched stroke that landed on an accent/ghost
          // instant, whether or not that stroke carried a velocity.
          expect(result.unclassified).toBeGreaterThanOrEqual(0)
          // `matchedOnNonNormal` deliberately excludes every match pointing at
          // a 'normal' instant (or an out-of-range index) — a stroke on a
          // 'normal' instant is nobody's business, graded or unclassified,
          // which this equation pins directly: were a 'normal'-instant match
          // ever counted into `unclassified`, this sum would exceed the true
          // non-'normal' match count instead of equalling it exactly.
          const matchedOnNonNormal = velocities.filter(
            (_velocity, expectedIndex) => expectedDynamics[expectedIndex] !== undefined && expectedDynamics[expectedIndex] !== 'normal',
          ).length
          expect(result.graded + result.unclassified).toBe(matchedOnNonNormal)

          // RED-1 (over-accenting): loudNormals is a subset of normalInstants
          // by construction — every velocity-carrying normal instant either
          // classifies 'accent' (counted in both) or does not (counted in
          // neither).
          expect(result.normalInstants).toBeGreaterThanOrEqual(0)
          expect(result.loudNormals).toBeGreaterThanOrEqual(0)
          expect(result.loudNormals).toBeLessThanOrEqual(result.normalInstants)
        },
      ),
      { seed: 20260919, numRuns: 200 },
    )
  })

  it('property: wrong/softWanted/loudWanted are unaffected by any velocity played on a normal instant', () => {
    fc.assert(
      fc.property(
        fc.array(dynamicsClass, { minLength: 0, maxLength: 12 }),
        fc.array(velocityOrAbsent, { minLength: 0, maxLength: 12 }),
        (expectedDynamics, velocities) => {
          const matches: readonly GradedDynamicsMatch[] = velocities.map((velocity, expectedIndex) => ({
            expectedIndex,
            velocity,
          }))
          // Same matches, but every velocity sitting on a 'normal' instant is
          // cleared to undefined — DR-03's contract (unchanged by RED-1) is
          // that a groove/rudiment never penalises touch on a plain stroke,
          // so wrong/softWanted/loudWanted must read identically either way.
          const withoutNormalVelocities: readonly GradedDynamicsMatch[] = matches.map((match) =>
            expectedDynamics[match.expectedIndex] === 'normal' ? { expectedIndex: match.expectedIndex, velocity: undefined } : match,
          )
          const withVelocities = padDynamics(matches, expectedDynamics)
          const without = padDynamics(withoutNormalVelocities, expectedDynamics)
          expect(withVelocities.wrong).toBe(without.wrong)
          expect(withVelocities.softWanted).toBe(without.softWanted)
          expect(withVelocities.loudWanted).toBe(without.loudWanted)
          expect(withVelocities.graded).toBe(without.graded)
          expect(withVelocities.ghostInstants).toBe(without.ghostInstants)
          expect(withVelocities.accentInstants).toBe(without.accentInstants)
          expect(withVelocities.unclassified).toBe(without.unclassified)
        },
      ),
      { seed: 20260919, numRuns: 200 },
    )
  })

  it('property: a note graded only ever has expected class accent or ghost, per velocityClassOf agreement', () => {
    fc.assert(
      fc.property(
        fc.array(dynamicsClass, { minLength: 1, maxLength: 12 }),
        fc.array(velocityOrAbsent, { minLength: 1, maxLength: 12 }),
        fc.constantFrom(DEFAULT_VELOCITY_THRESHOLDS, { ghostMax: 40, accentMin: 110 }),
        (expectedDynamics, velocities, thresholds) => {
          const matches: readonly GradedDynamicsMatch[] = velocities.map((velocity, expectedIndex) => ({
            expectedIndex,
            velocity,
          }))
          const result = padDynamics(matches, expectedDynamics, thresholds)
          // Recompute independently over the same inputs, reading only the
          // public classifier — an oracle built from the SUT's own
          // dependency, not a re-typed constant.
          let graded = 0
          let unclassified = 0
          let softWanted = 0
          let loudWanted = 0
          let ghostInstants = 0
          let accentInstants = 0
          let normalInstants = 0
          let loudNormals = 0
          for (const match of matches) {
            const expected = expectedDynamics[match.expectedIndex]
            if (expected === undefined) continue
            if (expected === 'normal') {
              if (match.velocity !== undefined) {
                normalInstants += 1
                if (velocityClassOf(match.velocity, thresholds) === 'accent') loudNormals += 1
              }
              continue
            }
            if (match.velocity === undefined) {
              unclassified += 1 // RED: would have been graded had it carried a velocity
              continue
            }
            graded += 1
            if (expected === 'ghost') ghostInstants += 1
            else accentInstants += 1
            const played = velocityClassOf(match.velocity, thresholds)
            if (played === expected) continue
            if (expected === 'ghost') softWanted += 1
            else loudWanted += 1
          }
          expect(result).toEqual({
            graded,
            wrong: softWanted + loudWanted,
            softWanted,
            loudWanted,
            ghostInstants,
            accentInstants,
            unclassified,
            normalInstants,
            loudNormals,
          })
        },
      ),
      { seed: 20260919, numRuns: 200 },
    )
  })
})
