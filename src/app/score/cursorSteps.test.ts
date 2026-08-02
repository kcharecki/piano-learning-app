import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { stepsToOnsetAtOrBefore } from './cursorSteps.ts'

describe('stepsToOnsetAtOrBefore', () => {
  it('returns 0 for an empty array', () => {
    expect(stepsToOnsetAtOrBefore([], 480)).toBe(0)
  })

  it('returns 0 when tick precedes every onset', () => {
    expect(stepsToOnsetAtOrBefore([480, 960, 1440], 0)).toBe(0)
  })

  it('lands exactly on an onset', () => {
    expect(stepsToOnsetAtOrBefore([0, 480, 960, 1440], 480)).toBe(1)
  })

  it('stays on the earlier onset when tick falls between two onsets', () => {
    expect(stepsToOnsetAtOrBefore([0, 480, 960, 1440], 500)).toBe(1)
  })

  it('clamps to the last onset when tick is past the end', () => {
    expect(stepsToOnsetAtOrBefore([0, 480, 960, 1440], 999_999)).toBe(3)
  })

  it('picks the LAST of duplicate adjacent onset ticks, since all are sounding', () => {
    expect(stepsToOnsetAtOrBefore([0, 480, 480, 960], 480)).toBe(2)
    // still true when tick sits strictly past the duplicated run
    expect(stepsToOnsetAtOrBefore([0, 480, 480, 960], 700)).toBe(2)
  })

  // The real bug: one frame after Play, the transport sits a few ticks past
  // 0. The original code stepped forward while `currentTick >= tick`, i.e.
  // stopped the instant an onset was `>= tick` rather than strictly `>`. That
  // treats onset 1 (tick 0) as already "reached and passed" for tick 13, so
  // it advanced to onset 2 (tick 480) and stayed one note ahead of the audio
  // for the rest of the piece. Kills the mutant: `>` -> `>=` in the `break`
  // condition inside stepsToOnsetAtOrBefore.
  it('regression: tick 13 stays on onset 0 (tick 0), not onset 1 (tick 480)', () => {
    expect(stepsToOnsetAtOrBefore([0, 480, 960, 1440], 13)).toBe(0)
  })

  it('property: the returned index is the last onset at or before tick, never later', () => {
    // `tick` is deliberately biased to land exactly on one of the generated
    // onsets (not just anywhere in the range) — that boundary is the one
    // spot where `>` vs `>=` in the break condition disagree, so a purely
    // uniform random tick would rarely exercise it.
    const onsetsAndTick = fc
      .array(fc.integer({ min: 0, max: 200 }), { minLength: 0, maxLength: 20 })
      .map((xs) => [...xs].sort((a, b) => a - b))
      .chain((onsetTicks) =>
        fc.tuple(
          fc.constant(onsetTicks),
          onsetTicks.length > 0
            ? fc.oneof(
                fc.integer({ min: -50, max: 250 }),
                fc.integer({ min: 0, max: onsetTicks.length - 1 }).map((i) => {
                  const onset = onsetTicks[i]
                  // Safe: `i` is bounded to `onsetTicks.length - 1` above.
                  return onset === undefined ? 0 : onset
                }),
              )
            : fc.integer({ min: -50, max: 250 }),
        ),
      )

    fc.assert(
      fc.property(onsetsAndTick, ([onsetTicks, tick]) => {
        const i = stepsToOnsetAtOrBefore(onsetTicks, tick)

        const anyAtOrBefore = onsetTicks.some((t) => t <= tick)
        if (anyAtOrBefore) {
          const onsetAtI = onsetTicks[i]
          expect(onsetAtI).not.toBeUndefined()
          if (onsetAtI !== undefined) expect(onsetAtI).toBeLessThanOrEqual(tick)
        }

        if (i + 1 < onsetTicks.length) {
          const nextOnset = onsetTicks[i + 1]
          expect(nextOnset).not.toBeUndefined()
          if (nextOnset !== undefined) expect(nextOnset).toBeGreaterThan(tick)
        }
      }),
    )
  })
})
