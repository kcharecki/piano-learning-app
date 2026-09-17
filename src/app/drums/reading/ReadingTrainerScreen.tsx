/**
 * The rhythm reading trainer (roadmap DR-11) — a generated one-voice pattern
 * on the percussion staff, tapped on any pad or key. Pad identity is ignored;
 * only onset timing is graded (`useReadingTrainer.tap()` always reports the
 * one voice `generateReadingExercise` puts every note on).
 *
 * The staff draws on the normal five-line percussion staff, on the snare
 * line — the engraver has no one-line mode yet, and building one is not this
 * slice's job (see the roadmap note this shipped against).
 *
 * Thin per the testing rules: what this file owns is wiring and accessible
 * names. The run, the grading, and the level adaptation are
 * `useReadingTrainer`'s job; the words in the result panel are
 * `readingRun.ts`'s.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { GROOVE_PAD_LABEL } from '@app/drums/groove/padLabels.ts'
import { GrooveStaff } from '@app/drums/notation/GrooveStaff.tsx'
import type { PadFlash } from '@app/drums/groove/useGrooveRun.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { describeGroove } from '@core/drums/engrave/describe.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import { MAX_BPM, MIN_BPM } from '@core/drums/practice/plan.ts'
import { describeReadingLevel } from '@core/drums/reading/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { readingResultLines } from './readingRun.ts'
import { useReadingTrainer, type ReadingTrainerApi } from './useReadingTrainer.ts'

/** How long the tap pad stays lit after a hit — the same feel the groove trainer's pads use. */
const PAD_FLASH_MS = 90

export type ReadingTrainerScreenProps = {
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly frameDriver?: FrameDriver
  readonly initialSeed?: number
}

