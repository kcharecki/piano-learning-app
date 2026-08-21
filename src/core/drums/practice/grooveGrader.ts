/**
 * The groove grader (DR-07's drum-side counterpart to `core/practice/matcher.ts`) —
 * turns a `GrooveScore` plus a recorded set of live hits into a per-pad verdict.
 *
 * ## Why per-pad, not one timeline
 *
 * The obvious-looking shortcut is to flatten every expected onset and every hit
 * into one list of timestamps and match them time-only, ignoring which pad each
 * one landed on. That shortcut is wrong for exactly the case this module exists
 * to catch: a learner who swaps snare and kick — playing the kick part on the
 * snare pad and vice versa — produces the *identical multiset of onset times* as
 * a correct performance. A time-only grader would call that clean. Grading each
 * pad's expected onsets against only that pad's hits is the whole point: a
 * hi-hat hit can never satisfy a snare note, so a limb swap shows up as one pad
 * entirely missed and another entirely extra, which is the actionable feedback
 * ("your kick and snare are swapped") a drummer needs. `grooveGrader.test.ts`'s
 * limb-swap case is this reasoning made executable.
 *
 * ## Why milliseconds, not ticks
 *
 * Same reasoning as `matcher.ts`: expected onsets are converted to milliseconds
 * once, up front, via a fixed tempo (grooves are graded at one bpm per pass, no
 * mid-groove tempo ramp), and live hits arrive in milliseconds off the input
 * adapter. Ticks never re-enter once this conversion happens — with one
 * deliberate exception, `PadResult.gridTicks`, which is converted back so a
 * caller can *name* a pad's grid ("one sixteenth") instead of quoting 187.5 ms
 * at a learner.
 *
 * ## Why greedy nearest-offset matching, not an optimal assignment
 *
 * Within one pad, a hit could in principle be closer to one expected onset while
 * "stealing" it from a hit that has no other candidate, in which case a globally
 * optimal (e.g. Hungarian-algorithm) assignment could occasionally do better by
 * total error. That optimality is not worth the opacity: a learner reading their
 * results needs to see "the pair with the smallest offset wins first, then the
 * next smallest, etc." and know why a given hit did or didn't count — the same
 * trade-off `matcher.ts` already made (nearest-first, not globally optimal) for
 * the piano side. Sorting every candidate pair by |offset| (then expected time,
 * then hit time, both purely to make the walk deterministic when offsets tie)
 * and walking it greedily is that rule made precise.
 *
 * ## The swing invariant
 *
 * `grooveOnsetsMs` refuses any score whose `swingPercent` is not 50. This is
 * load-bearing, not a defensive nicety: `GrooveScore.swingPercent` is
 * performance metadata that is deliberately NOT baked into `notes[].tick` (see
 * that field's own doc comment on `GrooveScore`) — notation is written straight
 * and a swing directive tells a *reader* how to feel it. Grading a swung groove
 * against its notated (straight) ticks would silently mark a correctly-swung
 * "and" of the beat as late, every time, for every swung groove — punishing the
 * exact performance the notation asked for. There is no correct guess this
 * module could make about how far to swing a note it wasn't told the swung
 * position of, so it refuses instead of guessing. Grading swung grooves is
 * future work for whoever teaches `./grid.ts`'s swung-playback maths to this
 * module; until then, refusing is honest and guessing is not.
 *
 * ## Why the verdict is judged on spread and never on the mean
 *
 * The first version of this module reported one number per pad — the signed
 * mean of (hit - expected) — and certified a run on counts alone. Both halves
 * were wrong in the same way: they threw away the difference between a learner
 * who is consistently *displaced* and a learner who is *uneven*. Hi-hat hits
 * alternating 80 ms early and 80 ms late average to a mean of zero, so a run
 * that lurched a fifth of a second either side of the click read as perfectly
 * placed; and a run in which every single hit sat 95 ms behind the beat still
 * matched every note, so it read as a clean run.
 *
 * Bias and spread are two different measurements and they want opposite
 * advice. A learner uniformly 45 ms late needs "you are behind the click"; a
 * learner scattered +/-45 ms needs "your pulse is uneven", and telling that
 * second learner they are late is useless, because on average they are not.
 * The tie-breaker is the machine: audio output latency plus e-kit input
 * latency adds the *same constant* to every hit that ever reaches this module.
 * A constant moves the mean and cannot touch the spread. So the mean is not a
 * quantity this module is entitled to fail anyone on — it may be measuring the
 * sound card. `spreadMs`, the largest departure from that pad's own mean, is,
 * because no constant can change it. Hence `steady`: something matched, and
 * the spread is within that pad's bar, never consulting the mean. The mean is
 * still reported as a fact, for `attempt.ts` to disclose with the latency
 * caveat attached.
 *
 * The rejected alternative was to subtract a calibrated latency estimate from
 * every offset and judge the corrected mean. That needs a calibration step
 * this app does not have, and the corrected mean would still be a guess;
 * measuring the one quantity latency cannot touch needs no calibration at all.
 *
 * ## Why the DIFFERENCE between two pads' means is fair game, though the mean is not
 *
 * That argument has a consequence this module missed for a while, and the miss
 * certified the most audible fault a beginner drummer has. Driven at 80 bpm on
 * Money Beat with hi-hat and snare exact and the kick uniformly 60-70 ms
 * behind, the screen said `Steady run`: every pad matched every note and every
 * pad's own spread was a few milliseconds, so nothing this module measured
 * objected. But the kick landed 61 ms after the hi-hat on every beat 1 and 3,
 * where the notation puts them in unison. That is a flam, and it is the
 * loudest thing in the room.
 *
 * The fix falls straight out of the latency argument above rather than
 * fighting it. Latency adds the same constant to EVERY hit on every pad, so it
 * cancels exactly in the difference between two pads' means — one machine
 * cannot add 5 ms to the hands and 71 ms to the foot. That difference is
 * therefore precisely as latency-free as `spreadMs` is, needs no calibration,
 * and is a quantity we may fail someone on. `padAlignmentMs` is the largest
 * such difference across the pads that matched anything, and `PAD_ALIGNMENT_MS`
 * bounds it. `laggingPad`/`leadingPad` name the pair that produced it, so the
 * screen can say which limb is behind which instead of just "unaligned". The
 * property test "a constant delay on every pad moves every mean and moves
 * nothing else" is this paragraph made executable.
 *
 * ## Why every pad gets its OWN window
 *
 * `DEFAULT_GROOVE_TOLERANCE_MS` is a flat 100 ms, and a flat window becomes a
 * bug the moment the grid is finer than it. At 80 bpm consecutive sixteenths
 * are 187.5 ms apart, so a +/-100 ms window is wider than half that gap: one
 * hit can sit within tolerance of two different notes on its own pad, and
 * Ghost Funk Bar played a whole sixteenth late matched the *next* note every
 * time and graded as very nearly perfect. The window is therefore derived from
 * the score rather than from a constant — no wider than
 * `TOLERANCE_GAP_FRACTION` of the smallest gap that pad asks for, which keeps
 * twice the window under one gap and makes that two-note ambiguity
 * arithmetically impossible instead of merely unlikely.
 *
 * Gaps are measured per pad, never across the whole groove. Kick and hi-hat
 * both land on beat 1, so the smallest *global* gap is zero and a global rule
 * would collapse the window to nothing on every real groove ever written. A
 * hit is only ever matched against its own pad's onsets (see above), so its
 * own pad's spacing is the only spacing that can confuse it.
 *
 * The version before this one wrote that paragraph and then did the opposite:
 * it measured gaps per pad, took the MINIMUM across pads, and applied that one
 * number to every pad. On Ghost Funk Bar at 80 bpm the hi-hat's sixteenths
 * squeezed the kick's window from the 225 ms its own spacing admits down to
 * 75 ms, so a kick played 120 ms late — every hit, in the right place, a sixth
 * of a beat behind — read `Kick — 0 of 8, 8 missed, 8 extra`: the learner
 * played all eight and was told they played none, plus eight notes that are
 * not in the groove. `groovePadTolerancesMs` is that paragraph made true, one
 * window per pad from that pad's own spacing, and `PadResult.toleranceMs`
 * reports which window a row was actually held to.
 *
 * `grooveToleranceMs` survives as the one number the screen prints, and it is
 * now the TIGHTEST of the per-pad windows — the strictest any pad is held to.
 * Printing the loosest would flatter the run; printing the tightest is the
 * honest summary of "how close you had to be".
 *
 * ## Why a displaced line is caught by re-matching, not by a narrower window
 *
 * Driven at 80 bpm on Ghost Funk Bar with the entire hi-hat line displaced by
 * exactly one sixteenth, the row read `31 of 32, 1 missed, 1 extra, 11 ms
 * late`. The learner never once played a note where it was written and was
 * told they were 11 ms late. No window can fix that and narrowing one makes it
 * worse: each hit lands exactly ON the next notated onset, so its offset to
 * that onset is zero, dead centre of any window however tight. The only trace
 * the displacement leaves is the one miss and one extra at the ends of the
 * run, and a beginner reading "31 of 32" will not find it.
 *
 * So the displacement is detected as itself rather than inferred from offsets.
 * Per pad, the same matching is re-run against that pad's expected times
 * shifted by +/-1 and +/-2 of its own grid units, and if some shift fits
 * STRICTLY more hits than the unshifted grading does, the pad is displaced and
 * `phaseSlipSteps` says by how far. Strictly, because on a uniform line an
 * off-by-one hypothesis always fits nearly as well as the truth — shift a
 * 16-hit line by one grid unit and 15 of the 16 shifted positions still land
 * on real onsets — so anything less than a strict improvement would let a
 * correct run be reported as a slip. Ties and near-ties therefore go to "no
 * slip", and among winning shifts the smallest |k| is preferred.
 *
 * Sign convention: shifting the EXPECTED times later by one grid unit and
 * finding a better fit means the learner's hits sit where the later notes are,
 * i.e. the learner played LATE. `phaseSlipSteps === +1` is one grid unit late,
 * `-1` is one grid unit early.
 *
 * ## Why the steadiness bar bends with the grid
 *
 * `STEADY_SPREAD_MS` on its own is tempo-blind, and a tempo-blind bar inverts:
 * the derived window shrinks as the tempo rises while the flat 35 ms bar does
 * not, so the test gets EASIER the faster the learner plays. Driving every hit
 * to the edge of the window on Ghost Funk Bar produced `Every note, but the
 * pulse is uneven` at 160 bpm and `Steady run` at 172, 180 and 200 bpm — a
 * hi-hat wandering across a 58 ms band on a 75 ms sixteenth grid, called
 * steady. Above ~171 bpm on that groove the steadiness test could not be
 * failed at all.
 *
 * A pad's bar is therefore the tightest of three: the flat `STEADY_SPREAD_MS`,
 * `STEADY_SPREAD_FRACTION` of that pad's own grid spacing, and that pad's own
 * window. The fraction is what makes the bar tighten with the grid instead of
 * loosening; the window bound keeps the bar from ever exceeding the distance a
 * hit was allowed to be away in the first place. `PadResult.steadyBarMs`
 * reports the number a row was actually judged against, because a bar the
 * learner cannot see is a bar they cannot aim at.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import { padOrderIndex, type DrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'

export const DEFAULT_GROOVE_TOLERANCE_MS = 100

/** A hit may be no further from its note than this fraction of the gap to the neighbouring note on the same pad. */
export const TOLERANCE_GAP_FRACTION = 0.4

