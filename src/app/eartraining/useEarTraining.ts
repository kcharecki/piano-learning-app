/**
 * Ear-training drill wiring (roadmap 3.10, REQ-3.6.1/3.6.2) — the only
 * consumer `core/eartraining`'s four modules (`item.ts`, `intervals.ts`,
 * `chords.ts`, `dictation.ts`, `session.ts`) will ever have.
 *
 * The hook holds an `EarSessionState` (in `earTrainingStore`), generates the
 * next item for the selected `kind` — the SRS-due one if `nextDueItemId` says
 * one is due, otherwise a fresh one at that kind's current level — plays it
 * through the injected `AudioOutput`, grades an answer with the matching
 * drill's own grader (never re-derives music theory here), records the
 * attempt (`recordEarAttempt`, which also re-adapts that kind's level), and
 * exposes the result. No music logic lives here: every generate/grade call
 * below is a straight pass-through to `core/eartraining`.
 *
 * ## Playback
 *
 * Every note in `item.prompt` is scheduled on the `AudioOutput` from a single
 * `audioOutput.now()` reading plus the score's own tick->ms mapping
 * (`@core/timing/tempo.ts`), exactly as the task brief asks — never a second
 * clock reading per note, and never hand-rolled tick/tempo arithmetic.
 *
 * ## Phase
 *
 * `start()`/`replay()` set `'playing'` synchronously, having already handed
 * every note to the `AudioOutput` with its own future `atMs` timestamps —
 * the same look-ahead-scheduling pattern the transport already uses, so the
 * hook never blocks wall-clock time waiting for sound to finish. An effect
 * then advances `'playing'` to `'answering'` on the next tick, purely so the
 * UI can (if it wants to) show a brief "playing" state before the answer pad
 * is live; `answer()` itself accepts either phase, so a stray double-render
 * ordering can never make an answer inert.
 *
 * ## A known gap: due items only survive until the store is persisted
 *
 * `session.ts` deliberately does not store an `EarItem`'s full prompt —
 * `nextDueItemId` returns only an id, and its own module comment says the
 * caller must persist the generated item to ask the exact same due card
 * again. `earTrainingStore.itemsById` is exactly that cache (`rememberItem`
 * writes every generated item into it), so a due card asked for again within
 * the same running app gets back its own literal prompt, not a regenerated
 * one. Persisting the store through the `Store` port (session AND itemsById)
 * is an explicit follow-up task, not this one — see the report. Until that
 * lands, a due card whose item did not survive a full page reload falls back
 * to generating a fresh item at the kind's current level instead of the
 * literal due one; the due card itself is not reviewed in that case, so it
 * stays due until `itemsById` (once persisted) has it again. This is a real
 * gap, not a silently-resolved ambiguity — it is called out again in the
 * module's report.
 *
 * ## Dictation answers (roadmap 3.11, REQ-3.6.1/3.6.2)
 *
 * `melodic-dictation` and `rhythmic-dictation` play back through the same
 * `scheduleItem` path as every other kind; what they lacked was a way to
 * answer. `pressDictationNote` records one played-back note — the first press
 * anchors the prompt's own first onset (`item.prompt.notes[0].startTick`),
 * never a literal tick 0: a rhythmic prompt often opens on a rest once rests
 * are allowed (level >= 2), so the true first note can sit at a non-zero
 * tick, and anchoring to 0 would mis-score a note-perfect answer every time.
 * Every later press is placed by how much wall-clock time elapsed since that
 * first press, converted to ticks against the prompt's own tempo (`msToTick`,
 * never a hand-rolled ms/tick ratio) and added to that same anchor — and
 * `submitDictation` hands the recorded notes to `gradeDictation` and files
 * the result through the same `answer()` -> `recordEarAttempt` path every
 * other drill uses, so SRS and level adaptation see a dictation attempt
 * exactly like any other. Timestamps come from the same clock `scheduleItem`
 * already reads (`AudioOutput.now()`), never `Date.now()`/`performance.now()`
 * directly — see `audio.ts`'s own doc on why every `atMs` must share one
 * epoch. A real MIDI keyboard answers a dictation prompt too (REQ-3.6.2):
 * `midi.input`'s `noteOn` events reach `pressDictationNote` the same way
 * `useFlashcardDrill`'s own MIDI wiring reaches `answerNote`.
 *
 * ## A continuous accuracy, not a collapsed boolean (roadmap 3.26)
 *
 * `answer()` used to record every `EarAttempt` with a boolean `correct`,
 * discarding the real `pitchAccuracy`/`rhythmAccuracy` `gradeDictation`
 * already computes. `accuracyForAttempt` (below) is the one place that
 * passes the kind-appropriate real number through instead — see its own doc
 * comment and `@core/eartraining/session.ts`'s module doc for why that makes
 * the adaptation band meaningful again for dictation while leaving every
 * multiple-choice kind's adaptation bit-for-bit unchanged.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import {
  useMidiConnection,
  type ConnectMidi,
  type MidiConnection,
} from '@app/practice/useMidiConnection.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import type { EarGrade, EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { generateIntervalItem, gradeIntervalAnswer } from '@core/eartraining/intervals.ts'
import {
  generateChordQualityItem,
  generateScaleModeItem,
  gradeChordQualityAnswer,
  gradeScaleModeAnswer,
} from '@core/eartraining/chords.ts'
import {
  gradeDictation,
  generateMelodicDictation,
  generateRhythmicDictation,
  type DictationAnswerNote,
  type DictationGrade,
} from '@core/eartraining/dictation.ts'
import { nextDueItemId, recordEarAttempt, type EarAttempt } from '@core/eartraining/session.ts'
import { retentionStats, type RetentionStats } from '@core/srs/scheduler.ts'
import { bpmAtTick, makeTempoMap, msToTick, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import type { AudioOutput, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import {
  addTicks,
  midi,
  millis,
  ticks,
  TICKS_PER_QUARTER,
  type Midi,
  type Millis,
  type Ticks,
} from '@core/shared/units.ts'
import type { ChordQuality } from '@core/theory/chords.ts'
import type { Interval } from '@core/theory/intervals.ts'
import type { ScaleType } from '@core/theory/scales.ts'

export type EarTrainingPhase = 'idle' | 'playing' | 'answering' | 'graded'

/**
 * One answer, tagged by which drill it is for. `'dictation'` answers both
 * dictation kinds — `melodic-dictation` and `rhythmic-dictation` — the same
 * way `gradeDictation` itself does not need a separate answer shape per kind,
 * only a different grading rule once it has `item.kind` to look at.
 */
