/**
 * Scales — an ordered collection of pitches above a tonic, spelled the way a
 * musician would write them rather than the way a keyboard sounds them.
 *
 * The rule that makes this more than a table lookup: **a seven-note scale uses
 * each letter name exactly once**. F# major is F# G# A# B C# D# E# — the
 * seventh degree is E#, never F, because F is already the tonic's letter and a
 * scale with two Fs and no E cannot be written on a staff. Every degree is
 * therefore built as "the letter that many steps up, carrying whatever
 * accidental makes the semitone count come out right", never as "the nearest
 * convenient enharmonic".
 *
 * Scales that do not have seven notes cannot obey that rule, so each type also
 * carries a letter-step pattern (`LETTER_STEPS`) saying which letter each degree
 * is written on. The blues scale deliberately writes its b5 and 5 on the same
 * letter (C Eb F Gb G Bb), which is exactly how it is engraved.
 *
 * The two symmetric scales — chromatic and whole tone — cannot use a fixed
 * pattern at all, because which letter a degree wants depends on the tonic's own
 * accidental. Six whole-tone notes have to skip one of the seven letters, and
 * *which* letter is skipped is what changes between keys: C D E F# G# A# skips
 * B, but B C# D# F G A skips E. Both therefore choose their letters per key, in
 * {@link letterStepsFor}, so that no degree needs a double accidental.
 *
 * A few theoretical keys are still unwritable: G## major would need F### for its
 * leading tone. Asking for one is a programmer error (the answer is always the
 * enharmonic key — A major), so `buildScale` throws rather than returning a
 * wrong spelling.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import type { Midi } from '@core/shared/units.ts'
import {
  type Alter,
  diatonicStep,
  type Letter,
  pitchClass,
  pitchName,
  spell,
  type SpelledPitch,
  spelledPitchClass,
} from './pitch.ts'

/**
 * Every scale type, for callers that need to enumerate them (drills, pickers).
 *
 * This tuple is the **single source of truth**: {@link ScaleType} is derived
 * from it, and every table below is a `Record<ScaleType, …>`, so adding an entry
 * here is a compile error until the intervals, letter steps and display name
 * have all been filled in.
 */
export const SCALE_TYPES = [
  'major',
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'ionian',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
  'chromatic',
  'majorPentatonic',
  'minorPentatonic',
  'blues',
  'wholeTone',
] as const

export type ScaleType = (typeof SCALE_TYPES)[number]

export type Scale = {
  readonly tonic: SpelledPitch
  readonly type: ScaleType
  readonly notes: readonly SpelledPitch[]
}

const SEMITONES_PER_OCTAVE = 12

/**
 * Semitone offsets above the tonic, ascending, **excluding** the octave. The
 * modes are the rotations of the major scale, which is why `ionian` duplicates
 * `major` and `aeolian` duplicates `naturalMinor` — both names are in common
 * use and callers should not have to know they are the same thing.
 *
 * `melodicMinor` is the ascending form; the classical descending form is a
 * natural minor, see {@link melodicMinorDescending}.
 */
export const SCALE_INTERVALS: Readonly<Record<ScaleType, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
}

/** One letter per degree — the heptatonic rule. */
const HEPTATONIC_STEPS: readonly number[] = [0, 1, 2, 3, 4, 5, 6]

/**
 * Ascending chromatic: the seven diatonic degrees of the tonic's major scale
 * keep their own letters and the five in-between notes are written as the
 * degree below, raised. C gives C C# D D# E F F# G G# A A# B; Eb gives
 * Eb E F F# G Ab A Bb B C C# D — flats where the key has them, sharps for the
 * chromatic passing notes. (A *descending* chromatic scale flattens from above
 * instead; that form is not modelled here.)
 *
 * This is the *preferred* pattern. A tonic carrying its own accidental shifts
 * every degree with it, so {@link chromaticSteps} moves individual degrees onto
 * the neighbouring letter where this pattern would ask for a double accidental.
 */
const CHROMATIC_STEPS: readonly number[] = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]

/**
 * Whole tone, preferred pattern: consecutive letters, skipping the seventh —
 * C D E F# G# A#. Only correct for tonics that can carry it;
 * {@link wholeToneSteps} picks which letter to skip per key.
 */
const WHOLE_TONE_STEPS: readonly number[] = [0, 1, 2, 3, 4, 5]

