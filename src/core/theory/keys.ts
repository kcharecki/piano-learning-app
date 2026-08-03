/**
 * Keys and key signatures — the circle of fifths as data and as arithmetic.
 *
 * A key signature is stored the way MusicXML stores it: a single integer
 * `fifths`, positive for sharps and negative for flats. That one number is the
 * whole model, and every other fact follows from it by arithmetic rather than
 * by table lookup:
 *
 *  - the natural letters, ordered by fifths, are F C G D A E B — which is also
 *    the order sharps are written on the staff, and reversed, the order flats
 *    are written. So a letter's position in the circle is
 *    `SHARP_ORDER.indexOf(letter) - 1` (F = -1 … B = 5), and adding a sharp to
 *    a letter moves it seven stations round.
 *  - a minor key sits three fifths below the major that shares its signature
 *    (A minor and C major are both 0), which is the only difference the mode
 *    makes to any of the arithmetic here.
 *
 * Two conventions worth knowing before reading on:
 *
 *  - **A key's tonic is a pitch class, not a register.** It is stored as a
 *    `SpelledPitch` because spelling is the entire point (Gb major is not F#
 *    major), but the octave is always {@link KEY_OCTAVE}. `keyOf` normalises
 *    whatever octave it is handed, so keys compare equal by structure.
 *  - **{@link closelyRelatedKeys} deliberately does not wrap round the
 *    circle.** The circle has twelve stations, not fifteen, so the dominant of
 *    C# major is G# major (+8) — a signature with one more sharp than there
 *    are letters. Wrapping it to its standard equivalent, Ab major (-4), would
 *    be enharmonically true and pedagogically false: a lesson on key
 *    relationships means the theoretical key, not its respelling.
 *
 * Such a signature is still a legal value here — {@link enharmonicKey} maps it
 * back to a writable one — but {@link accidentalsOf} and {@link alterFor} throw
 * on it, because there is no way to write eight sharps with seven letters.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { err, mapResult, ok, type Result } from '@core/shared/result.ts'
import { type Alter, type Letter, spell, type SpelledPitch } from './pitch.ts'

export type Mode = 'major' | 'minor'

/** fifths is the MusicXML convention: -7..+7, negative = flats. */
export type KeySignature = { readonly fifths: number; readonly mode: Mode }

export type Key = {
  readonly tonic: SpelledPitch
  readonly mode: Mode
  readonly signature: KeySignature
}

/** The order sharps appear in a key signature — also the letters in fifths order. */
export const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']

/** The order flats appear in a key signature — `SHARP_ORDER` backwards. */
export const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

const LETTERS_PER_OCTAVE = 7

/** Twelve stations round the circle: +6 (F# major) and -6 (Gb major) are the same keys. */
const FIFTHS_IN_CIRCLE = 12

/** Beyond seven accidentals a signature needs a double sharp or flat, so nobody writes it. */
const MAX_FIFTHS = 7

/** A key's tonic carries no register; this is the octave every tonic is stored in. */
const KEY_OCTAVE = 4

/** A minor tonic lies three fifths below the major sharing its signature: A minor / C major. */
const RELATIVE_MINOR_FIFTHS = 3

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function isAlter(n: number): n is Alter {
  return Number.isInteger(n) && n >= -2 && n <= 2
}

/** `''`, `'#'`, `'bb'`. Same spelling rule as `pitchName`, minus the octave. */
function accidentalText(alter: number): string {
  return alter < 0 ? 'b'.repeat(-alter) : '#'.repeat(alter)
}

/** `'Bb'`, `'F#'`, `'C'` — a tonic has no register, so its name has no octave. */
function tonicName(p: SpelledPitch): string {
  return `${p.letter}${accidentalText(p.alter)}`
}

/** Where a natural letter sits on the circle: F = -1, C = 0, G = 1 … B = 5. */
function naturalFifths(letter: Letter): number {
  return SHARP_ORDER.indexOf(letter) - 1
}

/** Fifths of the *major* key with this tonic, ignoring the -7..+7 limit. */
function majorFifthsOf(tonic: SpelledPitch): number {
  return naturalFifths(tonic.letter) + LETTERS_PER_OCTAVE * tonic.alter
}

