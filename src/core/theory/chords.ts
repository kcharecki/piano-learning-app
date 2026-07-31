/**
 * Chords — stacked *spelled* intervals, inversions and symbols.
 *
 * The one rule this file exists to enforce: a chord is built by stacking
 * intervals on a written root, never by adding semitones to a MIDI number.
 * `transposeSpelled(D4, m3)` is F4; `D4 + 3 semitones` would let you write E#4,
 * which is the same key but the wrong note. D minor is D F A.
 *
 * Everything here is **exact**: construction, naming and parsing all work on
 * the written letter and accidental, never on the sounding pitch class, so
 * `C/Fb` is an error rather than a quiet rewrite of what the user typed. The
 * other direction of travel — **recognition**, which starts from sounding MIDI
 * notes and is legitimately ambiguous — lives in `chord-recognition.ts` and is
 * re-exported at the bottom of this file.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { type Midi } from '@core/shared/units.ts'
import { type Alter, LETTERS, spell, type SpelledPitch, toMidi } from './pitch.ts'
import { type Interval, type IntervalQuality, makeInterval, transposeSpelled } from './intervals.ts'

/**
 * These tuples are the source of truth for the *types*: `Triad` and `Seventh`
 * are read off them, so a quality can only exist if it is listed here, and the
 * `Record<ChordQuality, ...>` tables below then turn a missing entry — or a
 * stale extra one — into a compile error instead of a runtime `undefined`.
 */
export const TRIADS = ['major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4'] as const

export const SEVENTHS = [
  'dominant7',
  'major7',
  'minor7',
  'halfDiminished7',
  'diminished7',
  'minorMajor7',
  'augmentedMajor7',
] as const

export type Triad = (typeof TRIADS)[number]

export type Seventh = (typeof SEVENTHS)[number]

export type ChordQuality = Triad | Seventh

export const CHORD_QUALITIES = [...TRIADS, ...SEVENTHS] as const

/** 0 root position, 1 first inversion, 2 second, 3 third (sevenths only). */
export type Inversion = 0 | 1 | 2 | 3

export type Chord = {
  readonly root: SpelledPitch
  readonly quality: ChordQuality
  readonly inversion: Inversion
  /** Sounding order, lowest first, with the inversion applied. */
  readonly notes: readonly SpelledPitch[]
}

export const INVERSIONS: readonly Inversion[] = [0, 1, 2, 3]

/** Octave `parseChordSymbol` puts the root in — a chord symbol carries no octave. */
const PARSE_OCTAVE = 4

/** Indexed by `alter + 2`; doubles as the range check when parsing accidentals. */
const ALTERS: readonly Alter[] = [-2, -1, 0, 1, 2]

/** Only for pairs known to be legal; every one below is checked by the tests. */
const iv = (number: number, quality: IntervalQuality): Interval => {
  const result = makeInterval(number, quality)
  invariant(result.ok, `chords: illegal interval ${quality} ${number}`)
  return result.value
}

/**
 * The single source of truth: each chord as intervals above the root, written
 * the way a musician writes them. `diminished7` really is a *diminished*
 * seventh (B→Ab), not a major sixth, which is why B dim7 spells Ab and not G#.
 */
const CHORD_SPELLING: Readonly<Record<ChordQuality, readonly Interval[]>> = {
  major: [iv(1, 'perfect'), iv(3, 'major'), iv(5, 'perfect')],
  minor: [iv(1, 'perfect'), iv(3, 'minor'), iv(5, 'perfect')],
  diminished: [iv(1, 'perfect'), iv(3, 'minor'), iv(5, 'diminished')],
  augmented: [iv(1, 'perfect'), iv(3, 'major'), iv(5, 'augmented')],
  sus2: [iv(1, 'perfect'), iv(2, 'major'), iv(5, 'perfect')],
  sus4: [iv(1, 'perfect'), iv(4, 'perfect'), iv(5, 'perfect')],
  dominant7: [iv(1, 'perfect'), iv(3, 'major'), iv(5, 'perfect'), iv(7, 'minor')],
  major7: [iv(1, 'perfect'), iv(3, 'major'), iv(5, 'perfect'), iv(7, 'major')],
  minor7: [iv(1, 'perfect'), iv(3, 'minor'), iv(5, 'perfect'), iv(7, 'minor')],
  halfDiminished7: [iv(1, 'perfect'), iv(3, 'minor'), iv(5, 'diminished'), iv(7, 'minor')],
  diminished7: [iv(1, 'perfect'), iv(3, 'minor'), iv(5, 'diminished'), iv(7, 'diminished')],
  minorMajor7: [iv(1, 'perfect'), iv(3, 'minor'), iv(5, 'perfect'), iv(7, 'major')],
  augmentedMajor7: [iv(1, 'perfect'), iv(3, 'major'), iv(5, 'augmented'), iv(7, 'major')],
}

