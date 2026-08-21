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
 * adapter. Ticks never re-enter once this conversion happens.
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
 * the spread is within `STEADY_SPREAD_MS`, never consulting the mean. The mean
 * is still reported as a fact, for `attempt.ts` to disclose with the latency
 * caveat attached.
 *
 * The rejected alternative was to subtract a calibrated latency estimate from
 * every offset and judge the corrected mean. That needs a calibration step
 * this app does not have, and the corrected mean would still be a guess;
 * measuring the one quantity latency cannot touch needs no calibration at all.
 *
 * ## Why the tolerance is capped by the score's own smallest gap
 *
 * `DEFAULT_GROOVE_TOLERANCE_MS` is a flat 100 ms, and a flat window becomes a
 * bug the moment the grid is finer than it. At 80 bpm consecutive sixteenths
 * are 187.5 ms apart, so a +/-100 ms window is wider than half that gap: one
 * hit can sit within tolerance of two different notes on its own pad, and
 * Ghost Funk Bar played a whole sixteenth late matched the *next* note every
 * time and graded as very nearly perfect. `grooveToleranceMs` derives the
 * ceiling from the score rather than from a constant — no wider than
 * `TOLERANCE_GAP_FRACTION` of the smallest gap any single pad asks for, which
 * keeps twice the window under one gap and makes that two-note ambiguity
 * arithmetically impossible instead of merely unlikely.
 *
 * Gaps are measured per pad, never across the whole groove. Kick and hi-hat
 * both land on beat 1, so the smallest *global* gap is zero and a global rule
 * would collapse the window to nothing on every real groove ever written. A
 * hit is only ever matched against its own pad's onsets (see above), so its
 * own pad's spacing is the only spacing that can confuse it.
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

export type GrooveOnset = { readonly pad: MappedDrumPad; readonly atMs: number }

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

  const msPerTick = 60_000 / (bpm * TICKS_PER_QUARTER)
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

/**
 * The matching window this score actually admits at this tempo: the requested
 * window (or the default), capped at TOLERANCE_GAP_FRACTION of the smallest
 * inter-onset gap any single pad asks for. Always >= 1.
 *
 * The cap applies to an explicitly requested window too. A caller asking for
 * +/-150 ms on a groove whose sixteenths are 187.5 ms apart is asking for the
 * bug — see the module doc — so the ceiling is not something a caller can opt
 * out of, only something they can ask for less than.
 */
export function grooveToleranceMs(
  score: GrooveScore,
  bpm: number,
  repeats: number,
  requestedMs?: number,
): number {
  const requested = requestedMs ?? DEFAULT_GROOVE_TOLERANCE_MS
  invariant(requested > 0, `toleranceMs must be > 0, got ${requested}`)

  const onsetsByPad = new Map<DrumPad, number[]>()
  for (const onset of grooveOnsetsMs(score, bpm, repeats)) {
    const list = onsetsByPad.get(onset.pad)
    if (list === undefined) onsetsByPad.set(onset.pad, [onset.atMs])
    else list.push(onset.atMs)
  }

  // Infinity means no pad has two onsets to be confused between, so nothing
  // caps the requested window: a single note per pad cannot be mismatched
  // against a neighbour that does not exist.
  let smallestGapMs = Infinity
  for (const times of onsetsByPad.values()) {
    const sorted = [...times].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      smallestGapMs = Math.min(smallestGapMs, at(sorted, i) - at(sorted, i - 1))
    }
  }
  if (!Number.isFinite(smallestGapMs)) return requested

  const cap = Math.floor(TOLERANCE_GAP_FRACTION * smallestGapMs)
  return Math.max(1, Math.min(requested, cap))
}

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
  /** `matched > 0` and `spreadMs <= STEADY_SPREAD_MS`. Never consults the mean. */
  readonly steady: boolean
}

export type GroovePerformance = {
  readonly perPad: readonly PadResult[]
  readonly toleranceMs: number
  readonly expectedTotal: number
  readonly matchedTotal: number
  /** Every expected note matched and nothing extra was played. */
  readonly complete: boolean
  /** `complete` and every pad's pulse was even. This is the verdict the learner is shown. */
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
 * Grade a recorded performance against the score's expected onsets. Tolerance
 * comes from `grooveToleranceMs`, so a window this score's own spacing cannot
 * support is narrowed whether it was requested or defaulted. Each pad is
 * matched independently
 * — see the module doc for why — so `perPad` has one row for every pad that
 * appears in either the expected onsets or the hits, including a pad the
 * groove never asks for at all (`expected: 0`, its hits all `extra`).
 */
export function gradeGroovePerformance(input: {
  readonly score: GrooveScore
  readonly bpm: number
  readonly repeats: number
  readonly hits: readonly RawDrumHit[]
  readonly toleranceMs?: number
}): GroovePerformance {
  const toleranceMs = grooveToleranceMs(
    input.score,
    input.bpm,
    input.repeats,
    input.toleranceMs,
  )
  invariant(toleranceMs > 0, `toleranceMs must be > 0, got ${toleranceMs}`)

  const expected = grooveOnsetsMs(input.score, input.bpm, input.repeats)

  const expectedByPad = new Map<DrumPad, number[]>()
  for (const onset of expected) {
    const list = expectedByPad.get(onset.pad)
    if (list === undefined) expectedByPad.set(onset.pad, [onset.atMs])
    else list.push(onset.atMs)
  }

  const hitsByPad = new Map<DrumPad, number[]>()
  for (const hit of input.hits) {
    const list = hitsByPad.get(hit.pad)
    if (list === undefined) hitsByPad.set(hit.pad, [hit.time])
    else list.push(hit.time)
  }

  const pads = new Set<DrumPad>([...expectedByPad.keys(), ...hitsByPad.keys()])
  const orderedPads = [...pads].sort((a, b) => padOrderIndex(a) - padOrderIndex(b))

  const perPad: PadResult[] = orderedPads.map((pad) => {
    const expectedTimes = expectedByPad.get(pad) ?? []
    const hitTimes = hitsByPad.get(pad) ?? []
    const matched = matchPad(expectedTimes, hitTimes, toleranceMs)

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

    return {
      pad,
      expected: expectedTimes.length,
      matched: matched.length,
      missed: expectedTimes.length - matched.length,
      extra: hitTimes.length - matched.length,
      meanOffsetMs,
      worstOffsetMs,
      spreadMs,
      steady: spreadMs !== undefined && spreadMs <= STEADY_SPREAD_MS,
    }
  })

  const expectedTotal = perPad.reduce((sum, row) => sum + row.expected, 0)
  const matchedTotal = perPad.reduce((sum, row) => sum + row.matched, 0)
  const complete = expectedTotal > 0 && perPad.every((row) => row.missed === 0 && row.extra === 0)
  // A row that matched nothing has no pulse to judge; `complete` has already
  // failed the run in that case, so it cannot smuggle a bad performance past.
  const steady = complete && perPad.every((row) => row.matched === 0 || row.steady)

  return { perPad, toleranceMs, expectedTotal, matchedTotal, complete, steady }
}
