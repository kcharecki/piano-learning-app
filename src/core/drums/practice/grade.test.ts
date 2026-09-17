import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ghostFunkBar, moneyBeat, moneyBeatOpenHat, referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { gradeGrooveRun, worstUnisonGap, type GrooveHit } from './grade.ts'
import { planGrooveRun, type GrooveRunPlan } from './plan.ts'

/**
 * The money beat at 80 bpm, graded over two bars: 16 closed hi-hats, 4 kicks,
 * 4 snares, a 375 ms grid and a 100 ms window. Every case below is built by
 * deforming a perfect run of it, so what each case is testing is exactly the
 * deformation and nothing else.
 */
const plan = (): GrooveRunPlan => planGrooveRun(moneyBeat(), 80)

/** A run played exactly as written, then bent by `offset` (which may vary per hit). */
function play(
  runPlan: GrooveRunPlan,
  offset: (pad: MappedDrumPad, index: number) => number = () => 0,
): GrooveHit[] {
  return runPlan.pads.flatMap((padPlan) =>
    padPlan.expectedMs.map((ms, index) => ({
      pad: padPlan.pad,
      ms: ms + offset(padPlan.pad, index),
    })),
  )
}

const row = (result: ReturnType<typeof gradeGrooveRun>, pad: MappedDrumPad) =>
  result.pads.find((p) => p.pad === pad)

/** Like `play`, but each instant's PAD can be substituted (the articulation slip). Timing is always exact. */
function playWithSwap(
  runPlan: GrooveRunPlan,
  swap: (pad: MappedDrumPad, index: number) => MappedDrumPad,
): GrooveHit[] {
  return runPlan.pads.flatMap((padPlan) =>
    padPlan.expectedMs.map((ms, index) => ({ pad: swap(padPlan.pad, index), ms })),
  )
}

