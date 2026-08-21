/**
 * Rhythm-only pattern generation for tapping drills (roadmap 2.4, REQ-3.4.5,
 * REQ-3.6.2). One pitch, many onsets: the learner taps any key in time, so the
 * only thing that matters is *when*, not *what*. That is also what keeps
 * `gradeTapping` simple — it is a pure timing comparison, no pitch matching.
 *
 * ## How a bar is built
 *
 * A bar is never filled by picking random note values independently — that
 * produces bars that do not read as music. Instead generation happens in three
 * stages, all driven by the injected `Rng` so a seed always reproduces the same
 * pattern:
 *
 *  1. **Pulse partition** (fixed, not random) — the bar is divided into its
 *     natural metrical pulses: one per beat in a simple metre (`4/4` → four
 *     quarter pulses), or one per group of three eighths in a compound metre
 *     (`6/8` → two dotted-quarter pulses). This is what satisfies "compound
 *     metres must group in threes": the eighth-note grid inside a compound
 *     pulse is *always* three-eighths wide, never regrouped as two.
 *  2. **Merge** (random) — adjacent pulses are folded into one bigger chunk,
 *     which is how half notes and whole notes arise. Merging is *mandatory*
 *     while the accumulated chunk is still shorter than the complexity's
 *     minimum onset length, so `complexity: 1` (floor = a half note) reliably
 *     coalesces short pulses instead of ever emitting one; above the floor,
 *     merging is optional and its probability falls as complexity rises, so
 *     higher complexity naturally reads as busier.
 *  3. **Subdivide** (random) — each unmerged chunk recursively splits into a
 *     leaf (a note or, if `allowRests`, a rest) or a binary/ternary/dotted
 *     split, never past the complexity's floor. Ternary splitting is only
 *     offered on a chunk that is *exactly* one untouched compound pulse — the
 *     three-eighths grouping again — so it can never manufacture an
 *     off-grid duration like a bar-level triplet.
 *
 * A fourth, optional pass (`allowTies`, complexity 4+) merges adjacent
 * equal-length note onsets into one longer onset — a syncopated tie across
 * what would otherwise be a beat boundary. Because it only ever combines two
 * onsets that already partition the bar, the bar's total duration is
 * invariant under it.
 *
 * ## Dotted eligibility
 *
 * A "dotted" split turns a duration into a 2:1 pair (dotted note + remainder)
 * only when doing so lands on real note values: `duration / 3` must itself be
 * a power-of-two multiple of a sixteenth note. That rules out nonsense like
 * splitting a whole 4/4 bar (1920 ticks) into 1280+640 — 1920 is divisible by
 * 3, but 640 is not a note value — while still allowing 720 → 480 + 240
 * (dotted quarter, i.e. quarter tied to eighth) and 1440 → 960 + 480 (dotted
 * half tied to quarter).
 */
