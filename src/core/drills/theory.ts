/**
 * Keyboard-answered theory quiz items, SRS-backed (roadmap 3.3, REQ-3.5.2).
 *
 * Five kinds, one shared shape: `buildTheoryQuiz(kind, level, rng)` returns a
 * single `TheoryQuizItem` — a prompt plus the sequence of note groups that
 * answers it. A group is one MIDI key (`build-scale`, `build-interval`,
 * `name-key-signature`) or a whole chord played together (`build-chord`,
 * `build-cadence`); `simultaneous` says which, for the whole item.
 *
 * All content is derived from `core/theory` (scales, chords, intervals, keys,
 * harmony), never restated: a `build-scale` item's answer is
 * `scaleNotes`'s reading of the tonic and type, a `build-chord` item's is
 * `buildChord`'s voicing, a `build-cadence` item's is
 * `chordForRomanNumeral`'s reading of the two roman numerals that make it up.
 *
 * ## Grading is octave-insensitive by default
 *
 * `gradeTheoryStep` compares each played group against the expected one by
 * **pitch class**, not exact MIDI number: a learner who plays the right chord
 * or scale an octave up has still built the right thing. The one exception
 * the contract calls for is `'build-scale'`, which stays order- and
 * direction-sensitive — but that falls out of the same comparison for free,
 * since groups are matched positionally: playing degree 3 before degree 2
 * makes the second played group fail to match the second expected group,
 * whatever octave either is in.
 *
 * ## Levels
 *
 * Every kind widens strictly with level — a wider key-signature range, more
 * scale types, more chord qualities and inversions, more cadence types — and
 * never narrows: level `n + 1`'s pool is `n`'s pool plus one more thing,
 * literally constructed that way below, so monotonicity is structural rather
 * than asserted.
 *
 * ## Determinism
 *
 * `buildTheoryQuiz` only ever reads `rng`; nothing here reads a clock or
 * touches IO, so the same `(kind, level, rng-with-the-same-seed)` always
 * produces the same item, id included. Ids are derived from the chosen
 * content (tonic, scale type, chord quality/inversion, ...), never from a
 * counter or from how many `rng` calls it took to get there, so the same
 * question reappearing after a reload keeps its SRS history.
 */
import { assertNever, at, invariant } from '@core/shared/invariant.ts'
import { type Midi } from '@core/shared/units.ts'
import { pick, type Rng } from '@core/ports/rng.ts'
import { pitchClass, pitchDisplayName, spell, toMidi, type Alter, type Letter, type SpelledPitch } from '@core/theory/pitch.ts'
import { buildScale, scaleName, scaleNotes, type ScaleType } from '@core/theory/scales.ts'
import { buildChord, isTriad, type Chord, type ChordQuality, type Inversion } from '@core/theory/chords.ts'
import { intervalLongName, makeInterval, SIMPLE_INTERVALS, transposeSpelled, tryTransposeSpelled, type Interval, type IntervalQuality } from '@core/theory/intervals.ts'
import { CIRCLE_OF_FIFTHS, keyFromFifths, keyName, keyOf, type Key, type Mode } from '@core/theory/keys.ts'
import { chordForRomanNumeral, type CadenceType } from '@core/theory/harmony.ts'
import { cadenceGroupMatches, type CadenceAnswer } from './cadenceGrading.ts'

// ---------------------------------------------------------------------------
// public shape
// ---------------------------------------------------------------------------

/** What a quiz item asks. Each is answerable ON THE KEYBOARD, per REQ-3.5.2. */
export type TheoryQuizKind =
  | 'build-scale' // "play C harmonic minor, ascending"
  | 'build-chord' // "play a D minor 7th, first inversion"
  | 'build-interval' // "play a major 6th above F"
  | 'name-key-signature' // "how many sharps has E major?" — answered by playing the tonic
  | 'build-cadence' // "play a perfect authentic cadence in G"

/**
 * Every kind, for callers that need to enumerate them (the level/topic UI,
 * and `theoryQuizFromId`'s id-prefix dispatch below) without restating the
 * union as a second, driftable list.
 */
export const ALL_THEORY_KINDS: readonly TheoryQuizKind[] = [
  'build-scale',
  'build-chord',
  'build-interval',
  'name-key-signature',
  'build-cadence',
]

export type { CadenceAnswer }

