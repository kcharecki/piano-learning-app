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
import type {
  GrooveBest,
  GrooveCoverage,
  GrooveTrend,
  LimbBias,
  RudimentCoverage,
  TierCompletion,
} from '@core/drums/progress/index.ts'

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

const TREND_DIRECTION_WORD: Record<GrooveTrend['direction'], string> = {
  tightening: 'tightening',
  loosening: 'loosening',
  flat: 'flat',
  unknown: 'too few runs',
}

/**
 * "Money Beat — worst limb 15, 15, 15 ms · too few runs · steady 2 of 3" |
 * "Money Beat — no timing data yet · steady 0 of 3" (no point has an offset)
 */
export function trendLine(t: GrooveTrend): string {
  const steadyText = `steady ${t.steadyCount} of ${t.points.length}`
  const hasAnyOffset = t.points.some((p) => p.worstAbsOffsetMs !== undefined)
  if (!hasAnyOffset) return `${t.grooveTitle} — no timing data yet · ${steadyText}`

  const offsets = t.points.map((p) => (p.worstAbsOffsetMs === undefined ? '–' : `${p.worstAbsOffsetMs}`)).join(', ')
  const directionWord = TREND_DIRECTION_WORD[t.direction]
  return `${t.grooveTitle} — worst limb ${offsets} ms · ${directionWord} · ${steadyText}`
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

/**
 * "Grooves: 1 of 3 played, 0 steady. Not yet played: Quarter-Note Rock, Money
 * Beat (Open Hat)." — names `neverPlayed` when there is any; only once every
 * library groove has been played at least once does the sentence instead
 * name `playedNotSteady` ("Not yet steady: ..."); with nothing left in
 * either list the sentence ends after the counts.
 */
export function grooveCoverageLine(c: GrooveCoverage): string {
  const counts = `Grooves: ${c.played} of ${c.total} played, ${c.steady} steady.`
  if (c.neverPlayed.length > 0) {
    return `${counts} Not yet played: ${c.neverPlayed.map((g) => g.title).join(', ')}.`
  }
  if (c.playedNotSteady.length > 0) {
    return `${counts} Not yet steady: ${c.playedNotSteady.map((g) => g.title).join(', ')}.`
  }
  return counts
}

/**
 * "Rudiments: 2 of 40 started. Next up: Double Stroke Open Roll, Five Stroke
 * Roll, Single Paradiddle." | "Rudiments: 40 of 40 started." once `nextUp`
 * is empty.
 */
export function rudimentCoverageLine(c: RudimentCoverage): string {
  const counts = `Rudiments: ${c.started} of ${c.total} started.`
  if (c.nextUp.length === 0) return counts
  return `${counts} Next up: ${c.nextUp.map((r) => r.title).join(', ')}.`
}