export type EarAnswer =
  | {
      readonly kind: 'interval-melodic' | 'interval-harmonic'
      readonly interval: Interval
      /** Ascending by default. Meaningless for a harmonic item — see `gradeIntervalAnswer`. */
      readonly direction?: 1 | -1
    }
  | { readonly kind: 'chord-quality'; readonly quality: ChordQuality }
  | { readonly kind: 'scale-mode'; readonly type: ScaleType }
  | { readonly kind: 'dictation'; readonly notes: readonly DictationAnswerNote[] }

export type UseEarTrainingOptions = {
  /** Which drill to draw from. Defaults to `'interval-melodic'`. */
  readonly kind?: EarItemKind
  /** Epoch-ms source for SRS scheduling — see `core/eartraining/session.ts`'s module comment. */
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly rng?: Rng
  /** MIDI injection seams — see `useFlashcardDrill`'s identical three-way
   *  options. A ready-made input skips `connectMidi` entirely. */
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  /**
   * Play a brief tonic-context (a drone: tonic + fifth) before every item —
   * REQ-3.6.1/REQ-3.6.2's "establish a tonal center first" (roadmap 5.28).
   * Defaults on. Pass `false` for context-free practice: functional
   * (key-relative) and context-free (interval-only) hearing are
   * complementary skills, neither one obsoleting the other — see this
   * option's own module-doc section below.
   */
  readonly tonalContext?: boolean
}

