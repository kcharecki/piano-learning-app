/**
 * Harmony — diatonic function, roman numerals, cadences and progressions.
 *
 * A roman numeral names a chord's *relationship to a key*: which scale degree
 * it is built on (`degree`), what it tonicises if it is a secondary function
 * (`appliedTo`), and how far its root strays from the plain diatonic pitch
 * (`alter`, for borrowed chords). Two things make this spelling-aware rather
 * than pitch-class-aware, matching the rest of `core/theory`:
 *
 *  - a chord is only diatonic if its *written* root matches the key's scale
 *    degree letter-for-letter, accidental-for-accidental — `romanNumeralFor`
 *    never silently reinterprets a foreign spelling as the nearest degree;
 *  - minor keys are read against **both** the natural and harmonic forms of
 *    the scale, because real music does: `v` (natural) and `V` (harmonic)
 *    share a root but differ in quality, and `vii°` uses the harmonic form's
 *    raised leading tone as its root, a different pitch from natural `VII`.
 *
 * Secondary (applied) chords are recognised generically: a `V/x` or `vii°/x`
 * is built the same way regardless of which degree `x` is, by transposing to
 * the dominant or leading tone of `x`'s own diatonic root. Borrowed chords
 * (mode mixture) are scoped to the common case a learner meets first: `bIII`,
 * `bVI` and `bVII` in a major key, borrowed from the parallel natural minor.
 */
import { at } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { type Midi } from '@core/shared/units.ts'
import { buildChord, type Chord, type ChordQuality, figuredBass, type Inversion } from './chords.ts'
import { type Key, keyName } from './keys.ts'
import { buildScale, noteAtDegree } from './scales.ts'
import { spell, type SpelledPitch, toMidi } from './pitch.ts'

/** Scale-degree function. */
export type HarmonicFunction = 'tonic' | 'predominant' | 'dominant'

export type RomanNumeral = {
  /** 1..7, the diatonic degree the chord is built on. */
  readonly degree: number
  readonly quality: ChordQuality
  readonly inversion: Inversion
  /** For a secondary function (V/V, viio7/ii): the degree it tonicises. Omitted otherwise. */
  readonly appliedTo?: number
  /** Chromatic root alteration in semitones, for borrowed chords (bVII is -1). */
  readonly alter: number
  /** Canonical printed form: "I", "vii°6", "V6/5", "V/V", "bVII". */
  readonly text: string
}

export type CadenceType =
  | 'perfect-authentic'
  | 'imperfect-authentic'
  | 'half'
  | 'plagal'
  | 'deceptive'
  | 'none'

export type Progression = { readonly name: string; readonly numerals: readonly string[] }

// ---------------------------------------------------------------------------
// diatonic quality tables — the single source of truth for every degree
// ---------------------------------------------------------------------------

/** I ii iii IV V vi vii°. */
const MAJOR_QUALITIES: readonly ChordQuality[] = [
  'major',
  'minor',
  'minor',
  'major',
  'major',
  'minor',
  'diminished',
]

const MAJOR_SEVENTHS: readonly ChordQuality[] = [
  'major7',
  'minor7',
  'minor7',
  'major7',
  'dominant7',
  'minor7',
  'halfDiminished7',
]

/** i ii° III iv v VI VII — the natural minor reading. */
const NATURAL_MINOR_QUALITIES: readonly ChordQuality[] = [
  'minor',
  'diminished',
  'major',
  'minor',
  'minor',
  'major',
  'major',
]

const NATURAL_MINOR_SEVENTHS: readonly ChordQuality[] = [
  'minor7',
  'halfDiminished7',
  'major7',
  'minor7',
  'minor7',
  'major7',
  'dominant7',
]

const DEGREE_ROMAN: readonly string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

const ROMAN_TO_DEGREE: Readonly<Record<string, number>> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
}

/** Qualities printed with a lowercase roman numeral. */
const LOWERCASE_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
  'minor',
  'minor7',
  'diminished',
  'diminished7',
  'halfDiminished7',
  'minorMajor7',
])