/** The largest departure-from-own-mean, in ms, that still counts as an even pulse. */
export const STEADY_SPREAD_MS = 35

/**
 * A pad's steadiness bar is also bounded by this fraction of its own grid
 * spacing, so the bar tightens with the grid instead of getting looser as the
 * tempo rises. 0.15 puts the crossover at a 233 ms subdivision: coarser than
 * that (Money Beat's 375 ms eighths at 80 bpm) the flat `STEADY_SPREAD_MS`
 * still governs, and finer than that (Ghost Funk Bar's 187.5 ms sixteenths at
 * 80 bpm, giving a 28 ms bar) the fraction takes over — which is exactly where
 * a flat bar stops meaning anything musically.
 */
export const STEADY_SPREAD_FRACTION = 0.15

/**
 * The largest difference between two pads' mean offsets that still counts as
 * aligned. Latency cancels in this difference, so unlike the mean it is a
 * quantity we may fail someone on. 30 rather than something tighter because
 * the e2e driver's own dispatch drift has been measured as high as 17 ms and
 * must not read as a flam.
 */
export const PAD_ALIGNMENT_MS = 30

export type GrooveOnset = { readonly pad: MappedDrumPad; readonly atMs: number }

const msPerTickAt = (bpm: number): number => 60_000 / (bpm * TICKS_PER_QUARTER)

