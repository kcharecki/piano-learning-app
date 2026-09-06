/**
 * The groove trainer (roadmap DR-09/T.17) — the first drum screen that
 * actually teaches something.
 *
 * A learner picks one of three grooves, reads it off the staff, sets a tempo,
 * gets a bar of count-in and then plays two graded bars on the pads. The
 * result names **each limb separately**: its own count and its own mean
 * offset. "You were off" is the failure mode this screen exists to avoid, so
 * every sentence it prints attributes the problem to a pad.
 *
 * ## The staff is the statement of the task (DR-05)
 *
 * This screen shipped without one, and graded a pattern it never stated. Two
 * standard readings of its own title `Money Beat (Open Hat)` exist; driving it
 * proved the app grades one of them, states neither, and after a wrong guess
 * reports `Open hi-hat — 0 of 2, 2 missed, 2 extra` without ever disclosing
 * where the hat actually opens. So the staff sits directly under the title and
 * above the transport, and it is engraved from the same `GrooveScore` the
 * grader plans from — the picture and the marking cannot disagree, because
 * there is only one source for both.
 *
 * ## The persona has no e-kit
 *
 * Everything is reachable by mouse and by keyboard: J is the hi-hat (right
 * hand), K the open hat, F the snare (left hand), Space the kick (right
 * foot). Pads dispatch on `pointerdown`, not `click` — a drum stroke happens
 * when the stick lands, and waiting for mouseup adds the learner's own release
 * time to every measurement.
 *
 * ## Space is only taken away while a run is on (T.17.4)
 *
 * Starting with the mouse leaves the Start/Stop button focused. If Space were
 * bound unconditionally the learner's first kick would either press Stop or
 * fight the browser's own activation. So the Space binding is checked against
 * the run phase: outside a run Space belongs to whatever has focus, and inside
 * one it is the kick and its default is prevented. The letter keys have no
 * default to steal and stay live throughout, which is also what makes the
 * "tap a pad and see if it lights up" advice on an empty run actionable.
 *
 * ## What is deliberately NOT here
 *
 * No tempo ramp. The rebuild brief lists one (T.17.6), and a ramp that reads
 * only evenness is worse than none — see `grade.ts` on why a run-long average
 * hides a growing limb offset. A ramp needs per-step verdicts across several
 * runs, which is its own slice; this screen grades one tempo at a time and
 * says so.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { GrooveStaff } from '@app/drums/notation/GrooveStaff.tsx'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { describeGroove } from '@core/drums/engrave/describe.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import type { StaffLayout } from '@core/drums/engrave/layout.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import { MAX_BPM, MIN_BPM, planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { AudioOutput, Clock } from '@core/ports/index.ts'
import { GROOVE_PAD_KEY, GROOVE_PAD_LABEL, keyLabel, sortPadsForDisplay } from './padLabels.ts'
import { diagnosisSentences, lastRunText, padLineText, verdictText } from './resultLines.ts'
import { useGrooveRun, type GrooveRunPhase, type PadFlash } from './useGrooveRun.ts'

/** The persona's goal tempo for the Debut rock groove, and the tempo the screen opens on. */
const DEFAULT_BPM = 80

/** How long a struck pad stays lit. Long enough to see at sixteenths, short enough not to smear. */
const PAD_FLASH_MS = 90

export type GrooveTrainerScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audio?: () => AudioOutput
  readonly frameDriver?: FrameDriver
}

export function GrooveTrainerScreen(props: GrooveTrainerScreenProps) {
  const library = useMemo(() => grooveTrainerLibrary(), [])
  const [grooveIndex, setGrooveIndex] = useState(0)
  const [bpm, setBpm] = useState(DEFAULT_BPM)

  // `grooveTrainerLibrary` is typed non-empty, so `library[0]` is a real
  // groove and the picker needs no "nothing installed" branch.
  const groove = library[grooveIndex] ?? library[0]
  const plan = useMemo(() => planGrooveRun(groove, bpm), [groove, bpm])

  // The staff and its spoken description are both derived from the same
  // `GrooveScore` the grader plans its run from, so the picture, the sentence
  // and the marking can never describe three different patterns. That is the
  // whole point: before this, the screen's entire statement of the task was
  // its title, and two standard readings of "Money Beat (Open Hat)" scored
  // 2 of 2 and 0 of 2 against a grader that named neither.
  const layout = useMemo(() => engraveGroove(groove), [groove])
  const staffLabel = useMemo(
    () => describeGroove(groove, (pad) => GROOVE_PAD_LABEL[pad]),
    [groove],
  )

  const attempts = useDrumsHistoryStore((state) => state.attempts)
  const addAttempt = useDrumsHistoryStore((state) => state.addAttempt)
  const lastRun = attempts[0]

  const onFinished = useCallback(
    (result: GrooveRunResult): void => {
      addAttempt({
        grooveId: plan.grooveId,
        grooveTitle: plan.title,
        bpm: plan.bpm,
        at: Date.now(),
        steady: result.steady,
        pads: result.pads.map((row) => ({
          pad: row.pad,
          expected: row.expected,
          matched: row.matched,
          ...(row.meanOffsetMs === undefined ? {} : { meanOffsetMs: row.meanOffsetMs }),
        })),
      })
    },
    [addAttempt, plan],
  )

  return (
    <Trainer
      plan={plan}
      layout={layout}
      staffLabel={staffLabel}
      bpm={bpm}
      onBpm={setBpm}
      onStep={(delta) => setGrooveIndex((i) => (i + delta + library.length) % library.length)}
      onFinished={onFinished}
      lastRunLine={
        lastRun === undefined
          ? undefined
          : lastRunText(lastRun.grooveTitle, lastRun.bpm, lastRun.steady)
      }
      {...(props.clock === undefined ? {} : { clock: props.clock })}
      {...(props.audio === undefined ? {} : { audio: props.audio })}
      {...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver })}
    />
  )
}

