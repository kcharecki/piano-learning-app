/**
 * `padDisplacementSteps` — the per-PAD sibling of `grade.ts`'s
 * whole-pattern `runSlipSteps` (roadmap DR-07 tail).
 *
 * `runSlipSteps` only speaks when EVERY played pad agrees on the same grid
 * displacement, and says nothing at all otherwise — including the common
 * case where one limb is a grid step off and the rest are exactly on time
 * (a snare comp played an eighth late against an on-time ride and pedal).
 * That run is correctly graded `steady === false` (the snare really did miss
 * its window), but the diagnosis has nothing to say: `slipSteps` is
 * `undefined` because the pads disagree, and no other branch of
 * `resultLines.ts`'s `diagnosisSentences` names a single displaced limb.
 *
 * This function asks `runSlipSteps`'s own question — "which whole number of
 * NOMINAL grid-steps, re-swung, best explains this pad's hits" — for ONE
 * pad's hits alone, so `resultLines.ts` can name that limb even when the
 * whole-pattern vote never reaches agreement. It is deliberately a plain
 * function of fields, not of `GroovePadPlan`/`GrooveRunPlan` records, so it
 * has no opinion on which pad it is being asked about and no orphaned reads
 * of a record it does not need in full.
 *
 * ## Why STRICT maximum, and why a coverage floor (not "half")
 *
 * A tie between two candidate steps means the hits are equally well (or
 * equally badly) explained by two different grid positions — exactly the
 * shape `runSlipSteps` itself refuses to call a displacement for, and the
 * same refusal applies here at the single-pad level: reporting either one
 * would be a coin flip dressed up as a diagnosis.
 *
 * The coverage floor is `runSlipSteps`'s own `SLIP_COVERAGE` (0.75), scaled
 * to this one pad's own expected count and floored at 2 —
 * `Math.max(2, Math.ceil(expectedNominalTicks.length * SLIP_COVERAGE))` — NOT
 * a bare half. Review round 2 found the earlier `ceil(expected / 2)` rule let
 * a 2-instant pad "prove" displacement from a SINGLE matching stroke, with
 * the other instant simply missing: jazz drill 3's snare, one hit landed a
 * step late and the other never played at all, met `ceil(2 / 2) = 1` and was
 * reported as a clean displacement. That is not the same claim `runSlipSteps`
 * makes about the whole pattern (three-quarters of everything the score
 * asked for actually lands at the agreed step); it was a materially weaker
 * one wearing the same sentence. The `Math.max(2, ...)` floor also matters on
 * its own: without it, a pad with exactly ONE expected instant would need
 * `ceil(1 * 0.75) = 1` match to "win" — a single stroke, on its own, proving
 * its own displacement, which is a tautology, not a diagnosis. Requiring at
 * least 2 means a one-instant pad can never be named here on its own (it can
 * still be part of the whole-pattern vote in `runSlipSteps`, which sums
 * across every pad before applying its own floor).
 *
 * ## Two known "no sentence" shapes — not bugs
 *
 * **Periodic aliasing when a stroke is missing.** A pad whose own expected
 * instants repeat at a fixed spacing (most groove pads do — a steady eighth-
 * note hi-hat, say) ties candidate step `k` with `k ± period` once one of its
 * strokes is simply absent: the missing stroke was the one thing that broke
 * the symmetry between "shifted by k" and "shifted by k, then aliased onto a
 * neighbour's position". The STRICT-maximum rule above then refuses to pick
 * either, and `padDisplacementSteps` reports `undefined` rather than a coin
 * flip. Concretely: taking every reference groove at every tempo
 * `MIN_BPM..MAX_BPM` and every candidate step, shifting a pad's expected
 * instants by that step, then dropping the FIRST hit and re-asking
 * `padDisplacementSteps` — a spot check over roughly 6,500 such pad-cases
 * found a bit over half turned from a clean, defined step into `undefined`
 * once that one hit was gone. This is the intended shape of the guard, not a
 * gap in it: the sentence is only ever offered for a limb that is CLEANLY
 * displaced, never inferred through a hole in the evidence.
 *
 * **The band between grid steps reads as silence.** Because the candidate
 * set is whole nominal grid-steps only, a lag that lands strictly between two
 * of them matches neither step's shifted position within `windowMs` and this
 * function returns `undefined` for that instant at every step — no sentence,
 * rather than a guess at the nearer step. At the money beat's default 100 bpm
 * plan (see `referenceGrooves.ts`), a nominal eighth is 300 ms and
 * `windowMs` is 100 ms (the trainer's tolerance, tighter here than half a
 * subdivision — see `plan.ts`'s `windowMs`); step 0's window covers a hit up
 * to 100 ms late, step 1's window covers 200-400 ms late, so a lag from just
 * past 100 ms to just short of 200 ms matches neither and reads as silence,
 * while a lag of one full nominal eighth (300 ms) sits in the middle of step
 * 1's window and reads cleanly as "one eighth".
 */
import { matchCountAt, SLIP_COVERAGE } from './matchCount.ts'
import type { SwingContext } from './plan.ts'
import { shiftedExpectedMs } from './slipShift.ts'

/**
 * `expectedNominalTicks` and `hits` (this pad's own hits, ms) come from the
 * caller (`GroovePadPlan.expectedNominalTicks`, the plan's own
 * `nominalSubdivisionTicks`/`swing`/`msPerTick`, and `MAX_SLIP_STEPS` for
 * `maxSteps` — see `grade.ts`) rather than a whole plan/pad-plan record, per
 * the module doc above.
 *
 * For each candidate `step` in `-maxSteps..maxSteps`, counts how many of
 * `expectedNominalTicks` — shifted by `step` NOMINAL grid-steps and re-swung
 * (`shiftedExpectedMs`, same nominal-cell-then-reswing rule `runSlipSteps`
 * uses, see that function's own doc for why the shift must happen in
 * nominal-tick space on a swung score) — find a hit within `windowMs`
 * (`matchCountAt`). Returns the step whose count is a STRICT maximum over
 * every candidate, provided that count is at least
 * `Math.max(2, Math.ceil(expectedNominalTicks.length * SLIP_COVERAGE))`;
 * otherwise `undefined` — a tie, too few matches at every step, or no hits at
 * all are all "no clear grid position", not "displacement zero". See the
 * module doc for why the floor is a scaled `SLIP_COVERAGE`, not half.
 */
export function padDisplacementSteps(
  expectedNominalTicks: readonly number[],
  hits: readonly number[],
  windowMs: number,
  nominalSubdivisionTicks: number,
  swing: SwingContext,
  msPerTick: number,
  maxSteps: number,
): number | undefined {
  const steps = [...Array(maxSteps * 2 + 1).keys()].map((i) => i - maxSteps)
  const counts = steps.map((step) => ({
    step,
    count: matchCountAt(
      shiftedExpectedMs(expectedNominalTicks, step, nominalSubdivisionTicks, swing, msPerTick),
      hits,
      windowMs,
    ),
  }))

  const best = counts.reduce((a, b) => (b.count > a.count ? b : a))
  const tiedForBest = counts.filter((c) => c.count === best.count).length > 1
  if (tiedForBest) return undefined

  // `required` is `Math.max(2, ...)`, so it is always >= 2 — a separate
  // `best.count < 1` check would be dead code (review round 3, item 3).
  const required = Math.max(2, Math.ceil(expectedNominalTicks.length * SLIP_COVERAGE))
  if (best.count < required) return undefined
  return best.step
}