/**
 * Which letter each degree is written on, as a letter-step count above the
 * tonic's letter. Parallel to {@link SCALE_INTERVALS}.
 *
 *  - pentatonics keep the letters of the degrees they are built from (major
 *    pentatonic is 1 2 3 5 6, minor pentatonic 1 b3 4 5 b7);
 *  - blues writes its b5 and natural 5 on the same letter — C Eb F Gb G Bb;
 *  - whole tone has six notes, so one letter goes unused: C D E F# G# A#.
 *
 * The chromatic and whole-tone rows are a starting point rather than the answer;
 * see {@link letterStepsFor}.
 */
const LETTER_STEPS: Readonly<Record<ScaleType, readonly number[]>> = {
  major: HEPTATONIC_STEPS,
  naturalMinor: HEPTATONIC_STEPS,
  harmonicMinor: HEPTATONIC_STEPS,
  melodicMinor: HEPTATONIC_STEPS,
  ionian: HEPTATONIC_STEPS,
  dorian: HEPTATONIC_STEPS,
  phrygian: HEPTATONIC_STEPS,
  lydian: HEPTATONIC_STEPS,
  mixolydian: HEPTATONIC_STEPS,
  aeolian: HEPTATONIC_STEPS,
  locrian: HEPTATONIC_STEPS,
  chromatic: CHROMATIC_STEPS,
  majorPentatonic: [0, 1, 2, 4, 5],
  minorPentatonic: [0, 2, 3, 4, 6],
  blues: [0, 2, 3, 4, 4, 6],
  wholeTone: WHOLE_TONE_STEPS,
}

const TYPE_NAMES: Readonly<Record<ScaleType, string>> = {
  major: 'major',
  naturalMinor: 'natural minor',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  ionian: 'ionian',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'aeolian',
  locrian: 'locrian',
  chromatic: 'chromatic',
  majorPentatonic: 'major pentatonic',
  minorPentatonic: 'minor pentatonic',
  blues: 'blues',
  wholeTone: 'whole tone',
}

/** Classical names of degrees 1–6; the 7th depends on its distance to the tonic. */
const DEGREE_NAMES: readonly string[] = [
  'tonic',
  'supertonic',
  'mediant',
  'subdominant',
  'dominant',
  'submediant',
]

/**
 * The degrees whose classical name asserts an interval quality: 'subdominant' is
 * a perfect fourth and 'dominant' a perfect fifth. A scale that alters one of
 * them (lydian, locrian) does not get the name.
 */
const PERFECT_DEGREES: Readonly<Record<number, number>> = { 4: 5, 5: 7 }

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Semitones of a natural letter above the C of its octave. Derived from pitch.ts. */
function naturalSemitone(letter: Letter): number {
  return spelledPitchClass(spell(letter, 0, 0))
}

/** Sounding semitone number, unclamped — scales legitimately run past MIDI 127. */
function sounding(p: SpelledPitch): number {
  return (p.octave + 1) * SEMITONES_PER_OCTAVE + naturalSemitone(p.letter) + p.alter
}

function isAlter(n: number): n is Alter {
  return Number.isInteger(n) && n >= -2 && n <= 2
}

/** The accidental that writes the sounding semitone `wanted` on `target`'s letter. */
function alterFor(target: SpelledPitch, wanted: number): number {
  return wanted - ((target.octave + 1) * SEMITONES_PER_OCTAVE + naturalSemitone(target.letter))
}

/** A single sharp or flat. Symmetric scales are re-spelled until they fit inside this. */
const MAX_SIMPLE_ALTER = 1

function accidentalText(alter: Alter): string {
  return alter < 0 ? 'b'.repeat(-alter) : '#'.repeat(alter)
}

/**
 * The degree written `letterStep` letters above the tonic and sounding
 * `semitones` above it. The accidental is whatever reconciles the two.
 */
function spellDegree(
  tonic: SpelledPitch,
  letterStep: number,
  semitones: number,
  context: string,
): SpelledPitch {
  const target = diatonicStep(tonic, letterStep)
  const wanted = sounding(tonic) + semitones
  const alter = alterFor(target, wanted)
  invariant(
    isAlter(alter),
    `${context}: the degree ${semitones} semitones above ${pitchName(tonic)} must be written ` +
      `on ${target.letter} with an accidental of ${alter}, beyond the double sharp/flat range — ` +
      `use the enharmonic key instead`,
  )
  return spell(target.letter, alter, target.octave)
}

// ---------------------------------------------------------------------------
// letters for the symmetric scales
// ---------------------------------------------------------------------------

