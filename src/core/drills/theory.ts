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
import { midi, type Midi } from '@core/shared/units.ts'
import { pick, type Rng } from '@core/ports/rng.ts'
import { spell, toMidi, type Alter, type Letter, type SpelledPitch } from '@core/theory/pitch.ts'
import {
  buildScale,
  scaleName,
  scaleNotes,
  type ScaleType,
} from '@core/theory/scales.ts'
import {
  buildChord,
  chordMidi,
  isTriad,
  type Chord,
  type ChordQuality,
  type Inversion,
} from '@core/theory/chords.ts'
import {
  intervalLongName,
  SIMPLE_INTERVALS,
  transposeSpelled,
  tryTransposeSpelled,
  type Interval,
} from '@core/theory/intervals.ts'
import { CIRCLE_OF_FIFTHS, keyFromFifths, keyName, type Key, type Mode } from '@core/theory/keys.ts'
import { chordForRomanNumeral, type CadenceType } from '@core/theory/harmony.ts'

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

export type TheoryQuizItem = {
  /** Stable and derived from the content, so SRS scheduling survives a reload. */
  readonly id: string
  readonly kind: TheoryQuizKind
  readonly level: number
  /** The question, already written for a human. */
  readonly prompt: string
  /**
   * The MIDI notes that answer it, in the order they must be played. A chord
   * or a cadence step is a set played together — see `simultaneous`.
   */
  readonly answer: readonly (readonly Midi[])[]
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
}

// ---------------------------------------------------------------------------
// shared tuning
// ---------------------------------------------------------------------------

/** Register every generated note/root/chord/scale sits in, absent a reason to move it. */
const HOME_OCTAVE = 4

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

function buildScaleItem(level: number, rng: Rng): TheoryQuizItem {
  const type = pick(rng, scaleTypesForLevel(level))
  const fifths = pick(rng, fifthsPoolForLevel(level))
  const tonic = tonicForScaleType(fifths, type)
  const scale = buildScale(tonic, type)
  const notes = scaleNotes(tonic, type, 1)
  return {
    id: `build-scale-${tonicKey(tonic)}-${type}`,
    kind: 'build-scale',
    level,
    prompt: `Play ${scaleName(scale)}, ascending.`,
    answer: notes.map((p) => [toMidi(p)]),
    simultaneous: false,
  }
}

// ---------------------------------------------------------------------------
// build-chord
// ---------------------------------------------------------------------------

