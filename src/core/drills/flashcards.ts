/**
 * Note-reading and interval flashcards (roadmap 2.8, REQ-3.4.5).
 *
 * Four card kinds, one shared shape: `{ id, kind, prompt, answer }`, where
 * `prompt` and `answer` are plain data — no rendering, no strings meant for
 * display. Any UI (staff renderer, on-screen picker, MIDI listener) reads the
 * fields it needs; nothing here formats text.
 *
 *  - `note-name` — a note appears on the staff; the learner names the letter
 *    and accidental. Answered on screen.
 *  - `staff-to-key` — a note appears on the staff; the learner plays it on
 *    the connected MIDI keyboard. Answered on the instrument.
 *  - `interval-on-staff` — two notes appear on the staff; the learner names
 *    the interval (diatonic number + quality). Answered on screen.
 *  - `key-signature` — a key signature (a fifths count, no more) appears;
 *    the learner names the major key *and* its relative minor. Both are
 *    asked together deliberately: a signature alone never disambiguates
 *    major from minor (2 sharps is equally D major and B minor), so a card
 *    that only asked "which key is this" would have no correct answer. The
 *    pair `{ majorTonic, minorTonic }` is fully determined by the fifths
 *    count, so the card stays well-posed while still testing both facts.
 *
 * `buildDeck` enumerates every card for a level rather than sampling one —
 * decks are meant to be handed whole to the SRS scheduler (`core/srs`),
 * which decides what is due. Level 1 stays inside a 9th around middle C (and
 * up to a third / 1-flat-or-sharp signature); each level widens the note
 * range by a major sixth and, for intervals and key signatures, admits one
 * more diatonic number / one more accidental, until level 6 already reaches
 * the full 88-key range and the writable ±7-fifths range.
 *
 * All deck content is *derived* from `core/theory`, never restated: a
 * `note-name` card's answer is `fromMidi`'s spelling of the prompt note, an
 * `interval-on-staff` card's answer is `intervalBetween`'s reading of the two
 * prompted pitches, and a `key-signature` card's tonics are `keyFromFifths`'s
 * tonics. If the theory module disagrees with a card, that is a bug in this
 * file, not a second source of truth to keep in sync.
 *
 * ## Grading and timing
 *
 * `gradeAnswer` maps correctness plus response time onto the scheduler's
 * four-grade scale:
 *
 *  - wrong, any time            → `'again'`
 *  - correct, ≤ `FAST_THRESHOLD_MS` (3 s)  → `'easy'`
 *  - correct, ≥ `SLOW_THRESHOLD_MS` (8 s)  → `'hard'`
 *  - correct, in between        → `'good'`
 *
 * 3 s and 8 s are chosen to bracket a confident recall: naming a note or
 * interval from memory is normally a 1–2 s reflex once learned, so anything
 * still that fast is "easy"; past 8 s the learner has stopped recalling and
 * started deriving it step by step (counting lines, counting semitones),
 * which is exactly the "still shaky" case `'hard'` schedules a shorter
 * review for.
 *
 * ## Card selection
 *
 * `nextCard` is the bridge to `core/srs`: `cards` is the caller's SRS state
 * (one `Card` per flashcard `id`, for cards already introduced). It returns
 * the earliest-due card that is still in `deck`, and only when nothing is
 * due does it introduce a fresh one — picked with `rng` from the flashcards
 * in `deck` that have no matching `Card` yet, so which new card appears next
 * is reproducible under test but not a fixed enumeration order in the app.
 */
import { assertNever, at, invariant } from '@core/shared/invariant.ts'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, type Midi } from '@core/shared/units.ts'
import { pick, type Rng } from '@core/ports/rng.ts'
import { dueCards, type Card, type Grade } from '@core/srs/scheduler.ts'
import {
  fromMidi,
  tryToMidi,
  type Alter,
  type Letter,
  type SpelledPitch,
} from '@core/theory/pitch.ts'
import {
  SIMPLE_INTERVALS,
  tryTransposeSpelled,
  type IntervalQuality,
} from '@core/theory/intervals.ts'
import { CIRCLE_OF_FIFTHS, keyFromFifths } from '@core/theory/keys.ts'

// ---------------------------------------------------------------------------
// card shapes
// ---------------------------------------------------------------------------

export type FlashcardKind = 'note-name' | 'staff-to-key' | 'interval-on-staff' | 'key-signature'

/** Which staff a prompted note is drawn on. Middle C and above is treble. */
export type Clef = 'treble' | 'bass'

export type LetterAlter = { readonly letter: Letter; readonly alter: Alter }

export type NoteNameAnswer = LetterAlter
export type StaffToKeyAnswer = { readonly midi: Midi }
export type IntervalAnswer = { readonly number: number; readonly quality: IntervalQuality }
export type KeySignatureAnswer = {
  readonly majorTonic: LetterAlter
  readonly minorTonic: LetterAlter
}

