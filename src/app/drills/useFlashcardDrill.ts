/**
 * Flashcard drill wiring (roadmap 2.12, REQ-3.4.5) for the `'staff-to-key'`
 * kind: a note appears on the staff and the learner answers by pressing the
 * matching key, on the on-screen keyboard (`OnScreenKeyboard.tsx`) or a real
 * MIDI keyboard — both funnel into the same `answerNote(midi)`, exactly like
 * `usePracticeEngine`'s MIDI wiring treats a physical press and a scripted
 * `FakeMidiInput` event identically.
 *
 * No music logic lives here: `buildDeck`/`gradeAnswer` (REQ-3.4.5's grading)
 * and `newCard`/`review`/`dueCards`/`retentionStats` (`core/srs/scheduler.ts`)
 * do the actual work. This hook only reads the caller's SRS state
 * (`useFlashcardStore`), asks `nextCard` what to show, times the answer, and
 * writes the graded card back.
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
 * reload. Before this fix the hook used the `Clock` (`createBrowserClock()`,
 * i.e. `performance.now()`, milliseconds since PAGE LOAD) for scheduling too:
 * self-consistent within one page life, but as soon as a card's `due`
 * survives a reload it is being compared against a `Clock` that has reset
 * near zero, so a saved `due` stops meaning anything relative to the new
 * "now" — see the roadmap report for the failure this caused.
 *
 * Only `'staff-to-key'` is wired up — see the roadmap-2.12 report for why the
 * other three kinds `buildDeck` already supports (`note-name`,
 * `interval-on-staff`, `key-signature`) have no answer UI yet.
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserRng } from '@app/sightreading/rng.ts'

export type UseFlashcardDrillOptions = {
  readonly level: number
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  /** Epoch-ms source for SRS scheduling — see the module comment. */
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly rng?: Rng
}

export type UseFlashcardDrill = {
  readonly card: StaffToKeyCard | undefined
  readonly deckSize: number
  /** The deck's own note range — a sensible span for an on-screen keyboard. */
  readonly range: { readonly low: Midi; readonly high: Midi }
  readonly stats: RetentionStats
  readonly lastGrade: GradeResult | undefined
  readonly midi: MidiConnection
  /** Answers the current card — from the on-screen keyboard or a real MIDI press. */
  readonly answerNote: (note: Midi) => void
}

function isStaffToKey(card: Flashcard): card is StaffToKeyCard {
  return card.kind === 'staff-to-key'
}

/** `nextCard`, narrowed back to `StaffToKeyCard` — `deck` only ever holds that kind. */
function nextStaffToKeyCard(
  deck: readonly StaffToKeyCard[],
  cards: readonly Card[],
  now: number,
  rng: Rng,
): StaffToKeyCard | undefined {
  const picked = nextCard(deck, cards, now, rng)
  return picked !== undefined && isStaffToKey(picked) ? picked : undefined
}

export function useFlashcardDrill(options: UseFlashcardDrillOptions): UseFlashcardDrill {
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

  const deck = useMemo(
    () => buildDeck('staff-to-key', options.level).filter(isStaffToKey),
    [options.level],
  )
  const cards = useMemo(() => Object.values(cardsById), [cardsById])

  const [current, setCurrent] = useState<StaffToKeyCard | undefined>(undefined)
  const [lastGrade, setLastGrade] = useState<GradeResult | undefined>(undefined)
  const promptShownAtRef = useRef(0)

  // A fresh deck (the level changed) always starts from whatever is due, or a
  // fresh card if nothing is — never mid-answer state from the old level.
  useEffect(() => {
    const clockNow = clock.now()
    setCurrent(nextStaffToKeyCard(deck, cards, date.epochMillis(), rng))
    promptShownAtRef.current = clockNow
    setLastGrade(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a deck change (level) should reset the current card
  }, [deck])

  function answerNote(note: Midi): void {
    const card = current
    if (card === undefined) return
    const clockNow = clock.now()
    const dateNow = date.epochMillis()
    const elapsedMs = clockNow - promptShownAtRef.current
    const result = gradeAnswer(card, { midi: note }, elapsedMs)
    const existing = cardsById[card.id] ?? newCard(card.id, dateNow)
    const updated = review(existing, result.grade, dateNow, rng)
    upsertCard(updated)
    setLastGrade(result)

    const updatedCards = cards.some((c) => c.id === updated.id)
      ? cards.map((c) => (c.id === updated.id ? updated : c))
      : [...cards, updated]
    setCurrent(nextStaffToKeyCard(deck, updatedCards, dateNow, rng))
    promptShownAtRef.current = clockNow
  }

  const answerNoteRef = useRef(answerNote)
  answerNoteRef.current = answerNote

  // A real MIDI press answers the card exactly like an on-screen key press.
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
    const notes = deck.map((c) => c.prompt.midi)
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
  }
}
