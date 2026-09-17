/**
 * Click-list shaping for the metronome suite (roadmap DR-12).
 *
 * `metronome.ts` computes the full, honest grid: every click the time
 * signature and subdivision imply. Almost no drill wants to *hear* every one
 * of those clicks. "2 and 4 only", "click every fourth bar", "downbeat only,
 * randomly dropped so you learn to hold the pulse yourself" are all the same
 * underlying grid with some clicks thinned out or re-weighted afterwards.
 * Rather than teach the grid builder every one of those modes (and multiply
 * them together — subdivision x placement x gaps x random mute is a
 * combinatorial mess inside one function), each mode is a small pure
 * function here that takes the grid's `Click[]` and returns a smaller or
 * annotated one. They compose by ordinary function composition.
 *
 * Two invariants every function here upholds, because the caller schedules
 * audio from the result and a bug here is a bug the learner *hears*:
 *  - the output is always a subsequence of the input — same click objects
 *    (or, for `voiceClicks`, the same click fields plus one) in the same
 *    order, never invented, never reordered;
 *  - the count-in (`bar < 0`) is never touched by a gap or mute mode. The
 *    count-in's whole job is to give a reliable pulse before the graded
 *    bars start; a metronome that silences part of *that* is just confusing,
 *    not a drill.
 *
 * `randomMuteClicks` draws its randomness from the injected `Rng`
 * (`@core/ports/rng.ts`), never `Math.random()`, so a scripted or seeded rng
 * makes which bars go silent exactly reproducible — the same reason the
 * sight-reading generator takes one.
 */
import type { Rng } from '@core/ports/rng.ts'
import { assertNever, invariant } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import type { Click } from './metronome.ts'

// ------------------------------------------------------------------- placement

/**
 * Which clicks of the grid actually sound.
 *  - `all`: the whole grid, unchanged (still returns a fresh array).
 *  - `beats`: only the on-beat click (`subdivisionIndex === 0`) of the given
 *    0-based beat indices — e.g. `[1, 3]` is "the 2 and the 4" in 4/4.
 *  - `downbeat`: beat 0, on the beat, only — bar 1 of every bar.
 *  - `every-n-bars`: the downbeat of every n-th bar (`bar % n === 0`) — a
 *    once-a-phrase check-in rather than a click on every bar.
 */
export type ClickPlacement =
  | { readonly kind: 'all' }
  | { readonly kind: 'beats'; readonly beats: readonly number[] }
  | { readonly kind: 'downbeat' }
  | { readonly kind: 'every-n-bars'; readonly n: number }

/** Thin the grid down to the clicks a given placement mode actually sounds. */
export function placeClicks(clicks: readonly Click[], placement: ClickPlacement): readonly Click[] {
  switch (placement.kind) {
    case 'all':
      return [...clicks]
    case 'downbeat':
      return clicks.filter((c) => c.beat === 0 && c.subdivisionIndex === 0)
    case 'beats': {
      for (const beat of placement.beats) {
        invariant(
          Number.isInteger(beat) && beat >= 0,
          `beat index must be a non-negative integer, got ${beat}`,
        )
      }
      const wanted = new Set(placement.beats)
      return clicks.filter((c) => c.subdivisionIndex === 0 && wanted.has(c.beat))
    }
    case 'every-n-bars': {
      invariant(
        Number.isInteger(placement.n) && placement.n >= 1,
        `every-n-bars n must be an integer >= 1, got ${placement.n}`,
      )
      return clicks.filter(
        (c) => c.beat === 0 && c.subdivisionIndex === 0 && c.bar % placement.n === 0,
      )
    }
    default:
      return assertNever(placement)
  }
}

// ------------------------------------------------------------------------ gap

/**
 * A fixed on/off cycle over graded bars, counted from bar 0: bars
 * `[0, onBars)` sound, `[onBars, onBars + offBars)` are silent, then it
 * repeats. `offBars: 0` is "no gap" (every bar sounds). The count-in
 * (`bar < 0`) is outside this cycle entirely and always sounds — see the
 * module note.
 */
export type GapClickSchedule = { readonly onBars: number; readonly offBars: number }

/** Programmer-error guard shared by every gap function — see `validateGapClickSchedule`. */
function checkSchedule(s: GapClickSchedule): void {
  invariant(
    Number.isInteger(s.onBars) && s.onBars >= 1,
    `onBars must be an integer >= 1, got ${s.onBars}`,
  )
  invariant(
    Number.isInteger(s.offBars) && s.offBars >= 0,
    `offBars must be an integer >= 0, got ${s.offBars}`,
  )
}

/**
 * Whether `bar` falls in the silent part of the schedule's cycle. Count-in
 * bars (`bar < 0`) are never silent — they are not part of the graded cycle.
 */
export function isSilentBar(bar: number, schedule: GapClickSchedule): boolean {
  checkSchedule(schedule)
  if (bar < 0 || schedule.offBars === 0) return false
  const cycle = schedule.onBars + schedule.offBars
  return (bar % cycle) >= schedule.onBars
}