// ---------------------------------------------------------------------------
// scale helpers
// ---------------------------------------------------------------------------

/** The scale a key's *plain* diatonic degrees are read against. */
function homeScale(key: Key) {
  return buildScale(key.tonic, key.mode === 'major' ? 'major' : 'naturalMinor')
}

/** The written root of a key's plain (non-harmonic-minor) degree, 1-based. */
function plainRootFor(key: Key, degree: number): SpelledPitch {
  return noteAtDegree(homeScale(key), degree)
}

/** The root a diatonic chord of this quality is built on in this key. */
function rootFor(key: Key, degree: number, quality: ChordQuality): SpelledPitch {
  const isRaisedLeadingTone =
    key.mode === 'minor' && degree === 7 && (quality === 'diminished' || quality === 'diminished7')
  if (isRaisedLeadingTone) return noteAtDegree(buildScale(key.tonic, 'harmonicMinor'), 7)
  return plainRootFor(key, degree)
}

/** Which qualities are a legal diatonic reading of this degree in this key. */
function allowedQualitiesFor(key: Key, degree: number, seventh: boolean): readonly ChordQuality[] {
  if (key.mode === 'major') {
    // vii°7 (fully diminished) is a common major-key borrowing alongside the
    // diatonic viiø7 — both are legal seventh-chord readings of degree 7.
    if (degree === 7 && seventh) return ['halfDiminished7', 'diminished7']
    return [at(seventh ? MAJOR_SEVENTHS : MAJOR_QUALITIES, degree - 1)]
  }
  if (degree === 5) return seventh ? ['minor7', 'dominant7'] : ['minor', 'major']
  if (degree === 7) return seventh ? ['dominant7', 'diminished7'] : ['major', 'diminished']
  // III+ (the harmonic-minor mediant) alongside the natural-minor III.
  if (degree === 3) return seventh ? ['major7', 'augmentedMajor7'] : ['major', 'augmented']
  return [at(seventh ? NATURAL_MINOR_SEVENTHS : NATURAL_MINOR_QUALITIES, degree - 1)]
}

/** Whether `degree` can be the target of an applied ("secondary") chord in this key. */
function canBeTonicised(key: Key, degree: number): boolean {
  if (degree === 1) return false
  const quality = at(allowedQualitiesFor(key, degree, false), 0)
  return quality === 'major' || quality === 'minor'
}

/** A fifth above `root`, correctly spelled — the root of the applied dominant of `root`. */
function dominantRootOf(root: SpelledPitch): SpelledPitch {
  return noteAtDegree(buildScale(root, 'major'), 5)
}

/** A semitone below `root`, correctly spelled — the root of the applied leading tone of `root`. */
function leadingToneRootOf(root: SpelledPitch): SpelledPitch {
  return noteAtDegree(buildScale(root, 'major'), 0)
}

function sameSpelling(a: SpelledPitch, b: SpelledPitch): boolean {
  return a.letter === b.letter && a.alter === b.alter
}

// ---------------------------------------------------------------------------
// diatonicChords
// ---------------------------------------------------------------------------

/**
 * The seven diatonic triads (or seventh chords) of a key, degree 1 first.
 *
 * For a minor key this is the **natural-minor** reading only (v is minor, VII is major) —
 * it deliberately does not mix in the harmonic-minor V/vii° that `romanNumeralFor` and
 * `chordForRomanNumeral` also recognise at those degrees, so a consumer enumerating this
 * array for drill items will not see the minor-key authentic cadence V-i. Callers that need
 * it can build `chordForRomanNumeral('V', key)` / `('vii°', key)` directly.
 */
export function diatonicChords(key: Key, seventh = false): readonly Chord[] {
  const qualities =
    key.mode === 'major'
      ? seventh
        ? MAJOR_SEVENTHS
        : MAJOR_QUALITIES
      : seventh
        ? NATURAL_MINOR_SEVENTHS
        : NATURAL_MINOR_QUALITIES
  const scale = homeScale(key)
  return qualities.map((quality, i) => buildChord(noteAtDegree(scale, i + 1), quality))
}

