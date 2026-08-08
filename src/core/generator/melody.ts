/**
 * Sight-reading generator (REQ-3.4.2, REQ-5.3) — parameterised random melodies
 * so the trainer never runs out of unseen material.
 *
 * The output is a real {@link Score}, built through {@link makeScore} so it is
 * guaranteed to pass {@link validateScore} and can be played by the transport
 * and judged by the matcher exactly like an imported MusicXML file.
 *
 * Design, in one paragraph: pick a rhythm for each bar first (a list of note
 * durations, in sixteenth-note units, that always sums to the bar exactly —
 * see {@link buildBarDurations}), then walk a pitch line across those durations
 * with a weighted random walk that prefers small steps, occasionally leaps (up
 * to `maxLeapSemitones`), and occasionally strays outside the key
 * (`accidentalDensity`). The last note of the piece is always pulled onto the
 * tonic. A second hand, when requested, either gets its own independent line
 * or is derived from the first (doubled, parallel third, or block chords).
 *
 * `stepwiseOneDirection` (level 1 only, roadmap 5.11) replaces that walk
 * entirely: RCM Preparatory A's "four-note melody, moving by step in one
 * direction only" is not a constrained random walk, it is a contiguous run
 * of the key's own scale tones, read forward or backward. There is no
 * cadence back onto the tonic in this mode — a four-note run has no room for
 * one — so the "always ends on tonic" guarantee above applies only when
 * `stepwiseOneDirection` is unset.
 *
 * Every search in this file (`nearestValid`, `buildBarDurations`) is bounded
 * by construction, so `generateMelody` always terminates. When a parameter
 * combination cannot be satisfied — the range is too narrow to hold any note
 * of the key, say — the relevant search comes back empty and the function
 * returns an `Err` rather than spinning or producing an invalid Score.
 */
import { at, assertNever, invariant } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { TICKS_PER_QUARTER, type Midi } from '@core/shared/units.ts'
import { pickWeighted, type Rng } from '@core/ports/rng.ts'
import { spelledPitchClass, type SpelledPitch } from '@core/theory/pitch.ts'
import { buildScale } from '@core/theory/scales.ts'
import { keyName, type Key } from '@core/theory/keys.ts'
import {
  makeScore,
  measureDurationTicks,
  type Hand,
  type Score,
  type ScoreNoteInput,
  type TimeSignature,
} from '@core/notation/score.ts'
import { generateStepwiseOneDirectionLine } from './stepwiseLine.ts'

export type RhythmStyle = 'whole-half' | 'quarters' | 'eighths' | 'dotted' | 'syncopated'
export type HandIndependence = 'unison' | 'parallel' | 'blocked-chords' | 'independent'
export type MidiRange = { readonly low: Midi; readonly high: Midi }

export type GeneratorParams = {
  readonly key: Key
  readonly bars: number
  readonly timeSignature: TimeSignature
  readonly hands: 'right' | 'left' | 'both'
  readonly rightRange: MidiRange
  readonly leftRange?: MidiRange
  readonly rhythm: RhythmStyle
  readonly maxLeapSemitones: number
  readonly accidentalDensity: number
  readonly handIndependence: HandIndependence
  /** Level 1 only: a contiguous run of scale tones in one direction, no leaps, no cadence steering. */
  readonly stepwiseOneDirection?: boolean
}

/** One generated note, before it is stamped with a hand and fed to `makeScore`. */
export type PlacedNote = {
  readonly startTick: number
  readonly durationTicks: number
  readonly midi: number
}

/** One bar's worth of sixteenth-note units. `GRID` ticks per unit. */
const GRID = TICKS_PER_QUARTER / 4

/** Bounded octave search radius for `nearestValid` — 8 octaves either way is far past any piano range. */
const MAX_SEARCH_RADIUS = 96