export type TheoryQuizItem = {
  /** Stable and derived from the content, so SRS scheduling survives a reload. */
  readonly id: string
  readonly kind: TheoryQuizKind
  /** The question, already written for a human. */
  readonly prompt: string
  /**
   * The MIDI notes that answer it, in the order they must be played. A chord
   * or a cadence step is a set played together — see `simultaneous`.
   *
   * Always `spelledAnswer` run through `toMidi`, never built separately —
   * `midiGroups` is the only thing that fills this field.
   */
  readonly answer: readonly (readonly Midi[])[]
  /**
   * The same notes as {@link answer}, still spelled: B♭ in F major, E♭ above
   * C, never A♯ or D♯.
   *
   * `toMidi` is lossy about spelling, and until this field existed the reveal
   * re-derived a name from the MIDI number with `fromMidi`, whose table is
   * sharps. That printed "F4, G4, A4, A♯4, …" for F major and "C4, D♯4" for
   * a minor third above C — an augmented second, which is not the interval
   * the prompt asked for. Every generator already holds the correct spelling
   * one line before it calls `toMidi`, so it is kept rather than guessed at.
   */
  readonly spelledAnswer: readonly (readonly SpelledPitch[])[]

  /**
   * What the answer IS, when naming the notes does not answer the question the
   * prompt asked. `'name-key-signature'` asks for a COUNT ("How many flats has
   * B♭ major?") and is answered at the keys, so naming only the note it wanted
   * ("it was B♭4") replies to the instruction and never to the question — a
   * learner who did not know the count still does not (panel r2 2026-08-24-1,
   * Teacher). Set only where the two differ; `describeTheoryAnswer` prefers it.
   */
  /**
   * What a `'build-cadence'` item actually asked for, so grading can ask
   * whether the learner played THE CADENCE rather than whether they played
   * one arrangement of it.
   *
   * Until this existed the answer was an exact MIDI list and `groupsMatch`
   * rejected on note count before it compared a pitch, so `C4 E4 G4 C5` — V-I,
   * both chords root position, tonic in the highest voice, every requirement a
   * perfect authentic cadence has — was marked wrong against a three-note
   * expectation (roadmap `T.23`, drive 2026-09-07). A cadence is a relation
   * between two chords, not a voicing of them, and the two chords are the only
   * thing needed to grade it that way.
   *
   * Set only by `makeCadenceItem`; `undefined` on every other kind, which is
   * what routes those to the exact-match path unchanged.
   */
  readonly cadence?: CadenceAnswer
  readonly answerSummary?: string
  /**
   * True when each group in `answer` is a chord (played together) rather
   * than a sequence. Descriptive metadata for a future consumer that wants
   * to enforce simultaneity on the MIDI path — `gradeTheoryStep` groups
   * presses purely by expected group length and never reads this field.
   */
  readonly simultaneous: boolean
}

export type TheoryAnswerResult = {
  readonly correct: boolean
  /** How far through `answer` the learner has got — for progressive feedback. */
  readonly matchedGroups: number
  /** Set once the attempt is settled, right or wrong. */
  readonly done: boolean
  /**
   * The item's own answer written for a learner — see
   * {@link describeTheoryAnswer}. Carried on every result, right or wrong;
   * whether a correct answer is worth echoing back is the caller's call.
   */
  readonly expected: string
}

// ---------------------------------------------------------------------------
// shared tuning
// ---------------------------------------------------------------------------

/** Register every generated note/root/chord/scale sits in, absent a reason to move it. */
const HOME_OCTAVE = 4

/**
 * `spelledAnswer` -> `answer`. Every maker below builds the spelled groups and
 * projects them through this, so the two fields cannot describe different
 * notes: there is one source of truth and one direction of travel.
 */
function midiGroups(
  groups: readonly (readonly SpelledPitch[])[],
): readonly (readonly Midi[])[] {
  return groups.map((group) => group.map(toMidi))
}

/** The widest a key signature ever gets: read off the theory module, never restated. */
const MAX_ACCIDENTALS = (CIRCLE_OF_FIFTHS.length - 1) / 2

const NATURAL_ROOTS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/**
 * Each level admits more roots than the last — naturals first, then the five
 * common flats/sharps — a strict superset, so higher levels keep asking
 * naturals too. Nested exactly like the other `*_BY_LEVEL` tables so
 * monotonicity stays structural.
 */
type RootSpec = { readonly letter: Letter; readonly alter: Alter }

const NATURAL_ROOT_SPECS: readonly RootSpec[] = NATURAL_ROOTS.map((letter) => ({ letter, alter: 0 }))

const ROOTS_BY_LEVEL: readonly (readonly RootSpec[])[] = [
  NATURAL_ROOT_SPECS,
  NATURAL_ROOT_SPECS,
  [
    ...NATURAL_ROOT_SPECS,
    { letter: 'B', alter: -1 },
    { letter: 'E', alter: -1 },
    { letter: 'A', alter: -1 },
  ],
  [
    ...NATURAL_ROOT_SPECS,
    { letter: 'B', alter: -1 },
    { letter: 'E', alter: -1 },
    { letter: 'A', alter: -1 },
    { letter: 'F', alter: 1 },
    { letter: 'C', alter: 1 },
  ],
]

function rootsForLevel(level: number): readonly RootSpec[] {
  const idx = Math.min(level, ROOTS_BY_LEVEL.length) - 1
  return at(ROOTS_BY_LEVEL, idx)
}