// ---------------------------------------------------------------------------
// romanNumeralFor
// ---------------------------------------------------------------------------

/** Case carries quality in roman numerals: the applied target's roman must reflect
 *  whether its own diatonic triad is major/dominant (upper) or minor/diminished (lower). */
function appliedTargetText(key: Key, appliedTo: number): string {
  const targetRoman = at(DEGREE_ROMAN, appliedTo - 1)
  const targetQuality = at(allowedQualitiesFor(key, appliedTo, false), 0)
  return LOWERCASE_QUALITIES.has(targetQuality) ? targetRoman.toLowerCase() : targetRoman
}

function makeNumeral(
  key: Key,
  degree: number,
  quality: ChordQuality,
  inversion: Inversion,
  figure: string,
  appliedTo?: number,
  alter = 0,
): RomanNumeral {
  const roman = at(DEGREE_ROMAN, degree - 1)
  const base = LOWERCASE_QUALITIES.has(quality) ? roman.toLowerCase() : roman
  const symbol =
    quality === 'diminished' || quality === 'diminished7'
      ? '°'
      : quality === 'halfDiminished7'
        ? 'ø'
        : quality === 'augmented' || quality === 'augmentedMajor7'
          ? '+'
          : ''
  const sign = alter < 0 ? 'b'.repeat(-alter) : alter > 0 ? '#'.repeat(alter) : ''
  const suffix = appliedTo === undefined ? '' : `/${appliedTargetText(key, appliedTo)}`
  const text = `${sign}${base}${symbol}${figure}${suffix}`
  const core = { degree, quality, inversion, alter, text }
  return appliedTo === undefined ? core : { ...core, appliedTo }
}

