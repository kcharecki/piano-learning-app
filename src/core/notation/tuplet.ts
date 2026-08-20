/**
 * Tuplets — groups whose sounding duration and written duration disagree.
 *
 * This is its own module because a note's tick duration alone cannot say what
 * it is. A triplet eighth is 160 ticks, and 160 ticks by raw duration engraves
 * as a 16th; only the ratio recovers the written value. Engravers therefore
 * need a second number alongside the duration, and the arithmetic that turns
 * one into the other is domain logic, not formatting.
 */

/**
 * Tuplet membership: `actual` notes sounding in the written time of `normal`.
 * An eighth-note triplet is 3:2 — three notes in the time of two eighths.
 *
 * `position` marks the bracket edges — MusicXML puts `<tuplet type="start">`
 * on the first note of a group and `"stop"` on the last, and needs the inner
 * notes to carry the `<time-modification>` without a bracket of their own.
 */
export type Tuplet = {
  /** Notes actually sounded in the group — 3 for an eighth-note triplet. */
  readonly actual: number
  /** Written notes their total time is worth — 2 for an eighth-note triplet. */
  readonly normal: number
  readonly position: 'start' | 'inner' | 'stop'
}

/**
 * The duration a note is *written* as, given what it actually sounds for.
 * A 160-tick note in a 3:2 triplet is written as `160 * 3 / 2 = 240` — an
 * eighth. Notes outside a tuplet are written as they sound.
 */
export function writtenTicks(durationTicks: number, tuplet?: Tuplet): number {
  if (tuplet === undefined) return durationTicks
  return (durationTicks * tuplet.actual) / tuplet.normal
}
