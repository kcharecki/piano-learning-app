/**
 * Intervals — distance between two *written* pitches.
 *
 * An interval is two independent facts that must agree: a diatonic `number`
 * (how far apart the letters are, counting both endpoints) and a `quality`
 * (how the accidentals adjust that). Semitones alone cannot tell A4 from d5,
 * which is why every function here works from the spelling and treats the
 * semitone count as a derived value.
 *
 * Two conventions worth knowing before reading on:
 *
 *  - **Direction is by staff position first, sounding pitch second.** B#3 is
 *    written below C4 even though the two sound the same key, so
 *    `intervalDirection(C4, B#3)` is -1 and `intervalBetween` reports the
 *    diminished second between them. This is what makes the module's central
 *    law hold: for any two *distinct* spellings,
 *    `transposeSpelled(a, intervalBetween(a, b), intervalDirection(a, b))`
 *    reproduces `b` exactly, spelling included. The law is stated for distinct
 *    spellings because `intervalDirection` answers -1, 0 or 1 while
 *    `transposeSpelled` takes only 1 or -1: identical spellings give direction
 *    0, which is not a transposition direction at all — and the unison the pair
 *    measures reproduces `b` either way round.
 *  - **`intervalBetween` is unordered.** It always returns a non-negative
 *    number; the caller asks `intervalDirection` which way round the pair was.
 *
 * Measuring and transposing come in two forms. `intervalBetween` and
 * `transposeSpelled` throw, and are what every caller in the app uses today:
 * chord construction stacks intervals it already knows are legal on a root it
 * already knows is writable. {@link tryIntervalBetween} and
 * {@link tryTransposeSpelled} return a Result instead, and are the form to reach
 * for when the spellings come from outside rather than from a table — an
 * imported score really can contain Fb and B#, and no quality names the interval
 * between them. No import path measures intervals yet, so for now that pair has
 * no production caller and only the tests exercise it.
 */
import { at, InvariantError, invariant } from '@core/shared/invariant.ts'
import { err, ok, unwrap, type Result } from '@core/shared/result.ts'
import {
  type Alter,
  diatonicStep,
  type Letter,
  letterIndex,
  pitchName,
  spell,
  type SpelledPitch,
  spelledPitchClass,
} from './pitch.ts'

export type IntervalQuality =
  | 'diminished'
  | 'minor'
  | 'perfect'
  | 'major'
  | 'augmented'
  | 'doublyDiminished'
  | 'doublyAugmented'

/** number is the diatonic size counting both endpoints: 1 unison, 5 fifth, 8 octave, 9 ninth... */
export type Interval = {
  readonly number: number
  readonly quality: IntervalQuality
  readonly semitones: number
}

const SEMITONES_PER_OCTAVE = 12
const LETTERS_PER_OCTAVE = 7

/** Semitones spanned by the *major or perfect* form of each simple number, indexed by number - 1. */
const MAJOR_OR_PERFECT: readonly number[] = [0, 2, 4, 5, 7, 9, 11]

/**
 * The qualities a number can take, listed in ascending semitone order, and the
 * offset of the first of them from the major/perfect form. A quality's offset is
 * therefore `floor + index`, so both directions of the lookup are array
 * arithmetic over `IntervalQuality` values — no partial record, and nothing has
 * to be cast back from `string` the way `Object.entries` would force.
 *
 * 1, 4, 5 and 8 take the perfect family; 2, 3, 6 and 7 the imperfect one, which
 * is one station wider at the bottom because minor sits between diminished and
 * major.
 */
type QualityFamily = {
  readonly qualities: readonly IntervalQuality[]
  readonly floor: number
}

const PERFECT_FAMILY: QualityFamily = {
  qualities: ['doublyDiminished', 'diminished', 'perfect', 'augmented', 'doublyAugmented'],
  floor: -2,
}

