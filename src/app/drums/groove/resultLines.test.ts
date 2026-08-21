/**
 * The result panel's sentences. Every case here is one the e2e specs cannot
 * reach cheaply — a pad that landed nothing, an offset that rounds to zero, a
 * groove the learner played a pad that is not in it — and each of them is a
 * way the screen could quietly lie about what happened.
 */
import { describe, expect, it } from 'vitest'
import type { GroovePadResult, GrooveRunResult } from '@core/drums/practice/grade.ts'
import { gradeGrooveRun } from '@core/drums/practice/grade.ts'
import { grooveById } from '@core/drums/practice/library.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { diagnosisSentences, lastRunText, padLineText, verdictText } from './resultLines.ts'

function moneyBeatPlan(bpm = 80): GrooveRunPlan {
  const groove = grooveById('money-beat')
  if (groove === undefined) throw new Error('money-beat missing from the trainer library')
  return planGrooveRun(groove, bpm)
}

function row(overrides: Partial<GroovePadResult>): GroovePadResult {
  return {
    pad: 'snare',
    expected: 4,
    hits: 4,
    matched: 4,
    missed: 0,
    extra: 0,
    meanOffsetMs: 0,
    spreadMs: 0,
    driftMs: 0,
    ...overrides,
  }
}

describe('verdictText', () => {
  it('says steady, never clean or accurate — the latency argument allows only the former', () => {
    expect(verdictText({ steady: true } as GrooveRunResult)).toBe('Steady run')
    expect(verdictText({ steady: false } as GrooveRunResult)).toBe('Not there yet')
  })
})

describe('padLineText', () => {
  it('names the pad, its own count and its own offset', () => {
    expect(padLineText(row({ pad: 'hhClosed', expected: 16, hits: 16, matched: 16, meanOffsetMs: 12.4 }))).toBe(
      'Hi-hat — 16 of 16, 12 ms late',
    )
  })

  it('says early for a negative offset', () => {
    expect(padLineText(row({ meanOffsetMs: -8.6 }))).toBe('Snare — 4 of 4, 9 ms early')
  })

  /** "0 ms late" is a figure the machine cannot actually resolve; the words have to stop there. */
  it('says dead on rather than 0 ms when the mean rounds to zero', () => {
    expect(padLineText(row({ meanOffsetMs: 0.4 }))).toBe('Snare — 4 of 4, dead on')
    expect(padLineText(row({ meanOffsetMs: -0.4 }))).toBe('Snare — 4 of 4, dead on')
  })

  /**
   * The negative arm of the claim spec: a limb that played nothing where the
   * groove asked for four strokes. It must still be a line, and it must still
   * be counted — silence is the failure being reported.
   */
  it('reports a limb that landed nothing as missed, with no offset invented for it', () => {
    const line = padLineText(
      row({ pad: 'kick', hits: 0, matched: 0, missed: 4, meanOffsetMs: undefined, spreadMs: undefined, driftMs: undefined }),
    )
    expect(line).toBe('Kick — 0 of 4, 4 missed')
    expect(line).not.toMatch(/ms/)
  })

  it('reports misses and extras together when a limb did both', () => {
    expect(padLineText(row({ pad: 'hhClosed', expected: 14, hits: 12, matched: 10, missed: 4, extra: 2, meanOffsetMs: 3 }))).toBe(
      'Hi-hat — 10 of 14, 3 ms late, 4 missed, 2 extra',
    )
  })

  /** "0 of 0" would read as a pass. A pad the groove never asks for says what it is. */
  it('does not score a pad the groove never asked for as if it were perfect', () => {
    const line = padLineText(
      row({ pad: 'crash1', expected: 0, hits: 3, matched: 0, missed: 0, extra: 3, meanOffsetMs: undefined, spreadMs: undefined, driftMs: undefined }),
    )
    expect(line).toBe('Crash — not in this groove, 3 extra')
    expect(line).not.toContain('0 of 0')
  })

  it('always follows the count with something, so no line stops at the count alone', () => {
    for (const candidate of [
      row({}),
      row({ matched: 0, hits: 0, missed: 4, meanOffsetMs: undefined }),
      row({ matched: 2, missed: 2, extra: 1, hits: 3 }),
    ]) {
      expect(padLineText(candidate)).toMatch(/, .+$/)
    }
  })
})

