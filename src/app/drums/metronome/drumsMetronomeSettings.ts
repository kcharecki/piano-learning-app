/**
 * The drums metronome dial's settings (roadmap DR-12): the fixed 4/4 grid,
 * the numeric bounds the screen renders as stepper limits, the setting
 * types, and the validators that keep a bad value from ever reaching the
 * frame pump. Split out of `useDrumsMetronome.ts` when the adversarial-review
 * fixes pushed the hook past the 500-line limit; the hook re-exports the
 * bounds and types so the screen still has a single import.
 */
import { beatTicks } from '@core/timing/metronome.ts'
import type { ClickPlacement, GapClickSchedule } from '@core/timing/clickFilters.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import {
  validateGapBars as validateGapBarsCore,
  validatePlacement as validatePlacementCore,
  validateRampConfig,
} from '@core/timing/metronomeRun.ts'
import { bpm as asBpm, type Bpm } from '@core/shared/units.ts'

export const TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
export const BAR_TICKS = measureDurationTicks(TIME_SIGNATURE)
export const BEAT_TICKS = beatTicks(TIME_SIGNATURE)

export const DRUMS_MIN_BPM = 40
export const DRUMS_MAX_BPM = 240
export const MIN_GAP_BARS = 1
export const MAX_GAP_BARS = 8
export const MIN_EVERY_N_BARS = 1
export const MAX_EVERY_N_BARS = 16
export const MIN_RAMP_STEP_BPM = 1
export const MAX_RAMP_STEP_BPM = 20

export const DEFAULT_BPM = asBpm(100)
export const DEFAULT_GAP: GapClickSchedule = { onBars: 1, offBars: 0 }
export const DEFAULT_PLACEMENT: ClickPlacement = { kind: 'all' }
export const DEFAULT_SUBDIVISION_VOLUME = 0.6

export type DrumSubdivision = 1 | 2 | 3 | 4

/**
 * Same shape as `GapClickSchedule` (`@core/timing/clickFilters.ts`), under
 * this slice's own name. `offBars: 0` means the gap is off.
 */
export type GapSchedule = GapClickSchedule

/**
 * `undefined` means no ramp — the bpm on the dial holds forever. Named
 * `DrumsRampSettings`, not `RampSettings`: `@core/timing/metronome.ts`
 * already exports a `RampSettings` of its own (the count-in ramp), and the
 * two must not collide for a caller that imports both.
 */
export type DrumsRampSettings =
  { readonly stepBpm: number; readonly everyBars: number; readonly targetBpm: number } | undefined

export function clampBpm(n: number): Bpm {
  return asBpm(Math.min(DRUMS_MAX_BPM, Math.max(DRUMS_MIN_BPM, n)))
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/**
 * Thin wrappers over `@core/timing/metronomeRun.ts`'s pure, bounds-parameterised
 * validators — this file owns the numeric limits (`DRUMS_MIN_BPM` and
 * friends), the core module owns the shape-checking logic. Moved out during
 * the adversarial-review follow-up so this file's own line count (the thing
 * actually at risk of the `max-lines` cap) does not carry arithmetic that has
 * no React/DOM dependency at all.
 */
export function validateGapBars(g: GapClickSchedule): string | undefined {
  return validateGapBarsCore(g, { minBars: MIN_GAP_BARS, maxBars: MAX_GAP_BARS })
}

export function validateRamp(r: DrumsRampSettings): string | undefined {
  if (r === undefined) return undefined
  return validateRampConfig(r, {
    minStepBpm: MIN_RAMP_STEP_BPM,
    maxStepBpm: MAX_RAMP_STEP_BPM,
    minEveryBars: MIN_EVERY_N_BARS,
    maxEveryBars: MAX_EVERY_N_BARS,
    minBpm: DRUMS_MIN_BPM,
    maxBpm: DRUMS_MAX_BPM,
  })
}

/**
 * MAJOR 3: an unvalidated placement can throw inside `placeClicks`, called
 * from the `rAF` callback — which would kill the transport loop with the UI
 * still showing "Stop" and no error surfaced.
 */
export function validatePlacement(p: ClickPlacement): string | undefined {
  return validatePlacementCore(p, {
    beatsPerBar: TIME_SIGNATURE.beats,
    minN: MIN_EVERY_N_BARS,
    maxN: MAX_EVERY_N_BARS,
  })
}
