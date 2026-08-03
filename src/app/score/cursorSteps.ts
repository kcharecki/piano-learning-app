/**
 * Pure decision behind `moveCursor` in `osmdEngraver.ts`: given the ticks of
 * every onset the OSMD cursor will visit (in the order it visits them), how
 * many `cursor.next()` calls from the first onset land on the onset that is
 * currently SOUNDING at `tick` — never the one about to be reached.
 *
 * Extracted so the off-by-one this fixes (see `osmdEngraver.ts`'s `moveCursor`
 * doc comment) can be pinned with a fast unit/property test instead of only
 * living behind a real OSMD instance and a DOM.
 */

/**
 * How many forward steps from the first onset land on the last onset at or
 * before `tick` — i.e. the onset currently SOUNDING, never the one about to
 * be reached. Returns 0 when `tick` precedes every onset.
 *
 * `onsetTicks` must be in ascending (non-strict) order, as the cursor visits
 * them. Behaviour by case:
 * - empty array: 0 (there is nothing to step to).
 * - `tick` before the first onset: 0 (the cursor stays parked on the first
 *   onset; there is no earlier one to fall back to).
 * - `tick` exactly on an onset: that onset's index.
 * - `tick` between two onsets: the earlier onset's index — it is still
 *   sounding, the later one has not started yet.
 * - `tick` past the last onset: the last onset's index.
 * - duplicate adjacent onset ticks (OSMD can report several entries at one
 *   timestamp): the index of the LAST of the run, because they are all
 *   sounding at that tick and stepping to the last one is the furthest
 *   correct position.
 *
 * Implemented as a binary search, not a linear scan: `moveCursorTo` in
 * `osmdEngraver.ts` calls this once per animation frame while the score
 * plays, and a linear scan from index 0 costs O(how far into the piece
 * playback has reached) per frame — on a 102-measure, 1603-note import that
 * grows to thousands of iterations by the end of the piece, on the same main
 * thread that has to schedule audio. Binary search makes it O(log n) per
 * frame regardless of playback position.
 */
export function stepsToOnsetAtOrBefore(onsetTicks: readonly number[], tick: number): number {
  const n = onsetTicks.length
  if (n === 0) return 0

  // Binary search for `upperBound`: the first index whose onset is strictly
  // past `tick` (an "upper bound" search, à la std::upper_bound). That is
  // the exact same `onset > tick` boundary the old linear scan broke on —
  // just located in O(log n) instead of scanned from the start. The answer
  // is one step before that boundary (the last onset at or before `tick`),
  // clamped to 0 when even the first onset is already past `tick`.
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const onset = onsetTicks[mid]
    // `mid` is always within [0, n), so `onset` is defined for any valid
    // ascending `onsetTicks`; this branch only guards the type from
    // `noUncheckedIndexedAccess` and shrinks the search window safely.
    if (onset === undefined || onset > tick) hi = mid
    else lo = mid + 1
  }
  return lo === 0 ? 0 : lo - 1
}