/**
 * Chromatic letters for one key: {@link CHROMATIC_STEPS}, with any degree that
 * would need a double accidental moved onto the neighbouring letter — up when it
 * is too sharp, down when it is too flat. C and Eb never move anything; C# moves
 * every passing note (C## becomes D, D## becomes E, …) and Fb moves the one
 * degree the flat tonic pushes past Bbb.
 *
 * The walk terminates: stepping one letter up lowers the accidental by one or
 * two, so a +2 becomes a 0 or a +1 and can never overshoot into flats.
 *
 * The tonic keeps whatever accidental it was handed — `buildScale(Fbb, …)` still
 * starts on Fbb — so only degrees 2 and up are moved.
 */
function chromaticSteps(tonic: SpelledPitch, offsets: readonly number[]): readonly number[] {
  const base = sounding(tonic)
  return CHROMATIC_STEPS.map((step, i) => {
    if (i === 0) return step
    const wanted = base + at(offsets, i)
    let chosen = step
    let alter = alterFor(diatonicStep(tonic, chosen), wanted)
    while (Math.abs(alter) > MAX_SIMPLE_ALTER) {
      chosen += alter > 0 ? 1 : -1
      alter = alterFor(diatonicStep(tonic, chosen), wanted)
    }
    return chosen
  })
}

/**
 * The six ways six notes can sit on seven letters, ordered by which letter is
 * skipped: the first keeps consecutive letters and skips the last (C D E F# G#
 * A#), the last skips the second (B# D E F# G# A#).
 */
const WHOLE_TONE_PATTERNS: readonly (readonly number[])[] = WHOLE_TONE_STEPS.map((_, skip) =>
  WHOLE_TONE_STEPS.map((step, degree) =>
    degree > WHOLE_TONE_STEPS.length - 1 - skip ? step + 1 : step,
  ),
)

/**
 * How badly a letter pattern spells this key, as a comparison key: how many
 * degrees need a double accidental, then how many accidentals in total, then how
 * flat it is. Lower is better on all three, so the preference is
 * "no double accidentals, then as few accidentals as possible, then sharps over
 * flats" — which is why C whole tone is C D E F# G# A# and not C D E F# G# Bb.
 */
function patternCost(
  tonic: SpelledPitch,
  offsets: readonly number[],
  steps: readonly number[],
): readonly [number, number, number] {
  const base = sounding(tonic)
  let doubled = 0
  let accidentals = 0
  let sharpness = 0
  for (let i = 1; i < steps.length; i++) {
    const alter = alterFor(diatonicStep(tonic, at(steps, i)), base + at(offsets, i))
    if (Math.abs(alter) > MAX_SIMPLE_ALTER) doubled += 1
    accidentals += Math.abs(alter)
    sharpness += alter
  }
  return [doubled, accidentals, -sharpness]
}

/** Lexicographic on the three costs, in `Array.prototype.sort` sign convention. */
function compareCost(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return at(a, 0) - at(b, 0) || at(a, 1) - at(b, 1) || at(a, 2) - at(b, 2)
}

/**
 * Whole-tone letters for one key: whichever of the six patterns spells it best.
 * The skipped letter moves with the key — C skips B, B skips E, Gb skips F —
 * and a tonic that already carries a double accidental may leave one degree
 * needing one too (D## whole tone ends on C##), which is a deliberate,
 * documented outcome rather than a refusal.
 */
function wholeToneSteps(tonic: SpelledPitch, offsets: readonly number[]): readonly number[] {
  let best = at(WHOLE_TONE_PATTERNS, 0)
  let bestCost = patternCost(tonic, offsets, best)
  for (const candidate of WHOLE_TONE_PATTERNS) {
    const cost = patternCost(tonic, offsets, candidate)
    if (compareCost(cost, bestCost) < 0) {
      best = candidate
      bestCost = cost
    }
  }
  return best
}

/**
 * Which letter each degree is written on. Fixed by the type for every scale
 * whose degrees are diatonic degrees, chosen per key for the two symmetric
 * scales, where a fixed pattern would spell whole keys in double accidentals.
 */
function letterStepsFor(
  tonic: SpelledPitch,
  type: ScaleType,
  offsets: readonly number[],
): readonly number[] {
  if (type === 'chromatic') return chromaticSteps(tonic, offsets)
  if (type === 'wholeTone') return wholeToneSteps(tonic, offsets)
  return LETTER_STEPS[type]
}

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