import {
  measureDurationTicks,
  makeScore,
  type Score,
  type TimeSignature,
} from '@core/notation/score.ts'
import type { Rng } from '@core/ports/index.ts'
import { randomInt } from '@core/ports/rng.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import {
  EIGHTH,
  HALF,
  QUARTER,
  SIXTEENTH,
  TICKS_PER_QUARTER,
  ticks as asTicks,
  midi as asMidi,
  type Midi,
  type Millis,
  type Ticks,
} from '@core/shared/units.ts'
import { tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { windowLimitMs } from '@core/timing/window.ts'

export type { TimeSignature }

export type RhythmParams = {
  readonly bars: number
  readonly timeSignature: TimeSignature
  /** 1 = whole/half notes only. 5 = sixteenths, syncopation, dotted figures, ties. */
  readonly complexity: 1 | 2 | 3 | 4 | 5
  readonly allowRests: boolean
  readonly allowTies: boolean
}

export type RhythmOnset = {
  readonly tick: Ticks
  readonly durationTicks: Ticks
  readonly isRest: boolean
}

export type RhythmPattern = {
  readonly timeSignature: TimeSignature
  readonly bars: number
  /** Sorted by `tick`, one bar after another; every bar's onsets sum to its own length. */
  readonly onsets: readonly RhythmOnset[]
}

export type TapGrade = {
  readonly matched: number
  readonly missed: number
  readonly extra: number
  /** `matched / (matched + missed + extra)`; 1 when there is nothing to grade. */
  readonly accuracy: number
  /** Mean |deviation| over matched taps, in ms; 0 when nothing matched. */
  readonly meanAbsDeviationMs: number
}

/** Half-width of the matching window `gradeTapping` uses when the caller states none. */
export const TAPPING_DEFAULTS = { toleranceMs: 150 } as const

const MIN_DURATION_BY_COMPLEXITY: Record<1 | 2 | 3 | 4 | 5, Ticks> = {
  1: QUARTER,
  2: QUARTER,
  3: EIGHTH,
  4: EIGHTH,
  5: SIXTEENTH,
}

/**
 * Ceiling on a single note's length, where one is named (roadmap 5.20). Only
 * complexity 1 has one: Faber/Alfred both teach quarter -> half -> whole, so
 * the lowest complexity must never reach a whole note — without a ceiling,
 * `mergePulses`'s optional-merge pass (below) will happily fold a whole bar
 * into one chunk. Complexities 2+ are unconstrained above, as before.
 */
const MAX_DURATION_BY_COMPLEXITY: Partial<Record<1 | 2 | 3 | 4 | 5, Ticks>> = {
  1: HALF,
}

/** Chance a chunk that has already met the floor merges with its neighbour anyway. */
const OPTIONAL_MERGE_CHANCE: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0.8,
  2: 0.35,
  3: 0.15,
  4: 0.05,
  5: 0,
}

/** Chance a chunk that could split does, rather than standing as one note/rest. */
const SUBDIVIDE_CHANCE: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0.5,
  2: 0.55,
  3: 0.6,
  4: 0.65,
  5: 0.7,
}

/** Chance two adjacent equal-length notes tie into a syncopated figure (complexity 4+). */
const SYNCOPATION_CHANCE: Record<4 | 5, number> = { 4: 0.15, 5: 0.3 }

/**
 * Chance a leaf is a rest, once `allowRests` is set. Complexity 1 is 0
 * (roadmap 5.20: note values come first, "rests enter after note values are
 * secure") — every other complexity keeps the flat 0.25 this replaced.
 * Because `MIN_DURATION_BY_COMPLEXITY[2]` is `QUARTER`, complexity 2 is also
 * where the *shortest* rest a learner can meet is guaranteed to be a quarter
 * rest, not an eighth or sixteenth — matching Faber/Alfred's quarter-rest-
 * first ordering without a second table to keep in sync.
 */
const REST_PROBABILITY: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0,
  2: 0.25,
  3: 0.25,
  4: 0.25,
  5: 0.25,
}

type Chunk = { readonly ticks: number; readonly pulses: number }
type DraftOnset = { tick: number; durationTicks: number; isRest: boolean }

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

/** A "plain" note value: a power-of-two multiple of a sixteenth (sixteenth, eighth, quarter, …). */
function isPlainValue(duration: number): boolean {
  return duration > 0 && duration % SIXTEENTH === 0 && isPowerOfTwo(duration / SIXTEENTH)
}

/** A "dotted" note value: three times a plain value (dotted eighth, dotted quarter, …). */
function isDottedValue(duration: number): boolean {
  return (
    duration > 0 && duration % (3 * SIXTEENTH) === 0 && isPowerOfTwo(duration / (3 * SIXTEENTH))
  )
}

/**
 * Would this be a note value if it stood alone? Merging pulses only ever
 * combines whole pulses, so most merged chunks land here automatically — the
 * one exception is an odd count of merged compound pulses (e.g. three
 * dotted-quarter pulses = 2160 ticks), which is a real duration but not one
 * that halves into anything notatable. Splitting is guarded by this so such a
 * chunk is left as a single leaf instead of being cut into a non-value like
 * 1080 ticks.
 */
function isNoteValue(duration: number): boolean {
  return isPlainValue(duration) || isDottedValue(duration)
}