export type UseEarTraining = {
  readonly phase: EarTrainingPhase
  readonly item: EarItem | undefined
  readonly grade: EarGrade | undefined
  /** Per-kind level, straight from the session — see `session.ts`'s `EarSessionState.levels`. */
  readonly levels: Readonly<Record<EarItemKind, number>>
  /** Retention stats for the current `kind`'s cards only — see `useFlashcardDrill`'s equivalent. */
  readonly stats: RetentionStats
  readonly kind: EarItemKind
  /** MIDI connection state — REQ-3.6.2 ("using any key on the MIDI
   *  keyboard"). A real press reaches `pressDictationNote` exactly like an
   *  on-screen key press; see `useFlashcardDrill`'s identical wiring. */
  readonly midi: MidiConnection
  /** The current item's own written tempo (bpm at tick 0), for the screen to
   *  display — REQ-3.6.1 (roadmap 3.23), see the module doc's "A count-in and
   *  a displayed tempo" section. `undefined` with no item loaded yet. */
  readonly promptTempoBpm: number | undefined
  setKind(kind: EarItemKind): void
  /** Generate (SRS-due, else fresh) and play the next item for the current kind. */
  start(): void
  /** Play the current item again — the core interaction of an ear drill. No-op with no item yet. */
  replay(): void
  answer(answer: EarAnswer): void
  /** Notes recorded so far for the current dictation item, oldest first. Empty for every other kind. */
  readonly dictationNotes: readonly DictationAnswerNote[]
  /** Record one played note. The first press anchors the prompt's own first
   *  onset; later presses are placed by elapsed time against the prompt's
   *  tempo. No-op unless the current item is a dictation item. */
  readonly pressDictationNote: (note: Midi) => void
  /** Drop everything recorded so far so the learner can try again. */
  readonly clearDictation: () => void
  /** Grade what has been recorded with `gradeDictation` and record the attempt
   *  through the same path every other answer uses, so adaptation and SRS see it.
   *  No-op if no dictation item is loaded. */
  readonly submitDictation: () => void
}

function isDictationKind(kind: EarItemKind): boolean {
  return kind === 'melodic-dictation' || kind === 'rhythmic-dictation'
}

const DEFAULT_KIND: EarItemKind = 'interval-melodic'

function generateItemForKind(kind: EarItemKind, level: number, rng: Rng): EarItem {
  switch (kind) {
    case 'interval-melodic':
      return generateIntervalItem(level, { harmonic: false }, rng)
    case 'interval-harmonic':
      return generateIntervalItem(level, { harmonic: true }, rng)
    case 'chord-quality':
      return generateChordQualityItem(level, {}, rng)
    case 'scale-mode':
      return generateScaleModeItem(level, {}, rng)
    case 'melodic-dictation':
      return generateMelodicDictation(level, {}, rng)
    case 'rhythmic-dictation':
      return generateRhythmicDictation(level, {}, rng)
  }
}

function gradeAnswerForItem(item: EarItem, answer: EarAnswer): EarGrade | DictationGrade {
  switch (answer.kind) {
    case 'interval-melodic':
    case 'interval-harmonic':
      return gradeIntervalAnswer(item, answer.interval, answer.direction ?? 1)
    case 'chord-quality':
      return gradeChordQualityAnswer(item, answer.quality)
    case 'scale-mode':
      return gradeScaleModeAnswer(item, answer.type)
    case 'dictation':
      return gradeDictation(item, answer.notes)
  }
}

