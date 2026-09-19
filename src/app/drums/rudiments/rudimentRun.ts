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
import type { PadDynamicsResult } from '@core/drums/practice/dynamics.ts'
import type { DynamicsClass } from '@core/drums/model/groove.ts'
import type { Rudiment } from '@core/drums/rudiment/index.ts'
import type { TempoLadderState } from '@core/drums/rudiment/index.ts'
import { isEvenEnough } from '@core/drums/rudiment/index.ts'
import { DEFAULT_FAILS_TO_PLATEAU, DEFAULT_PASSES_TO_ADVANCE } from '@core/drums/rudiment/tempoLadder.ts'
import { plural } from '@app/drums/groove/resultLines.ts'

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
 * added a hit, no pad's graded dynamics came out wrong (DR-10 accents — an
 * accented rudiment typed as plain keyboard taps is NOT clean; that is the
 * whole point of grading the accent), AND the strokes were even enough
 * (roadmap DR-10's evenness axis — see `@core/drums/rudiment/evenness.ts`).
 * The engine's own steady verdict is judged on spread and drift about each
 * pad's mean, which a single badly-placed stroke can still slip past if the
 * rest of the run is tight enough to keep the average inside budget;
 * evenness catches exactly that case by looking at the worst single gap
 * instead.
 *
 * Spec decision (DR-10 accents): `dynamics.wrong` only ever counts a GRADED
 * stroke on an accent/ghost instant played at the wrong velocity class
 * (`padDynamics`'s own contract) — an unclassified stroke (no velocity to
 * give, e.g. a mouse tap) never blocks a clean pass. A run with `graded ===
 * 0` — nothing to judge dynamics on — is therefore judged on timing and
 * evenness alone, exactly as it was before this slice.
 *
 * Spec decision (RED-1, over-accenting): a normal-expected instant played at
 * the ACCENT velocity class (`dynamics.loudNormals > 0`) ALSO fails a clean
 * pass here — unlike the groove trainer's own `isCleanPass`-equivalent
 * (DR-03), which deliberately never penalises touch on a plain groove
 * stroke. The two screens read the same field differently on purpose: a
 * groove's plain strokes are just "the rest of the pattern", but on a
 * rudiment the accent placement IS the whole exercise, so a Single
 * Paradiddle played with Shift held on every stroke is not a clean pass just
 * because every accent instant also happened to land loud.
 *
 * Spec decision (RED-A, round 3): the over-accenting gate above only makes
 * sense for a rudiment that notates an accent at all — `notatedAccents`,
 * the plan's own count (NOT re-derived here; the caller already has it from
 * `rudimentAccents`), gates it. 7 of the 40 bundled rudiments (e.g. Single
 * Stroke Roll) notate no accent, so every stroke is plain by definition and
 * touch is simply not graded — the same "nothing to judge dynamics on"
 * reasoning as the `graded === 0` case above, just keyed on the plan instead
 * of the result. Without this gate, an unaccented rudiment played with Shift
 * held throughout (or on an e-kit, loud) could never read "Clean pass" no
 * matter how steady and even it was, which is not a real mistake — there is
 * no accent to over-hit.
 */
export function isCleanPass(result: GrooveRunResult, evenness: number, notatedAccents: number): boolean {
  return (
    result.steady &&
    result.pads.every(
      (pad) =>
        pad.missed === 0 &&
        pad.extra === 0 &&
        pad.dynamics.wrong === 0 &&
        (notatedAccents === 0 || pad.dynamics.loudNormals === 0),
    ) &&
    isEvenEnough(evenness)
  )
}

/**
 * One rudiment's accent grading (DR-10 accents), read off the snare row's
 * own `PadDynamicsResult` and the plan's own notated accent count — never
 * re-derived here. Takes the fields a caller already has, not the
 * `GroovePadPlan`/`GroovePadResult` records they live on (the orphan-signals
 * lint rule): a rudiment is one pad, so the caller (`useRudimentTrainer.ts`)
 * is the one place holding both the plan's `expectedDynamics` and the
 * result's `dynamics` for that single row.
 */
export type RudimentAccentResult = {
  /** How many 'accent' instants the plan notates for this rudiment's own cycle count — NOT read off the raw `Rudiment.strokes`, since a multi-cycle run repeats them. */
  readonly notated: number
  /** Graded accent/ghost strokes on this row — see `PadDynamicsResult.graded`. A rudiment carries only accents (never ghosts), so every graded stroke here is an accent instant. */
  readonly graded: number
  /** Matched strokes on an accent instant that carried no velocity at all (a mouse tap) — see `PadDynamicsResult.unclassified`. */
  readonly unclassified: number
  /** Of `graded`, how many accents were played too soft — see `PadDynamicsResult.loudWanted`. */
  readonly missedAccents: number
  /**
   * Over-accenting (RED-1): matched strokes on a PLAIN (non-accent) instant
   * that carried a velocity — see `PadDynamicsResult.normalInstants`. A
   * rudiment's accent pattern IS the exercise, so a loud plain stroke is a
   * wrong stroke, not a free pass.
   */
  readonly normalInstants: number
  /** Of `normalInstants`, how many came out at the accent velocity class — see `PadDynamicsResult.loudNormals`. */
  readonly loudNormals: number
}

