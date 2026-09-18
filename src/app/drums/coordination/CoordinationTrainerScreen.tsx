/**
 * The coordination trainer (roadmap DR-15) — four drills built on the same
 * groove-run engine `GrooveTrainerScreen` uses, for the problem that screen
 * does not solve: a learner who cannot yet hold a whole groove together
 * meets it one limb at a time (Layer build), or isolates the one thing that
 * makes a beat feel syncopated — where the kick lands against a steady
 * hat/snare backbone, one placement at a time (Kick permutations), or two
 * placements at once (Two kicks) — or moves the timekeeping to the ride and
 * the foot to the hi-hat pedal, building the groove back up underneath that
 * new foundation (Hi-hat foot).
 *
 * All four drills share one shape: a numbered list of steps, each its own
 * `GrooveScore`/plan/run, unlocking left to right as a pass comes back
 * steady. `useCoordinationTrainer` (see its own module comment) owns that
 * state; this file is presentation, mirroring `GrooveTrainerScreen`'s own
 * split between staff-as-statement-of-the-task, pads, and a per-limb result
 * panel — copying its established wording and layout rather than inventing
 * a second style for the same kind of screen.
 *
 * ## Two things this file deliberately does NOT match verbatim
 *
 * `.btn-secondary` and a `.radiogroup` class do not exist anywhere in this
 * codebase — `primitives.css`'s own comment says a bare `<button>` is the
 * app's actual "secondary" convention, and the real reusable pattern for a
 * mutually-exclusive picker is `.seg-control` with `role="radiogroup"` /
 * `role="radio"` (`DrumsMetronomeScreen.tsx`). Both are used here instead.
 *
 * The Drill mode picker uses `.seg-control`. The Start/Stop transport control
 * follows `GrooveTrainerScreen.tsx`'s own established pattern instead: ONE
 * `.btn-primary` whose label and icon swap between "Start" and "Stop", not a
 * primary Start beside a separately-styled bare-button Stop — that screen
 * never renders Stop any other way, and a coordination-only exception here
 * would be a second answer to "what does Stop look like" for no reason.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { DrumKey } from '@app/drums/notation/DrumKey.tsx'
import { GrooveStaff } from '@app/drums/notation/GrooveStaff.tsx'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { describeGroove } from '@core/drums/engrave/describe.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { Clock, DrumAudioOutput, MidiInput } from '@core/ports/index.ts'
import { useDrumMidiInput } from '@app/drums/input/useDrumMidiInput.ts'
import { LOCAL_INPUT_ID, offsetFor, useDrumsLatencyStore } from '@app/state/drumsLatencyStore.ts'
import { Pad, TempoField } from '@app/drums/groove/GrooveControls.tsx'
import { useFlash, useKeyboardPads } from '@app/drums/groove/groovePadHooks.ts'
import { GROOVE_PAD_KEY, GROOVE_PAD_LABEL, keyLabel, sortPadsForDisplay } from '@app/drums/groove/padLabels.ts'
import { padLineText } from '@app/drums/groove/resultLines.ts'
import type { GrooveRunPhase } from '@app/drums/groove/useGrooveRun.ts'
import type { DrillMode } from './coordinationRun.ts'
import { useCoordinationTrainer } from './useCoordinationTrainer.ts'

export type CoordinationTrainerScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly frameDriver?: FrameDriver
  /** A ready-made e-kit MIDI input (roadmap DR-02); defaults to Web MIDI through `useMidiConnection`. */
  readonly midiInput?: MidiInput
}

const MODE_OPTIONS: ReadonlyArray<{ readonly value: DrillMode; readonly label: string }> = [
  { value: 'layers', label: 'Layer build' },
  { value: 'kicks', label: 'Kick permutations' },
  { value: 'kicks2', label: 'Two kicks' },
  { value: 'hhFoot', label: 'Hi-hat foot' },
]

/** Every groove the picker offers — the library itself never changes at runtime. */
const GROOVE_OPTIONS = grooveTrainerLibrary().map((g) => ({ id: g.id, title: g.title }))

