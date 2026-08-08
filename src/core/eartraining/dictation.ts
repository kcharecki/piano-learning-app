/**
 * Melodic and rhythmic dictation (roadmap 3.6, REQ-3.6.2): generate a phrase
 * with the existing sight-reading and rhythm generators, and grade what the
 * learner played back against it, note by note.
 *
 * ## Alignment, not index-by-index comparison
 *
 * The learner's answer can have a different length than the prompt — a
 * skipped note, a spurious extra note — so `gradeDictation` cannot compare
 * `expected[i]` against `given[i]` position by position: one dropped note
 * would offset every following comparison and mark the rest of a perfectly
 * played phrase wrong. Instead it runs an edit-distance alignment
 * (`alignDictation`) between the expected notes and the given notes, where:
 *
 *  - pairing two notes (a "substitution") costs 0 when they are `'correct'`
 *    and 1 otherwise (`'wrong-pitch'` or `'wrong-rhythm'`);
 *  - leaving an expected note unpaired (`'missing'`), or a given note
 *    unpaired (`'extra'`), costs far more than any realistic run of
 *    mismatches (`n + m + 1`, comfortably above the at-most-`n + m`
 *    mismatches a run of substitutions could ever cost).
 *
 * That lopsided cost is deliberate, not just "insertions are expensive": a
 * naive 0/1/1 cost (tried first, and wrong) lets the aligner spend one
 * deletion and one insertion to *shift* the whole correspondence by one
 * index whenever that shift happens to turn several mismatches into cheap
 * coincidental matches — a stepwise melody transposed by a semitone can make
 * the *next* note look like a correct match at the same cost as the true
 * one, and a busy passage can make a dropped note's neighbour look like a
 * plausible substitute. Making indels cost more than any amount of
 * mismatching they could ever buy back means the DP only ever reaches for
 * one when the note counts actually differ — never to save a few
 * mismatches — which is what keeps the mapping one-to-one and order
 * preserving, and is exactly the anti-cascade property this module exists to
 * guarantee: the alignment that minimises total cost is unique whenever the
 * answer differs from the prompt by one dropped or one inserted note, and a
 * systematic timing offset across an entire phrase reads as every note
 * `'wrong-rhythm'`, never as every note missing and every note extra.
 *
 * A paired note's status is decided pitch-first: pitch mismatch is always
 * `'wrong-pitch'` regardless of timing; pitch match with the onset outside
 * tolerance is `'wrong-rhythm'`; both matching is `'correct'`. `pitchAccuracy`
 * and `rhythmAccuracy`, however, are tracked independently of `status` — a
 * transposed answer (every pitch wrong, every onset exact) scores
 * `pitchAccuracy: 0` and `rhythmAccuracy: 1`, which is the pedagogical point.
 *
 * ## Tempo-scale robustness (roadmap 3.23, REQ-3.6.1)
 *
 * A dictation prompt plays with no displayed tempo and no count-in metronome
 * to grade against (that gap is REQ-3.6.1's screen half — see
 * `app/eartraining/useEarTraining.ts`'s own doc), so a learner who reproduces
 * the exact right rhythm a few percent off the prompt's own tempo used to
 * fail every note near the end of the phrase: a fixed absolute-tick tolerance
 * does not distinguish "wrong rhythm" from "right rhythm, wrong pulse" — the
 * timing error from a constant tempo ratio accumulates note over note, so the
 * last note in a phrase is always the one that crosses the tolerance line.
 * Measured: replaying a level 3-5 melodic phrase 8% slow graded incorrect in
 * 416 of 900 cases.
 *
 * `gradeDictation` now fits a single scale factor between the answer's
 * onsets and the prompt's own (`fitTempoScale`), clamped to
 * `[1/maxTempoScale, maxTempoScale]`, and compares against the *scaled*
 * expected onsets (`scaleExpected`) instead of the raw ones — the ±eighth
 * tolerance still applies, just around the fitted pulse instead of the
 * written one. The fit is deliberately blind to a constant offset between the
 * two lists (see `fitTempoScale`'s own doc): it forgives a consistently
 * faster or slower performance, never a performance that is merely late or
 * early by a fixed amount, and never an unbounded rescue — `maxTempoScale: 1`
 * (or a mismatched note count, where no single scale factor is even
 * well-defined) recovers the pre-3.23 behaviour exactly, bit for bit.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import {
  defaultParamsForLevel,
  generateMelody,
  type GeneratorParams,
} from '@core/generator/melody.ts'
import { generateRhythm, rhythmToScore, type RhythmParams, type RhythmPattern } from '@core/generator/rhythm.ts'
import type { Score, TimeSignature } from '@core/notation/score.ts'
import { keyName, type Key } from '@core/theory/keys.ts'
import type { EarGrade, EarItem } from '@core/eartraining/item.ts'
import { midi as asMidi, ticks as asTicks, EIGHTH, type Midi, type Ticks } from '@core/shared/units.ts'
import type { Rng } from '@core/ports/rng.ts'

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

export type DictationOptions = {
  readonly bars?: number
  readonly key?: Key
  readonly range?: { readonly low: Midi; readonly high: Midi }
}

type Range = { readonly low: Midi; readonly high: Midi }

/** Complexity levels `generateRhythm` accepts. */
type Complexity = 1 | 2 | 3 | 4 | 5

