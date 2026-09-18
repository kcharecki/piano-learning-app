/**
 * Learner-facing copy for the latency calibration screen (roadmap DR-08).
 * Pure text formatting only — `useCalibration.ts` owns the run, `.tsx` files
 * export only components (see `AGENTS.md`), so every sentence lives here.
 */
import type { LatencyRecord } from '@app/state/drumsLatencyStore.ts'
import type { CalibrationPhase } from './useCalibration.ts'
import { CALIBRATION_HITS, type CalibrationSummary } from '@core/drums/scoring/latency.ts'

export function calibrationStateText(phase: CalibrationPhase, beat: number, hits: number): string {
  switch (phase) {
    case 'idle':
      return `Play along with the click on any pad. ${CALIBRATION_HITS} hits.`
    case 'count-in':
      return `Count-in… ${beat}`
    case 'collecting':
      return `Hit ${hits} of ${CALIBRATION_HITS}`
    case 'done':
      return 'Done'
  }
}

/** Signed ms rounded to a whole number, with its own "late"/"early" word. */
function directionOf(offsetMs: number): 'late' | 'early' {
  return offsetMs > 0 ? 'late' : 'early'
}

export function summaryText(summary: CalibrationSummary): string {
  const abs = Math.abs(Math.round(summary.offsetMs))
  const spread = Math.round(summary.spreadMs)
  if (abs === 0) return `Your hits read on the click (spread ±${spread} ms)`
  return `Your hits read ${abs} ms ${directionOf(summary.offsetMs)} on average (spread ±${spread} ms)`
}

/** `undefined` when the spread is tight enough that a tighter window would still feel fair. */
export function spreadWarningText(summary: CalibrationSummary): string | undefined {
  return summary.spreadMs > 20 ? 'Windows tighter than that will feel random.' : undefined
}

export function storedOffsetText(inputLabel: string, record: LatencyRecord | undefined): string {
  if (record === undefined) return `${inputLabel}: no offset stored`
  const n = Math.abs(Math.round(record.offsetMs))
  if (n === 0) return `${inputLabel}: 0 ms offset stored`
  return `${inputLabel}: ${n} ms ${directionOf(record.offsetMs)} offset stored`
}
