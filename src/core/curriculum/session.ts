/**
 * The daily practice session builder (REQ-3.1.4): assembles a session from
 * five segments — warm-up, technique, sight-reading, lesson/repertoire,
 * theory/ear training. The four "mixable" segments split the budget in a
 * 20/20/40/20 default mix, scaled to any budget in minutes; warm-up
 * (roadmap 5.45, reworked for roadmap 4.10's M4 acceptance fix) is carved
 * OUT of technique's own 20% share rather than being a fifth split — see
 * below.
 *
 * Pure and deterministic: given the same budget, mix and candidate lists it
 * always returns the same plan. No Rng, no clock — the caller decides which
 * exercises are candidates and in what preference order.
 *
 * ## Warm-up shares technique's bucket, it does not sit outside it (roadmap 4.10)
 *
 * REQ-3.1.4 names four categories, and the first of them is
 * "warm-up/technique (~20%)" — ONE bucket, not two. Roadmap 5.45's original
 * implementation missed that: it took a flat `WARMUP_MINUTES` off the TOP of
 * the whole budget, before the 20/20/40/20 split ran over what was left.
 * That silently shrank every other category too (at 15 minutes, 5 flat
 * minutes off the top is a third of the entire session, not a third of
 * technique's fifth) — the 2026-08-12 M4 acceptance pass caught it as a
 * regression (`docs/m4-acceptance-2026-08-12.md`, Defect 1).
 *
 * The fix: `technique`'s share of `DEFAULT_MIX` (still 0.2, still one of the
 * four keys `allocateWholeMinutes` splits) now represents the COMBINED
 * warm-up/technique bucket the requirement names. Once that bucket's whole
 * minutes are apportioned exactly like every other segment's — over the
 * FULL budget, not a remainder — warm-up claims up to `WARMUP_MINUTES` OF
 * IT, and technique keeps whatever is left:
 *
 *   techniqueBucket = allocateWholeMinutes(totalMinutes, shares).technique
 *   warmup          = min(WARMUP_MINUTES, techniqueBucket)
 *   technique       = techniqueBucket - warmup
 *
 * Why warm-up takes the first claim on the shared bucket rather than a
 * proportional split of it: `WARMUP_MINUTES` is a fixed, already-justified
 * routine length (5 steps, ~1 minute each — see `@content/curriculum/
 * warmups.ts`), and a technique block does not stop being useful just
 * because it is short — a partial drill is still real practice, whereas a
 * partial warm-up routine that got proportionally shaved on every budget
 * would be a slightly-worse version of the same five steps every single
 * day. Capping warm-up at its own natural length and letting technique
 * absorb the remainder keeps the warm-up routine IDENTICAL in substance at
 * every budget (still all 5 `WARMUP_STEPS`, `WarmupChecklist` does not
 * truncate the list by minutes) and only trims how many minutes the session
 * clock credits it — this is what keeps a 15-minute session's warm-up
 * "musically useful rather than rounded to zero": the requirement's own
 * ~20% bucket at 15 minutes is already ~3 minutes, comfortably enough for
 * most of the routine, and warm-up gets first claim on those 3 rather than
 * being squeezed to nothing by technique.
 *
 * This keeps `DEFAULT_MIX` and the mix option's shape unchanged (still four
 * keys) and means a caller that never supplies warm-up candidates gets
 * EXACTLY the same technique allocation as if warm-up did not exist — see
 * `fillSegment`'s "no candidates -> no items, 0 minutes" rule, which already
 * covers "warm-up declined" for free (the whole bucket stays technique's).
 *
 * Warm-up participates in the same "no candidates anywhere -> error" and
 * "empty segment -> repeat/at-least-one-item" rules as the other four via
 * the same `fillSegment` helper; it just is not eligible to rescue an
 * otherwise-unfillable plan (see `planSession`'s ordering of checks) — a
 * plan with no real content in any of the four mixable segments still
 * errs, even if warm-up alone has candidates. One consequence of warm-up now
 * living inside technique's bucket rather than the raw budget: if
 * `technique` itself has NO candidates (so its share renormalises to 0
 * elsewhere), warm-up gets zero minutes too, even though it has its own
 * candidate — there is no bucket left for it to draw from. In practice
 * `techniqueCandidates` (`@app/session/candidates.ts`) always returns the
 * level's drills, so this only matters for a caller that deliberately empties
 * technique's candidate list.
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
 * The warm-up routine's natural length, and the most it can claim of
 * technique's shared bucket (roadmap 4.10) — see the module doc's "Warm-up
 * shares technique's bucket" section. Clamped to the bucket itself (which is
 * in turn clamped to the total budget) so warm-up never claims minutes that
 * do not exist.
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

  // The combined warm-up/technique bucket is apportioned over the FULL
  // budget, exactly like every other segment — no off-the-top reservation
  // (roadmap 4.10; see the module doc's "Warm-up shares technique's bucket"
  // section for why this replaced the flat reservation).
  const mixableBySegment = allocateWholeMinutes(totalMinutes, shares)

  // Warm-up claims up to WARMUP_MINUTES OF technique's own bucket; technique
  // keeps the remainder. `Math.min` clamps warm-up to the bucket itself, so
  // a bucket smaller than WARMUP_MINUTES (a short session, or technique
  // renormalised down by other empty segments) still sums exactly.
  const warmupMinutes =
    opts.candidates.warmup.length > 0 ? Math.min(WARMUP_MINUTES, mixableBySegment.technique) : 0
  const techniqueMinutes = mixableBySegment.technique - warmupMinutes

  const bySegment: Record<SessionSegmentKind, number> = {
    ...mixableBySegment,
    technique: techniqueMinutes,
    warmup: warmupMinutes,
  }

  const items: SessionItem[] = []
  for (const seg of SEGMENT_ORDER) {
    items.push(...fillSegment(seg, bySegment[seg], opts.candidates[seg]))
  }

  return ok({ totalMinutes, items, bySegment })
}
