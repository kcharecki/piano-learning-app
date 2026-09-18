/**
 * Pure pass arithmetic for the groove trainer's loop mode (roadmap DR-09
 * "loop"). Loop mode drops the count-in after the first pass and repeats the
 * graded window back-to-back, so this module answers three questions with no
 * clock, no React and no grading logic of its own:
 *
 *  - `passOrigin`: when (relative to the FIRST graded origin) does pass `k` open.
 *  - `passOfHit`: which pass does a hit at a given offset belong to.
 *  - `passGradeableAt`: when has pass `k` collected everything it is going to.
 *
 * ## Why a hit near a boundary needs its own rule
 *
 * Passes abut with no gap: pass `k` ends exactly where pass `k+1` begins, at
 * `(k+1) * plan.gradedMs`. A hit within `windowMs` of that instant could be
 * answering the last notated instant of pass `k` (a late final stroke) or the
 * first notated instant of pass `k+1` (an early first stroke) — the two are
 * indistinguishable by offset alone. The rule here is the same nearest-instant
 * logic `grade.ts`'s `pair` already uses to assign a hit within one pass, just
 * run across the boundary: whichever of the two candidate passes has a
 * notated instant nearer the hit wins the hit, ties going to the later
 * pass (below).
 *
 * Away from every boundary — further than `windowMs` from any multiple of
 * `gradedMs` — there is no ambiguity and the answer is the plain
 * `floor(ms / gradedMs)`.
 *
 * On a genuine tie — the hit is exactly as close to a notated instant of the
 * earlier pass as to one of the later pass — the LATER pass wins. It is the
 * only one of the two still ungraded by the time a boundary hit like this
 * arrives (the earlier pass's own gradeable instant is already behind it),
 * so awarding the tie to the earlier pass would score its neighbour's
 * instant as an `extra` on the pass that already closed and a `missed` on
 * the pass that actually owns it — reachable for real: Ghost Funk at 80 bpm
 * has `windowMs` exactly `subdivisionMs / 2`, and a kick at
 * `k * gradedMs - 93.75` sits exactly that far from both neighbours.
 *
 * This assumes what every real `GrooveRunPlan` already guarantees:
 * `windowMs` is at most half of `subdivisionMs` (`plan.ts`'s own invariant),
 * and `gradedMs` — a whole graded window of one or more bars — is far larger
 * than that, so at most one boundary can ever be within `windowMs` of a
 * given hit.
 */
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'

/** Wall-ms offset from the FIRST graded origin at which pass `pass` (0-based) opens. */
export function passOrigin(plan: GrooveRunPlan, pass: number): number {
  return pass * plan.gradedMs
}

/** The instant after which pass `pass` can be graded: its end plus the window. */
export function passGradeableAt(plan: GrooveRunPlan, pass: number): number {
  return passOrigin(plan, pass + 1) + plan.windowMs
}

/** Every notated instant of the graded window, flattened across pads — only offsets matter here. */
function allExpectedMs(plan: GrooveRunPlan): readonly number[] {
  return plan.pads.flatMap((pad) => pad.expectedMs)
}

/** The smallest `|ms - (passOffset + e)|` over every notated instant `e`. `Infinity` if there are none. */
function nearestInstantDistance(
  ms: number,
  passOffset: number,
  expected: readonly number[],
): number {
  let best = Number.POSITIVE_INFINITY
  for (const e of expected) {
    const distance = Math.abs(ms - (passOffset + e))
    if (distance < best) best = distance
  }
  return best
}

/**
 * Which 0-based pass a hit belongs to, given its ms offset from the FIRST
 * graded origin. See the module comment for the boundary rule.
 */
export function passOfHit(plan: GrooveRunPlan, ms: number): number {
  if (ms < 0) return 0
  const gradedMs = plan.gradedMs
  const naive = Math.floor(ms / gradedMs)

  // The nearest boundary (a multiple of gradedMs) to this hit, and how far
  // away it is. Only a boundary within windowMs makes the pass ambiguous.
  const boundaryIndex = Math.round(ms / gradedMs)
  const boundaryDistance = Math.abs(ms - boundaryIndex * gradedMs)
  if (boundaryDistance > plan.windowMs) return Math.max(0, naive)

  // Boundary 0 is the run's own start, not a pass/pass transition — there is
  // no pass -1 to contest it, so pass 0 owns everything near it.
  if (boundaryIndex <= 0) return 0

  const expected = allExpectedMs(plan)
  const before = boundaryIndex - 1
  const beforeDistance = nearestInstantDistance(ms, passOrigin(plan, before), expected)
  const afterDistance = nearestInstantDistance(ms, passOrigin(plan, boundaryIndex), expected)
  // Ties go to the LATER pass (see the module comment), so `beforeDistance`
  // must be STRICTLY nearer to keep the hit with the earlier one.
  return beforeDistance < afterDistance ? before : boundaryIndex
}
