/**
 * Pure formatting helpers for `DrumsProgressScreen` (roadmap DR-23 "drums
 * progress MVP") — turning a `TierCompletion`/`GrooveBest`/`LimbBias` row, or
 * the reading trainer's level and recent accuracies, into the one line of
 * text the screen renders for it. No JSX, no store reads: the screen owns
 * wiring, this module owns wording, same split `DrumsTodayScreen.tsx`'s own
 * `useGrooveStatus`/`useReadingStatus`/`useRudimentsStatus` helpers draw,
 * except those are hooks reading stores and these are plain functions over
 * already-read values, so they can live and be tested without React.
 */
import { GROOVE_PAD_LABEL } from '@app/drums/groove/padLabels.ts'
import type { GrooveBest, LimbBias, TierCompletion } from '@core/drums/progress/index.ts'

/** "Tier 1: 3 of 8 at target, 5 started" */
export function tierLine(t: TierCompletion): string {
  return `Tier ${t.tier}: ${t.atTarget} of ${t.total} at target, ${t.started} started`
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** "Money Beat — best steady 96 bpm (4 attempts)" | "Money Beat — no steady run yet (2 attempts)" */
export function bestLine(b: GrooveBest): string {
  const attemptsText = `(${pluralize(b.attempts, 'attempt')})`
  return b.bestSteadyBpm === undefined
    ? `${b.grooveTitle} — no steady run yet ${attemptsText}`
    : `${b.grooveTitle} — best steady ${b.bestSteadyBpm} bpm ${attemptsText}`
}

/** Below this magnitude a limb reads as "on time" rather than early/late. */
const ON_TIME_THRESHOLD_MS = 3

/** "Kick: 12 ms late (24 hits)" | "Snare: 8 ms early (16 hits)" | "Hi-hat: on time (30 hits)" */
export function biasLine(b: LimbBias): string {
  const label = GROOVE_PAD_LABEL[b.pad]
  const hitsText = `(${pluralize(b.samples, 'hit')})`
  if (Math.abs(b.meanMs) < ON_TIME_THRESHOLD_MS) return `${label}: on time ${hitsText}`
  const rounded = Math.round(b.meanMs)
  return rounded > 0
    ? `${label}: ${rounded} ms late ${hitsText}`
    : `${label}: ${Math.abs(rounded)} ms early ${hitsText}`
}

/**
 * "Level 3 — last runs 80%, 90%, 100%" | "Level 1 — no runs yet"
 *
 * `accuracies` are 0..1 fractions, already selected and ordered by the
 * caller (see `DrumsProgressScreen.tsx`'s module comment on `runs` being
 * newest-first) — this only formats whatever it is given, in that order.
 */
export function readingLine(level: number, accuracies: readonly number[]): string {
  if (accuracies.length === 0) return `Level ${level} — no runs yet`
  const runsText = accuracies.map((a) => `${Math.round(a * 100)}%`).join(', ')
  return `Level ${level} — last runs ${runsText}`
}