const IMPERFECT_FAMILY: QualityFamily = {
  qualities: ['doublyDiminished', 'diminished', 'minor', 'major', 'augmented', 'doublyAugmented'],
  floor: -3,
}

const QUALITY_ABBREV: Record<IntervalQuality, string> = {
  perfect: 'P',
  major: 'M',
  minor: 'm',
  augmented: 'A',
  diminished: 'd',
  doublyAugmented: 'AA',
  doublyDiminished: 'dd',
}

const QUALITY_LONG: Record<IntervalQuality, string> = {
  perfect: 'perfect',
  major: 'major',
  minor: 'minor',
  augmented: 'augmented',
  diminished: 'diminished',
  doublyAugmented: 'doubly augmented',
  doublyDiminished: 'doubly diminished',
}

const ABBREV_TO_QUALITY: Record<string, IntervalQuality> = {
  P: 'perfect',
  M: 'major',
  m: 'minor',
  A: 'augmented',
  d: 'diminished',
  AA: 'doublyAugmented',
  dd: 'doublyDiminished',
}

/** Inversion swaps each quality with its mirror; perfect is its own mirror. */
const INVERTED_QUALITY: Record<IntervalQuality, IntervalQuality> = {
  perfect: 'perfect',
  major: 'minor',
  minor: 'major',
  augmented: 'diminished',
  diminished: 'augmented',
  doublyAugmented: 'doublyDiminished',
  doublyDiminished: 'doublyAugmented',
}

const NUMBER_NAMES: readonly string[] = [
  'unison',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'octave',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
]

/** Longest alternative first, so that `dd` and `AA` win over `d` and `A`. Case matters: m ≠ M. */
const INTERVAL_PATTERN = /^(dd|d|AA|A|P|M|m)(\d+)$/

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Semitones above the C of its own octave. Derived from pitch.ts so the two cannot drift. */
function naturalSemitone(letter: Letter): number {
  return spelledPitchClass(spell(letter, 0, 0))
}

/**
 * Sounding semitone number, unclamped. `toMidi` would refuse the out-of-range
 * intermediates that transposition legitimately produces, so the arithmetic is
 * repeated here — and cross-checked against `toMidi` in the tests.
 */
function sounding(p: SpelledPitch): number {
  return (p.octave + 1) * SEMITONES_PER_OCTAVE + naturalSemitone(p.letter) + p.alter
}

/** Position on the staff, ignoring accidentals: C4 is 28, B3 is 27, D4 is 29. */
function staffPosition(p: SpelledPitch): number {
  return letterIndex(p.letter) + LETTERS_PER_OCTAVE * p.octave
}

/** Does this number take perfect quality? True for 1, 4, 5, 8 and their compounds. */
function isPerfectNumber(n: number): boolean {
  const simple = ((n - 1) % LETTERS_PER_OCTAVE) + 1
  return simple === 1 || simple === 4 || simple === 5
}

/** Semitones spanned by the major/perfect form of any number, compounds included. */
function majorOrPerfectSemitones(n: number): number {
  const octaves = Math.floor((n - 1) / LETTERS_PER_OCTAVE)
  const index = n - 1 - octaves * LETTERS_PER_OCTAVE
  return at(MAJOR_OR_PERFECT, index) + octaves * SEMITONES_PER_OCTAVE
}

function familyFor(perfect: boolean): QualityFamily {
  return perfect ? PERFECT_FAMILY : IMPERFECT_FAMILY
}

/** Semitones this quality adds to the major/perfect form, or undefined if it is not in the family. */
function qualityOffset(quality: IntervalQuality, perfect: boolean): number | undefined {
  const { qualities, floor } = familyFor(perfect)
  const index = qualities.indexOf(quality)
  return index < 0 ? undefined : floor + index
}

/** The inverse: which quality adds exactly this many semitones, if any does. */
function qualityFromOffset(offset: number, perfect: boolean): IntervalQuality | undefined {
  const { qualities, floor } = familyFor(perfect)
  return qualities[offset - floor]
}