export function rudimentAccents(
  expectedDynamics: readonly DynamicsClass[],
  dynamics: Pick<PadDynamicsResult, 'graded' | 'unclassified' | 'loudWanted' | 'normalInstants' | 'loudNormals'>,
): RudimentAccentResult {
  const notated = expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'accent').length
  return {
    notated,
    graded: dynamics.graded,
    unclassified: dynamics.unclassified,
    missedAccents: dynamics.loudWanted,
    normalInstants: dynamics.normalInstants,
    loudNormals: dynamics.loudNormals,
  }
}

const NOT_GRADED_LITERAL =
  'Accents were not graded: the on-screen pad carries no velocity. Hold Shift on the keyboard for an accent, or use an e-kit.'

/**
 * The accent line for the result panel (DR-10 accents; RED-2/RED-3 round-2
 * review fix, RED-A/RED-B round-3 review fix) — `undefined` for an
 * unaccented rudiment (`notated === 0`, nothing to say) and for a run that
 * matched NOTHING at all on an accent instant, graded or otherwise loud
 * (`graded === 0 && unclassified === 0 && loudNormals === 0`; the pad line
 * above already covers a run that missed everything). Singular forms are
 * spelled out rather than routed through `plural` where they stand alone
 * (review note in the DR-10 accents brief): `plural(1, 'accent')` reads "1
 * accent", which makes "All 1 accent landed." — grammatically off in a way
 * the other counts in this file are not. `plural` is still used inline
 * within a longer sentence (e.g. "1 accent was missed"), where the singular
 * noun reads fine.
 *
 * RED-2 (hidden denominator, round 2): every count below is stated against
 * its own true denominator — `missedAccents` against `graded` (not
 * `notated`), a missed/unmatched count against `notated` explicitly named
 * as "missed" so a learner who struck 1 of 8 accents never reads "The
 * accent landed." as if that were the whole story.
 *
 * RED-3 (branch shadowing, round 2): HEAD picks exactly one framing, and
 * every other true fact about the run — missed accents, over-accented
 * plain strokes when HEAD was about soft accents, unclassified taps — is
 * appended as its own TAIL sentence instead of being silently dropped
 * because another condition matched first.
 *
 * RED-B (round 3): the round-2 fix still had a `graded === 0` early return
 * that dropped TAILS on the floor — a rudiment played entirely at accent
 * velocity on its plain strokes with every accent instant missed (or only
 * mouse-tapped) read as either `undefined` or the bare not-graded literal,
 * hiding the over-accenting entirely. HEAD now has two `graded === 0`
 * sub-cases instead of one early return (not-graded literal when there was
 * an unclassified tap to explain why nothing graded; no head at all — the
 * loud TAIL opens the sentence — when the only thing that happened was
 * over-accented plain strokes), and every TAIL below is evaluated
 * regardless of which HEAD fired, with one deliberate exception: the
 * unclassified TAIL is suppressed when HEAD is the not-graded literal,
 * since that sentence already says the on-screen pad carries no velocity —
 * restating "N on-screen taps carry no velocity" right after would be the
 * same fact twice (confirmed against the round-3 review's own R14/R19
 * fixtures: R14 is header-only, and R19 keeps its loud/missed TAILS but
 * drops the unclassified one that a literal reading of "TAILS apply
 * whenever their own count is > 0" would have kept — flagged as resolved
 * this way in the delivery notes since the two sources disagreed).
 *
 * RED-C (hidden denominator, round 4): `normalInstants` (`PadDynamicsResult`)
 * only ever counts plain instants that were STRUCK with a velocity — it is
 * not the notated plain total, the same gap RED-2 fixed on the accent side.
 * Both the loud HEAD and the sentence-start loud TAIL now say "the plain
 * stroke(s) you hit", mirroring the accent side's "of the N accents you
 * hit", so a learner who played half the pattern never reads "every plain
 * stroke came out as an accent" when most of the pattern was never struck
 * at all. The counted form ("N of the M plain strokes you hit...") already
 * named its own denominator and only gained the "you hit" wording; the
 * missed-accents TAIL ("N plain strokes came out as accents too.") is
 * unchanged since it already reads as additional strokes on top of an
 * already-stated HEAD, not a fresh denominator claim.
 */
