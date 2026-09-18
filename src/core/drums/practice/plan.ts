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
import type { GrooveScore, SwingUnit } from '@core/drums/model/groove.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { swungTick } from '@core/drums/model/swing.ts'

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
  /**
   * `expectedMs`'s own NOMINAL (straight, unswung) instant, ms from the
   * window opening — same length, same order, index-for-index with
   * `expectedMs`. A swung "&" still needs its straight-grid position for
   * display (`wait.ts`'s `stepPosition` names the beat/subdivision off this,
   * never off the swung `atMs`, which does not sit on the nominal grid).
   */
  readonly expectedNominalMs: readonly number[]
  /**
   * `expectedMs`/`expectedNominalMs`'s own instant, in absolute NOMINAL
   * ticks from the window opening — same length, same order, index-for-index
   * with both. This is what `grade.ts`'s swung slip pass shifts (in tick
   * space, before re-swinging) rather than shifting `expectedMs` by a
   * constant millisecond amount, which is only valid on a straight grid.
   */
  readonly expectedNominalTicks: readonly number[]
}

/** Two pads the score puts on the same notated instant — the only pairs a flam sentence may name. */
export type UnisonPair = readonly [MappedDrumPad, MappedDrumPad]

/**
 * Everything `swungTick` needs besides the tick itself, carried on the plan
 * so `grade.ts`'s slip pass can re-swing a shifted nominal tick without
 * reaching back into `GrooveScore`. `percent: 50` (straight) makes
 * `swungTick` an identity — see that function's own doc — so this is always
 * present, never optional on a straight plan.
 */
export type SwingContext = {
  readonly percent: number
  readonly unit: SwingUnit
  readonly measureTicks: number
  readonly beats: number
  readonly beatType: number
}

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
  /** `subdivisionMs`'s own tick value: `subdivisionMs === subdivisionTicks * msPerTick`. */
  readonly subdivisionTicks: number
  /**
   * The smallest gap between two distinct notated instants on the NOMINAL
   * (straight, unswung) grid — `note.tick` itself, never `swungTick`'d. This,
   * not `subdivisionTicks`, is the shift cell `grade.ts`'s slip pass steps by:
   * swinging can move a nominal gap of a whole grid step (e.g. 240 ticks, one
   * eighth) down to something that does not evenly divide it (158 ticks for a
   * 67%-swung eighth grid), so stepping by the SWUNG gap and re-swinging lands
   * a "played one grid step late" candidate a few ticks off the true swung
   * position — inside the match window, where it silently reports the wrong
   * displacement (see `slipShift.ts`'s module doc). Stepping by the nominal
   * gap and re-swinging each candidate is exact for every step, straight or
   * swung, because it is asking the same question `swungTick` itself answers:
   * "where does the note AT THIS NOMINAL POSITION actually land". Equal to
   * `subdivisionTicks` on every straight score (`swungTick` is the identity at
   * `percent: 50`), and on any score whose swing genuinely leaves the nominal
   * grid's smallest gap unchanged.
   */
  readonly nominalSubdivisionTicks: number
  /** `nominalSubdivisionTicks * msPerTick`. */
  readonly nominalSubdivisionMs: number
  /** Ticks -> ms conversion factor for this plan's tempo. See the module comment. */
  readonly msPerTick: number
  /** Half-width of the match window: `min(toleranceMs, subdivisionMs / 2)`. */
  readonly windowMs: number
  readonly toleranceMs: number
  /** Only pads the score actually uses, in the score's own pad order. */
  readonly pads: readonly GroovePadPlan[]
  readonly unisonPairs: readonly UnisonPair[]
  /** Copied from `score.swingPercent` — 50 is straight; `grade.ts`/`resultLines.ts` branch on it. Always equal to `swing.percent`. */
  readonly swingPercent: number
  /** `swungTick`'s other arguments, bundled — see `SwingContext`'s own doc. */
  readonly swing: SwingContext
}

export type PlanGrooveRunOptions = {
  readonly toleranceMs?: number
  readonly countInBars?: number
  readonly gradedBars?: number
}

