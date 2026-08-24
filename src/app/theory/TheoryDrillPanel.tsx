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
 * ## The reveal (improve-app run 2026-08-24-1)
 *
 * A wrong answer names the notes it wanted (`TheoryAnswerResult.expected`,
 * `core/drills/theory.ts`) and HOLDS the prompt while it does — the SRS review
 * is still committed at answer time, but the next item is not served until the
 * learner presses Next, so the correction lands on the question that produced
 * the error rather than on its replacement. `handleNote` is inert while the
 * reveal is up, which covers the on-screen keyboard, the QWERTY fallback and a
 * real MIDI press at once. A correct answer is unchanged: it serves the next
 * item immediately.
 *
 * ## Serving items (roadmap 3.20, REQ-3.5.6)
 *
 * Every id `buildTheoryQuiz` mints is derived purely from the content it
 * names (tonic, scale type, chord quality/inversion, ...), so
 * `theoryQuizFromId` can read one back into the exact item it names, without
 * touching `rng` at all — see that function's doc in `core/drills/theory.ts`.
 * The same lookup runs at BOTH ends of a session: the initial `item` state is
 * seeded from whatever is already due at mount, and after grading,
 * `commitAnswer` re-checks and, if a card is due, serves
 * `theoryQuizFromId(dueCard.id)` directly — the specific fact that was
 * actually due, not a fresh random draw of its kind. Only when nothing is due
 * does either path fall back to a fresh `buildTheoryQuiz` draw. This is what
 * makes SRS scheduling actually drive content: before this, a card's interval
 * and ease were tracked but the card's own item was never guaranteed to
 * reappear — including a session's very first item, which used to be drawn
 * at random even with a backlog of overdue facts.
 */
import { createBrowserClock } from '@app/practice/clock.ts'
import { useMidiConnection, type ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { usePracticeLog } from '@app/practice/usePracticeLog.ts'
import { OnScreenKeyboard } from '@app/drills/OnScreenKeyboard.tsx'
import { RevealNext } from '@app/drills/RevealNext.tsx'
import { QwertyHint } from '@app/keyboardInput/QwertyHint.tsx'
import { defaultBaseNote } from '@app/keyboardInput/qwertyNoteMap.ts'
import { useQwertyNoteInput } from '@app/keyboardInput/useQwertyNoteInput.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { SrsSummary } from '@app/srs/SrsSummary.tsx'
import { createBrowserRng } from '@app/sightreading/rng.ts'
import {
  ALL_THEORY_KINDS,
  buildTheoryQuiz,
  gradeTheoryStep,
  MAX_THEORY_LEVEL,
  theoryQuizFromId,
  type TheoryAnswerResult,
  type TheoryQuizItem,
  type TheoryQuizKind,
} from '@core/drills/theory.ts'
import {
  dueCards,
  newCard,
  retentionStats,
  review,
  type Card,
  type Grade,
} from '@core/srs/scheduler.ts'
import type { DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, type Midi } from '@core/shared/units.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type TheoryDrillPanelProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly rng?: Rng
  /** Seeds which topic the panel opens on. Read once at mount; the shell
   *  remounts via `key` when the plan names a different topic. */
  readonly initialKind?: TheoryQuizKind
  /** Seeds the level, clamped to [1, MAX_THEORY_LEVEL]. Read once at mount. */
  readonly initialLevel?: number
}

const MIN_LEVEL = 1
/** Derived from the core tables' own tier count, never restated (roadmap 3.20) — see MAX_THEORY_LEVEL. */
const MAX_LEVEL = MAX_THEORY_LEVEL

function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)))
}

const KIND_LABEL: Readonly<Record<TheoryQuizKind, string>> = {
  'build-scale': 'Scale',
  'build-chord': 'Chord',
  'build-interval': 'Interval',
  'name-key-signature': 'Key signature',
  'build-cadence': 'Cadence',
}

const KINDS: readonly TheoryQuizKind[] = ALL_THEORY_KINDS

/** So the panel's own retention stats don't pick up flashcard drill cards
 *  sharing the same store — every theory id starts with one of these. */
const THEORY_ID_PREFIXES: readonly string[] = KINDS.map((k) => `${k}-`)