export function ReadingTrainerScreen(props: ReadingTrainerScreenProps) {
  const trainer = useReadingTrainer({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audio === undefined ? {} : { audio: props.audio }),
    ...(props.frameDriver === undefined ? {} : { driver: props.frameDriver }),
    ...(props.initialSeed === undefined ? {} : { initialSeed: props.initialSeed }),
  })

  // The level line names the level of the CURRENT staff (`trainer.level`),
  // which only moves at `next()`. The "Level up/down" line below it, once a
  // run adapts, names the STORE's level — the one `next()` will draw from —
  // because that is the actual, already-decided outcome the sentence reports.
  const storeLevel = useDrumsReadingStore((state) => state.level)

  const layout = useMemo(() => engraveGroove(trainer.score), [trainer.score])
  const staffLabel = useMemo(
    () => describeGroove(trainer.score, (pad) => GROOVE_PAD_LABEL[pad]),
    [trainer.score],
  )

  const run = trainer.run
  const running = run.phase === 'count-in' || run.phase === 'playing'
  const busy = running || run.phase === 'preview'

  useKeyboardTap(trainer.tap, running)
  const lit = useFlash(run.flash)

  const graded = run.result
  const resultLines =
    graded === undefined || trainer.lastAccuracy === undefined
      ? undefined
      : readingResultLines(graded.result, trainer.lastAccuracy)

  const beatsPerBar = trainer.plan.countInBeats / trainer.plan.countInBars
  const activeBeat = running && run.beatIndex >= 0 ? run.beatIndex % beatsPerBar : -1

  return (
    <div className="page page--focus reading-screen">
      <div className="page-header">
        <h1>Rhythm reading</h1>
        <p className="page-header-subtitle">
          One bar of count-in, then the exercise plays through once and is graded.
        </p>
      </div>

      <p role="status" aria-label="Level" className="reading-level">
        {`Level ${trainer.level} — ${trainer.levelText}`}
      </p>

      <div className="card reading-notation">
        <GrooveStaff layout={layout} label={staffLabel} grooveId={trainer.score.id} />
      </div>

      <div className="card reading-stage">
        <TempoField bpm={trainer.bpm} onBpm={trainer.setBpm} disabled={busy} />

        <div className="reading-beats" aria-hidden="true">
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <span key={i} className="beat" data-state={i === activeBeat ? 'active' : undefined} />
          ))}
        </div>

        <div className="reading-transport">
          <button
            type="button"
            className="btn-primary reading-start"
            aria-label={running ? 'Stop' : 'Start'}
            disabled={run.phase === 'preview'}
            onClick={running ? run.stop : run.start}
          >
            <Icon name={running ? 'stop' : 'play'} />
            {running ? 'Stop' : 'Start'}
          </button>

          <button
            type="button"
            className="reading-listen"
            aria-label={run.phase === 'preview' ? 'Stop listening' : 'Listen'}
            disabled={running}
            onClick={run.phase === 'preview' ? run.stop : run.preview}
          >
            <Icon name={run.phase === 'preview' ? 'stop' : 'ear'} />
            {run.phase === 'preview' ? 'Stop listening' : 'Listen'}
          </button>

          <button
            type="button"
            className="reading-next"
            aria-label="Next exercise"
            disabled={busy}
            onClick={trainer.next}
          >
            <Icon name="chevron-right" />
            Next exercise
          </button>
        </div>

        <p role="status" aria-label="Run state" className="reading-run-state">
          {runStateText(run.phase, run.countInBeat, run.bar)}
        </p>

        <button
          type="button"
          className="reading-tap"
          aria-label="Tap"
          data-lit={lit ? 'true' : undefined}
          onPointerDown={trainer.tap}
        >
          Tap
        </button>
      </div>

      {resultLines !== undefined && (
        <section className="card reading-result" aria-label="Result">
          <p className="reading-verdict" data-clean={resultLines.verdict === 'Clean' ? 'true' : 'false'}>
            {resultLines.verdict}
          </p>
          <p className="reading-detail">{resultLines.detail}</p>
          {trainer.levelChanged !== undefined && (
            <p className="reading-level-change" data-direction={trainer.levelChanged}>
              {trainer.levelChanged === 'up' ? 'Level up' : 'Level down'} — {describeReadingLevel(storeLevel)}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function runStateText(phase: ReadingTrainerApi['run']['phase'], countInBeat: number, bar: number): string {
  switch (phase) {
    case 'idle':
      return 'Ready when you are'
    case 'count-in':
      return `Counting in — ${countInBeat}`
    case 'playing':
      return `Playing — bar ${bar}`
    case 'graded':
      return 'Run finished'
    case 'preview':
      return 'Listening — the exercise as written'
  }
}

type TempoFieldProps = {
  readonly bpm: number
  readonly onBpm: (bpm: number) => void
  readonly disabled: boolean
}

/** The same typeable `.stepper` the groove trainer's own `TempoField` uses — see that file for why draft state exists. */
function TempoField({ bpm, onBpm, disabled }: TempoFieldProps) {
  const [draft, setDraft] = useState(String(bpm))
  useEffect(() => {
    setDraft(String(bpm))
  }, [bpm])

  function commit(): void {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isNaN(parsed)) {
      setDraft(String(bpm))
      return
    }
    const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, parsed))
    setDraft(String(clamped))
    onBpm(clamped)
  }

  return (
    <div className="field reading-tempo-field">
      <label htmlFor="reading-tempo">Tempo</label>
      <div className="stepper">
        <button
          type="button"
          aria-label="Slower"
          disabled={disabled || bpm <= MIN_BPM}
          onClick={() => onBpm(bpm - 1)}
        >
          <Icon name="minus" />
        </button>
        <input
          id="reading-tempo"
          className="stepper-value"
          type="number"
          inputMode="numeric"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          disabled={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setDraft(String(bpm))
            }
          }}
        />
        <button
          type="button"
          aria-label="Faster"
          disabled={disabled || bpm >= MAX_BPM}
          onClick={() => onBpm(bpm + 1)}
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  )
}

/** Lights the tap pad for `PAD_FLASH_MS` each time `flash` changes — the "it registered" signal. */
function useFlash(flash: PadFlash | undefined): boolean {
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (flash === undefined) return undefined
    setLit(true)
    const timer = window.setTimeout(() => setLit(false), PAD_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])
  return lit
}

/**
 * Binds the same keys the groove trainer's pads use (`GROOVE_PAD_KEY`'s
 * values: J, K, F, Space) plus Space to a single `tap()` — pad identity is
 * ignored here, so every one of those keys means the same thing. Space is
 * gated on `running`, exactly as the groove trainer gates it, so a learner
 * who started with the mouse does not have their first kick press Stop.
 */
function useKeyboardTap(tap: () => void, running: boolean): void {
  const tapRef = useRef(tap)
  tapRef.current = tap
  const runningRef = useRef(running)
  runningRef.current = running

  useEffect(() => {
    const tapKeys = new Set(['j', 'k', 'f', ' '])
    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (!tapKeys.has(key)) return
      if (key === ' ') {
        if (!runningRef.current) return
        event.preventDefault()
      }
      tapRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