/**
 * The smallest gap between two distinct SWUNG notated instants in one loop —
 * `distinctSwungTicks` (sorted, distinct, already-swung) and `loopTicks`
 * (fields, not the record they came from — the repo-wide orphan-signals scan
 * flags a helper that takes a whole record but never reads one of its
 * fields). Including the wrap from the last instant back to the first
 * instant of the next loop, because a groove is a loop and the learner plays
 * straight through the bar line.
 *
 * A score with a single distinct instant has no gap to measure; its whole
 * loop is the grid.
 */
function smallestGapTicks(distinctSwungTicks: readonly number[], loopTicks: number): number {
  const first = distinctSwungTicks[0]
  if (first === undefined) return loopTicks
  if (distinctSwungTicks.length === 1) return loopTicks
  let smallest = loopTicks
  for (let i = 1; i < distinctSwungTicks.length; i++) {
    const prev = distinctSwungTicks[i - 1]
    const curr = distinctSwungTicks[i]
    if (prev === undefined || curr === undefined) continue
    smallest = Math.min(smallest, curr - prev)
  }
  // The wrap: the last instant of this loop to the first of the next.
  smallest = Math.min(smallest, loopTicks - (distinctSwungTicks[distinctSwungTicks.length - 1] ?? 0) + first)
  return smallest
}

/**
 * The smallest gap between two distinct notated instants in one loop of
 * `score`, in ticks. `score`'s notes are always nominal (straight — see
 * `GrooveScore.swingPercent`'s doc), but the window this feeds
 * (`planGrooveRun`'s `windowMs`) must be measured on the grid the learner
 * actually plays against, which for a swung score is the SWUNG grid: a
 * swung "&" sixteenth-inside-an-eighth-swing-groove case aside, swinging
 * moves notated instants closer together (never further apart — see
 * `swing.ts`'s "result within `[tick, tick+cell)`" property), so grading off
 * the nominal grid would advertise a window wider than the swung instants
 * actually support. Ticks are swung with `swungTick`, the same function
 * `planGrooveRun` swings `GroovePadPlan.loopTicks`/`expectedMs` with, so the
 * window and the instants it windows are always measured on the same grid.
 */
export function subdivisionTicks(score: GrooveScore): number {
  const barTicks = measureDurationTicks(score.timeSignature)
  const loopTicks = barTicks * score.measures.length
  const distinct = [
    ...new Set(
      score.notes.map(
        (note) =>
          swungTick(
            note.tick,
            score.swingPercent,
            score.swingUnit,
            barTicks,
            score.timeSignature.beats,
            score.timeSignature.beatType,
          ) as number,
      ),
    ),
  ].sort((a, b) => a - b)
  return smallestGapTicks(distinct, loopTicks)
}

/**
 * The smallest gap between two distinct notated instants in one loop of
 * `score`, on the NOMINAL (straight) grid — `note.tick` itself, never
 * `swungTick`'d. This is the grid a learner's slip is actually measured in
 * grid steps of: see `GrooveRunPlan.nominalSubdivisionTicks`'s own doc for why
 * this, not the swung `subdivisionTicks` above, is the slip pass's shift
 * cell. Equal to `subdivisionTicks` on every straight score.
 */
export function nominalSubdivisionTicks(score: GrooveScore): number {
  const barTicks = measureDurationTicks(score.timeSignature)
  const loopTicks = barTicks * score.measures.length
  const distinct = [...new Set(score.notes.map((note) => note.tick as number))].sort((a, b) => a - b)
  return smallestGapTicks(distinct, loopTicks)
}

