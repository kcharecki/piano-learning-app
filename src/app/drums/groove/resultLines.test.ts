/**
 * The result panel's sentences. Every case here is one the e2e specs cannot
 * reach cheaply — a pad that landed nothing, an offset that rounds to zero, a
 * groove the learner played a pad that is not in it — and each of them is a
 * way the screen could quietly lie about what happened.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ArticulationSlip, GroovePadResult, GrooveRunResult } from '@core/drums/practice/grade.ts'
import { gradeGrooveRun, type GrooveHit } from '@core/drums/practice/grade.ts'
import { moneyBeat, moneyBeatOpenHat, quarterNoteRock, referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { jazzRideDrills } from '@core/drums/coordination/jazzRide.ts'
import { makeGrooveScore } from '@core/drums/model/groove.ts'
import { swungTick } from '@core/drums/model/swing.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { ticks } from '@core/shared/units.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { GROOVE_PAD_LABEL } from './padLabels.ts'
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
    // DR-07 tail: also required, also unread by `padLineText`. Tests that
    // exercise the per-pad displacement sentence build real results through
    // `gradeGrooveRun` instead of this literal (see below).
    displacementSteps: 0,
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

/**
 * R1. F1 skips `slipSteps` for any swung plan, so a swung run played
 * uniformly late has nothing for `slipSteps`, `worstUnisonGap`, `spreadMs` or
 * `driftMs` to read — every one of those needs a matched hit, and a uniform
 * offset past the window has none. Reusing grade.test.ts's own F1 probe
 * (jazz-ride drill 3 at 120 bpm, every stroke shifted by exactly one nominal
 * eighth, 240 ticks = 250 ms at 120 bpm): pre-fix, `diagnosisSentences`
 * returned `[]` here (verdict "Not there yet" with no explanation at all).
 */
describe('diagnosisSentences when every stroke misses its window (R1)', () => {
  it('names it directly instead of returning an empty diagnosis', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    expect(jazzPlan.swingPercent).toBe(67)
    const msPerTick = 60_000 / 120 / 480
    const offsetMs = 240 * msPerTick
    expect(offsetMs).toBeCloseTo(250, 6)

    const hits: GrooveHit[] = jazzPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad as MappedDrumPad, ms: ms + offsetMs })),
    )
    const result = gradeGrooveRun(jazzPlan, hits)
    expect(result.steady).toBe(false)
    expect(result.totalHits).toBeGreaterThan(0)
    expect(result.pads.every((row) => row.matched === 0)).toBe(true)
    expect(result.slipSteps).toBeUndefined()

    expect(diagnosisSentences(result, jazzPlan)).toEqual([
      'Every stroke landed outside its window — the pattern is there, where you came in is not. Restart on the count-in.',
    ])
  })
})

/**
 * Round-3 RED: the R1 all-missed branch above fired unconditionally on
 * "every pad matched === 0", pre-empting the slip sentence below it — but a
 * STRAIGHT drill (swingPercent 50, so `slipSteps` is NOT skipped by F1) shifted
 * by exactly one whole subdivision also has every pad `matched === 0` (each
 * hit lands on the NEXT expected instant of a different pad, never its own),
 * while `slipSteps` is defined and names the fix far more precisely. Kick on
 * 1 and 3, snare on 2 and 4 only (no hi-hat) — the hi-hat's own instants are
 * exactly one subdivision apart, which would let a shifted hi-hat hit
 * re-match its own next instant and mask the bug this test is for.
 */
describe('diagnosisSentences prefers the slip sentence over all-missed when both conditions hold (round-3 RED)', () => {
  it('a straight drill shifted by exactly one subdivision reports the slip, not the generic all-missed line', () => {
    const score = makeGrooveScore({
      id: 'kick-snare-only',
      title: 'Kick and snare only',
      measureCount: 1,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 480 },
        { pad: 'kick', tick: 960, durationTicks: 480 },
        { pad: 'snare', tick: 480, durationTicks: 480 },
        { pad: 'snare', tick: 1440, durationTicks: 480 },
      ],
    })
    const plan = planGrooveRun(score, 120)
    expect(plan.swingPercent).toBe(50)
    // Computed from the plan, not assumed: one subdivision, in ms.
    const offsetMs = plan.subdivisionMs

    const hits: GrooveHit[] = plan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad as MappedDrumPad, ms: ms + offsetMs })),
    )
    const result = gradeGrooveRun(plan, hits)
    expect(result.steady).toBe(false)
    expect(result.pads.every((row) => row.matched === 0)).toBe(true)
    expect(result.slipSteps).toBe(1)

    expect(diagnosisSentences(result, plan)).toEqual([
      'The whole pattern sat 1 beat behind the click. The pattern is right; where you came in is not.',
    ])
  })
})

