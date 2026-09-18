/**
 * Per-hit live feedback for the groove trainer (roadmap DR-09 "per-hit live
 * feedback"). `grade.ts` grades a whole run at once, after every hit has
 * already happened; this module answers the question the learner needs
 * answered the instant a stick lands: was that stroke on time, early, late,
 * or did it not answer anything the score asked for.
 *
 * ## Provisional, and arrival-order, on purpose
 *
 * `grade.ts`'s `pair` sees the WHOLE run at once and assigns nearest-first
 * over every notated instant in time order, so a hit can, in principle, be
 * reassigned relative to a hit that hasn't happened yet (from the live
 * judge's point of view). This module has no such luxury: a verdict has to
 * be handed back the instant the hit lands, before later hits exist to
 * negotiate with. So it judges each hit against whichever of THIS PAD's
 * instants are still unclaimed at that moment, nearest-first, and the
 * caller commits the claim (`claimKey`) immediately after. That is enough to
 * agree with `grade.ts` in the common case — a clean run's hits arrive in
 * the same order its instants are notated — but a hit that arrives out of
 * order (e.g. a very early stroke that "belongs", in `grade.ts`'s
 * whole-run view, to a later instant than the one still open here) can read
 * a different verdict live than the final pairing gives it. The live line is
 * a coach, not the marking: `grade.ts`'s result panel is still the one
 * source of truth once the run ends.
 *
 * ## Pure, and never mutates `claimed`
 *
 * `judgeLiveHit` takes the claimed set as it stands and returns a verdict;
 * it is the CALLER's job (`useGrooveRun.ts`) to add `claimKey(pad,
 * instantIndex)` to its own claimed set once a verdict is accepted. Keeping
 * the claim commit outside this function is what keeps it a pure query the
 * property tests can call any number of times against the same inputs.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'

export type LiveHitKind = 'on-time' | 'early' | 'late' | 'extra'

export type LiveHitVerdict = {
  readonly pad: MappedDrumPad
  readonly kind: LiveHitKind
  /** Signed ms from the claimed instant, positive is late. `undefined` for 'extra'. */
  readonly offsetMs: number | undefined
  /** Index into the matching plan.pads[].expectedMs. `undefined` for 'extra'. */
  readonly instantIndex: number | undefined
}

/** `|offset| <= ON_TIME_FRACTION * plan.windowMs` reads as on time. */
export const ON_TIME_FRACTION = 0.25

/** Key for the claimed-instant set: one expected instant of one pad. */
export function claimKey(pad: MappedDrumPad, instantIndex: number): string {
  return `${pad}:${instantIndex}`
}

/**
 * Provisional, arrival-order verdict for one hit at `ms` (ms from the graded
 * origin of the pass, same frame as `plan.pads[].expectedMs`). The nearest
 * expected instant ON THAT PAD within `±plan.windowMs` (inclusive, matching
 * `grade.ts`'s inclusive window) that is not in `claimed` wins; ties go to
 * the earlier instant. No candidate — including a pad the plan does not use
 * at all — reads as `'extra'`. Pure: never mutates `claimed`; the caller adds
 * `claimKey(pad, instantIndex)` after an accepted verdict.
 */
export function judgeLiveHit(
  plan: GrooveRunPlan,
  pad: MappedDrumPad,
  ms: number,
  claimed: ReadonlySet<string>,
): LiveHitVerdict {
  const extra: LiveHitVerdict = { pad, kind: 'extra', offsetMs: undefined, instantIndex: undefined }

  const padPlan = plan.pads.find((candidate) => candidate.pad === pad)
  if (padPlan === undefined) return extra

  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < padPlan.expectedMs.length; i++) {
    if (claimed.has(claimKey(pad, i))) continue
    const expected = padPlan.expectedMs[i]
    if (expected === undefined) continue
    const distance = Math.abs(ms - expected)
    if (distance > plan.windowMs) continue
    // Strict `<` keeps the FIRST instant seen on a tie — `expectedMs` is
    // sorted ascending, so that is the earlier instant, exactly the
    // tie-break the module comment promises.
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }
  if (bestIndex < 0) return extra

  const expected = padPlan.expectedMs[bestIndex]
  if (expected === undefined) return extra // unreachable: bestIndex only ever points at a real element

  const offsetMs = ms - expected
  const threshold = ON_TIME_FRACTION * plan.windowMs
  const kind: LiveHitKind =
    Math.abs(offsetMs) <= threshold ? 'on-time' : offsetMs < 0 ? 'early' : 'late'
  return { pad, kind, offsetMs, instantIndex: bestIndex }
}