function ordinalSuffix(n: number): string {
  const abs = Math.abs(n)
  if (abs % 100 >= 11 && abs % 100 <= 13) return 'th'
  if (abs % 10 === 1) return 'st'
  if (abs % 10 === 2) return 'nd'
  if (abs % 10 === 3) return 'rd'
  return 'th'
}

/** 'fifth', 'octave', 'thirteenth', then numerals: '17th', '21st'. */
function numberName(n: number): string {
  if (n >= 1 && n <= NUMBER_NAMES.length) return at(NUMBER_NAMES, n - 1)
  return `${n}${ordinalSuffix(n)}`
}

function isAlter(n: number): n is Alter {
  return Number.isInteger(n) && n >= -2 && n <= 2
}

/** Only for pairs already known to be legal — every call site proves it first. */
function forceInterval(n: number, quality: IntervalQuality): Interval {
  return unwrap(makeInterval(n, quality))
}

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

/**
 * Build an interval, rejecting impossible pairs: perfect belongs only to 1, 4,
 * 5, 8 (and their compounds), major/minor only to 2, 3, 6, 7. Diminished and
 * augmented apply to everything.
 *
 * A diminished unison is accepted even though it is a contested object — it
 * spans -1 semitones, and allowing it is what keeps `invert` total (it is the
 * inversion of the augmented octave).
 */
export function makeInterval(number: number, quality: IntervalQuality): Result<Interval, string> {
  if (!Number.isInteger(number)) {
    return err(`interval number must be a whole number, got ${number}`)
  }
  if (number < 1) {
    return err(`interval number must be at least 1 (a unison), got ${number}`)
  }
  const perfect = isPerfectNumber(number)
  const offset = qualityOffset(quality, perfect)
  if (offset === undefined) {
    const allowed = perfect ? 'perfect' : 'major or minor'
    return err(
      `a ${numberName(number)} cannot be ${QUALITY_LONG[quality]} — ` +
        `${allowed}, augmented or diminished (or doubly so) only`,
    )
  }
  return ok({ number, quality, semitones: majorOrPerfectSemitones(number) + offset })
}

/**
 * Parse an abbreviated interval name — the inverse of {@link intervalName}.
 * Case is significant: `M3` is a major third, `m3` a minor one.
 */
export function parseInterval(text: string): Result<Interval, string> {
  const trimmed = text.trim()
  if (trimmed.length === 0) return err('empty interval name')

  const match = INTERVAL_PATTERN.exec(trimmed)
  if (match === null) {
    return err(`not an interval name: '${text}' (expected something like 'P5', 'm3' or 'AA4')`)
  }
  const quality = ABBREV_TO_QUALITY[at(match, 1)]
  invariant(quality !== undefined, `unmapped interval quality '${at(match, 1)}'`)
  return makeInterval(Number(at(match, 2)), quality)
}

// ---------------------------------------------------------------------------
// measuring
// ---------------------------------------------------------------------------

/**
 * Which way `b` lies from `a`: 1 above, -1 below, 0 only when the two spellings
 * are identical. Staff position decides first, so B#3 counts as below C4.
 */
export function intervalDirection(a: SpelledPitch, b: SpelledPitch): -1 | 0 | 1 {
  const byStaff = staffPosition(b) - staffPosition(a)
  if (byStaff !== 0) return byStaff > 0 ? 1 : -1
  const bySound = sounding(b) - sounding(a)
  if (bySound !== 0) return bySound > 0 ? 1 : -1
  return 0
}

/**
 * The interval between two written pitches, regardless of order — spelling
 * aware, so C4→Gb4 is a diminished fifth and C4→F#4 an augmented fourth even
 * though both span six semitones. Err for spellings further apart than doubly
 * augmented/diminished: Fb4 to B#4 is a triply augmented fourth, and no quality
 * names it.
 *
 * That pair is rare but reachable — MusicXML contains both spellings — so
 * anything measuring pitches that came out of an imported score belongs here
 * rather than on {@link intervalBetween}.
 */