/**
 * Build one octave of a scale — `notes` holds one entry per degree and does
 * **not** repeat the tonic at the top, so `notes.length` is the period used by
 * {@link degreeOf} and {@link noteAtDegree}. Use {@link scaleNotes} for the
 * playable, tonic-to-tonic form.
 *
 * Throws when the key is unwritable (G## major, B# whole tone): a scale needing
 * a triple sharp is a programmer error, not user input — the caller wanted the
 * enharmonic key.
 */
export function buildScale(tonic: SpelledPitch, type: ScaleType): Scale {
  const offsets = SCALE_INTERVALS[type]
  const steps = letterStepsFor(tonic, type, offsets)
  const context = `${pitchName(tonic)} ${TYPE_NAMES[type]}`
  const notes = offsets.map((semitones, i) => spellDegree(tonic, at(steps, i), semitones, context))
  return { tonic, type, notes }
}

/**
 * The scale as it is played: ascending, `octaves` octaves, ending on the tonic
 * again. One octave of a major scale is therefore eight notes, two octaves
 * fifteen. Throws on a non-positive or fractional octave count.
 */
export function scaleNotes(
  tonic: SpelledPitch,
  type: ScaleType,
  octaves = 1,
): readonly SpelledPitch[] {
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new RangeError(`scaleNotes: octaves must be a positive whole number, got ${octaves}`)
  }
  const scale = buildScale(tonic, type)
  const count = scale.notes.length * octaves + 1
  return Array.from({ length: count }, (_, i) => noteAtDegree(scale, i + 1))
}

/**
 * The classical descending form of the melodic minor, which is simply the
 * natural minor written top to bottom: A G F E D C B A. Returned descending,
 * starting an octave above the tonic.
 */
export function melodicMinorDescending(tonic: SpelledPitch): readonly SpelledPitch[] {
  return [...scaleNotes(tonic, 'naturalMinor')].reverse()
}

// ---------------------------------------------------------------------------
// membership
// ---------------------------------------------------------------------------

/**
 * Which degree `p` is, 1-based, or null if it is not in the scale. Matching is
 * by **spelling** and ignores the octave: in C major, E of any octave is degree
 * 3, and Fb is not in the scale at all even though it sounds like E.
 */
export function degreeOf(scale: Scale, p: SpelledPitch): number | null {
  const index = scale.notes.findIndex((n) => n.letter === p.letter && n.alter === p.alter)
  return index === -1 ? null : index + 1
}

/** {@link degreeOf} as a predicate — by spelling. */
export function isInScale(scale: Scale, p: SpelledPitch): boolean {
  return degreeOf(scale, p) !== null
}

/**
 * Is this sounding note one of the scale's pitch classes? By **sound**, so
 * MIDI 60 is in C major whether it would be written C, B# or Dbb — the question
 * a MIDI keyboard asks, where {@link isInScale} is the question a score asks.
 */
export function containsPitchClass(scale: Scale, note: Midi): boolean {
  const pc = pitchClass(note)
  return scale.notes.some((n) => spelledPitchClass(n) === pc)
}

/**
 * The note at a 1-based degree, wrapping with an octave adjustment: in C major
 * degree 8 is C an octave up, degree 9 is D. Degrees below 1 wrap downwards
 * (degree 0 is the 7th below the tonic). Throws on a fractional degree.
 */
export function noteAtDegree(scale: Scale, degree: number): SpelledPitch {
  if (!Number.isInteger(degree)) {
    throw new RangeError(`noteAtDegree: degree must be a whole number, got ${degree}`)
  }
  const period = scale.notes.length
  const octaveShift = Math.floor((degree - 1) / period)
  const note = at(scale.notes, degree - 1 - octaveShift * period)
  if (octaveShift === 0) return note
  return spell(note.letter, note.alter, note.octave + octaveShift)
}

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

/** `'F# harmonic minor'`, `'C major'`, `'Bb whole tone'` — no octave. */
export function scaleName(scale: Scale): string {
  const { letter, alter } = scale.tonic
  return `${letter}${accidentalText(alter)} ${TYPE_NAMES[scale.type]}`
}

/**
 * The classical name of a scale degree, used only where it is true of the actual
 * interval rather than of the position in the row.
 *
 *  - the seventh is a **leading tone** when it is a semitone below the tonic and
 *    a **subtonic** when it is a whole tone below — the difference between
 *    harmonic minor (G# in A) and natural minor or mixolydian (G in A);
 *  - **subdominant** and **dominant** mean a perfect fourth and a perfect fifth.
 *    Lydian's fourth is augmented and locrian's fifth is diminished, so those two
 *    degrees are neither, and get the plain `'degree 4'` / `'degree 5'` label
 *    rather than a name that would claim a function they do not have.
 *
 * Scales that are not heptatonic have no traditional degree names either, so
 * they get `'degree 4'` and the like; degree 1 is always the tonic. Throws if the
 * degree is not a whole number within the scale.
 */
