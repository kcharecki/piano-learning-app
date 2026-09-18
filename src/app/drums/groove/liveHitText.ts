/**
 * The learner-facing sentence for one live hit verdict (roadmap DR-09
 * "per-hit live feedback"). Takes the bare `LiveHitVerdict` from
 * `@core/drums/practice/liveHit.ts` rather than the screen's own `LiveHit`
 * (which only adds a re-render `seq` on top) — this function has no use for
 * that seq, and importing the narrower core type keeps it callable from a
 * plain verdict in a test without constructing a whole hook result.
 */
import { GROOVE_PAD_LABEL } from './padLabels.ts'
import type { LiveHitVerdict } from '@core/drums/practice/liveHit.ts'

/**
 * e.g. "Snare on time, +3 ms" | "Snare early by 32 ms" | "Snare late by
 * 41 ms" | "Snare — nothing written there". Pad label from
 * `GROOVE_PAD_LABEL`; ms rounded to the nearest integer. The sign is shown
 * only in the on-time form, since that is the only form where the reader
 * cannot infer it from the word beside the number ("early"/"late" already
 * say which way).
 */
export function liveHitText(verdict: LiveHitVerdict): string {
  const label = GROOVE_PAD_LABEL[verdict.pad]
  if (verdict.kind === 'extra') return `${label} — nothing written there`

  const ms = Math.round(verdict.offsetMs ?? 0)
  if (verdict.kind === 'on-time') return `${label} on time, ${ms >= 0 ? '+' : ''}${ms} ms`
  if (verdict.kind === 'early') return `${label} early by ${Math.abs(ms)} ms`
  return `${label} late by ${Math.abs(ms)} ms`
}