function clampComplexity(level: number): Complexity {
  return Math.min(5, Math.max(1, Math.round(level))) as Complexity
}

/**
 * REQ-3.6.1: "a 2-8 note phrase". `defaultParamsForLevel`'s own `bars` is
 * tuned for a full sight-reading piece, not a dictation snippet — 4 bars of
 * quarters at level 2, 8 bars of eighths at levels 3-5, dozens of notes
 * either way — so it cannot be used unmodified here. These are the floor and
 * ceiling every generated phrase is bounded to instead.
 */
const MIN_DICTATION_NOTES = 2
const MAX_DICTATION_NOTES = 8

/**
 * How many times `generateRhythmicDictation` grows `bars` by one, looking for
 * the floor, before giving up on that path and forcing it instead. See that
 * function's own comment for why melodic dictation never needs this.
 */
const MAX_BAR_GROWTH_ATTEMPTS = 6

/**
 * The floor on `bars` for melodic dictation, kept as its own constant rather
 * than reusing `MIN_DICTATION_NOTES` (a note count, not a bar count) for both:
 * the two only agree in value because `generateMelodicLine` always places at
 * least one note per bar (`buildBarDurations` never returns an empty list for
 * a bar), so `bars === MIN_MELODIC_BARS` happens to guarantee
 * `notes.length >= MIN_DICTATION_NOTES` today. That is a property of the
 * generator, not a coincidence of the two constants sharing a value, so it is
 * named separately here rather than left implicit in a shared symbol.
 */
const MIN_MELODIC_BARS = 2

/** Small, deterministic, non-cryptographic string hash — good enough for a stable content id. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Canonical, order-stable rendering of a note list. `includePitch` false ignores `midi` entirely. */
function notesKey(
  notes: readonly { readonly midi: Midi; readonly startTick: Ticks }[],
  includePitch: boolean,
): string {
  return [...notes]
    .sort((a, b) => a.startTick - b.startTick || a.midi - b.midi)
    .map((n) => (includePitch ? `${n.midi}@${n.startTick}` : `${n.startTick}`))
    .join(',')
}

/**
 * Trim `score.measures` to end at the last note's own measure. A trailing
 * measure with no notes in it is legal by `validateScore` (it only checks
 * that a note lies within its own measure, never that every measure has
 * one), but a declared-and-empty tail is exactly the kind of unresolved
 * ending this module's bounding exists to avoid — measured over 2000
 * rhythmic draws, 436 left trailing empty measures before this trim existed.
 * A score with no notes at all keeps just its first measure.
 *
 * Only called when `opts.bars` was NOT the caller's own explicit choice: an
 * explicit `bars` is respected as-is (see both generators' own comments — it
 * is only ever trimmed by note count, never by measure count), so trimming
 * measures out from under it would silently override what the caller asked
 * for.
 */
function trimTrailingEmptyMeasures(score: Score): Score {
  const lastNote = score.notes[score.notes.length - 1]
  const lastIndex = lastNote === undefined ? 0 : lastNote.measureIndex
  if (lastIndex >= score.measures.length - 1) return score
  return { ...score, measures: score.measures.slice(0, lastIndex + 1) }
}

/**
 * Trim `score.notes` to at most `max`, in onset order, and recompute the
 * derived `maxNoteDurationTicks` to match. Does not touch `score.measures` —
 * see `trimTrailingEmptyMeasures`, which callers apply separately once they
 * know whether `bars` was an explicit override.
 */
function truncateNotes(score: Score, max: number): Score {
  if (score.notes.length <= max) return score
  const notes = score.notes.slice(0, max)
  let maxDuration = 0
  for (const n of notes) if (n.durationTicks > maxDuration) maxDuration = n.durationTicks
  return { ...score, notes, maxNoteDurationTicks: asTicks(maxDuration) }
}