export function tryIntervalBetween(a: SpelledPitch, b: SpelledPitch): Result<Interval, string> {
  const descending = intervalDirection(a, b) < 0
  const low = descending ? b : a
  const high = descending ? a : b

  const number = staffPosition(high) - staffPosition(low) + 1
  const span = sounding(high) - sounding(low)
  const quality = qualityFromOffset(span - majorOrPerfectSemitones(number), isPerfectNumber(number))
  if (quality === undefined) {
    return err(
      `no interval quality for a ${numberName(number)} spanning ${span} semitones ` +
        `(${pitchName(a)} to ${pitchName(b)})`,
    )
  }
  return ok(forceInterval(number, quality))
}

/**
 * {@link tryIntervalBetween} for callers holding spellings they already know are
 * measurable — the scale, chord and key vocabulary this module builds itself.
 * Throws an InvariantError on the pairs that variant reports as an Err.
 */
export function intervalBetween(a: SpelledPitch, b: SpelledPitch): Interval {
  const measured = tryIntervalBetween(a, b)
  if (measured.ok) return measured.value
  throw new InvariantError(measured.error)
}

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

/** `'P5'`, `'m3'`, `'M7'`, `'A4'`, `'d5'`, `'P8'`, `'M9'`, `'dd3'`, `'AA4'`. */
export function intervalName(i: Interval): string {
  return `${QUALITY_ABBREV[i.quality]}${i.number}`
}

/** `'perfect fifth'`, `'minor third'`, `'augmented fourth'`, `'doubly diminished third'`. */
export function intervalLongName(i: Interval): string {
  return `${QUALITY_LONG[i.quality]} ${numberName(i.number)}`
}

// ---------------------------------------------------------------------------
// algebra
// ---------------------------------------------------------------------------

/** Larger than an octave. The octave itself is simple. */
export function isCompound(i: Interval): boolean {
  return i.number > LETTERS_PER_OCTAVE + 1
}

/** Reduce to within an octave: a 9th becomes a 2nd, a 15th an octave, an octave stays an octave. */
export function simplify(i: Interval): Interval {
  if (i.number === 1) return i
  const within = ((i.number - 1) % LETTERS_PER_OCTAVE) + 1
  const simple = within === 1 ? LETTERS_PER_OCTAVE + 1 : within
  if (simple === i.number) return i
  return forceInterval(simple, i.quality)
}

/**
 * Turn the interval upside down: the number inverts as 9 - n, major swaps with
 * minor and augmented with diminished. Compound intervals are simplified first,
 * so `invert` always returns a simple interval.
 */
export function invert(i: Interval): Interval {
  const simple = simplify(i)
  return forceInterval(LETTERS_PER_OCTAVE + 2 - simple.number, INVERTED_QUALITY[simple.quality])
}

/**
 * Consonance in the common-practice sense: P1, m3, M3, P5, m6, M6 and P8.
 *
 * The perfect fourth is deliberately counted as a **dissonance**. Above a bass
 * it demands resolution and is treated as a dissonance throughout species
 * counterpoint and figured-bass practice; calling it consonant would make the
 * app teach the wrong answer. Compound intervals are judged by their simple
 * form, so a major tenth is consonant and a perfect eleventh is not.
 */
export function isConsonant(i: Interval): boolean {
  const simple = simplify(i)
  if (simple.quality === 'perfect') {
    return simple.number === 1 || simple.number === 5 || simple.number === 8
  }
  if (simple.quality === 'major' || simple.quality === 'minor') {
    return simple.number === 3 || simple.number === 6
  }
  return false
}

// ---------------------------------------------------------------------------
// transposition
// ---------------------------------------------------------------------------