/**
 * Derive one total table from another, copying the keys the input *actually
 * has* so a quality added to {@link CHORD_SPELLING} propagates on its own.
 * Mapping a separate list of qualities and casting the result would only assert
 * completeness; this achieves it.
 */
function mapTable<K extends string, A, B>(
  table: Record<K, A>,
  f: (value: A) => B,
): Readonly<Record<K, B>> {
  const out: Record<string, B> = {}
  for (const key of Object.keys(table)) {
    out[key] = f(table[key as keyof Record<K, A>])
  }
  return Object.freeze(out) as Readonly<Record<K, B>>
}

/** Semitones above the root, root included as 0. Derived, so it cannot drift. */
export const CHORD_INTERVALS: Readonly<Record<ChordQuality, readonly number[]>> = mapTable(
  CHORD_SPELLING,
  (intervals) => Object.freeze(intervals.map((i) => i.semitones)),
)

/** Canonical output suffix. Major is the bare root: 'C', not 'Cmaj'. */
const SUFFIX: Readonly<Record<ChordQuality, string>> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: '+',
  sus2: 'sus2',
  sus4: 'sus4',
  dominant7: '7',
  major7: 'maj7',
  minor7: 'm7',
  halfDiminished7: 'm7b5',
  diminished7: 'dim7',
  minorMajor7: 'mMaj7',
  augmentedMajor7: '+maj7',
}

/**
 * Accepted input suffixes. Case is significant — `CM7` is a major seventh and
 * `Cm7` a minor one — so this is an exact-match table, not a fuzzy one.
 */
const SUFFIX_ALIASES: Readonly<Record<string, ChordQuality>> = {
  '': 'major',
  M: 'major',
  maj: 'major',
  m: 'minor',
  min: 'minor',
  '-': 'minor',
  dim: 'diminished',
  '°': 'diminished',
  aug: 'augmented',
  '+': 'augmented',
  sus2: 'sus2',
  sus: 'sus4',
  sus4: 'sus4',
  '7': 'dominant7',
  dom7: 'dominant7',
  maj7: 'major7',
  M7: 'major7',
  m7: 'minor7',
  min7: 'minor7',
  '-7': 'minor7',
  m7b5: 'halfDiminished7',
  ø: 'halfDiminished7',
  ø7: 'halfDiminished7',
  dim7: 'diminished7',
  '°7': 'diminished7',
  mMaj7: 'minorMajor7',
  mM7: 'minorMajor7',
  minMaj7: 'minorMajor7',
  '+maj7': 'augmentedMajor7',
  '+M7': 'augmentedMajor7',
  augMaj7: 'augmentedMajor7',
  'maj7#5': 'augmentedMajor7',
}

/** Figured bass, indexed by inversion. A root-position triad is unfigured. */
const TRIAD_FIGURES: readonly string[] = ['', '6', '6/4']
const SEVENTH_FIGURES: readonly string[] = ['7', '6/5', '4/3', '4/2']

/** Root position, one octave, lowest first. */
function stack(root: SpelledPitch, quality: ChordQuality): readonly SpelledPitch[] {
  return CHORD_SPELLING[quality].map((interval) => transposeSpelled(root, interval))
}

const octaveUp = (p: SpelledPitch): SpelledPitch => spell(p.letter, p.alter, p.octave + 1)

/** `''`, `'#'`, `'##'`, `'b'`, `'bb'`. */
function accidentalText(alter: Alter): string {
  return alter < 0 ? 'b'.repeat(-alter) : '#'.repeat(alter)
}

/** Letter plus accidental, no octave — how a chord symbol names a note. */
function rootText(p: SpelledPitch): string {
  return `${p.letter}${accidentalText(p.alter)}`
}

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

/** Triads take three notes, sevenths four. */
export function isTriad(q: ChordQuality): boolean {
  return CHORD_SPELLING[q].length === 3
}

/**
 * Build a chord by stacking spelled intervals on `root`, then rotating the
 * lowest `inversion` notes up an octave.
 *
 * Throws an `InvariantError` on a third inversion of a triad — a triad has no
 * fourth note to put in the bass, so asking for one is a programmer error, not
 * a value to clamp. Also throws when the spelling would need a triple
 * accidental (Cb diminished 7 wants Bbbb); no notation system can write it.
 */
export function buildChord(
  root: SpelledPitch,
  quality: ChordQuality,
  inversion: Inversion = 0,
): Chord {
  const tones = stack(root, quality)
  invariant(
    inversion < tones.length,
    `inversion ${inversion} does not exist on a ${quality} chord ` +
      `(${tones.length} notes, highest inversion ${tones.length - 1})`,
  )
  const notes = [...tones.slice(inversion), ...tones.slice(0, inversion).map(octaveUp)]
  return { root, quality, inversion, notes }
}

