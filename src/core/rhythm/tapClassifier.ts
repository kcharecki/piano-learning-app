/**
 * Real-time tap classification for the rhythm/clap-back drills (roadmap
 * U.3). `core/generator/rhythm.ts`'s `gradeTapping` and `core/rhythm/
 * clapback.ts`'s `gradeClapback` both grade a WHOLE run at once, after every
 * tap has already happened — exactly right for the end-of-run summary, but
 * useless for the thing this module exists for: telling the learner, the
 * instant they tap, whether that tap was early, late, or a hit, and doing it
 * safely when the learner presses Stop mid-pattern instead of waiting for
 * the run to finish on its own.
 *
 * ## FIFO matching, not global-nearest — a deliberate departure from the batch graders
 *
 * `gradeTapping`/`gradeClapback` (and `core/practice/matcher.ts`'s pitched
 * matcher) all attribute a press to whichever pending onset it is CLOSEST to,
 * because with the whole performance already in hand (or, for the pitched
 * matcher, a pitch to disambiguate with) that is the more accurate answer,
 * and worth the small risk of an out-of-order attribution in a genuinely
 * contested case (`clapback.test.ts`'s MAJOR-3 fixture).
 *
 * A live, single-tap-at-a-time classifier cannot afford that risk: it has to
 * commit to an answer immediately, with no lookahead, and — critically — it
 * must never let a later tap reach BACKWARD and claim an onset earlier than
 * one a previous tap already claimed. Global-nearest matching does not
 * guarantee that (two onsets with overlapping windows can legitimately have
 * their nearer candidate be the OTHER one), so this module uses a strict
 * FIFO cursor instead: every tap is tested only against the single oldest
 * still-open onset. If the tap falls in that onset's window, it is claimed,
 * the cursor advances past it, and the NEXT tap can never see it again. If
 * it does not, the tap is rejected outright (an "extra" tap) — it is never
 * offered to a later onset instead, which is what keeps the cursor
 * monotonic by construction, no bookkeeping required.
 *
 * This is the same trade the pitched `NoteMatcher` makes for missed notes
 * (`closeWindows`'s cursor only ever moves forward), generalised to matching
 * itself: for the well-separated onsets real generated patterns produce (see
 * `clapback.ts`'s own tolerance-vs-floor reasoning — the matching window is
 * always comfortably under half the level's shortest gap), FIFO and
 * global-nearest agree on every tap, which is exactly the "clean run" case
 * `classifyTap`'s consistency property below pins against `gradeTapping`.
 * They can only diverge when two onsets' windows genuinely overlap, and in
 * that narrow case FIFO is the one that can never violate ordering — the
 * property this module exists to guarantee for live feedback.
 *
 * ## Two windows, not one: `hit` vs `early`/`late`
 *
 * A tap inside `toleranceTicks` of the onset it claims is not automatically
 * a "perfect" hit — `core/practice/matcher.ts` already draws this same
 * distinction (`onTimeMs` inside `toleranceMs`) for the pitched drills, and
 * the same idea applies here: `hitWindowTicks` (always `<= toleranceTicks`)
 * is the tighter inner band that reads as a clean hit; anything claimed but
 * outside it is early or late, signed by `deltaTicks` (negative = before the
 * onset, positive = after — the same sign convention `matcher.ts`'s
 * `deviationMs` uses).
 *
 * ## Grading a prefix safely (roadmap U.3's "manual Stop")
 *
 * `snapshotGrade` never distinguishes HOW an onset came to be decided —
 * matched by a tap, or closed out as missed because its window elapsed —
 * from WHEN in the run that happened. It only ever counts onsets that have
 * actually been decided; anything still pending (its window has not closed
 * yet) is silently excluded, never counted as `missed`. That one property is
 * what makes a manual Stop safe: `closeExpiredOnsets(..., atTick, ...)`
 * closes out (as missed) only the onsets whose window had already elapsed by
 * `atTick` — the exact same expiry check `classifyTap` runs on every live tap
 * before it looks for a match. A future onset the run never reached is left
 * pending forever — `snapshotGrade` simply
 * never sees it — so stopping mid-pattern can never mark an unplayed onset
 * missed. Stopping at or after the last onset's own window has elapsed closes
 * everything there is to close, which is definitionally the same state the
 * run reaches on its own, so `snapshotGrade` afterward equals the ordinary
 * run-ended grade.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { ticks as asTicks, type Ticks } from '@core/shared/units.ts'

export type TapVerdict = 'hit' | 'early' | 'late'

/** One tap successfully attributed to an onset. */
export type TapClassification = {
  readonly verdict: TapVerdict
  readonly onsetIndex: number
  /** Signed: negative early, positive late — mirrors `matcher.ts`'s `deviationMs`. */
  readonly deltaTicks: number
}