/**
 * Transpose keeping the spelling correct: the letter moves by the interval's
 * number and the accidental is whatever makes the semitone count come out
 * right. C4 up an A4 is F#4; C4 up a d5 is Gb4.
 *
 * Err when the result would need more than a double sharp or double flat: C##4
 * up an augmented second wants a triple sharp, which no notation system writes.
 * Reachable from an imported score, so transposing anything that came out of one
 * belongs here rather than on {@link transposeSpelled}.
 *
 * The interval itself must be well formed — one built by `makeInterval`,
 * `parseInterval` or `intervalBetween`. A hand-assembled `Interval` with a
 * fractional number is programmer error and still throws.
 */
export function tryTransposeSpelled(
  p: SpelledPitch,
  i: Interval,
  direction: 1 | -1 = 1,
): Result<SpelledPitch, string> {
  const target = diatonicStep(p, (i.number - 1) * direction)
  const wanted = sounding(p) + i.semitones * direction
  const alter =
    wanted - ((target.octave + 1) * SEMITONES_PER_OCTAVE + naturalSemitone(target.letter))
  if (!isAlter(alter)) {
    return err(
      `transposeSpelled: ${pitchName(p)} ${direction === 1 ? 'up' : 'down'} ${intervalName(i)} ` +
        `needs an accidental of ${alter}, beyond the double sharp/double flat range`,
    )
  }
  return ok(spell(target.letter, alter, target.octave))
}

/**
 * {@link tryTransposeSpelled} for callers transposing spellings they already
 * know are writable. Throws an InvariantError where that variant reports an Err.
 */
export function transposeSpelled(
  p: SpelledPitch,
  i: Interval,
  direction: 1 | -1 = 1,
): SpelledPitch {
  const moved = tryTransposeSpelled(p, i, direction)
  if (moved.ok) return moved.value
  throw new InvariantError(moved.error)
}

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

/**
 * The thirteen simple intervals, in ascending semitone order — index equals
 * semitone count, so `SIMPLE_INTERVALS[7]` is the perfect fifth. The tritone
 * appears once, spelled as an augmented fourth; the diminished fifth is
 * reachable through `makeInterval(5, 'diminished')` or
 * `intervalFromSemitones(6, 'diatonic')`.
 */
export const SIMPLE_INTERVALS: readonly Interval[] = [
  forceInterval(1, 'perfect'),
  forceInterval(2, 'minor'),
  forceInterval(2, 'major'),
  forceInterval(3, 'minor'),
  forceInterval(3, 'major'),
  forceInterval(4, 'perfect'),
  forceInterval(4, 'augmented'),
  forceInterval(5, 'perfect'),
  forceInterval(6, 'minor'),
  forceInterval(6, 'major'),
  forceInterval(7, 'minor'),
  forceInterval(7, 'major'),
  forceInterval(8, 'perfect'),
]

const DIMINISHED_FIFTH = forceInterval(5, 'diminished')

/**
 * The simplest common spelling of a semitone distance: 4 is a major third, 7 a
 * perfect fifth, 12 an octave, 14 a major ninth. Six semitones come back as an
 * augmented fourth; pass `'diatonic'` to get the diminished fifth instead, the
 * form the tritone takes between the 4th and 7th degrees of a major scale.
 *
 * Throws on a negative or fractional count (programmer error) — use
 * `intervalDirection` for direction, an interval has none.
 */
export function intervalFromSemitones(semitones: number, preferQuality?: 'diatonic'): Interval {
  if (!Number.isInteger(semitones) || semitones < 0) {
    throw new RangeError(
      `intervalFromSemitones: expected a whole, non-negative semitone count, got ${semitones}`,
    )
  }
  const octaves = Math.floor(semitones / SEMITONES_PER_OCTAVE)
  const within = semitones - octaves * SEMITONES_PER_OCTAVE
  const base =
    within === 6 && preferQuality === 'diatonic' ? DIMINISHED_FIFTH : at(SIMPLE_INTERVALS, within)
  return forceInterval(base.number + octaves * LETTERS_PER_OCTAVE, base.quality)
}
