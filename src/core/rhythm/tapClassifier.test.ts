import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { generateRhythm, gradeTapping, type RhythmPattern } from '@core/generator/rhythm.ts'
import { seededRng } from '@core/ports/rng.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { millis, ticks, type Ticks } from '@core/shared/units.ts'
import {
  classifyTap,
  closeExpiredOnsets,
  defaultHitWindowTicks,
  effectiveToleranceTicks,
  initTapClassifierState,
  snapshotGrade,
  DEFAULT_HIT_WINDOW_RATIO,
  type TapClassifierOptions,
  type TapClassifierState,
} from './tapClassifier.ts'

const opts = (toleranceTicks: number, hitWindowTicks: number): TapClassifierOptions => ({
  toleranceTicks: ticks(toleranceTicks),
  hitWindowTicks: ticks(hitWindowTicks),
})

/** Feed a whole (sorted) tap sequence through, threading state — the shape
 *  every real caller (the drill hooks) uses. */
function classifyAll(
  onsetTicks: readonly Ticks[],
  taps: readonly Ticks[],
  o: TapClassifierOptions,
): {
  readonly classifications: readonly (ReturnType<typeof classifyTap>['classification'])[]
  readonly state: TapClassifierState
} {
  let state = initTapClassifierState(onsetTicks.length)
  const classifications: (ReturnType<typeof classifyTap>['classification'])[] = []
  for (const tap of taps) {
    const result = classifyTap(onsetTicks, state, tap, o)
    classifications.push(result.classification)
    state = result.state
  }
  return { classifications, state }
}

function onsetTicksOf(pattern: RhythmPattern): readonly Ticks[] {
  return pattern.onsets.filter((o) => !o.isRest).map((o) => o.tick)
}

/** Draws a pattern with at least `min` real onsets, growing bars — mirrors the
 *  identical helper `clapback.test.ts` uses for the same reason. */
function patternWithAtLeast(min: number, seed: number, complexity: 1 | 2 | 3 | 4 | 5 = 2): RhythmPattern {
  for (let bars = 1; bars <= 8; bars++) {
    const pattern = generateRhythm(
      { bars, timeSignature: { beats: 4, beatType: 4 }, complexity, allowRests: false, allowTies: false },
      seededRng(seed),
    )
    if (onsetTicksOf(pattern).length >= min) return pattern
  }
  throw new Error(`patternWithAtLeast: could not reach ${min} onsets for seed ${seed}`)
}

const seedArb = fc.integer({ min: 1, max: 5000 })