/**
 * Every onset the learner is expected to play, in milliseconds from the moment
 * the graded window opened, for `repeats` consecutive passes of the whole
 * score. `atMs` is measured from the start of pass 0 — pass *n* (0-based) adds
 * `n * loopTicks * msPerTick`, where `loopTicks` is the sum of the score's
 * measure durations (i.e. the length of one full lap of the notated pattern),
 * not the position of any individual note within it.
 */
export function grooveOnsetsMs(
  score: GrooveScore,
  bpm: number,
  repeats: number,
): readonly GrooveOnset[] {
  invariant(Number.isFinite(bpm) && bpm > 0, `bpm must be a finite number > 0, got ${bpm}`)
  invariant(
    Number.isInteger(repeats) && repeats >= 1,
    `repeats must be an integer >= 1, got ${repeats}`,
  )
  invariant(
    score.swingPercent === 50,
    `grooveOnsetsMs cannot grade a swung score (swingPercent ${score.swingPercent}) — ` +
      'swingPercent is performance metadata deliberately not baked into notes[].tick ' +
      '(see GrooveScore\'s doc comment), so grading off notated ticks would silently mark a ' +
      'correctly-swung performance as late; refusing is honest, guessing the swing is not.',
  )

  const msPerTick = msPerTickAt(bpm)
  const loopTicks = score.measures.reduce((sum, m) => sum + m.durationTicks, 0)

  const onsets: GrooveOnset[] = []
  for (let pass = 0; pass < repeats; pass++) {
    const passOffsetMs = pass * loopTicks * msPerTick
    for (const note of score.notes) {
      onsets.push({ pad: note.pad, atMs: passOffsetMs + note.tick * msPerTick })
    }
  }
  onsets.sort((a, b) => a.atMs - b.atMs || padOrderIndex(a.pad) - padOrderIndex(b.pad))
  return onsets
}