/**
 * A melodic dictation phrase: a single-hand melody from {@link generateMelody},
 * reusing the level ladder from {@link defaultParamsForLevel} and overriding
 * only what `opts` states. `hands` is forced to `'right'` regardless of the
 * level's own default — dictation grades one monophonic line, and the answer
 * type (`DictationAnswerNote`) has no hand to disambiguate a second one.
 *
 * Bounded to `MIN_DICTATION_NOTES..MAX_DICTATION_NOTES` notes (REQ-3.6.1) when
 * `opts.bars` is left unset: `generateMelodicLine` always places at least one
 * note per bar (`buildBarDurations` never returns an empty list for a bar), so
 * `bars === MIN_DICTATION_NOTES` is a hard floor on the note count — no retry
 * loop needed, unlike the rhythmic generator below. The ceiling is enforced by
 * trimming, not by shrinking `bars`, since a busier style (levels 3-5) can
 * pack more than 8 notes into even a single bar. An explicit `opts.bars` is
 * respected as the caller's own choice (see the 'honours a bars override'
 * test) and is only ever trimmed from above, never grown.
 */
export function generateMelodicDictation(level: number, opts: DictationOptions, rng: Rng): EarItem {
  const defaults = defaultParamsForLevel(level)
  const key = opts.key ?? defaults.key
  const range: Range = opts.range ?? defaults.rightRange

  function build(bars: number): Score {
    const params: GeneratorParams = {
      ...defaults,
      key,
      bars,
      hands: 'right',
      rightRange: range,
      // Level 1's stepwise-one-direction mode (roadmap 5.11) does not end on
      // the tonic — see melody.ts's module doc — but this function's own
      // bars-shrinking strategy above depends on that ending exactly like
      // every other level's does. Dictation grades a fixed melody the
      // learner names back, not a sight-reading shape, so the pedagogical
      // reason for that mode doesn't apply here either.
      stepwiseOneDirection: false,
      // Level 1's own `maxLeapSemitones` is sized for that mode (a straight
      // run needs no leap budget at all) and is too small to cadence a
      // single-bar 'whole-half' draw — that style can place just one note in
      // the whole bar, which then has to reach the tonic in one leap that
      // spans the caller's entire `range`. Dictation isn't teaching leap
      // difficulty the way sight reading is, so give it exactly the headroom
      // it needs rather than borrowing the ladder's pedagogical value.
      maxLeapSemitones: Math.max(defaults.maxLeapSemitones, range.high - range.low),
    }
    const result = generateMelody(params, rng)
    if (!result.ok) {
      invariant(
        false,
        `generateMelodicDictation: could not generate a level-${level} melody for the given ` +
          `options (bars=${bars}, key=${keyName(key)}, range=${range.low}..${range.high}): ` +
          `${result.error}`,
      )
    }
    return result.value
  }

  let bars = opts.bars ?? 1
  let score = build(bars)
  if (opts.bars === undefined && score.notes.length < MIN_DICTATION_NOTES) {
    bars = MIN_MELODIC_BARS
    score = build(bars)
  }
  // Prefer shrinking `bars` over slicing mid-phrase: a smaller bar count that
  // still clears the floor keeps the generator's own tonic-ending note in the
  // phrase (melody.ts:14's guarantee), where truncateNotes slicing the raw
  // note list cannot — measured over 2000 draws, 111 of the 259 that hit the
  // ceiling ended mid-phrase because of exactly this. Only relevant when
  // `bars` grew past 1 above: `build(1)` is already the smallest phrase this
  // generator can draw, so there is nothing left to shrink to, and the
  // ceiling can only be enforced by `truncateNotes`' trim below.
  if (opts.bars === undefined) {
    while (score.notes.length > MAX_DICTATION_NOTES && bars > 1) {
      const shrunk = build(bars - 1)
      if (shrunk.notes.length < MIN_DICTATION_NOTES) break
      bars -= 1
      score = shrunk
    }
  }
  score = truncateNotes(score, MAX_DICTATION_NOTES)
  if (opts.bars === undefined) score = trimTrailingEmptyMeasures(score)

  const answerKey = notesKey(score.notes, true)
  const id = `dictation:melodic:${keyName(key)}:${bars}b:${range.low}-${range.high}:${fnv1a(answerKey)}`
  const clampedLevel = Math.min(5, Math.max(1, Math.round(level)))
  return { id, kind: 'melodic-dictation', prompt: score, answerKey, level: clampedLevel }
}

