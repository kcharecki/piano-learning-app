/**
 * Pitch spelling — the layer everything else in `core/theory` sits on.
 *
 * Two representations coexist, deliberately:
 *  - `Midi` is what *sounds*: an integer 0–127, the unit the rest of the core
 *    speaks (60 = middle C). It cannot tell C# from Db.
 *  - `SpelledPitch` is what is *written*: letter + accidental + octave. Key
 *    signatures, intervals and roman numerals are all statements about
 *    spelling, so throwing it away at the door would make them unimplementable.
 *
 * The classic bug this file exists to prevent: octave numbering follows the
 * *written* letter, not the sounding pitch. Cb4 sounds as MIDI 59 (a B) but is
 * still written in octave 4; B#3 sounds as MIDI 60 (a C) but is written in
 * octave 3. `toMidi` therefore may not be implemented as "octave of the
 * sounding note" — it is `(octave + 1) * 12 + letterSemitone + alter`, and the
 * arithmetic is allowed to cross the octave boundary on its own.
 */
import { at } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { isValidMidi, midi, type Midi } from '@core/shared/units.ts'

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

/** -2 double flat, -1 flat, 0 natural, 1 sharp, 2 double sharp */
export type Alter = -2 | -1 | 0 | 1 | 2

/** Scientific pitch notation: C4 is middle C = MIDI 60. */
export type SpelledPitch = {
  readonly letter: Letter
  readonly alter: Alter
  readonly octave: number
}

/** Letters in diatonic order starting at C, which is where octaves start too. */
export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Semitone offset of each natural letter above the C of its own octave. */
const LETTER_SEMITONE: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const SEMITONES_PER_OCTAVE = 12
const LETTERS_PER_OCTAVE = 7

/** Indexed by `alter + 2`; doubles as the range check when parsing accidentals. */
const ALTERS: readonly Alter[] = [-2, -1, 0, 1, 2]

/**
 * Octaves `parsePitch` will accept. MIDI only spans C-1 to G9; the extra slack
 * on both ends leaves room for spellings that cross the boundary (Cb-1, B#9)
 * without accepting obvious garbage such as `C4000`.
 */
const MIN_OCTAVE = -2
const MAX_OCTAVE = 10

type PitchClassSpelling = { readonly letter: Letter; readonly alter: Alter }

/** Default spelling of each pitch class: naturals, black keys as sharps. */
const SHARP_SPELLINGS: readonly PitchClassSpelling[] = [
  { letter: 'C', alter: 0 },
  { letter: 'C', alter: 1 },
  { letter: 'D', alter: 0 },
  { letter: 'D', alter: 1 },
  { letter: 'E', alter: 0 },
  { letter: 'F', alter: 0 },
  { letter: 'F', alter: 1 },
  { letter: 'G', alter: 0 },
  { letter: 'G', alter: 1 },
  { letter: 'A', alter: 0 },
  { letter: 'A', alter: 1 },
  { letter: 'B', alter: 0 },
]

/** Flat spelling of each pitch class. Naturals are identical; black keys flip. */
const FLAT_SPELLINGS: readonly PitchClassSpelling[] = [
  { letter: 'C', alter: 0 },
  { letter: 'D', alter: -1 },
  { letter: 'D', alter: 0 },
  { letter: 'E', alter: -1 },
  { letter: 'E', alter: 0 },
  { letter: 'F', alter: 0 },
  { letter: 'G', alter: -1 },
  { letter: 'G', alter: 0 },
  { letter: 'A', alter: -1 },
  { letter: 'A', alter: 0 },
  { letter: 'B', alter: -1 },
  { letter: 'B', alter: 0 },
]