// -------------------------------------------------------------------- windows

/**
 * Each pad's own expected onsets, ascending. Sorted explicitly rather than
 * leaning on `grooveOnsetsMs`'s global ordering, so every gap measured below is
 * correct on its own terms.
 */
function onsetTimesByPad(
  score: GrooveScore,
  bpm: number,
  repeats: number,
): ReadonlyMap<DrumPad, readonly number[]> {
  const byPad = new Map<DrumPad, number[]>()
  for (const onset of grooveOnsetsMs(score, bpm, repeats)) {
    const list = byPad.get(onset.pad)
    if (list === undefined) byPad.set(onset.pad, [onset.atMs])
    else list.push(onset.atMs)
  }
  for (const times of byPad.values()) times.sort((a, b) => a - b)
  return byPad
}

/**
 * The smallest gap between consecutive onsets in an ascending list.
 * `undefined` with fewer than two onsets: that pad's spacing constrains
 * nothing, because there is no neighbour to be confused with.
 */
function smallestGapMs(sortedTimes: readonly number[]): number | undefined {
  let smallest: number | undefined
  for (let i = 1; i < sortedTimes.length; i++) {
    const gap = at(sortedTimes, i) - at(sortedTimes, i - 1)
    if (smallest === undefined || gap < smallest) smallest = gap
  }
  return smallest
}