export type NoteNameCard = {
  readonly id: string
  readonly kind: 'note-name'
  readonly prompt: { readonly midi: Midi; readonly clef: Clef }
  readonly answer: NoteNameAnswer
}

export type StaffToKeyCard = {
  readonly id: string
  readonly kind: 'staff-to-key'
  readonly prompt: { readonly midi: Midi; readonly clef: Clef }
  readonly answer: StaffToKeyAnswer
}

export type IntervalOnStaffCard = {
  readonly id: string
  readonly kind: 'interval-on-staff'
  readonly prompt: { readonly low: SpelledPitch; readonly high: SpelledPitch; readonly clef: Clef }
  readonly answer: IntervalAnswer
}

export type KeySignatureCard = {
  readonly id: string
  readonly kind: 'key-signature'
  readonly prompt: { readonly fifths: number }
  readonly answer: KeySignatureAnswer
}

export type Flashcard = NoteNameCard | StaffToKeyCard | IntervalOnStaffCard | KeySignatureCard

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

const MIDDLE_C: Midi = midi(60)

/** Half-width of the level-1 note range: a 9th either side of middle C. */
const LEVEL_RADIUS_BASE = 4
/** Each level up widens the note range by a major sixth on both sides. */
const LEVEL_RADIUS_STEP = 9

/** Diatonic numbers each level of `interval-on-staff` admits, widest first is later. */
const INTERVAL_NUMBERS_BY_LEVEL: readonly (readonly number[])[] = [
  [2, 3],
  [2, 3, 4, 5],
  [2, 3, 4, 5, 6],
  [2, 3, 4, 5, 6, 7, 8],
]

/** The writable key-signature range, read off the theory module rather than restated. */
const MAX_ACCIDENTALS = (CIRCLE_OF_FIFTHS.length - 1) / 2

/** Correct and answered within this long → `'easy'` (documented above). */
export const FAST_THRESHOLD_MS = 3_000
/** Correct but this slow or slower → `'hard'`. Between the two thresholds → `'good'`. */
export const SLOW_THRESHOLD_MS = 8_000

// ---------------------------------------------------------------------------
// buildDeck
// ---------------------------------------------------------------------------

export function buildDeck(kind: FlashcardKind, level: number): readonly Flashcard[] {
  const lvl = Math.max(1, Math.floor(level))
  switch (kind) {
    case 'note-name':
      return buildNoteNameDeck(lvl)
    case 'staff-to-key':
      return buildStaffToKeyDeck(lvl)
    case 'interval-on-staff':
      return buildIntervalDeck(lvl)
    case 'key-signature':
      return buildKeySignatureDeck(lvl)
    default:
      return assertNever(kind)
  }
}

/** MIDI range a level draws notes from, centered on middle C, clamped to the 88 keys. */
function noteRangeForLevel(level: number): { readonly min: number; readonly max: number } {
  const radius = LEVEL_RADIUS_BASE + (level - 1) * LEVEL_RADIUS_STEP
  return {
    min: Math.max(PIANO_LOWEST_MIDI, MIDDLE_C - radius),
    max: Math.min(PIANO_HIGHEST_MIDI, MIDDLE_C + radius),
  }
}

function clefForMidi(note: Midi): Clef {
  return note >= MIDDLE_C ? 'treble' : 'bass'
}

function buildNoteNameDeck(level: number): readonly Flashcard[] {
  const { min, max } = noteRangeForLevel(level)
  const cards: NoteNameCard[] = []
  for (let m = min; m <= max; m++) {
    const note = midi(m)
    const spelled = fromMidi(note)
    cards.push({
      id: `note-name-${m}`,
      kind: 'note-name',
      prompt: { midi: note, clef: clefForMidi(note) },
      answer: { letter: spelled.letter, alter: spelled.alter },
    })
  }
  return cards
}

function buildStaffToKeyDeck(level: number): readonly Flashcard[] {
  const { min, max } = noteRangeForLevel(level)
  const cards: StaffToKeyCard[] = []
  for (let m = min; m <= max; m++) {
    const note = midi(m)
    cards.push({
      id: `staff-to-key-${m}`,
      kind: 'staff-to-key',
      prompt: { midi: note, clef: clefForMidi(note) },
      answer: { midi: note },
    })
  }
  return cards
}

function maxIntervalNumbersForLevel(level: number): readonly number[] {
  const idx = Math.min(level, INTERVAL_NUMBERS_BY_LEVEL.length) - 1
  return at(INTERVAL_NUMBERS_BY_LEVEL, idx)
}

