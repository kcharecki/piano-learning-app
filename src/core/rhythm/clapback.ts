/**
 * Grading for the clap/tap-back drill (roadmap 3.21/5.21, REQ-3.6.2): the
 * learner hears a rhythm phrase — never sees it notated — then taps it back
 * from memory. This module is the pure timing comparison behind that
 * "graded" moment; `app/rhythm/useClapbackDrill.ts` is the only caller.
 *
 * Deliberately independent of `core/generator/rhythm.ts`'s own
 * `gradeTapping`: that function is the right tool for the SIGHT-READING
 * rhythm drill (notation visible throughout, a fixed 150ms tolerance, no
 * tempo forgiveness — the learner is following a moving cursor, so there is
 * nothing to forgive), but a clap-back answer has no cursor to follow at all.
 * It is recalled from memory and reproduced at whatever tempo the learner's
 * own body settles on, so two things a sight-reading tolerance does not need
 * become load-bearing here:
 *
 *  1. **Tempo-scale robustness.** `core/eartraining/dictation.ts` hit exactly
 *     this problem for melodic dictation (see its own module doc, roadmap
 *     3.23): a fixed absolute tolerance fails a phrase reproduced correctly
 *     but a few percent off tempo, because a constant tempo ratio's timing
 *     error accumulates note over note — the LAST tap in a phrase is always
 *     the one that first crosses the line. The fix is the same idea, worked
 *     out independently here for bare onset timestamps instead of pitched
 *     notes (this module has no pitch to align): fit a single scale factor
 *     between the taps' own onset gaps and the pattern's own onset gaps
 *     (`fitTempoScale`), clamp it to `[1/maxTempoScale, maxTempoScale]`, and
 *     grade against the *scaled* expected onsets instead of the written
 *     ones. A phrase tapped a consistent 8% slow is a correct answer; a
 *     phrase tapped at literally half or double speed is a different rhythm,
 *     not the same one played unevenly, so the clamp is a hard bound, never
 *     an unbounded rescue (`maxTempoScale: 1` collapses it to exactly no
 *     adjustment, ever).
 *
 *  2. **A level-scaled tolerance window.** The sight-reading drill's 150ms is
 *     tuned for a learner tracking a cursor moving at the pattern's own
 *     tempo; clap-back has no such anchor, but the window still has to stay
 *     narrower than half the shortest gap the level can actually produce, or
 *     two adjacent onsets become impossible to tell apart. `BASE_TOLERANCE_TICKS`
 *     is expressed in TICKS, not milliseconds — tempo-independent, matching
 *     this codebase's own rule that musical time lives in ticks — and is
 *     converted to milliseconds through the pattern's own tempo map at grade
 *     time. Complexity 1-2 patterns bottom out at a quarter note (480 ticks,
 *     `core/generator/rhythm.ts`'s own `MIN_DURATION_BY_COMPLEXITY`, not
 *     re-exported so this table is independent, not coupled to it); 3-4 at an
 *     eighth (240); 5 at a sixteenth (120). Every tolerance below is
 *     comfortably under half of its level's own floor.
 *
 * ## Matching, structurally identical to `gradeTapping`
 *
 * The onset/tap matching itself (`matchOnsets`) is the same global
 * nearest-neighbour greedy algorithm `gradeTapping` uses — every (onset, tap)
 * pair within tolerance is a candidate, sorted nearest-first, assigned
 * greedily so each onset and each tap is claimed at most once — reimplemented
 * here rather than imported so it can run twice per grade (once against the
 * raw expected onsets, once against the tempo-scaled ones) and because it
 * needs to match against a computed list of expected milliseconds, not derive
 * them itself from a `RhythmPattern`. A doubled tap still costs exactly one
 * `extra` (its twin already claimed the only onset in range); a dropped tap
 * still costs exactly one `missed`. Order of the taps never matters — both
 * lists are sorted before matching.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import type { RhythmPattern } from '@core/generator/rhythm.ts'
import { tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { windowLimitMs } from '@core/timing/window.ts'
import { EIGHTH, QUARTER, SIXTEENTH, ticks as asTicks, type Millis, type Ticks } from '@core/shared/units.ts'

export type ClapbackLevel = 1 | 2 | 3 | 4 | 5

export type ClapbackGrade = {
  readonly matched: number
  readonly missed: number
  readonly extra: number
  /** `matched / (matched + missed + extra)`; 1 when there is nothing to grade. */
  readonly accuracy: number
  /** Mean |deviation| over matched taps, in ms; 0 when nothing matched. */
  readonly meanAbsDeviationMs: number
  /** The tempo scale actually applied when grading — 1 means none (see the module doc). */
  readonly tempoScale: number
}

