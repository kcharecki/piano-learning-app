/** Barrel for the rudiment trainer's core pieces (DR-10): types, the groove bridge, the tempo ladder. */
export type { Rudiment, RudimentFamily, RudimentStroke, RudimentTier } from './types.ts'
export { rudimentToScore } from './score.ts'
export {
  recordPass,
  startLadder,
  type LadderMode,
  type TempoLadderConfig,
  type TempoLadderState,
} from './tempoLadder.ts'