/** The fifths of the major key sharing a signature with `fifths` in `mode`. */
function relativeMajorFifths(fifths: number, mode: Mode): number {
  return mode === 'minor' ? fifths + RELATIVE_MINOR_FIFTHS : fifths
}

/**
 * Inverse of {@link majorFifthsOf}: the tonic spelling a signature implies.
 * Every seven stations round the circle adds one sharp to the letter, so the
 * letter is the position modulo seven and the accidental the quotient.
 */
function tonicForFifths(fifths: number, mode: Mode): SpelledPitch {
  const position = relativeMajorFifths(fifths, mode) + 1
  const alter = Math.floor(position / LETTERS_PER_OCTAVE)
  invariant(
    isAlter(alter),
    `tonicForFifths: ${fifths} fifths needs an accidental of ${alter} on the tonic, ` +
      `beyond the double sharp/double flat range`,
  )
  const index = ((position % LETTERS_PER_OCTAVE) + LETTERS_PER_OCTAVE) % LETTERS_PER_OCTAVE
  return spell(at(SHARP_ORDER, index), alter, KEY_OCTAVE)
}

/** Assemble a key from its signature. No range check — callers do their own. */
function buildKey(fifths: number, mode: Mode): Key {
  return { tonic: tonicForFifths(fifths, mode), mode, signature: { fifths, mode } }
}

function otherMode(mode: Mode): Mode {
  return mode === 'major' ? 'minor' : 'major'
}

/** Signatures with more accidentals than letters cannot be written on a staff. */
function requireWritable(sig: KeySignature): number {
  const count = Math.abs(sig.fifths)
  if (!Number.isInteger(sig.fifths) || count > MAX_FIFTHS) {
    throw new RangeError(
      `key signature of ${sig.fifths} fifths cannot be written: ` +
        `expected a whole number of fifths in -${MAX_FIFTHS}..${MAX_FIFTHS}`,
    )
  }
  return count
}

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

/**
 * The key with this signature. Throws a RangeError outside -7..+7 (programmer
 * error) — a signature that big has no standard notation; use {@link keyOf} if
 * the tonic comes from user input.
 */
export function keyFromFifths(fifths: number, mode: Mode): Key {
  if (!Number.isInteger(fifths) || Math.abs(fifths) > MAX_FIFTHS) {
    throw new RangeError(
      `keyFromFifths: expected a whole number of fifths in -${MAX_FIFTHS}..${MAX_FIFTHS}, ` +
        `got ${fifths}`,
    )
  }
  return buildKey(fifths, mode)
}

/**
 * The signature this tonic implies, or an explanation of why it has none: G#
 * major would need eight sharps, and Fb minor eleven flats.
 */
export function keySignatureForTonic(
  tonic: SpelledPitch,
  mode: Mode,
): Result<KeySignature, string> {
  const fifths = majorFifthsOf(tonic) - (mode === 'minor' ? RELATIVE_MINOR_FIFTHS : 0)
  const count = Math.abs(fifths)
  if (count > MAX_FIFTHS) {
    return err(
      `${tonicName(tonic)} ${mode} has no standard key signature ` +
        `(it would need ${count} ${fifths > 0 ? 'sharps' : 'flats'})`,
    )
  }
  return ok({ fifths, mode })
}

/**
 * The key with this tonic and mode. The tonic's octave is discarded — keys have
 * no register — so `keyOf(spell('D', 0, 2), 'major')` and
 * `keyOf(spell('D', 0, 7), 'major')` are the same key.
 */
export function keyOf(tonic: SpelledPitch, mode: Mode): Result<Key, string> {
  return mapResult(keySignatureForTonic(tonic, mode), (sig) => buildKey(sig.fifths, mode))
}

/**
 * The fifteen major keys, from Cb (-7) to C# (+7) in fifths order — the data
 * the circle-of-fifths UI renders. Minor keys come from `relativeKey`.
 */
export const CIRCLE_OF_FIFTHS: readonly Key[] = Array.from({ length: MAX_FIFTHS * 2 + 1 }, (_, i) =>
  keyFromFifths(i - MAX_FIFTHS, 'major'),
)

// ---------------------------------------------------------------------------
// reading a signature
// ---------------------------------------------------------------------------