/**
 * REQ-3.6.1/3.6.3: the continuous `EarAttempt.accuracy` roadmap 3.26 wires
 * through instead of collapsing every answer to a boolean. A multiple-choice
 * kind (interval, chord, scale) has no partial credit to invent, so its
 * accuracy is exactly 1 or 0. Dictation is where a real continuous value
 * exists: `melodic-dictation` records `pitchAccuracy` (the axis it names —
 * how many pitches landed), `rhythmic-dictation` records `rhythmAccuracy`
 * (how many onsets landed) — see `dictation.ts`'s own doc on why the two are
 * tracked independently rather than folded into one blended number.
 * `'pitchAccuracy' in grade` narrows the union safely: only `gradeDictation`
 * ever produces a `DictationGrade`, and `answer()`'s own `kindMatches` guard
 * already ensures a dictation-kind item is graded through that path.
 *
 * Only `pitchAccuracy` is read, with no per-kind branch: `dictation.ts`
 * itself already folds `rhythmic-dictation` onto the rhythm axis —
 * `gradePitch = item.kind !== 'rhythmic-dictation'` makes `pitchAccuracy`
 * ASSIGNED `rhythmAccuracy` for a rhythmic item — so a `kind ===
 * 'rhythmic-dictation' ? grade.rhythmAccuracy : grade.pitchAccuracy` ternary
 * here would be a no-op that reads two bit-identical fields. A prior version
 * of this function had exactly that dead ternary; see the review finding
 * this fixes.
 *
 * `pitchAccuracy`'s own denominator is `expected.length` (the prompt's note
 * count) — spurious extra presses are not in it, so a note-perfect answer
 * plus noise would otherwise still read as `accuracy: 1`. Scale by the
 * expected/(expected+extra) ratio so extra presses cost accuracy exactly
 * like a missed or mis-pitched one does; an extra-free answer (every
 * multiple-choice kind, and any clean dictation) is unaffected because the
 * ratio is 1.
 */

/**
 * ## A count-in and a displayed tempo for dictation (roadmap 3.23, REQ-3.6.1)
 *
 * A dictation prompt used to play with no visible tempo and no pulse before
 * the learner answers — `gradeDictation`'s fixed onset tolerance was graded
 * against a tempo the learner had no way to perceive, so a correct rhythm
 * played a little fast or slow failed outright (measured: 416 of 900 cases
 * at 8% slow). `dictation.ts`'s own tempo-scale fit (roadmap 3.23) makes a
 * *consistent* tempo difference survive grading either way, but a learner
 * still needs the pulse to be consistent AGAINST — hence the two additions
 * here, both screen-only, neither touching grading:
 *
 *  - `promptTempoBpm`: the current item's own tempo (`bpmAtTick` at tick 0),
 *    for `EarTrainingScreen` to display. Computed from `item.prompt.tempos`,
 *    never hand-rolled — see `timing/tempo.ts`'s own module doc for why that
 *    is the one place allowed to know a tick<->ms mapping.
 *  - `scheduleItem` gives every dictation item (never a multiple-choice kind
 *    — see below) a one-bar count-in of `AudioOutput.click` calls before the
 *    prompt's own notes, at the SAME tempo, built entirely from `tickToMs`'s
 *    documented negative-tick extrapolation (`timing/tempo.ts`: "ticks before
 *    0 extrapolate backwards at the first tempo, which is what a count-in
 *    needs") — never a second, hand-rolled ms/tick computation. First beat
 *    accented, one click per beat of the prompt's own first measure's time
 *    signature.
 *
 * Only dictation kinds get a count-in: an interval, chord or scale answer is
 * graded on WHAT was played, never WHEN, so a count-in there would only be
 * something to sit through for no pedagogical benefit — see the "does not
 * schedule a count-in for a non-dictation kind" test, which pins that this is
 * a deliberate scope limit, not an oversight.
 *
 * No metronome continues into the answering phase, on purpose. Every other
 * scheduled sound in this hook — including the count-in above — is scheduled
 * from a single `AudioOutput.now()` reading against something of KNOWN
 * length (the module doc's own "look-ahead scheduling" section: "the hook
 * never blocks wall-clock time waiting for sound to finish"). The answering
 * phase has no known length — the learner free-plays for as long as they
 * like before `submitDictation` — so ticking through it would need an
 * open-ended, continuously-rescheduled click stream: a different scheduling
 * model `AudioOutput`/`Scheduler` does not offer today (no "cancel remaining
 * clicks on submit" hook, no recurring-schedule primitive). Building that
 * infrastructure just for a nice-to-have accent track is out of scope for
 * this task; the count-in alone already gives the learner the pulse
 * `gradeDictation`'s tempo-scale fit is graded against, which is the actual
 * defect this task exists to fix.
 */
