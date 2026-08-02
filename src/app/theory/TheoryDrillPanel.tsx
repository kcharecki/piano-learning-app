/**
 * Theory drill panel (roadmap 3.3, REQ-3.5.2) — the reachable consumer of
 * `core/drills/theory.ts`. Renders the prompt, takes an answer from the
 * on-screen keyboard or a connected MIDI keyboard, grades it group by group
 * with `gradeTheoryStep`, and schedules the item's SRS card with the same
 * `core/srs/scheduler.ts` functions and the same `cardsById` store the
 * flashcard drill uses (`useFlashcardStore` — ids are namespaced per kind,
 * `build-scale-...` vs `note-name-...`, so the two drills share the map
 * without collision, exactly like the four flashcard kinds already do).
 *
 * ## Grouping raw key presses into answer groups
 *
 * Every kind's answer is `readonly (readonly Midi[])[]` — a chord ('build-
 * chord', 'build-cadence') or a single note ('build-scale', 'build-interval',
 * 'name-key-signature') either way. The panel does not need to know which:
 * it buffers presses into `pendingNotes` and flushes them into one completed
 * group as soon as it has as many notes as the *next expected* group needs
 * (`item.answer[playedGroups.length].length`) — one press completes a
 * single-note group immediately, three completes a triad. `gradeTheoryStep`
 * itself is octave- and press-order-within-a-group insensitive, so this
 * never has to police simultaneity.
 *
 * ## Timing
 *
 * Unlike the flashcard drill, a theory answer's grade is not time-pressured
 * (`TheoryAnswerResult` carries no elapsed time): correct maps to `'good'`,
 * incorrect to `'again'`. `date` (a `DateSource`) is still the epoch source
 * `review`/`newCard` schedule against — never a `Clock`, per roadmap 2.19 —
 * which is why this panel takes no `clock` prop at all; there is no elapsed
 * time here for one to measure.
 *
 * ## Serving items
 *
 * `buildTheoryQuiz`'s content is procedurally generated rather than drawn
 * from an enumerable deck, so unlike `nextCard` there is no way to look back
 * up "the due item for id X" from the id alone — a fresh item is generated
 * after every answer, and its SRS card is created or updated by whatever id
 * it lands on. Review history and retention stats are still genuinely
 * tracked; strict due-first serving would need either a finite per-level
 * deck or persisting full item content per id, neither of which this
 * generator has today.
 */
