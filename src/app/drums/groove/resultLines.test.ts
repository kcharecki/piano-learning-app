/**
 * The result panel's sentences. Every case here is one the e2e specs cannot
 * reach cheaply — a pad that landed nothing, an offset that rounds to zero, a
 * groove the learner played a pad that is not in it — and each of them is a
 * way the screen could quietly lie about what happened.
 */
import { describe, expect, it } from 'vitest'
import type { ArticulationSlip, GroovePadResult, GrooveRunResult } from '@core/drums/practice/grade.ts'
import { gradeGrooveRun } from '@core/drums/practice/grade.ts'
import { moneyBeat, moneyBeatOpenHat, quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import {
  articulationSentence,
  diagnosisSentences,
  gradedAtText,
  lastRunText,
  padLineText,
  verdictText,
} from './resultLines.ts'

function moneyBeatPlan(bpm = 80): GrooveRunPlan {
  return planGrooveRun(moneyBeat(), bpm)
}

function row(overrides: Partial<GroovePadResult>): GroovePadResult {
  return {
    pad: 'snare',
    expected: 4,
    hits: 4,
    matched: 4,
    missed: 0,
    extra: 0,
    // Not rendered by anything under test in this file — `padLineText` never
    // reads it — but a concurrent slice added it to `GroovePadResult` as a
    // required field, so a fixture that never sets it still needs a value.
    slipped: 0,
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

  /**
   * Roadmap T.33. An expected instant struck on time but on the sibling
   * articulation is neither a match nor a miss — it has to say so in plain
   * words rather than just vanish from the count (`expected === matched +
   * missed + slipped`, so a silently-dropped `slipped` reads as `expected`
   * strokes that no bucket accounts for).
   *
   * Kills the mutant that drops the `row.slipped > 0` guard (or negates it)
   * and the mutant that swaps `slipPhrase`'s sibling/own word order.
   */
  it('names a closed-for-open slip on an hhOpen row', () => {
    expect(
      padLineText(row({ pad: 'hhOpen', expected: 4, matched: 2, missed: 0, extra: 0, slipped: 2, meanOffsetMs: 0 })),
    ).toBe('Open hi-hat — 2 of 4, dead on, 2 played closed instead of open')
  })

  /** The reverse direction of the same mixup. Kills a mutant that hard-codes one direction's wording for both pads. */
  it('names an open-for-closed slip on an hhClosed row', () => {
    expect(
      padLineText(row({ pad: 'hhClosed', expected: 16, matched: 14, missed: 0, extra: 0, slipped: 2, meanOffsetMs: 0 })),
    ).toBe('Hi-hat — 14 of 16, dead on, 2 played open instead of closed')
  })

  /**
   * A row with `slipped === 0` must render byte-identical to how it did
   * before this feature existed. Kills the mutant that appends the slip
   * phrase unconditionally regardless of `row.slipped`.
   */
  it('never mentions slips on a row that had none', () => {
    expect(padLineText(row({ pad: 'hhClosed', expected: 8, matched: 6, missed: 2, extra: 0, slipped: 0 }))).toBe(
      'Hi-hat — 6 of 8, dead on, 2 missed',
    )
  })
})

describe('articulationSentence', () => {
  /**
   * The exact wording DR-09/T.33 promises: evidence-bearing, naming the count
   * against the pad's own expected total. Kills the mutant that swaps
   * `slip.expected`/`slip.played` in the sentence, and the mutant that reads
   * `slip.count` for the expected total instead of the row's own `expected`.
   */
  it('names a closed-for-open slip, with the count out of the expected row\'s own total', () => {
    const result = { pads: [row({ pad: 'hhOpen', expected: 4, matched: 2, slipped: 2 })] } as unknown as GrooveRunResult
    const slip: ArticulationSlip = { expected: 'hhOpen', played: 'hhClosed', count: 2 }
    expect(articulationSentence(slip, result)).toBe(
      'The hi-hat was played closed where the score asks for open (2 of 4).',
    )
  })

  /** The reverse direction. Kills a mutant that hard-codes 'open'/'closed' rather than reading `slip`. */
  it('names an open-for-closed slip', () => {
    const result = { pads: [row({ pad: 'hhClosed', expected: 16, matched: 14, slipped: 2 })] } as unknown as GrooveRunResult
    const slip: ArticulationSlip = { expected: 'hhClosed', played: 'hhOpen', count: 2 }
    expect(articulationSentence(slip, result)).toBe(
      'The hi-hat was played open where the score asks for closed (2 of 16).',
    )
  })

  /**
   * No row for `slip.expected` should never happen in practice (the slip came
   * FROM grading that pad), but the fallback must still produce a total
   * rather than throw. Kills the mutant that reads `expectedRow.expected`
   * without the `?? slip.count` fallback (a crash on `undefined`, not just a
   * wrong number).
   */
  it('falls back to the slip count itself when the expected pad has no row', () => {
    const result = { pads: [] } as unknown as GrooveRunResult
    const slip: ArticulationSlip = { expected: 'hhOpen', played: 'hhClosed', count: 3 }
    expect(articulationSentence(slip, result)).toBe(
      'The hi-hat was played closed where the score asks for open (3 of 3).',
    )
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
    const rockPlan = planGrooveRun(quarterNoteRock(), 80)
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

  /**
   * Roadmap T.33, built through the real grader rather than a hand-built
   * `GrooveRunResult`: money beat's hi-hat is struck on time, but the first
   * two eighths are played on the open pad instead of closed. Every other
   * pad is hit exactly on time, so the ONLY thing wrong with this run is the
   * articulation mixup — it must still be named, and named first.
   *
   * Kills the mutant that orders the articulation sentence after the timing
   * sentences instead of before them.
   */
  it('names an articulation slip first among the diagnosis sentences', () => {
    const hhClosedPlan = plan.pads.find((padPlan) => padPlan.pad === 'hhClosed')
    if (hhClosedPlan === undefined) throw new Error('the money beat has a hi-hat')
    const slipCount = 2
    const hits = plan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms, i) => ({
        pad: padPlan.pad === 'hhClosed' && i < slipCount ? ('hhOpen' as const) : padPlan.pad,
        ms,
      })),
    )
    const graded = gradeGrooveRun(plan, hits)
    expect(graded.steady).toBe(false)
    const hhClosedRow = graded.pads.find((r) => r.pad === 'hhClosed')
    expect(hhClosedRow?.slipped).toBe(slipCount)
    expect(diagnosisSentences(graded, plan)[0]).toBe(
      `The hi-hat was played open where the score asks for closed (${slipCount} of ${hhClosedRow?.expected}).`,
    )
  })

  /**
   * The reverse direction, on a groove that actually notates an open hi-hat:
   * both of moneyBeatOpenHat's open-hat instants (one per graded bar) are
   * played closed instead.
   *
   * Kills the mutant that only wires up one direction of `ARTICULATION_SIBLINGS`.
   */
  it('names the reverse (open played closed) direction on a groove with a real open hi-hat', () => {
    const openPlan = planGrooveRun(moneyBeatOpenHat(), 80)
    const hits = openPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({
        pad: padPlan.pad === 'hhOpen' ? ('hhClosed' as const) : padPlan.pad,
        ms,
      })),
    )
    const graded = gradeGrooveRun(openPlan, hits)
    const hhOpenRow = graded.pads.find((r) => r.pad === 'hhOpen')
    expect(hhOpenRow?.slipped).toBeGreaterThan(0)
    expect(diagnosisSentences(graded, openPlan)[0]).toBe(
      `The hi-hat was played closed where the score asks for open (${hhOpenRow?.slipped} of ${hhOpenRow?.expected}).`,
    )
  })

  /**
   * A steady run (including one with no slips at all) must print nothing —
   * unchanged behaviour. Kills the mutant that checks `result.articulation`
   * before the `result.steady` early return, which would print a sentence
   * fragment (or throw on an absent row) even for a perfect run.
   */
  it('prints nothing extra when there are no articulation slips', () => {
    const perfect = gradeGrooveRun(
      plan,
      plan.pads.flatMap((padPlan) => padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms }))),
    )
    expect(perfect.articulation).toEqual([])
    expect(diagnosisSentences(perfect, plan)).toEqual([])
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

describe('gradedAtText', () => {
  /**
   * Roadmap T.31: once a result survives a tempo change, the tempo control on
   * screen can no longer be trusted to say what tempo the figures beside it
   * were actually measured at — this line has to, on its own, every time.
   */
  it('names the exact tempo it was graded at', () => {
    expect(gradedAtText(80)).toBe('Graded at 80 bpm')
    expect(gradedAtText(200)).toBe('Graded at 200 bpm')
  })
})
