/**
 * Pure helpers for the rudiment trainer (roadmap DR-10) — everything about
 * turning a `Rudiment` into a groove run and reading its verdicts that has no
 * business owning React state. `useRudimentTrainer.ts` is the only caller;
 * kept here, and tested with plain data, per this app's "behaviour lives in a
 * hook or pure helper" rule.
 *
 * ## Filling whole bars (`cyclesForBars`)
 *
 * `rudimentToScore` (`@core/drums/rudiment/score.ts`) will happily engrave any
 * cycle count, rounding the measure count up and leaving a silent tail — but
 * a silent tail is a bar the trainer would still count in and grade against,
 * which reads as a mistake, not a feature. This picks the smallest cycle
 * count that fills `bars` whole 4/4 bars exactly when the rudiment's own
 * `patternTicks` allows it, and otherwise the smallest cycle count that fills
 * SOME whole number of bars — never a fractional one. `barsOf` reports which,
 * so a caller can be honest with the learner when it is not the bar count
 * they asked for (see `useRudimentTrainer.ts` and the DR-10 delivery notes:
 * 8 of the 40 bundled rudiments cannot fill exactly 2 bars this way).
 */
import { at } from '@core/shared/invariant.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import type { Rudiment } from '@core/drums/rudiment/index.ts'
import type { TempoLadderState } from '@core/drums/rudiment/index.ts'
import { isEvenEnough } from '@core/drums/rudiment/index.ts'
import { DEFAULT_FAILS_TO_PLATEAU, DEFAULT_PASSES_TO_ADVANCE } from '@core/drums/rudiment/tempoLadder.ts'

/** One 4/4 bar at `TICKS_PER_QUARTER = 480`: 4 beats * 480. Mirrors `score.ts`'s own private constant — not exported there. */
const BAR_TICKS = 1920

/** `useRudimentTrainer.ts` never overrides `passesToAdvance`/`failsToPlateau`, so `tempoLadder.ts`'s own defaults are exactly what governs every ladder in this app. */
const PASSES_TO_ADVANCE = DEFAULT_PASSES_TO_ADVANCE
const FAILS_TO_PLATEAU = DEFAULT_FAILS_TO_PLATEAU

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) {
    const next = x % y
    x = y
    y = next
  }
  return x
}

/**
 * The smallest cycle count (>= 1) whose total ticks are a whole number of
 * 4/4 bars: exactly `bars` bars when `rudiment.patternTicks` divides that
 * span, otherwise the smallest span that lands on ANY bar line. See the
 * module comment and `barsOf`.
 */
export function cyclesForBars(rudiment: Rudiment, bars: number): number {
  const target = bars * BAR_TICKS
  if (target % rudiment.patternTicks === 0) return target / rudiment.patternTicks
  return BAR_TICKS / gcd(rudiment.patternTicks, BAR_TICKS)
}

/** How many whole 4/4 bars `cycles` repeats of `rudiment` actually span. Always a whole number — see `cyclesForBars`. */
export function barsOf(rudiment: Rudiment, cycles: number): number {
  return (cycles * rudiment.patternTicks) / BAR_TICKS
}

/** The rudiment's sticking as the learner reads it, e.g. `"R L R R L R L L"`. */
export function stickingPreview(rudiment: Rudiment): string {
  return rudiment.strokes.map((stroke) => stroke.sticking).join(' ')
}

/**
 * A run only counts as a clean pass when it was steady, no pad row missed or
 * added a hit, AND the strokes were even enough (roadmap DR-10's evenness
 * axis — see `@core/drums/rudiment/evenness.ts`). The engine's own steady
 * verdict is judged on spread and drift about each pad's mean, which a single
 * badly-placed stroke can still slip past if the rest of the run is tight
 * enough to keep the average inside budget; evenness catches exactly that
 * case by looking at the worst single gap instead.
 */
export function isCleanPass(result: GrooveRunResult, evenness: number): boolean {
  return (
    result.steady &&
    result.pads.every((pad) => pad.missed === 0 && pad.extra === 0) &&
    isEvenEnough(evenness)
  )
}

/** The evenness line for the result panel: the score as a percentage, then a plain verdict. */
export function evennessText(evenness: number): string {
  const pct = Math.round(evenness * 100)
  const verdict = isEvenEnough(evenness) ? 'even enough' : 'uneven: one gap was well off the rest'
  return `Evenness ${pct}% — ${verdict}`
}

/**
 * True when any stroke carries an `articulation` (flam/drag/buzz) — the
 * signal for the trainer's honesty line, since the grader only ever checks
 * onset timing (`@core/drums/practice/grade.ts`) and has no way to judge a
 * bounce's evenness or a grace note's quality.
 */
export function measuresOnly(rudiment: Rudiment): boolean {
  return rudiment.strokes.some((stroke) => stroke.articulation !== undefined)
}

function lastGradedBpm(state: TempoLadderState): number | undefined {
  return state.history[state.history.length - 1]?.bpm
}

/**
 * The ladder's status line. `state` alone does not carry `passesToAdvance`/
 * `failsToPlateau` (`ladderText(state)` per the DR-10 contract takes no
 * config), so this reads back the app-wide defaults documented above rather
 * than the ones on any particular `TempoLadderConfig` — flagged in the
 * delivery notes as the resolution of that gap.
 */
export function ladderText(state: TempoLadderState): string {
  if (state.done) {
    const bpm = lastGradedBpm(state) ?? state.bpm
    switch (state.reason) {
      case 'plateau':
        return `Plateau at ${bpm} bpm: ${FAILS_TO_PLATEAU} failed passes`
      case 'ceiling':
        return `Ceiling at ${bpm} bpm: top tempo held clean`
      case 'floor':
        return `Floor at ${bpm} bpm: cannot drop further`
      case 'completed':
        return `Completed the ladder back down to ${bpm} bpm`
      default:
        return `Ladder finished at ${bpm} bpm`
    }
  }

  if (state.history.length === 0) {
    return `Ready at ${state.bpm} bpm`
  }

  const last = at(state.history, state.history.length - 1)

  if (last.clean) {
    if (state.cleanStreak > 0) {
      // Still building the streak, same bpm as the pass just graded.
      return `Clean ${state.cleanStreak} of ${PASSES_TO_ADVANCE} at ${state.bpm} bpm`
    }
    // Streak just completed. A direction flip ('up-then-down' reaching the
    // ceiling without ending the ladder) leaves bpm exactly where it was; a
    // real step changes it.
    if (last.bpm === state.bpm) {
      return `Clean ${PASSES_TO_ADVANCE} of ${PASSES_TO_ADVANCE} at ${last.bpm} bpm — now stepping down`
    }
    return `Clean ${PASSES_TO_ADVANCE} of ${PASSES_TO_ADVANCE} at ${last.bpm} bpm — next ${state.bpm}`
  }

  // Last pass missed — recordPass always leaves failStreak >= 1 here.
  return `Missed ${state.failStreak} of ${FAILS_TO_PLATEAU} at ${last.bpm} bpm — next ${state.bpm}`
}
