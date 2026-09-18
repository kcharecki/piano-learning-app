import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import { jazzRideDrills } from '@core/drums/coordination/jazzRide.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import {
  applyWaitHit,
  INITIAL_WAIT_STATE,
  stepPosition,
  waitSteps,
  type WaitState,
  type WaitStep,
} from './wait.ts'

const PLANS: readonly [string, GrooveRunPlan][] = grooveTrainerLibrary().map(
  (score) => [score.title, planGrooveRun(score, 80)] as const,
)

/** Independent count of every expected instant across every pad in `plan` — not `waitSteps`' own tally. */
function totalExpectedCount(plan: GrooveRunPlan): number {
  let total = 0
  for (const padPlan of plan.pads) total += padPlan.expectedMs.length
  return total
}

describe('waitSteps', () => {
  for (const [name, plan] of PLANS) {
    describe(name, () => {
      it('is strictly ascending by atMs, with unique pads per step', () => {
        const steps = waitSteps(plan)
        for (let i = 1; i < steps.length; i++) {
          const prev = steps[i - 1]
          const curr = steps[i]
          expect(prev).toBeDefined()
          expect(curr).toBeDefined()
          if (prev === undefined || curr === undefined) continue
          expect(curr.atMs).toBeGreaterThan(prev.atMs)
        }
        for (const step of steps) {
          expect(new Set(step.pads).size).toBe(step.pads.length)
        }
      })

      it('indexes 0..n-1 in order', () => {
        const steps = waitSteps(plan)
        steps.forEach((step, i) => expect(step.index).toBe(i))
      })

      it('sums to the total number of expected instants across every plan pad', () => {
        const steps = waitSteps(plan)
        const sum = steps.reduce((total, step) => total + step.pads.length, 0)
        expect(sum).toBe(totalExpectedCount(plan))
      })

      it('hitting every step in order from INITIAL reaches the end with exactly one non-extra outcome per pad-instant', () => {
        const steps = waitSteps(plan)
        let state: WaitState = INITIAL_WAIT_STATE
        let nonExtra = 0
        for (const step of steps) {
          for (const pad of step.pads) {
            const applied = applyWaitHit(steps, state, pad)
            expect(applied.outcome).not.toBe('extra')
            expect(applied.outcome).not.toBe('done')
            nonExtra += 1
            state = applied.state
          }
        }
        expect(state.stepIndex).toBe(steps.length)
        expect(nonExtra).toBe(totalExpectedCount(plan))
      })

      it('the last pad of a step yields "advanced", every earlier one "required"', () => {
        const steps = waitSteps(plan)
        const firstMultiPad = steps.find((step) => step.pads.length > 1)
        if (firstMultiPad === undefined) return
        let state: WaitState = { stepIndex: firstMultiPad.index, satisfied: [] }
        firstMultiPad.pads.forEach((pad, i) => {
          const applied = applyWaitHit(steps, state, pad)
          if (i === firstMultiPad.pads.length - 1) {
            expect(applied.outcome).toBe('advanced')
          } else {
            expect(applied.outcome).toBe('required')
          }
          state = applied.state
        })
      })

      it('a pad outside the current step\'s unsatisfied set is "extra" and returns the identical state object', () => {
        const steps = waitSteps(plan)
        if (steps.length === 0) return
        const allPads: readonly MappedDrumPad[] = [
          'kick',
          'hhPedal',
          'tomFloor',
          'tomMid',
          'snare',
          'snareRim',
          'crossStick',
          'tomHigh',
          'hhClosed',
          'hhOpen',
          'rideBow',
          'rideBell',
          'rideEdge',
          'crash1',
          'crash2',
          'splash',
        ]
        fc.assert(
          fc.property(fc.constantFrom(...steps), fc.constantFrom(...allPads), (step, pad) => {
            const state: WaitState = { stepIndex: step.index, satisfied: [] }
            if (step.pads.includes(pad)) return // needed now — not the case under test
            const applied = applyWaitHit(steps, state, pad)
            expect(applied.outcome).toBe('extra')
            expect(applied.state).toBe(state)
          }),
        )
      })

      it('a pad already satisfied this step is "extra" too', () => {
        const steps = waitSteps(plan)
        const firstMultiPad = steps.find((step) => step.pads.length > 1)
        if (firstMultiPad === undefined) return
        const already = firstMultiPad.pads[0]
        if (already === undefined) return
        const state: WaitState = { stepIndex: firstMultiPad.index, satisfied: [already] }
        const applied = applyWaitHit(steps, state, already)
        expect(applied.outcome).toBe('extra')
        expect(applied.state).toBe(state)
      })

      it('once done, every further hit stays "done" and the state is unchanged', () => {
        const steps = waitSteps(plan)
        const done: WaitState = { stepIndex: steps.length, satisfied: [] }
        fc.assert(
          fc.property(fc.constantFrom<MappedDrumPad>('kick', 'hhClosed', 'snare'), (pad) => {
            const applied = applyWaitHit(steps, done, pad)
            expect(applied.outcome).toBe('done')
            expect(applied.state).toBe(done)
          }),
        )
      })
    })
  }

  // F6: an independent count, built without touching `waitSteps`' own
  // Map-keyed grouping, across every bpm in range and every library groove —
  // not just the fixed 80bpm `PLANS` above.
  it('produces one step per distinct expectedMs value, and each step\'s pad count matches an independent count, for any bpm and library groove', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...grooveTrainerLibrary()),
        fc.integer({ min: 40, max: 200 }),
        (score, bpm) => {
          const plan = planGrooveRun(score, bpm)
          const steps = waitSteps(plan)

          const distinctMs = new Set<number>()
          for (const padPlan of plan.pads) {
            for (const ms of padPlan.expectedMs) distinctMs.add(ms)
          }
          expect(steps.length).toBe(distinctMs.size)

          for (const step of steps) {
            const independentCount = plan.pads.filter((padPlan) =>
              padPlan.expectedMs.includes(step.atMs),
            ).length
            expect(step.pads.length).toBe(independentCount)
          }
        },
      ),
    )
  })
})

