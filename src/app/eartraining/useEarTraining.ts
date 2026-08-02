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
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createDefaultAudioOutput } from '@app/practice/createDefaultAudioOutput.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import type { EarGrade, EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { generateIntervalItem, gradeIntervalAnswer } from '@core/eartraining/intervals.ts'
import {
  generateChordQualityItem,
  generateScaleModeItem,
  gradeChordQualityAnswer,
  gradeScaleModeAnswer,
} from '@core/eartraining/chords.ts'
import { generateMelodicDictation, generateRhythmicDictation } from '@core/eartraining/dictation.ts'
import { nextDueItemId, recordEarAttempt, type EarAttempt } from '@core/eartraining/session.ts'
import { retentionStats, type RetentionStats } from '@core/srs/scheduler.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import type { AudioOutput, DateSource, Rng } from '@core/ports/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import { addTicks, millis } from '@core/shared/units.ts'
import type { ChordQuality } from '@core/theory/chords.ts'
import type { Interval } from '@core/theory/intervals.ts'
import type { ScaleType } from '@core/theory/scales.ts'

export type EarTrainingPhase = 'idle' | 'playing' | 'answering' | 'graded'

/**
 * One answer, tagged by which drill it is for. Only the four kinds with an
 * on-screen answer pad appear here — `melodic-dictation` and
 * `rhythmic-dictation` can already be generated and played (see
 * `generateItemForKind` below) but have no answer variant yet; see the
 * module's report.
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

export type UseEarTrainingOptions = {
  /** Which drill to draw from. Defaults to `'interval-melodic'`. */
  readonly kind?: EarItemKind
  /** Epoch-ms source for SRS scheduling — see `core/eartraining/session.ts`'s module comment. */
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly rng?: Rng
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
  setKind(kind: EarItemKind): void
  /** Generate (SRS-due, else fresh) and play the next item for the current kind. */
  start(): void
  /** Play the current item again — the core interaction of an ear drill. No-op with no item yet. */
  replay(): void
  answer(answer: EarAnswer): void
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

function gradeAnswerForItem(item: EarItem, answer: EarAnswer): EarGrade {
  switch (answer.kind) {
    case 'interval-melodic':
    case 'interval-harmonic':
      return gradeIntervalAnswer(item, answer.interval, answer.direction ?? 1)
    case 'chord-quality':
      return gradeChordQualityAnswer(item, answer.quality)
    case 'scale-mode':
      return gradeScaleModeAnswer(item, answer.type)
  }
}

/** Schedule every note of `item.prompt` from one `audioOutput.now()` reading. */
function scheduleItem(audioOutput: AudioOutput, item: EarItem): void {
  const tempoMap = makeTempoMap(item.prompt.tempos)
  const baseMs = audioOutput.now()
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

  const [kind, setKindState] = useState<EarItemKind>(options.kind ?? DEFAULT_KIND)
  const [phase, setPhase] = useState<EarTrainingPhase>('idle')
  const [item, setItem] = useState<EarItem | undefined>(undefined)
  const [grade, setGrade] = useState<EarGrade | undefined>(undefined)

  // A new kind always starts idle, with no stale item/grade from the
  // previous drill lingering — mirrors `useFlashcardDrill`'s deck-change
  // reset. SRS state (`session`) is untouched: only which kind `start()`
  // considers next changes.
  useEffect(() => {
    setItem(undefined)
    setGrade(undefined)
    setPhase('idle')
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
    scheduleItem(getAudioOutput(), next)
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
    playItemNow(next)
  }

  function replay(): void {
    if (item === undefined) return
    // Play again without reopening answering: once `phase` is 'graded' the
    // grade is on screen, and re-entering 'answering'/'playing' would let a
    // second answer on the same item record a duplicate EarAttempt while the
    // learner can see the answer. See the review finding this fixes.
    scheduleItem(getAudioOutput(), item)
    if (phase !== 'graded') setPhase('playing')
  }

  function answer(a: EarAnswer): void {
    if (item === undefined) return
    if (phase !== 'answering' && phase !== 'playing') return
    if (item.kind !== a.kind) return

    const now = date.epochMillis()
    const g = gradeAnswerForItem(item, a)
    const attempt: EarAttempt = {
      itemId: item.id,
      kind: item.kind,
      correct: g.correct,
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

  const stats = useMemo(
    () =>
      retentionStats(
        session.cards.filter((c) => session.kinds[c.id] === kind),
        date.epochMillis(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- date is a stable injected port, not reactive state
    [session, kind],
  )

  return {
    phase,
    item,
    grade,
    levels: session.levels,
    stats,
    kind,
    setKind: setKindState,
    start,
    replay,
    answer,
  }
}