describe('gradeGrooveRun', () => {
  it('grades a run played as written as steady, every stroke accounted for', () => {
    const result = gradeGrooveRun(plan(), play(plan()))
    expect(result.steady).toBe(true)
    expect(result.totalHits).toBe(24)
    expect(row(result, 'hhClosed')).toMatchObject({ expected: 16, matched: 16, missed: 0, extra: 0 })
    expect(row(result, 'snare')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
    expect(row(result, 'kick')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
    expect(row(result, 'hhClosed')?.meanOffsetMs).toBeCloseTo(0, 9)
    expect(row(result, 'hhClosed')?.spreadMs).toBeCloseTo(0, 9)
  })

  /**
   * The latency argument, and the single most important property of this
   * grader. A constant delay is what a laptop adds between the pad and the
   * measurement; it moves every mean by the same amount and cannot touch a
   * pad's spread, its drift, or the gap between two pads. So it must not
   * change the verdict.
   */
  it('calls a run that is uniformly late steady, and reports the lateness it measured', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 55))
    expect(result.steady).toBe(true)
    for (const pad of ['hhClosed', 'snare', 'kick'] as const) {
      expect(row(result, pad)?.meanOffsetMs).toBeCloseTo(55, 9)
      expect(row(result, pad)?.spreadMs).toBeCloseTo(0, 9)
    }
  })

  it('is verdict-invariant under any constant offset inside the window', () => {
    fc.assert(
      fc.property(fc.integer({ min: -99, max: 99 }), (latency) => {
        const result = gradeGrooveRun(plan(), play(plan(), () => latency))
        expect(result.steady).toBe(true)
        expect(result.slipSteps).toBeUndefined()
      }),
    )
  })

  it('names the limbs that failed and leaves the one that did not alone', () => {
    // The same 24 instants and the same per-pad counts as a correct run, with
    // snare and kick trading places.
    const swapped = play(plan()).map((hit) => ({
      pad: hit.pad === 'snare' ? ('kick' as const) : hit.pad === 'kick' ? ('snare' as const) : hit.pad,
      ms: hit.ms,
    }))
    const result = gradeGrooveRun(plan(), swapped)

    expect(result.steady).toBe(false)
    expect(result.totalHits).toBe(24)
    expect(row(result, 'snare')).toMatchObject({ expected: 4, matched: 0, missed: 4, extra: 4 })
    expect(row(result, 'kick')).toMatchObject({ expected: 4, matched: 0, missed: 4, extra: 4 })
    expect(row(result, 'hhClosed')).toMatchObject({ matched: 16, missed: 0, extra: 0 })
  })

  /**
   * T.17.3. Two limbs that are equal and opposite distances from the grid are
   * a hand problem, not a clock problem. Claiming a phase slip here would tell
   * a learner who swapped their limbs that they were playing the right pattern
   * in the wrong place.
   */
  it('does not call a limb swap a phase slip, because the two limbs disagree about the shift', () => {
    const swapped = play(plan()).map((hit) => ({
      pad: hit.pad === 'snare' ? ('kick' as const) : hit.pad === 'kick' ? ('snare' as const) : hit.pad,
      ms: hit.ms,
    }))
    expect(gradeGrooveRun(plan(), swapped).slipSteps).toBeUndefined()
  })

  it('calls a whole-pattern displacement by its grid position, in whole subdivisions', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 375))
    expect(result.slipSteps).toBe(1)
    const early = gradeGrooveRun(plan(), play(plan(), () => -750))
    expect(early.slipSteps).toBe(-2)
  })

  /**
   * T.17.3 again, the other half. 120 ms at 80 bpm is not a grid position:
   * it is not a subdivision, not two of them, and not any number of them. The
   * first attempt reported it as "two steps of the pattern behind the click"
   * because a shifted match beat a zero baseline. Here it is simply late
   * enough to miss, and nothing is claimed about the grid.
   */
  it('claims nothing about the grid for a lag that is not a grid position', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 120))
    expect(result.slipSteps).toBeUndefined()
    expect(row(result, 'hhClosed')).toMatchObject({ matched: 0, missed: 16, extra: 16 })
  })

  /**
   * And a whole sixteenth against an eighth-note grid: half a subdivision, so
   * every stroke misses and no shift recovers it. The first attempt reported
   * this displacement as "3 ms late".
   */
  it('reports a half-subdivision displacement as missed, not as a few milliseconds late', () => {
    const result = gradeGrooveRun(plan(), play(plan(), () => 187.5))
    expect(result.slipSteps).toBeUndefined()
    expect(row(result, 'hhClosed')?.matched).toBe(0)
    expect(row(result, 'hhClosed')?.meanOffsetMs).toBeUndefined()
    expect(result.steady).toBe(false)
  })

  it('fails a run whose strokes scatter about their own mean', () => {
    const result = gradeGrooveRun(plan(), play(plan(), (_pad, i) => (i % 2 === 0 ? -70 : 70)))
    expect(result.steady).toBe(false)
    expect(row(result, 'hhClosed')?.spreadMs ?? 0).toBeGreaterThan(result.limits.spreadMs)
  })

  /**
   * T.17.7. A limb walking steadily away from the click has a spread that sits
   * comfortably inside the budget — it is the drift that gives it away. A gate
   * that is only a run-long average cannot see this at all.
   */
  it('fails a limb that walks away from the click even when its spread is inside the budget', () => {
    const result = gradeGrooveRun(plan(), play(plan(), (pad, i) => (pad === 'hhClosed' ? i * 6.5 : 0)))
    const hats = row(result, 'hhClosed')
    expect(hats?.matched).toBe(16)
    expect(hats?.spreadMs ?? 0).toBeLessThan(result.limits.spreadMs)
    expect(Math.abs(hats?.driftMs ?? 0)).toBeGreaterThan(result.limits.driftMs)
    expect(result.steady).toBe(false)
  })

  /**
   * T.17.2. The score puts the kick under the hi-hat on beat 1; it never puts
   * the kick with the snare. So a kick that arrives late relative to the hat
   * is a flam the app can name, and the kick-to-snare distance is a
   * coincidence it must not.
   */
  it('measures the gap only between limbs the score writes on one instant', () => {
    const result = gradeGrooveRun(plan(), play(plan(), (pad) => (pad === 'kick' ? 60 : 0)))
    const named = result.unison.map((gap) => gap.pads.join('+'))
    expect(named).toContain('hhClosed+kick')
    expect(named).toContain('hhClosed+snare')
    expect(named).not.toContain('kick+snare')

    const worst = worstUnisonGap(result)
    expect(worst?.pads).toEqual(['hhClosed', 'kick'])
    expect(worst?.gapMs).toBeCloseTo(60, 6)
    expect(result.steady).toBe(false)
  })

  it('reports no flam when every limb sits together, however late they all are', () => {
    expect(worstUnisonGap(gradeGrooveRun(plan(), play(plan(), () => 80)))).toBeUndefined()
  })

  /**
   * T.17.8. Nothing registering at all is a rig problem — the wrong key, a
   * pad that never received the press — and it looks nothing like a run where
   * every stroke landed in the wrong place. The grader keeps the two apart by
   * counting hits, not matches.
   */
  it('distinguishes a silent run from a run where nothing matched', () => {
    const silent = gradeGrooveRun(plan(), [])
    expect(silent.totalHits).toBe(0)
    expect(silent.steady).toBe(false)

    const allWrong = gradeGrooveRun(plan(), play(plan(), () => 900))
    expect(allWrong.totalHits).toBe(24)
    expect(allWrong.pads.every((p) => p.matched === 0)).toBe(true)
    expect(allWrong.steady).toBe(false)
  })

  it('gives a pad the groove never asks for its own row rather than dropping it', () => {
    const result = gradeGrooveRun(plan(), [...play(plan()), { pad: 'crash1', ms: 100 }])
    expect(row(result, 'crash1')).toMatchObject({ expected: 0, hits: 1, matched: 0, extra: 1 })
    expect(result.steady).toBe(false)
  })

  /**
   * T.17.1 at the grading level: the window Ghost Funk's kick is graded on
   * comes from the score's sixteenth grid, so straight quarters played against
   * a notated "1 a 3 a" cannot come back whole.
   */
  it('does not let straight quarters pass as a syncopated kick part', () => {
    const funk = planGrooveRun(ghostFunkBar(), 80)
    const quarters = [0, 750, 1500, 2250, 3000, 3750, 4500, 5250].map((ms) => ({
      pad: 'kick' as const,
      ms,
    }))
    const kick = row(gradeGrooveRun(funk, quarters), 'kick')
    expect(kick?.expected).toBe(8)
    expect(kick?.matched).toBeLessThan(8)
    expect(kick?.extra).toBeGreaterThan(0)
  })

  it('never matches one hit to two instants, or one instant to two hits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ padIndex: fc.integer({ min: 0, max: 2 }), ms: fc.integer({ min: -500, max: 6500 }) }), {
          maxLength: 40,
        }),
        (raw) => {
          const runPlan = plan()
          const hits = raw.flatMap(({ padIndex, ms }) => {
            const padPlan = runPlan.pads[padIndex]
            return padPlan === undefined ? [] : [{ pad: padPlan.pad, ms }]
          })
          const result = gradeGrooveRun(runPlan, hits)
          for (const padRow of result.pads) {
            expect(padRow.matched).toBeLessThanOrEqual(padRow.expected)
            expect(padRow.matched).toBeLessThanOrEqual(padRow.hits)
            expect(padRow.missed + padRow.matched).toBe(padRow.expected)
            expect(padRow.extra + padRow.matched).toBe(padRow.hits)
          }
          expect(result.pads.reduce((sum, p) => sum + p.hits, 0)).toBe(hits.length)
        },
      ),
    )
  })

  /**
   * Window-boundary mutant: the distance check in `pair()` is `distance >
   * windowMs`, i.e. exactly `windowMs` late still matches. A mutant that
   * tightens this to `>=` would turn every one of these into a miss.
   */
  it('matches a hit exactly windowMs late (pins the strict `>` in the window check)', () => {
    const runPlan = plan()
    const result = gradeGrooveRun(runPlan, play(runPlan, () => runPlan.windowMs))
    expect(result.pads.every((p) => p.matched === p.expected)).toBe(true)
    expect(result.pads.every((p) => p.missed === 0)).toBe(true)
  })

  /**
   * Greedy tie-break: `expected` is time-ordered, so when one hit sits at the
   * exact midpoint between two adjacent instants, the earlier instant is
   * processed first and claims it — the later instant is left missed. This is
   * the documented, current behaviour (see the one-line comment in `pair()`);
   * it is not a search, just iteration order, but it is worth pinning.
   */
  it('gives a hit at the exact midpoint between two adjacent instants to the earlier one', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80, { toleranceMs: 1000 })
    const hhClosed = runPlan.pads.find((p) => p.pad === 'hhClosed')
    expect(hhClosed).toBeDefined()
    if (hhClosed === undefined) return
    const [first, second] = hhClosed.expectedMs
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return
    const midpoint = (first + second) / 2

    const hits = [
      ...play(runPlan).filter((hit) => !(hit.pad === 'hhClosed' && (hit.ms === first || hit.ms === second))),
      { pad: 'hhClosed' as const, ms: midpoint },
    ]
    const result = gradeGrooveRun(runPlan, hits)
    const hats = row(result, 'hhClosed')
    // One of the two instants (the earlier) is matched by the midpoint hit,
    // the other is missed — and the SIGN of the resulting mean offset (every
    // other hhClosed hit lands exactly on time) tells us which: positive
    // means the earlier instant (midpoint - first > 0) claimed it.
    expect(hats?.matched).toBe(hhClosed.expectedMs.length - 1)
    expect(hats?.missed).toBe(1)
    expect(hats?.meanOffsetMs).toBeCloseTo((midpoint - first) / (hhClosed.expectedMs.length - 1), 9)
  })
})

