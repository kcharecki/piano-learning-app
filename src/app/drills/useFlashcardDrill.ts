/**
 * Flashcard drill wiring (roadmap 2.12/2.25, REQ-3.4.5) for the two kinds that
 * have an answer UI: `'staff-to-key'` (a note appears on the staff; the
 * learner plays it, on the on-screen keyboard or a real MIDI keyboard, both
 * funnelling into `answerNote(midi)`) and `'interval-on-staff'` (two notes
 * appear on one staff; the learner names the interval via
 * `answerInterval({ number, quality })`, `IntervalAnswerPad.tsx`'s job).
 *
 * No music logic lives here: `buildDeck`/`gradeAnswer` (REQ-3.4.5's grading)
 * and `newCard`/`review`/`dueCards`/`retentionStats` (`core/srs/scheduler.ts`)
 * do the actual work. This hook only reads the caller's SRS state
 * (`useFlashcardStore`), asks `nextCard` what to show, times the answer, and
 * writes the graded card back.
 *
 * `kind` picks which deck `buildDeck` builds and which of the two answer
 * functions is live for the current card; the other is simply a no-op while
 * a card of the other kind is showing (never a crash — an on-screen keyboard
 * press cannot arrive for an interval card and vice versa, but a stray event
 * during the render that swaps `current` is possible and must stay inert).
 * SRS state (`cardsById`) is one flat map keyed by flashcard id, and ids are
 * already namespaced by kind (`staff-to-key-64` vs
 * `interval-on-staff-60-3-major`), so switching `kind` only changes which
 * deck's cards `nextCard` considers — it never touches, resets, or filters
 * the stored SRS state itself.
 *
 * ## Two different clocks (roadmap M2 defect fix — REQ-3.9.4)
 *
 * `scheduler.ts`'s `due`/`introducedAt` are epoch milliseconds — a `Card` is
 * meaningless unless "now" means the same instant across page loads, because
 * `useFlashcardStore` (and, once persisted, IndexedDB — `persistence.ts`)
 * keeps cards for as long as the learner keeps using the app. So every call
 * into the scheduler (`newCard`, `review`, and the `now` this hook hands
 * `nextCard`/`retentionStats`) uses the injected `DateSource`, exactly the
 * house pattern `PracticeScreen.tsx` already defaults its own `date` prop
 * with. `Clock` is kept ONLY for `elapsedMs` — how long the learner took to
 * answer, which `gradeAnswer` needs and which is legitimately about elapsed
 * time within this one page life, never persisted, never compared across a
 * reload.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import {
  useMidiConnection,
  type ConnectMidi,
  type MidiConnection,
} from '@app/practice/useMidiConnection.ts'
import { createBrowserClock } from '@app/practice/clock.ts'
import {
  buildDeck,
  gradeAnswer,
  nextCard,
  type Flashcard,
  type GradeResult,
  type IntervalAnswer,
  type IntervalOnStaffCard,
  type StaffToKeyCard,
} from '@core/drills/flashcards.ts'
import {
  newCard,
  retentionStats,
  review,
  type Card,
  type RetentionStats,
} from '@core/srs/scheduler.ts'
import type { Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { midi as asMidi, type Midi } from '@core/shared/units.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createBrowserRng } from '@app/sightreading/rng.ts'

/** The two flashcard kinds this hook can drive — the ones with answer UI. */
export type DrillKind = 'staff-to-key' | 'interval-on-staff'

/** The card shown to the learner: whichever of the two kinds `kind` selects. */
export type DrillCard = StaffToKeyCard | IntervalOnStaffCard

export type UseFlashcardDrillOptions = {
  readonly level: number
  /** Which deck to draw from. Defaults to `'staff-to-key'`. */
  readonly kind?: DrillKind
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  /** Epoch-ms source for SRS scheduling — see the module comment. */
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly rng?: Rng
}

export type UseFlashcardDrill = {
  readonly card: DrillCard | undefined
  readonly deckSize: number
  /** The deck's own note range — a sensible span for an on-screen keyboard.
   *  Only meaningful for `'staff-to-key'`; `{ 60, 60 }` while on an interval deck. */
  readonly range: { readonly low: Midi; readonly high: Midi }
  readonly stats: RetentionStats
  readonly lastGrade: GradeResult | undefined
  readonly midi: MidiConnection
  /** Answers a `'staff-to-key'` card — from the on-screen keyboard or a real MIDI press.
   *  A no-op while the current card is any other kind. */
  readonly answerNote: (note: Midi) => void
  /** Answers an `'interval-on-staff'` card. A no-op while the current card is any other kind. */
  readonly answerInterval: (answer: IntervalAnswer) => void
}

function isStaffToKey(card: Flashcard): card is StaffToKeyCard {
  return card.kind === 'staff-to-key'
}

function isIntervalOnStaff(card: Flashcard): card is IntervalOnStaffCard {
  return card.kind === 'interval-on-staff'
}