/**
 * A rhythmic dictation phrase: onsets only, from {@link generateRhythm},
 * rendered as a single repeated pitch at the middle of `range` (or the
 * level's default range) via {@link rhythmToScore}. `opts.key` is not
 * meaningful here — rhythm has no scale — and is ignored.
 *
 * Bounded the same way melodic dictation is (REQ-3.6.1), but rests
 * (`allowRests`, on from complexity 2) break the "one note per bar" floor
 * that makes the melodic generator's bound a single retry: a bar can, in the
 * worst case, subdivide into onsets that are all rests, so growing `bars`
 * only raises the *odds* of clearing `MIN_DICTATION_NOTES`, it does not
 * guarantee it the way adding a bar does for a melody. So this retries with
 * more bars first — `MAX_BAR_GROWTH_ATTEMPTS` covers the overwhelming
 * majority of draws — and only if the floor is still unmet falls back to one
 * final draw with rests forced off, which, like the melodic generator, does
 * guarantee at least one real onset per bar.
 */
export function generateRhythmicDictation(
  level: number,
  opts: DictationOptions,
  rng: Rng,
): EarItem {
  const defaults = defaultParamsForLevel(level)
  const range: Range = opts.range ?? defaults.rightRange
  const complexity = clampComplexity(level)
  const timeSignature: TimeSignature = defaults.timeSignature
  const pitch = asMidi(Math.round((range.low + range.high) / 2))

  function build(bars: number, allowRests: boolean): { score: Score; onsetTicks: readonly Ticks[] } {
    const rhythmParams: RhythmParams = {
      bars,
      timeSignature,
      complexity,
      allowRests,
      allowTies: complexity >= 4,
    }
    const pattern: RhythmPattern = generateRhythm(rhythmParams, rng)
    const score = rhythmToScore(pattern, { midi: pitch })
    const onsetTicks = pattern.onsets.filter((o) => !o.isRest).map((o) => o.tick)
    return { score, onsetTicks }
  }

  let bars = opts.bars ?? 1
  const baseAllowRests = complexity >= 2
  let built = build(bars, baseAllowRests)

  if (opts.bars === undefined) {
    let attempts = 0
    while (built.onsetTicks.length < MIN_DICTATION_NOTES && attempts < MAX_BAR_GROWTH_ATTEMPTS) {
      bars += 1
      built = build(bars, baseAllowRests)
      attempts += 1
    }
    if (built.onsetTicks.length < MIN_DICTATION_NOTES) {
      bars = Math.max(bars, MIN_DICTATION_NOTES)
      built = build(bars, false)
    }
  }

  let { score } = built
  let onsetTicks = built.onsetTicks
  if (onsetTicks.length > MAX_DICTATION_NOTES) {
    onsetTicks = onsetTicks.slice(0, MAX_DICTATION_NOTES)
    score = truncateNotes(score, MAX_DICTATION_NOTES)
  }
  // Trimmed whenever `bars` was auto-selected, not just when the ceiling
  // above was hit: the bar-growth loop can settle on a `bars` count whose
  // last bar or two carry no onset at all (a run of rests), leaving
  // declared-but-empty measures at the end even when the onset count never
  // exceeded the ceiling. An explicit `opts.bars` is left exactly as big as
  // the caller asked for — see `trimTrailingEmptyMeasures`'s own comment.
  if (opts.bars === undefined) score = trimTrailingEmptyMeasures(score)

  const answerKey = onsetTicks.join(',')
  const id =
    `dictation:rhythmic:${bars}b:${timeSignature.beats}-${timeSignature.beatType}:` +
    `c${complexity}:p${pitch}:${fnv1a(answerKey)}`
  const clampedLevel = Math.min(5, Math.max(1, Math.round(level)))
  return { id, kind: 'rhythmic-dictation', prompt: score, answerKey, level: clampedLevel }
}

// ---------------------------------------------------------------------------
// grading
// ---------------------------------------------------------------------------

/** One note as the learner entered it. Rhythmic dictation ignores `midi`. */
export type DictationAnswerNote = { readonly midi: Midi; readonly startTick: Ticks }

export type DictationNoteStatus = 'correct' | 'wrong-pitch' | 'wrong-rhythm' | 'missing' | 'extra'
export type DictationNoteResult = {
  readonly status: DictationNoteStatus
  /** Index into the item's own notes, or undefined for an extra note. */
  readonly expectedIndex?: number
  /** Index into the answer, or undefined for a missing note. */
  readonly givenIndex?: number
}
export type DictationGrade = EarGrade & {
  readonly notes: readonly DictationNoteResult[]
  /** Correct pitches / expected notes, 0..1. */
  readonly pitchAccuracy: number
  /** Correct onsets / expected notes, 0..1. */
  readonly rhythmAccuracy: number
}

