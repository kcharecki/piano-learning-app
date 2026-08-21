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
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import { padOrderIndex, type DrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'

export const DEFAULT_GROOVE_TOLERANCE_MS = 100

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
}

export type GroovePerformance = {
  readonly perPad: readonly PadResult[]
  readonly clean: boolean
  readonly toleranceMs: number
  readonly expectedTotal: number
  readonly matchedTotal: number
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
 * defaults to `DEFAULT_GROOVE_TOLERANCE_MS`. Each pad is matched independently
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
  const toleranceMs = input.toleranceMs ?? DEFAULT_GROOVE_TOLERANCE_MS
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
      meanOffsetMs = sum / matched.length
      worstOffsetMs = worst
    }

    return {
      pad,
      expected: expectedTimes.length,
      matched: matched.length,
      missed: expectedTimes.length - matched.length,
      extra: hitTimes.length - matched.length,
      meanOffsetMs,
      worstOffsetMs,
    }
  })

  const expectedTotal = perPad.reduce((sum, row) => sum + row.expected, 0)
  const matchedTotal = perPad.reduce((sum, row) => sum + row.matched, 0)
  const clean = expectedTotal > 0 && perPad.every((row) => row.missed === 0 && row.extra === 0)

  return { perPad, clean, toleranceMs, expectedTotal, matchedTotal }
}