export function degreeName(type: ScaleType, degree: number): string {
  const offsets = SCALE_INTERVALS[type]
  if (!Number.isInteger(degree) || degree < 1 || degree > offsets.length) {
    throw new RangeError(
      `degreeName: degree ${degree} is outside 1..${offsets.length} for a ${TYPE_NAMES[type]} scale`,
    )
  }
  if (offsets.length !== DEGREE_NAMES.length + 1) {
    return degree === 1 ? 'tonic' : `degree ${degree}`
  }
  const offset = at(offsets, degree - 1)
  if (degree === offsets.length) {
    return offset === SEMITONES_PER_OCTAVE - 1 ? 'leading tone' : 'subtonic'
  }
  const perfect = PERFECT_DEGREES[degree]
  if (perfect !== undefined && offset !== perfect) return `degree ${degree}`
  return at(DEGREE_NAMES, degree - 1)
}

// ---------------------------------------------------------------------------
// fingering
// ---------------------------------------------------------------------------

/** Standard classical fingerings, one octave ascending; index i is the finger for note i. 1 = thumb. */
export type Fingering = {
  readonly rightHand: readonly number[]
  readonly leftHand: readonly number[]
}

const f = (rightHand: readonly number[], leftHand: readonly number[]): Fingering => ({
  rightHand,
  leftHand,
})

/** The five keys whose fingering is the C-major pattern: C G D A E. */
const C_PATTERN = f([1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1])
/** Db, Eb, Ab and Bb share a left hand: thumb on the white keys, 4 on the black one. */
const FLAT_LH: readonly number[] = [3, 2, 1, 4, 3, 2, 1, 3]

/**
 * Major-scale fingerings indexed by the tonic's pitch class, so enharmonic keys
 * (Cb/B, Gb/F#, Db/C#) correctly share a fingering — they are the same keys
 * under the hand. Eight entries each: one octave, tonic to tonic.
 *
 * The organising principle is that **neither thumb ever plays a black key** — it
 * is too short to reach between the others. In the flat keys that means the right
 * thumb falls on the white key immediately after each group of black keys (C and
 * F in Bb/Eb/Ab), which is why those scales start on 4 or 3 rather than 1. F#/Gb
 * turns after the fourth finger for the same reason: its two white keys are the
 * 4th and the 7th (B and E#, or Cb and F).
 */
const MAJOR_FINGERINGS: readonly Fingering[] = [
  C_PATTERN, //  0  C
  f([2, 3, 1, 2, 3, 4, 1, 2], FLAT_LH), //  1  Db / C#
  C_PATTERN, //  2  D
  f([3, 1, 2, 3, 4, 1, 2, 3], FLAT_LH), //  3  Eb / D#
  C_PATTERN, //  4  E
  f([1, 2, 3, 4, 1, 2, 3, 4], [5, 4, 3, 2, 1, 3, 2, 1]), //  5  F
  f([2, 3, 4, 1, 2, 3, 1, 2], [4, 3, 2, 1, 3, 2, 1, 4]), //  6  F# / Gb
  C_PATTERN, //  7  G
  f([3, 4, 1, 2, 3, 1, 2, 3], FLAT_LH), //  8  Ab / G#
  C_PATTERN, //  9  A
  f([4, 1, 2, 3, 1, 2, 3, 4], FLAT_LH), // 10  Bb / A#
  f([1, 2, 3, 1, 2, 3, 4, 5], [4, 3, 2, 1, 4, 3, 2, 1]), // 11  B / Cb
]

/**
 * The standard fingering for one ascending octave, or null when no standard one
 * is defined here.
 *
 * Only the major scale (and `ionian`, which is the same notes) is covered. The
 * minor forms and the modes each have their own conventions that vary between
 * editions — Bb minor is not Bb major with two fingers moved — so rather than
 * invent them this returns null and the caller can fall back to showing none.
 */
export function scaleFingering(tonic: SpelledPitch, type: ScaleType): Fingering | null {
  if (type !== 'major' && type !== 'ionian') return null
  return at(MAJOR_FINGERINGS, spelledPitchClass(tonic))
}