/**
 * `6/8`, `9/8`, `12/8`, … — beats group into threes of an eighth note.
 * `3/8` is excluded: three eighths *is* the whole bar there, so it is simple
 * triple time (one pulse, subdivided in three) rather than compound time
 * (several three-eighth pulses).
 */
function isCompoundMeter(ts: TimeSignature): boolean {
  return ts.beatType === 8 && ts.beats % 3 === 0 && ts.beats > 3
}

/** Ticks in one metrical pulse: a beat in simple time, a dotted-quarter group in compound time. */
function pulseTicksOf(ts: TimeSignature): number {
  return isCompoundMeter(ts) ? 3 * EIGHTH : (4 * TICKS_PER_QUARTER) / ts.beatType
}

/** How many pulses make up the bar. */
function pulseCountOf(ts: TimeSignature): number {
  return isCompoundMeter(ts) ? ts.beats / 3 : ts.beats
}

// ------------------------------------------------------------- pulse merging

/**
 * Fold the bar's pulses into chunks. Merging is mandatory while a chunk is
 * still under `minDuration`, then optional (for musical variety, biased by
 * complexity) once it has cleared the floor. A chunk can only end up short of
 * the floor if it is forced to stop by running out of pulses entirely — which,
 * because `minDuration` is clamped to the bar length by the caller, can only
 * happen to a *trailing* chunk with an earlier chunk to fold into.
 */
function mergePulses(
  pulseTicks: number,
  pulseCount: number,
  minDuration: number,
  maxDuration: number,
  complexity: 1 | 2 | 3 | 4 | 5,
  rng: Rng,
): Chunk[] {
  const chunks: Chunk[] = []
  let i = 0
  while (i < pulseCount) {
    let curTicks = pulseTicks
    let curPulses = 1
    i += 1
    while (curTicks < minDuration && i < pulseCount) {
      curTicks += pulseTicks
      curPulses += 1
      i += 1
    }
    // Lookahead (`curTicks + pulseTicks`, not just `curTicks`), because a
    // single pulse can already sit close to `maxDuration` (a compound metre's
    // dotted-quarter pulse against complexity 1's half-note ceiling) — a
    // plain "am I under the ceiling yet" check would let one more whole
    // pulse merge in and overshoot it.
    while (
      i < pulseCount &&
      curTicks + pulseTicks <= maxDuration &&
      rng.next() < OPTIONAL_MERGE_CHANCE[complexity]
    ) {
      curTicks += pulseTicks
      curPulses += 1
      i += 1
    }
    chunks.push({ ticks: curTicks, pulses: curPulses })
  }
  const last = chunks[chunks.length - 1]
  if (chunks.length > 1 && last !== undefined && last.ticks < minDuration) {
    const prev = at(chunks, chunks.length - 2)
    chunks.splice(chunks.length - 2, 2, {
      ticks: prev.ticks + last.ticks,
      pulses: prev.pulses + last.pulses,
    })
  }
  return chunks
}

// ---------------------------------------------------------------- subdivide

/** One note or rest. Rests only ever appear when `allowRests` is set. */
function emitLeaf(
  tick: number,
  duration: number,
  allowRests: boolean,
  complexity: 1 | 2 | 3 | 4 | 5,
  rng: Rng,
  out: DraftOnset[],
): void {
  const isRest = allowRests && rng.next() < REST_PROBABILITY[complexity]
  out.push({ tick, durationTicks: duration, isRest })
}

/**
 * Recursively fill `[tick, tick + duration)`.
 *
 * `chunkPulses` tracks how many whole metrical pulses this node still
 * represents cleanly: 1 once recursion is inside a single pulse (at which
 * point *any* split of it is automatically contained, so there is nothing
 * further to guard), or the pulse count for a node that still spans several
 * whole pulses (e.g. 2 for a merged pair of `6/8` dotted-quarter pulses). For
 * a multi-pulse node, a split is only offered "for free" when both children
 * remain whole-pulse multiples — a plain half note followed by a quarter note
 * inside a merged 3-pulse `3/4` bar, say. A split that would instead cross a
 * pulse boundary off-grid (half a compound pulse's worth into the next one)
 * is exactly what a tie is for, so it requires `allowTies`. Once such a split
 * is taken its children are off-grid anyway, so they are tagged
 * `chunkPulses = 1` too: the tie has already been spent for that branch,
 * nothing further down it needs gating.
 *
 * Ternary splitting is offered only when `chunkPulses === 1` *and*
 * `duration === pulseTicks` — a lone, still-whole compound pulse — which is
 * what keeps the eighth-note grid inside it exactly three-wide.
 */
