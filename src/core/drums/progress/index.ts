/**
 * Public surface of the drums progress aggregates (roadmap DR-23), the same
 * re-export-barrel shape `@core/drums/reading/index.ts` uses: the progress
 * screen and its tests import from here rather than reaching into
 * `rudimentTiers.ts`/`grooveBests.ts` directly.
 */
export type { RudimentRecord, TierCompletion } from './rudimentTiers.ts'
export { tierCompletion } from './rudimentTiers.ts'

export type {
  GrooveAttemptLike,
  GrooveAttemptPadLike,
  GrooveBest,
  LimbBias,
} from './grooveBests.ts'
export { grooveBests, limbBias } from './grooveBests.ts'

export type { GrooveTrend, GrooveTrendPoint, TrendDirection } from './trend.ts'
export { DEFAULT_TREND_RUNS, TREND_FLAT_MS, grooveTrends } from './trend.ts'