export type ClapbackGradeOptions = {
  /** Overrides the level's own tolerance window. In ticks — see the module doc for why. */
  readonly toleranceTicks?: Ticks
  /** Overrides how far a uniform tempo difference is forgiven before it grades as wrong.
   *  Defaults to `DEFAULT_MAX_TEMPO_SCALE`; pass 1 to require the pattern's own tempo exactly. */
  readonly maxTempoScale?: number
}

/**
 * Half-width of the matching window per level, in ticks — see the module doc.
 * Strictly decreasing: a busier level packs its onsets closer together, so
 * its window has to shrink to match, or adjacent onsets become ambiguous.
 */
const BASE_TOLERANCE_TICKS: Record<ClapbackLevel, Ticks> = {
  1: asTicks(QUARTER / 3), // 160 — floor is a quarter note (480)
  2: asTicks(QUARTER / 4), // 120 — same floor, less forgiving
  3: asTicks(EIGHTH / 3), // 80 — floor is an eighth note (240)
  4: asTicks(EIGHTH / 4), // 60 — same floor, less forgiving
  5: asTicks(SIXTEENTH / 3), // 40 — floor is a sixteenth note (120)
}

/**
 * The level's own matching window, in ticks — the same table `gradeClapback`
 * grades a finished run against. Exported (roadmap U.3) so the real-time
 * `core/rhythm/tapClassifier.ts` wiring (`app/rhythm/useClapbackDrill.ts`)
 * can classify each LIVE tap against the identical window the batch grader
 * will eventually use, rather than inventing a second number that could
 * silently drift from this one.
 */
export function toleranceTicksForLevel(level: ClapbackLevel): Ticks {
  return BASE_TOLERANCE_TICKS[level]
}

/**
 * How far a uniform tempo difference is forgiven before it grades as wrong
 * rhythm (see the module doc's point 1). 1.15 mirrors
 * `core/eartraining/dictation.ts`'s own `DEFAULT_MAX_TEMPO_SCALE`, chosen
 * there for the same reason: comfortably past ordinary human tempo drift,
 * nowhere near "twice as fast", which is a different rhythm entirely.
 */
export const DEFAULT_MAX_TEMPO_SCALE = 1.15

/** One matching pass's raw tally, before it becomes a `ClapbackGrade`. */
type MatchResult = {
  readonly matched: number
  readonly missed: number
  readonly extra: number
  readonly deviationSum: number
}

function expectedOnsetMs(pattern: RhythmPattern, tempo: TempoMap): number[] {
  return pattern.onsets
    .filter((o) => !o.isRest)
    .map((o) => Number(tickToMs(tempo, o.tick)))
    .sort((a, b) => a - b)
}

/**
 * Global nearest-neighbour greedy matching within `toleranceMs`, order
 * independent (both inputs are sorted first) — see the module doc.
 */