/** `''`, `'#'`, `'##'`, `'b'`, `'bb'` — matches `pitch.ts`'s own convention. */
function accidentalText(alter: number): string {
  return alter < 0 ? 'b'.repeat(-alter) : '#'.repeat(alter)
}

/** Letter + accidental, no octave — how a spelling reads in a prompt or an id. */
function tonicKey(p: SpelledPitch): string {
  return `${p.letter}${accidentalText(p.alter)}`
}

/** How many accidentals a level's key signatures may carry: 0 at level 1, capped at ±7. */
function fifthsRangeForLevel(level: number): number {
  return Math.min(MAX_ACCIDENTALS, level - 1)
}

/** Every fifths count a level admits, centred on 0 — strictly widening, never shrinking. */
function fifthsPoolForLevel(level: number): readonly number[] {
  const range = fifthsRangeForLevel(level)
  const pool: number[] = []
  for (let f = -range; f <= range; f++) pool.push(f)
  return pool
}

// ---------------------------------------------------------------------------
// build-scale
// ---------------------------------------------------------------------------

/** Each level admits one more scale type than the last — a strict superset. */
const SCALE_TYPES_BY_LEVEL: readonly (readonly ScaleType[])[] = [
  ['major'],
  ['major', 'naturalMinor'],
  ['major', 'naturalMinor', 'harmonicMinor'],
  ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor'],
]

function scaleTypesForLevel(level: number): readonly ScaleType[] {
  const idx = Math.min(level, SCALE_TYPES_BY_LEVEL.length) - 1
  return at(SCALE_TYPES_BY_LEVEL, idx)
}

function tonicForScaleType(fifths: number, type: ScaleType): SpelledPitch {
  const mode: Mode = type === 'major' ? 'major' : 'minor'
  return keyFromFifths(fifths, mode).tonic
}

/**
 * The construction proper, taking the resolved tonic/type directly rather
 * than picking them from `rng` — the single place both `buildScaleItem`
 * (random draw) and `theoryQuizFromId` (id round-trip, roadmap 3.20) build
 * the actual item, so the two can never drift apart.
 */
function makeScaleItem(tonic: SpelledPitch, type: ScaleType): TheoryQuizItem {
  const scale = buildScale(tonic, type)
  const spelled = scaleNotes(tonic, type, 1).map((p) => [p])
  return {
    id: `build-scale-${tonicKey(tonic)}-${type}`,
    kind: 'build-scale',
    prompt: `Play ${scaleName(scale)}, ascending.`,
    answer: midiGroups(spelled),
    spelledAnswer: spelled,
    simultaneous: false,
  }
}

function buildScaleItem(level: number, rng: Rng): TheoryQuizItem {
  const type = pick(rng, scaleTypesForLevel(level))
  const fifths = pick(rng, fifthsPoolForLevel(level))
  const tonic = tonicForScaleType(fifths, type)
  return makeScaleItem(tonic, type)
}

// ---------------------------------------------------------------------------
// build-chord
// ---------------------------------------------------------------------------

/** Each level admits more qualities than the last — a strict superset. */
const CHORD_QUALITIES_BY_LEVEL: readonly (readonly ChordQuality[])[] = [
  ['major', 'minor'],
  ['major', 'minor', 'diminished', 'augmented'],
  ['major', 'minor', 'diminished', 'augmented', 'dominant7', 'major7', 'minor7'],
  ['major', 'minor', 'diminished', 'augmented', 'dominant7', 'major7', 'minor7',
    'halfDiminished7', 'diminished7', 'minorMajor7', 'augmentedMajor7'],
]

/** Each level admits one more inversion than the last, filtered to what the chord has. */
const CHORD_INVERSIONS_BY_LEVEL: readonly (readonly Inversion[])[] = [
  [0],
  [0, 1],
  [0, 1, 2],
  [0, 1, 2, 3],
]

const CHORD_QUALITY_PHRASE: Readonly<Record<ChordQuality, string>> = {
  major: 'major',
  minor: 'minor',
  diminished: 'diminished',
  augmented: 'augmented',
  sus2: 'sus2',
  sus4: 'sus4',
  dominant7: 'dominant 7th',
  major7: 'major 7th',
  minor7: 'minor 7th',
  halfDiminished7: 'half-diminished 7th',
  diminished7: 'diminished 7th',
  minorMajor7: 'minor-major 7th',
  augmentedMajor7: 'augmented major 7th',
}

const CHORD_INVERSION_PHRASE: Readonly<Record<Inversion, string>> = {
  0: 'root position',
  1: 'first inversion',
  2: 'second inversion',
  3: 'third inversion',
}

function chordQualitiesForLevel(level: number): readonly ChordQuality[] {
  const idx = Math.min(level, CHORD_QUALITIES_BY_LEVEL.length) - 1
  return at(CHORD_QUALITIES_BY_LEVEL, idx)
}

