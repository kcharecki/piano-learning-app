/**
 * The rudiment trainer screen (roadmap DR-10) — pick one of the 40 PAS
 * rudiments, read it off the same percussion staff the groove trainer uses
 * (with sticking letters under it, drawn automatically once the notes carry
 * `sticking` — see `rudimentToScore`), and climb a success-gated tempo ladder
 * in single-pad mode: every key or pad hit is a snare stroke, since a
 * rudiment is one voice, not a kit part.
 *
 * Reuses the groove trainer's whole engine — `useGrooveRun` for count-in,
 * grading and preview, `GrooveStaff`/`engraveGroove`/`describeGroove` for
 * notation — via the bridge `rudimentToScore` builds: a rudiment IS a groove,
 * as many bars as its own stroke count allows (see `rudimentRun.ts`'s
 * `cyclesForBars`). `useRudimentTrainer.ts` is the seam that keeps this
 * component free of grading and ladder logic, the same split
 * `GrooveTrainerScreen`/`useGrooveRun` already hold.
 */
import { useEffect, useRef, useState } from 'react'
import { GrooveStaff } from '@app/drums/notation/GrooveStaff.tsx'
import { GROOVE_PAD_LABEL } from '@app/drums/groove/padLabels.ts'
import { gradedAtText, padLineText } from '@app/drums/groove/resultLines.ts'
import type { GrooveRunPhase, PadFlash } from '@app/drums/groove/useGrooveRun.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsRudimentStore, type RudimentRecord } from '@app/state/drumsRudimentStore.ts'
import { Icon } from '@app/ui/Icon.tsx'
import { RUDIMENTS, rudimentById } from '@content/drums/rudiments.ts'
import { describeGroove } from '@core/drums/engrave/describe.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import type { LadderMode, Rudiment } from '@core/drums/rudiment/index.ts'
import { isEvenEnough } from '@core/drums/rudiment/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { at } from '@core/shared/invariant.ts'
import { RudimentLibrary } from './RudimentLibrary.tsx'
import { evennessText, ladderText, measuresOnly } from './rudimentRun.ts'
import { useRudimentTrainer } from './useRudimentTrainer.ts'

/** The rudiment the trainer opens on — the first thing a learner meets in tier 1. */
const DEFAULT_RUDIMENT_ID = 'single-stroke-roll'

/** How long the Tap pad stays lit — the same figure the groove trainer's own pads use. */
const TAP_FLASH_MS = 90

export type RudimentTrainerScreenProps = {
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly frameDriver?: FrameDriver
  readonly now?: () => number
}

export function RudimentTrainerScreen(props: RudimentTrainerScreenProps) {
  const [selectedId, setSelectedId] = useState(DEFAULT_RUDIMENT_ID)
  const records = useDrumsRudimentStore((state) => state.records)
  const rudiment = rudimentById(selectedId) ?? at(RUDIMENTS, 0)

  return (
    <Trainer
      rudiment={rudiment}
      records={records}
      onSelect={setSelectedId}
      {...(props.clock === undefined ? {} : { clock: props.clock })}
      {...(props.audio === undefined ? {} : { audio: props.audio })}
      {...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver })}
      {...(props.now === undefined ? {} : { now: props.now })}
    />
  )
}

type TrainerProps = {
  readonly rudiment: Rudiment
  readonly records: Readonly<Record<string, RudimentRecord>>
  readonly onSelect: (id: string) => void
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly frameDriver?: FrameDriver
  readonly now?: () => number
}

