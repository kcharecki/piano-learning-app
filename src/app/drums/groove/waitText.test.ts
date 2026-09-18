import { describe, expect, it } from 'vitest'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import { applyWaitHit, INITIAL_WAIT_STATE, waitSteps, type WaitState } from '@core/drums/practice/wait.ts'
import { waitStateText } from './waitText.ts'

/** Quarter-Note Rock at 80 bpm — hi-hat every quarter, kick on 1/3, snare on 2/4, 2 bars graded. */
const plan = planGrooveRun(grooveTrainerLibrary()[0], 80)
const steps = waitSteps(plan)

describe('waitStateText', () => {
  it('idle: names the rule, not a step', () => {
    expect(waitStateText('idle', steps, INITIAL_WAIT_STATE, plan)).toBe(
      'Wait mode: the run moves on only when you strike every note of the current beat',
    )
  })

  it('waiting, step 1: names both pads of the first unison instant, in display order', () => {
    expect(waitStateText('waiting', steps, INITIAL_WAIT_STATE, plan)).toBe(
      'Waiting for Kick + Hi-hat — bar 1, beat 1 (step 1 of 8)',
    )
  })

  it('waiting, step 2: names the second instant’s pads, bar and beat advance', () => {
    const afterStep1: WaitState = { stepIndex: 1, satisfied: [] }
    expect(waitStateText('waiting', steps, afterStep1, plan)).toBe(
      'Waiting for Snare + Hi-hat — bar 1, beat 2 (step 2 of 8)',
    )
  })

  it('drops a pad from the sentence once it is satisfied, but not the step', () => {
    const oneStruck: WaitState = { stepIndex: 0, satisfied: ['kick'] }
    expect(waitStateText('waiting', steps, oneStruck, plan)).toBe(
      'Waiting for Hi-hat — bar 1, beat 1 (step 1 of 8)',
    )
  })

  it('done: the closing sentence, independent of step content', () => {
    const done: WaitState = { stepIndex: steps.length, satisfied: [] }
    expect(waitStateText('done', steps, done, plan)).toBe(
      'Done — every stroke landed. Start again or switch Wait off for a graded run.',
    )
  })

  it('walking every step with applyWaitHit produces the same sentence a learner would read at each one', () => {
    let state: WaitState = INITIAL_WAIT_STATE
    // Step 1 of 8 before any hit.
    expect(waitStateText('waiting', steps, state, plan)).toContain('step 1 of 8')
    for (const pad of steps[0]?.pads ?? []) {
      state = applyWaitHit(steps, state, pad).state
    }
    expect(waitStateText('waiting', steps, state, plan)).toContain('step 2 of 8')
  })

  /**
   * F2: `stepPosition`'s `subdivision` replaces the old boolean `offBeat`,
   * which printed " and" for ANY off-beat instant — wrong for a sixteenth
   * ("e"/"a"). Money Beat's hi-hat plays eighth notes, so its "and" instants
   * (tick 720 = bar 1, beat 2's "and") are a real eighth-note step to pin,
   * not a hand-built one.
   */
  it('renders " and" for an eighth-note "and" instant (Money Beat), not just for any off-beat one', () => {
    const moneyBeatScore = grooveTrainerLibrary()[1]
    expect(moneyBeatScore).toBeDefined()
    if (moneyBeatScore === undefined) return
    const moneyPlan = planGrooveRun(moneyBeatScore, 80)
    const moneySteps = waitSteps(moneyPlan)
    // Index 3: ticks 0, 240, 480, 720 sort ascending — 720 is the 4th distinct
    // instant, a hi-hat-only step (kick/snare sit on 0/480/960/1440).
    const state: WaitState = { stepIndex: 3, satisfied: [] }
    expect(waitStateText('waiting', moneySteps, state, moneyPlan)).toBe(
      'Waiting for Hi-hat — bar 1, beat 2 and (step 4 of 16)',
    )
  })
})
