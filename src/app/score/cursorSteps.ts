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
 */
export function stepsToOnsetAtOrBefore(onsetTicks: readonly number[], tick: number): number {
  let lastIndex = 0
  for (let i = 0; i < onsetTicks.length; i++) {
    const onset = onsetTicks[i]
    // `onset > tick` (not `>=`) is the crux of the fix this function pins:
    // stop only once an onset is strictly past `tick`, never at or on it.
    if (onset === undefined || onset > tick) break
    lastIndex = i
  }
  return lastIndex
}