import { useMidiConnection, type ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import { OnScreenKeyboard } from '@app/drills/OnScreenKeyboard.tsx'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { createBrowserRng } from '@app/sightreading/rng.ts'
import {
  buildTheoryQuiz,
  gradeTheoryStep,
  type TheoryAnswerResult,
  type TheoryQuizItem,
  type TheoryQuizKind,
} from '@core/drills/theory.ts'
import { dueCards, newCard, retentionStats, review, type Card, type Grade } from '@core/srs/scheduler.ts'
import type { DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import {
  midi,
  PIANO_HIGHEST_MIDI,
  PIANO_LOWEST_MIDI,
  type Midi,
} from '@core/shared/units.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type TheoryDrillPanelProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly rng?: Rng
}

const MIN_LEVEL = 1
const MAX_LEVEL = 8

const KIND_LABEL: Readonly<Record<TheoryQuizKind, string>> = {
  'build-scale': 'Scale',
  'build-chord': 'Chord',
  'build-interval': 'Interval',
  'name-key-signature': 'Key signature',
  'build-cadence': 'Cadence',
}

const KINDS: readonly TheoryQuizKind[] = [
  'build-scale',
  'build-chord',
  'build-interval',
  'name-key-signature',
  'build-cadence',
]

/** So the panel's own retention stats don't pick up flashcard drill cards
 *  sharing the same store — every theory id starts with one of these. */
const THEORY_ID_PREFIXES: readonly string[] = KINDS.map((k) => `${k}-`)

function isTheoryCardId(id: string): boolean {
  return THEORY_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}

/** The kind whose id prefix a card id starts with — every theory card id is namespaced this way. */
function kindOfCardId(id: string): TheoryQuizKind | undefined {
  return KINDS.find((k) => id.startsWith(`${k}-`))
}

/**
 * Bias the next item toward the most-overdue theory card's topic, so SRS
 * scheduling actually affects what the learner is shown next — without this
 * `dueCards` is computed for the stats display and then discarded. Falls back
 * to the currently-selected topic when nothing is due yet.
 */
function nextKind(
  cardsById: Readonly<Record<string, Card>>,
  nowMs: number,
  currentKind: TheoryQuizKind,
): TheoryQuizKind {
  const theoryCards = Object.values(cardsById).filter((c) => isTheoryCardId(c.id))
  const [mostOverdue] = dueCards(theoryCards, nowMs, 1)
  if (mostOverdue === undefined) return currentKind
  return kindOfCardId(mostOverdue.id) ?? currentKind
}

/**
 * A fixed on-screen keyboard range, independent of the current item: sizing
 * it to the answer's own span (as this used to) both makes the octave-
 * insensitive grading this module is built around unreachable from the
 * on-screen keyboard (no octave-transposed key would even be visible) and
 * leaks the answer — a `name-key-signature` item would render a keyboard
 * centred on the tonic, narrowing it to a handful of candidates.
 */
const KEYBOARD_LOW = midi(48)
const KEYBOARD_HIGH = midi(84)

function rangeFor(): { readonly low: Midi; readonly high: Midi } {
  return {
    low: midi(Math.max(PIANO_LOWEST_MIDI, KEYBOARD_LOW)),
    high: midi(Math.min(PIANO_HIGHEST_MIDI, KEYBOARD_HIGH)),
  }
}

function AnswerFeedback({ result }: { readonly result: TheoryAnswerResult | undefined }) {
  if (result === undefined) return null
  const grade: Grade = result.correct ? 'good' : 'again'
  return (
    <p role="status" data-testid="theory-feedback">
      {result.correct ? 'Correct' : 'Not quite'} — graded {grade}
    </p>
  )
}

export function TheoryDrillPanel(props: TheoryDrillPanelProps) {
  const [level, setLevel] = useState(MIN_LEVEL)
  const [kind, setKind] = useState<TheoryQuizKind>('build-scale')

  const [date] = useState<DateSource>(() => props.date ?? { epochMillis: () => Date.now() })
  const [rng] = useState<Rng>(() => props.rng ?? createBrowserRng())
  const midiConn = useMidiConnection(
    props.midiInput !== undefined
      ? { midiInput: props.midiInput }
      : props.connectMidi !== undefined
        ? { connect: props.connectMidi }
        : {},
  )

  const cardsById = useFlashcardStore((s) => s.cardsById)
  const upsertCard = useFlashcardStore((s) => s.upsertCard)

  const [item, setItem] = useState<TheoryQuizItem | undefined>(undefined)
  const [playedGroups, setPlayedGroups] = useState<readonly (readonly Midi[])[]>([])
  const [, setPendingNotes] = useState<readonly Midi[]>([])
  const [lastResult, setLastResult] = useState<TheoryAnswerResult | undefined>(undefined)
  const [nowMs, setNowMs] = useState<number>(() => date.epochMillis())

  // Accumulates presses within the current attempt; mirrored into
  // `playedGroups`/`pendingNotes` state for rendering. Reading and writing
  // this ref (rather than deriving the next value from stale render-closure
  // state) makes two `noteOn` events delivered in the same batched task
  // accumulate correctly instead of the second overwriting the first.
  const pendingRef = useRef<readonly Midi[]>([])
  const playedRef = useRef<readonly (readonly Midi[])[]>([])

  // A level or kind change always starts a fresh item and a fresh attempt —
  // never mid-answer state from before.
  useLayoutEffect(() => {
    setItem(buildTheoryQuiz(kind, level, rng))
    playedRef.current = []
    pendingRef.current = []
    setPlayedGroups([])
    setPendingNotes([])
    setLastResult(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only kind/level should reset the item
  }, [kind, level])

  function commitAnswer(answered: TheoryQuizItem, correct: boolean): void {
    const grade: Grade = correct ? 'good' : 'again'
    const dateNow = date.epochMillis()
    const existing = cardsById[answered.id] ?? newCard(answered.id, dateNow)
    const updated = review(existing, grade, dateNow, rng)
    upsertCard(updated)
    setNowMs(dateNow)
    const updatedCardsById = { ...cardsById, [updated.id]: updated }
    const dueKind = nextKind(updatedCardsById, dateNow, kind)
    if (dueKind !== kind) {
      // The kind/level effect rebuilds the item for the new kind; do not
      // race it with our own rebuild below.
      setKind(dueKind)
    } else {
      setItem(buildTheoryQuiz(kind, level, rng))
    }
    playedRef.current = []
    pendingRef.current = []
    setPlayedGroups([])
    setPendingNotes([])
  }

  function handleNote(note: Midi): void {
    if (item === undefined) return
    if (playedRef.current.length === 0) setLastResult(undefined)
    const expected = item.answer[playedRef.current.length]
    if (expected === undefined) return

    const pending = [...pendingRef.current, note]
    if (pending.length < expected.length) {
      pendingRef.current = pending
      setPendingNotes(pending)
      return
    }

    const played = [...playedRef.current, pending]
    pendingRef.current = []
    playedRef.current = played
    setPendingNotes([])
    setPlayedGroups(played)
    const result = gradeTheoryStep(item, played)
    setLastResult(result)
    if (result.done) commitAnswer(item, result.correct)
  }

  const handleNoteRef = useRef(handleNote)
  handleNoteRef.current = handleNote

  // A real MIDI press answers the prompt exactly like an on-screen key press.
  useEffect(() => {
    if (midiConn.input === undefined) return undefined
    return midiConn.input.onEvent((event) => {
      if (event.type === 'noteOn') handleNoteRef.current(event.note)
    })
  }, [midiConn.input])

  const stats = useMemo(() => {
    const theoryCards = Object.values(cardsById).filter((c) => isTheoryCardId(c.id))
    return retentionStats(theoryCards, nowMs)
  }, [cardsById, nowMs])

  const range = useMemo(() => rangeFor(), [])

  return (
    <div className="theory-drill-panel">
      <h2>Theory drills</h2>
      <MidiDeviceStatus
        connected={midiConn.input !== undefined}
        devices={midiConn.devices}
        selectedDeviceId={midiConn.selectedDeviceId}
        connectionError={midiConn.connectionError}
      />

      <div className="theory-level" role="group" aria-label="Level">
        <button
          type="button"
          aria-label="Decrease level"
          disabled={level <= MIN_LEVEL}
          onClick={() => setLevel((l) => Math.max(MIN_LEVEL, l - 1))}
        >
          −
        </button>
        <span data-testid="theory-level">Level {level}</span>
        <button
          type="button"
          aria-label="Increase level"
          disabled={level >= MAX_LEVEL}
          onClick={() => setLevel((l) => Math.min(MAX_LEVEL, l + 1))}
        >
          +
        </button>
      </div>

      <div className="theory-kind">
        <label htmlFor="theory-kind-select">Topic</label>
        <select
          id="theory-kind-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as TheoryQuizKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {item === undefined ? (
        <p role="status">Loading…</p>
      ) : (
        <section aria-label="Theory quiz">
          <p data-testid="theory-prompt">{item.prompt}</p>
          <p data-testid="theory-progress">
            {playedGroups.length} / {item.answer.length} played
          </p>
          <OnScreenKeyboard low={range.low} high={range.high} onPress={handleNote} />
          <AnswerFeedback result={lastResult} />
        </section>
      )}

      <dl className="theory-stats" aria-label="Retention">
        <dt>Cards</dt>
        <dd data-testid="theory-stats-total">{stats.total}</dd>
        <dt>Due</dt>
        <dd data-testid="theory-stats-due">{stats.due}</dd>
        <dt>Young</dt>
        <dd data-testid="theory-stats-young">{stats.young}</dd>
        <dt>Mature</dt>
        <dd data-testid="theory-stats-mature">{stats.mature}</dd>
        <dt>Average ease</dt>
        <dd data-testid="theory-stats-ease">{stats.averageEase.toFixed(2)}</dd>
      </dl>
    </div>
  )
}