/**
 * Flat `[units, weight, units, weight, ...]` pairs, in sixteenth-note units.
 * Every pool carries a weight-1 single-sixteenth entry so
 * {@link buildBarDurations} can always finish a bar exactly, however the
 * larger values happen to divide it.
 */
type Pool = readonly number[]
const RHYTHM_POOLS: Readonly<Record<RhythmStyle, Pool>> = {
  'whole-half': [16, 3, 12, 2, 8, 4, 4, 2, 1, 1],
  quarters: [4, 6, 8, 2, 2, 2, 1, 1],
  eighths: [2, 6, 4, 3, 1, 2],
  dotted: [6, 4, 3, 3, 4, 2, 2, 2, 1, 1],
  syncopated: [3, 4, 1, 3, 2, 3, 4, 1],
}

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------

/** 0–11, wrapping negative input the way `%` alone does not. */
function pc(n: number): number {
  return ((n % 12) + 12) % 12
}

/**
 * The closest integer to `target` that lies in `range`, matches `allowedPcs`
 * (when given) and is within `maxLeap` of `prev` (when both are given).
 * Search radius is capped at {@link MAX_SEARCH_RADIUS}, so this always
 * terminates; `undefined` means no such note exists — the caller's signal to
 * return an `Err`.
 */
function nearestValid(
  target: number,
  range: MidiRange,
  opts: {
    readonly prev?: number
    readonly maxLeap?: number
    readonly allowedPcs?: ReadonlySet<number>
  },
): number | undefined {
  for (let radius = 0; radius <= MAX_SEARCH_RADIUS; radius++) {
    const candidates = radius === 0 ? [target] : [target - radius, target + radius]
    for (const candidate of candidates) {
      if (candidate < range.low || candidate > range.high) continue
      if (opts.allowedPcs !== undefined && !opts.allowedPcs.has(pc(candidate))) continue
      if (
        opts.prev !== undefined &&
        opts.maxLeap !== undefined &&
        Math.abs(candidate - opts.prev) > opts.maxLeap
      ) {
        continue
      }
      return candidate
    }
  }
  return undefined
}

/**
 * A bar's durations, in sixteenth-note units, drawn from `style`'s pool and
 * guaranteed to sum to exactly `barUnits`. Terminates in at most `barUnits`
 * iterations: every draw removes at least one unit, and the pool's weight-1
 * entry keeps at least one option available whenever `remaining >= 1`.
 */
function buildBarDurations(barUnits: number, style: RhythmStyle, rng: Rng): readonly number[] {
  const pool = RHYTHM_POOLS[style]
  const out: number[] = []
  let remaining = barUnits
  while (remaining > 0) {
    const options: (readonly [number, number])[] = []
    for (let i = 0; i < pool.length; i += 2) {
      const units = at(pool, i)
      if (units <= remaining) options.push([units, at(pool, i + 1)])
    }
    invariant(
      options.length > 0,
      `buildBarDurations: nothing in the '${style}' pool fits a remainder of ${remaining}`,
    )
    const units = pickWeighted(rng, options)
    out.push(units)
    remaining -= units
  }
  return out
}

/** Weight of a melodic step of `d` semitones — favours steps, allows the occasional leap. */
function stepWeight(d: number): number {
  const a = Math.abs(d)
  if (a === 0) return 1
  if (a <= 2) return 6
  if (a <= 4) return 3
  return Math.max(1, 6 - a)
}

/**
 * The next note of a melodic random walk from `prev`. Tries the requested
 * category (chromatic or diatonic) first, falls back to the other, and falls
 * back again to repeating `prev` — which is always legal, since `prev` is
 * already known to be in range. So this never fails to produce a value.
 */
