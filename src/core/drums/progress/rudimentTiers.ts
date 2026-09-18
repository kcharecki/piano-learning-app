/**
 * Rudiment-tier completion (roadmap DR-23 "drums progress MVP") — how far a
 * drummer has gotten through the 40 PAS rudiments, one row per Wooton/Vic
 * Firth tier (`RudimentTier`, declared `@core/drums/rudiment/types.ts`).
 *
 * STATE-FREE, the same shape every `progress` module here holds itself to:
 * this only aggregates a `RudimentRecord` map the caller already has
 * (`useDrumsRudimentStore`'s `records`) against the curriculum's own
 * `Rudiment[]` (`@content/drums/rudiments.ts`'s `RUDIMENTS`) — it never reads
 * a store or decides what counts as a clean pass.
 *
 * `RudimentRecord` is redeclared here rather than imported from
 * `drumsRudimentStore.ts` on purpose: that module is `src/app/state/*` and
 * `src/core` must never import `@app/*` (`eslint.config.js`). The shape is
 * identical by contract, not by import.
 */
import type { Rudiment, RudimentTier } from '@core/drums/rudiment/types.ts'

export type RudimentRecord = {
  readonly bestCleanBpm: number
  readonly lastBpm: number
  /** epoch ms */
  readonly at: number
}

export type TierCompletion = {
  readonly tier: RudimentTier
  /** Rudiments in the tier. */
  readonly total: number
  /** Rudiments in the tier with any record. */
  readonly started: number
  /** Rudiments in the tier whose record's `bestCleanBpm` has reached the rudiment's own `bpmBand.target`. */
  readonly atTarget: number
}

/**
 * Declaration order of `RudimentTier` (1|2|3|4) — hardcoded because a union
 * type carries no runtime member list, the same reasoning `rudiments.ts`'s
 * own internal `BY_TIER` map hardcodes `([1, 2, 3, 4] as const)`.
 */
const TIERS_IN_ORDER: readonly RudimentTier[] = [1, 2, 3, 4]

/**
 * One row per tier in `RudimentTier` declaration order, including tiers with
 * `total` 0 if any — the caller (a progress screen) renders every tier
 * whether or not the curriculum currently populates it. A record keyed by an
 * id that names no rudiment in `rudiments` is silently ignored: it can never
 * be found by any tier's `rudiment.id` lookup, so it never counts toward
 * `started` or `atTarget` for any row.
 */
export function tierCompletion(
  rudiments: readonly Rudiment[],
  records: Readonly<Record<string, RudimentRecord>>,
): readonly TierCompletion[] {
  return TIERS_IN_ORDER.map((tier) => {
    const inTier = rudiments.filter((rudiment) => rudiment.tier === tier)
    let started = 0
    let atTarget = 0
    for (const rudiment of inTier) {
      const record = records[rudiment.id]
      if (record === undefined) continue
      started += 1
      if (record.bestCleanBpm >= rudiment.bpmBand.target) atTarget += 1
    }
    return { tier, total: inTier.length, started, atTarget }
  })
}
