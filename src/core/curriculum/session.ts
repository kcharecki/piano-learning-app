/**
 * The daily practice session builder (REQ-3.1.4): assembles a session from
 * five segments — warm-up, technique, sight-reading, lesson/repertoire,
 * theory/ear training. The four "mixable" segments split their share of the
 * budget in a 20/20/40/20 default mix, scaled to any budget in minutes; the
 * warm-up segment (roadmap 5.45) sits outside that proportional split — see
 * below.
 *
 * Pure and deterministic: given the same budget, mix and candidate lists it
 * always returns the same plan. No Rng, no clock — the caller decides which
 * exercises are candidates and in what preference order.
 *
 * ## Warm-up is reserved, not mixed (roadmap 5.45)
 *
 * Every source consulted (Juilliard's guide among them) puts a short,
 * away-from-the-keys warm-up first, and its length does not track total
 * practice time the way the other four segments' does — a 60-minute session
 * does not need a 20-minute warm-up. So warm-up is not a fifth share of
 * `DEFAULT_MIX`: it is a flat `WARMUP_MINUTES` reserved off the top of the
 * budget (clamped to the budget itself for a very short session), and the
 * REMAINDER is what the existing 20/20/40/20 mix divides among the other
 * four segments exactly as before. This keeps `DEFAULT_MIX` and the mix
 * option's shape unchanged (still four keys) and means a caller that never
 * supplies warm-up candidates gets EXACTLY the pre-5.45 behaviour, byte for
 * byte — see `fillSegment`'s "no candidates -> no items, 0 minutes" rule,
 * which already covers "warm-up declined" for free.
 *
 * Warm-up participates in the same "no candidates anywhere -> error" and
 * "empty segment -> repeat/at-least-one-item" rules as the other four via
 * the same `fillSegment` helper; it just is not eligible to rescue an
 * otherwise-unfillable plan (see `planSession`'s ordering of checks) — a
 * plan with no real content in any of the four mixable segments still
 * errs, even if warm-up alone has candidates, matching the pre-5.45
 * contract that "no candidates for any segment" is a hard error.
 */
import type { Exercise } from '@core/curriculum/types.ts'
import { type Result, ok, err } from '@core/shared/result.ts'
import { invariant } from '@core/shared/invariant.ts'

/** The segment REQ-3.1.4 does not proportion by mix — see the module doc. */
export type WarmupSegmentKind = 'warmup'

/** The four buckets REQ-3.1.4 names, with their default shares. */
export type MixableSegmentKind = 'technique' | 'sight-reading' | 'lesson' | 'theory-ear'

/** Every segment `planSession` can emit, warm-up included. */
export type SessionSegmentKind = WarmupSegmentKind | MixableSegmentKind

/** The four mixable segments, in fill/iteration order (unchanged since before 5.45). */
const MIXABLE_SEGMENT_ORDER: readonly MixableSegmentKind[] = [
  'technique',
  'sight-reading',
  'lesson',
  'theory-ear',
]

/** All five segments, warm-up first — the order `items` is assembled in. */
const SEGMENT_ORDER: readonly SessionSegmentKind[] = ['warmup', ...MIXABLE_SEGMENT_ORDER]

export const DEFAULT_MIX: Readonly<Record<MixableSegmentKind, number>> = {
  technique: 0.2,
  'sight-reading': 0.2,
  lesson: 0.4,
  'theory-ear': 0.2,
}

/**
 * Flat minutes reserved for warm-up off the top of the budget, before the
 * mixable segments split the remainder — see the module doc. Clamped to the
 * total budget for any session shorter than this, so warm-up never claims
 * minutes that do not exist.
 */
export const WARMUP_MINUTES = 5

export const SESSION_LENGTHS: readonly number[] = [15, 30, 60]

export type SessionItem = {
  readonly segment: SessionSegmentKind
  readonly exercise: Exercise
  /** Whole minutes actually allocated — the sum over all items equals the budget exactly. */
  readonly minutes: number
}

export type PlannedSession = {
  readonly totalMinutes: number
  readonly items: readonly SessionItem[]
  /** Minutes per segment, after rounding. Keyed by every segment, zeros included. */
  readonly bySegment: Readonly<Record<SessionSegmentKind, number>>
}

export type SessionPlanOptions = {
  /** Overrides DEFAULT_MIX. Shares are normalised, so they need not sum to 1. Warm-up has no mix share — see the module doc. */
  readonly mix?: Partial<Readonly<Record<MixableSegmentKind, number>>>
  /** Candidate exercises per segment, in preference order — the caller supplies them. */
  readonly candidates: Readonly<Record<SessionSegmentKind, readonly Exercise[]>>
}

/**
 * Largest-remainder apportionment: floor every share's exact allocation, then
 * hand out the leftover whole minutes one at a time to the segments with the
 * largest fractional remainder, ties broken by MIXABLE_SEGMENT_ORDER. This is
 * the standard method for rounding percentages to integers that must sum to a
 * fixed total exactly (e.g. Hamilton's method for apportionment). Warm-up is
 * never a parameter here — it is reserved off the top before this runs, see
 * the module doc.
 */
