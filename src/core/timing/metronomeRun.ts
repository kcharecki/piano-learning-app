/**
 * Pure musical-time arithmetic for the drums metronome's run loop (roadmap
 * DR-12, split out after an adversarial review of `useDrumsMetronome.ts`
 * found the scheduling and ramp-resolution math tangled up with React state,
 * a `Clock` and a `DrumAudioOutput`). Everything here is a pure function of
 * ticks, `TempoMark`s and plain numbers — no DOM, no React, no IO — so it is
 * testable (including property tests) without any of the hook's effectful
 * shell, and the hook becomes a thin caller of it.
 *
 * Nothing here duplicates `@core/timing/metronome.ts`, `clickFilters.ts` or
 * `tempo.ts` — it only composes them: bar-boundary tempo-ramp resolution,
 * the bar range a tick window crosses, the gap-click return-drift grading
 * window, and tick -> (bar, beat) decomposition.
 */
import type { TempoMark } from '@core/notation/score.ts'
import { tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { bpm as asBpm, millis, ticks, type Bpm, type Millis } from '@core/shared/units.ts'

// ------------------------------------------------------------------ ramp

/** The three ramp knobs the drums metronome dial exposes, bpm-direction-agnostic. */
export type RampConfig = {
  readonly stepBpm: number
  readonly everyBars: number
  readonly targetBpm: number
}

/** Smallest bar strictly after `bar` that is a positive multiple of `everyBars`. */
export function nextRampBarAfter(bar: number, everyBars: number): number {
  return Math.max(everyBars, (Math.floor(bar / everyBars) + 1) * everyBars)
}

/**
 * Append (or replace, on an equal tick) one mark and keep the rest as-is.
 *
 * Append only — never rewrite an earlier mark. Every click the hook has
 * already dispatched was timed off the map as it stood, and `msToTick`
 * turns real elapsed time back into ticks off the same map, so a mark that
 * re-times any tick at or before the scheduling edge shifts every future
 * click and jolts the readout (a first cut coalesced same-bar manual bpm
 * changes into one mark and did exactly that: a 40 → 240 drag inside one
 * bar moved the next click by ~100 ms). Manual calls are bounded by human
 * input, so the map growing one mark per call is not a leak.
 */
export function appendTempoMark(
  marks: readonly TempoMark[],
  tick: number,
  bpm: Bpm,
): readonly TempoMark[] {
  return [...marks.filter((m) => m.tick !== tick), { tick: ticks(tick), bpm }]
}

/** Move `current` one `stepBpm` closer to `target`, in whichever direction that is. */
function stepToward(current: number, stepBpm: number, target: number): number {
  if (target === current) return current
  return target > current
    ? Math.min(current + stepBpm, target)
    : Math.max(current - stepBpm, target)
}

export type RampStepResult = {
  readonly marks: readonly TempoMark[]
  readonly bpm: Bpm
  /** The next bar the ramp is due to check, to feed back as `cursorBar`. */
  readonly nextCursor: number
}

/**
 * One ramp-resolution step, pure: if `cursorBar` (the next bar the ramp is
 * due to fire on) is at or before `barHigh` (the last bar the current
 * scheduling window reaches), append one `TempoMark` at that bar's downbeat
 * tick and advance the cursor to the next due bar. Returns `undefined` once
 * nothing is due yet (`cursorBar > barHigh`), so a caller's `while` loop
 * condition is just "did this return something" — no Rng, Clock or React
 * state involved, so the hook's `flush` can call it repeatedly to resolve
 * several ramp steps that fall inside one look-ahead window.
 *
 * Steps *toward* `targetBpm` regardless of direction (see `stepToward`), so a
 * downward ramp (`targetBpm < currentBpm`) steps down by `stepBpm` each due
 * bar exactly like an upward one steps up — there is no separate "downward"
 * case to get wrong.
 */
export function resolveRampStep(
  marks: readonly TempoMark[],
  currentBpm: Bpm,
  ramp: RampConfig,
  cursorBar: number,
  barHigh: number,
  barTicks: number,
): RampStepResult | undefined {
  if (cursorBar > barHigh) return undefined
  const nextCursor = nextRampBarAfter(cursorBar, ramp.everyBars)
  const nextBpmRaw = stepToward(currentBpm, ramp.stepBpm, ramp.targetBpm)
  if (nextBpmRaw === currentBpm) return { marks, bpm: currentBpm, nextCursor }
  const nextBpm = asBpm(nextBpmRaw)
  return {
    marks: appendTempoMark(marks, cursorBar * barTicks, nextBpm),
    bpm: nextBpm,
    nextCursor,
  }
}

// ------------------------------------------------------------ bar crossings

export type BarRange = { readonly from: number; readonly to: number }

/**
 * The whole bars a tick window `(prevTick, newTick]` crosses into — i.e. the
 * bars whose downbeat lies in `(prevTick, newTick]` — as an inclusive
 * `[from, to]` range (`to < from` when the window crosses no bar boundary).
 */
export function barCrossingRange(prevTick: number, newTick: number, barTicks: number): BarRange {
  return { from: Math.floor(prevTick / barTicks) + 1, to: Math.floor(newTick / barTicks) }
}

export type BarBeat = { readonly bar: number; readonly beat: number }

/** Decompose a tick into its 0-based bar and 0-based beat-within-bar. */
export function tickToBarBeat(tick: number, barTicks: number, beatTicks: number): BarBeat {
  const bar = Math.floor(tick / barTicks)
  const beat = Math.floor((tick - bar * barTicks) / beatTicks)
  return { bar, beat }
}

// ------------------------------------------------------------ return window

/**
 * The gap-click return-drift grading window: half a beat, measured at
 * whatever tempo is in force across that bar's first beat (so a return bar
 * that lands mid-ramp still gets a window sized to its own tempo, not the
 * tempo the ramp is heading towards or coming from).
 */
export function returnWindowMs(
  map: TempoMap,
  bar: number,
  barTicks: number,
  beatTicks: number,
): Millis {
  const downbeat = tickToMs(map, ticks(bar * barTicks))
  const nextBeat = tickToMs(map, ticks(bar * barTicks + beatTicks))
  return millis((nextBeat - downbeat) / 2)
}

// ------------------------------------------------------------- validation

/**
 * The three UI-facing validators below are pure (no exceptions, a plain
 * message string on rejection) and parameterised by bounds rather than
 * hardcoding them, so `useDrumsMetronome.ts` keeps owning its own numeric
 * limits (`DRUMS_MIN_BPM` and friends) while the shape-checking logic lives
 * here, off the hook's own 500-line budget — the hook was the one thing
 * about to blow past it, not this arithmetic.
 */

export type GapBounds = { readonly minBars: number; readonly maxBars: number }

/** `GapClickSchedule`'s own shape, restated here to avoid importing `clickFilters.ts`'s type into a generic bounds check. */
export type GapLike = { readonly onBars: number; readonly offBars: number }

export function validateGapBars(g: GapLike, bounds: GapBounds): string | undefined {
  if (!Number.isInteger(g.onBars) || g.onBars < bounds.minBars || g.onBars > bounds.maxBars) {
    return `gap onBars must be an integer between ${bounds.minBars} and ${bounds.maxBars}, got ${g.onBars}`
  }
  if (
    g.offBars !== 0 &&
    (!Number.isInteger(g.offBars) || g.offBars < bounds.minBars || g.offBars > bounds.maxBars)
  ) {
    return (
      `gap offBars must be 0 (off) or an integer between ${bounds.minBars} and ` +
      `${bounds.maxBars}, got ${g.offBars}`
    )
  }
  return undefined
}

export type RampBounds = {
  readonly minStepBpm: number
  readonly maxStepBpm: number
  readonly minEveryBars: number
  readonly maxEveryBars: number
  readonly minBpm: number
  readonly maxBpm: number
}

export function validateRampConfig(r: RampConfig, bounds: RampBounds): string | undefined {
  if (
    !Number.isInteger(r.stepBpm) ||
    r.stepBpm < bounds.minStepBpm ||
    r.stepBpm > bounds.maxStepBpm
  ) {
    return (
      `ramp stepBpm must be an integer between ${bounds.minStepBpm} and ` +
      `${bounds.maxStepBpm}, got ${r.stepBpm}`
    )
  }
  if (
    !Number.isInteger(r.everyBars) ||
    r.everyBars < bounds.minEveryBars ||
    r.everyBars > bounds.maxEveryBars
  ) {
    return (
      `ramp everyBars must be an integer between ${bounds.minEveryBars} and ` +
      `${bounds.maxEveryBars}, got ${r.everyBars}`
    )
  }
  if (!Number.isFinite(r.targetBpm) || r.targetBpm < bounds.minBpm || r.targetBpm > bounds.maxBpm) {
    return `ramp targetBpm must be between ${bounds.minBpm} and ${bounds.maxBpm}, got ${r.targetBpm}`
  }
  return undefined
}

/** `ClickPlacement`'s own shape, restated to avoid importing `clickFilters.ts`'s type here. */
export type PlacementLike =
  | { readonly kind: 'all' }
  | { readonly kind: 'downbeat' }
  | { readonly kind: 'beats'; readonly beats: readonly number[] }
  | { readonly kind: 'every-n-bars'; readonly n: number }

export type PlacementBounds = {
  readonly beatsPerBar: number
  readonly minN: number
  readonly maxN: number
}

/**
 * An unvalidated placement can throw inside `placeClicks`, called from the
 * `rAF` frame callback — which would kill the transport loop silently. This
 * is the shape-check that stops a bad value ever reaching that call.
 */
export function validatePlacement(p: PlacementLike, bounds: PlacementBounds): string | undefined {
  if (p.kind === 'beats') {
    if (p.beats.length === 0) return 'placement beats must include at least one beat'
    for (const b of p.beats) {
      if (!Number.isInteger(b) || b < 0 || b >= bounds.beatsPerBar) {
        return `placement beat must be an integer between 0 and ${bounds.beatsPerBar - 1}, got ${b}`
      }
    }
  }
  if (
    p.kind === 'every-n-bars' &&
    (!Number.isInteger(p.n) || p.n < bounds.minN || p.n > bounds.maxN)
  ) {
    return `placement every-n-bars n must be an integer between ${bounds.minN} and ${bounds.maxN}, got ${p.n}`
  }
  return undefined
}