function pickNextMelodic(
  rng: Rng,
  prev: number,
  range: MidiRange,
  maxLeap: number,
  scalePcs: ReadonlySet<number>,
  wantChromatic: boolean,
  preferStable: boolean,
  stablePcs: ReadonlySet<number>,
): number {
  const candidatesFor = (chromatic: boolean): (readonly [number, number])[] => {
    const out: (readonly [number, number])[] = []
    for (let d = -maxLeap; d <= maxLeap; d++) {
      const candidate = prev + d
      if (candidate < range.low || candidate > range.high) continue
      const inScale = scalePcs.has(pc(candidate))
      if (chromatic === inScale) continue
      let weight = stepWeight(d)
      if (preferStable && !chromatic && stablePcs.has(pc(candidate))) weight *= 3
      out.push([candidate, weight])
    }
    return out
  }
  const primary = candidatesFor(wantChromatic)
  const options = primary.length > 0 ? primary : candidatesFor(!wantChromatic)
  return options.length > 0 ? pickWeighted(rng, options) : prev
}

/**
 * One note of a walk that is *required* to be within `budgetAfter` semitones
 * of `target` once this note is placed — used to close the cadence gradually
 * across the final bar instead of gambling everything on the last note.
 *
 * Tries the same chromatic/diatonic preference as {@link pickNextMelodic},
 * both narrowed to the budget; if neither has an option, falls back to moving
 * straight toward `target` by up to `maxLeap`. That fallback always exists —
 * it never leaves `range` (it lies between two points already known to be
 * inside it) and always meets the budget, *provided* the caller maintains the
 * invariant `|prev - target| <= (budgetAfter + maxLeap)` before calling. The
 * loop in {@link generateMelodicLine} sets that up and preserves it step by
 * step, so this function itself cannot fail.
 */
function pickSteeredNote(
  rng: Rng,
  prev: number,
  range: MidiRange,
  maxLeap: number,
  scalePcs: ReadonlySet<number>,
  wantChromatic: boolean,
  target: number,
  budgetAfter: number,
): number {
  const candidatesFor = (chromatic: boolean): (readonly [number, number])[] => {
    const out: (readonly [number, number])[] = []
    for (let d = -maxLeap; d <= maxLeap; d++) {
      const candidate = prev + d
      if (candidate < range.low || candidate > range.high) continue
      if (Math.abs(candidate - target) > budgetAfter) continue
      const inScale = scalePcs.has(pc(candidate))
      if (chromatic === inScale) continue
      out.push([candidate, stepWeight(d)])
    }
    return out
  }
  const primary = candidatesFor(wantChromatic)
  if (primary.length > 0) return pickWeighted(rng, primary)
  const secondary = candidatesFor(!wantChromatic)
  if (secondary.length > 0) return pickWeighted(rng, secondary)
  const delta = Math.max(-maxLeap, Math.min(maxLeap, target - prev))
  return prev + delta
}

// ---------------------------------------------------------------------------
// one melodic line
// ---------------------------------------------------------------------------

/**
 * A full melodic line across `bars` bars: rhythm drawn bar by bar from
 * `style`, pitches walked note by note within `range` and the key described
 * by `scalePcs`/`tonicPc`. The whole final bar steers gradually onto a
 * reachable tonic — see {@link pickSteeredNote} — landing there exactly on
 * the last note. `stepwiseOneDirection` bypasses all of that — see
 * {@link generateStepwiseOneDirectionLine}.
 */
