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
 * itself. FIFO and global-nearest are GUARANTEED to agree on every tap only
 * when no two onsets' matching windows can overlap, i.e. `2 * toleranceTicks`
 * is strictly less than the shortest gap between successive onsets. That is
 * NOT automatically true of a config-supplied tolerance: `core/generator/
 * rhythm.ts`'s minimum onset gap shrinks as complexity rises (480 ticks at
 * complexity 1-2, 240 at 3-4, 120 at 5 — `MIN_DURATION_BY_COMPLEXITY`), while
 * a tolerance sized once for the loosest case does not shrink to match, so at
 * complexity >= 3 an ungoverned tolerance can legitimately exceed half the
 * level's own floor — a real, measured divergence (FIFO calls a tap 'late'
 * against onset N while `gradeTapping`'s global-nearest hands the SAME tap to
 * onset N+1 instead), not merely a theoretical one.
 *
 * `effectiveToleranceTicks` (below) is what actually closes that gap: every
 * caller derives ONE tolerance per run — `min(configToleranceTicks,
 * floor((minSuccessiveGap - 1) / 2))` over that run's own onset grid — and
 * passes that SAME clamped value both to this live classifier and to
 * `gradeTapping`/`gradeClapback`'s own tolerance parameter. With
 * `2 * toleranceTicks < minSuccessiveGap` enforced this way, no two onsets'
 * windows can ever overlap, so FIFO and global-nearest are provably identical
 * on every input — the property `classifyTap`'s consistency test below pins
 * against `gradeTapping`, for every tap sequence, not only the well-separated
 * common case.
 *
 * That proof is about MATCHING WINDOWS, not about which onset TICKS the two
 * matchers compare a tap against — it holds unconditionally for
 * `gradeTapping` (the sight-tap drill), which always matches against the
 * pattern's own raw onset grid, exactly like this live classifier does. It
 * does NOT extend to `gradeClapback` (the clap-back drill) once it fits a
 * non-1 tempo scale (`fitTempoScale`): a tempo-fitted batch grade matches
 * taps against a SCALED onset grid, while this live classifier always
 * matches against the raw one, so the two can legitimately disagree on the
 * same run (measured: live 43% vs. a tempo-fitted batch grade of 100% at
 * `tempoScale` 1.1199). That divergence is real, known, and accepted for
 * clap-back — the live per-tap verdict is a rehearsal-time hint, not a
 * promise the end-of-run summary will match it; only `gradeTapping`/the
 * sight-tap drill gets the "never disagree" guarantee.
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
 * closes out (as missed) exactly the onsets for which `onsetTick +
 * toleranceTicks < atTick` — strictly less than, so a tap arriving exactly
 * on that boundary tick is still claimable, not already expired — the exact
 * same expiry check `classifyTap` runs on every live tap before it looks for
 * a match. A future onset the run never reached is left pending forever —
 * `snapshotGrade` simply never sees it — so stopping mid-pattern can never
 * mark an unplayed onset missed. Stopping once every onset satisfies that
 * same strict inequality closes everything there is to close, which is
 * definitionally the same state the run reaches on its own.
 *
 * Roadmap U.3 fix round: a caller grading a manual Stop no longer reads that
 * final grade off `snapshotGrade` — it reads `TapClassifierState.lo` (the
 * count of DECIDED onsets: matched + missed, always equal by construction —
 * see `TapClassifierState`'s own doc) after calling `closeExpiredOnsets`, and
 * uses that to slice the pattern's own onsets down to the decided prefix
 * before handing it to `gradeTapping`/`gradeClapback` — the same batch grader
 * a natural finish uses, just over a restricted input, rather than a second,
 * differently-shaped grade this module would compute itself. `lo === 0` (a
 * Stop before anything was decided) is the caller's signal to record no grade
 * at all, rather than a technically-truthful-but-meaningless "0 of 0"
 * summary.
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
  /** `matched / (matched + missed + extra)`; 0 (not a perfect score — nothing
   *  has been earned) when nothing has been decided yet. Roadmap U.3 fix
   *  round: this used to default to 1, which is what let a manual Stop at
   *  tick 0 (nothing tapped, nothing decided) read as a 100% run. */
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

/**
 * The tolerance actually safe to use against `onsetTicks` — clamped so this
 * module's FIFO matching and the batch graders' (`gradeTapping`/
 * `gradeClapback`) global-nearest matching are PROVABLY identical on every
 * input; see the module doc's "FIFO matching" section for why an
 * un-clamped tolerance cannot promise that at higher complexities/levels.
 * `configToleranceTicks` is the tolerance the caller would reach for if onset
 * spacing were no concern (`TAPPING_DEFAULTS`-derived, or a clap-back level's
 * own `toleranceTicksForLevel`); this clamps it down only as far as the run's
 * OWN onsets actually require, never further.
 *
 * Two onsets' windows can only overlap when `2 * toleranceTicks` reaches the
 * gap between them, so half the shortest gap between successive onsets —
 * minus one, floored, so a tap sitting exactly halfway between two onsets is
 * never simultaneously inside both windows — is the largest tolerance that
 * can never let that happen. Fewer than two onsets means there is no gap to
 * protect, so the caller's own tolerance passes through unchanged.
 */
export function effectiveToleranceTicks(
  onsetTicks: readonly Ticks[],
  configToleranceTicks: Ticks,
): Ticks {
  invariant(
    Number.isFinite(configToleranceTicks) && configToleranceTicks >= 0,
    `effectiveToleranceTicks: configToleranceTicks must be a finite number >= 0, got ${configToleranceTicks}`,
  )
  if (onsetTicks.length < 2) return configToleranceTicks

  let minGap = Number.POSITIVE_INFINITY
  for (let i = 1; i < onsetTicks.length; i++) {
    const gap = at(onsetTicks, i) - at(onsetTicks, i - 1)
    invariant(gap >= 0, 'effectiveToleranceTicks: onsetTicks must be sorted ascending')
    if (gap < minGap) minGap = gap
  }
  const cap = Math.floor((minGap - 1) / 2)
  return asTicks(Math.max(0, Math.min(configToleranceTicks, cap)))
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
 * Close out (as missed) every onset for which `onsetTick + toleranceTicks <
 * atTick` (strict), without matching a tap. Shared by `classifyTap` (called
 * with the tap's own tick, before it looks for a match — see the module doc)
 * and by a manual Stop (called with the tick the run was stopped at). This
 * is the manual-Stop primitive: call it with the tick the run was stopped at, then
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

/**
 * Everything decided so far — matched or closed-out-missed — as one grade.
 * Onsets still pending (window not yet elapsed) are excluded entirely; see
 * the module doc's "Grading a prefix safely" section.
 *
 * Roadmap U.3 fix round: this is now LIVE-HUD-ONLY — never the source of a
 * run summary on any path (natural finish or manual Stop both grade with the
 * SAME batch grader the other uses, `gradeTapping`/`gradeClapback`, over
 * whichever onsets/taps are in scope; see `app/rhythm/useRhythmDrill.ts`'s
 * and `useClapbackDrill.ts`'s own `stopRun` comments). `accuracy` is 0, not
 * 1, when nothing has been decided (`total === 0`) — a caller that DID once
 * treat this as a run summary (a manual Stop before anything was graded) used
 * to read that as a perfect 100% run; nothing decided is not a perfect score.
 */
export function snapshotGrade(state: TapClassifierState): TapClassifierGrade {
  const total = state.matched + state.missed + state.extra
  return {
    matched: state.matched,
    missed: state.missed,
    extra: state.extra,
    accuracy: total === 0 ? 0 : state.matched / total,
    meanAbsDeviationTicks: state.matched === 0 ? 0 : state.deviationSum / state.matched,
  }
}
