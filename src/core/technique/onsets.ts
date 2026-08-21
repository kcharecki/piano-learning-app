/**
 * Turning a stream of key presses into the onsets `evennessOf` scores, and
 * saying out loud what got collapsed on the way (roadmap T.11).
 *
 * ## The cliff this replaces
 *
 * A written chord arrives as two or three separate presses, so something has
 * to decide which presses are "one onset" before evenness sees them —
 * otherwise a hands-together drill's near-zero inter-hand gaps drag the median
 * gap toward zero and a flawless run scores 0.
 *
 * That decision used to be `MATCHER_DEFAULTS.chordWindowMs`, a flat 80ms, and
 * a flat number is wrong at both ends of the tempo range:
 *
 *  - **Too narrow when slow.** Measured on the solid triad drill: a chord
 *    rolled 30ms per note gave 8 onsets, evenness 100%, clean; the same run
 *    rolled 45ms per note gave 16 onsets and 0%. The 15ms between those two
 *    runs is not the difference between mastery and failure. The learner this
 *    was found on had no MIDI keyboard and was striking three notes with one
 *    mouse pointer, at roughly 100ms of spread — permanently on the wrong side
 *    of the cliff, and told they were playing unevenly when what they were
 *    doing was using a mouse.
 *  - **Too wide when fast.** At ♩=300 a triplet gap is 66.7ms, so an 80ms
 *    window swallows notes the score wrote as SEPARATE: all three onsets of a
 *    broken triad collapsed into one, and a visibly jittery run reported
 *    "Evenness 100% — Clean at 300bpm".
 *
 * ## The window
 *
 * The window is a fraction of the shortest gap the score actually writes, so
 * it tracks the tempo and the note value together, capped by the matcher's own
 * attribution tolerance.
 *
 * The fraction being at most a half is the load-bearing part: it makes it
 * arithmetically impossible for the window to reach the next written onset, so
 * no amount of tempo change can make this collapse two notes the score wrote
 * apart. That is the property the fast end broke, and it is pinned as a
 * property test rather than as a comment.
 *
 * The cap is `toleranceMs` because a press further than that from an onset is
 * not attributed to that note by the matcher at all; grouping beyond it would
 * mean evenness and accuracy disagreeing about what was played.
 *
 * ## And then say what was collapsed
 *
 * Widening a window hides things, so nothing may be hidden silently. Every
 * group's spread is measured and the widest is reported in words next to the
 * verdict. A rolled chord is now a sentence a learner can act on ("Chords
 * rolled up to 104ms") instead of a score they cannot explain.
 */
import { invariant } from '@core/shared/invariant.ts'

/**
 * The window is this fraction of the shortest written gap.
 *
 * At most a half, so `window < gap` always: two notes the score wrote as
 * separate onsets can never be collapsed into one, at any tempo. Exactly a
 * half rather than something smaller because the whole point is to be generous
 * to a rolled chord — there is no reason to leave the other half unused.
 */
export const CHORD_WINDOW_GAP_FRACTION = 0.5

/**
 * A roll narrower than this is not worth saying out loud: two keys struck by
 * one hand land tens of milliseconds apart even when a player is trying their
 * hardest, and reporting that as a fault would be reporting human hands.
 */
export const ROLL_REPORT_MS = 30

export type OnsetGrouping = {
  /** One time per group — the FIRST press in it, which is when the chord began. */
  readonly onsets: readonly number[]
  /** The widest group's spread, in ms; 0 when nothing was collapsed. */
  readonly maxSpreadMs: number
  /** How many groups were rolled by at least `ROLL_REPORT_MS`. */
  readonly rolledGroups: number
}

/**
 * The shortest positive distance between two of these times, or 0 when there
 * is no pair (a single onset, or none).
 *
 * The SHORTEST rather than the median or the first: the window has to be safe
 * against the fastest thing the score writes, and a drill whose note values
 * change part-way through would otherwise get a window that is correct for its
 * slow half and swallows its fast half.
 *
 * Equal times contribute nothing — they are one written chord, which is the
 * case this whole module exists to group, not a gap of zero.
 */