function accuracyForAttempt(_kind: EarItemKind, grade: EarGrade | DictationGrade): number {
  if ('pitchAccuracy' in grade) {
    const extras = grade.notes.filter((n) => n.status === 'extra').length
    const expected = grade.notes.filter((n) => n.status !== 'extra').length
    if (extras === 0) return grade.pitchAccuracy
    return grade.pitchAccuracy * (expected / (expected + extras))
  }
  return grade.correct ? 1 : 0
}

/**
 * A one-bar count-in of clicks ending exactly at tick 0 (first beat accented), scheduled entirely
 * from negative ticks against the item's own tempo map — see the module doc's "A count-in and a
 * displayed tempo" section. `item.prompt.measures[0]` always exists (`makeScore` requires at least
 * one measure), so the beat count is always well-defined; falling back to 4 is unreachable in
 * practice and only guards `noUncheckedIndexedAccess`, not a real code path.
 */
function scheduleCountIn(audioOutput: AudioOutput, item: EarItem, baseMs: Millis, tempoMap: TempoMap): void {
  const beats = item.prompt.measures[0]?.timeSignature.beats ?? 4
  for (let i = 0; i < beats; i++) {
    const tick = ticks(-(beats - i) * TICKS_PER_QUARTER)
    const atMs = millis(baseMs + tickToMs(tempoMap, tick))
    audioOutput.click(i === 0, atMs)
  }
}

/** Beats of tonic-drone context (tonic + fifth, held together) played before an item
 *  (roadmap 5.28) — see `scheduleContext`'s own doc below. */
const CONTEXT_BEATS = 2
/** Softer than a prompt note's own velocity (score notes default around 80):
 *  the drone is a reference to listen past, not the thing being graded. */
const CONTEXT_VELOCITY = 55

/**
 * A tonic + fifth drone ending exactly at `endTick` — negative-tick scheduled
 * against the item's own tempo map, the same `tickToMs` extrapolation
 * `scheduleCountIn` already uses, so no second hand-rolled ms/tick
 * computation exists in this file. `endTick` is tick 0 for a non-dictation
 * item, or the count-in's own start tick for a dictation item (see
 * `scheduleItem`) — the drone always finishes right where the NEXT sound
 * begins, never overlapping it.
 */
function scheduleContext(
  audioOutput: AudioOutput,
  tonicMidi: Midi,
  baseMs: Millis,
  tempoMap: TempoMap,
  endTick: Ticks,
): void {
  const fifth = midi(tonicMidi + 7)
  const startTick = ticks(endTick - CONTEXT_BEATS * TICKS_PER_QUARTER)
  const onMs = millis(baseMs + tickToMs(tempoMap, startTick))
  const offMs = millis(baseMs + tickToMs(tempoMap, endTick))
  for (const pitch of [tonicMidi, fifth]) {
    audioOutput.noteOn(pitch, CONTEXT_VELOCITY, onMs)
    audioOutput.noteOff(pitch, offMs)
  }
}

