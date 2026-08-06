/**
 * Real-time note feedback (roadmap REQ-3.3.2) — the piece that was missing
 * entirely: it owns a `NoteMatcher` for the current score, feeds it the
 * learner's MIDI presses and the transport's advancing position, and drives
 * the `ScoreViewer` handle to colour each note as it is judged.
 *
 * ## Staying off the render path (REQ-4.1, <100 ms visual feedback)
 *
 * Colouring happens the same way the cursor moves in `usePracticeEngine`:
 * imperatively, through the `ScoreViewerHandle` ref, never through props or
 * state. The trick used here is the same shape as that hook's `onFrame` —
 * this hook hands back a SECOND `ScoreViewerHandle`-shaped ref (`cursorRef`)
 * for the caller to give to `usePracticeEngine` INSTEAD of the real one.
 * `usePracticeEngine` already calls `moveCursorTo` on its `scoreViewerRef`
 * every animation frame — by intercepting that call we get the transport's
 * advancing tick position for free, with no extra subscription and no
 * dependency on `usePracticeEngine` (which this file does not own and must
 * not import from). Every intercepted call is forwarded to the real handle
 * afterwards, so the visible cursor is unaffected.
 *
 * ## Turning a tick into a matcher millisecond
 *
 * `NoteMatcher` wants every time in the `Clock` port's epoch (see the
 * matcher's own module comment: MIDI timestamps already share that origin).
 * `usePracticeEngine`'s transport is not reachable from here, so this hook
 * builds its own tick -> ms mapping with the WRITTEN tempo (`makeTempoMap`
 * with no scale) and re-anchors it to the `Clock` on every intercepted
 * `moveCursorTo` call: `anchor = { realMs: clock.now(), matcherMs:
 * tickToMs(tempo, tick) }`. Because that pair is resampled from the ACTUAL
 * tick every frame (about once per 16 ms, far inside the matcher's default
 * 150 ms tolerance), neither the practice-tempo slider nor pausing/seeking
 * has to be tracked explicitly for the anchor to stay accurate — only the
 * short gap between frames is ever extrapolated, using `anchor.matcherMs +
 * (eventTime - anchor.realMs)`.
 *
 * ## Discontinuities
 *
 * A loop wrap (or any future seek) shows up here as the observed tick going
 * backwards between two `moveCursorTo` calls — the transport has no other way
 * to signal it to a caller that only sees the cursor. On that, the matcher is
 * reset and the score's colouring cleared: the pending verdicts described a
 * pass that just ended.
 *
 * The transport simply STOPPING is deliberately NOT handled the same way.
 * `usePracticeEngine` does not pump frames while stopped, so a backward jump
 * can never be observed through `moveCursorTo` for that case — but that is
 * incidental, not the reason: a stop ENDS a run, and the whole point of the
 * counters is to be readable once it has (roadmap 2.14 needs a replay's
 * counters to be comparable against the live take's, which is impossible if
 * the take's result is wiped the instant it stops). So the caller
 * (`PracticeScreen`) does not call `clear()` on stop at all — it calls it when
 * the NEXT run STARTS, i.e. when `phase` enters `'playing'` or `'waiting'`
 * FROM `'stopped'`, which is also what a loop wrap's mid-run reset above is
 * really standing in for while the run is still live. (`phase` cannot be read
 * in here directly: `usePracticeEngine` needs `cursorRef` to construct itself,
 * which needs this hook to exist first — a real circular dependency, not just
 * a type one.)
 *
 * "Does not pump frames while stopped" held only up to roadmap 2.14's replay
 * feature: `useRecorder`'s replay-end path calls the engine's `stop()`
 * synchronously from ITS OWN `useTransportLoop` frame, which can land in the
 * SAME animation frame as this engine's own already-scheduled `onFrame` —
 * `Transport.stop()` rewinds `positionTicks` before that second callback
 * reads it, so `moveCursorTo` WAS still being called, with tick 0, after a
 * stop. `usePracticeEngine`'s `onFrame` now guards against exactly that (see
 * its module comment), which is what makes the claim above true rather than
 * merely intended; this hook still cannot see `phase` to defend itself, so
 * the guard has to live on the other side of the ref.
 *
 * A rebuilt matcher (new score, or the active hands change) has the same
 * problem in miniature and is handled the same way: clear, then start fresh.
 *
 * A loop over a range in the MIDDLE of the score restarts the matcher AT the
 * tick jumped to (roadmap 1.22): `reset(fromTick)` retires everything written
 * before the loop start silently, so a wrap does not report every note in the
 * bars ahead of the loop as `missed` in one batch.
 */