function isTheoryCardId(id: string): boolean {
  return THEORY_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}

/**
 * The most-overdue RESOLVABLE theory card's own item, via `theoryQuizFromId`
 * — not a fresh random item of its kind (roadmap 3.20, REQ-3.5.6). This is
 * what makes SRS scheduling actually drive content: a specific overdue fact
 * ("E major has 4 sharps") comes back as itself, not as a new random draw
 * that merely happens to share its kind.
 *
 * `dueCards` is asked for every overdue card, not just the single
 * most-overdue one: a single unparseable id at the head of the queue (a
 * foreign or stale id that happens to start with a theory kind prefix —
 * reachable via `useFlashcardStore.hydrate` replacing `cardsById` wholesale
 * from an imported snapshot) must not disable recall for every genuinely due
 * card behind it. The first id `theoryQuizFromId` actually resolves wins;
 * `undefined` only once nothing due parses at all — the caller falls back to
 * a fresh draw either way.
 */
function dueTheoryItem(
  cardsById: Readonly<Record<string, Card>>,
  nowMs: number,
  onlyKind?: TheoryQuizKind,
): TheoryQuizItem | undefined {
  const theoryCards = Object.values(cardsById).filter((c) => isTheoryCardId(c.id))
  for (const card of dueCards(theoryCards, nowMs)) {
    const item = theoryQuizFromId(card.id)
    if (item !== undefined && (onlyKind === undefined || item.kind === onlyKind)) return item
  }
  return undefined
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

/**
 * The verdict. A wrong answer names the notes that answered the prompt
 * (improve-app run 2026-08-24-1) — "Not quite — graded again" told a learner
 * only that they were wrong, which is the half of the testing effect that does
 * not teach. The grade is dropped from the wrong-answer copy: "again" is SRS
 * vocabulary, not learner vocabulary (DESIGN.md rule 7), and the answer is
 * what the sentence is now for.
 */
function AnswerFeedback({ result }: { readonly result: TheoryAnswerResult | undefined }) {
  if (result === undefined) return null
  const grade: Grade = result.correct ? 'good' : 'again'
  return (
    <p role="status" data-testid="theory-feedback">
      {result.correct ? `Correct — graded ${grade}` : `Not quite — it was ${result.expected}`}
    </p>
  )
}

/**
 * The reveal's exit control, mounted only while a missed prompt is held on
 * screen. Same shape and the same focus reasoning as `FlashcardScreen`'s
 * `RevealNext`: the answer keyboard goes inert under the reveal, so focus
 * would otherwise fall out of the DOM and a keyboard user would tab from the
 * top of the document to reach Next.
 */
export function TheoryDrillPanel(props: TheoryDrillPanelProps) {
  const [level, setLevel] = useState(() => clampLevel(props.initialLevel ?? MIN_LEVEL))
  const [kind, setKind] = useState<TheoryQuizKind>(() => props.initialKind ?? 'build-scale')

  const [date] = useState<DateSource>(() => props.date ?? { epochMillis: () => Date.now() })
  const [rng] = useState<Rng>(() => props.rng ?? createBrowserRng())
  // This panel deliberately takes no `clock` prop (see the module doc: no
  // elapsed time is measured here) — this one is purely to satisfy
  // `usePracticeLog`'s `PracticeTimer` constructor and is never exposed.
  const [logClock] = useState(() => createBrowserClock())
  const practiceLog = usePracticeLog({ clock: logClock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog
  const midiConn = useMidiConnection(
    props.midiInput !== undefined
      ? { midiInput: props.midiInput }
      : props.connectMidi !== undefined
        ? { connect: props.connectMidi }
        : {},
  )

  const cardsById = useFlashcardStore((s) => s.cardsById)
  const upsertCard = useFlashcardStore((s) => s.upsertCard)

  // Seeded from whatever is already due at mount — not always a fresh random
  // draw — so a backlog of overdue facts is served from the first render
  // rather than only after the learner has already answered something
  // (roadmap 3.20). The [kind, level] effect below skips its own first run
  // so it does not immediately overwrite this with a random draw.
  const [item, setItem] = useState<TheoryQuizItem | undefined>(
    () =>
      dueTheoryItem(cardsById, date.epochMillis(), props.initialKind) ??
      buildTheoryQuiz(kind, level, rng),
  )
  const [playedGroups, setPlayedGroups] = useState<readonly (readonly Midi[])[]>([])
  const [, setPendingNotes] = useState<readonly Midi[]>([])
  const [lastResult, setLastResult] = useState<TheoryAnswerResult | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const [nowMs, setNowMs] = useState<number>(() => date.epochMillis())

  // Accumulates presses within the current attempt; mirrored into
  // `playedGroups`/`pendingNotes` state for rendering. Reading and writing
  // this ref (rather than deriving the next value from stale render-closure
  // state) makes two `noteOn` events delivered in the same batched task
  // accumulate correctly instead of the second overwriting the first.
  const pendingRef = useRef<readonly Midi[]>([])
  const playedRef = useRef<readonly (readonly Midi[])[]>([])

  // Set just before `commitAnswer` calls `setKind` to serve a due item of a
  // different kind: tells the kind/level effect below "the item is already
  // decided, don't overwrite it with a fresh random draw" — otherwise the
  // effect racing the due item we just resolved would silently replace it,
  // reintroducing the bug this module exists to fix (roadmap 3.20).
  const suppressResetRef = useRef(false)

  // The very first run of the effect below would otherwise stomp the item
  // the `useState` initialiser above just seeded (possibly a due recall,
  // not a random draw) with a fresh `buildTheoryQuiz` call — this ref makes
  // that first run a no-op so mount only ever sets `item` once.
  const isFirstItemEffectRef = useRef(true)

  // A user-driven level or kind change always starts a fresh item and a
  // fresh attempt — never mid-answer state from before. `commitAnswer` below
  // is the one caller that changes `kind` WITHOUT wanting that: it sets
  // `suppressResetRef` first so this effect leaves its own item alone.
  useLayoutEffect(() => {
    if (isFirstItemEffectRef.current) {
      isFirstItemEffectRef.current = false
      return
    }
    if (suppressResetRef.current) {
      suppressResetRef.current = false
      return
    }
    setItem(buildTheoryQuiz(kind, level, rng))
    playedRef.current = []
    pendingRef.current = []
    setPlayedGroups([])
    setPendingNotes([])
    setLastResult(undefined)
    setRevealed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only kind/level should reset the item
  }, [kind, level])

  // REQ-3.9.5 (roadmap 5.14): one log entry per topic+level, mirroring
  // `useFlashcardDrill`'s deck-change pattern — closed and reopened whenever
  // the topic or level changes, with `usePracticeLog`'s own unmount safety
  // net closing the final one. The start() itself is deferred by a
  // macrotask and cancelled in cleanup — see `useFlashcardDrill.ts`'s
  // identical effect for why: React 18 StrictMode's synchronous
  // mount->cleanup->remount double-invoke would otherwise open and
  // immediately close a real, stored, near-zero-duration session on every
  // fresh mount, since a `PracticeTimer` session is not an idempotent
  // resource the way a subscription is.
  useEffect(() => {
    const timer = setTimeout(() => {
      practiceLogRef.current.stop()
      practiceLogRef.current.start('theory', `${KIND_LABEL[kind]} — level ${level}`)
    }, 0)
    return () => {
      clearTimeout(timer)
      practiceLogRef.current.stop()
    }
  }, [kind, level])

  /** Grades the settled attempt into the SRS store; returns the store as it
   *  stands afterwards, so the caller can ask what is due without re-reading. */
  function scheduleReview(
    answered: TheoryQuizItem,
    correct: boolean,
  ): Readonly<Record<string, Card>> {
    const grade: Grade = correct ? 'good' : 'again'
    const dateNow = date.epochMillis()
    // Read fresh from the store rather than the closed-over `cardsById`: two
    // answer-completing `noteOn` events delivered in the same batch both
    // call `commitAnswer` against the SAME render's closure, so the second
    // call would otherwise start its `review` from the pre-first-review
    // card, losing a grade (roadmap 3.20 finding 7).
    const currentCardsById = useFlashcardStore.getState().cardsById
    const existing = currentCardsById[answered.id] ?? newCard(answered.id, dateNow)
    const updated = review(existing, grade, dateNow, rng)
    upsertCard(updated)
    setNowMs(dateNow)
    return { ...currentCardsById, [updated.id]: updated }
  }

  /** Puts the next prompt up and clears the attempt. */
  function serveNext(fromCardsById: Readonly<Record<string, Card>>): void {
    // The due card's OWN item comes back, not a fresh draw of its kind
    // (roadmap 3.20) — only when nothing is due does a fresh item get drawn.
    const dueItem = dueTheoryItem(fromCardsById, date.epochMillis())
    const nextItem = dueItem ?? buildTheoryQuiz(kind, level, rng)
    if (nextItem.kind !== kind) {
      suppressResetRef.current = true
      setKind(nextItem.kind)
    }
    setItem(nextItem)
    playedRef.current = []
    pendingRef.current = []
    setPlayedGroups([])
    setPendingNotes([])
  }

  function commitAnswer(answered: TheoryQuizItem, correct: boolean): void {
    const updatedCardsById = scheduleReview(answered, correct)
    // A miss holds the prompt, with its answer named, until the learner
    // leaves it — the review above is already scheduled either way.
    if (!correct) {
      setRevealed(true)
      return
    }
    serveNext(updatedCardsById)
  }

  /** Leaves the reveal. Reads the store directly: the missed item's own review
   *  was committed at answer time and has been in there ever since. */
  function next(): void {
    if (!revealed) return
    setRevealed(false)
    setLastResult(undefined)
    serveNext(useFlashcardStore.getState().cardsById)
  }

  function handleNote(note: Midi): void {
    if (revealed) return
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

  // `handleNote` already no-ops with no `item` loaded, so this can stay
  // unconditionally enabled (roadmap 5.5).
  useQwertyNoteInput({
    enabled: true,
    low: range.low,
    high: range.high,
    baseNote: defaultBaseNote(range.low, range.high),
    onPress: handleNote,
  })

  return (
    <div className="theory-drill-panel">
      <h2>Theory drills</h2>

      <div className="field-row theory-drill-controls">
        {/* `.stepper` (roadmap UI-01/UI-17, canonicalised in the 2026-08
            stepper sweep): the label lives OUTSIDE the bordered [-]/[+]
            group, in this `.field` — the group itself carries
            `aria-labelledby` pointing at it, and each button still carries
            its own `aria-label` ("Decrease level"/"Increase level") so the
            control is unambiguous even read out of context. Before this,
            "Level {level}" was the only label and it sat SANDWICHED between
            the two buttons, inside the group — the exact defect `.stepper`
            exists to fix (see primitives.css's file header). The value cell
            now holds the bare numeral, matching the canonical shape shared
            with Flashcards, Rhythm and Metronome — it used to repeat the
            word "Level" a second time inside the group, which this sweep
            also removes. */}
        <div className="field">
          <label id="theory-level-label">Level</label>
          <div className="stepper" role="group" aria-labelledby="theory-level-label">
            <button
              type="button"
              aria-label="Decrease level"
              disabled={level <= MIN_LEVEL}
              onClick={() => setLevel((l) => Math.max(MIN_LEVEL, l - 1))}
            >
              −
            </button>
            <span className="stepper-value" data-testid="theory-level">
              {level}
            </span>
            <button
              type="button"
              aria-label="Increase level"
              disabled={level >= MAX_LEVEL}
              onClick={() => setLevel((l) => Math.min(MAX_LEVEL, l + 1))}
            >
              +
            </button>
          </div>
        </div>

        <div className="field">
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
      </div>

      {item === undefined ? (
        <p role="status">Loading…</p>
      ) : (
        <section aria-label="Theory quiz" className="theory-quiz">
          <p data-testid="theory-prompt">{item.prompt}</p>
          <div className="stat" data-testid="theory-progress">
            <span className="stat-value">
              {playedGroups.length} / {item.answer.length}
            </span>
            <span className="stat-label">Played</span>
          </div>
          <OnScreenKeyboard
            low={range.low}
            high={range.high}
            onPress={handleNote}
            disabled={revealed}
          />
          <QwertyHint />
          <AnswerFeedback result={lastResult} />
          {revealed && <RevealNext onNext={next} />}
        </section>
      )}

      <SrsSummary stats={stats} idPrefix="theory-stats" ariaLabel="Retention" />
    </div>
  )
}