export function shortestGapMs(ascendingMs: readonly number[]): number {
  let shortest = Number.POSITIVE_INFINITY
  for (let i = 1; i < ascendingMs.length; i += 1) {
    const previous = ascendingMs[i - 1]
    const current = ascendingMs[i]
    if (previous === undefined || current === undefined) continue
    const gap = current - previous
    if (gap > 0 && gap < shortest) shortest = gap
  }
  return Number.isFinite(shortest) ? shortest : 0
}

/**
 * How far apart two presses may be and still count as one chord, given the
 * shortest gap the score writes between successive onsets.
 *
 * @param shortestWrittenGapMs the smallest positive distance between two
 *   distinct written onsets, in ms at the run's tempo. Pass 0 for a score with
 *   only one onset — there is no next note to run into, so the cap applies.
 * @param toleranceMs the matcher's attribution tolerance, the hard ceiling.
 */
export function chordWindowMs(shortestWrittenGapMs: number, toleranceMs: number): number {
  invariant(
    Number.isFinite(shortestWrittenGapMs) && shortestWrittenGapMs >= 0,
    `chordWindowMs: shortestWrittenGapMs must be a finite number >= 0, got ${shortestWrittenGapMs}`,
  )
  invariant(
    Number.isFinite(toleranceMs) && toleranceMs >= 0,
    `chordWindowMs: toleranceMs must be a finite number >= 0, got ${toleranceMs}`,
  )
  if (shortestWrittenGapMs === 0) return toleranceMs
  return Math.min(toleranceMs, CHORD_WINDOW_GAP_FRACTION * shortestWrittenGapMs)
}

/**
 * Group presses into onsets, and measure what each group swallowed.
 *
 * A press joins the open group while it is within `windowMs` of that group's
 * FIRST press, not of its previous one — chaining off the previous press would
 * let a slow arpeggio walk a group open indefinitely, one hop at a time, which
 * is exactly the failure a fixed window has in the other direction.
 *
 * Presses are sorted first: MIDI events can arrive a millisecond out of order
 * (the matcher clamps its own clock for the same reason), and an unsorted
 * input would otherwise start a spurious new group.
 */
export function groupOnsets(pressMs: readonly number[], windowMs: number): OnsetGrouping {
  invariant(
    Number.isFinite(windowMs) && windowMs >= 0,
    `groupOnsets: windowMs must be a finite number >= 0, got ${windowMs}`,
  )
  const sorted = [...pressMs].sort((a, b) => a - b)
  const onsets: number[] = []
  let maxSpreadMs = 0
  let rolledGroups = 0
  let groupStart: number | undefined
  let groupEnd = 0

  const closeGroup = (): void => {
    if (groupStart === undefined) return
    const spread = groupEnd - groupStart
    maxSpreadMs = Math.max(maxSpreadMs, spread)
    if (spread >= ROLL_REPORT_MS) rolledGroups += 1
  }

  for (const t of sorted) {
    if (groupStart === undefined || t - groupStart > windowMs) {
      closeGroup()
      groupStart = t
      groupEnd = t
      onsets.push(t)
      continue
    }
    groupEnd = t
  }
  closeGroup()

  return { onsets, maxSpreadMs, rolledGroups }
}

/**
 * The roll, in words — or nothing at all when there is nothing to say.
 *
 * Returning null rather than "Chords rolled 0ms" matters: a line that appears
 * after every run is a line nobody reads, and the point of measuring the
 * spread was to make the runs where it IS the problem stand out.
 */
export function describeRoll(grouping: OnsetGrouping): string | null {
  if (grouping.rolledGroups === 0) return null
  const spread = Math.round(grouping.maxSpreadMs)
  const chords =
    grouping.rolledGroups === 1 ? 'One chord was' : `${String(grouping.rolledGroups)} chords were`
  return `${chords} rolled — up to ${String(spread)}ms between the notes.`
}