import type { ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import type { Hand, Score } from '@core/notation/score.ts'
import type { Clock, MidiInput } from '@core/ports/index.ts'
import {
  NoteMatcher,
  type MatchResult,
  type MatchSummary,
  type NoteVerdict,
} from '@core/practice/matcher.ts'
import { makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { millis as asMillis, ticks as asTicks, type Midi } from '@core/shared/units.ts'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type NoteFeedbackOptions = {
  readonly score: Score | undefined
  /** Muted hands never expect a press — kept in step with the transport's own filtering. */
  readonly activeHands: readonly Hand[]
  readonly midiInput: MidiInput | undefined
  readonly clock: Clock
  /** The ref actually attached to `<ScoreViewer ref={...}>`. */
  readonly scoreViewerRef: RefObject<ScoreViewerHandle | null>
}

/** REQ-3.3.2 timing readout for the most recent attributed press. */
export type Judgement = {
  readonly midi: Midi
  readonly timing: 'early' | 'late' | 'on-time'
  /** Signed, straight from the matcher: negative early, positive late. */
  readonly deviationMs: number
  readonly correct: boolean
}

export type NoteFeedback = {
  /** Running accuracy and per-verdict counts, for a small live panel. */
  readonly summary: MatchSummary
  /**
   * The most recent press the matcher attributed to an expected note
   * (`correct` or `wrongPitch` — a `missed` or `extra` verdict leaves this
   * unchanged, since neither is an attributed press). Cleared on `clear()`
   * and on a loop wrap, exactly as `summary` is.
   */
  readonly lastJudgement: Judgement | undefined
  /** Pass this to `usePracticeEngine`'s `scoreViewerRef` option instead of the real one. */
  readonly cursorRef: RefObject<ScoreViewerHandle | null>
  /**
   * Forget every verdict and clear the score's colouring. Call when a NEW run
   * STARTS, not when one ends — see the module comment's "Discontinuities"
   * section for why the counters must survive a stop.
   */
  readonly clear: () => void
}

/**
 * Kept in step with `--fb-correct-ink` / `--fb-wrong-ink` / `--fb-missed-ink`
 * in src/design-system/tokens/colors.css — the notation frame is a paper
 * surface, so feedback notes use the paper-ink ramp, not the bright shell
 * variants meant for the dark background around it.
 */
const CORRECT_COLOR = '#1c7c3c'
const WRONG_PITCH_COLOR = '#c22f2c'
const MISSED_COLOR = '#666e78'

const EMPTY_SUMMARY: MatchSummary = {
  correct: 0,
  wrongPitch: 0,
  missed: 0,
  extra: 0,
  accuracy: 1,
  meanAbsDeviationMs: 0,
}

type Anchor = { readonly realMs: number; readonly matcherMs: number }

function colorForVerdict(verdict: NoteVerdict): string | undefined {
  switch (verdict) {
    case 'correct':
      return CORRECT_COLOR
    case 'wrongPitch':
      return WRONG_PITCH_COLOR
    case 'missed':
      return MISSED_COLOR
    case 'extra':
      return undefined
  }
}

/**
 * The last result in this batch that was attributed to an expected note
 * (`correct` or `wrongPitch` — the only verdicts the matcher gives a
 * `timing`/`deviationMs`), or `undefined` if none of them were. `missed` and
 * `extra` results in the same batch are deliberately skipped rather than
 * clearing the judgement — see `NoteFeedback.lastJudgement`'s doc comment.
 */
function lastAttributed(results: readonly MatchResult[]): Judgement | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i]
    if (
      result === undefined ||
      result.timing === undefined ||
      result.deviationMs === undefined ||
      result.playedMidi === undefined
    )
      continue
    return {
      midi: result.playedMidi,
      timing: result.timing === 'onTime' ? 'on-time' : result.timing,
      deviationMs: result.deviationMs,
      correct: result.verdict === 'correct',
    }
  }
  return undefined
}