function allocateWholeMinutes(
  totalMinutes: number,
  shares: Readonly<Record<MixableSegmentKind, number>>,
): Record<MixableSegmentKind, number> {
  const exact: Record<MixableSegmentKind, number> = {
    technique: totalMinutes * shares.technique,
    'sight-reading': totalMinutes * shares['sight-reading'],
    lesson: totalMinutes * shares.lesson,
    'theory-ear': totalMinutes * shares['theory-ear'],
  }
  const floored: Record<MixableSegmentKind, number> = {
    technique: Math.floor(exact.technique),
    'sight-reading': Math.floor(exact['sight-reading']),
    lesson: Math.floor(exact.lesson),
    'theory-ear': Math.floor(exact['theory-ear']),
  }
  const flooredSum = MIXABLE_SEGMENT_ORDER.reduce((sum, seg) => sum + floored[seg], 0)
  let remainder = totalMinutes - flooredSum

  const byRemainderDesc = [...MIXABLE_SEGMENT_ORDER].sort((a, b) => {
    const diff = exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a]))
    if (diff !== 0) return diff
    return MIXABLE_SEGMENT_ORDER.indexOf(a) - MIXABLE_SEGMENT_ORDER.indexOf(b)
  })

  const result = { ...floored }
  let i = 0
  while (remainder > 0 && i < byRemainderDesc.length) {
    const seg = byRemainderDesc[i]
    invariant(seg !== undefined, 'byRemainderDesc index out of bounds')
    result[seg] += 1
    remainder -= 1
    i += 1
  }
  return result
}

/**
 * Fill a segment's minute budget from its candidates, repeating from the
 * start when they run out, never splitting a minute across items. A segment
 * with candidates and a budget of at least 1 minute gets at least one item.
 */
function fillSegment(
  segment: SessionSegmentKind,
  minutes: number,
  candidates: readonly Exercise[],
): SessionItem[] {
  if (minutes <= 0 || candidates.length === 0) return []

  const items: SessionItem[] = []
  let remaining = minutes
  let cursor = 0
  while (remaining > 0) {
    const exercise = candidates[cursor % candidates.length]
    invariant(exercise !== undefined, 'candidate cursor out of bounds')
    const hint = Number.isFinite(exercise.estimatedMinutes)
      ? Math.round(exercise.estimatedMinutes)
      : 1
    const allocated = Math.min(remaining, Math.max(1, hint))
    items.push({ segment, exercise, minutes: allocated })
    remaining -= allocated
    cursor += 1
  }
  return items
}

export function planSession(
  rawTotalMinutes: number,
  opts: SessionPlanOptions,
): Result<PlannedSession, string> {
  // Only non-positive and non-finite budgets are rejected, per the contract.
  // Items allocate whole minutes and must sum to totalMinutes exactly (see
  // SessionItem.minutes), so a fractional budget is floored to whole minutes
  // rather than rejected — callers may derive a budget from elapsed seconds.
  if (!Number.isFinite(rawTotalMinutes) || rawTotalMinutes <= 0) {
    return err(`totalMinutes must be a positive whole number of minutes, got ${rawTotalMinutes}`)
  }
  const totalMinutes = Math.floor(rawTotalMinutes)
  if (totalMinutes <= 0) {
    return err(`totalMinutes must be a positive whole number of minutes, got ${rawTotalMinutes}`)
  }

  const rawMix: Record<MixableSegmentKind, number> = {
    technique: opts.mix?.technique ?? DEFAULT_MIX.technique,
    'sight-reading': opts.mix?.['sight-reading'] ?? DEFAULT_MIX['sight-reading'],
    lesson: opts.mix?.lesson ?? DEFAULT_MIX.lesson,
    'theory-ear': opts.mix?.['theory-ear'] ?? DEFAULT_MIX['theory-ear'],
  }

  for (const seg of MIXABLE_SEGMENT_ORDER) {
    const share = rawMix[seg]
    if (!Number.isFinite(share) || share < 0) {
      return err(`mix share for '${seg}' must be a non-negative finite number, got ${share}`)
    }
  }

  const rawSum = MIXABLE_SEGMENT_ORDER.reduce((sum, seg) => sum + rawMix[seg], 0)
  if (rawSum <= 0) {
    return err('mix normalises to zero — at least one segment must have a positive share')
  }

  // Segments with no candidates get zero minutes; their share is
  // redistributed proportionally over the segments that do have candidates.
  // Warm-up is deliberately excluded from this check (and from `rawMix`
  // entirely) — see the module doc: it cannot rescue an otherwise-unfillable
  // plan, so "no candidates for any segment" still means the four mixable
  // ones, exactly as it did before warm-up existed.
  const hasCandidates = (seg: MixableSegmentKind): boolean => opts.candidates[seg].length > 0

  const eligibleSegments = MIXABLE_SEGMENT_ORDER.filter(hasCandidates)
  if (eligibleSegments.length === 0) {
    return err('no candidates supplied for any segment — cannot build a session')
  }

  const eligibleSum = eligibleSegments.reduce((sum, seg) => sum + rawMix[seg], 0)

  const shares: Record<MixableSegmentKind, number> = {
    technique: 0,
    'sight-reading': 0,
    lesson: 0,
    'theory-ear': 0,
  }
  if (eligibleSum <= 0) {
    return err('mix normalises to zero over the segments that have candidates')
  }
  // Normal case: redistribute proportionally to each eligible segment's own share.
  for (const seg of eligibleSegments) shares[seg] = rawMix[seg] / eligibleSum

  // Warm-up is reserved off the top, flat, before the mixable split — see the
  // module doc. `Math.min` clamps it to the budget itself so a session
  // shorter than WARMUP_MINUTES still sums exactly to totalMinutes.
  const warmupMinutes =
    opts.candidates.warmup.length > 0 ? Math.min(WARMUP_MINUTES, totalMinutes) : 0
  const remainingMinutes = totalMinutes - warmupMinutes

  const mixableBySegment = allocateWholeMinutes(remainingMinutes, shares)
  const bySegment: Record<SessionSegmentKind, number> = { warmup: warmupMinutes, ...mixableBySegment }

  const items: SessionItem[] = []
  for (const seg of SEGMENT_ORDER) {
    items.push(...fillSegment(seg, bySegment[seg], opts.candidates[seg]))
  }

  return ok({ totalMinutes, items, bySegment })
}