function generateMelodicLine(
  rng: Rng,
  bars: number,
  ts: TimeSignature,
  style: RhythmStyle,
  range: MidiRange,
  scalePcs: ReadonlySet<number>,
  stablePcs: ReadonlySet<number>,
  tonicPc: number,
  accidentalDensity: number,
  maxLeap: number,
  stepwiseOneDirection = false,
): Result<readonly PlacedNote[], string> {
  if (stepwiseOneDirection) {
    return generateStepwiseOneDirectionLine(rng, bars, ts, range, scalePcs)
  }
  const barTicks = measureDurationTicks(ts)
  const barUnits = barTicks / GRID
  invariant(
    Number.isInteger(barUnits),
    `generateMelodicLine: ${barTicks} ticks is not a whole number of grid units`,
  )

  const rangeMid = Math.round((range.low + range.high) / 2)
  const start = nearestValid(rangeMid, range, { allowedPcs: scalePcs })
  if (start === undefined) {
    return err(`generateMelody: no note of this key fits inside range ${range.low}..${range.high}`)
  }
  const tonicOccurrences: number[] = []
  for (let m = range.low; m <= range.high; m++) if (pc(m) === tonicPc) tonicOccurrences.push(m)
  if (tonicOccurrences.length === 0) {
    return err(
      `generateMelody: no tonic pitch of the key fits inside range ${range.low}..${range.high}`,
    )
  }

  const barDurations = Array.from({ length: bars }, () => buildBarDurations(barUnits, style, rng))
  const out: PlacedNote[] = []
  let prev = start
  let tick = 0
  for (let b = 0; b < bars; b++) {
    const durations = at(barDurations, b)
    const isLastBar = b === bars - 1

    // Pick whichever tonic occurrence is closest to where the melody enters
    // this bar, as long as the bar has enough notes (at maxLeap each) to
    // actually reach it — otherwise this parameter set cannot cadence and the
    // caller gets an Err instead of a silently oversized final leap.
    let cadenceTarget = tonicOccurrences[0] as number
    if (isLastBar) {
      const budgetBefore = durations.length * maxLeap
      let bestDist = Infinity
      for (const t of tonicOccurrences) {
        const d = Math.abs(prev - t)
        if (d < bestDist) {
          bestDist = d
          cadenceTarget = t
        }
      }
      if (bestDist > budgetBefore) {
        return err(
          `generateMelody: cannot cadence onto the tonic within ${maxLeap} semitones per note over the final bar`,
        )
      }
    }

    for (let i = 0; i < durations.length; i++) {
      const durationTicks = at(durations, i) * GRID
      const isBarEnd = i === durations.length - 1
      const wantChromatic = rng.next() < accidentalDensity
      let pitch: number
      if (isLastBar) {
        const remainingAfterThis = durations.length - 1 - i
        pitch = pickSteeredNote(
          rng,
          prev,
          range,
          maxLeap,
          scalePcs,
          wantChromatic,
          cadenceTarget,
          remainingAfterThis * maxLeap,
        )
      } else {
        pitch = pickNextMelodic(
          rng,
          prev,
          range,
          maxLeap,
          scalePcs,
          wantChromatic,
          isBarEnd,
          stablePcs,
        )
      }
      out.push({ startTick: tick, durationTicks, midi: pitch })
      tick += durationTicks
      prev = pitch
    }
  }
  return ok(out)
}

// ---------------------------------------------------------------------------
// second hand
// ---------------------------------------------------------------------------

/**
 * The second hand for `'unison'` (same pitch class, transposed by a fixed
 * number of octaves so it sits in `range`) and `'parallel'` (a diatonic third
 * below when the source note is in the scale, a fixed chromatic echo when it
 * is not). Same rhythm as `source` either way.
 */
function doubleHand(
  source: readonly PlacedNote[],
  range: MidiRange,
  diatonicParallel: boolean,
  degreePcs: readonly number[],
): Result<readonly PlacedNote[], string> {
  const rangeMid = Math.round((range.low + range.high) / 2)
  const first = at(source, 0)
  const octaveShift = Math.round((rangeMid - first.midi) / 12) * 12

  const out: PlacedNote[] = []
  for (const n of source) {
    let target: number
    let allowedPc: number
    if (diatonicParallel) {
      const degree = degreePcs.indexOf(pc(n.midi))
      target = n.midi - 3
      allowedPc = degree === -1 ? pc(n.midi - 3) : at(degreePcs, (degree + 5) % degreePcs.length)
    } else {
      target = n.midi + octaveShift
      allowedPc = pc(n.midi)
    }
    const placed = nearestValid(target, range, { allowedPcs: new Set([allowedPc]) })
    if (placed === undefined) {
      const kind = diatonicParallel ? 'parallel' : 'unison'
      return err(`generateMelody: no ${kind} note fits inside range ${range.low}..${range.high}`)
    }
    out.push({ startTick: n.startTick, durationTicks: n.durationTicks, midi: placed })
  }
  return ok(out)
}