function subdivide(
  tick: number,
  duration: number,
  chunkPulses: number,
  pulseTicks: number,
  compound: boolean,
  complexity: 1 | 2 | 3 | 4 | 5,
  minDuration: number,
  allowRests: boolean,
  allowTies: boolean,
  rng: Rng,
  out: DraftOnset[],
): void {
  const pulseSafe = (child: number): boolean =>
    allowTies || chunkPulses === 1 || child % pulseTicks === 0

  const half = duration / 2
  const canBinary =
    duration % 2 === 0 && half >= minDuration && isNoteValue(half) && pulseSafe(half)

  const canTernary =
    compound &&
    chunkPulses === 1 &&
    duration === pulseTicks &&
    duration % 3 === 0 &&
    duration / 3 >= minDuration

  const main = (duration * 2) / 3
  const remainder = duration / 3
  const canDotted =
    complexity >= 3 &&
    isDottedValue(duration) &&
    remainder >= minDuration &&
    pulseSafe(main) &&
    pulseSafe(remainder)

  const canSplit = canBinary || canTernary || canDotted
  if (!canSplit || rng.next() >= SUBDIVIDE_CHANCE[complexity]) {
    emitLeaf(tick, duration, allowRests, complexity, rng, out)
    return
  }

  const options: ('binary' | 'ternary' | 'dotted')[] = []
  if (canBinary) options.push('binary')
  if (canTernary) options.push('ternary')
  if (canDotted) options.push('dotted')
  const choice = at(options, randomInt(rng, 0, options.length - 1))

  const childPulses = (childDuration: number): number => {
    if (chunkPulses === 1) return 1
    if (childDuration % pulseTicks === 0) return childDuration / pulseTicks
    return 1
  }

  if (choice === 'binary') {
    const pulses = childPulses(half)
    const args = [
      pulseTicks,
      compound,
      complexity,
      minDuration,
      allowRests,
      allowTies,
      rng,
      out,
    ] as const
    subdivide(tick, half, pulses, ...args)
    subdivide(tick + half, half, pulses, ...args)
  } else if (choice === 'ternary') {
    const third = duration / 3
    const args = [
      pulseTicks,
      compound,
      complexity,
      minDuration,
      allowRests,
      allowTies,
      rng,
      out,
    ] as const
    for (let k = 0; k < 3; k++) {
      subdivide(tick + k * third, third, 1, ...args)
    }
  } else {
    emitLeaf(tick, main, allowRests, complexity, rng, out)
    emitLeaf(tick + main, remainder, allowRests, complexity, rng, out)
  }
}

/**
 * Tie adjacent, equal-length, non-rest onsets into one syncopated note.
 * Mutates `barOnsets` in place; total bar duration is unaffected since it only
 * ever combines two pieces that already partition the bar.
 */
function mergeSyncopation(barOnsets: DraftOnset[], complexity: 4 | 5, rng: Rng): void {
  const chance = SYNCOPATION_CHANCE[complexity]
  for (let i = 0; i < barOnsets.length - 1; i++) {
    const a = at(barOnsets, i)
    const b = at(barOnsets, i + 1)
    if (a.isRest || b.isRest) continue
    if (a.durationTicks !== b.durationTicks) continue
    if (a.tick + a.durationTicks !== b.tick) continue
    if (rng.next() < chance) {
      a.durationTicks += b.durationTicks
      barOnsets.splice(i + 1, 1)
      i -= 1
    }
  }
}

// -------------------------------------------------------------------- public