/** Each level admits more qualities than the last — a strict superset. */
const CHORD_QUALITIES_BY_LEVEL: readonly (readonly ChordQuality[])[] = [
  ['major', 'minor'],
  ['major', 'minor', 'diminished', 'augmented'],
  ['major', 'minor', 'diminished', 'augmented', 'dominant7', 'major7', 'minor7'],
  [
    'major',
    'minor',
    'diminished',
    'augmented',
    'dominant7',
    'major7',
    'minor7',
    'halfDiminished7',
    'diminished7',
    'minorMajor7',
    'augmentedMajor7',
  ],
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

function buildChordItem(level: number, rng: Rng): TheoryQuizItem {
  const quality = pick(rng, chordQualitiesForLevel(level))
  const highestInversion = isTriad(quality) ? 2 : 3
  const inversions = chordInversionsForLevel(level).filter((i) => i <= highestInversion)
  const inversion = pick(rng, inversions)
  const rootSpec = pick(rng, rootsForLevel(level))
  const root = spell(rootSpec.letter, rootSpec.alter, HOME_OCTAVE)
  const chord = buildChord(root, quality, inversion)
  return {
    id: `build-chord-${tonicKey(root)}-${quality}-${inversion}`,
    kind: 'build-chord',
    level,
    prompt:
      `Play a ${tonicKey(root)} ${CHORD_QUALITY_PHRASE[quality]} chord, ` +
      `${CHORD_INVERSION_PHRASE[inversion]}.`,
    answer: [chordMidi(chord)],
    simultaneous: true,
  }
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

function buildIntervalItem(level: number, rng: Rng): TheoryQuizItem {
  const numbers = intervalNumbersForLevel(level)
  const candidates = SIMPLE_INTERVALS.filter((iv) => numbers.includes(iv.number))
  const interval = pick(rng, candidates)
  const rootSpec = pick(rng, rootsForLevel(level))
  const { root, target } = safeInterval(spell(rootSpec.letter, rootSpec.alter, HOME_OCTAVE), interval)
  return {
    id: `build-interval-${tonicKey(root)}-${interval.number}-${interval.quality}`,
    kind: 'build-interval',
    level,
    prompt: `Play ${tonicKey(root)}, then a ${intervalLongName(interval)} above it.`,
    answer: [[toMidi(root)], [toMidi(target)]],
    simultaneous: false,
  }
}

// ---------------------------------------------------------------------------
// name-key-signature
// ---------------------------------------------------------------------------

const KEY_SIGNATURE_MODES: readonly Mode[] = ['major', 'minor']

function accidentalWord(fifths: number): string {
  if (fifths === 0) return 'sharps or flats'
  return fifths > 0 ? 'sharps' : 'flats'
}

function buildKeySignatureItem(level: number, rng: Rng): TheoryQuizItem {
  const fifths = pick(rng, fifthsPoolForLevel(level))
  const mode = pick(rng, KEY_SIGNATURE_MODES)
  const key = keyFromFifths(fifths, mode)
  return {
    id: `name-key-signature-${fifths}-${mode}`,
    kind: 'name-key-signature',
    level,
    prompt: `How many ${accidentalWord(fifths)} has ${keyName(key)}? Answer by playing its tonic.`,
    answer: [[toMidi(key.tonic)]],
    simultaneous: false,
  }
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

function buildCadenceItem(level: number, rng: Rng): TheoryQuizItem {
  const recipe = pick(rng, cadencesForLevel(level))
  const fifths = pick(rng, fifthsPoolForLevel(level))
  const key = keyFromFifths(fifths, 'major')
  const [firstText, secondText] = recipe.numerals
  const first = mustChord(firstText, key)
  const second = mustChord(secondText, key)
  const secondMidi = finalChordMidi(recipe.type, second)
  return {
    id: `build-cadence-${recipe.type}-${tonicKey(key.tonic)}`,
    kind: 'build-cadence',
    level,
    prompt: `Play a ${CADENCE_LABEL[recipe.type]} cadence in ${keyName(key)}.`,
    answer: [chordMidi(first), secondMidi],
    simultaneous: true,
  }
}

/**
 * The final chord's notes, with a perfect authentic cadence's soprano forced
 * to the tonic — `classifyCadence` only calls a resolution "perfect" when the
 * final chord is root position AND its top sounding note is the tonic, so a
 * `'perfect-authentic'` recipe's answer must actually satisfy that, not just
 * a root-position triad whose top note happens to be the fifth.
 */
function finalChordMidi(type: CadenceType, chord: Chord): readonly Midi[] {
  const notes = chordMidi(chord)
  if (type !== 'perfect-authentic') return notes
  // A perfect-authentic recipe's final chord is a root-position 'I', so its
  // lowest note is already the tonic — an octave above it is a tonic soprano
  // that stays above every other voice.
  const root = at(notes, 0)
  return [...notes.slice(0, -1), midi(root + 12)]
}

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
export function gradeTheoryStep(
  item: TheoryQuizItem,
  playedSoFar: readonly (readonly Midi[])[],
): TheoryAnswerResult {
  let matchedGroups = 0
  for (const played of playedSoFar) {
    const expected = item.answer[matchedGroups]
    if (expected === undefined || !groupsMatch(item.kind, expected, played)) {
      return { correct: false, matchedGroups, done: true }
    }
    matchedGroups++
  }
  const done = matchedGroups === item.answer.length
  if (!done) return { correct: false, matchedGroups, done }
  if (item.kind === 'build-scale' && !isStrictlyAscending(playedSoFar)) {
    return { correct: false, matchedGroups, done: true }
  }
  if (item.kind === 'build-interval' && !intervalMatches(item.answer, playedSoFar)) {
    return { correct: false, matchedGroups, done: true }
  }
  return { correct: true, matchedGroups, done }
}
