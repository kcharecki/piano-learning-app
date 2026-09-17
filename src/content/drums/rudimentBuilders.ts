/**
 * Internal helpers for authoring the 40 PAS rudiments (`rudiments.tier12.ts`,
 * `rudiments.tier34.ts`) as compact sticking strings instead of hand-written
 * stroke arrays — the shape a rudiment chart is actually printed in, and much
 * easier to check by eye against a reference chart than an array literal
 * would be. Not part of the public module surface (`rudiments.ts` doesn't
 * re-export this file); it exists purely to keep the two data files honest.
 *
 * `padToBeat` is what lets every rudiment's `patternTicks` come out as a
 * whole multiple of the quarter note (`@core/shared/units.ts`'s
 * `TICKS_PER_QUARTER = 480`) without each rudiment author having to compute
 * it by hand: odd-length patterns (five/seven/nine-stroke rolls, and any
 * flam/drag/ratamacue whose stroke count isn't itself a power of two) simply
 * get a silent tail added, exactly as `score.ts`'s doc comment describes.
 */
import { invariant } from '@core/shared/invariant.ts'
import { EIGHTH, QUARTER, SIXTEENTH, TRIPLET_EIGHTH } from '@core/shared/units.ts'
import type { Rudiment, RudimentFamily, RudimentStroke, RudimentTier } from '@core/drums/rudiment/types.ts'

export { EIGHTH, QUARTER, SIXTEENTH, TRIPLET_EIGHTH }
/** Not exported from `@core/shared/units.ts` (nothing else in the app needs it) — used here only by the seven-stroke family's grace-note spacing. */
export const THIRTY_SECOND = SIXTEENTH / 2

export type SeqOptions = {
  /** 0-based indices into `sticking` that are accented. */
  readonly accents?: readonly number[]
  /** 0-based indices whose primary stroke carries a flam grace note. */
  readonly flams?: readonly number[]
  /** 0-based indices whose primary stroke carries a drag (ruff) grace note. */
  readonly drags?: readonly number[]
  /** 0-based indices whose primary stroke is a multiple-bounce (buzz). */
  readonly buzzes?: readonly number[]
}

/**
 * Turns a sticking string like `'RLRR LRLL'` (spaces are purely readability —
 * stripped before parsing) into evenly-spaced `RudimentStroke`s of
 * `unitTicks` each, starting at tick 0. Every one of the 40 rudiments in this
 * package is one call to this function (or two, joined, for a pattern
 * mixing note values) — see the module doc on why.
 */
export function seq(sticking: string, unitTicks: number, opts: SeqOptions = {}): readonly RudimentStroke[] {
  const hands = sticking.replace(/\s+/g, '').split('')
  const accents = new Set(opts.accents ?? [])
  const flams = new Set(opts.flams ?? [])
  const drags = new Set(opts.drags ?? [])
  const buzzes = new Set(opts.buzzes ?? [])
  return hands.map((h, i) => {
    invariant(h === 'R' || h === 'L', `bad sticking character "${h}" at index ${i} of "${sticking}"`)
    const articulation = flams.has(i)
      ? ('flam' as const)
      : drags.has(i)
        ? ('drag' as const)
        : buzzes.has(i)
          ? ('buzz' as const)
          : undefined
    return {
      sticking: h as 'R' | 'L',
      tick: i * unitTicks,
      durationTicks: unitTicks,
      ...(accents.has(i) ? { accent: true as const } : {}),
      ...(articulation === undefined ? {} : { articulation }),
    }
  })
}

/** Concatenate stroke groups (each built at tick 0 by `seq`) back to back in time. */
export function chain(...groups: readonly (readonly RudimentStroke[])[]): readonly RudimentStroke[] {
  const out: RudimentStroke[] = []
  let offset = 0
  for (const group of groups) {
    for (const stroke of group) out.push({ ...stroke, tick: stroke.tick + offset })
    offset = group.length === 0 ? offset : Math.max(...group.map((s) => s.tick + s.durationTicks)) + offset
  }
  return out
}

/** Smallest whole number of beats (multiple of `QUARTER`) that fits every stroke. */
export function padToBeat(strokes: readonly RudimentStroke[]): number {
  const end = strokes.reduce((max, s) => Math.max(max, s.tick + s.durationTicks), 0)
  return Math.max(QUARTER, Math.ceil(end / QUARTER) * QUARTER)
}

/** The official PAS list is grouped 1-15 roll, 16-19 diddle, 20-30 flam, 31-40 drag. */
export function familyForPasNumber(pasNumber: number): RudimentFamily {
  if (pasNumber <= 15) return 'roll'
  if (pasNumber <= 19) return 'diddle'
  if (pasNumber <= 30) return 'flam'
  return 'drag'
}

export type RudimentSpec = {
  readonly id: string
  readonly pasNumber: number
  readonly name: string
  readonly tier: RudimentTier
  readonly strokes: readonly RudimentStroke[]
  readonly bpmBand: { readonly start: number; readonly target: number }
  readonly transfer: string
}

/** Fills in `patternTicks` (via `padToBeat`) and `family` (via `familyForPasNumber`) so each entry in the tier files states only what is genuinely per-rudiment data. */
export function makeRudiment(spec: RudimentSpec): Rudiment {
  return {
    id: spec.id,
    pasNumber: spec.pasNumber,
    name: spec.name,
    tier: spec.tier,
    family: familyForPasNumber(spec.pasNumber),
    patternTicks: padToBeat(spec.strokes),
    strokes: spec.strokes,
    bpmBand: spec.bpmBand,
    transfer: spec.transfer,
  }
}