export type DictationGradeOptions = {
  /** How far off an onset may be and still count as the same note. Defaults to an eighth. */
  readonly toleranceTicks?: Ticks
  /** Accept a uniform tempo difference between the answer and the prompt, fitting a single
   *  best scale factor within [1/MAX, MAX] before applying toleranceTicks (roadmap 3.23).
   *  Defaults to allowing a modest difference; pass 1 to require the prompt's own tempo. */
  readonly maxTempoScale?: number
}

const DEFAULT_TOLERANCE_TICKS: Ticks = EIGHTH

/**
 * REQ-3.6.1 (roadmap 3.23): how far a uniform tempo difference between the answer and the prompt
 * is forgiven before it grades as a rhythm error. 1.15 = up to 15% faster or slower — comfortably
 * past the measured defect (a phrase replayed 8% slow graded incorrect in 416 of 900 cases before
 * this fix), while nowhere near "half speed" or "double speed", which is a different rhythm, not
 * the same one played unevenly. See `fitTempoScale`'s own doc for why the bound is a hard clamp,
 * never an unbounded fit — an unbounded fit would make every rhythm "correct" at some scale.
 */
const DEFAULT_MAX_TEMPO_SCALE = 1.15

type ExpectedNote = { readonly midi: Midi; readonly startTick: Ticks }

/** The pitch/onset verdict for one candidate pairing, before it becomes a `DictationNoteResult`. */
type PairVerdict = {
  readonly status: 'correct' | 'wrong-pitch' | 'wrong-rhythm'
  readonly pitchMatch: boolean
  readonly onsetMatch: boolean
}

function classifyPair(
  expected: ExpectedNote,
  given: DictationAnswerNote,
  toleranceTicks: number,
  gradePitch: boolean,
): PairVerdict {
  const onsetMatch = Math.abs(expected.startTick - given.startTick) <= toleranceTicks
  const pitchMatch = !gradePitch || expected.midi === given.midi
  if (!pitchMatch) return { status: 'wrong-pitch', pitchMatch, onsetMatch }
  if (!onsetMatch) return { status: 'wrong-rhythm', pitchMatch, onsetMatch }
  return { status: 'correct', pitchMatch, onsetMatch }
}

/**
 * Index of the candidate in `candidates` whose `startTick` is closest to
 * `target`, ties broken to the earlier index. Only called with a non-empty
 * `candidates` array.
 */
function nearestIndex(
  target: Ticks,
  candidates: readonly { readonly startTick: Ticks }[],
): number {
  let best = 0
  let bestDist = Infinity
  for (let k = 0; k < candidates.length; k++) {
    const dist = Math.abs(at(candidates, k).startTick - target)
    if (dist < bestDist) {
      bestDist = dist
      best = k
    }
  }
  return best
}

type AlignResult = {
  readonly results: readonly DictationNoteResult[]
  readonly pitchHits: number
  readonly rhythmHits: number
}

/**
 * Edit-distance alignment between `expected` and `given` (already in onset
 * order — `expected` from a `Score`'s invariant, `given` presorted by the
 * caller). See the module doc for why this, rather than a positional
 * comparison, is what keeps one bad note from cascading into the rest.
 *
 * `givenOriginalIndex` maps a position in the (possibly resorted) `given`
 * array back to its index in the caller's original answer array, which is
 * what `DictationNoteResult.givenIndex` reports.
 */