function Trainer({ rudiment, records, onSelect, ...seams }: TrainerProps) {
  const [mode, setMode] = useState<LadderMode>('up')
  const trainer = useRudimentTrainer({
    rudiment,
    mode,
    ...(seams.clock === undefined ? {} : { clock: seams.clock }),
    ...(seams.audio === undefined ? {} : { audio: seams.audio }),
    ...(seams.frameDriver === undefined ? {} : { driver: seams.frameDriver }),
    ...(seams.now === undefined ? {} : { now: seams.now }),
  })

  const running = trainer.run.phase === 'count-in' || trainer.run.phase === 'playing'
  const previewing = trainer.run.phase === 'preview'
  const busy = running || previewing

  useKeyboardTap(trainer.tap, running)
  const lit = useLit(trainer.run.flash)

  const layout = engraveGroove(trainer.score)
  const staffLabel = describeGroove(trainer.score, (pad) => GROOVE_PAD_LABEL[pad])

  return (
    <div className="page page--focus rudiment-screen">
      <div className="page-header">
        <h1>Rudiments</h1>
        <p className="page-header-subtitle">
          Pick a rudiment, read it off the staff, then climb the tempo ladder one clean pass at a
          time.
        </p>
      </div>

      <div className="card rudiment-trainer">
        <p className="rudiment-title">{rudiment.name}</p>
        <p className="rudiment-meta">
          Tier {rudiment.tier} · {rudiment.family}
        </p>
        <p className="rudiment-transfer">{rudiment.transfer}</p>

        <GrooveStaff layout={layout} label={staffLabel} grooveId={trainer.plan.grooveId} />

        {measuresOnly(rudiment) && (
          <p className="rudiment-honesty-note">
            Graded on onset timing only — bounce and grace-note quality are not measured.
          </p>
        )}

        <p role="status" aria-label="Ladder" className="rudiment-ladder-status">
          {ladderText(trainer.ladder)}
        </p>

        <div className="rudiment-transport">
          <button
            type="button"
            className="btn-primary rudiment-start"
            aria-label={running ? 'Stop' : 'Start'}
            disabled={previewing}
            onClick={running ? trainer.run.stop : trainer.run.start}
          >
            <Icon name={running ? 'stop' : 'play'} />
            {running ? 'Stop' : 'Start'}
          </button>

          <button
            type="button"
            className="rudiment-listen"
            aria-label={previewing ? 'Stop listening' : 'Listen'}
            disabled={running}
            onClick={previewing ? trainer.run.stop : trainer.run.preview}
          >
            <Icon name={previewing ? 'stop' : 'ear'} />
            {previewing ? 'Stop listening' : 'Listen'}
          </button>

          <button
            type="button"
            className="rudiment-restart"
            aria-label="Restart ladder"
            disabled={busy}
            onClick={trainer.restart}
          >
            Restart ladder
          </button>
        </div>

        <div
          role="radiogroup"
          aria-label="Ladder mode"
          className="rudiment-mode-toggle seg-control"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'up'}
            disabled={busy}
            onClick={() => setMode('up')}
          >
            Up
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'up-then-down'}
            disabled={busy}
            onClick={() => setMode('up-then-down')}
          >
            Up then down
          </button>
        </div>

        <button
          type="button"
          className="rudiment-tap-pad"
          aria-label="Tap"
          data-lit={lit ? 'true' : undefined}
          onPointerDown={trainer.tap}
        >
          Tap
        </button>

        <p role="status" aria-label="Run state" className="rudiment-run-state">
          {runStateText(
            trainer.run.phase,
            trainer.run.countInBeat,
            trainer.run.bar,
            trainer.plan.gradedBars,
          )}
        </p>

        {trainer.run.result !== undefined && trainer.lastClean !== undefined && (
          <section className="card rudiment-result" aria-label="Result">
            <p
              className="rudiment-verdict"
              data-clean={trainer.lastClean === true ? 'true' : 'false'}
            >
              {trainer.lastClean === true ? 'Clean pass' : 'Not clean'}
            </p>
            <p className="rudiment-graded-at">{gradedAtText(trainer.run.result.bpm)}</p>
            {trainer.lastEvenness !== undefined && (
              <p
                className="rudiment-evenness"
                data-even={isEvenEnough(trainer.lastEvenness) ? 'true' : 'false'}
              >
                {evennessText(trainer.lastEvenness)}
              </p>
            )}
            <ul className="rudiment-pad-lines">
              {trainer.run.result.result.pads.map((row) => (
                <li key={row.pad}>{padLineText(row)}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <RudimentLibrary selectedId={rudiment.id} records={records} onSelect={onSelect} />
    </div>
  )
}

function runStateText(
  phase: GrooveRunPhase,
  countInBeat: number,
  bar: number,
  gradedBars: number,
): string {
  switch (phase) {
    case 'idle':
      return 'Ready when you are'
    case 'count-in':
      return `Counting in — ${countInBeat}`
    case 'playing':
      return `Playing — bar ${bar} of ${gradedBars}`
    case 'graded':
      return 'Run finished'
    case 'preview':
      return 'Listening — the pattern as written'
    default:
      return ''
  }
}

/** Lights the Tap pad for `TAP_FLASH_MS` each time `flash` changes. */
function useLit(flash: PadFlash | undefined): boolean {
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (flash === undefined) return undefined
    setLit(true)
    const timer = window.setTimeout(() => setLit(false), TAP_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])
  return lit
}

/** Navigation/activation keys left alone so the screen's own buttons stay keyboard-operable — see `useKeyboardTap`. */
const TAP_EXCLUDED_KEYS = new Set([
  'Tab',
  'Enter',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
])

/**
 * Single-pad mode (roadmap DR-10): the persona has no e-kit and this trainer
 * grades one voice, so every key is the snare — unlike the groove trainer's
 * per-pad key map. Navigation/activation keys are left alone (Tab, Enter, the
 * arrows, Escape, the modifiers) so this screen's own buttons — Practise,
 * Restart ladder, the mode toggle — stay keyboard-operable; Space is further
 * gated on `running`, the same reason `GrooveTrainerScreen`'s own key handler
 * gates it: pressing Space to START the run must not also register as the
 * run's first stroke. "Any key" in the DR-10 brief is read as "any key that
 * is not already spoken for by this screen's own controls" — flagged as a
 * judgment call in the delivery notes.
 */
function useKeyboardTap(tap: () => void, running: boolean): void {
  const tapRef = useRef(tap)
  tapRef.current = tap
  const runningRef = useRef(running)
  runningRef.current = running

  useEffect(() => {
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
      if (TAP_EXCLUDED_KEYS.has(event.key)) return
      if (event.key === ' ' && !runningRef.current) return
      event.preventDefault()
      tapRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
