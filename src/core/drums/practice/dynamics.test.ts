/**
 * `padDynamics` (roadmap DR-07 tail / DR-03). Every velocity below is
 * produced by `velocityClassOf`/`defaultVelocityForClass` themselves, never
 * hand-typed, so a threshold change can't silently desync the fixtures from
 * the code they exercise.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_VELOCITY_THRESHOLDS, defaultVelocityForClass, velocityClassOf } from '@core/drums/model/velocity.ts'
import type { DynamicsClass } from '@core/drums/model/groove.ts'
import { padDynamics, type GradedDynamicsMatch } from './dynamics.ts'

const ACCENT_VELOCITY = defaultVelocityForClass('accent')
const GHOST_VELOCITY = defaultVelocityForClass('ghost')
const NORMAL_VELOCITY = defaultVelocityForClass('normal')

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
    })
  })

  it('never grades a note notated normal, no matter the velocity', () => {
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
    })
  })

  it('a mid-band velocity ("normal") is wrong against either an accent or a ghost', () => {
    expect(velocityClassOf(NORMAL_VELOCITY)).toBe('normal')
    const accentMatch = padDynamics([{ expectedIndex: 0, velocity: NORMAL_VELOCITY }], ['accent'])
    const ghostMatch = padDynamics([{ expectedIndex: 0, velocity: NORMAL_VELOCITY }], ['ghost'])
    expect(accentMatch).toEqual({
      graded: 1,
      wrong: 1,
      softWanted: 0,
      loudWanted: 1,
      ghostInstants: 0,
      accentInstants: 1,
      unclassified: 0,
    })
    expect(ghostMatch).toEqual({
      graded: 1,
      wrong: 1,
      softWanted: 1,
      loudWanted: 0,
      ghostInstants: 1,
      accentInstants: 0,
      unclassified: 0,
    })
  })

  it('sums independently over several matched strokes on the same pad', () => {
    const expectedDynamics: readonly DynamicsClass[] = ['accent', 'ghost', 'ghost', 'normal']
    const matches: readonly GradedDynamicsMatch[] = [
      { expectedIndex: 0, velocity: ACCENT_VELOCITY }, // correct accent
      { expectedIndex: 1, velocity: GHOST_VELOCITY }, // correct ghost
      { expectedIndex: 2, velocity: ACCENT_VELOCITY }, // ghost played too loud
      { expectedIndex: 3, velocity: ACCENT_VELOCITY }, // normal: never graded
    ]
    expect(padDynamics(matches, expectedDynamics)).toEqual({
      graded: 3,
      wrong: 1,
      softWanted: 1,
      loudWanted: 0,
      ghostInstants: 2,
      accentInstants: 1,
      unclassified: 0,
    })
  })

  it('ignores a match whose expectedIndex is out of range for expectedDynamics', () => {
    const matches: readonly GradedDynamicsMatch[] = [{ expectedIndex: 5, velocity: ACCENT_VELOCITY }]
    expect(padDynamics(matches, ['accent'])).toEqual({
      graded: 0,
      wrong: 0,
      softWanted: 0,
      loudWanted: 0,
      ghostInstants: 0,
      accentInstants: 0,
      unclassified: 0,
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
          for (const match of matches) {
            const expected = expectedDynamics[match.expectedIndex]
            if (expected === undefined || expected === 'normal') continue
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
          })
        },
      ),
      { seed: 20260919, numRuns: 200 },
    )
  })
})