/**
 * Generate a rhythm pattern. Deterministic in `rng`: the same seed reproduces
 * the same pattern. Throws (programmer error) on a malformed metre or an
 * out-of-range `bars`/`complexity` — this is fed pre-validated drill config,
 * not raw user input.
 */
export function generateRhythm(params: RhythmParams, rng: Rng): RhythmPattern {
  const { bars, timeSignature, complexity, allowRests, allowTies } = params
  invariant(
    Number.isInteger(bars) && bars > 0,
    `generateRhythm: bars must be a positive integer, got ${bars}`,
  )
  invariant(
    Number.isInteger(complexity) && complexity >= 1 && complexity <= 5,
    `generateRhythm: complexity must be an integer 1..5, got ${complexity}`,
  )
  invariant(
    isPowerOfTwo(timeSignature.beatType),
    `generateRhythm: beat type ${timeSignature.beatType} is not a power of two`,
  )
  const barTicks = measureDurationTicks(timeSignature)
  const compound = isCompoundMeter(timeSignature)
  const pulseTicks = pulseTicksOf(timeSignature)
  const pulseCount = pulseCountOf(timeSignature)
  // Clamped so a metre shorter than the complexity's usual floor (e.g. 2/8 at
  // complexity 1) still produces something, rather than an impossible request.
  const minDuration = Math.min(MIN_DURATION_BY_COMPLEXITY[complexity], barTicks)
  const maxDuration = MAX_DURATION_BY_COMPLEXITY[complexity] ?? Number.POSITIVE_INFINITY

  const onsets: RhythmOnset[] = []
  let barStart = 0
  for (let b = 0; b < bars; b++) {
    const barOnsets: DraftOnset[] = []
    const chunks = mergePulses(pulseTicks, pulseCount, minDuration, maxDuration, complexity, rng)
    let tick = barStart
    for (const chunk of chunks) {
      subdivide(
        tick,
        chunk.ticks,
        chunk.pulses,
        pulseTicks,
        compound,
        complexity,
        minDuration,
        allowRests,
        allowTies,
        rng,
        barOnsets,
      )
      tick += chunk.ticks
    }
    if (allowTies && (complexity === 4 || complexity === 5)) {
      mergeSyncopation(barOnsets, complexity, rng)
    }
    for (const o of barOnsets) {
      onsets.push({
        tick: asTicks(o.tick),
        durationTicks: asTicks(o.durationTicks),
        isRest: o.isRest,
      })
    }
    barStart += barTicks
  }

  return {
    timeSignature: { beats: timeSignature.beats, beatType: timeSignature.beatType },
    bars,
    onsets,
  }
}

const DEFAULT_TAPPING_MIDI = 60

/**
 * Fallback title for a caller that has nothing more specific to say (roadmap
 * 5.56). `generateMelody` and `techniqueScore` were both given real titles by
 * roadmap 5.13 — "a generated score with no title engraves as 'Untitled
 * Score'" — but that pass never reached this function, so every one of ITS
 * callers (the sight-reading-style tap drill, the clap-back drill, and
 * `core/eartraining/dictation.ts`'s rhythmic dictation) kept engraving
 * untitled. Fixing it here, once, is what makes it a class fix rather than an
 * instance fix: a caller that knows more (a drill name, a complexity) should
 * pass `opts.title` and does (see `app/rhythm/useRhythmDrill.ts`,
 * `useClapbackDrill.ts`), but even a caller that does not is now structurally
 * unable to produce an empty `meta.title` through this function.
 */
function defaultRhythmTitle(pattern: RhythmPattern): string {
  const { beats, beatType } = pattern.timeSignature
  const bars = `${pattern.bars} bar${pattern.bars === 1 ? '' : 's'}`
  return `Rhythm pattern, ${bars} (${beats}/${beatType})`
}

/**
 * Render a rhythm pattern as a playable `Score`: one pitch (opts.midi, default
 * middle C) so it can be run through the same playback and matching machinery
 * as any other drill. Rests contribute no note. Notes never cross a bar,
 * because generation never produces an onset that does — `measureDurationTicks`
 * gives every measure the same length the pattern was built against.
 *
 * `opts.title` names the score for engraving (roadmap 5.56); a caller that
 * omits it still gets a real, non-empty title — see `defaultRhythmTitle`.
 */