/** Roots are always natural (white keys) — the beginner convention for interval drills. */
function buildIntervalDeck(level: number): readonly Flashcard[] {
  const { min, max } = noteRangeForLevel(level)
  const numbers = maxIntervalNumbersForLevel(level)
  const usable = SIMPLE_INTERVALS.filter((iv) => numbers.includes(iv.number))
  const cards: IntervalOnStaffCard[] = []
  for (let m = min; m <= max; m++) {
    const note = midi(m)
    const root = fromMidi(note)
    if (root.alter !== 0) continue
    for (const interval of usable) {
      const transposed = tryTransposeSpelled(root, interval, 1)
      if (!transposed.ok) continue
      const reach = tryToMidi(transposed.value)
      if (!reach.ok) continue
      if (reach.value < PIANO_LOWEST_MIDI || reach.value > PIANO_HIGHEST_MIDI) continue
      cards.push({
        id: `interval-on-staff-${m}-${interval.number}-${interval.quality}`,
        kind: 'interval-on-staff',
        prompt: { low: root, high: transposed.value, clef: clefForMidi(note) },
        answer: { number: interval.number, quality: interval.quality },
      })
    }
  }
  return cards
}

function buildKeySignatureDeck(level: number): readonly Flashcard[] {
  const maxFifths = Math.min(MAX_ACCIDENTALS, level)
  const cards: KeySignatureCard[] = []
  for (let fifths = -maxFifths; fifths <= maxFifths; fifths++) {
    const major = keyFromFifths(fifths, 'major')
    const minor = keyFromFifths(fifths, 'minor')
    cards.push({
      id: `key-signature-${fifths}`,
      kind: 'key-signature',
      prompt: { fifths },
      answer: {
        majorTonic: { letter: major.tonic.letter, alter: major.tonic.alter },
        minorTonic: { letter: minor.tonic.letter, alter: minor.tonic.alter },
      },
    })
  }
  return cards
}

// ---------------------------------------------------------------------------
// gradeAnswer
// ---------------------------------------------------------------------------

export type GradeResult = { readonly correct: boolean; readonly grade: Grade }

type AnyAnswer = NoteNameAnswer | StaffToKeyAnswer | IntervalAnswer | KeySignatureAnswer

export function gradeAnswer(
  card: NoteNameCard,
  answer: NoteNameAnswer,
  elapsedMs: number,
): GradeResult
export function gradeAnswer(
  card: StaffToKeyCard,
  answer: StaffToKeyAnswer,
  elapsedMs: number,
): GradeResult
export function gradeAnswer(
  card: IntervalOnStaffCard,
  answer: IntervalAnswer,
  elapsedMs: number,
): GradeResult
export function gradeAnswer(
  card: KeySignatureCard,
  answer: KeySignatureAnswer,
  elapsedMs: number,
): GradeResult
export function gradeAnswer(card: Flashcard, answer: AnyAnswer, elapsedMs: number): GradeResult {
  const correct = isCorrect(card, answer)
  return { correct, grade: gradeFromTiming(correct, elapsedMs) }
}

function sameLetterAlter(a: LetterAlter, b: LetterAlter): boolean {
  return a.letter === b.letter && a.alter === b.alter
}

function isCorrect(card: Flashcard, answer: AnyAnswer): boolean {
  switch (card.kind) {
    case 'note-name':
      return 'letter' in answer && sameLetterAlter(answer, card.answer)
    case 'staff-to-key':
      return 'midi' in answer && answer.midi === card.answer.midi
    case 'interval-on-staff':
      return (
        'number' in answer &&
        answer.number === card.answer.number &&
        answer.quality === card.answer.quality
      )
    case 'key-signature':
      return (
        'majorTonic' in answer &&
        sameLetterAlter(answer.majorTonic, card.answer.majorTonic) &&
        sameLetterAlter(answer.minorTonic, card.answer.minorTonic)
      )
    default:
      return assertNever(card)
  }
}

function gradeFromTiming(correct: boolean, elapsedMs: number): Grade {
  if (!correct) return 'again'
  if (elapsedMs <= FAST_THRESHOLD_MS) return 'easy'
  if (elapsedMs >= SLOW_THRESHOLD_MS) return 'hard'
  return 'good'
}

// ---------------------------------------------------------------------------
// nextCard
// ---------------------------------------------------------------------------

export function nextCard(
  deck: readonly Flashcard[],
  cards: readonly Card[],
  now: number,
  rng: Rng,
): Flashcard | undefined {
  const byId = new Map(deck.map((c) => [c.id, c] as const))

  const dueInDeck = dueCards(cards, now).find((c) => byId.has(c.id))
  if (dueInDeck) {
    const card = byId.get(dueInDeck.id)
    invariant(card !== undefined, `nextCard: due card ${dueInDeck.id} missing from its own deck`)
    return card
  }

  const knownIds = new Set(cards.map((c) => c.id))
  const fresh = deck.filter((c) => !knownIds.has(c.id))
  return fresh.length === 0 ? undefined : pick(rng, fresh)
}