/** One pad's window: the request, capped by that pad's own spacing, floored at 1. */
function padWindowMs(requestedMs: number, gapMs: number | undefined): number {
  if (gapMs === undefined) return requestedMs
  return Math.max(1, Math.min(requestedMs, Math.floor(TOLERANCE_GAP_FRACTION * gapMs)))
}

/**
 * Per-pad matching windows, each derived from that pad's OWN smallest
 * inter-onset gap — see the module doc for why one shared window was a bug. A
 * pad the score never asks for has no entry; a pad with a single onset gets the
 * requested window untouched, since it can be confused with nothing.
 *
 * The cap applies to an explicitly requested window too. A caller asking for
 * +/-150 ms on a pad whose sixteenths are 187.5 ms apart is asking for the bug,
 * so the ceiling is not something a caller can opt out of, only something they
 * can ask for less than.
 */
export function groovePadTolerancesMs(
  score: GrooveScore,
  bpm: number,
  repeats: number,
  requestedMs?: number,
): ReadonlyMap<DrumPad, number> {
  const requested = requestedMs ?? DEFAULT_GROOVE_TOLERANCE_MS
  invariant(requested > 0, `toleranceMs must be > 0, got ${requested}`)

  const windows = new Map<DrumPad, number>()
  for (const [pad, times] of onsetTimesByPad(score, bpm, repeats)) {
    windows.set(pad, padWindowMs(requested, smallestGapMs(times)))
  }
  return windows
}

/**
 * The strictest window any pad is held to. Seeded with the request so a score
 * that asks nothing of any pad still answers with the requested window.
 */
function tightestWindowMs(requestedMs: number, windows: ReadonlyMap<DrumPad, number>): number {
  let tightest = requestedMs
  for (const window of windows.values()) tightest = Math.min(tightest, window)
  return tightest
}

/**
 * The one window figure the screen prints: the tightest of the per-pad windows
 * this score admits at this tempo. Always >= 1. Individual pads are matched
 * against their own, possibly wider windows — see `groovePadTolerancesMs` and
 * `PadResult.toleranceMs`.
 */
export function grooveToleranceMs(
  score: GrooveScore,
  bpm: number,
  repeats: number,
  requestedMs?: number,
): number {
  return tightestWindowMs(
    requestedMs ?? DEFAULT_GROOVE_TOLERANCE_MS,
    groovePadTolerancesMs(score, bpm, repeats, requestedMs),
  )
}

// -------------------------------------------------------------------- results

export type PadResult = {
  readonly pad: DrumPad
  readonly expected: number
  readonly matched: number
  readonly missed: number
  readonly extra: number
  /** Mean of (hit - expected) over matched pairs; `undefined` when nothing matched. */
  readonly meanOffsetMs: number | undefined
  /** The matched pair with the largest absolute offset, sign preserved; `undefined` when nothing matched. */
  readonly worstOffsetMs: number | undefined
  /** Largest |offset - meanOffsetMs| over matched pairs; `undefined` when nothing matched. */
  readonly spreadMs: number | undefined
  /** The window THIS pad was matched with, from its own spacing. */
  readonly toleranceMs: number
  /** The steadiness bar this pad was judged against: min(STEADY_SPREAD_MS,
   *  STEADY_SPREAD_FRACTION x this pad's grid spacing, this pad's window). */
  readonly steadyBarMs: number
  /** This pad's smallest inter-onset gap in ticks; `undefined` with fewer than two notes.
   *  Ticks, not ms, so a caller can name the note value ("one sixteenth"). */
  readonly gridTicks: number | undefined
  /** Non-zero when this pad's whole line fits its own onsets shifted by this many grid
   *  positions: +1 means the learner played a grid unit LATE. `undefined` when there is
   *  no such fit, which is the normal case. */
  readonly phaseSlipSteps: number | undefined
  /** `matched > 0`, the spread is within `steadyBarMs`, and the line is not displaced.
   *  Never consults the mean. */
  readonly steady: boolean
}