export type TapClassifierOptions = {
  /** Half-width of the matching window: an onset outside this many ticks from
   *  a tap can never claim it. */
  readonly toleranceTicks: Ticks
  /** Half-width of the tighter 'hit' band inside `toleranceTicks`. Must be
   *  `<= toleranceTicks`. */
  readonly hitWindowTicks: Ticks
}

/**
 * Opaque, immutable — the FIFO cursor plus the running tallies `snapshotGrade`
 * needs. `lo` is the index of the oldest onset not yet decided (matched or
 * closed as missed); everything before it is permanently settled and never
 * revisited, which is what makes the cursor monotonic by construction.
 */
export type TapClassifierState = {
  readonly onsetCount: number
  readonly lo: number
  readonly matched: number
  readonly missed: number
  readonly extra: number
  readonly deviationSum: number
}

export type TapClassifierGrade = {
  readonly matched: number
  readonly missed: number
  readonly extra: number
  /** `matched / (matched + missed + extra)`; 1 when nothing has been decided yet. */
  readonly accuracy: number
  /** Mean |deltaTicks| over matched taps; 0 when nothing has matched. */
  readonly meanAbsDeviationTicks: number
}

/** Mirrors `core/practice/matcher.ts`'s `MATCHER_DEFAULTS` (onTimeMs:50 of
 *  toleranceMs:150 — a ~1/3 ratio) so every timing-graded drill in the app
 *  shares the same "how forgiving is exact" feel. */
export const DEFAULT_HIT_WINDOW_RATIO = 1 / 3

/** `toleranceTicks` scaled by `DEFAULT_HIT_WINDOW_RATIO` — a reasonable
 *  `hitWindowTicks` when the caller has no reason to pick a different one. */
export function defaultHitWindowTicks(toleranceTicks: Ticks): Ticks {
  invariant(
    Number.isFinite(toleranceTicks) && toleranceTicks >= 0,
    `defaultHitWindowTicks: toleranceTicks must be a finite number >= 0, got ${toleranceTicks}`,
  )
  return asTicks(toleranceTicks * DEFAULT_HIT_WINDOW_RATIO)
}

function validateOptions(opts: TapClassifierOptions): void {
  invariant(
    Number.isFinite(opts.toleranceTicks) && opts.toleranceTicks >= 0,
    `tapClassifier: toleranceTicks must be a finite number >= 0, got ${opts.toleranceTicks}`,
  )
  invariant(
    Number.isFinite(opts.hitWindowTicks) && opts.hitWindowTicks >= 0,
    `tapClassifier: hitWindowTicks must be a finite number >= 0, got ${opts.hitWindowTicks}`,
  )
  invariant(
    opts.hitWindowTicks <= opts.toleranceTicks,
    `tapClassifier: hitWindowTicks (${opts.hitWindowTicks}) must be <= toleranceTicks (${opts.toleranceTicks})`,
  )
}

function validateOnsetTicks(onsetTicks: readonly Ticks[], state: TapClassifierState): void {
  invariant(
    onsetTicks.length === state.onsetCount,
    `tapClassifier: onsetTicks.length (${onsetTicks.length}) does not match the state it was constructed with (${state.onsetCount})`,
  )
  for (let i = 1; i < onsetTicks.length; i++) {
    invariant(
      at(onsetTicks, i) >= at(onsetTicks, i - 1),
      'tapClassifier: onsetTicks must be sorted ascending',
    )
  }
}