/**
 * Schedule every note of `item.prompt` from one `audioOutput.now()` reading, plus (in order)
 * a tonal-context drone (roadmap 5.28, unless `tonalContext` is false or the item carries no
 * `contextTonicMidi` — see `scheduleContext`'s own doc above) and a count-in for a dictation
 * item (module doc's "A count-in and a displayed tempo" section). Both extras schedule BEFORE
 * the prompt's own notes and never touch their timestamps, so grading (which only ever reads
 * `item.prompt`/the learner's answer) is unaffected either way.
 */
function scheduleItem(audioOutput: AudioOutput, item: EarItem, tonalContext: boolean): void {
  const tempoMap = makeTempoMap(item.prompt.tempos)
  const baseMs = audioOutput.now()
  const isDictation = isDictationKind(item.kind)
  if (tonalContext && item.contextTonicMidi !== undefined) {
    // The drone ends where the FIRST sound after it begins: tick 0 for every
    // other kind, or the count-in's own start tick for a dictation item — a
    // dictation item's count-in must stay the sound immediately before the
    // prompt (REQ-3.6.1's pulse-before-you-play-it purpose), not have the
    // drone wedged between it and the prompt.
    const beats = item.prompt.measures[0]?.timeSignature.beats ?? 4
    const contextEndTick = isDictation ? ticks(-beats * TICKS_PER_QUARTER) : ticks(0)
    scheduleContext(audioOutput, item.contextTonicMidi, baseMs, tempoMap, contextEndTick)
  }
  if (isDictation) scheduleCountIn(audioOutput, item, baseMs, tempoMap)
  for (const note of item.prompt.notes) {
    const onMs = millis(baseMs + tickToMs(tempoMap, note.startTick))
    const offMs = millis(baseMs + tickToMs(tempoMap, addTicks(note.startTick, note.durationTicks)))
    audioOutput.noteOn(note.midi, note.velocity, onMs)
    audioOutput.noteOff(note.midi, offMs)
  }
}