export type GroovePerformance = {
  readonly perPad: readonly PadResult[]
  /** The tightest per-pad window — the strictest any pad was held to. */
  readonly toleranceMs: number
  readonly expectedTotal: number
  readonly matchedTotal: number
  /** Largest difference between any two pads' mean offsets, over pads that matched
   *  something. `undefined` when fewer than two pads matched. */
  readonly padAlignmentMs: number | undefined
  /** The pad whose mean offset is the latest of all, and the one that is the earliest —
   *  the pair that produced `padAlignmentMs`. Both `undefined` when it is. */
  readonly laggingPad: DrumPad | undefined
  readonly leadingPad: DrumPad | undefined
  /** Every expected note matched and nothing extra was played. */
  readonly complete: boolean
  /** `complete`, every pad's pulse even, and the pads aligned with each other. This is
   *  the verdict the learner is shown. */
  readonly steady: boolean
}

type MatchedPair = { readonly expectedTime: number; readonly hitTime: number }

/**
 * One pad's worth of matching: every (expected, hit) pair within tolerance is a
 * candidate; candidates are sorted by |offset| ascending (ties broken by
 * expected time, then hit time, purely for determinism), then walked greedily,
 * each expected onset and each hit usable at most once. Independent of input
 * order by construction — every candidate pair is generated and sorted before
 * anything is accepted, so shuffling `expectedTimes` or `hitTimes` cannot
 * change which pairs end up accepted.
 */
function matchPad(
  expectedTimes: readonly number[],
  hitTimes: readonly number[],
  toleranceMs: number,
): readonly MatchedPair[] {
  const candidates: {
    readonly expectedIdx: number
    readonly hitIdx: number
    readonly expectedTime: number
    readonly hitTime: number
    readonly absOffset: number
  }[] = []
  for (let i = 0; i < expectedTimes.length; i++) {
    const expectedTime = at(expectedTimes, i)
    for (let j = 0; j < hitTimes.length; j++) {
      const hitTime = at(hitTimes, j)
      const absOffset = Math.abs(hitTime - expectedTime)
      if (absOffset <= toleranceMs) {
        candidates.push({ expectedIdx: i, hitIdx: j, expectedTime, hitTime, absOffset })
      }
    }
  }
  candidates.sort(
    (a, b) =>
      a.absOffset - b.absOffset || a.expectedTime - b.expectedTime || a.hitTime - b.hitTime,
  )

  const usedExpected = new Array<boolean>(expectedTimes.length).fill(false)
  const usedHit = new Array<boolean>(hitTimes.length).fill(false)
  const matched: MatchedPair[] = []
  for (const c of candidates) {
    if (usedExpected[c.expectedIdx] === true || usedHit[c.hitIdx] === true) continue
    usedExpected[c.expectedIdx] = true
    usedHit[c.hitIdx] = true
    matched.push({ expectedTime: c.expectedTime, hitTime: c.hitTime })
  }
  // Sorted for a deterministic meanOffsetMs/worstOffsetMs regardless of the
  // (also deterministic, but differently ordered) acceptance walk above.
  matched.sort((a, b) => a.expectedTime - b.expectedTime)
  return matched
}

/**
 * The displacements a whole line is tested against, smallest |k| first: a tie
 * between two winning shifts resolves to the smaller displacement, and at equal
 * magnitude to the earlier one, purely so the answer is deterministic. Past
 * +/-2 grid units a "slip" is no longer a slip — it is a different part.
 */
const PHASE_SLIP_STEPS: readonly number[] = [-1, 1, -2, 2]

/**
 * Is this pad's whole line sitting one or two grid units away from where it is
 * written? Re-runs the same matching against the expected times shifted by
 * `steps * gridMs` and claims a slip only when some shift fits STRICTLY more
 * hits than the unshifted grading did — see the module doc for why "strictly"
 * is load-bearing on a uniform line, and for the sign convention (+1 = late).
 */
