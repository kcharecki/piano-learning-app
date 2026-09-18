/**
 * Latency calibration (roadmap DR-08): a steady click at `CALIBRATION_BPM`,
 * the learner plays along on any pad for `CALIBRATION_HITS` hits, and the
 * MEDIAN signed deviation from the nearest click becomes the rig's stored
 * input offset. Median, not mean, because one wild outlier (a missed pad, a
 * double-trigger) must not drag the whole calibration — see the property
 * test below on how few of the 16 hits can move it.
 *
 * The offset is honest about its own precision: `summarizeCalibration` also
 * reports the spread (median absolute deviation), and the screen shows both
 * — a rig with a wide spread has a noisy offset, and hiding that would let a
 * learner trust a number the underlying hardware cannot actually support.
 */
import { invariant, at } from '@core/shared/invariant.ts'

export const CALIBRATION_BPM = 80
export const CALIBRATION_HITS = 16
/** Fewer deviations than this and no summary is produced. */
export const MIN_CALIBRATION_HITS = 8

/**
 * Signed ms from `hitMs` to the NEAREST click of a grid starting at
 * `originMs` with period `beatMs`; positive = late. Always in
 * `(-beatMs/2, beatMs/2]` — a tie (exactly halfway between two clicks)
 * resolves to the earlier click, i.e. reads as positive.
 */
export function nearestClickDeviationMs(hitMs: number, originMs: number, beatMs: number): number {
  const diff = hitMs - originMs
  const half = beatMs / 2
  // Wrap into [0, beatMs) first...
  const wrapped = ((diff % beatMs) + beatMs) % beatMs
  // ...then fold the top half down to negative, leaving (-half, half].
  return wrapped > half ? wrapped - beatMs : wrapped
}

/**
 * The median of `values`. Even counts use the MEAN of the two middle values
 * (not the lower of the two) — a calibration run always has an even sample
 * count (16 hits), and a "lower middle" rule would bias every offset toward
 * the earlier of two equally-plausible readings for no reason. Throws
 * (programmer error) on an empty array.
 */
export function median(values: readonly number[]): number {
  invariant(values.length > 0, 'median of an empty array')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return at(sorted, mid)
  return (at(sorted, mid - 1) + at(sorted, mid)) / 2
}

export type CalibrationSummary = {
  /** Median signed deviation, ms, positive = the rig reads late. */
  readonly offsetMs: number
  /** Median absolute deviation from `offsetMs`, ms — a robust spread. */
  readonly spreadMs: number
  readonly samples: number
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** `undefined` when `deviationsMs.length < MIN_CALIBRATION_HITS`. Values rounded to 1 decimal. */
export function summarizeCalibration(deviationsMs: readonly number[]): CalibrationSummary | undefined {
  if (deviationsMs.length < MIN_CALIBRATION_HITS) return undefined
  const offsetMs = median(deviationsMs)
  const spreadMs = median(deviationsMs.map((d) => Math.abs(d - offsetMs)))
  return { offsetMs: round1(offsetMs), spreadMs: round1(spreadMs), samples: deviationsMs.length }
}