describe('applyWaitHit with a step whose pads carry a duplicate', () => {
  it('completes a step built with a repeated pad from a single hit', () => {
    const steps: readonly WaitStep[] = [{ index: 0, atMs: 0, nominalAtMs: 0, pads: ['kick', 'kick'] }]
    const applied = applyWaitHit(steps, INITIAL_WAIT_STATE, 'kick')
    expect(applied.outcome).toBe('advanced')
    expect(applied.state).toEqual({ stepIndex: 1, satisfied: [] })
  })
})

describe('stepPosition', () => {
  // Quarter-Note Rock (library[0]) at 80 bpm: 1-bar groove, hi-hat on every
  // quarter, kick on 1 and 3, snare on 2 and 4, graded over 2 bars — a beat
  // is 750ms and a bar 3000ms, so every notated instant here lands exactly on
  // a beat (never off it).
  const plan = planGrooveRun(grooveTrainerLibrary()[0], 80)
  const steps = waitSteps(plan)

  it('places atMs 0 at bar 1, beat 1, subdivision 0', () => {
    const first = steps[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(first.atMs).toBe(0)
    expect(stepPosition(first, plan)).toEqual({ bar: 1, beat: 1, subdivision: 0 })
  })

  it('places atMs === barMs at bar 2, beat 1, subdivision 0', () => {
    const atBarMs = steps.find((step) => step.atMs === plan.barMs)
    expect(atBarMs).toBeDefined()
    if (atBarMs === undefined) return
    expect(stepPosition(atBarMs, plan)).toEqual({ bar: 2, beat: 1, subdivision: 0 })
  })

  it('every quarter-note step in this groove lands on subdivision 0', () => {
    for (const step of steps) {
      expect(stepPosition(step, plan).subdivision).toBe(0)
    }
  })

  // Pinned sixteenth-grid readings within one beat, independent of any real
  // groove's own instants — a hand-built `WaitStep` at each grid point.
  const fakeStep = (atMs: number): WaitStep => ({ index: 0, atMs, nominalAtMs: atMs, pads: [] })

  it('reads beatMs/4 as subdivision 1 ("e")', () => {
    expect(stepPosition(fakeStep(plan.beatMs / 4), plan).subdivision).toBe(1)
  })

  it('reads beatMs/2 as subdivision 2 ("and")', () => {
    expect(stepPosition(fakeStep(plan.beatMs / 2), plan).subdivision).toBe(2)
  })

  it('reads 3*beatMs/4 as subdivision 3 ("a")', () => {
    expect(stepPosition(fakeStep((3 * plan.beatMs) / 4), plan).subdivision).toBe(3)
  })

  it('reads a triplet instant (beatMs/3) as subdivision undefined — off the sixteenth grid', () => {
    expect(stepPosition(fakeStep(plan.beatMs / 3), plan).subdivision).toBeUndefined()
  })

  it('never rounds a beat-boundary instant to a subdivision of 4 — it rolls into the next beat at 0', () => {
    const pos = stepPosition(fakeStep(plan.beatMs - 1e-9), plan)
    expect(pos.beat).toBe(2)
    expect(pos.subdivision).toBe(0)
  })

  it('has at least one "and" (subdivision 2) instant across the library — Money Beat opens the hat on it', () => {
    const found = grooveTrainerLibrary().some((score) => {
      const p = planGrooveRun(score, 80)
      return waitSteps(p).some((step) => stepPosition(step, p).subdivision === 2)
    })
    expect(found).toBe(true)
  })
})

describe('stepPosition on a swung plan (F3)', () => {
  // Jazz ride drill 3 ("comp on the & of 2", roadmap DR-15 coordination) at
  // 120bpm: the snare's swung instant lands at 835.42ms (swingPercent 67
  // bends the & later), but its NOMINAL instant is 750ms — bar 1, beat 2,
  // the "and". Pre-fix, `stepPosition` read `subdivision` off the swung
  // 835.42ms itself: 835.42 - 500 (beat start) = 335.42ms into the beat,
  // against a 125ms sixteenth grid that is 39.58ms off the nearest tick
  // (well past EPSILON_MS), so it reported `subdivision: undefined` and
  // waitText.ts rendered "(off the beat)" for this and every other swung
  // off-beat step. This test kills that mutant: reading off `nominalAtMs`
  // (750ms, exactly on the "and") must report `subdivision: 2`.
  const jazzPlan = planGrooveRun(jazzRideDrills()[2]!.score, 120)
  const jazzSteps = waitSteps(jazzPlan)

  it('reads the swung snare-comp step\'s nominal instant as bar 1, beat 2, subdivision 2 (the "and"), not undefined', () => {
    const step = jazzSteps[2]
    expect(step).toBeDefined()
    if (step === undefined) return
    expect(step.atMs).toBeCloseTo(835.4167, 3)
    expect(step.nominalAtMs).toBe(750)
    expect(step.pads).toEqual(['rideBow', 'snare'])
    expect(stepPosition(step, jazzPlan)).toEqual({ bar: 1, beat: 2, subdivision: 2 })
  })
})

describe('stepPosition bar/beat is read off nominalAtMs, never the swung atMs (A1)', () => {
  // A1: pre-fix, `bar`/`beat`/`intoBar` were computed from the swung `atMs`
  // while `subdivision` was already computed from `nominalAtMs` (F3) — a
  // step whose swing pushes it PAST a beat boundary got a beat number that
  // disagreed with its own subdivision. Reproduced with a 125ms beat (500ms
  // bar): a note whose NOMINAL instant is 250ms sits exactly on the start of
  // beat 3 (2*125=250) — {bar:1, beat:3, subdivision:0} — but its swung
  // instant of 375ms (75% eighth swing having pushed it a further 125ms
  // late, e.g. the 4th sixteenth of a 16th-note grid swung a full cell) sits
  // exactly on the start of beat 4. Pre-fix, `stepPosition` would have
  // returned `bar:1, beat:4` (from the swung 375ms) combined with
  // `subdivision:0` (from the nominal 250ms) — the exact mismatched
  // `{bar:1, beat:4, subdivision:0}` this finding describes. Post-fix, both
  // beat and subdivision come from the same nominal instant, so this test
  // kills any mutant that reintroduces `step.atMs` into the bar/beat calc.
  const basePlan = planGrooveRun(grooveTrainerLibrary()[0], 80)
  const plan: GrooveRunPlan = { ...basePlan, beatMs: 125, barMs: 500 }
  const step: WaitStep = { index: 0, atMs: 375, nominalAtMs: 250, pads: [] }

  it('reads bar 1, beat 3, subdivision 0 from nominalAtMs=250, ignoring the swung atMs=375 (which alone would read beat 4)', () => {
    expect(stepPosition(step, plan)).toEqual({ bar: 1, beat: 3, subdivision: 0 })
  })
})
