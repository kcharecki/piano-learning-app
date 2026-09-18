/** Barrel for the rudiment trainer's core pieces (DR-10): types, the groove bridge, the tempo ladder, evenness scoring. */
export type { Rudiment, RudimentFamily, RudimentStroke, RudimentTier } from './types.ts'
export { rudimentToScore } from './score.ts'
export {
  recordPass,
  startLadder,
  type LadderMode,
  type TempoLadderConfig,
  type TempoLadderState,
} from './tempoLadder.ts'
export {
  isEvenEnough,
  MIN_EVENNESS_STROKES,
  RUDIMENT_CLEAN_EVENNESS,
  rudimentEvenness,
} from './evenness.ts'