export function rhythmToScore(
  pattern: RhythmPattern,
  opts?: { readonly midi?: Midi; readonly title?: string },
): Score {
  const pitch = opts?.midi ?? asMidi(DEFAULT_TAPPING_MIDI)
  const title = opts?.title ?? defaultRhythmTitle(pattern)
  const measures = Array.from({ length: pattern.bars }, () => ({
    timeSignature: pattern.timeSignature,
  }))
  const notes = pattern.onsets
    .filter((o) => !o.isRest)
    .map((o) => ({
      midi: pitch,
      startTick: o.tick,
      durationTicks: o.durationTicks,
      hand: 'right' as const,
    }))
  return makeScore({ id: 'rhythm', meta: { title }, measures, notes })
}

/**
 * Grade a tapping attempt against a pattern's onsets (rests excluded — there is
 * nothing to tap for a rest). This is a pure timing comparison: any key counts.
 *
 * Matching is global nearest-neighbour, not a left-to-right scan of the input
 * arrays: every (onset, tap) pair within `toleranceMs` is a candidate, sorted
 * by how close they are, and assigned greedily nearest-first — each onset and
 * each tap can be claimed at most once. That is what makes the result
 * independent of the order taps arrive in (they are sorted before matching),
 * turns a doubled tap into exactly one `extra` (its twin already claimed the
 * only onset within range), and a dropped tap into exactly one `missed`.
 */
export function gradeTapping(
  pattern: RhythmPattern,
  taps: readonly Millis[],
  tempo: TempoMap,
  opts?: { readonly toleranceMs?: number },
): TapGrade {
  const tolerance = opts?.toleranceMs ?? TAPPING_DEFAULTS.toleranceMs
  invariant(
    Number.isFinite(tolerance) && tolerance >= 0,
    `gradeTapping: toleranceMs must be a finite number >= 0, got ${tolerance}`,
  )

  const onsetMs = pattern.onsets
    .filter((o) => !o.isRest)
    .map((o) => Number(tickToMs(tempo, o.tick)))
    .sort((a, b) => a - b)
  const tapMs = [...taps].map(Number).sort((a, b) => a - b)
  // Not `tolerance`: both sides of this comparison are derived from the same
  // integer tick grid, and a tap exactly on the boundary lands a couple of
  // ULPs outside it. Roadmap T.15 — see `core/timing/window.ts`.
  const limit = windowLimitMs(tolerance, onsetMs, tapMs)

  type Candidate = { readonly oi: number; readonly ti: number; readonly dist: number }
  const candidates: Candidate[] = []
  let lo = 0
  for (let oi = 0; oi < onsetMs.length; oi++) {
    const o = at(onsetMs, oi)
    while (lo < tapMs.length && at(tapMs, lo) < o - limit) lo += 1
    for (let ti = lo; ti < tapMs.length; ti++) {
      const t = at(tapMs, ti)
      if (t > o + limit) break
      candidates.push({ oi, ti, dist: Math.abs(t - o) })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist || a.oi - b.oi || a.ti - b.ti)

  const onsetMatched = new Array<boolean>(onsetMs.length).fill(false)
  const tapMatched = new Array<boolean>(tapMs.length).fill(false)
  let matched = 0
  let deviationSum = 0
  for (const c of candidates) {
    if (at(onsetMatched, c.oi) || at(tapMatched, c.ti)) continue
    onsetMatched[c.oi] = true
    tapMatched[c.ti] = true
    matched += 1
    deviationSum += c.dist
  }

  const missed = onsetMs.length - matched
  const extra = tapMs.length - matched
  const total = matched + missed + extra
  return {
    matched,
    missed,
    extra,
    accuracy: total === 0 ? 1 : matched / total,
    meanAbsDeviationMs: matched === 0 ? 0 : deviationSum / matched,
  }
}