type TrainerProps = {
  readonly plan: GrooveRunPlan
  /** Engraved upstream, where the `GrooveScore` lives — `Trainer` stays presentational. */
  readonly layout: StaffLayout
  readonly staffLabel: string
  readonly bpm: number
  readonly onBpm: (bpm: number) => void
  readonly onStep: (delta: number) => void
  readonly onFinished: (result: GrooveRunResult) => void
  readonly lastRunLine: string | undefined
  readonly clock?: Clock
  readonly audio?: () => AudioOutput
  readonly frameDriver?: FrameDriver
}

function Trainer({
  plan,
  layout,
  staffLabel,
  bpm,
  onBpm,
  onStep,
  onFinished,
  lastRunLine,
  ...seams
}: TrainerProps) {
  const run = useGrooveRun({
    plan,
    onFinished,
    ...(seams.clock === undefined ? {} : { clock: seams.clock }),
    ...(seams.audio === undefined ? {} : { audio: seams.audio }),
    ...(seams.frameDriver === undefined ? {} : { driver: seams.frameDriver }),
  })
  const running = run.phase === 'count-in' || run.phase === 'playing'

  const pads = useMemo(
    () => sortPadsForDisplay(plan.pads, (padPlan) => padPlan.pad).map((padPlan) => padPlan.pad),
    [plan],
  )

  useKeyboardPads(pads, run.hit, running)
  const lit = useFlash(run.flash)

  const resultRows = useMemo(
    () => (run.result === undefined ? [] : sortPadsForDisplay(run.result.pads, (row) => row.pad)),
    [run.result],
  )
  const diagnosis = run.result === undefined ? [] : diagnosisSentences(run.result, plan)

  const beatsPerBar = Math.max(1, Math.round(plan.barMs / plan.beatMs))
  const activeBeat = running && run.beatIndex >= 0 ? run.beatIndex % beatsPerBar : -1

  return (
    <div className="page page--focus groove-screen">
      <div className="page-header">
        <h1>Groove trainer</h1>
        <p className="page-header-subtitle">
          One bar of count-in, then {plan.gradedBars} bars graded. Each limb is timed on its own.
        </p>
      </div>

      <div className="card groove-picker">
        <button
          type="button"
          className="btn-icon"
          aria-label="Previous groove"
          disabled={running}
          onClick={() => onStep(-1)}
        >
          <Icon name="chevron-left" />
        </button>
        <div className="groove-picker-text">
          <p className="groove-title">{plan.title}</p>
          <p className="groove-meta">
            at {plan.bpm} bpm · a hit counts within {Math.round(plan.windowMs)} ms
          </p>
        </div>
        <button
          type="button"
          className="btn-icon"
          aria-label="Next groove"
          disabled={running}
          onClick={() => onStep(1)}
        >
          <Icon name="chevron-right" />
        </button>
      </div>

      {/* The statement of the task, directly under the title and above the
          transport: everything below this is HOW you attempt the task, and
          until now the screen had no place that said WHAT the task was. */}
      <div className="card groove-notation">
        <GrooveStaff layout={layout} label={staffLabel} grooveId={plan.grooveId} />
      </div>

      <div className="card groove-stage">
        <TempoField bpm={bpm} onBpm={onBpm} disabled={running} />

        <div className="groove-beats" aria-hidden="true">
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <span key={i} className="beat" data-state={i === activeBeat ? 'active' : undefined} />
          ))}
        </div>

        <button
          type="button"
          className="btn-primary groove-start"
          aria-label={running ? 'Stop' : 'Start'}
          onClick={running ? run.stop : run.start}
        >
          <Icon name={running ? 'stop' : 'play'} />
          {running ? 'Stop' : 'Start'}
        </button>

        <p role="status" aria-label="Run state" className="groove-run-state">
          {runStateText(run.phase, run.countInLeft, run.bar, plan.gradedBars)}
        </p>
      </div>

      <div className="groove-pads">
        {pads.map((pad) => (
          <Pad key={pad} pad={pad} lit={lit === pad} onHit={run.hit} />
        ))}
      </div>

      <p className="groove-key-hint">
        No kit? J is the hi-hat, K the open hat, F the snare and Space the kick — right hand, right
        hand, left hand, right foot.
      </p>

      {/* The summary of the PREVIOUS session, for a learner arriving fresh. Once this
          run has its own result panel the line is stale by definition, and printing
          both put two verdicts on screen at once — the visual pass caught it saying
          "not there yet" twice, a paragraph apart. */}
      {lastRunLine !== undefined && run.result === undefined && (
        <p className="groove-last-run">{lastRunLine}</p>
      )}

      {run.result !== undefined && (
        <section className="card groove-result" aria-label="Result">
          <p className="groove-verdict" data-steady={run.result.steady ? 'true' : 'false'}>
            {verdictText(run.result)}
          </p>
          <ul className="groove-pad-lines">
            {resultRows.map((row) => (
              <li key={row.pad}>{padLineText(row)}</li>
            ))}
          </ul>
          {diagnosis.map((sentence) => (
            <p key={sentence} className="groove-diagnosis">
              {sentence}
            </p>
          ))}
          <p className="groove-latency-note">
            Every figure here includes your keyboard and speakers, not just your hands. What it
            judges is how evenly you played, never how close to zero you got.
          </p>
        </section>
      )}
    </div>
  )
}

