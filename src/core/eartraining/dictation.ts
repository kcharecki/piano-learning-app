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
 */
import { at, invariant } from '@core/shared/invariant.ts'
import {
  defaultParamsForLevel,
  generateMelody,
  type GeneratorParams,
} from '@core/generator/melody.ts'
import { generateRhythm, rhythmToScore, type RhythmParams, type RhythmPattern } from '@core/generator/rhythm.ts'
import type { TimeSignature } from '@core/notation/score.ts'
import { keyName, type Key } from '@core/theory/keys.ts'
import type { EarGrade, EarItem } from '@core/eartraining/item.ts'
import { midi as asMidi, EIGHTH, type Midi, type Ticks } from '@core/shared/units.ts'
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
 * A melodic dictation phrase: a single-hand melody from {@link generateMelody},
 * reusing the level ladder from {@link defaultParamsForLevel} and overriding
 * only what `opts` states. `hands` is forced to `'right'` regardless of the
 * level's own default — dictation grades one monophonic line, and the answer
 * type (`DictationAnswerNote`) has no hand to disambiguate a second one.
 */
export function generateMelodicDictation(level: number, opts: DictationOptions, rng: Rng): EarItem {
  const defaults = defaultParamsForLevel(level)
  const key = opts.key ?? defaults.key
  const bars = opts.bars ?? defaults.bars
  const range: Range = opts.range ?? defaults.rightRange

  const params: GeneratorParams = {
    ...defaults,
    key,
    bars,
    hands: 'right',
    rightRange: range,
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
  const score = result.value
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
 */
export function generateRhythmicDictation(
  level: number,
  opts: DictationOptions,
  rng: Rng,
): EarItem {
  const defaults = defaultParamsForLevel(level)
  const bars = opts.bars ?? defaults.bars
  const range: Range = opts.range ?? defaults.rightRange
  const complexity = clampComplexity(level)
  const timeSignature: TimeSignature = defaults.timeSignature

  const rhythmParams: RhythmParams = {
    bars,
    timeSignature,
    complexity,
    allowRests: complexity >= 2,
    allowTies: complexity >= 4,
  }
  const pattern: RhythmPattern = generateRhythm(rhythmParams, rng)
  const pitch = asMidi(Math.round((range.low + range.high) / 2))
  const score = rhythmToScore(pattern, { midi: pitch })

  const onsetTicks = pattern.onsets.filter((o) => !o.isRest).map((o) => o.tick)
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
}

const DEFAULT_TOLERANCE_TICKS: Ticks = EIGHTH

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
 * Grade a played-back answer against a dictation item's prompt, note by note.
 * See the module doc for the alignment strategy. `item.prompt.notes` is
 * always sorted by onset (a `Score` invariant), so `expectedIndex` in the
 * output is a direct index into it; `answer` is sorted internally before
 * grading, and `givenIndex` is mapped back to the caller's original array
 * position.
 *
 * @public — the grading half of this module's live generate/grade pair.
 * `generateMelodicDictation`/`generateRhythmicDictation` are already wired
 * into `app/eartraining/useEarTraining.ts`; `gradeDictation` is not yet, only
 * because `EarAnswer` has no answer variant for dictation items yet — see
 * that module's own comment and ROADMAP.md 3.10/3.11. Not abandoned, just
 * pending the answer-input UI.
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
  const gradePitch = item.kind !== 'rhythmic-dictation'

  const expected: readonly ExpectedNote[] = item.prompt.notes.map((n) => ({
    midi: n.midi,
    startTick: n.startTick,
  }))

  const order = answer.map((_, index) => index)
  order.sort((a, b) => at(answer, a).startTick - at(answer, b).startTick)
  const sortedGiven = order.map((originalIndex) => at(answer, originalIndex))

  const { results, pitchHits, rhythmHits } = alignDictation(
    expected,
    sortedGiven,
    order,
    toleranceTicks,
    gradePitch,
  )

  const total = expected.length
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
