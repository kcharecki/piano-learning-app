/**
 * Kick-permutation drills (roadmap DR-15 "coordination trainer"): the
 * standard "keep the hands steady while the foot moves" exercise. Eighth-note
 * hi-hats and a snare backbeat never change; one kick note visits each of the
 * 16 sixteenth-note slots of a 4/4 bar in turn, easiest placement first.
 *
 * ## Difficulty is syncopation, not position
 *
 * A kick on the beat is the easiest thing a foot can do; a kick on an "e" or
 * "a" is the hardest, because it falls between the hands' own eighth-note
 * grid. `syncopationWeight` scores every slot on that basis alone — see its
 * own doc comment for the exact formula — and `singleKickPermutations` sorts
 * by it, so the drill list is easy-to-hard by construction rather than by a
 * separately maintained order that could drift from the scoring.
 */
import { makeGrooveScore, type GrooveScore } from '@core/drums/model/groove.ts'
import { randomInt, type Rng } from '@core/ports/rng.ts'

/** Ticks per sixteenth note (`TICKS_PER_QUARTER / 4`). */
export const SIXTEENTH_TICKS = 120

/** 0..15 within one 4/4 bar. */
export type SixteenthSlot = number

const WITHIN_BEAT_SUFFIX: readonly string[] = ['', 'e', '&', 'a']

/** How a sixteenth slot reads as a count, e.g. `0` -> `"1"`, `2` -> `"1&"`, `15` -> `"4a"`. */
export function slotName(slot: SixteenthSlot): string {
  const beat = Math.floor(slot / 4) + 1
  const suffix = WITHIN_BEAT_SUFFIX[slot % 4] ?? ''
  return `${beat}${suffix}`
}

/**
 * Difficulty of a kick landing on `slot`. On the beat (`slot % 4 === 0`) is
 * easiest at `0`; the "&" (`slot % 4 === 2`) is `1`; the "e"/"a" positions
 * (`slot % 4` odd) are hardest at `2`. Landing in unison with the snare
 * (slots 4 and 12, beats 2 and 4) earns no extra weight beyond the downbeat
 * score above — a kick under the snare is not a harder coordination task
 * than a kick alone. A further `0.5` is added for the second half of the
 * bar, since a learner has already been playing for two beats by then and a
 * late-bar placement asks for more sustained coordination than the same
 * shape stated early.
 */
export function syncopationWeight(slot: SixteenthSlot): number {
  const position = slot % 4
  const base = position === 0 ? 0 : position === 2 ? 1 : 2
  return base + (slot >= 8 ? 0.5 : 0)
}

export type KickDrill = {
  readonly slots: readonly SixteenthSlot[]
  readonly score: GrooveScore
}

/** Eighth-note hi-hat grid: ticks 0, 240, …, 1680. */
const HAT_TICKS: readonly number[] = [0, 240, 480, 720, 960, 1200, 1440, 1680]
/** Snare on beats 2 and 4. */
const SNARE_TICKS: readonly number[] = [480, 1440]

function buildKickDrillScore(slots: readonly SixteenthSlot[], title: string): GrooveScore {
  return makeGrooveScore({
    id: `kick-perm/${slots.join('-')}`,
    title,
    measureCount: 1,
    notes: [
      ...HAT_TICKS.map((tick) => ({ pad: 'hhClosed' as const, tick, durationTicks: 240 })),
      ...SNARE_TICKS.map((tick) => ({ pad: 'snare' as const, tick, durationTicks: 480 })),
      ...slots.map((slot) => ({
        pad: 'kick' as const,
        tick: slot * SIXTEENTH_TICKS,
        durationTicks: SIXTEENTH_TICKS,
      })),
    ],
  })
}

/**
 * The 16 single-kick drills, sorted by `(syncopationWeight asc, slot asc)` —
 * easiest placement first.
 */
export function singleKickPermutations(): readonly KickDrill[] {
  const slots = Array.from({ length: 16 }, (_, i) => i)
  const sorted = [...slots].sort((a, b) => syncopationWeight(a) - syncopationWeight(b) || a - b)
  return sorted.map((slot) => ({
    slots: [slot],
    score: buildKickDrillScore([slot], `Kick on ${slotName(slot)}`),
  }))
}

/**
 * `count` two-kick drills, each landing on two DISTINCT sixteenth slots drawn
 * via the `Rng` port — never `Math.random`, so a script reproduces an exact
 * drill list. A collision (the second draw matches the first) is redrawn
 * rather than kept, so every drill genuinely has two different placements.
 * `count <= 0` yields `[]`.
 */
export function twoKickPermutations(rng: Rng, count: number): readonly KickDrill[] {
  if (count <= 0) return []
  const drills: KickDrill[] = []
  for (let i = 0; i < count; i++) {
    // Two draws, never a retry loop: the second draw picks one of the 15
    // slots that are NOT `a` (0..14, shifted up past `a`), so a degenerate
    // rng that keeps returning the same value — a scripted fake cycling a
    // short list, or a broken adapter — still terminates in two calls
    // instead of spinning forever on `b === a`.
    const a = randomInt(rng, 0, 15)
    const drawn = randomInt(rng, 0, 14)
    const b = drawn >= a ? drawn + 1 : drawn
    const slots: readonly SixteenthSlot[] = a < b ? [a, b] : [b, a]
    const [lo, hi] = slots
    drills.push({
      slots,
      score: buildKickDrillScore(slots, `Kick on ${slotName(lo ?? 0)} and ${slotName(hi ?? 0)}`),
    })
  }
  return drills
}
