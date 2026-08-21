/**
 * The inclusive bound of a timing MATCHING WINDOW, made robust to floating
 * point (roadmap T.15).
 *
 * Every timing grader in this app decides "did this tap claim that onset?"
 * with `|tap - onset| <= tolerance`, and the boundary is deliberately
 * INCLUSIVE — a tap landing exactly on it is claimed, not rejected. See
 * `core/rhythm/tapClassifier.ts`'s module doc, which makes the same promise
 * about expiry ("a tap arriving exactly on that boundary tick is still
 * claimable, not already expired").
 *
 * That promise is easy to keep in ticks, which are integers. It is not
 * keepable in milliseconds, because the milliseconds are not measured — they
 * are DERIVED from those same integer ticks by `tickToMs`, and the same exact
 * rational reached by two different routes lands on two different doubles:
 *
 *     tickToMs(14) - tickToMs(13)  ===  1.0416666666666679
 *     tickToMs(1)                  ===  1.0416666666666667
 *
 * so a tap exactly one tick of tolerance away from its onset compares as
 * 1.2e-15 ms OUTSIDE a window it is exactly on the edge of. That is enough to
 * flip a verdict. It is the whole of roadmap T.15: `tapClassifier`'s live FIFO
 * classifier works in integer ticks and claimed the tap, `gradeTapping` worked
 * in milliseconds and called it an extra, and the property test asserting the
 * two "always agree exactly" failed on the seeds that happened to generate a
 * boundary tap — onsets `[0, 9, 13]`, tap `[14]`, tolerance `1`.
 *
 * The fix is not to widen the window. It is to stop asking a float comparison
 * a question it cannot answer: allow a few ULPs of slack, scaled to the
 * magnitudes actually being compared, so "exactly on the boundary" reliably
 * reads as inside. The slack is proportional to the numbers in play (~1e-11 ms
 * over a 25-second run, ~1e-14 ms over a bar), which is many orders of
 * magnitude below the finest timing any of this code claims to resolve, and
 * below the resolution of the clocks that produce real taps.
 */
import { invariant } from '@core/shared/invariant.ts'

/**
 * How many units-in-the-last-place of slack to allow at the boundary.
 *
 * The error to absorb comes from subtracting two nearby `tickToMs` results,
 * which costs a small number of ULPs of the larger operand; 16 covers that
 * with room to spare and is still ~1e-11 ms at the far end of a 25-second run.
 * Raising it further would start trading a real (if tiny) widening of the
 * window for slack nothing needs.
 */
export const WINDOW_EPSILON_ULPS = 16

/** Largest absolute value in an ascending array — its first or its last. */
function magnitudeOf(ascending: readonly number[]): number {
  const first = ascending[0]
  const last = ascending[ascending.length - 1]
  if (first === undefined || last === undefined) return 0
  return Math.max(Math.abs(first), Math.abs(last))
}

/**
 * `toleranceMs` plus enough slack that a tap derived from the same tick grid
 * as the onsets still reads as inside the window when it sits exactly on the
 * boundary. Both arrays must already be sorted ascending — the callers sort
 * before matching anyway, and it is what lets the magnitude be read off the
 * ends instead of scanned for.
 *
 * Use the result in place of `toleranceMs` in the window test itself; do not
 * report it as the tolerance, which is still `toleranceMs`.
 */
export function windowLimitMs(
  toleranceMs: number,
  onsetMsAscending: readonly number[],
  tapMsAscending: readonly number[],
): number {
  invariant(
    Number.isFinite(toleranceMs) && toleranceMs >= 0,
    `windowLimitMs: toleranceMs must be a finite number >= 0, got ${toleranceMs}`,
  )
  const magnitude = Math.max(
    toleranceMs,
    magnitudeOf(onsetMsAscending),
    magnitudeOf(tapMsAscending),
  )
  return toleranceMs + WINDOW_EPSILON_ULPS * Number.EPSILON * magnitude
}