function alignDictation(
  expected: readonly ExpectedNote[],
  given: readonly DictationAnswerNote[],
  givenOriginalIndex: readonly number[],
  toleranceTicks: number,
  gradePitch: boolean,
): AlignResult {
  const n = expected.length
  const m = given.length

  // A deletion or insertion costs the same as a mismatch: the anti-cascade
  // property does not come from making indels artificially expensive (that
  // crutch made every pairing onset-blind, so an answer that both drops a
  // note and adds a spurious one — n === m — got shifted into a cascade of
  // wrong-pitch/wrong-rhythm instead of one missing + one extra). Instead a
  // diagonal (pairing) step is only *allowed* when the two notes are close
  // enough to plausibly be the same note: either the onset is within
  // tolerance, or each is the other's nearest note in the other list. Every
  // other pairing costs Infinity, so the DP can never use a coincidental
  // pairing between unrelated notes to avoid an indel — which is what kept
  // the one-to-one, order-preserving mapping intact under the old crutch, but
  // now without defeating the drop+insert case.
  const INDEL_COST = 1

  const nearestExpectedForGiven: number[] =
    n > 0 ? given.map((g) => nearestIndex(g.startTick, expected)) : []
  const nearestGivenForExpected: number[] =
    m > 0 ? expected.map((e) => nearestIndex(e.startTick, given)) : []

  // cost[i][j]: minimum edits aligning expected[0..i) with given[0..j).
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  const pairs: (PairVerdict | undefined)[][] = Array.from({ length: n }, () =>
    new Array<PairVerdict | undefined>(m).fill(undefined),
  )

  for (let i = 1; i <= n; i++) at(cost, i)[0] = i * INDEL_COST
  for (let j = 1; j <= m; j++) at(cost, 0)[j] = j * INDEL_COST

  for (let i = 1; i <= n; i++) {
    const e = at(expected, i - 1)
    const row = at(cost, i)
    const prevRow = at(cost, i - 1)
    const pairRow = at(pairs, i - 1)
    for (let j = 1; j <= m; j++) {
      const g = at(given, j - 1)
      const pair = classifyPair(e, g, toleranceTicks, gradePitch)
      pairRow[j - 1] = pair
      // Allowed only when each note is the other's nearest note in time — the
      // structural "this is clearly the same note" test. A plain within-
      // tolerance test (without the mutual-nearest requirement) is not
      // enough: two adjacent notes in a busy passage can be within tolerance
      // of each other's onset without either being the true match, which
      // would let the DP swap in a coincidentally-matching neighbour instead
      // of a real substitution — exactly the shift this gate exists to rule
      // out (see the transposition test).
      const pairAllowed =
        at(nearestExpectedForGiven, j - 1) === i - 1 && at(nearestGivenForExpected, i - 1) === j - 1
      const subCost = pair.status === 'correct' ? 0 : 1
      const diag = pairAllowed ? at(prevRow, j - 1) + subCost : Infinity
      const del = at(prevRow, j) + INDEL_COST
      const ins = at(row, j - 1) + INDEL_COST
      row[j] = Math.min(diag, del, ins)
    }
  }

  const results: DictationNoteResult[] = []
  let pitchHits = 0
  let rhythmHits = 0
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const here = at(at(cost, i), j)
    if (i > 0 && j > 0) {
      const pair = at(at(pairs, i - 1), j - 1)
      invariant(pair !== undefined, 'alignDictation: missing cached pair classification')
      // Allowed only when each note is the other's nearest note in time — the
      // structural "this is clearly the same note" test. A plain within-
      // tolerance test (without the mutual-nearest requirement) is not
      // enough: two adjacent notes in a busy passage can be within tolerance
      // of each other's onset without either being the true match, which
      // would let the DP swap in a coincidentally-matching neighbour instead
      // of a real substitution — exactly the shift this gate exists to rule
      // out (see the transposition test).
      const pairAllowed =
        at(nearestExpectedForGiven, j - 1) === i - 1 && at(nearestGivenForExpected, i - 1) === j - 1
      const subCost = pair.status === 'correct' ? 0 : 1
      if (pairAllowed && here === at(at(cost, i - 1), j - 1) + subCost) {
        if (pair.pitchMatch) pitchHits += 1
        if (pair.onsetMatch) rhythmHits += 1
        results.push({
          status: pair.status,
          expectedIndex: i - 1,
          givenIndex: at(givenOriginalIndex, j - 1),
        })
        i -= 1
        j -= 1
        continue
      }
    }
    if (i > 0 && here === at(at(cost, i - 1), j) + INDEL_COST) {
      results.push({ status: 'missing', expectedIndex: i - 1 })
      i -= 1
      continue
    }
    invariant(j > 0, 'alignDictation: backtrack ran out of given notes to explain the cost')
    results.push({ status: 'extra', givenIndex: at(givenOriginalIndex, j - 1) })
    j -= 1
  }
  results.reverse()
  return { results, pitchHits, rhythmHits }
}