/** Drop the clicks of every silent bar under `schedule`; count-in is untouched. */
export function gapClicks(clicks: readonly Click[], schedule: GapClickSchedule): readonly Click[] {
  checkSchedule(schedule)
  return clicks.filter((c) => c.bar < 0 || !isSilentBar(c.bar, schedule))
}

/**
 * The first sounding bar after each silent stretch, among bars
 * `[0, totalBars)` — where the learner's return to the pulse is graded for
 * drift. Bar 0 is never a return bar: there is no silent stretch before it.
 */
export function returnBars(totalBars: number, schedule: GapClickSchedule): readonly number[] {
  invariant(
    Number.isInteger(totalBars) && totalBars >= 0,
    `totalBars must be a whole number >= 0, got ${totalBars}`,
  )
  checkSchedule(schedule)
  const out: number[] = []
  for (let bar = 1; bar < totalBars; bar++) {
    if (isSilentBar(bar - 1, schedule) && !isSilentBar(bar, schedule)) out.push(bar)
  }
  return out
}

/** The non-throwing check for a schedule that came from the UI. */
export function validateGapClickSchedule(s: GapClickSchedule): Result<GapClickSchedule, string> {
  if (!Number.isInteger(s.onBars) || s.onBars < 1) {
    return err(`onBars must be an integer >= 1, got ${s.onBars}`)
  }
  if (!Number.isInteger(s.offBars) || s.offBars < 0) {
    return err(`offBars must be an integer >= 0, got ${s.offBars}`)
  }
  return ok(s)
}

// --------------------------------------------------------------- random mute

/**
 * Silence each graded bar (`bar >= 0`) independently with probability `p`,
 * one `rng.next()` draw per distinct bar, spent in ascending bar order —
 * never per click — so a `scriptedRng` script maps predictably onto bars
 * regardless of subdivision. The count-in always sounds and spends no draws.
 */
export function randomMuteClicks(
  clicks: readonly Click[],
  probability: number,
  rng: Rng,
): readonly Click[] {
  invariant(
    Number.isFinite(probability) && probability >= 0 && probability <= 1,
    `probability must be in [0, 1], got ${probability}`,
  )
  const bars = [...new Set(clicks.filter((c) => c.bar >= 0).map((c) => c.bar))].sort(
    (a, b) => a - b,
  )
  const muted = new Set<number>()
  for (const bar of bars) {
    if (rng.next() < probability) muted.add(bar)
  }
  return clicks.filter((c) => !(c.bar >= 0 && muted.has(c.bar)))
}

// --------------------------------------------------------------------- gains

/** Relative loudness, 0..1, for the two kinds of un-accented click. */
export type SubdivisionVolumes = { readonly beat: number; readonly subdivision: number }

export type VoicedClick = Click & { readonly gain: number }

/**
 * Attach the gain each click should play at: an accented downbeat is always
 * full volume (that is the pulse the learner locks onto), any other on-beat
 * click plays at `volumes.beat`, and an off-beat subdivision click plays at
 * `volumes.subdivision` — normally quieter, so the beat still reads through
 * a busy subdivision.
 */
export function voiceClicks(
  clicks: readonly Click[],
  volumes: SubdivisionVolumes,
): readonly VoicedClick[] {
  invariant(
    Number.isFinite(volumes.beat) && volumes.beat >= 0 && volumes.beat <= 1,
    `beat volume must be in [0, 1], got ${volumes.beat}`,
  )
  invariant(
    Number.isFinite(volumes.subdivision) && volumes.subdivision >= 0 && volumes.subdivision <= 1,
    `subdivision volume must be in [0, 1], got ${volumes.subdivision}`,
  )
  return clicks.map((c) => ({
    ...c,
    gain: c.subdivisionIndex !== 0 ? volumes.subdivision : c.accented ? 1 : volumes.beat,
  }))
}

// --------------------------------------------------------------------- drift

/**
 * Signed drift, in ms, of the learner's first hit on a return bar relative
 * to that bar's downbeat click: positive is late, negative is early. Only a
 * hit within `windowMs` of the downbeat counts as "the" hit — anything
 * farther is a different beat, not a measurement of this one — and among
 * candidates the nearest one wins. `undefined` when nothing landed in the
 * window at all (the learner missed the return entirely).
 */
export function returnDriftMs(
  downbeatMs: number,
  hitTimesMs: readonly number[],
  windowMs: number,
): number | undefined {
  invariant(
    Number.isFinite(windowMs) && windowMs >= 0,
    `windowMs must be a non-negative number, got ${windowMs}`,
  )
  let best: number | undefined
  let bestAbs = Infinity
  for (const hit of hitTimesMs) {
    const diff = hit - downbeatMs
    const abs = Math.abs(diff)
    if (abs <= windowMs && abs < bestAbs) {
      bestAbs = abs
      best = diff
    }
  }
  return best
}