function buildDrillDeck(kind: DrillKind, level: number): readonly DrillCard[] {
  const deck = buildDeck(kind, level)
  return kind === 'staff-to-key' ? deck.filter(isStaffToKey) : deck.filter(isIntervalOnStaff)
}

/**
 * `nextCard`, narrowed back to `DrillCard`. Safe: `nextCard` only ever
 * returns an element it read out of `deck` itself (either the due card it
 * looked up by id in `deck`, or one it picked from a `deck.filter(...)`), so
 * whatever it returns is already a `DrillCard` — this is a type-level
 * narrowing of that fact, not a runtime assumption.
 */
function nextDrillCard(
  deck: readonly DrillCard[],
  cards: readonly Card[],
  now: number,
  rng: Rng,
): DrillCard | undefined {
  return nextCard(deck, cards, now, rng) as DrillCard | undefined
}

export function useFlashcardDrill(options: UseFlashcardDrillOptions): UseFlashcardDrill {
  const kind = options.kind ?? 'staff-to-key'
  const cardsById = useFlashcardStore((s) => s.cardsById)
  const upsertCard = useFlashcardStore((s) => s.upsertCard)

  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
  const [date] = useState<DateSource>(() => options.date ?? { epochMillis: () => Date.now() })
  const [rng] = useState<Rng>(() => options.rng ?? createBrowserRng())
  const midi = useMidiConnection(
    options.midiInput !== undefined
      ? { midiInput: options.midiInput }
      : options.connectMidi !== undefined
        ? { connect: options.connectMidi }
        : {},
  )

  const deck = useMemo(() => buildDrillDeck(kind, options.level), [kind, options.level])
  const cards = useMemo(() => Object.values(cardsById), [cardsById])

  const [current, setCurrent] = useState<DrillCard | undefined>(undefined)
  const [lastGrade, setLastGrade] = useState<GradeResult | undefined>(undefined)
  const promptShownAtRef = useRef(0)

  // A fresh deck (the level or kind changed) always starts from whatever is
  // due, or a fresh card if nothing is — never mid-answer state from before.
  // SRS state itself (`cards`) is untouched: only which deck `nextDrillCard`
  // looks the due/fresh card up in changes.
  useLayoutEffect(() => {
    const clockNow = clock.now()
    setCurrent(nextDrillCard(deck, cards, date.epochMillis(), rng))
    promptShownAtRef.current = clockNow
    setLastGrade(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a deck change (level/kind) should reset the current card
  }, [deck])

  function commitAnswer(card: DrillCard, result: GradeResult, dateNow: number): void {
    const existing = cardsById[card.id] ?? newCard(card.id, dateNow)
    const updated = review(existing, result.grade, dateNow, rng)
    upsertCard(updated)
    setLastGrade(result)

    const updatedCards = cards.some((c) => c.id === updated.id)
      ? cards.map((c) => (c.id === updated.id ? updated : c))
      : [...cards, updated]
    setCurrent(nextDrillCard(deck, updatedCards, dateNow, rng))
  }

  function answerNote(note: Midi): void {
    const card = current
    if (card === undefined || card.kind !== 'staff-to-key') return
    const clockNow = clock.now()
    const dateNow = date.epochMillis()
    const elapsedMs = clockNow - promptShownAtRef.current
    const result = gradeAnswer(card, { midi: note }, elapsedMs)
    commitAnswer(card, result, dateNow)
    promptShownAtRef.current = clockNow
  }

  function answerInterval(answer: IntervalAnswer): void {
    const card = current
    if (card === undefined || card.kind !== 'interval-on-staff') return
    const clockNow = clock.now()
    const dateNow = date.epochMillis()
    const elapsedMs = clockNow - promptShownAtRef.current
    const result = gradeAnswer(card, answer, elapsedMs)
    commitAnswer(card, result, dateNow)
    promptShownAtRef.current = clockNow
  }

  const answerNoteRef = useRef(answerNote)
  answerNoteRef.current = answerNote

  // A real MIDI press answers the card exactly like an on-screen key press —
  // and is a no-op via `answerNote` itself while an interval card is showing.
  useEffect(() => {
    if (midi.input === undefined) return undefined
    return midi.input.onEvent((event) => {
      if (event.type === 'noteOn') answerNoteRef.current(event.note)
    })
  }, [midi.input])

  const stats = useMemo(() => {
    const deckIds = new Set(deck.map((c) => c.id))
    const deckCards = cards.filter((c) => deckIds.has(c.id))
    return retentionStats(deckCards, date.epochMillis())
  }, [deck, cards, date])

  const range = useMemo(() => {
    const notes = deck.filter(isStaffToKey).map((c) => c.prompt.midi)
    if (notes.length === 0) return { low: asMidi(60), high: asMidi(60) }
    return { low: asMidi(Math.min(...notes)), high: asMidi(Math.max(...notes)) }
  }, [deck])

  return {
    card: current,
    deckSize: deck.length,
    range,
    stats,
    lastGrade,
    midi,
    answerNote,
    answerInterval,
  }
}