export function useEarTraining(options: UseEarTrainingOptions = {}): UseEarTraining {
  const session = useEarTrainingStore((s) => s.session)
  const setSession = useEarTrainingStore((s) => s.setSession)
  const itemsById = useEarTrainingStore((s) => s.itemsById)
  const rememberItem = useEarTrainingStore((s) => s.rememberItem)
  const pruneItems = useEarTrainingStore((s) => s.pruneItems)

  const [date] = useState<DateSource>(() => options.date ?? { epochMillis: () => Date.now() })
  const [rng] = useState<Rng>(() => options.rng ?? seededRng(Date.now()))
  const audioRef = useRef<AudioOutput | undefined>(options.audioOutput)
  const midi = useMidiConnection(
    options.midiInput !== undefined
      ? { midiInput: options.midiInput }
      : options.connectMidi !== undefined
        ? { connect: options.connectMidi }
        : {},
  )

  const [kind, setKindState] = useState<EarItemKind>(options.kind ?? DEFAULT_KIND)
  const [phase, setPhase] = useState<EarTrainingPhase>('idle')
  const [item, setItem] = useState<EarItem | undefined>(undefined)
  const [grade, setGrade] = useState<EarGrade | undefined>(undefined)
  const [dictationNotes, setDictationNotes] = useState<readonly DictationAnswerNote[]>([])
  // Mirrors `dictationNotes` synchronously, alongside every `setDictationNotes`
  // call below — `submitDictation` reads this, not the state variable, so a
  // press and a submit dispatched inside the same React batch (as a MIDI
  // event and a UI click both can) still submit the note the press just
  // recorded, not a stale pre-press snapshot closed over when submitDictation
  // was defined. See the review finding this fixes.
  const dictationNotesRef = useRef<readonly DictationAnswerNote[]>([])
  function setDictationNotesBoth(next: readonly DictationAnswerNote[]): void {
    dictationNotesRef.current = next
    setDictationNotes(next)
  }
  // Wall-clock time (on the AudioOutput's own Clock epoch) of the first
  // recorded press, so every later press can be placed relative to it. Not
  // state: it never needs to trigger a render on its own, only alongside a
  // dictationNotes update.
  const firstPressMsRef = useRef<Millis | undefined>(undefined)

  // A new kind always starts idle, with no stale item/grade from the
  // previous drill lingering — mirrors `useFlashcardDrill`'s deck-change
  // reset. SRS state (`session`) is untouched: only which kind `start()`
  // considers next changes.
  useEffect(() => {
    setItem(undefined)
    setGrade(undefined)
    setPhase('idle')
    setDictationNotesBoth([])
    firstPressMsRef.current = undefined
  }, [kind])

  // See the module comment: real playback runs on the AudioOutput's own
  // future timeline (the atMs timestamps already scheduled in
  // `scheduleItem`), so this never waits on wall-clock time.
  useEffect(() => {
    if (phase !== 'playing') return
    setPhase('answering')
  }, [phase])

  function getAudioOutput(): AudioOutput {
    if (audioRef.current === undefined) {
      audioRef.current = createDefaultAudioOutput()
    }
    return audioRef.current
  }

  function playItemNow(next: EarItem): void {
    scheduleItem(getAudioOutput(), next, options.tonalContext ?? true)
    setPhase('playing')
  }

  function start(): void {
    const now = date.epochMillis()
    const dueId = nextDueItemId(session, [kind], now)
    const cached = dueId === null ? undefined : itemsById[dueId]
    const next = cached ?? generateItemForKind(kind, session.levels[kind], rng)
    // Only a genuinely new item needs writing — a cache hit is already there,
    // and re-writing it on every start() would be a redundant store update
    // and re-render for no behavioural change.
    if (cached === undefined) rememberItem(next)
    setItem(next)
    setGrade(undefined)
    setDictationNotesBoth([])
    firstPressMsRef.current = undefined
    playItemNow(next)
  }

  function replay(): void {
    if (item === undefined) return
    // Play again without reopening answering: once `phase` is 'graded' the
    // grade is on screen, and re-entering 'answering'/'playing' would let a
    // second answer on the same item record a duplicate EarAttempt while the
    // learner can see the answer. See the review finding this fixes.
    scheduleItem(getAudioOutput(), item, options.tonalContext ?? true)
    // A dictation in progress must not survive a replay: pressDictationNote
    // anchors every later press to the *first* press's wall-clock time, and
    // replaying touches neither `dictationNotes` nor `firstPressMsRef` — so a
    // replay heard mid-answer would silently fold the whole replay's
    // listening time into the next press's elapsed offset, corrupting an
    // otherwise-correct answer. Clearing (rather than disabling Replay while
    // notes are recorded) keeps Replay available as "hear it again, start
    // over", which is the more useful escape hatch for an ear-training drill
    // than resuming a half-entered answer would be. See the review finding
    // this fixes.
    if (isDictationKind(item.kind)) clearDictation()
    if (phase !== 'graded') setPhase('playing')
  }

  function answer(a: EarAnswer): void {
    if (item === undefined) return
    if (phase !== 'answering' && phase !== 'playing') return
    // 'dictation' answers both dictation kinds — see EarAnswer's own comment
    // — so the ordinary item.kind === a.kind check does not apply to it.
    const kindMatches = a.kind === 'dictation' ? isDictationKind(item.kind) : item.kind === a.kind
    if (!kindMatches) return

    const now = date.epochMillis()
    const g = gradeAnswerForItem(item, a)
    const attempt: EarAttempt = {
      itemId: item.id,
      kind: item.kind,
      accuracy: accuracyForAttempt(item.kind, g),
      at: now,
      level: item.level,
    }
    const nextSession = recordEarAttempt(session, attempt, now, rng)
    setSession(nextSession)
    // Cap the cache to items an SRS card still exists for — otherwise it
    // grows for the life of the page, holding a full Score per item ever
    // generated.
    pruneItems(nextSession.cards.map((c) => c.id))
    setGrade(g)
    setPhase('graded')
  }

  // See the module comment: the first press anchors the prompt's own first
  // onset (never a literal tick 0 — a rhythmic prompt often opens on a rest
  // once rests are allowed, level >= 2, so the true first note can sit at a
  // non-zero tick), every later press is placed by elapsed wall-clock time
  // against the prompt's own tempo — never a second AudioOutput.now() read
  // turned into an absolute tick without a shared origin. See the review
  // finding this fixes.
  function pressDictationNote(note: Midi): void {
    if (item === undefined || !isDictationKind(item.kind)) return
    if (phase !== 'answering' && phase !== 'playing') return

    const firstNote = item.prompt.notes[0]
    const baseTick = firstNote === undefined ? ticks(0) : firstNote.startTick
    const nowMs = getAudioOutput().now()
    if (firstPressMsRef.current === undefined) {
      firstPressMsRef.current = nowMs
      setDictationNotesBoth([{ midi: note, startTick: baseTick }])
      return
    }
    const tempoMap = makeTempoMap(item.prompt.tempos)
    const elapsedTicks = msToTick(tempoMap, millis(nowMs - firstPressMsRef.current))
    // Math.max(0, ...) guards a backwards clock reading: `AudioOutput.now()`
    // (the webaudio adapter) can re-snap its epoch offset after a jump of
    // more than 250ms, e.g. a backgrounded tab — an unguarded negative result
    // would be written into a domain object through `ticks()`'s unchecked
    // cast. See the review finding this fixes.
    const startTick = ticks(Math.max(0, baseTick + Math.round(elapsedTicks)))
    setDictationNotesBoth([...dictationNotesRef.current, { midi: note, startTick }])
  }

  function clearDictation(): void {
    setDictationNotesBoth([])
    firstPressMsRef.current = undefined
  }

  function submitDictation(): void {
    if (item === undefined || !isDictationKind(item.kind)) return
    // A submit with nothing recorded would grade every prompt note 'missing'
    // and record a real EarAttempt — the view's `disabled` on Submit is the
    // only other guard, and a MIDI-driven submit (once wired) would not go
    // through the view at all. See the review finding this fixes.
    if (dictationNotesRef.current.length === 0) return
    answer({ kind: 'dictation', notes: dictationNotesRef.current })
  }

  const pressDictationNoteRef = useRef(pressDictationNote)
  pressDictationNoteRef.current = pressDictationNote

  // A real MIDI press answers a dictation prompt exactly like an on-screen
  // key press (REQ-3.6.2: "using any key on the MIDI keyboard") — and is a
  // no-op via `pressDictationNote` itself while a non-dictation item is
  // showing, the same way `useFlashcardDrill`'s equivalent wiring is a no-op
  // for a mismatched card kind. See the review finding this fixes.
  useEffect(() => {
    if (midi.input === undefined) return undefined
    return midi.input.onEvent((event) => {
      if (event.type === 'noteOn') pressDictationNoteRef.current(event.note)
    })
  }, [midi.input])

  const stats = useMemo(
    () =>
      retentionStats(
        session.cards.filter((c) => session.kinds[c.id] === kind),
        date.epochMillis(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- date is a stable injected port, not reactive state
    [session, kind],
  )

  // REQ-3.6.1 (roadmap 3.23): see the module doc's "A count-in and a displayed tempo" section.
  const promptTempoBpm =
    item === undefined ? undefined : bpmAtTick(makeTempoMap(item.prompt.tempos), ticks(0))

  return {
    phase,
    item,
    grade,
    levels: session.levels,
    stats,
    kind,
    midi,
    promptTempoBpm,
    setKind: setKindState,
    start,
    replay,
    answer,
    dictationNotes,
    pressDictationNote,
    clearDictation,
    submitDictation,
  }
}