function detectPhaseSlip(
  expectedTimes: readonly number[],
  hitTimes: readonly number[],
  toleranceMs: number,
  gridMs: number | undefined,
  baselineMatched: number,
): number | undefined {
  if (gridMs === undefined || expectedTimes.length < 2 || hitTimes.length === 0) return undefined
  // A grading that already paired off everything it possibly could cannot be
  // beaten by any shift, so there is nothing to test.
  if (baselineMatched >= Math.min(expectedTimes.length, hitTimes.length)) return undefined

  let bestSteps: number | undefined
  let bestMatched = baselineMatched
  for (const steps of PHASE_SLIP_STEPS) {
    const shifted = expectedTimes.map((time) => time + steps * gridMs)
    const matched = matchPad(shifted, hitTimes, toleranceMs).length
    if (matched > bestMatched) {
      bestMatched = matched
      bestSteps = steps
    }
  }
  return bestSteps
}

/** One row: this pad's own onsets against this pad's own hits, in this pad's own window. */
function gradePad(input: {
  readonly pad: DrumPad
  readonly expectedTimes: readonly number[]
  readonly hitTimes: readonly number[]
  readonly toleranceMs: number
  readonly msPerTick: number
}): PadResult {
  const { pad, expectedTimes, hitTimes, toleranceMs } = input
  const matched = matchPad(expectedTimes, hitTimes, toleranceMs)
  const gridMs = smallestGapMs(expectedTimes)

  // Back to ticks so a caller can name the note value. Exact up to float dust:
  // every gap is a whole number of ticks times `msPerTick` by construction, so
  // rounding recovers the tick count and nothing else.
  const gridTicks = gridMs === undefined ? undefined : Math.round(gridMs / input.msPerTick)
  const steadyBarMs = Math.min(
    STEADY_SPREAD_MS,
    toleranceMs,
    gridMs === undefined ? Infinity : STEADY_SPREAD_FRACTION * gridMs,
  )

  let meanOffsetMs: number | undefined
  let worstOffsetMs: number | undefined
  let spreadMs: number | undefined
  if (matched.length > 0) {
    let sum = 0
    let worst = 0
    let worstAbs = -1
    for (const pair of matched) {
      const offset = pair.hitTime - pair.expectedTime
      sum += offset
      const absOffset = Math.abs(offset)
      if (absOffset > worstAbs) {
        worstAbs = absOffset
        worst = offset
      }
    }
    const mean = sum / matched.length
    // Second pass, because spread is measured from the mean and the mean is
    // only known once the first pass has finished. Spelling it as its own
    // loop reads as what it is; folding it into the first would not.
    let spread = 0
    for (const pair of matched) {
      spread = Math.max(spread, Math.abs(pair.hitTime - pair.expectedTime - mean))
    }
    meanOffsetMs = mean
    worstOffsetMs = worst
    spreadMs = spread
  }

  const phaseSlipSteps = detectPhaseSlip(
    expectedTimes,
    hitTimes,
    toleranceMs,
    gridMs,
    matched.length,
  )

  return {
    pad,
    expected: expectedTimes.length,
    matched: matched.length,
    missed: expectedTimes.length - matched.length,
    extra: hitTimes.length - matched.length,
    meanOffsetMs,
    worstOffsetMs,
    spreadMs,
    toleranceMs,
    steadyBarMs,
    gridTicks,
    phaseSlipSteps,
    steady: spreadMs !== undefined && spreadMs <= steadyBarMs && phaseSlipSteps === undefined,
  }
}

/**
 * The two pads furthest apart in mean offset, and the gap between them. All
 * three `undefined` unless at least two pads matched something: one pad alone
 * has nothing to be aligned with, and a pad that matched nothing has no mean to
 * compare. Ties go to the pad that sorts first, purely for determinism.
 */