/** Letter, then any run of accidentals, then a (possibly negative) octave. */
const PITCH_PATTERN = /^([A-Za-z])([#sSbB]*)(-?\d+)$/

/**
 * The sounding semitone number, unclamped — may fall outside 0–127. Everything
 * that compares or converts pitches goes through this one expression, so the
 * enharmonic/octave rule is stated exactly once.
 */
function soundingSemitone(p: SpelledPitch): number {
  return (p.octave + 1) * SEMITONES_PER_OCTAVE + LETTER_SEMITONE[p.letter] + p.alter
}

/** `''`, `'#'`, `'##'`, `'b'`, `'bb'`. */
function accidentalText(alter: Alter): string {
  return alter < 0 ? 'b'.repeat(-alter) : '#'.repeat(alter)
}

function accidentalGlyphs(alter: Alter): string {
  // Doubles are written as two singles rather than as U+1D12A/U+1D12B: the
  // double-sharp and double-flat glyphs live outside the BMP and are missing
  // from most UI font stacks, where they render as a replacement box. Two
  // sharps is legible everywhere and unambiguous.
  return alter < 0 ? '♭'.repeat(-alter) : '♯'.repeat(alter)
}

/** Build a pitch. Throws on a non-integer octave (programmer error). */
export function spell(letter: Letter, alter: Alter, octave: number): SpelledPitch {
  if (!Number.isInteger(octave)) {
    throw new RangeError(`spell: octave must be an integer, got ${octave}`)
  }
  return { letter, alter, octave }
}

/** C=0 … B=6, the diatonic index used for letter-name arithmetic. */
export function letterIndex(l: Letter): number {
  return LETTERS.indexOf(l)
}

/**
 * Sounding MIDI note. Throws a RangeError outside 0–127 — callers holding a
 * pitch they have not range-checked should use {@link tryToMidi}.
 */
export function toMidi(p: SpelledPitch): Midi {
  const n = soundingSemitone(p)
  if (!isValidMidi(n)) {
    throw new RangeError(`toMidi: ${pitchName(p)} sounds as ${n}, outside the MIDI range 0..127`)
  }
  return midi(n)
}

/** Sounding MIDI note, or an explanation of why the pitch is unplayable. */
export function tryToMidi(p: SpelledPitch): Result<Midi, string> {
  const n = soundingSemitone(p)
  if (!isValidMidi(n)) {
    return err(`${pitchName(p)} sounds as ${n}, outside the MIDI range 0..127`)
  }
  return ok(midi(n))
}

/**
 * Canonical spelling of a sounding note: naturals for the white keys, and
 * C#/D#/F#/G#/A# for the black ones unless `preferFlats` asks for
 * Db/Eb/Gb/Ab/Bb. Never produces B#/Cb/E#/Fb, so the octave is always the
 * octave of the sounding note.
 */
export function fromMidi(note: Midi, preferFlats = false): SpelledPitch {
  const table = preferFlats ? FLAT_SPELLINGS : SHARP_SPELLINGS
  const spelling = at(table, pitchClass(note))
  return spell(spelling.letter, spelling.alter, octaveOf(note))
}

/** `'C#4'`, `'Bb3'`, `'F##2'`, `'Ebb5'`. Inverse of {@link parsePitch}. */
export function pitchName(p: SpelledPitch): string {
  return `${p.letter}${accidentalText(p.alter)}${p.octave}`
}

/**
 * The same name written for a HUMAN to read: real accidental glyphs rather
 * than the ASCII stand-ins.
 *
 * `pitchName` is the machine form — it round-trips through `parsePitch`, so it
 * has to stay ASCII, and `Bb3` is what belongs in an id, a fixture or a log.
 * Anything a learner reads should say `B♭3`, because that is the character
 * printed on their score. Keeping the two apart means neither has to
 * compromise: this one is free to be unparseable, and that one is free to be
 * ugly.
 *
 * @see pitchName for the parseable form.
 */
export function pitchDisplayName(p: SpelledPitch): string {
  return `${p.letter}${accidentalGlyphs(p.alter)}${p.octave}`
}

/**
 * Parse scientific pitch notation. The letter is case-insensitive; sharps may
 * be written `#` or `s` (`Cs4` = `C#4`) and flats `b`. Returns an Err rather
 * than throwing, because this reads text from files and from the user.
 *
 * @public — no production caller yet (nothing reads pitch text on an import
 * path today), but it is the shared `'C#4'`-style fixture builder several
 * other modules' test suites import directly (`chords.test.ts`,
 * `chord-recognition.test.ts`, `scale-fingering.test.ts`, `scales.test.ts`),
 * so it is not dead — just not yet wired to a production reader.
 */
export function parsePitch(text: string): Result<SpelledPitch, string> {
  const trimmed = text.trim()
  if (trimmed.length === 0) return err('empty pitch name')

  const match = PITCH_PATTERN.exec(trimmed)
  if (match === null) {
    return err(`not a pitch name: '${text}' (expected something like 'C#4' or 'Bb3')`)
  }

  const letterText = at(match, 1).toUpperCase()
  const letter = LETTERS.find((l) => l === letterText)
  if (letter === undefined) return err(`unknown note letter '${at(match, 1)}' in '${text}'`)

  const accidentals = at(match, 2).toLowerCase()
  const flats = [...accidentals].filter((c) => c === 'b').length
  const sharps = accidentals.length - flats
  if (flats > 0 && sharps > 0) {
    return err(`mixed sharps and flats in '${text}'`)
  }
  const alter = ALTERS[sharps - flats + 2]
  if (alter === undefined) {
    return err(`too many accidentals in '${text}' (at most a double sharp or double flat)`)
  }

  const octave = Number(at(match, 3))
  if (octave < MIN_OCTAVE || octave > MAX_OCTAVE) {
    return err(`octave ${octave} out of range ${MIN_OCTAVE}..${MAX_OCTAVE} in '${text}'`)
  }

  return ok(spell(letter, alter, octave))
}

/** 0–11, where 0 is C. */
export function pitchClass(note: Midi): number {
  return note % SEMITONES_PER_OCTAVE
}

/** 0–11 for a written pitch, wrapping so that Cb4 is 11 and B#3 is 0. */
export function spelledPitchClass(p: SpelledPitch): number {
  const raw = (LETTER_SEMITONE[p.letter] + p.alter) % SEMITONES_PER_OCTAVE
  return (raw + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE
}

/** Octave of a sounding note: MIDI 60 → 4, MIDI 59 → 3, MIDI 0 → -1. */
export function octaveOf(note: Midi): number {
  return Math.floor(note / SEMITONES_PER_OCTAVE) - 1
}

/**
 * Move by letter-name steps, keeping the accidental and carrying the octave at
 * the B→C boundary: B4 + 1 step is C5, C4 - 1 step is B3. The accidental rides
 * along unchanged, so F#4 + 3 steps is B#4 — scale spelling is the caller's
 * job, this is pure letter arithmetic.
 */
export function diatonicStep(p: SpelledPitch, steps: number): SpelledPitch {
  if (!Number.isInteger(steps)) {
    throw new RangeError(`diatonicStep: steps must be an integer, got ${steps}`)
  }
  const index = letterIndex(p.letter) + steps
  const octaveShift = Math.floor(index / LETTERS_PER_OCTAVE)
  const letter = at(LETTERS, index - octaveShift * LETTERS_PER_OCTAVE)
  return spell(letter, p.alter, p.octave + octaveShift)
}

/** `pitchName(fromMidi(note, preferFlats))` — the common one-liner. */
export function midiToName(note: Midi, preferFlats = false): string {
  return pitchName(fromMidi(note, preferFlats))
}