function chordInversionsForLevel(level: number): readonly Inversion[] {
  const idx = Math.min(level, CHORD_INVERSIONS_BY_LEVEL.length) - 1
  return at(CHORD_INVERSIONS_BY_LEVEL, idx)
}

/** Same split as `makeScaleItem` — shared by `buildChordItem` and `theoryQuizFromId`. */
function makeChordItem(
  root: SpelledPitch,
  quality: ChordQuality,
  inversion: Inversion,
): TheoryQuizItem {
  const chord = buildChord(root, quality, inversion)
  return {
    id: `build-chord-${tonicKey(root)}-${quality}-${inversion}`,
    kind: 'build-chord',
    prompt:
      `Play a ${tonicKey(root)} ${CHORD_QUALITY_PHRASE[quality]} chord, ` +
      `${CHORD_INVERSION_PHRASE[inversion]}.`,
    answer: midiGroups([chord.notes]),
    spelledAnswer: [chord.notes],
    simultaneous: true,
  }
}

function buildChordItem(level: number, rng: Rng): TheoryQuizItem {
  const quality = pick(rng, chordQualitiesForLevel(level))
  const highestInversion = isTriad(quality) ? 2 : 3
  const inversions = chordInversionsForLevel(level).filter((i) => i <= highestInversion)
  const inversion = pick(rng, inversions)
  const rootSpec = pick(rng, rootsForLevel(level))
  const root = spell(rootSpec.letter, rootSpec.alter, HOME_OCTAVE)
  return makeChordItem(root, quality, inversion)
}

// ---------------------------------------------------------------------------
// build-interval
// ---------------------------------------------------------------------------

/** Each level admits one more diatonic number than the last — a strict superset. */
const INTERVAL_NUMBERS_BY_LEVEL: readonly (readonly number[])[] = [
  [2, 3],
  [2, 3, 4, 5],
  [2, 3, 4, 5, 6],
  [2, 3, 4, 5, 6, 7, 8],
]

function intervalNumbersForLevel(level: number): readonly number[] {
  const idx = Math.min(level, INTERVAL_NUMBERS_BY_LEVEL.length) - 1
  return at(INTERVAL_NUMBERS_BY_LEVEL, idx)
}

/**
 * `transposeSpelled`, falling back to a C root (always writable for every
 * interval in `SIMPLE_INTERVALS`) if the picked root cannot carry it. Never
 * throws.
 */
function safeInterval(
  root: SpelledPitch,
  interval: Interval,
): { readonly root: SpelledPitch; readonly target: SpelledPitch } {
  const tried = tryTransposeSpelled(root, interval, 1)
  if (tried.ok) return { root, target: tried.value }
  const fallbackRoot = spell('C', 0, HOME_OCTAVE)
  return { root: fallbackRoot, target: transposeSpelled(fallbackRoot, interval, 1) }
}

/** Same split as `makeScaleItem` — shared by `buildIntervalItem` and `theoryQuizFromId`. */
function makeIntervalItem(
  root: SpelledPitch,
  interval: Interval,
  target: SpelledPitch,
): TheoryQuizItem {
  return {
    id: `build-interval-${tonicKey(root)}-${interval.number}-${interval.quality}`,
    kind: 'build-interval',
    prompt: `Play ${tonicKey(root)}, then a ${intervalLongName(interval)} above it.`,
    answer: midiGroups([[root], [target]]),
    spelledAnswer: [[root], [target]],
    simultaneous: false,
  }
}

function buildIntervalItem(level: number, rng: Rng): TheoryQuizItem {
  const numbers = intervalNumbersForLevel(level)
  const candidates = SIMPLE_INTERVALS.filter((iv) => numbers.includes(iv.number))
  const interval = pick(rng, candidates)
  const rootSpec = pick(rng, rootsForLevel(level))
  const { root, target } = safeInterval(spell(rootSpec.letter, rootSpec.alter, HOME_OCTAVE), interval)
  return makeIntervalItem(root, interval, target)
}

// ---------------------------------------------------------------------------
// name-key-signature
// ---------------------------------------------------------------------------

const KEY_SIGNATURE_MODES: readonly Mode[] = ['major', 'minor']

function accidentalWord(fifths: number): string {
  if (fifths === 0) return 'sharps or flats'
  return fifths > 0 ? 'sharps' : 'flats'
}