export function CoordinationTrainerScreen(props: CoordinationTrainerScreenProps) {
  // Same e-kit join as `GrooveTrainerScreen` (roadmap DR-02): a real stroke
  // lands on `run.hit` exactly like a pad tap or a key press. The hook is
  // mounted BEFORE the trainer because the run needs to know which input is
  // live: the rig's stored latency offset (roadmap DR-08) is keyed by the
  // e-kit's device id, or `LOCAL_INPUT_ID` for the pads and keys. `run.hit`
  // does not exist yet at this point, so the kit lands on a ref the effect
  // below keeps current — the same one-render-late discipline the hook
  // itself uses for `onHit`.
  const hitRef = useRef<(pad: MappedDrumPad) => void>(() => {})
  const ekit = useDrumMidiInput({
    onHit: (pad) => hitRef.current(pad),
    ...(props.midiInput === undefined ? {} : { midiInput: props.midiInput }),
  })
  const inputId = ekit.deviceId ?? LOCAL_INPUT_ID
  const inputOffsetMs = useDrumsLatencyStore((state) => offsetFor(state, inputId))

  const trainer = useCoordinationTrainer({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audio === undefined ? {} : { audio: props.audio }),
    ...(props.frameDriver === undefined ? {} : { driver: props.frameDriver }),
    inputOffsetMs,
  })
  const { mode, groove, steps, index, unlocked, plan, run } = trainer
  useEffect(() => {
    hitRef.current = run.hit
  }, [run.hit])

  const step = steps[index]

  // Same discipline as `GrooveTrainerScreen`: the figure states one bar, the
  // run grades `plan.gradedBars`, so a one-bar step drawn once while two bars
  // are graded would understate the task.
  const playCount = step === undefined ? 1 : Math.max(1, Math.ceil(plan.gradedBars / step.score.measures.length))
  const layout = useMemo(
    () => (step === undefined ? undefined : engraveGroove(step.score, { playCount })),
    [step, playCount],
  )
  const staffLabel = useMemo(
    () =>
      step === undefined
        ? ''
        : describeGroove(step.score, (pad) => GROOVE_PAD_LABEL[pad], { playCount }),
    [step, playCount],
  )

  const running = run.phase === 'count-in' || run.phase === 'playing'
  const busy = running || run.phase === 'preview'

  const pads = useMemo(
    () => sortPadsForDisplay(plan.pads, (padPlan) => padPlan.pad).map((padPlan) => padPlan.pad),
    [plan],
  )
  useKeyboardPads(pads, run.hit, running)
  const lit = useFlash(run.flash)

  const resultRows = useMemo(
    () => (run.result === undefined ? [] : sortPadsForDisplay(run.result.result.pads, (row) => row.pad)),
    [run.result],
  )

  return (
    <div className="page page--focus coordination-screen">
      <div className="page-header">
        <h1>Coordination</h1>
        <p className="page-header-subtitle">
          Build a groove one limb at a time, or move one kick — then two — through the bar against a steady backbone.
        </p>
      </div>

      <div className="card coordination-seg-field">
        <span className="coordination-field-label" aria-hidden="true">
          Drill
        </span>
        <div className="seg-control" role="radiogroup" aria-label="Drill">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              disabled={busy}
              onClick={() => trainer.setMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {(mode === 'layers' || mode === 'hhFoot') && (
        <div className="card field coordination-groove-field">
          <label htmlFor="coordination-groove-select">Groove</label>
          <select
            id="coordination-groove-select"
            aria-label="Groove"
            disabled={busy}
            value={groove.id}
            onChange={(event) => trainer.setGroove(event.target.value)}
          >
            {GROOVE_OPTIONS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <ol className="card coordination-steps" aria-label="Steps">
        {steps.map((s) => (
          <li key={s.index}>
            <button
              type="button"
              disabled={busy || s.index > unlocked}
              aria-current={s.index === index ? 'step' : undefined}
              onClick={() => trainer.select(s.index)}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      {layout !== undefined && (
        <div className="card groove-notation">
          <GrooveStaff layout={layout} label={staffLabel} grooveId={plan.grooveId} />
          <DrumKey
            layout={layout}
            labelFor={(pad) => GROOVE_PAD_LABEL[pad]}
            keyFor={(pad) => {
              const key = GROOVE_PAD_KEY[pad]
              return key === undefined ? undefined : keyLabel(key)
            }}
          />
        </div>
      )}

      <div className="card groove-stage">
        <TempoField bpm={trainer.bpm} onBpm={trainer.setBpm} disabled={busy} />

        <div className="groove-transport">
          <button
            type="button"
            className="btn-primary groove-start"
            aria-label={running ? 'Stop' : 'Start'}
            disabled={run.phase === 'preview'}
            onClick={running ? run.stop : run.start}
          >
            <Icon name={running ? 'stop' : 'play'} />
            {running ? 'Stop' : 'Start'}
          </button>
        </div>

        <p role="status" aria-label="Run state" className="groove-run-state">
          {runStateText(run.phase, run.countInBeat, run.bar, plan.gradedBars)}
        </p>

        <p role="status" aria-label="E-kit" className="groove-ekit">
          {ekit.statusText}
        </p>
      </div>

      <div className="groove-pads">
        {pads.map((pad) => (
          <Pad key={pad} pad={pad} lit={lit === pad} onHit={run.hit} />
        ))}
      </div>

      {run.result !== undefined && (
        <section className="card groove-result" aria-label="Result">
          <p className="groove-verdict" data-steady={run.result.result.steady ? 'true' : 'false'}>
            {run.result.result.steady ? 'Steady — next step unlocked' : 'Not steady yet — try again'}
          </p>
          <ul className="groove-pad-lines">
            {resultRows.map((row) => (
              <li key={row.pad}>{padLineText(row)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function runStateText(phase: GrooveRunPhase, countInBeat: number, bar: number, gradedBars: number): string {
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
      return 'Listening — the groove as written'
  }
}