/**
 * One root-position triad per bar, walking a I–IV–V–I progression over the
 * scale degrees. `anchor` tracks the previous chord's root so the voicing
 * does not jump registers bar to bar.
 */
function generateBlockChords(
  bars: number,
  ts: TimeSignature,
  range: MidiRange,
  scaleNotes: readonly SpelledPitch[],
): Result<readonly PlacedNote[], string> {
  const barTicks = measureDurationTicks(ts)
  const degreePcs = scaleNotes.map(spelledPitchClass)
  const progression = [0, 3, 4, 0]
  const out: PlacedNote[] = []
  let anchor = Math.round((range.low + range.high) / 2)
  for (let b = 0; b < bars; b++) {
    const rootDegree = at(progression, b % progression.length)
    const thirdDegree = (rootDegree + 2) % degreePcs.length
    const fifthDegree = (rootDegree + 4) % degreePcs.length
    const root = nearestValid(anchor, range, { allowedPcs: new Set([at(degreePcs, rootDegree)]) })
    if (root === undefined)
      return err(`generateMelody: no chord root fits inside range ${range.low}..${range.high}`)
    const third = nearestValid(root + 3, range, {
      allowedPcs: new Set([at(degreePcs, thirdDegree)]),
    })
    const fifth = nearestValid(root + 7, range, {
      allowedPcs: new Set([at(degreePcs, fifthDegree)]),
    })
    if (third === undefined || fifth === undefined) {
      return err(`generateMelody: no triad fits inside range ${range.low}..${range.high}`)
    }
    const startTick = b * barTicks
    for (const pitch of [root, third, fifth])
      out.push({ startTick, durationTicks: barTicks, midi: pitch })
    anchor = root
  }
  return ok(out)
}

// ---------------------------------------------------------------------------
// validation and assembly
// ---------------------------------------------------------------------------

function validateParams(params: GeneratorParams): Result<true, string> {
  if (!Number.isInteger(params.bars) || params.bars < 1) {
    return err(`generateMelody: bars must be a positive integer, got ${params.bars}`)
  }
  if (!Number.isInteger(params.maxLeapSemitones) || params.maxLeapSemitones < 0) {
    return err(
      `generateMelody: maxLeapSemitones must be a non-negative integer, got ${params.maxLeapSemitones}`,
    )
  }
  if (
    !Number.isFinite(params.accidentalDensity) ||
    params.accidentalDensity < 0 ||
    params.accidentalDensity > 1
  ) {
    return err(
      `generateMelody: accidentalDensity must be within 0..1, got ${params.accidentalDensity}`,
    )
  }
  if (params.rightRange.low > params.rightRange.high) {
    return err('generateMelody: rightRange.low must be <= rightRange.high')
  }
  if (params.leftRange !== undefined && params.leftRange.low > params.leftRange.high) {
    return err('generateMelody: leftRange.low must be <= leftRange.high')
  }
  if (params.hands === 'both' && params.leftRange === undefined) {
    return err('generateMelody: hands is "both" but leftRange was not provided')
  }
  let barTicks: number
  try {
    barTicks = measureDurationTicks(params.timeSignature)
  } catch {
    return err(
      `generateMelody: invalid time signature ${params.timeSignature.beats}/${params.timeSignature.beatType}`,
    )
  }
  if (barTicks % GRID !== 0) {
    return err(
      `generateMelody: time signature ${params.timeSignature.beats}/${params.timeSignature.beatType} does not divide evenly into sixteenth notes`,
    )
  }
  return ok(true)
}

