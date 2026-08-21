/**
 * The run plan for the groove trainer (roadmap DR-09/T.17): a `GrooveScore`
 * plus a tempo turned into the flat list of instants the grader compares
 * against, one list per pad, in milliseconds relative to the moment the
 * graded window opens.
 *
 * ## The window comes from the SCORE, never from what was played
 *
 * This is the fault that killed the first attempt at this feature twice
 * (T.17.1). Deriving the match window from a pad's own smallest gap gives a
 * sparse limb an enormous window: Ghost Funk's kick sits on "1 a 3 a", whose
 * own smallest gap is a dotted eighth, so its window came out 1.2 sixteenths
 * wide and straight quarters graded 8 of 8 against a syncopated part. The
 * window here is derived from `subdivisionTicks` — the smallest gap between
 * two distinct notated instants **anywhere in the score**, including the wrap
 * from the last instant back into the next loop — so every pad in a groove is
 * judged on the finest grid that groove actually uses, and a sparse limb gets
 * no discount for being sparse.
 *
 * The window is then capped at `toleranceMs`, and never exceeds half a
 * subdivision. Half a subdivision is the hard ceiling: at anything wider, two
 * adjacent notated instants' windows overlap and "which onset did that hit
 * belong to" stops having an answer. That is also what lets `grade.ts` match
 * with a single pass instead of a search — see its own module comment.
 *
 * ## Everything is milliseconds here, on purpose
 *
 * Ticks are the domain's musical time and stay that way in `GrooveScore`.
 * A live run is compared against wall-clock instants, so this module is the
 * one conversion point: `msPerTick` is computed once from the tempo and every
 * instant below is derived from it. Nothing downstream sees a tick.
 */
import { measureDurationTicks } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { invariant } from '@core/shared/invariant.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'

/**
 * The tolerance the trainer advertises, before the half-subdivision cap. A
 * teaching decision, not an implementation detail: it is on screen next to
 * the pads, and the number the learner reads is `GrooveRunPlan.windowMs`,
 * which is this or the cap, whichever is smaller.
 */
export const DEFAULT_TOLERANCE_MS = 100

/** One bar of count-in clicks before anything is graded. */
export const DEFAULT_COUNT_IN_BARS = 1

/**
 * Two bars graded. One bar is not enough to tell a steady pulse from a lucky
 * one, and the drift check in `grade.ts` needs two halves to compare.
 */
export const DEFAULT_GRADED_BARS = 2

/** The slowest and fastest the trainer will run. Beginners live at the bottom of this. */
export const MIN_BPM = 40
export const MAX_BPM = 200

export type GroovePadPlan = {
  readonly pad: MappedDrumPad
  /** Notated instants within ONE loop of the score, in ticks. Sorted, distinct. */
  readonly loopTicks: readonly number[]
  /** Every instant the graded window expects, ms from the window opening. Sorted. */
  readonly expectedMs: readonly number[]
}

/** Two pads the score puts on the same notated instant — the only pairs a flam sentence may name. */
export type UnisonPair = readonly [MappedDrumPad, MappedDrumPad]

export type GrooveRunPlan = {
  readonly grooveId: string
  readonly title: string
  readonly bpm: number
  readonly beatMs: number
  readonly barMs: number
  readonly countInBars: number
  readonly countInBeats: number
  readonly gradedBars: number
  /** How long the graded window stays open. */
  readonly gradedMs: number
  /** The score's own finest grid, in ms. See the module comment. */
  readonly subdivisionMs: number
  /** Half-width of the match window: `min(toleranceMs, subdivisionMs / 2)`. */
  readonly windowMs: number
  readonly toleranceMs: number
  /** Only pads the score actually uses, in the score's own pad order. */
  readonly pads: readonly GroovePadPlan[]
  readonly unisonPairs: readonly UnisonPair[]
}

export type PlanGrooveRunOptions = {
  readonly toleranceMs?: number
  readonly countInBars?: number
  readonly gradedBars?: number
}

/**
 * The smallest gap between two distinct notated instants in one loop of
 * `score`, in ticks — including the wrap from the last instant back to the
 * first instant of the next loop, because a groove is a loop and the learner
 * plays straight through the bar line.
 *
 * A score with a single distinct instant has no gap to measure; its whole
 * loop is the grid.
 */