function padAlignment(perPad: readonly PadResult[]): {
  readonly padAlignmentMs: number | undefined
  readonly laggingPad: DrumPad | undefined
  readonly leadingPad: DrumPad | undefined
} {
  let latest: { readonly pad: DrumPad; readonly mean: number } | undefined
  let earliest: { readonly pad: DrumPad; readonly mean: number } | undefined
  let padsWithMean = 0
  for (const row of perPad) {
    const mean = row.meanOffsetMs
    if (row.matched === 0 || mean === undefined) continue
    padsWithMean += 1
    if (latest === undefined || mean > latest.mean) latest = { pad: row.pad, mean }
    if (earliest === undefined || mean < earliest.mean) earliest = { pad: row.pad, mean }
  }
  if (padsWithMean < 2 || latest === undefined || earliest === undefined) {
    return { padAlignmentMs: undefined, laggingPad: undefined, leadingPad: undefined }
  }
  return {
    padAlignmentMs: latest.mean - earliest.mean,
    laggingPad: latest.pad,
    leadingPad: earliest.pad,
  }
}

/**
 * Grade a recorded performance against the score's expected onsets. Each pad is
 * matched independently — see the module doc for why — in its own window from
 * `groovePadTolerancesMs`, so a window that pad's own spacing cannot support is
 * narrowed whether it was requested or defaulted, and a coarse pad is never
 * punished for a fine one's grid. `perPad` has one row for every pad that
 * appears in either the expected onsets or the hits, including a pad the groove
 * never asks for at all (`expected: 0`, its hits all `extra`).
 */
export function gradeGroovePerformance(input: {
  readonly score: GrooveScore
  readonly bpm: number
  readonly repeats: number
  readonly hits: readonly RawDrumHit[]
  readonly toleranceMs?: number
}): GroovePerformance {
  const requested = input.toleranceMs ?? DEFAULT_GROOVE_TOLERANCE_MS
  const padTolerances = groovePadTolerancesMs(
    input.score,
    input.bpm,
    input.repeats,
    input.toleranceMs,
  )
  const toleranceMs = tightestWindowMs(requested, padTolerances)
  invariant(toleranceMs > 0, `toleranceMs must be > 0, got ${toleranceMs}`)

  const expectedByPad = onsetTimesByPad(input.score, input.bpm, input.repeats)

  const hitsByPad = new Map<DrumPad, number[]>()
  for (const hit of input.hits) {
    const list = hitsByPad.get(hit.pad)
    if (list === undefined) hitsByPad.set(hit.pad, [hit.time])
    else list.push(hit.time)
  }

  const pads = new Set<DrumPad>([...expectedByPad.keys(), ...hitsByPad.keys()])
  const orderedPads = [...pads].sort((a, b) => padOrderIndex(a) - padOrderIndex(b))
  const msPerTick = msPerTickAt(input.bpm)

  const perPad: PadResult[] = orderedPads.map((pad) =>
    gradePad({
      pad,
      expectedTimes: expectedByPad.get(pad) ?? [],
      hitTimes: hitsByPad.get(pad) ?? [],
      // A pad the groove never asks for has no spacing of its own to cap
      // anything, so it is held to the request as-is. Nothing can match on it
      // either way — every hit there is extra.
      toleranceMs: padTolerances.get(pad) ?? requested,
      msPerTick,
    }),
  )

  const expectedTotal = perPad.reduce((sum, row) => sum + row.expected, 0)
  const matchedTotal = perPad.reduce((sum, row) => sum + row.matched, 0)
  const complete = expectedTotal > 0 && perPad.every((row) => row.missed === 0 && row.extra === 0)
  const { padAlignmentMs, laggingPad, leadingPad } = padAlignment(perPad)
  // A row that matched nothing has no pulse to judge; `complete` has already
  // failed the run in that case, so it cannot smuggle a bad performance past.
  const steady =
    complete &&
    perPad.every((row) => row.matched === 0 || row.steady) &&
    (padAlignmentMs === undefined || padAlignmentMs <= PAD_ALIGNMENT_MS)

  return {
    perPad,
    toleranceMs,
    expectedTotal,
    matchedTotal,
    padAlignmentMs,
    laggingPad,
    leadingPad,
    complete,
    steady,
  }
}