/**
 * DR-07 tail: `runSlipSteps` only speaks when every played pad agrees, so a
 * run where exactly one limb is a grid step off and the rest are exact —
 * `slipSteps === undefined`, `steady === false` — used to reach the learner
 * as "Not there yet" with no reason at all. `diagnosisSentences` now names
 * the one displaced limb in that specific shape, built here through the real
 * grader on real drill content, never through a hand-built `GrooveRunResult`.
 */
describe('diagnosisSentences: per-pad displacement sentence (DR-07 tail)', () => {
  it('names the one displaced limb when the whole-pattern vote cannot agree — jazz-ride drill 3, snare one eighth late', () => {
    const jazzStep3 = jazzRideDrills()[2]
    expect(jazzStep3).toBeDefined()
    if (jazzStep3 === undefined) return
    const jazzPlan = planGrooveRun(jazzStep3.score, 120)
    expect(jazzPlan.swingPercent).toBe(67)
    const swingArgs = [
      jazzPlan.swing.percent,
      jazzPlan.swing.unit,
      jazzPlan.swing.measureTicks,
      jazzPlan.swing.beats,
      jazzPlan.swing.beatType,
    ] as const

    // Every snare instant struck one nominal eighth late (re-swung); ride and
    // pedal exactly as written.
    const hits: GrooveHit[] = jazzPlan.pads.flatMap((padPlan) =>
      padPlan.pad === 'snare'
        ? padPlan.expectedNominalTicks.map((nominalTick) => ({
            pad: padPlan.pad,
            ms:
              (swungTick(ticks(nominalTick + jazzPlan.nominalSubdivisionTicks), ...swingArgs) as number) *
              jazzPlan.msPerTick,
          }))
        : padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms })),
    )
    const result = gradeGrooveRun(jazzPlan, hits)
    expect(result.slipSteps).toBeUndefined()
    expect(result.steady).toBe(false)

    expect(diagnosisSentences(result, jazzPlan)[0]).toBe(
      `${GROOVE_PAD_LABEL.snare} sat 1 eighth behind the other limbs, which sit on the grid. Move ${GROOVE_PAD_LABEL.snare} to meet them.`,
    )
  })

  it('says "ahead of" for a limb displaced early — money beat, kick one eighth early', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) =>
      padPlan.pad === 'kick'
        ? padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms - runPlan.nominalSubdivisionMs }))
        : padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms })),
    )
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBeUndefined()
    expect(result.steady).toBe(false)

    expect(diagnosisSentences(result, runPlan)[0]).toBe(
      `${GROOVE_PAD_LABEL.kick} sat 1 eighth ahead of the other limbs, which sit on the grid. Move ${GROOVE_PAD_LABEL.kick} to meet them.`,
    )
  })

  it('example: all pads one eighth late gives only the whole-pattern sentence, never the per-pad one', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + runPlan.nominalSubdivisionMs })),
    )
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBe(1)

    const sentences = diagnosisSentences(result, runPlan)
    expect(sentences[0]).toBe(
      'The whole pattern sat 1 eighth behind the click. The pattern is right; where you came in is not.',
    )
    expect(sentences.some((sentence) => sentence.includes('the other limbs'))).toBe(false)
  })

  it('example: two pads displaced by different steps gets no per-pad sentence either', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) => {
      if (padPlan.pad === 'kick') {
        return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + runPlan.nominalSubdivisionMs }))
      }
      if (padPlan.pad === 'snare') {
        return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms - runPlan.nominalSubdivisionMs }))
      }
      return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms }))
    })
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBeUndefined()

    const sentences = diagnosisSentences(result, runPlan)
    expect(sentences.every((sentence) => !sentence.includes('the other limbs'))).toBe(true)
  })

  /**
   * The per-pad sentence must never fire alongside (or instead of) the
   * whole-pattern one: whenever `slipSteps` is defined, `diagnosisSentences`
   * must not produce the "...the other limbs..." wording, for any reference
   * groove, at any tempo, for any whole nominal-grid-step shift the vote
   * happens to agree on.
   */
  /**
   * Review round 2, RED #1: with only ONE pad played, the old guard
   * (`onGrid.length === played.length - 1`, i.e. `0 === 0`) held trivially,
   * so a learner who played only the hi-hat — kick and snare silent, each
   * reading "0 of 4, 4 missed" on its own row — was told the hi-hat sat off
   * "the other limbs", limbs that never played at all. `onGrid.length >= 1`
   * now requires at least one OTHER pad to actually be on the grid before the
   * per-pad sentence can point at anything.
   */
  it('gives no per-pad sentence when only one pad played, even though that pad is cleanly displaced', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) =>
      padPlan.pad === 'hhClosed'
        ? padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + runPlan.nominalSubdivisionMs }))
        : [],
    )
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBeUndefined()
    expect(result.steady).toBe(false)
    const hhRow = result.pads.find((r) => r.pad === 'hhClosed')
    expect(hhRow?.displacementSteps).toBe(1)
    const kickRow = result.pads.find((r) => r.pad === 'kick')
    const snareRow = result.pads.find((r) => r.pad === 'snare')
    expect(kickRow?.hits).toBe(0)
    expect(snareRow?.hits).toBe(0)

    const sentences = diagnosisSentences(result, runPlan)
    expect(sentences.every((sentence) => !sentence.includes('the other limbs'))).toBe(true)
  })

  /**
   * Review round 2, AMBER #4: a stray press on a pad the groove never asks
   * for (`expected === 0`) used to count as a "played" row with neither an
   * off nor an on-grid verdict, which could break the `off.length === 1 &&
   * onGrid.length === played.length - 1` shape and silence an otherwise-valid
   * diagnosis. `played` is now filtered to `expected > 0` too, so the stray
   * tom hit here does not touch the accounting at all.
   */
  it('still names the displaced snare when a stray hit lands on a pad outside the groove', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) =>
      padPlan.pad === 'snare'
        ? padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + runPlan.nominalSubdivisionMs }))
        : padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms })),
    )
    // moneyBeat never writes a tom — this pad's row will have expected === 0.
    hits.push({ pad: 'tomHigh', ms: 12 })
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBeUndefined()
    const tomRow = result.pads.find((r) => r.pad === 'tomHigh')
    expect(tomRow?.expected).toBe(0)

    expect(diagnosisSentences(result, runPlan)[0]).toBe(
      `${GROOVE_PAD_LABEL.snare} sat 1 eighth behind the other limbs, which sit on the grid. Move ${GROOVE_PAD_LABEL.snare} to meet them.`,
    )
  })

  /**
   * Review round 2, AMBER #6i: one pad cleanly displaced is not enough on its
   * own — every OTHER played pad must be confirmed on-grid
   * (`displacementSteps === 0`), not merely "not the displaced one". Here the
   * hi-hat's own hits are pushed far enough outside every candidate step's
   * window (`windowMs` either side of every shifted grid position, and not a
   * clean multiple of the grid step itself) that `padDisplacementSteps` finds
   * a zero-count tie across every step and reports `undefined` for hi-hat —
   * confirmed below, not assumed — so the snare's own displacement cannot be
   * named as "the other limbs are right" when one of those limbs' own grid
   * position is unknown.
   */
  it('gives no per-pad sentence when the other pad\'s own displacement cannot be pinned down either', () => {
    const runPlan = planGrooveRun(moneyBeat(), 80)
    const stray = runPlan.windowMs + 1
    const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) => {
      if (padPlan.pad === 'snare') {
        return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + runPlan.nominalSubdivisionMs }))
      }
      if (padPlan.pad === 'hhClosed') {
        return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + stray }))
      }
      return padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms }))
    })
    const result = gradeGrooveRun(runPlan, hits)
    expect(result.slipSteps).toBeUndefined()
    const hhRow = result.pads.find((r) => r.pad === 'hhClosed')
    expect(hhRow?.hits).toBeGreaterThan(0)
    expect(hhRow?.displacementSteps).toBeUndefined()
    const snareRow = result.pads.find((r) => r.pad === 'snare')
    expect(snareRow?.displacementSteps).toBe(1)

    const sentences = diagnosisSentences(result, runPlan)
    expect(sentences.every((sentence) => !sentence.includes('the other limbs'))).toBe(true)
  })

  it('property: the per-pad sentence never appears when the whole-pattern vote succeeds (slipSteps defined)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves()),
        fc.integer({ min: 40, max: 200 }),
        fc.integer({ min: -4, max: 4 }).filter((step) => step !== 0),
        (score, bpm, step) => {
          const runPlan = planGrooveRun(score, bpm)
          const hits: GrooveHit[] = runPlan.pads.flatMap((padPlan) =>
            padPlan.expectedMs.map((ms) => ({ pad: padPlan.pad, ms: ms + step * runPlan.nominalSubdivisionMs })),
          )
          const result = gradeGrooveRun(runPlan, hits)
          if (result.slipSteps === undefined) return
          const sentences = diagnosisSentences(result, runPlan)
          for (const sentence of sentences) {
            expect(sentence).not.toContain('the other limbs')
          }
        },
      ),
    )
  })
})