/**
 * The single scale factor that best explains the answer's onsets as the expected onsets played
 * uniformly faster or slower (roadmap 3.23, REQ-3.6.1). Returns exactly `1` (no adjustment)
 * whenever a scale cannot meaningfully be fit:
 *
 *  - `expected.length !== given.length`: a missing or extra note means the alignment itself is
 *    already ambiguous — that is what `alignDictation`'s edit-distance search is for. Fitting a
 *    scale against a note count that does not even match would be fitting noise, not tempo, and
 *    every existing missing/extra/drop-and-insert test relies on this fallback to stay unchanged.
 *  - `expected.length < 2`: a single note (or none) has no onset GAP to measure a tempo from.
 *
 * The fit is over each list's own offsets from its own first element — `expected[i] -
 * expected[0]` against `given[i] - given[0]` — never the raw onset ticks. That is deliberate: it
 * makes the fit blind to a constant additive offset between the two lists (every gap stays the
 * same size under a pure shift, so the least-squares slope comes out to exactly `1` no matter how
 * large the shift), and sensitive only to a genuine uniform stretch or compression of the gaps
 * between notes — which is what "played at a different tempo" actually means, as opposed to
 * "played late". A phrase shifted by a fixed number of ticks (not a tempo difference at all) is
 * NOT rescued by this fit — see the "a paired note with matching pitch but an out-of-tolerance
 * onset grades wrong-rhythm" test, built from exactly such a shift, which stays wrong-rhythm on
 * every note after this change.
 *
 * The closed-form ordinary-least-squares slope through the origin of those offset pairs
 * (`sum(oe*og) / sum(oe*oe)`) is the "single best scale factor" — clamped to
 * `[1/maxTempoScale, maxTempoScale]`, never left unbounded. `maxTempoScale: 1` collapses the
 * clamp to a single point, forcing the result to exactly `1` regardless of the data: the caller's
 * way of asking for the pre-3.23 behaviour verbatim.
 */
function fitTempoScale(
  expected: readonly ExpectedNote[],
  given: readonly DictationAnswerNote[],
  maxTempoScale: number,
): number {
  if (expected.length !== given.length || expected.length < 2) return 1
  const anchorE = at(expected, 0).startTick
  const anchorG = at(given, 0).startTick
  let sumOeOe = 0
  let sumOeOg = 0
  for (let i = 1; i < expected.length; i++) {
    const oe = at(expected, i).startTick - anchorE
    const og = at(given, i).startTick - anchorG
    sumOeOe += oe * oe
    sumOeOg += oe * og
  }
  if (sumOeOe === 0) return 1
  const raw = sumOeOg / sumOeOe
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const minScale = 1 / maxTempoScale
  return Math.min(maxTempoScale, Math.max(minScale, raw))
}

/**
 * `expected`, with every onset rescaled by `scale` around `expected[0]`'s own onset — the
 * comparison list `gradeDictation` actually aligns the answer against once a tempo scale has been
 * fit. Anchored at `expected`'s own first note, never `given`'s: that is what keeps a constant
 * offset between the two lists from being silently absorbed into the "tempo" explanation (see
 * `fitTempoScale`'s own doc) — only the fitted scale moves the comparison list, never a shift.
 * `scale === 1` returns `expected` itself, unchanged, not a recomputed copy, so a caller that
 * pins `maxTempoScale: 1` (or an answer that is already at the prompt's own tempo, where the fit
 * lands on exactly `1`) gets bit-for-bit the pre-3.23 comparison, not a floating-point-adjacent
 * one.
 */
function scaleExpected(expected: readonly ExpectedNote[], scale: number): readonly ExpectedNote[] {
  const anchor = expected[0]
  if (anchor === undefined || scale === 1) return expected
  const anchorTick = anchor.startTick
  return expected.map((n) => ({
    midi: n.midi,
    startTick: asTicks(anchorTick + scale * (n.startTick - anchorTick)),
  }))
}

/** Missing/extra notes in `a` — see `betterAlignment`'s own doc for why this is the primary
 *  quality signal, ahead of onset accuracy. */
function structuralMismatchCount(a: AlignResult): number {
  return a.results.filter((r) => r.status === 'missing' || r.status === 'extra').length
}

