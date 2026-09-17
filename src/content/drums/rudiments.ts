/**
 * The 40 PAS International Drum Rudiments (DR-10 library), authored in the
 * Wooton/Vic Firth four-tier learning order rather than the PAS list's own
 * 1-40 numbering (kept per-entry as `pasNumber`, and used to derive each
 * entry's `family` — see `rudimentBuilders.ts`'s `familyForPasNumber`).
 *
 * The data itself lives in two files split purely to stay under this repo's
 * 500-line-per-file cap (`rudiments.tier12.ts`, `rudiments.tier34.ts`); this
 * module is the single public entry point that merges them and provides the
 * lookups the rudiment trainer (DR-10) actually calls.
 */
import { TIER_1_RUDIMENTS, TIER_2_RUDIMENTS } from './rudiments.tier12.ts'
import { TIER_3_RUDIMENTS, TIER_4_RUDIMENTS } from './rudiments.tier34.ts'
import type { Rudiment, RudimentTier } from '@core/drums/rudiment/types.ts'

export type { Rudiment, RudimentFamily, RudimentStroke, RudimentTier } from '@core/drums/rudiment/types.ts'

/**
 * All 40, sorted by tier then PAS list number. The tier files themselves are
 * authored in the more pedagogically-natural order from the DR-10 brief
 * (roll family together, diddle family together, ...), so the sort below —
 * not authoring order — is what actually guarantees this contract.
 */
export const RUDIMENTS: readonly Rudiment[] = [
  ...TIER_1_RUDIMENTS,
  ...TIER_2_RUDIMENTS,
  ...TIER_3_RUDIMENTS,
  ...TIER_4_RUDIMENTS,
].sort((a, b) => a.tier - b.tier || a.pasNumber - b.pasNumber)

const BY_ID: ReadonlyMap<string, Rudiment> = new Map(RUDIMENTS.map((r) => [r.id, r]))
const BY_TIER: ReadonlyMap<RudimentTier, readonly Rudiment[]> = new Map(
  ([1, 2, 3, 4] as const).map((tier) => [tier, RUDIMENTS.filter((r) => r.tier === tier)]),
)

export function rudimentById(id: string): Rudiment | undefined {
  return BY_ID.get(id)
}

export function rudimentsInTier(tier: RudimentTier): readonly Rudiment[] {
  return BY_TIER.get(tier) ?? []
}