export function subdivisionTicks(score: GrooveScore): number {
  const loopTicks = measureDurationTicks(score.timeSignature) * score.measures.length
  const distinct = [...new Set(score.notes.map((note) => note.tick as number))].sort((a, b) => a - b)
  const first = distinct[0]
  if (first === undefined) return loopTicks
  if (distinct.length === 1) return loopTicks
  let smallest = loopTicks
  for (let i = 1; i < distinct.length; i++) {
    const prev = distinct[i - 1]
    const curr = distinct[i]
    if (prev === undefined || curr === undefined) continue
    smallest = Math.min(smallest, curr - prev)
  }
  // The wrap: the last instant of this loop to the first of the next.
  smallest = Math.min(smallest, loopTicks - (distinct[distinct.length - 1] ?? 0) + first)
  return smallest
}

/** Pairs of distinct pads the score puts on a shared instant, deduplicated and ordered. */
function unisonPairsOf(score: GrooveScore): readonly UnisonPair[] {
  const padsByTick = new Map<number, Set<MappedDrumPad>>()
  for (const note of score.notes) {
    const tick = note.tick as number
    const set = padsByTick.get(tick) ?? new Set<MappedDrumPad>()
    set.add(note.pad)
    padsByTick.set(tick, set)
  }
  const seen = new Set<string>()
  const pairs: UnisonPair[] = []
  for (const pads of padsByTick.values()) {
    const list = [...pads].sort()
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (a === undefined || b === undefined) continue
        const key = `${a}|${b}`
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push([a, b])
      }
    }
  }
  return pairs
}

/**
 * Turn a groove and a tempo into everything the run needs. `bpm` is quarter
 * notes per minute, the only reading the tempo control offers.
 *
 * The score loops to fill `gradedBars`: a one-bar groove graded over two bars
 * is played twice, and an instant is kept only while it still falls inside
 * the graded window, so an odd bar count never invents half a loop.
 */
export function planGrooveRun(
  score: GrooveScore,
  bpm: number,
  options: PlanGrooveRunOptions = {},
): GrooveRunPlan {
  invariant(
    Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM,
    `groove run tempo out of range: ${bpm}`,
  )
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS
  const countInBars = options.countInBars ?? DEFAULT_COUNT_IN_BARS
  const gradedBars = options.gradedBars ?? DEFAULT_GRADED_BARS
  invariant(gradedBars >= 1, `graded bars must be at least 1: ${gradedBars}`)

  const msPerTick = 60_000 / bpm / TICKS_PER_QUARTER
  const barTicks = measureDurationTicks(score.timeSignature)
  const loopTicks = barTicks * score.measures.length
  const gradedTicks = barTicks * gradedBars
  const barMs = barTicks * msPerTick
  const beatMs = (60_000 / bpm) * (4 / score.timeSignature.beatType)

  const byPad = new Map<MappedDrumPad, number[]>()
  for (const note of score.notes) {
    const list = byPad.get(note.pad) ?? []
    list.push(note.tick as number)
    byPad.set(note.pad, list)
  }

  const loops = Math.ceil(gradedTicks / loopTicks)
  const pads: GroovePadPlan[] = []
  for (const [pad, rawTicks] of byPad) {
    const loopTicksSorted = [...new Set(rawTicks)].sort((a, b) => a - b)
    const expectedMs: number[] = []
    for (let loop = 0; loop < loops; loop++) {
      for (const tick of loopTicksSorted) {
        const absolute = tick + loop * loopTicks
        if (absolute >= gradedTicks) continue
        expectedMs.push(absolute * msPerTick)
      }
    }
    pads.push({ pad, loopTicks: loopTicksSorted, expectedMs })
  }

  const subdivisionMs = subdivisionTicks(score) * msPerTick
  return {
    grooveId: score.id,
    title: score.title,
    bpm,
    beatMs,
    barMs,
    countInBars,
    countInBeats: countInBars * score.timeSignature.beats,
    gradedBars,
    gradedMs: gradedTicks * msPerTick,
    subdivisionMs,
    // Never wider than half a subdivision — see the module comment.
    windowMs: Math.min(toleranceMs, subdivisionMs / 2),
    toleranceMs,
    pads,
    unisonPairs: unisonPairsOf(score),
  }
}