/**
 * Whichever of `scaled`/`raw` is the better structural explanation of the same answer (roadmap
 * 3.23). `fitTempoScale` fits its scale from simple index-paired offsets — a cheap, order-only
 * correspondence that assumes `given[i]` really does answer `expected[i]`. That assumption holds
 * for a genuine uniform-tempo difference (both lists have the same notes, in the same order, just
 * timed differently), but not for an answer that drops one note and appends an unrelated one: the
 * counts happen to still match, so `fitTempoScale` still returns a number, but it is fit against a
 * garbage correspondence and can drag several unrelated notes out of tolerance along with it — see
 * the "dropping one note and appending a spurious one" test, which is exactly this shape and
 * regressed without this check.
 *
 * So the fit is never trusted blind: both the raw and the scaled alignment are actually run, and
 * this picks the better one. Fewer missing/extra notes wins outright — `alignDictation`'s own cost
 * model already makes an indel the DP's last resort (see the module doc), so a missing/extra pair
 * appearing is exactly what "this scale does not actually explain the data" looks like; a tempo
 * scale must never be allowed to paper over a genuinely different note count or correspondence. A
 * tie on that count is broken by more onsets landing inside tolerance — the resurrection this
 * feature exists to make. `raw` wins every further tie, so a scale that does not demonstrably help
 * is never preferred over the pre-3.23 result.
 */
function betterAlignment(scaled: AlignResult, raw: AlignResult): AlignResult {
  const scaledMismatch = structuralMismatchCount(scaled)
  const rawMismatch = structuralMismatchCount(raw)
  if (scaledMismatch !== rawMismatch) return scaledMismatch < rawMismatch ? scaled : raw
  return scaled.rhythmHits > raw.rhythmHits ? scaled : raw
}

/**
 * Grade a played-back answer against a dictation item's prompt, note by note.
 * See the module doc for the alignment strategy. `item.prompt.notes` is
 * always sorted by onset (a `Score` invariant), so `expectedIndex` in the
 * output is a direct index into it; `answer` is sorted internally before
 * grading, and `givenIndex` is mapped back to the caller's original array
 * position.
 *
 * @public — the grading half of this module's live generate/grade pair.
 * `generateMelodicDictation`/`generateRhythmicDictation` and `gradeDictation`
 * are all wired into `app/eartraining/useEarTraining.ts` (roadmap 3.11):
 * `pressDictationNote`/`submitDictation` build the `answer` this takes,
 * `EarAnswer`'s `'dictation'` variant carries it through, and the graded
 * result flows through the same `recordEarAttempt` call every other drill
 * answer does.
 */
export function gradeDictation(
  item: EarItem,
  answer: readonly DictationAnswerNote[],
  opts?: DictationGradeOptions,
): DictationGrade {
  const toleranceTicks = opts?.toleranceTicks ?? DEFAULT_TOLERANCE_TICKS
  invariant(
    Number.isFinite(toleranceTicks) && toleranceTicks >= 0,
    `gradeDictation: toleranceTicks must be a finite number >= 0, got ${toleranceTicks}`,
  )
  const maxTempoScale = opts?.maxTempoScale ?? DEFAULT_MAX_TEMPO_SCALE
  invariant(
    Number.isFinite(maxTempoScale) && maxTempoScale >= 1,
    `gradeDictation: maxTempoScale must be a finite number >= 1, got ${maxTempoScale}`,
  )
  const gradePitch = item.kind !== 'rhythmic-dictation'

  const rawExpected: readonly ExpectedNote[] = item.prompt.notes.map((n) => ({
    midi: n.midi,
    startTick: n.startTick,
  }))

  const order = answer.map((_, index) => index)
  order.sort((a, b) => at(answer, a).startTick - at(answer, b).startTick)
  const sortedGiven = order.map((originalIndex) => at(answer, originalIndex))

  // REQ-3.6.1 (roadmap 3.23): try the tempo-scaled expected onsets against the raw written ones
  // and keep whichever aligns better — see fitTempoScale's and betterAlignment's own docs for
  // exactly what this does and does not forgive, and why the fit alone is never trusted blind.
  const tempoScale = fitTempoScale(rawExpected, sortedGiven, maxTempoScale)
  const rawAligned = alignDictation(rawExpected, sortedGiven, order, toleranceTicks, gradePitch)
  const { results, pitchHits, rhythmHits } =
    tempoScale === 1
      ? rawAligned
      : betterAlignment(
          alignDictation(
            scaleExpected(rawExpected, tempoScale),
            sortedGiven,
            order,
            toleranceTicks,
            gradePitch,
          ),
          rawAligned,
        )

  const total = rawExpected.length
  const rhythmAccuracy = total === 0 ? (answer.length === 0 ? 1 : 0) : rhythmHits / total
  const pitchAccuracy = gradePitch
    ? total === 0
      ? answer.length === 0
        ? 1
        : 0
      : pitchHits / total
    : rhythmAccuracy
  const correct = results.every((r) => r.status === 'correct')

  return {
    correct,
    expected: item.answerKey,
    given: notesKey(answer, gradePitch),
    notes: results,
    pitchAccuracy,
    rhythmAccuracy,
  }
}