describe('diagnosisSentences', () => {
  const plan = moneyBeatPlan()

  it('says nothing at all about a steady run', () => {
    const perfect = gradeGrooveRun(
      plan,
      plan.pads.flatMap((padPlan) => padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms }))),
    )
    expect(perfect.steady).toBe(true)
    expect(diagnosisSentences(perfect, plan)).toEqual([])
  })

  /**
   * T.17.8. A run where nothing registered and a run where everything landed
   * in the wrong place both have zero matches. Only one of them is a rig
   * problem, and only the rig problem gets the "check your pads" sentence.
   */
  it('separates a run that registered nothing from a run that was simply wrong', () => {
    const silent = gradeGrooveRun(plan, [])
    expect(diagnosisSentences(silent, plan)[0]).toMatch(/Nothing registered/)

    const kickPlan = plan.pads.find((padPlan) => padPlan.pad === 'kick')
    if (kickPlan === undefined) throw new Error('the money beat has a kick')
    const allWrong = gradeGrooveRun(
      plan,
      kickPlan.expectedMs.map((ms) => ({ pad: 'crash1' as const, ms })),
    )
    expect(allWrong.totalHits).toBeGreaterThan(0)
    expect(diagnosisSentences(allWrong, plan).join(' ')).not.toMatch(/Nothing registered/)
  })

  it('reports a whole-pattern displacement in grid steps, named as eighths at this density', () => {
    const late = gradeGrooveRun(
      plan,
      plan.pads.flatMap((padPlan) =>
        padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + plan.subdivisionMs })),
      ),
    )
    expect(late.slipSteps).toBe(1)
    expect(diagnosisSentences(late, plan)[0]).toBe(
      'The whole pattern sat 1 eighth behind the click. The pattern is right; where you came in is not.',
    )
  })

  it('pluralises the step count and turns a negative slip into "ahead of"', () => {
    const early = gradeGrooveRun(
      plan,
      plan.pads.flatMap((padPlan) =>
        padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms - 2 * plan.subdivisionMs })),
      ),
    )
    expect(early.slipSteps).toBe(-2)
    expect(diagnosisSentences(early, plan)[0]).toContain('2 eighths ahead of the click')
  })

  it('names the loosest limb, not the run, when the spread is what failed', () => {
    const scatter = [37, -41, 44, -39]
    const hits = plan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms, i) => ({
        pad: padPlan.pad,
        ms: padPlan.pad === 'snare' ? ms + (scatter[i % scatter.length] ?? 0) : ms,
      })),
    )
    const graded = gradeGrooveRun(plan, hits)
    expect(graded.steady).toBe(false)
    expect(diagnosisSentences(graded, plan).join(' ')).toContain('Snare scattered')
  })

  /** DESIGN.md: a screen that lists four faults at once has chosen nothing for the learner to fix. */
  it('never prints more than two sentences, however many things went wrong', () => {
    const messy = plan.pads.flatMap((padPlan, padIndex) =>
      padPlan.expectedMs.map((ms, i) => ({
        pad: padPlan.pad,
        ms: ms + plan.subdivisionMs + padIndex * 30 + i * 7,
      })),
    )
    const graded = gradeGrooveRun(plan, messy)
    expect(diagnosisSentences(graded, plan).length).toBeLessThanOrEqual(2)
  })

  it('calls one step a beat when the groove is on straight quarters', () => {
    const quarters = moneyBeatPlan()
    const rock = grooveById('quarter-note-rock')
    if (rock === undefined) throw new Error('quarter-note-rock missing from the trainer library')
    const rockPlan = planGrooveRun(rock, 80)
    expect(rockPlan.subdivisionMs).toBe(rockPlan.beatMs)
    const late = gradeGrooveRun(
      rockPlan,
      rockPlan.pads.flatMap((padPlan) =>
        padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + rockPlan.subdivisionMs })),
      ),
    )
    expect(diagnosisSentences(late, rockPlan)[0]).toContain('1 beat behind the click')
    expect(quarters.subdivisionMs).not.toBe(quarters.beatMs)
  })
})

describe('lastRunText', () => {
  it('names the groove and the tempo it was played at, not just that there was one', () => {
    expect(lastRunText('Money Beat', 80, true)).toBe('Last run: Money Beat at 80 bpm — steady')
    expect(lastRunText('Money Beat', 70, false)).toBe(
      'Last run: Money Beat at 70 bpm — not there yet',
    )
  })
})