/** The count the prompt asked for, as the reveal has to say it back: `'2 flats'`. */
function accidentalCount(fifths: number): string {
  if (fifths === 0) return 'no sharps or flats'
  const n = Math.abs(fifths)
  const word = fifths > 0 ? 'sharp' : 'flat'
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Same split as `makeScaleItem` — shared by `buildKeySignatureItem` and `theoryQuizFromId`. */
function makeKeySignatureItem(fifths: number, mode: Mode): TheoryQuizItem {
  const key = keyFromFifths(fifths, mode)
  return {
    id: `name-key-signature-${fifths}-${mode}`,
    kind: 'name-key-signature',
    prompt: `How many ${accidentalWord(fifths)} has ${keyName(key)}? Answer by playing its tonic.`,
    answer: midiGroups([[key.tonic]]),
    spelledAnswer: [[key.tonic]],
    answerSummary: `${accidentalCount(fifths)}, tonic ${pitchDisplayName(key.tonic)}`,
    simultaneous: false,
  }
}

function buildKeySignatureItem(level: number, rng: Rng): TheoryQuizItem {
  const fifths = pick(rng, fifthsPoolForLevel(level))
  const mode = pick(rng, KEY_SIGNATURE_MODES)
  return makeKeySignatureItem(fifths, mode)
}

// ---------------------------------------------------------------------------
// build-cadence
// ---------------------------------------------------------------------------

type CadenceRecipe = { readonly type: CadenceType; readonly numerals: readonly [string, string] }

const PERFECT_AUTHENTIC: CadenceRecipe = { type: 'perfect-authentic', numerals: ['V', 'I'] }
const PLAGAL: CadenceRecipe = { type: 'plagal', numerals: ['IV', 'I'] }
const HALF: CadenceRecipe = { type: 'half', numerals: ['I', 'V'] }
const DECEPTIVE: CadenceRecipe = { type: 'deceptive', numerals: ['V', 'vi'] }

/** Each level admits one more cadence type than the last — a strict superset. */
const CADENCES_BY_LEVEL: readonly (readonly CadenceRecipe[])[] = [
  [PERFECT_AUTHENTIC],
  [PERFECT_AUTHENTIC, PLAGAL],
  [PERFECT_AUTHENTIC, PLAGAL, HALF],
  [PERFECT_AUTHENTIC, PLAGAL, HALF, DECEPTIVE],
]

const CADENCE_LABEL: Readonly<Record<CadenceType, string>> = {
  'perfect-authentic': 'perfect authentic',
  'imperfect-authentic': 'imperfect authentic',
  half: 'half',
  plagal: 'plagal',
  deceptive: 'deceptive',
  none: 'none',
}

function cadencesForLevel(level: number): readonly CadenceRecipe[] {
  const idx = Math.min(level, CADENCES_BY_LEVEL.length) - 1
  return at(CADENCES_BY_LEVEL, idx)
}

/** Every recipe numeral here is diatonic in a major key by construction — a failure is a bug. */
function mustChord(text: string, key: Key): Chord {
  const result = chordForRomanNumeral(text, key)
  invariant(result.ok, `buildTheoryQuiz: '${text}' should be diatonic in ${keyName(key)}`)
  return result.value
}

/** Same split as `makeScaleItem` — shared by `buildCadenceItem` and `theoryQuizFromId`. */
function makeCadenceItem(recipe: CadenceRecipe, key: Key): TheoryQuizItem {
  const [firstText, secondText] = recipe.numerals
  const first = mustChord(firstText, key)
  const second = mustChord(secondText, key)
  const spelled = [first.notes, finalChordPitches(recipe.type, second)]
  return {
    id: `build-cadence-${recipe.type}-${tonicKey(key.tonic)}`,
    kind: 'build-cadence',
    prompt: `Play a ${CADENCE_LABEL[recipe.type]} cadence in ${keyName(key)}.`,
    answer: midiGroups(spelled),
    spelledAnswer: spelled,
    cadence: {
      type: recipe.type,
      chords: [first, second],
      tonicPitchClass: pitchClass(toMidi(key.tonic)),
    },
    simultaneous: true,
  }
}

function buildCadenceItem(level: number, rng: Rng): TheoryQuizItem {
  const recipe = pick(rng, cadencesForLevel(level))
  const fifths = pick(rng, fifthsPoolForLevel(level))
  const key = keyFromFifths(fifths, 'major')
  return makeCadenceItem(recipe, key)
}

/**
 * The final chord's notes, with a perfect authentic cadence's soprano forced
 * to the tonic — `classifyCadence` only calls a resolution "perfect" when the
 * final chord is root position AND its top sounding note is the tonic, so a
 * `'perfect-authentic'` recipe's answer must actually satisfy that, not just
 * a root-position triad whose top note happens to be the fifth.
 *
 * The tonic is ADDED above the triad, not swapped in for its top note. Doing
 * the latter deleted the fifth, so the answer this drill named — and, before
 * `cadenceGroupMatches`, the only one it accepted — was a tonic chord with no
 * fifth: C major revealed "C4 + E4 + C5" (roadmap `T.23`). It also left the
 * leading tone with nowhere to rise to under the obvious voice reading, which
 * is how `T.23` was originally filed; a final chord containing the tonic an
 * octave up settles that under EVERY voice assignment rather than arguing for
 * one.
 *
 * Spelled, not MIDI: the doubled soprano keeps the tonic's own letter and
 * accidental, so a cadence in D♭ reveals D♭5 on top rather than C♯5.
 */
function finalChordPitches(type: CadenceType, chord: Chord): readonly SpelledPitch[] {
  const notes = chord.notes
  if (type !== 'perfect-authentic') return notes
  // A perfect-authentic recipe's final chord is a root-position 'I', so its
  // lowest note is already the tonic — an octave above it is a tonic soprano
  // that stays above every other voice.
  const root = at(notes, 0)
  return [...notes, { ...root, octave: root.octave + 1 }]
}

/**
 * The highest level at which ANY axis still widens — the level selector's
 * honest maximum (roadmap 3.20). Every `*_BY_LEVEL` table plateaus once
 * `level` passes its own length, via `Math.min(level, table.length)` in each
 * `*ForLevel` helper — but `fifthsRangeForLevel` is not table-backed: it
 * widens through `Math.min(MAX_ACCIDENTALS, level - 1)`, so key signatures,
 * scales and cadences (the three kinds that draw a tonic/key from
 * `fifthsPoolForLevel`) keep gaining genuinely new content up to level
 * `MAX_ACCIDENTALS + 1`. Taking the `Math.max` over every table's length AND
 * that bound is what keeps this honest in BOTH directions: a table extended
 * without the others following still raises the ceiling, and the widest
 * non-table axis is no longer silently capped by the narrower ones.
 */
export const MAX_THEORY_LEVEL = Math.max(
  ROOTS_BY_LEVEL.length,
  SCALE_TYPES_BY_LEVEL.length,
  CHORD_QUALITIES_BY_LEVEL.length,
  CHORD_INVERSIONS_BY_LEVEL.length,
  INTERVAL_NUMBERS_BY_LEVEL.length,
  CADENCES_BY_LEVEL.length,
  MAX_ACCIDENTALS + 1,
)

// ---------------------------------------------------------------------------
// buildTheoryQuiz
// ---------------------------------------------------------------------------

export function buildTheoryQuiz(kind: TheoryQuizKind, level: number, rng: Rng): TheoryQuizItem {
  const lvl = Math.max(1, Math.floor(level))
  switch (kind) {
    case 'build-scale':
      return buildScaleItem(lvl, rng)
    case 'build-chord':
      return buildChordItem(lvl, rng)
    case 'build-interval':
      return buildIntervalItem(lvl, rng)
    case 'name-key-signature':
      return buildKeySignatureItem(lvl, rng)
    case 'build-cadence':
      return buildCadenceItem(lvl, rng)
    default:
      return assertNever(kind)
  }
}

// ---------------------------------------------------------------------------
// theoryQuizFromId — the reverse of buildTheoryQuiz's id, roadmap 3.20
// ---------------------------------------------------------------------------

/**
 * Every id above is built purely from the content it names — tonic, scale
 * type, chord quality/inversion, interval number/quality, key-signature
 * fifths/mode, cadence type — never from a counter or from how many `rng`
 * calls it took to get there (see the module doc's "Determinism" section).
 * That means an id can be read back into the *exact* item it names — same
 * prompt, same answer — without touching `rng` at all: each `parse*Id` below
 * re-runs the same `make*Item` construction `build*Item` uses, just fed the
 * parsed parameters instead of an `rng` pick.
 *
 * This is what lets a due SRS card come back as ITSELF (roadmap 3.20):
 * `TheoryDrillPanel` resolves the most-overdue card's id through here instead
 * of drawing a fresh `buildTheoryQuiz` item of the same kind, which is the
 * defect this function exists to close — a scheduled fact's interval was
 * tracked, but the fact itself was never guaranteed to reappear.
 *
 * Returns `undefined` for any string that is not a well-formed id this
 * module ever produced, rather than throwing — a caller resolving ids out of
 * a shared SRS card store should not crash on a stray or corrupted one. As a
 * last-line check, this re-derives the id from what the parser built and
 * rejects a mismatch, so a `parse*Id` that silently drifted from the
 * original encoding (rather than genuinely failing) still cannot hand back
 * the wrong item under the right id — every `parse*Id` below is trusted for
 * CONTENT, never for its own claim that the content matches.
 */
export function theoryQuizFromId(id: string): TheoryQuizItem | undefined {
  const kind = ALL_THEORY_KINDS.find((k) => id.startsWith(`${k}-`))
  if (kind === undefined) return undefined
  try {
    const item = ID_PARSERS[kind](id.slice(kind.length + 1))
    return item !== undefined && item.id === id ? item : undefined
  } catch {
    // A parsed-but-unbuildable combination (e.g. a theoretically-spelled
    // tonic `keyOf`/`buildChord` refuses) is not a well-formed id either.
    return undefined
  }
}

/** The widest tier of each `*_BY_LEVEL` table — every value an id can ever name. */
const WIDEST_SCALE_TYPES = at(SCALE_TYPES_BY_LEVEL, SCALE_TYPES_BY_LEVEL.length - 1)
const WIDEST_CHORD_QUALITIES = at(CHORD_QUALITIES_BY_LEVEL, CHORD_QUALITIES_BY_LEVEL.length - 1)
const WIDEST_CHORD_INVERSIONS = at(CHORD_INVERSIONS_BY_LEVEL, CHORD_INVERSIONS_BY_LEVEL.length - 1)
const WIDEST_CADENCES = at(CADENCES_BY_LEVEL, CADENCES_BY_LEVEL.length - 1)

/** `'C'`, `'F#'`, `'Bb'` — the inverse of `tonicKey`. No mixed sharps/flats, at most a double. */
const TONIC_KEY_PATTERN = /^([A-G])(#+|b+)?$/

function parseTonicKey(text: string): SpelledPitch | undefined {
  const match = TONIC_KEY_PATTERN.exec(text)
  if (match === null) return undefined
  const letter = at(match, 1) as Letter
  const accidentals = match[2] ?? ''
  const alter = accidentals.startsWith('b') ? -accidentals.length : accidentals.length
  if (alter < -2 || alter > 2) return undefined
  return spell(letter, alter as Alter, HOME_OCTAVE)
}

function parseScaleId(rest: string): TheoryQuizItem | undefined {
  const parts = rest.split('-')
  if (parts.length !== 2) return undefined
  const tonic = parseTonicKey(at(parts, 0))
  const type = WIDEST_SCALE_TYPES.find((t) => t === at(parts, 1))
  if (tonic === undefined || type === undefined) return undefined
  return makeScaleItem(tonic, type)
}

function parseChordId(rest: string): TheoryQuizItem | undefined {
  const parts = rest.split('-')
  if (parts.length !== 3) return undefined
  const root = parseTonicKey(at(parts, 0))
  const quality = WIDEST_CHORD_QUALITIES.find((q) => q === at(parts, 1))
  const inversion = WIDEST_CHORD_INVERSIONS.find((i) => i === Number(at(parts, 2)))
  if (root === undefined || quality === undefined || inversion === undefined) return undefined
  return makeChordItem(root, quality, inversion)
}

function parseIntervalId(rest: string): TheoryQuizItem | undefined {
  const parts = rest.split('-')
  if (parts.length !== 3) return undefined
  const root = parseTonicKey(at(parts, 0))
  const number = Number(at(parts, 1))
  if (root === undefined || !Number.isInteger(number)) return undefined
  // `intervals.ts` exports no `IntervalQuality` vocabulary to validate the
  // quality text against first — `makeInterval`'s own Result already rejects
  // anything that is not one of its seven quality strings, so asserting the
  // type and letting IT fail is the single source of truth, not a second,
  // driftable copy of the same seven names.
  const built = makeInterval(number, at(parts, 2) as IntervalQuality)
  if (!built.ok) return undefined
  // The id's tonic is the ACTUAL root `buildIntervalItem` used, already past
  // `safeInterval`'s fallback — transposing it is guaranteed to succeed the
  // same way it did when the id was first minted.
  const target = tryTransposeSpelled(root, built.value, 1)
  if (!target.ok) return undefined
  return makeIntervalItem(root, built.value, target.value)
}

/** `fifths` may be negative, so the remainder can itself contain a leading `-`. */
const KEY_SIGNATURE_ID_PATTERN = /^(-?\d+)-(major|minor)$/

function parseKeySignatureId(rest: string): TheoryQuizItem | undefined {
  const match = KEY_SIGNATURE_ID_PATTERN.exec(rest)
  if (match === null) return undefined
  const fifths = Number(at(match, 1))
  const mode: Mode = at(match, 2) === 'major' ? 'major' : 'minor'
  return makeKeySignatureItem(fifths, mode)
}

/**
 * `recipe.type` itself contains a dash ('perfect-authentic'), so the
 * remainder cannot be split positionally like the other kinds — instead try
 * each of the (few, known) recipes' own type as the id's prefix. Recipe
 * types never share a prefix, so at most one ever matches.
 */
function parseCadenceId(rest: string): TheoryQuizItem | undefined {
  const recipe = WIDEST_CADENCES.find((r) => rest.startsWith(`${r.type}-`))
  if (recipe === undefined) return undefined
  const tonic = parseTonicKey(rest.slice(recipe.type.length + 1))
  if (tonic === undefined) return undefined
  const keyResult = keyOf(tonic, 'major')
  if (!keyResult.ok) return undefined
  const key = keyResult.value
  return makeCadenceItem(recipe, key)
}

/** One parser per kind, keyed for `theoryQuizFromId`'s dispatch — each takes the id minus its kind prefix. */
const ID_PARSERS: Readonly<Record<TheoryQuizKind, (rest: string) => TheoryQuizItem | undefined>> = {
  'build-scale': parseScaleId,
  'build-chord': parseChordId,
  'build-interval': parseIntervalId,
  'name-key-signature': parseKeySignatureId,
  'build-cadence': parseCadenceId,
}

// ---------------------------------------------------------------------------
// gradeTheoryStep
// ---------------------------------------------------------------------------

/** Pitch classes, sorted — the octave-insensitive form one group is compared in. */
function pitchClasses(group: readonly Midi[]): number[] {
  return [...group].map((n) => ((n % 12) + 12) % 12).sort((a, b) => a - b)
}

function groupsMatch(
  kind: TheoryQuizKind,
  expected: readonly Midi[],
  played: readonly Midi[],
): boolean {
  if (expected.length !== played.length) return false
  const e = pitchClasses(expected)
  const p = pitchClasses(played)
  if (!e.every((v, i) => v === p[i])) return false
  // 'build-chord' additionally grades inversion: the pitch-class set alone is
  // invariant under inversion, but the lowest sounding note is not — a first
  // inversion prompt is only answered by playing the third in the bass.
  if (kind === 'build-chord') {
    return Math.min(...played) % 12 === Math.min(...expected) % 12
  }
  return true
}

/**
 * `build-scale`'s extra order/direction check: the played MIDI numbers must be
 * strictly increasing across groups, exactly like the expected answer is.
 * Pitch-class matching alone accepts any octave placement per note, so a
 * scrambled-octave rendition of the right pitch classes would otherwise pass.
 */
function isStrictlyAscending(groups: readonly (readonly Midi[])[]): boolean {
  let prev = -Infinity
  for (const group of groups) {
    const note = at(group, 0) as number
    if (note <= prev) return false
    prev = note
  }
  return true
}

/**
 * `build-interval`'s extra direction/size check: the signed semitone gap from
 * the played root to the played target must equal the expected gap exactly
 * (octave-insensitive only as a whole, via the caller transposing both groups
 * together) — pitch-class matching alone cannot tell a major 6th above from a
 * minor 3rd below, or a unison from an octave.
 */
function intervalMatches(
  expected: readonly (readonly Midi[])[],
  played: readonly (readonly Midi[])[],
): boolean {
  const expectedRoot = at(at(expected, 0), 0) as number
  const expectedTarget = at(at(expected, 1), 0) as number
  const playedRoot = at(at(played, 0), 0) as number
  const playedTarget = at(at(played, 1), 0) as number
  return playedTarget - playedRoot === expectedTarget - expectedRoot
}

/**
 * Fold one played group (one key, or one chord) into an in-progress attempt.
 * Pure: state in, state out. Octave-insensitive by default — a learner
 * playing C major an octave up has built the right chord.
 *
 * `playedSoFar` is every group played in this attempt, in order; this is a
 * pure function of that whole history rather than an incremental reducer, so
 * a caller re-derives the result from its own accumulated state each time
 * rather than trusting one carried forward.
 */
/**
 * The notes that answer an item, named for a learner: `'C4, D4, E4'` for a
 * sequence, `'C4 + E4 + G4'` for a chord, both joined with `', '` when an
 * item is several groups of several notes (a cadence).
 *
 * Octave-bearing on purpose. Grading is octave-insensitive, so this is not the
 * *only* right answer — but "C, E, G" leaves a learner who played the chord
 * two octaves down with nothing to check against, and the register the item
 * was built in is the one its prompt implies.
 */
export function describeTheoryAnswer(item: TheoryQuizItem): string {
  if (item.answerSummary !== undefined) return item.answerSummary
  return item.spelledAnswer
    .map((group) => group.map(pitchDisplayName).join(' + '))
    .join(', ')
}

export function gradeTheoryStep(
  item: TheoryQuizItem,
  playedSoFar: readonly (readonly Midi[])[],
): TheoryAnswerResult {
  const expectedText = describeTheoryAnswer(item)
  let matchedGroups = 0
  for (const played of playedSoFar) {
    const expected = item.answer[matchedGroups]
    if (expected === undefined) {
      return { correct: false, matchedGroups, done: true, expected: expectedText }
    }
    // A cadence is graded on the cadence's own requirements; every other kind
    // still matches the spelled answer note for note.
    const ok =
      item.cadence !== undefined
        ? cadenceGroupMatches(item.cadence, matchedGroups, played)
        : groupsMatch(item.kind, expected, played)
    if (!ok) return { correct: false, matchedGroups, done: true, expected: expectedText }
    matchedGroups++
  }
  const done = matchedGroups === item.answer.length
  if (!done) return { correct: false, matchedGroups, done, expected: expectedText }
  if (item.kind === 'build-scale' && !isStrictlyAscending(playedSoFar)) {
    return { correct: false, matchedGroups, done: true, expected: expectedText }
  }
  if (item.kind === 'build-interval' && !intervalMatches(item.answer, playedSoFar)) {
    return { correct: false, matchedGroups, done: true, expected: expectedText }
  }
  return { correct: true, matchedGroups, done, expected: expectedText }
}