/** Re-voice a chord into another inversion. Same throwing rules as {@link buildChord}. */
export function invertChord(chord: Chord, inversion: Inversion): Chord {
  return buildChord(chord.root, chord.quality, inversion)
}

/** The chord's notes as sounding MIDI numbers, strictly ascending. */
export function chordMidi(chord: Chord): readonly Midi[] {
  return chord.notes.map(toMidi)
}

/** Root position, one octave — the shape drills ask the learner to play. */
export function chordTones(chord: Chord): readonly SpelledPitch[] {
  return stack(chord.root, chord.quality)
}

/** Triads: `''`, `'6'`, `'6/4'`. Sevenths: `'7'`, `'6/5'`, `'4/3'`, `'4/2'`. */
export function figuredBass(chord: Chord): string {
  const figures = isTriad(chord.quality) ? TRIAD_FIGURES : SEVENTH_FIGURES
  return at(figures, chord.inversion)
}

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

/** `'Dm'`, `'G7'`, `'C#dim'`, `'Bb+'`, `'Fmaj7'`, `'Bm7b5'`, `'Cm/Eb'`. */
export function chordSymbol(chord: Chord): string {
  const base = `${rootText(chord.root)}${SUFFIX[chord.quality]}`
  if (chord.inversion === 0) return base
  return `${base}/${rootText(at(chord.notes, 0))}`
}

/** Letter, accidentals, quality suffix, optional slash bass. */
const CHORD_PATTERN = /^([A-Ga-g])([#b]*)([^/]*)(?:\/([A-Ga-g])([#b]*))?$/

function parseAlter(text: string, symbol: string): Result<Alter, string> {
  const flats = [...text].filter((c) => c === 'b').length
  const sharps = text.length - flats
  if (flats > 0 && sharps > 0) return err(`mixed sharps and flats in '${symbol}'`)
  const alter = ALTERS[sharps - flats + 2]
  if (alter === undefined) return err(`too many accidentals in '${symbol}'`)
  return ok(alter)
}

function parseNoteText(
  letterText: string,
  accidentals: string,
  symbol: string,
): Result<SpelledPitch, string> {
  const upper = letterText.toUpperCase()
  const letter = LETTERS.find((l) => l === upper)
  invariant(letter !== undefined, `chord pattern matched a non-letter '${letterText}'`)
  const alter = parseAlter(accidentals, symbol)
  if (!alter.ok) return alter
  return ok(spell(letter, alter.value, PARSE_OCTAVE))
}

/**
 * Parse a chord symbol — the inverse of {@link chordSymbol}. The root lands in
 * octave 4, since a symbol says nothing about register. A slash bass that is a
 * chord member sets the inversion; one that is not is an error, because
 * `C/F#` is a different (and unnamed) object, not a C major triad.
 *
 * "Chord member" means the *written* note, letter and accidental both. `C/Fb`
 * and `C/B#` sound like C/E and C, but accepting them would silently respell
 * the caller's input, and spelling is what this module exists to preserve.
 */
export function parseChordSymbol(text: string): Result<Chord, string> {
  const trimmed = text.trim()
  if (trimmed.length === 0) return err('empty chord symbol')

  const match = CHORD_PATTERN.exec(trimmed)
  if (match === null) {
    return err(`not a chord symbol: '${text}' (expected something like 'Dm', 'G7' or 'Cm/Eb')`)
  }

  const root = parseNoteText(at(match, 1), at(match, 2), trimmed)
  if (!root.ok) return root

  const suffix = at(match, 3)
  const quality = SUFFIX_ALIASES[suffix]
  if (quality === undefined) return err(`unknown chord quality '${suffix}' in '${trimmed}'`)

  let tones: readonly SpelledPitch[]
  try {
    tones = stack(root.value, quality)
  } catch (cause) {
    return err(`cannot spell '${trimmed}': ${String(cause)}`)
  }

  const bassText = match[4]
  if (bassText === undefined) return ok(buildChord(root.value, quality, 0))

  // Group 5 always participates when group 4 does, even if it matched nothing.
  const bass = parseNoteText(bassText, at(match, 5), trimmed)
  if (!bass.ok) return bass
  const index = tones.findIndex(
    (t) => t.letter === bass.value.letter && t.alter === bass.value.alter,
  )
  if (index < 0) {
    return err(`bass note '${rootText(bass.value)}' is not a member of '${trimmed}'`)
  }
  return ok(buildChord(root.value, quality, at(INVERSIONS, index)))
}

// ---------------------------------------------------------------------------
// recognition — implemented next door, re-exported so callers keep one import
// ---------------------------------------------------------------------------

export { type ChordMatch, identifyChord, matchesChord } from './chord-recognition.ts'