export function accentLine(
  accents: Pick<
    RudimentAccentResult,
    'notated' | 'graded' | 'unclassified' | 'missedAccents' | 'normalInstants' | 'loudNormals'
  >,
): string | undefined {
  const { notated, graded, unclassified, missedAccents, normalInstants, loudNormals } = accents
  if (notated === 0) return undefined
  if (graded === 0 && unclassified === 0 && loudNormals === 0) return undefined

  // Accent instants that were matched by NEITHER a graded nor an
  // unclassified stroke — i.e. never struck at all. Cannot go negative in
  // practice: `graded + unclassified` counts matched accent instants only,
  // which can never exceed `notated`; clamped defensively rather than
  // asserted, so a future bookkeeping slip reads as "0 missed" instead of a
  // crash.
  const unmatchedRaw = notated - graded - unclassified
  const unmatched = unmatchedRaw < 0 ? 0 : unmatchedRaw

  const landedPhrase =
    graded === notated
      ? graded === 1
        ? 'The accent landed'
        : `All ${plural(graded, 'accent')} landed`
      : `${plural(graded, 'accent')} landed`

  // Which HEAD fired, tracked so the TAILS below know whether the loud fact
  // (and, for the not-graded literal, the unclassified fact) was already
  // said in the HEAD — see the RED-B doc above.
  let head: string
  let headIsNotGraded = false
  let headIsMissedAccents = false
  let headAlreadySaidLoud = false

  if (graded === 0 && unclassified > 0) {
    head = NOT_GRADED_LITERAL
    headIsNotGraded = true
  } else if (graded === 0) {
    // unclassified === 0 here, and the function has already returned above
    // unless loudNormals > 0 — so this run's only story is over-accented
    // plain strokes with nothing else to report. No head sentence; the loud
    // TAIL opens on its own, sentence-start capitalised.
    head = ''
  } else if (missedAccents > 0) {
    head =
      graded === 1
        ? 'The accent you hit came out soft. Lean into it.'
        : missedAccents === graded
          ? 'Every accent you hit came out soft. Lean into them.'
          : `${missedAccents} of the ${plural(graded, 'accent')} you hit came out soft. Lean into them.`
    headIsMissedAccents = true
  } else if (loudNormals > 0) {
    const loudPhrase =
      loudNormals === normalInstants
        ? normalInstants === 1
          ? 'the plain stroke you hit came out as an accent. Keep it soft.'
          : 'every plain stroke you hit came out as an accent. Keep them soft.'
        : `${loudNormals} of the ${plural(normalInstants, 'plain stroke')} you hit came out as ${loudNormals === 1 ? 'an accent. Keep it soft.' : 'accents. Keep them soft.'}`
    head = `${landedPhrase}, but ${loudPhrase}`
    headAlreadySaidLoud = true
  } else {
    head = `${landedPhrase}.`
  }

  const tails: string[] = []
  // The loud fact is a TAIL unless HEAD already said it (only the
  // `loudNormals > 0` HEAD above says it inline) — every other HEAD form
  // (not-graded, missed-accents, no-head, and the plain "landed." form,
  // which cannot coexist with `loudNormals > 0` since that HEAD would have
  // fired instead) leaves it to report here.
  if (loudNormals > 0 && !headAlreadySaidLoud) {
    if (headIsMissedAccents) {
      tails.push(`${plural(loudNormals, 'plain stroke')} came out as ${loudNormals === 1 ? 'an accent' : 'accents'} too.`)
    } else {
      // Sentence-start form: the not-graded HEAD (still needs its own new
      // fact stated) or no HEAD at all (this IS the first sentence).
      tails.push(
        loudNormals === normalInstants
          ? normalInstants === 1
            ? 'The plain stroke you hit came out as an accent. Keep it soft.'
            : 'Every plain stroke you hit came out as an accent. Keep them soft.'
          : `${plural(loudNormals, 'plain stroke')} came out as ${loudNormals === 1 ? 'an accent' : 'accents'}. Keep ${loudNormals === 1 ? 'it' : 'them'} soft.`,
      )
    }
  }
  if (unmatched > 0) {
    tails.push(`${plural(unmatched, 'accent')} ${unmatched === 1 ? 'was' : 'were'} missed.`)
  }
  // Suppressed under the not-graded HEAD — see the RED-B doc above.
  if (unclassified > 0 && !headIsNotGraded) {
    tails.push(`${unclassified} on-screen ${unclassified === 1 ? 'tap carries' : 'taps carry'} no velocity.`)
  }

  return [head, ...tails].filter((part) => part !== '').join(' ')
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