function runStateText(
  phase: GrooveRunPhase,
  countInLeft: number,
  bar: number,
  gradedBars: number,
): string {
  switch (phase) {
    case 'idle':
      return 'Ready when you are'
    case 'count-in':
      return `Counting in — ${countInLeft}`
    // The e2e pad driver takes the graded window's opening from this text
    // starting with "Playing" (see `e2e/drum-pads.ts`); no other phase's
    // wording may start with that word.
    case 'playing':
      return `Playing — bar ${bar} of ${gradedBars}`
    case 'graded':
      return 'Run finished'
  }
}

type PadProps = {
  readonly pad: MappedDrumPad
  readonly lit: boolean
  readonly onHit: (pad: MappedDrumPad) => void
}

/**
 * `pointerdown` is the stroke; the `click` handler is the keyboard path only.
 * A mouse press fires both, so the ref swallows the click that follows its own
 * pointerdown rather than counting the stroke twice.
 */
function Pad({ pad, lit, onHit }: PadProps) {
  const fromPointer = useRef(false)
  const key = GROOVE_PAD_KEY[pad]
  return (
    <button
      type="button"
      className="drum-pad"
      aria-label={GROOVE_PAD_LABEL[pad]}
      data-lit={lit ? 'true' : undefined}
      onPointerDown={() => {
        fromPointer.current = true
        onHit(pad)
      }}
      onClick={() => {
        if (fromPointer.current) {
          fromPointer.current = false
          return
        }
        onHit(pad)
      }}
    >
      <span className="drum-pad-name" aria-hidden="true">
        {GROOVE_PAD_LABEL[pad]}
      </span>
      {key !== undefined && (
        <span className="drum-pad-key" aria-hidden="true">
          {keyLabel(key)}
        </span>
      )}
    </button>
  )
}

type TempoFieldProps = {
  readonly bpm: number
  readonly onBpm: (bpm: number) => void
  readonly disabled: boolean
}

/**
 * The same typeable `.stepper` `MetronomeScreen` uses, and held as a draft
 * string for the same reason: typing "70" passes through "7", which clamps to
 * MIN_BPM and rewrites the field under the caret. Commit is blur or Enter.
 */
function TempoField({ bpm, onBpm, disabled }: TempoFieldProps) {
  const inputId = useId()
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
    <div className="field groove-tempo-field">
      <label htmlFor={inputId}>Tempo</label>
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
          id={inputId}
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

/** Lights a pad for `PAD_FLASH_MS` each time `flash` changes — the "it registered" signal. */
function useFlash(flash: PadFlash | undefined) {
  const [lit, setLit] = useState<MappedDrumPad | undefined>(undefined)
  useEffect(() => {
    if (flash === undefined) return undefined
    setLit(flash.pad)
    const timer = window.setTimeout(() => setLit(undefined), PAD_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])
  return lit
}

/**
 * Binds the pad keys on `document`, so a learner never has to keep a pad
 * focused to play it. See the module comment for why Space alone is gated on
 * the run phase.
 */
function useKeyboardPads(
  pads: readonly MappedDrumPad[],
  hit: (pad: MappedDrumPad) => void,
  running: boolean,
): void {
  const hitRef = useRef(hit)
  hitRef.current = hit
  const runningRef = useRef(running)
  runningRef.current = running

  const byKey = useMemo(() => {
    const map = new Map<string, MappedDrumPad>()
    for (const pad of pads) {
      const key = GROOVE_PAD_KEY[pad]
      if (key !== undefined) map.set(key, pad)
    }
    return map
  }, [pads])

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
      const pad = byKey.get(event.key.toLowerCase())
      if (pad === undefined) return
      if (event.key === ' ') {
        if (!runningRef.current) return
        event.preventDefault()
      }
      hitRef.current(pad)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [byKey])
}