export function useNoteFeedback(options: NoteFeedbackOptions): NoteFeedback {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const matcherRef = useRef<NoteMatcher | undefined>(undefined)
  const tempoMapRef = useRef<TempoMap | undefined>(undefined)
  const anchorRef = useRef<Anchor | undefined>(undefined)
  const lastTickRef = useRef(0)
  const [summary, setSummary] = useState<MatchSummary>(EMPTY_SUMMARY)
  const [lastJudgement, setLastJudgement] = useState<Judgement | undefined>(undefined)

  const applyResults = useCallback((results: readonly MatchResult[]): void => {
    const matcher = matcherRef.current
    if (matcher === undefined || results.length === 0) return
    const handle = optionsRef.current.scoreViewerRef.current
    for (const result of results) {
      if (result.expected === undefined) continue
      const color = colorForVerdict(result.verdict)
      if (color !== undefined) handle?.setNoteColor(result.expected.id, color)
    }
    setSummary(matcher.summary())
    const judgement = lastAttributed(results)
    if (judgement !== undefined) setLastJudgement(judgement)
  }, [])

  const clear = useCallback((): void => {
    matcherRef.current?.reset()
    anchorRef.current = undefined
    lastTickRef.current = 0
    setSummary(EMPTY_SUMMARY)
    setLastJudgement(undefined)
    optionsRef.current.scoreViewerRef.current?.clearNoteColors()
  }, [])

  // Rebuild the matcher when the score or the active hands change — a fresh
  // score, or a different mute pattern, makes prior verdicts meaningless.
  useEffect(() => {
    optionsRef.current.scoreViewerRef.current?.clearNoteColors()
    if (options.score === undefined) {
      matcherRef.current = undefined
      tempoMapRef.current = undefined
    } else {
      const tempo = makeTempoMap(options.score.tempos)
      tempoMapRef.current = tempo
      matcherRef.current = new NoteMatcher(options.score, tempo, { hands: options.activeHands })
    }
    anchorRef.current = undefined
    lastTickRef.current = 0
    setSummary(EMPTY_SUMMARY)
    setLastJudgement(undefined)
  }, [options.score, options.activeHands])

  // Judge the learner's presses as they arrive. See the module comment for why
  // `event.time` and `anchor.realMs` are directly comparable.
  useEffect(() => {
    if (options.midiInput === undefined) return undefined
    return options.midiInput.onEvent((event) => {
      const matcher = matcherRef.current
      const anchor = anchorRef.current
      if (matcher === undefined || anchor === undefined) return
      const estimated = asMillis(anchor.matcherMs + (event.time - anchor.realMs))
      if (event.type === 'noteOn') applyResults(matcher.noteOn(event.note, estimated))
      else if (event.type === 'noteOff') matcher.noteOff(event.note, estimated)
    })
  }, [options.midiInput, applyResults])

  const cursorRef = useRef<ScoreViewerHandle | null>(null)
  if (cursorRef.current === null) {
    cursorRef.current = {
      moveCursorTo(measureIndex, tick) {
        const { scoreViewerRef, clock } = optionsRef.current
        const tempo = tempoMapRef.current
        const matcher = matcherRef.current
        if (tempo !== undefined && matcher !== undefined) {
          const matcherMs = tickToMs(tempo, asTicks(tick))
          if (tick < lastTickRef.current) {
            // A backward jump: a loop wrap, or a future seek. The pass that
            // was in progress is over — see the module comment. Restarting AT
            // the destination tick, not at bar one, is what stops a loop over
            // bars 3-4 charging the learner for bars 1-2 on every wrap.
            matcher.reset(asTicks(tick))
            scoreViewerRef.current?.clearNoteColors()
            setSummary(EMPTY_SUMMARY)
            setLastJudgement(undefined)
          } else {
            applyResults(matcher.advanceTo(matcherMs))
          }
          anchorRef.current = { realMs: clock.now(), matcherMs }
          lastTickRef.current = tick
        }
        scoreViewerRef.current?.moveCursorTo(measureIndex, tick)
      },
      setNoteColor(noteId, color) {
        optionsRef.current.scoreViewerRef.current?.setNoteColor(noteId, color)
      },
      clearNoteColors() {
        optionsRef.current.scoreViewerRef.current?.clearNoteColors()
      },
      setNoteHidden(noteId, hidden) {
        optionsRef.current.scoreViewerRef.current?.setNoteHidden(noteId, hidden)
      },
      clearHiddenNotes() {
        optionsRef.current.scoreViewerRef.current?.clearHiddenNotes()
      },
    }
  }

  return { summary, lastJudgement, cursorRef, clear }
}