describe('tapClassifier — every tap is classified against exactly one onset, or rejected', () => {
  it('every non-undefined classification names a distinct, valid onset index; every onset claimed at most once', () => {
    fc.assert(
      fc.property(seedArb, fc.array(fc.integer({ min: -2000, max: 8000 }), { minLength: 0, maxLength: 12 }), (seed, rawTaps) => {
        const pattern = patternWithAtLeast(1, seed)
        const onsetTicks = onsetTicksOf(pattern)
        const taps = [...rawTaps].sort((a, b) => a - b).map((n) => ticks(n))

        const { classifications } = classifyAll(onsetTicks, taps, opts(160, 60))

        const claimed = new Set<number>()
        for (const c of classifications) {
          if (c === undefined) continue
          expect(c.onsetIndex).toBeGreaterThanOrEqual(0)
          expect(c.onsetIndex).toBeLessThan(onsetTicks.length)
          expect(claimed.has(c.onsetIndex)).toBe(false)
          claimed.add(c.onsetIndex)
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('tapClassifier — the hit window is symmetric', () => {
  it('a delta of exactly +-d (d <= hitWindowTicks) is always a hit; just past it is always early/late', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }), // hitWindowTicks
        fc.integer({ min: 0, max: 40 }), // extra room beyond the hit window, inside tolerance
        fc.integer({ min: -3, max: 3 }), // d, as an offset within the hit window
        (hitWindowTicks, extra, dSign) => {
          const toleranceTicks = hitWindowTicks + extra
          const onsetTicks = [ticks(1000)]
          const o = opts(toleranceTicks, hitWindowTicks)
          const d = Math.min(hitWindowTicks, Math.abs(dSign) * Math.max(1, Math.floor(hitWindowTicks / 3)))

          const late = classifyTap(onsetTicks, initTapClassifierState(1), ticks(1000 + d), o)
          const early = classifyTap(onsetTicks, initTapClassifierState(1), ticks(1000 - d), o)
          expect(late.classification?.verdict).toBe('hit')
          expect(early.classification?.verdict).toBe('hit')

          if (extra > 0) {
            const justPastLate = classifyTap(
              onsetTicks,
              initTapClassifierState(1),
              ticks(1000 + hitWindowTicks + 1),
              o,
            )
            const justPastEarly = classifyTap(
              onsetTicks,
              initTapClassifierState(1),
              ticks(1000 - hitWindowTicks - 1),
              o,
            )
            expect(justPastLate.classification?.verdict).toBe('late')
            expect(justPastEarly.classification?.verdict).toBe('early')
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('DEFAULT_HIT_WINDOW_RATIO is strictly between 0 and 1, and defaultHitWindowTicks scales it', () => {
    expect(DEFAULT_HIT_WINDOW_RATIO).toBeGreaterThan(0)
    expect(DEFAULT_HIT_WINDOW_RATIO).toBeLessThan(1)
    expect(defaultHitWindowTicks(ticks(150))).toBe(50)
  })
})

describe('tapClassifier — monotonic tap sequences never claim an earlier onset after a later one was consumed', () => {
  it('the sequence of claimed onset indices is strictly increasing for any non-decreasing tap sequence', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(fc.integer({ min: -1000, max: 10000 }), { minLength: 0, maxLength: 15 }),
        fc.integer({ min: 1, max: 400 }),
        (seed, rawTaps, toleranceTicks) => {
          const pattern = patternWithAtLeast(2, seed)
          const onsetTicks = onsetTicksOf(pattern)
          const taps = [...rawTaps].sort((a, b) => a - b).map((n) => ticks(n))

          const { classifications } = classifyAll(onsetTicks, taps, opts(toleranceTicks, toleranceTicks / 3))

          const claimedOrder = classifications
            .filter((c): c is NonNullable<typeof c> => c !== undefined)
            .map((c) => c.onsetIndex)
          for (let i = 1; i < claimedOrder.length; i++) {
            expect(claimedOrder[i]).toBeGreaterThan(claimedOrder[i - 1] as number)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('a concrete overlapping-window contest still resolves in FIFO order, never backward', () => {
    // Onset 0 at tick 0 (window closes at 1000), onset 1 at tick 500 (window
    // closes at 1500) — deliberately overlapping in [500, 1000], wide enough
    // that a GLOBAL-nearest matcher would hand the first tap to onset 1 (dist
    // 0) and leave onset 0 for a later tap — exactly the ordering this
    // module's FIFO design refuses to produce (see the module doc).
    const onsetTicks: readonly Ticks[] = [ticks(0), ticks(500)]
    const o = opts(1000, 300)
    const tap1 = classifyTap(onsetTicks, initTapClassifierState(2), ticks(500), o)
    expect(tap1.classification?.onsetIndex).toBe(0) // FIFO: the oldest pending onset, not the nearest.
    const tap2 = classifyTap(onsetTicks, tap1.state, ticks(600), o)
    expect(tap2.classification?.onsetIndex).toBe(1)
  })
})

describe('tapClassifier — agrees with the existing batch grader on a full clean run', () => {
  it('every onset tapped exactly on time classifies matched/hit, with the same totals gradeTapping produces', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(1, 2, 3, 4, 5) as fc.Arbitrary<1 | 2 | 3 | 4 | 5>, (seed, complexity) => {
        const pattern = patternWithAtLeast(1, seed, complexity)
        const onsetTicks = onsetTicksOf(pattern)

        const { classifications, state } = classifyAll(onsetTicks, onsetTicks, opts(160, 60))
        const finalState = closeExpiredOnsets(
          onsetTicks,
          state,
          ticks((onsetTicks[onsetTicks.length - 1] as number) + 100_000),
          opts(160, 60),
        )
        const grade = snapshotGrade(finalState)

        expect(grade.matched).toBe(onsetTicks.length)
        expect(grade.missed).toBe(0)
        expect(grade.extra).toBe(0)
        expect(classifications.every((c) => c?.verdict === 'hit')).toBe(true)

        // The existing batch grader, fed the exact same clean taps — each
        // converted through the SAME `tickToMs` gradeTapping itself uses
        // internally to place the pattern's own onsets, so a tick-domain
        // "exactly on time" tap is also an ms-domain "exactly on time" tap,
        // whatever the tempo.
        const tempo = makeTempoMap([])
        const batch = gradeTapping(
          pattern,
          onsetTicks.map((t) => millis(Number(tickToMs(tempo, t)))),
          tempo,
        )
        expect(batch.matched).toBe(onsetTicks.length)
        expect(batch.missed).toBe(0)
        expect(batch.extra).toBe(0)
      }),
      { numRuns: 200 },
    )
  })
})

describe('tapClassifier — manual Stop grades only the elapsed prefix', () => {
  it('stopping strictly before the last onset never marks it (or anything after it) missed', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 400 }), (seed, toleranceTicks) => {
        const pattern = patternWithAtLeast(2, seed)
        const onsetTicks = onsetTicksOf(pattern)
        const lastOnset = onsetTicks[onsetTicks.length - 1] as number
        // Stop well before the last onset's window even OPENS, so it is
        // guaranteed to still be pending.
        const stopAt = ticks(lastOnset - toleranceTicks - 1)

        const state = closeExpiredOnsets(onsetTicks, initTapClassifierState(onsetTicks.length), stopAt, opts(toleranceTicks, toleranceTicks / 3))
        const grade = snapshotGrade(state)

        expect(grade.matched + grade.missed).toBeLessThan(onsetTicks.length)
      }),
      { numRuns: 200 },
    )
  })

  it('stop at any point never marks a FUTURE onset missed, for an arbitrary tap history', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(fc.integer({ min: -500, max: 6000 }), { minLength: 0, maxLength: 10 }),
        fc.integer({ min: -500, max: 8000 }),
        fc.integer({ min: 1, max: 300 }),
        (seed, rawTaps, rawStopAt, toleranceTicks) => {
          const pattern = patternWithAtLeast(2, seed)
          const onsetTicks = onsetTicksOf(pattern)
          const taps = [...rawTaps].sort((a, b) => a - b).map((n) => ticks(n))
          const o = opts(toleranceTicks, toleranceTicks / 3)

          const { state } = classifyAll(onsetTicks, taps, o)
          const stopAt = ticks(rawStopAt)
          const stopped = closeExpiredOnsets(onsetTicks, state, stopAt, o)

          // Onsets before `state.lo` were already decided by a real tap
          // BEFORE this stop call — matching does not require a window to
          // have elapsed, only that the tap fell inside it, so those are not
          // what this property is about (a matched onset is never "future").
          // What must hold is narrower and exactly what `closeExpiredOnsets`
          // promises: among onsets that were STILL PENDING going into the
          // stop, any whose window has not yet elapsed as of `stopAt` must
          // remain pending afterward (never swept into `missed`).
          for (let i = state.lo; i < onsetTicks.length; i++) {
            const windowElapsed = (onsetTicks[i] as number) + toleranceTicks < stopAt
            if (!windowElapsed) {
              expect(i).toBeGreaterThanOrEqual(stopped.lo)
            }
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('stopping after the last onset equals the run-ended grade (idempotent past the end)', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: 50_000 }), (seed, toleranceTicks, extraSlack) => {
        const pattern = patternWithAtLeast(2, seed)
        const onsetTicks = onsetTicksOf(pattern)
        const lastOnset = onsetTicks[onsetTicks.length - 1] as number
        const o = opts(toleranceTicks, toleranceTicks / 3)

        // A handful of imperfect but in-range taps, so matched/missed/extra
        // are not all trivially zero.
        const taps = onsetTicks.filter((_, i) => i % 2 === 0).map((t) => ticks(t as number))
        const { state } = classifyAll(onsetTicks, taps, o)

        const stoppedAtEnd = closeExpiredOnsets(onsetTicks, state, ticks(lastOnset + toleranceTicks + 1), o)
        const stoppedLater = closeExpiredOnsets(onsetTicks, state, ticks(lastOnset + toleranceTicks + 1 + extraSlack), o)

        expect(snapshotGrade(stoppedAtEnd)).toEqual(snapshotGrade(stoppedLater))
        expect(stoppedAtEnd.matched + stoppedAtEnd.missed).toBe(onsetTicks.length)
      }),
      { numRuns: 200 },
    )
  })
})

describe('tapClassifier — invariants', () => {
  it('throws on hitWindowTicks > toleranceTicks', () => {
    expect(() => classifyTap([ticks(0)], initTapClassifierState(1), ticks(0), opts(50, 100))).toThrow()
  })

  it('throws on a negative toleranceTicks or hitWindowTicks', () => {
    expect(() => classifyTap([ticks(0)], initTapClassifierState(1), ticks(0), opts(-1, 0))).toThrow()
    expect(() => classifyTap([ticks(0)], initTapClassifierState(1), ticks(0), opts(50, -1))).toThrow()
  })

  it('throws when onsetTicks.length does not match the state it was constructed with', () => {
    expect(() => classifyTap([ticks(0), ticks(500)], initTapClassifierState(1), ticks(0), opts(50, 20))).toThrow()
  })

  it('throws on unsorted onsetTicks', () => {
    expect(() =>
      classifyTap([ticks(500), ticks(0)], initTapClassifierState(2), ticks(0), opts(50, 20)),
    ).toThrow()
  })
})

describe('tapClassifier — everyday shape', () => {
  it('an isolated onset: on-time hits, a doubled tap is extra, a dropped tap (closed via a later event) is missed', () => {
    const onsetTicks: readonly Ticks[] = [ticks(0), ticks(1000)]
    const o = opts(200, 60)

    let state = initTapClassifierState(2)
    const first = classifyTap(onsetTicks, state, ticks(0), o)
    expect(first.classification).toEqual({ verdict: 'hit', onsetIndex: 0, deltaTicks: 0 })
    state = first.state

    // A stutter right after: still near onset 0, but it is already claimed.
    const doubled = classifyTap(onsetTicks, state, ticks(20), o)
    expect(doubled.classification).toBeUndefined()
    state = doubled.state

    // Onset 1's tap never comes; a later event (the run ending, tick 5000)
    // closes it out as missed.
    state = closeExpiredOnsets(onsetTicks, state, ticks(5000), o)
    const grade = snapshotGrade(state)
    expect(grade.matched).toBe(1)
    expect(grade.missed).toBe(1)
    expect(grade.extra).toBe(1)
  })

  it('grade on an empty onset grid with no taps is accuracy 0 (nothing decided is not a perfect score)', () => {
    // Roadmap U.3 fix round (BLOCKER-2): this used to be accuracy 1, which is
    // exactly what let a manual Stop at tick 0 — nothing tapped, nothing
    // decided — read as a 100% run.
    const state = initTapClassifierState(0)
    expect(snapshotGrade(state)).toEqual({ matched: 0, missed: 0, extra: 0, accuracy: 0, meanAbsDeviationTicks: 0 })
  })
})

describe('tapClassifier — effectiveToleranceTicks (roadmap U.3 fix round, BLOCKER-1)', () => {
  it('passes the config tolerance through unchanged for fewer than 2 onsets', () => {
    expect(effectiveToleranceTicks([], ticks(200))).toBe(200)
    expect(effectiveToleranceTicks([ticks(1000)], ticks(200))).toBe(200)
  })

  it("the review's own reproducer: onsets [0, 240], config tolerance 144 clamps to 119", () => {
    // core/generator/rhythm.ts's complexity 3-4 floor (240 ticks) with
    // TAPPING_DEFAULTS.toleranceMs's tick equivalent (144) unclamped: two
    // onsets' +-144 windows overlap in [96, 240-96]=[96,144]... concretely,
    // floor((240 - 1) / 2) = 119, strictly under the un-clamped 144.
    const onsetTicks = [ticks(0), ticks(240)]
    expect(effectiveToleranceTicks(onsetTicks, ticks(144))).toBe(119)
  })

  it("the reproducer end to end: taps [140, 360] against onsets [0, 240] now agree between the live classifier and gradeTapping", () => {
    const onsetTicks: readonly Ticks[] = [ticks(0), ticks(240)]
    const effTol = effectiveToleranceTicks(onsetTicks, ticks(144))
    expect(effTol).toBe(119)
    const o = opts(Number(effTol), Math.floor(Number(effTol) / 3))

    const { state } = classifyAll(onsetTicks, [ticks(140), ticks(360)], o)
    const finalState = closeExpiredOnsets(onsetTicks, state, ticks(240 + Number(effTol) + 1), o)
    const liveGrade = snapshotGrade(finalState)
    expect(liveGrade).toMatchObject({ matched: 1, missed: 1, extra: 1 })
    expect(liveGrade.accuracy).toBeCloseTo(1 / 3)

    const tempo = makeTempoMap([])
    const pattern: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 1,
      onsets: onsetTicks.map((t) => ({ tick: t, durationTicks: ticks(1), isRest: false })),
    }
    const batch = gradeTapping(
      pattern,
      [ticks(140), ticks(360)].map((t) => millis(Number(tickToMs(tempo, t)))),
      tempo,
      { toleranceMs: Number(tickToMs(tempo, effTol)) },
    )
    expect(batch.matched).toBe(liveGrade.matched)
    expect(batch.missed).toBe(liveGrade.missed)
    expect(batch.extra).toBe(liveGrade.extra)
  })

  it('folding the live classifier over arbitrary taps at the clamped tolerance always agrees with gradeTapping exactly', () => {
    fc.assert(
      fc.property(
        // Strictly-increasing onset ticks: a cumulative sum of positive gaps,
        // starting at 0 — 0 gaps is a single onset (exercises the <2 branch).
        fc.array(fc.integer({ min: 1, max: 2000 }), { minLength: 0, maxLength: 12 }).map((gaps) => {
          let t = 0
          const out = [ticks(0)]
          for (const g of gaps) {
            t += g
            out.push(ticks(t))
          }
          return out
        }),
        fc.array(fc.integer({ min: -2000, max: 25000 }), { minLength: 0, maxLength: 15 }),
        fc.integer({ min: 1, max: 400 }),
        (onsetTicks, rawTaps, configTolerance) => {
          const taps = [...rawTaps].sort((a, b) => a - b).map((n) => ticks(n))
          const effTol = effectiveToleranceTicks(onsetTicks, ticks(configTolerance))
          const o = opts(Number(effTol), Math.floor(Number(effTol) / 3))

          const { state } = classifyAll(onsetTicks, taps, o)
          const lastOnset = onsetTicks[onsetTicks.length - 1] as number
          const finalState = closeExpiredOnsets(onsetTicks, state, ticks(lastOnset + Number(effTol) + 1), o)
          const liveGrade = snapshotGrade(finalState)

          const tempo = makeTempoMap([])
          const pattern: RhythmPattern = {
            timeSignature: { beats: 4, beatType: 4 },
            bars: 1,
            onsets: onsetTicks.map((t) => ({ tick: t, durationTicks: ticks(1), isRest: false })),
          }
          const tapMs = taps.map((t) => millis(Number(tickToMs(tempo, t))))
          const batch = gradeTapping(pattern, tapMs, tempo, {
            toleranceMs: Number(tickToMs(tempo, effTol)),
          })

          expect(liveGrade.matched).toBe(batch.matched)
          expect(liveGrade.missed).toBe(batch.missed)
          expect(liveGrade.extra).toBe(batch.extra)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('tapClassifier — mutation-killer fixed examples (roadmap U.3 fix round)', () => {
  it('meanAbsDeviationTicks is the mean of ABSOLUTE deviations, not the signed mean, over mixed early+late taps', () => {
    // Onset 0 tapped 30 early (delta -30), onset 1 tapped 50 late (delta
    // +50). A signed-sum mutant would compute (-30 + 50) / 2 = 10; the
    // correct |deviation| mean is (30 + 50) / 2 = 40.
    const onsetTicks: readonly Ticks[] = [ticks(1000), ticks(2000)]
    const o = opts(200, 60)
    let state = initTapClassifierState(2)
    state = classifyTap(onsetTicks, state, ticks(970), o).state
    state = classifyTap(onsetTicks, state, ticks(2050), o).state
    const grade = snapshotGrade(state)
    expect(grade.matched).toBe(2)
    expect(grade.meanAbsDeviationTicks).toBe(40)
  })

  it('accuracy is matched / (matched + missed + extra) — deliberately NOT onsetCount, with all three non-zero and two onsets left pending', () => {
    // 5 onsets, but only 2 are ever decided (1 matched, 1 missed) and 1 extra
    // tap lands in the dead zone between them — onsets 3 and 4 are left
    // pending on purpose. total (matched+missed+extra = 3) and onsetCount (5)
    // deliberately differ here, so a mutant that divided by onsetCount
    // instead of total (1/5 = 0.2) is caught — a fixture where they
    // coincidentally match would let that mutant survive.
    const onsetTicks: readonly Ticks[] = [ticks(0), ticks(1000), ticks(2000), ticks(3000), ticks(4000)]
    const o = opts(200, 60)
    let state = initTapClassifierState(5)
    // Onset 0: matched on time.
    state = classifyTap(onsetTicks, state, ticks(0), o).state
    // Onset 1's tap never comes — closed out as missed once its window elapses.
    state = closeExpiredOnsets(onsetTicks, state, ticks(1300), o)
    // A stray tap in the dead zone between onset 1 (closed) and onset 2
    // (window not yet open): matches nothing, an extra.
    state = classifyTap(onsetTicks, state, ticks(1500), o).state
    const grade = snapshotGrade(state)
    expect(grade.matched).toBe(1)
    expect(grade.missed).toBe(1)
    expect(grade.extra).toBe(1)
    // 1 / (1 + 1 + 1) = 1/3 exactly, not 1/5 (onsetCount) and not 1/2 (matched+missed only).
    expect(grade.accuracy).toBeCloseTo(1 / 3, 10)
  })
})