/**
 * Pairs of distinct pads the score puts on a shared instant, deduplicated and
 * ordered. Deliberately reads `note.tick` NOMINAL (unswung): which pads are
 * written together is a notation fact (what a flam sentence may name), not a
 * performance-swing one, and swing never moves two same-tick notes apart
 * (every pad on one tick swings identically, since `swungTick` is a pure
 * function of the tick/percent/unit/measure — never the pad).
 */
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

  // Swung here, once, at the score's own tick (never baked into `GrooveScore`
  // itself — see that type's doc): every downstream consumer of a plan (the
  // run hook, the audio preview, the grader) reads `expectedMs`/`loopTicks`
  // off `GroovePadPlan`, never `score.notes[].tick` directly, so swinging the
  // tick right here is what makes the run, the preview and the grading all
  // swing together.
  const byPad = new Map<MappedDrumPad, Array<{ readonly swung: number; readonly nominal: number }>>()
  for (const note of score.notes) {
    const nominal = note.tick as number
    const swung = swungTick(
      note.tick,
      score.swingPercent,
      score.swingUnit,
      barTicks,
      score.timeSignature.beats,
      score.timeSignature.beatType,
    ) as number
    const list = byPad.get(note.pad) ?? []
    list.push({ swung, nominal })
    byPad.set(note.pad, list)
  }

  const loops = Math.ceil(gradedTicks / loopTicks)
  const pads: GroovePadPlan[] = []
  for (const [pad, rawTicks] of byPad) {
    // Swung tick -> its own nominal (straight) tick. `validateGrooveScore`
    // rejects any two notes on the same pad whose swing would collide on the
    // same swung tick (see `groove.ts`), so a collision here means that
    // precondition was violated upstream — an invariant, not a silent
    // first-wins dedup.
    const bySwung = new Map<number, number>()
    for (const { swung, nominal } of rawTicks) {
      const existing = bySwung.get(swung)
      invariant(
        existing === undefined || existing === nominal,
        `groove run plan: pad ${pad} has notes at nominal ticks ${String(existing)} and ${nominal} that both swing to tick ${swung} — validateGrooveScore should have rejected this collision`,
      )
      if (existing === undefined) bySwung.set(swung, nominal)
    }
    const loopTicksSorted = [...bySwung.keys()].sort((a, b) => a - b)
    const nominalTicksSorted = loopTicksSorted.map((tick) => {
      const nominal = bySwung.get(tick)
      invariant(nominal !== undefined, `groove run plan: no nominal tick recorded for swung tick ${tick}`)
      return nominal
    })
    const expectedMs: number[] = []
    const expectedNominalMs: number[] = []
    const expectedNominalTicks: number[] = []
    for (let loop = 0; loop < loops; loop++) {
      for (let i = 0; i < loopTicksSorted.length; i++) {
        const tick = loopTicksSorted[i]
        const nominalTick = nominalTicksSorted[i]
        if (tick === undefined || nominalTick === undefined) continue
        const absolute = tick + loop * loopTicks
        if (absolute >= gradedTicks) continue
        const absoluteNominalTick = nominalTick + loop * loopTicks
        expectedMs.push(absolute * msPerTick)
        expectedNominalMs.push(absoluteNominalTick * msPerTick)
        expectedNominalTicks.push(absoluteNominalTick)
      }
    }
    pads.push({ pad, loopTicks: loopTicksSorted, expectedMs, expectedNominalMs, expectedNominalTicks })
  }

  const subdivisionTicksValue = subdivisionTicks(score)
  const subdivisionMs = subdivisionTicksValue * msPerTick
  const nominalSubdivisionTicksValue = nominalSubdivisionTicks(score)
  const nominalSubdivisionMs = nominalSubdivisionTicksValue * msPerTick
  const swing: SwingContext = {
    percent: score.swingPercent,
    unit: score.swingUnit,
    measureTicks: barTicks,
    beats: score.timeSignature.beats,
    beatType: score.timeSignature.beatType,
  }
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
    subdivisionTicks: subdivisionTicksValue,
    nominalSubdivisionTicks: nominalSubdivisionTicksValue,
    nominalSubdivisionMs,
    msPerTick,
    // Never wider than half a subdivision — see the module comment.
    windowMs: Math.min(toleranceMs, subdivisionMs / 2),
    toleranceMs,
    pads,
    unisonPairs: unisonPairsOf(score),
    swingPercent: score.swingPercent,
    swing,
  }
}