/**
 * The accidentals of a signature, in the order they are written on the staff:
 * F# C# G#… for sharps, Bb Eb Ab… for flats. Always exactly `abs(fifths)` of
 * them, and always a prefix of {@link SHARP_ORDER} or {@link FLAT_ORDER}.
 *
 * Throws a RangeError on a theoretical signature (see {@link closelyRelatedKeys}),
 * which by definition cannot be written.
 *
 * @public — completes the "reading a signature" pair with {@link alterFor},
 * which is live (`musicxmlwriter.ts`, `scales.ts`): that one answers per
 * letter, this one gives the whole ordered list a key-signature renderer
 * needs, and the two are pinned together by test so they cannot drift apart.
 */
export function accidentalsOf(sig: KeySignature): readonly { letter: Letter; alter: -1 | 1 }[] {
  const count = requireWritable(sig)
  const sharps = sig.fifths > 0
  const order = sharps ? SHARP_ORDER : FLAT_ORDER
  const alter: -1 | 1 = sharps ? 1 : -1
  return order.slice(0, count).map((letter) => ({ letter, alter }))
}

/**
 * The accidental this key applies to a letter: 1 for F in G major, -1 for B in
 * F major, 0 for anything the signature does not touch. Throws on a theoretical
 * signature, like {@link accidentalsOf}.
 *
 * A notation renderer calls this once per note, so it indexes the order lists
 * directly rather than going through {@link accidentalsOf}, which would build a
 * fresh object per accidental every time. The two are pinned together by test.
 */
export function alterFor(sig: KeySignature, letter: Letter): -1 | 0 | 1 {
  const count = requireWritable(sig)
  const sharps = sig.fifths > 0
  const position = (sharps ? SHARP_ORDER : FLAT_ORDER).indexOf(letter)
  if (position < 0 || position >= count) return 0
  return sharps ? 1 : -1
}

/** `'Bb major'`, `'F# minor'`, `'C major'`. */
export function keyName(key: Key): string {
  return `${tonicName(key.tonic)} ${key.mode}`
}

// ---------------------------------------------------------------------------
// relationships
// ---------------------------------------------------------------------------

/** The relative key: same signature, other mode. C major ↔ A minor. Its own inverse. */
export function relativeKey(key: Key): Key {
  return buildKey(key.signature.fifths, otherMode(key.mode))
}

/**
 * The five keys a piece can modulate to without leaving the neighbourhood:
 * dominant, subdominant, relative, and the relatives of the dominant and
 * subdominant — every key whose signature differs by at most one accidental.
 * For C major: G major, F major, A minor, E minor, D minor.
 *
 * **This does not wrap round the circle.** The dominant of C# major is G#
 * major and the mediant is E# minor; answering Ab major and F minor would be
 * enharmonically true and pedagogically false, and this is the function a
 * lesson on key relationships asks. The two edge signatures therefore produce
 * one theoretical signature on each flank — G# major is +8, Fb major -8 —
 * and {@link enharmonicKey} respells them for a caller that has to draw a
 * staff. Every other key's neighbours are writable.
 */
export function closelyRelatedKeys(key: Key): readonly Key[] {
  const fifths = key.signature.fifths
  const dominant = buildKey(fifths + 1, key.mode)
  const subdominant = buildKey(fifths - 1, key.mode)
  return [dominant, subdominant, relativeKey(key), relativeKey(dominant), relativeKey(subdominant)]
}

/**
 * The other standard spelling of the same sounding key: C# major (+7) ↔ Db
 * major (-5), B (+5) ↔ Cb (-7), F# (+6) ↔ Gb (-6). `null` for the nine keys
 * with fewer than five accidentals, which have no second spelling.
 *
 * A theoretical signature (from {@link closelyRelatedKeys}) always has one,
 * since it lies outside the writable range by definition.
 */
export function enharmonicKey(key: Key): Key | null {
  for (const candidate of [
    key.signature.fifths - FIFTHS_IN_CIRCLE,
    key.signature.fifths + FIFTHS_IN_CIRCLE,
  ]) {
    if (Math.abs(candidate) <= MAX_FIFTHS) return buildKey(candidate, key.mode)
  }
  return null
}