/** A fresh cursor over `onsetCount` onsets, nothing decided yet. */
export function initTapClassifierState(onsetCount: number): TapClassifierState {
  invariant(
    Number.isInteger(onsetCount) && onsetCount >= 0,
    `initTapClassifierState: onsetCount must be a non-negative integer, got ${onsetCount}`,
  )
  return { onsetCount, lo: 0, matched: 0, missed: 0, extra: 0, deviationSum: 0 }
}

/**
 * Close out (as missed) every onset whose window has already elapsed as of
 * `atTick`, without matching a tap. Shared by `classifyTap` (called with the
 * tap's own tick, before it looks for a match — see the module doc) and by a
 * manual Stop (called with the tick the run was stopped at). This is the
 * manual-Stop primitive: call it with the tick the run was stopped at, then
 * read `snapshotGrade` — every onset still pending afterward (its window had
 * not yet elapsed) is simply excluded, never marked missed. Calling it again
 * with a later `atTick` (including well past the last onset) only ever
 * closes more, never un-closes anything, so it is safe to call repeatedly.
 */
export function closeExpiredOnsets(
  onsetTicks: readonly Ticks[],
  state: TapClassifierState,
  atTick: Ticks,
  opts: TapClassifierOptions,
): TapClassifierState {
  validateOptions(opts)
  validateOnsetTicks(onsetTicks, state)
  invariant(Number.isFinite(atTick), `closeExpiredOnsets: atTick must be a finite tick, got ${atTick}`)

  let lo = state.lo
  let missed = state.missed
  while (lo < onsetTicks.length) {
    const onset = at(onsetTicks, lo)
    if (onset + opts.toleranceTicks >= atTick) break
    missed += 1
    lo += 1
  }
  return lo === state.lo ? state : { ...state, lo, missed }
}

/**
 * Classify one live tap. First closes out any onset windows that have
 * already elapsed as of `tapTick` (see `closeExpiredOnsets`) — this is what
 * stops a late tap from reaching back and claiming an onset it has already
 * passed. Then, if the (now oldest-pending) onset's window contains
 * `tapTick`, the tap claims it: the cursor advances past it, so no later tap
 * can ever claim it again (each onset consumable once, and never out of
 * order — see the module doc). Otherwise the tap matches nothing and is
 * rejected outright (an "extra" tap) — never offered to a different onset.
 */
export function classifyTap(
  onsetTicks: readonly Ticks[],
  state: TapClassifierState,
  tapTick: Ticks,
  opts: TapClassifierOptions,
): { readonly classification: TapClassification | undefined; readonly state: TapClassifierState } {
  validateOptions(opts)
  validateOnsetTicks(onsetTicks, state)
  invariant(Number.isFinite(tapTick), `classifyTap: tapTick must be a finite tick, got ${tapTick}`)

  const expired = closeExpiredOnsets(onsetTicks, state, tapTick, opts)

  if (expired.lo < onsetTicks.length) {
    const onset = at(onsetTicks, expired.lo)
    const deltaTicks = tapTick - onset
    if (Math.abs(deltaTicks) <= opts.toleranceTicks) {
      const verdict: TapVerdict =
        Math.abs(deltaTicks) <= opts.hitWindowTicks ? 'hit' : deltaTicks < 0 ? 'early' : 'late'
      const classification: TapClassification = { verdict, onsetIndex: expired.lo, deltaTicks }
      return {
        classification,
        state: {
          ...expired,
          lo: expired.lo + 1,
          matched: expired.matched + 1,
          deviationSum: expired.deviationSum + Math.abs(deltaTicks),
        },
      }
    }
  }

  return { classification: undefined, state: { ...expired, extra: expired.extra + 1 } }
}

/** Everything decided so far — matched or closed-out-missed — as one grade.
 *  Onsets still pending (window not yet elapsed) are excluded entirely; see
 *  the module doc's "Grading a prefix safely" section. */
export function snapshotGrade(state: TapClassifierState): TapClassifierGrade {
  const total = state.matched + state.missed + state.extra
  return {
    matched: state.matched,
    missed: state.missed,
    extra: state.extra,
    accuracy: total === 0 ? 1 : state.matched / total,
    meanAbsDeviationTicks: state.matched === 0 ? 0 : state.deviationSum / state.matched,
  }
}