/** The roman numeral for a chord in a key, or null if it is not analysable in that key. */
export function romanNumeralFor(chord: Chord, key: Key): RomanNumeral | null {
  const seventh = chord.notes.length === 4
  const figure = figuredBass(chord)

  for (let degree = 1; degree <= 7; degree++) {
    if (!allowedQualitiesFor(key, degree, seventh).includes(chord.quality)) continue
    if (sameSpelling(rootFor(key, degree, chord.quality), chord.root)) {
      return makeNumeral(key, degree, chord.quality, chord.inversion, figure)
    }
  }

  for (let target = 1; target <= 7; target++) {
    if (!canBeTonicised(key, target)) continue
    try {
      const targetRoot = plainRootFor(key, target)
      if (chord.quality === 'major' || chord.quality === 'dominant7') {
        if (sameSpelling(dominantRootOf(targetRoot), chord.root)) {
          return makeNumeral(key, 5, chord.quality, chord.inversion, figure, target)
        }
      } else if (
        chord.quality === 'diminished' ||
        chord.quality === 'diminished7' ||
        chord.quality === 'halfDiminished7'
      ) {
        if (sameSpelling(leadingToneRootOf(targetRoot), chord.root)) {
          return makeNumeral(key, 7, chord.quality, chord.inversion, figure, target)
        }
      }
    } catch {
      continue
    }
  }

  if (key.mode === 'major') {
    const minorScale = buildScale(key.tonic, 'naturalMinor')
    for (const degree of [3, 6, 7]) {
      const quality = at(seventh ? NATURAL_MINOR_SEVENTHS : NATURAL_MINOR_QUALITIES, degree - 1)
      if (chord.quality !== quality) continue
      if (sameSpelling(noteAtDegree(minorScale, degree), chord.root)) {
        return makeNumeral(key, degree, chord.quality, chord.inversion, figure, undefined, -1)
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// chordForRomanNumeral
// ---------------------------------------------------------------------------

const NUMERAL_ALTERNATION = 'VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i'
// 'o' is accepted alongside '°' for the diminished symbol — plain ASCII text
// (as in the contract's own "viio7/ii") is common input and means the same thing.
const ROMAN_PATTERN = new RegExp(
  `^([b#]?)(${NUMERAL_ALTERNATION})(°|o|ø|\\+)?(6/4|6/5|4/3|4/2|7|6)?(?:/([b#]?)(${NUMERAL_ALTERNATION}))?$`,
)

const TRIAD_FIGURE_TO_INVERSION: Readonly<Record<string, Inversion>> = { '': 0, '6': 1, '6/4': 2 }
const SEVENTH_FIGURE_TO_INVERSION: Readonly<Record<string, Inversion>> = {
  '7': 0,
  '6/5': 1,
  '4/3': 2,
  '4/2': 3,
}

type ParsedNumeral = {
  readonly sign: '' | 'b' | '#'
  readonly degree: number
  readonly isUpper: boolean
  readonly symbol: '' | '°' | 'ø' | '+'
  readonly figure: string
  readonly appliedDegree?: number
}

function parseRomanText(text: string): Result<ParsedNumeral, string> {
  const trimmed = text.trim()
  const match = ROMAN_PATTERN.exec(trimmed)
  if (match === null) {
    return err(`not a roman numeral: '${text}' (expected something like 'V6/5', 'bVII' or 'viio7/V')`)
  }
  const sign = at(match, 1) as '' | 'b' | '#'
  const numeral = at(match, 2)
  const rawSymbol = match[3] ?? ''
  const symbol = (rawSymbol === 'o' ? '°' : rawSymbol) as '' | '°' | 'ø' | '+'
  const figure = match[4] ?? ''
  const appliedNumeral = match[6]

  const degree = ROMAN_TO_DEGREE[numeral.toUpperCase()]
  if (degree === undefined) return err(`unrecognised roman numeral in '${text}'`)
  const isUpper = numeral === numeral.toUpperCase()

  const core = { sign, degree, isUpper, symbol, figure }
  if (appliedNumeral === undefined) return ok(core)
  const appliedDegree = ROMAN_TO_DEGREE[appliedNumeral.toUpperCase()]
  if (appliedDegree === undefined) return err(`unrecognised applied target in '${text}'`)
  return ok({ ...core, appliedDegree })
}

function figureToInversion(figure: string, seventh: boolean): Result<Inversion, string> {
  const table = seventh ? SEVENTH_FIGURE_TO_INVERSION : TRIAD_FIGURE_TO_INVERSION
  const inversion = table[figure]
  if (inversion === undefined) {
    return err(`'${figure}' is not a valid ${seventh ? 'seventh-chord' : 'triad'} figure`)
  }
  return ok(inversion)
}

/** Candidate qualities a case + symbol + arity combination could mean. */
function candidateQualities(
  isUpper: boolean,
  symbol: '' | '°' | 'ø' | '+',
  seventh: boolean,
): readonly ChordQuality[] {
  if (symbol === '°') return seventh ? ['diminished7'] : ['diminished']
  if (symbol === 'ø') return seventh ? ['halfDiminished7'] : []
  if (symbol === '+') return seventh ? ['augmentedMajor7'] : ['augmented']
  if (seventh) return isUpper ? ['dominant7', 'major7'] : ['minor7']
  return isUpper ? ['major'] : ['minor']
}

function tryBuild(root: SpelledPitch, quality: ChordQuality, inversion: Inversion, text: string): Result<Chord, string> {
  try {
    return ok(buildChord(root, quality, inversion))
  } catch (cause) {
    return err(`cannot build '${text}': ${String(cause)}`)
  }
}

function buildDiatonic(
  parsed: ParsedNumeral,
  seventh: boolean,
  inversion: Inversion,
  key: Key,
  text: string,
): Result<Chord, string> {
  const allowed = allowedQualitiesFor(key, parsed.degree, seventh)
  const quality = candidateQualities(parsed.isUpper, parsed.symbol, seventh).find((q) =>
    allowed.includes(q),
  )
  if (quality === undefined) {
    return err(`'${text}' is not a diatonic degree ${parsed.degree} chord in ${keyName(key)}`)
  }
  return tryBuild(rootFor(key, parsed.degree, quality), quality, inversion, text)
}

function buildApplied(
  parsed: ParsedNumeral,
  appliedDegree: number,
  seventh: boolean,
  inversion: Inversion,
  key: Key,
  text: string,
): Result<Chord, string> {
  if (appliedDegree < 1 || appliedDegree > 7) return err(`invalid applied target in '${text}'`)
  if (!canBeTonicised(key, appliedDegree)) {
    return err(`degree ${appliedDegree} cannot be tonicised in ${keyName(key)}, in '${text}'`)
  }
  const targetRoot = plainRootFor(key, appliedDegree)
  // Applied roots are built by transposing to another degree's own scale, which drifts
  // out of the key's register (`key.tonic.octave`) — normalise it back in.
  const inKeyOctave = (p: SpelledPitch): SpelledPitch => spell(p.letter, p.alter, key.tonic.octave)

  if (parsed.degree === 5) {
    if (!parsed.isUpper || parsed.symbol !== '') {
      return err(`an applied dominant must be written 'V' or 'V7', got '${text}'`)
    }
    const quality: ChordQuality = seventh ? 'dominant7' : 'major'
    return tryBuild(inKeyOctave(dominantRootOf(targetRoot)), quality, inversion, text)
  }

  if (parsed.degree === 7) {
    if (parsed.isUpper) return err(`an applied leading-tone chord must be lowercase, got '${text}'`)
    if (parsed.symbol === 'ø' && !seventh) return err(`'ø' requires a seventh chord in '${text}'`)
    const quality: ChordQuality =
      parsed.symbol === 'ø' ? 'halfDiminished7' : seventh ? 'diminished7' : 'diminished'
    return tryBuild(inKeyOctave(leadingToneRootOf(targetRoot)), quality, inversion, text)
  }

  return err(`only V/x and vii°/x applied chords are supported, got '${text}'`)
}

function buildBorrowed(
  parsed: ParsedNumeral,
  seventh: boolean,
  inversion: Inversion,
  key: Key,
  text: string,
): Result<Chord, string> {
  if (parsed.sign !== 'b') return err(`only flat-sign borrowed chords are supported, got '${text}'`)
  if (key.mode !== 'major') {
    return err(`borrowed chords are only supported analysing a major key, got '${text}' in ${keyName(key)}`)
  }
  if (parsed.degree !== 3 && parsed.degree !== 6 && parsed.degree !== 7) {
    return err(`'${text}' is not a supported borrowed chord (only bIII, bVI, bVII)`)
  }
  const expected = at(seventh ? NATURAL_MINOR_SEVENTHS : NATURAL_MINOR_QUALITIES, parsed.degree - 1)
  if (!candidateQualities(parsed.isUpper, parsed.symbol, seventh).includes(expected)) {
    return err(`'${text}' does not match the borrowed-chord quality in ${keyName(key)}`)
  }
  const root = noteAtDegree(buildScale(key.tonic, 'naturalMinor'), parsed.degree)
  return tryBuild(root, expected, inversion, text)
}

/** Parse printed roman-numeral text ("V6/5", "bVII", "viio7/V") into the chord it names. */
export function chordForRomanNumeral(text: string, key: Key): Result<Chord, string> {
  const parsed = parseRomanText(text)
  if (!parsed.ok) return parsed
  const { sign, figure, appliedDegree } = parsed.value

  const seventh = figure === '7' || figure === '6/5' || figure === '4/3' || figure === '4/2'
  const inversion = figureToInversion(figure, seventh)
  if (!inversion.ok) return inversion

  if (appliedDegree !== undefined) {
    if (sign !== '') return err(`borrowed and applied notation cannot combine in '${text}'`)
    return buildApplied(parsed.value, appliedDegree, seventh, inversion.value, key, text)
  }
  if (sign !== '') return buildBorrowed(parsed.value, seventh, inversion.value, key, text)
  return buildDiatonic(parsed.value, seventh, inversion.value, key, text)
}

// ---------------------------------------------------------------------------
// function, cadence, progressions
// ---------------------------------------------------------------------------

export function functionOf(numeral: RomanNumeral, _key: Key): HarmonicFunction {
  // A borrowed bVII (the subtonic) has no leading tone, so it is definitionally not a
  // dominant-function chord, unlike bIII/bVI which land on defensible tonic-function degrees.
  if (numeral.alter !== 0 && numeral.degree === 7 && numeral.appliedTo === undefined) {
    return 'predominant'
  }
  const degree = numeral.appliedTo ?? numeral.degree
  if (degree === 1 || degree === 3 || degree === 6) return 'tonic'
  if (degree === 2 || degree === 4) return 'predominant'
  return 'dominant'
}

/**
 * Classify the cadence formed by the last two chords of a phrase. `sopranoMidi` is the top
 * sounding pitch of the FINAL chord, which is what separates a perfect from an imperfect
 * authentic cadence; omit it when unknown and never guess perfect.
 */
export function classifyCadence(
  penultimate: Chord,
  final: Chord,
  key: Key,
  sopranoMidi?: Midi,
): CadenceType {
  const pn = romanNumeralFor(penultimate, key)
  const fn = romanNumeralFor(final, key)
  if (pn === null || fn === null) return 'none'
  // Secondary functions (V/V, viio7/ii, ...) tonicise some other key area, not the phrase's
  // actual key, so they never form a cadence in it.
  if (pn.appliedTo !== undefined || fn.appliedTo !== undefined) return 'none'

  const isDominant = (c: Chord): boolean => c.quality === 'major' || c.quality === 'dominant7'

  if (pn.degree === 5 && fn.degree === 1 && isDominant(penultimate)) {
    const rootPosition = penultimate.inversion === 0 && final.inversion === 0
    const tonicPitchClass = toMidi(key.tonic) % 12
    const sopranoIsTonic = sopranoMidi !== undefined && sopranoMidi % 12 === tonicPitchClass
    return rootPosition && sopranoIsTonic ? 'perfect-authentic' : 'imperfect-authentic'
  }
  if (fn.degree === 5 && isDominant(final)) return 'half'
  if (pn.degree === 4 && fn.degree === 1) return 'plagal'
  // Deceptive is V resolving to anything but I (in practice, most often vi) — a plain
  // fallback after the authentic-cadence check above already claimed V-I.
  if (pn.degree === 5 && isDominant(penultimate)) return 'deceptive'
  return 'none'
}

/** Named common progressions, for recognition and for generating drill items. */
export const COMMON_PROGRESSIONS: readonly Progression[] = [
  { name: 'I-IV-V-I / i-iv-V-i (authentic)', numerals: ['I', 'IV', 'V', 'I'] },
  { name: 'I-V-vi-IV (pop)', numerals: ['I', 'V', 'vi', 'IV'] },
  { name: 'vi-IV-I-V (pop, rotated)', numerals: ['vi', 'IV', 'I', 'V'] },
  { name: 'I-vi-IV-V (50s progression)', numerals: ['I', 'vi', 'IV', 'V'] },
  { name: 'ii-V-I (jazz cadence)', numerals: ['ii', 'V', 'I'] },
  { name: 'i-VI-III-VII (natural minor loop)', numerals: ['i', 'VI', 'III', 'VII'] },
]

/** Degree + sign + applied-target only — the part case and figures do not change. */
function normalize(numeral: string): string {
  const parsed = parseRomanText(numeral)
  if (!parsed.ok) return numeral
  const { sign, degree, appliedDegree } = parsed.value
  return `${sign}${degree}${appliedDegree === undefined ? '' : `/${appliedDegree}`}`
}

/** The named progression a numeral sequence spells, or null. Case- and inversion-insensitive. */
export function matchProgression(numerals: readonly string[]): Progression | null {
  const key = numerals.map(normalize).join('-')
  return COMMON_PROGRESSIONS.find((p) => p.numerals.map(normalize).join('-') === key) ?? null
}