/**
 * T.33: playing the right instant with the wrong hi-hat articulation used to
 * grade as two independent failures (a miss on the expected pad, an extra on
 * the played one) and named neither. This pass reconciles the two into one
 * `slipped` count and one `articulation` entry, without ever touching a hit
 * that was already correctly matched.
 */
describe('gradeGrooveRun: articulation slip pass', () => {
  it('names a hat played closed throughout as one slip per instant, not a miss and an extra', () => {
    // Mutant killed: a stub that never runs the slip pass at all — it would
    // report hhOpen as "missed: loops, slipped: 0" and hhClosed as
    // "extra: loops", instead of moving the discrepancy into `slipped`.
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const hits = play(runPlan).map((hit) => (hit.pad === 'hhOpen' ? { pad: 'hhClosed' as const, ms: hit.ms } : hit))
    const result = gradeGrooveRun(runPlan, hits)

    const openExpected = runPlan.pads.find((p) => p.pad === 'hhOpen')?.expectedMs.length ?? 0
    expect(openExpected).toBeGreaterThan(0) // sanity: the groove does write an open hat

    expect(row(result, 'hhOpen')).toMatchObject({ matched: 0, missed: 0, slipped: openExpected })
    expect(row(result, 'hhClosed')).toMatchObject({ extra: 0 })
    expect(result.articulation).toEqual([{ expected: 'hhOpen', played: 'hhClosed', count: openExpected }])
    expect(result.steady).toBe(false)

    // Every other row is fully matched — the slip pass never touches a pad
    // outside the sibling pair.
    for (const p of ['kick', 'snare'] as const) {
      expect(row(result, p)).toMatchObject({ missed: 0, extra: 0, slipped: 0 })
    }
  })

  it('names the reverse mixup too: the hat played open where the score writes closed', () => {
    // Mutant killed: a slip pass hard-coded to only the (hhOpen, hhClosed)
    // direction and never its reverse — it would leave this run's hhClosed
    // row "missed: 2" and hhOpen "extra: 2" with an empty `articulation`.
    const runPlan = planGrooveRun(moneyBeat(), 80) // moneyBeat never notates hhOpen
    const hits = playWithSwap(runPlan, (pad, index) => (pad === 'hhClosed' && index % 8 === 7 ? 'hhOpen' : pad))
    const result = gradeGrooveRun(runPlan, hits)

    expect(row(result, 'hhClosed')).toMatchObject({ expected: 16, matched: 14, missed: 0, slipped: 2 })
    expect(row(result, 'hhOpen')).toMatchObject({ expected: 0, hits: 0, matched: 0, extra: 0, slipped: 0 })
    expect(result.articulation).toEqual([{ expected: 'hhClosed', played: 'hhOpen', count: 2 }])
    expect(result.steady).toBe(false)
  })

  it('respects the match window: a closed hit outside the missed open instant stays a plain miss and a plain extra', () => {
    // Mutant killed: a slip pass that ignores `windowMs` and pairs by
    // nearest-anything — it would call this a slip even though the extra
    // hit lands well outside the open instant's own tolerance.
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const openPlan = runPlan.pads.find((p) => p.pad === 'hhOpen')
    expect(openPlan).toBeDefined()
    if (openPlan === undefined) return
    const openMs = openPlan.expectedMs[0]
    expect(openMs).toBeDefined()
    if (openMs === undefined) return

    expect(runPlan.windowMs).toBeLessThan(150)
    const hits = [
      ...play(runPlan).filter((hit) => !(hit.pad === 'hhOpen' && hit.ms === openMs)),
      { pad: 'hhClosed' as const, ms: openMs + 150 },
    ]
    const result = gradeGrooveRun(runPlan, hits)

    expect(row(result, 'hhOpen')).toMatchObject({ matched: 1, missed: 1, slipped: 0 })
    expect(row(result, 'hhClosed')).toMatchObject({ extra: 1, slipped: 0 })
    expect(result.articulation).toEqual([])
  })

  it('never steals a correctly played open hit: a nearby extra closed hit is just extra', () => {
    // Mutant killed: a slip pass that matches against ALL of a pad's hits
    // instead of only its still-unmatched extras — it would let the extra
    // closed hit "steal" the already-matched open hit's slot.
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const openPlan = runPlan.pads.find((p) => p.pad === 'hhOpen')
    expect(openPlan).toBeDefined()
    if (openPlan === undefined) return
    const openMs = openPlan.expectedMs[0]
    expect(openMs).toBeDefined()
    if (openMs === undefined) return

    const hits = [...play(runPlan), { pad: 'hhClosed' as const, ms: openMs + 20 }]
    const result = gradeGrooveRun(runPlan, hits)

    expect(row(result, 'hhOpen')).toMatchObject({ matched: openPlan.expectedMs.length, slipped: 0 })
    expect(row(result, 'hhClosed')).toMatchObject({ extra: 1, slipped: 0 })
    expect(result.articulation).toEqual([])
  })

  it('property: expected = matched + missed + slipped on every row, articulation sums to slipped, and a hit set with no hi-hat pad never slips', () => {
    const grooveArb = fc.constantFrom(...referenceGrooves())
    const hitArb = fc.record({
      pad: fc.constantFrom<MappedDrumPad>('kick', 'snare', 'hhClosed', 'hhOpen', 'tomHigh'),
      ms: fc.integer({ min: -200, max: 6500 }),
    })
    fc.assert(
      fc.property(grooveArb, fc.array(hitArb, { maxLength: 30 }), (score, rawHits) => {
        const runPlan = planGrooveRun(score, 80)
        const result = gradeGrooveRun(runPlan, rawHits)

        for (const padRow of result.pads) {
          expect(padRow.expected).toBe(padRow.matched + padRow.missed + padRow.slipped)
        }

        const slippedByExpectedPad = new Map<MappedDrumPad, number>()
        for (const entry of result.articulation) {
          slippedByExpectedPad.set(entry.expected, (slippedByExpectedPad.get(entry.expected) ?? 0) + entry.count)
        }
        for (const padRow of result.pads) {
          expect(padRow.slipped).toBe(slippedByExpectedPad.get(padRow.pad) ?? 0)
        }

        const hasHiHatHit = rawHits.some((h) => h.pad === 'hhOpen' || h.pad === 'hhClosed')
        if (!hasHiHatHit) {
          expect(result.articulation).toEqual([])
          for (const padRow of result.pads) expect(padRow.slipped).toBe(0)
        }
      }),
    )
  })

  // worstUnisonGap and runSlipSteps are exercised by the pre-existing tests
  // above (e.g. "measures the gap only between limbs the score writes on one
  // instant" and "calls a whole-pattern displacement by its grid position");
  // none of them touch a sibling-articulation pad, so they are this task's
  // "unaffected" regression proof rather than new tests.

  /**
   * Regression for the bug where a slipped-in offset, appended at the END of
   * `offsets` regardless of which instant it answers, corrupted `drift()`'s
   * positional first-half/second-half split. hhClosed plays its first four
   * instants (0..3) on the OPEN hat instead — a slip on each — and every
   * instant (slipped or not) carries an offset of `i * 6.5`, a clean walk.
   * With offsets sorted back to instant order the two arithmetic halves are
   * off by exactly `8 * 6.5 = 52`ms; the pre-fix code (slip offsets tacked on
   * the tail) averaged this walk against itself and read 0.
   */
  it('sorts a slipped-in offset back into instant order before computing drift (regression, T.33 x T.17.7)', () => {
    const runPlan = plan() // moneyBeat at 80bpm: hhClosed has 16 expected instants
    const hhClosedPlan = runPlan.pads.find((p) => p.pad === 'hhClosed')
    expect(hhClosedPlan).toBeDefined()
    if (hhClosedPlan === undefined) return
    expect(hhClosedPlan.expectedMs.length).toBe(16)

    const hhHits = hhClosedPlan.expectedMs.map((ms, i) => ({
      pad: i < 4 ? ('hhOpen' as const) : ('hhClosed' as const),
      ms: ms + i * 6.5,
    }))
    const hits = [...play(runPlan).filter((h) => h.pad !== 'hhClosed'), ...hhHits]
    const result = gradeGrooveRun(runPlan, hits)

    const hats = row(result, 'hhClosed')
    expect(hats?.matched).toBe(12)
    expect(hats?.slipped).toBe(4)
    expect(result.articulation).toEqual([{ expected: 'hhClosed', played: 'hhOpen', count: 4 }])
    expect(hats?.driftMs).toBeCloseTo(52, 9)
    expect(result.steady).toBe(false)
  })

  /**
   * Pins the order `applyArticulationSlips` pushes entries in: the direction
   * whose EXPECTED pad is the sibling pair's first element (`hhOpen`) before
   * the reverse — a mutant swapping the two directions in the array would
   * flip this. Built so BOTH directions fire in the same run: one closed
   * instant played open, and both open instants played closed.
   */
  it('orders articulation slips expected-hhOpen-first, then the reverse (pins the direction order)', () => {
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80) // 14 hhClosed, 2 hhOpen expected (2 graded bars)
    const hits = playWithSwap(runPlan, (pad, index) => {
      if (pad === 'hhClosed' && index === 0) return 'hhOpen'
      if (pad === 'hhOpen') return 'hhClosed'
      return pad
    })
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.articulation).toEqual([
      { expected: 'hhOpen', played: 'hhClosed', count: 2 },
      { expected: 'hhClosed', played: 'hhOpen', count: 1 },
    ])
  })

  /**
   * Window-boundary mutant in the SLIP pass's own call to `pair()`: a
   * distance of exactly `windowMs` still slips, not just misses+extras.
   */
  it('slips a hit exactly windowMs from the missed instant (pins the strict `>` in the slip pass)', () => {
    const runPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const openPlan = runPlan.pads.find((p) => p.pad === 'hhOpen')
    expect(openPlan).toBeDefined()
    if (openPlan === undefined) return
    const openMs = openPlan.expectedMs[0]
    expect(openMs).toBeDefined()
    if (openMs === undefined) return

    const hits = [
      ...play(runPlan).filter((hit) => !(hit.pad === 'hhOpen' && hit.ms === openMs)),
      { pad: 'hhClosed' as const, ms: openMs + runPlan.windowMs },
    ]
    const result = gradeGrooveRun(runPlan, hits)

    // Only the FIRST loop's open instant was removed and replaced by the
    // boundary hit; the second loop's hhOpen instant is still genuinely
    // played, so it stays matched.
    expect(row(result, 'hhOpen')).toMatchObject({ matched: 1, missed: 0, slipped: 1 })
    expect(result.articulation).toEqual([{ expected: 'hhOpen', played: 'hhClosed', count: 1 }])
  })
})