function matchOnsets(
  expectedMs: readonly number[],
  tapMs: readonly number[],
  toleranceMs: number,
): MatchResult {
  // Not `toleranceMs`: both sides are derived from the same integer tick grid,
  // and a tap exactly on the boundary lands a couple of ULPs outside it.
  // Roadmap T.15 — see `core/timing/window.ts`.
  const limit = windowLimitMs(toleranceMs, expectedMs, tapMs)
  type Candidate = { readonly ei: number; readonly ti: number; readonly dist: number }
  const candidates: Candidate[] = []
  let lo = 0
  for (let ei = 0; ei < expectedMs.length; ei++) {
    const e = at(expectedMs, ei)
    while (lo < tapMs.length && at(tapMs, lo) < e - limit) lo += 1
    for (let ti = lo; ti < tapMs.length; ti++) {
      const t = at(tapMs, ti)
      if (t > e + limit) break
      candidates.push({ ei, ti, dist: Math.abs(t - e) })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist || a.ei - b.ei || a.ti - b.ti)

  const eMatched = new Array<boolean>(expectedMs.length).fill(false)
  const tMatched = new Array<boolean>(tapMs.length).fill(false)
  let matched = 0
  let deviationSum = 0
  for (const c of candidates) {
    if (at(eMatched, c.ei) || at(tMatched, c.ti)) continue
    eMatched[c.ei] = true
    tMatched[c.ti] = true
    matched += 1
    deviationSum += c.dist
  }
  return {
    matched,
    missed: expectedMs.length - matched,
    extra: tapMs.length - matched,
    deviationSum,
  }
}

function toGrade(m: MatchResult, tempoScale: number): ClapbackGrade {
  const total = m.matched + m.missed + m.extra
  return {
    matched: m.matched,
    missed: m.missed,
    extra: m.extra,
    accuracy: total === 0 ? 1 : m.matched / total,
    meanAbsDeviationMs: m.matched === 0 ? 0 : m.deviationSum / m.matched,
    tempoScale,
  }
}

/**
 * The single scale factor that best explains the taps as the expected onsets
 * played uniformly faster or slower — see the module doc, point 1. This is
 * `core/eartraining/dictation.ts`'s `fitTempoScale` worked out independently
 * for bare timestamps (no pitch, no note-count-mismatch alignment search):
 * returns exactly `1` (no adjustment) whenever a scale cannot meaningfully be
 * fit — a mismatched count (an ambiguous correspondence a simple index-pair
 * fit would be fitting noise against) or fewer than 2 expected onsets (no gap
 * to measure a tempo from).
 *
 * The fit is over each list's own offsets from its own first element, never
 * the raw timestamps — so it is blind to a constant additive shift between
 * the two (a phrase tapped consistently LATE, not faster or slower, is never
 * mistaken for a tempo difference) and sensitive only to a genuine uniform
 * stretch or compression of the gaps between taps.
 */
function fitTempoScale(
  expectedMs: readonly number[],
  tapMs: readonly number[],
  maxTempoScale: number,
): number {
  if (expectedMs.length !== tapMs.length || expectedMs.length < 2) return 1
  const anchorE = at(expectedMs, 0)
  const anchorT = at(tapMs, 0)
  let sumEE = 0
  let sumET = 0
  for (let i = 1; i < expectedMs.length; i++) {
    const oe = at(expectedMs, i) - anchorE
    const ot = at(tapMs, i) - anchorT
    sumEE += oe * oe
    sumET += oe * ot
  }
  if (sumEE === 0) return 1
  const raw = sumET / sumEE
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const minScale = 1 / maxTempoScale
  return Math.min(maxTempoScale, Math.max(minScale, raw))
}

/** `expectedMs`, rescaled by `scale` around its own first element. */
function scaleOnsets(expectedMs: readonly number[], scale: number): readonly number[] {
  const anchor = expectedMs[0]
  if (anchor === undefined || scale === 1) return expectedMs
  return expectedMs.map((ms) => anchor + scale * (ms - anchor))
}

/**
 * Whichever of `scaled`/`raw` is the better structural explanation of the
 * same taps (mirrors `dictation.ts`'s `betterAlignment`, same reasoning):
 * fewer missed+extra wins outright, since that is exactly what "this scale
 * does not actually explain the data" looks like; a tie is broken by the
 * lower mean deviation among matched taps; `raw` wins any further tie, so a
 * scale that does not demonstrably help is never preferred.
 */
function betterMatch(scaled: MatchResult, raw: MatchResult): MatchResult {
  const scaledMismatch = scaled.missed + scaled.extra
  const rawMismatch = raw.missed + raw.extra
  if (scaledMismatch !== rawMismatch) return scaledMismatch < rawMismatch ? scaled : raw
  const scaledMean = scaled.matched === 0 ? Infinity : scaled.deviationSum / scaled.matched
  const rawMean = raw.matched === 0 ? Infinity : raw.deviationSum / raw.matched
  return scaledMean < rawMean ? scaled : raw
}

/**
 * Grade a clap-back attempt: `taps` (wall-clock-relative, ms, as recorded by
 * the drill against the SAME anchor its silent playback uses) against
 * `pattern`'s own onsets (rests excluded — nothing to tap for a rest),
 * tempo-scale robust and level-scaled — see the module doc.
 */
export function gradeClapback(
  pattern: RhythmPattern,
  taps: readonly Millis[],
  tempo: TempoMap,
  level: ClapbackLevel,
  opts?: ClapbackGradeOptions,
): ClapbackGrade {
  const toleranceTicks = opts?.toleranceTicks ?? BASE_TOLERANCE_TICKS[level]
  invariant(
    Number.isFinite(toleranceTicks) && toleranceTicks >= 0,
    `gradeClapback: toleranceTicks must be a finite number >= 0, got ${toleranceTicks}`,
  )
  const maxTempoScale = opts?.maxTempoScale ?? DEFAULT_MAX_TEMPO_SCALE
  invariant(
    Number.isFinite(maxTempoScale) && maxTempoScale >= 1,
    `gradeClapback: maxTempoScale must be a finite number >= 1, got ${maxTempoScale}`,
  )

  const toleranceMs = Number(tickToMs(tempo, toleranceTicks))
  const expectedMs = expectedOnsetMs(pattern, tempo)
  const tapMs = [...taps].map(Number).sort((a, b) => a - b)

  const rawMatch = matchOnsets(expectedMs, tapMs, toleranceMs)
  const scale = fitTempoScale(expectedMs, tapMs, maxTempoScale)
  if (scale === 1) return toGrade(rawMatch, 1)

  const scaledMatch = matchOnsets(scaleOnsets(expectedMs, scale), tapMs, toleranceMs)
  const chosen = betterMatch(scaledMatch, rawMatch)
  return toGrade(chosen, chosen === scaledMatch ? scale : 1)
}