function scoreId(params: GeneratorParams): string {
  const ts = params.timeSignature
  return `generated:${keyName(params.key)}:${params.bars}b:${ts.beats}-${ts.beatType}:${params.rhythm}:${params.hands}:${params.handIndependence}`
}

function generateSecondHand(
  rng: Rng,
  params: GeneratorParams,
  primary: readonly PlacedNote[],
  range: MidiRange,
  scaleNotes: readonly SpelledPitch[],
  scalePcs: ReadonlySet<number>,
  stablePcs: ReadonlySet<number>,
  tonicPc: number,
): Result<readonly PlacedNote[], string> {
  const degreePcs = scaleNotes.map(spelledPitchClass)
  switch (params.handIndependence) {
    case 'independent':
      return generateMelodicLine(
        rng,
        params.bars,
        params.timeSignature,
        params.rhythm,
        range,
        scalePcs,
        stablePcs,
        tonicPc,
        params.accidentalDensity,
        params.maxLeapSemitones,
        params.stepwiseOneDirection ?? false,
      )
    case 'unison':
      return doubleHand(primary, range, false, degreePcs)
    case 'parallel':
      return doubleHand(primary, range, true, degreePcs)
    case 'blocked-chords':
      return generateBlockChords(params.bars, params.timeSignature, range, scaleNotes)
    default:
      return assertNever(params.handIndependence)
  }
}

/**
 * A random sight-reading melody satisfying `params`, reproducible from `rng`'s
 * seed. See the module doc for the generation strategy and the termination
 * argument.
 */
export function generateMelody(params: GeneratorParams, rng: Rng): Result<Score, string> {
  const validated = validateParams(params)
  if (!validated.ok) return validated

  const scaleType = params.key.mode === 'major' ? 'major' : 'naturalMinor'
  const scale = buildScale(params.key.tonic, scaleType)
  const degreePcs = scale.notes.map(spelledPitchClass)
  const scalePcs = new Set(degreePcs)
  const tonicPc = at(degreePcs, 0)
  const stablePcs = new Set([at(degreePcs, 0), at(degreePcs, 2), at(degreePcs, 4)])

  const primaryHand: Hand = params.hands === 'left' ? 'left' : 'right'
  const primaryRange =
    primaryHand === 'left' ? (params.leftRange ?? params.rightRange) : params.rightRange

  const primary = generateMelodicLine(
    rng,
    params.bars,
    params.timeSignature,
    params.rhythm,
    primaryRange,
    scalePcs,
    stablePcs,
    tonicPc,
    params.accidentalDensity,
    params.maxLeapSemitones,
    params.stepwiseOneDirection ?? false,
  )
  if (!primary.ok) return primary

  const notes: ScoreNoteInput[] = primary.value.map((n) => ({ ...n, hand: primaryHand }))

  if (params.hands === 'both') {
    const secondaryRange = params.leftRange
    invariant(
      secondaryRange !== undefined,
      'validateParams must reject hands "both" without leftRange',
    )
    const secondary = generateSecondHand(
      rng,
      params,
      primary.value,
      secondaryRange,
      scale.notes,
      scalePcs,
      stablePcs,
      tonicPc,
    )
    if (!secondary.ok) return secondary
    for (const n of secondary.value) notes.push({ ...n, hand: 'left' })
  }

  const measures = Array.from({ length: params.bars }, () => ({
    timeSignature: params.timeSignature,
    keyFifths: params.key.signature.fifths,
  }))

  return ok(
    makeScore({
      id: scoreId(params),
      meta: { title: `Sight Reading — ${keyName(params.key)}` },
      measures,
      notes,
    }),
  )
}

// ---------------------------------------------------------------------------
// level defaults (requirements.md section 2)
// ---------------------------------------------------------------------------

/** See `levelDefaults.ts` — split out so this file can stay under the line budget. */
export { defaultParamsForLevel, MAX_GENERATOR_LEVEL } from './levelDefaults.ts'

