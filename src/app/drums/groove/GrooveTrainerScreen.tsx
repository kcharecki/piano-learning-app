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
 * (The pad, the tempo stepper and the keyboard binding live in
 * `GrooveControls.tsx` since DR-15 shares them; the reasoning stays here.)
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
 * ## The count-in counts forward, in the chart's own vocabulary
 *
 * An adversarial review caught this screen counting the bar in backwards:
 * `runStateText` printed 4, 3, 2, 1, so the digit "1" landed on the last beat
 * BEFORE the downbeat — one beat before the 1 the count row under the staff
 * and the learner's own reading of the chart call beat 1. A teacher counts a
 * bar in forwards; `useGrooveRun.countInBeat` now does too, ascending
 * 1…`countInBeats` and never printing anything else.
 *
 * ## Listen: the pattern before you play it
 *
 * This screen's persona does not already know the groove, and until now its
 * `AudioOutput` only ever spoke back — a click track and a confirmation tone
 * on the learner's OWN press — never the pattern itself. One press of Listen
 * would have settled the two-readings ambiguity the DR-05 staff work above
 * exists because of. `useGrooveRun.preview()` plays one pass of exactly what
 * the staff draws, with a click under it, and grades nothing; the button
 * lives beside Start rather than replacing it, and is disabled only while a
 * graded run is on, so its own audio can never overlap the run's click track.
 *
 * ## What is deliberately NOT here
 *
 * No tempo ramp. The rebuild brief lists one (T.17.6), and a ramp that reads
 * only evenness is worse than none — see `grade.ts` on why a run-long average
 * hides a growing limb offset. A ramp needs per-step verdicts across several
 * runs, which is its own slice; this screen grades one tempo at a time and
 * says so.
 */
import { useCallback, useMemo, useState } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { DrumKey } from '@app/drums/notation/DrumKey.tsx'
import { GrooveStaff } from '@app/drums/notation/GrooveStaff.tsx'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { describeGroove } from '@core/drums/engrave/describe.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import type { StaffLayout } from '@core/drums/engrave/layout.ts'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { Pad, TempoField } from './GrooveControls.tsx'
import { useFlash, useKeyboardPads } from './groovePadHooks.ts'
import { liveHitText } from './liveHitText.ts'
import { GROOVE_PAD_KEY, GROOVE_PAD_LABEL, keyLabel, sortPadsForDisplay } from './padLabels.ts'
import {
  diagnosisSentences,
  gradedAtText,
  lastRunText,
  padLineText,
  verdictText,
} from './resultLines.ts'
import { useGrooveRun, type GrooveRunPhase } from './useGrooveRun.ts'

/** The persona's goal tempo for the Debut rock groove, and the tempo the screen opens on. */
const DEFAULT_BPM = 80

export type GrooveTrainerScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
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
  //
  // `playCount` carries that same discipline one step further: the figure
  // draws one bar, but the trainer grades `plan.gradedBars`, so the engraving
  // has to say "play this twice" itself rather than let the drawn bar and the
  // graded bars disagree about how long the task is.
  //
  // How many times is `plan.gradedBars` bars divided by the bars the score
  // actually writes out, which is `planGrooveRun`'s own `loops` — a two-bar
  // groove graded over two bars is played once, not twice. Deriving it the
  // same way keeps the drawn repeat and the graded window from drifting apart
  // the moment a multi-bar groove is added.
  const playCount = Math.max(1, Math.ceil(plan.gradedBars / groove.measures.length))
  const layout = useMemo(() => engraveGroove(groove, { playCount }), [groove, playCount])
  // The spoken description carries the repeat for the same reason the drawn
  // staff does: the figure states one bar and the run grades `gradedBars`, so
  // a description that stopped at the bar line would understate the task by
  // exactly as much as the picture used to.
  const staffLabel = useMemo(
    () => describeGroove(groove, (pad) => GROOVE_PAD_LABEL[pad], { playCount }),
    [groove, playCount],
  )

  const attempts = useDrumsHistoryStore((state) => state.attempts)
  const addAttempt = useDrumsHistoryStore((state) => state.addAttempt)
  const lastRun = attempts[0]

  // One history row per run, not per pass: in loop mode `useGrooveRun` calls
  // this exactly once, from Stop, with the LAST graded pass's result (see its
  // module comment and the `onFinished` JSDoc) — a loop run is one attempt.
  // The screen has no use for the per-pass `onPassGraded` callback: the live
  // tally it would feed is already read straight off `run.passesGraded` /
  // `run.steadyPasses` below.
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
  readonly audio?: () => DrumAudioOutput
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
  // Loop is local, transport-level state — not persisted, not part of the
  // plan — the same reason the tempo stepper's own draft string lives here
  // rather than in a store. It is disabled while `busy` (see below) for the
  // same reason the groove picker and tempo field are: it must not change
  // out from under audio already scheduled against the current run.
  const [loop, setLoop] = useState(false)

  const run = useGrooveRun({
    plan,
    onFinished,
    loop,
    ...(seams.clock === undefined ? {} : { clock: seams.clock }),
    ...(seams.audio === undefined ? {} : { audio: seams.audio }),
    ...(seams.frameDriver === undefined ? {} : { driver: seams.frameDriver }),
  })
  const running = run.phase === 'count-in' || run.phase === 'playing'
  // `running` alone gates the Space-is-the-kick binding (see the module
  // comment) and must never widen to cover a preview — Space stays the
  // learner's own kick throughout. `busy` is the broader "something is
  // sounding on its own schedule" state that the groove picker and the tempo
  // field key off, since retuning or swapping grooves mid-preview would pull
  // the plan out from under audio already scheduled against it.
  const busy = running || run.phase === 'preview'

  const pads = useMemo(
    () => sortPadsForDisplay(plan.pads, (padPlan) => padPlan.pad).map((padPlan) => padPlan.pad),
    [plan],
  )

  useKeyboardPads(pads, run.hit, running)
  const lit = useFlash(run.flash)

  const resultRows = useMemo(
    () =>
      run.result === undefined ? [] : sortPadsForDisplay(run.result.result.pads, (row) => row.pad),
    [run.result],
  )
  const diagnosis = run.result === undefined ? [] : diagnosisSentences(run.result.result, plan)

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
          disabled={busy}
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
          disabled={busy}
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
        {/* The legend belongs to the figure but sits OUTSIDE the staff's own
            SVG: its glyphs are the same ellipses and crosses the staff draws,
            and the refutation condition reads pads off the drawing by shape
            and vertical position, so a legend inside `[data-groove-staff]`
            would be read as six more noteheads on the wrong lines. */}
        <DrumKey
          layout={layout}
          labelFor={(pad) => GROOVE_PAD_LABEL[pad]}
          keyFor={(pad) => {
            const key = GROOVE_PAD_KEY[pad]
            return key === undefined ? undefined : keyLabel(key)
          }}
        />
      </div>

      <div className="card groove-stage">
        <TempoField bpm={bpm} onBpm={onBpm} disabled={busy} />

        <div className="groove-beats" aria-hidden="true">
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <span key={i} className="beat" data-state={i === activeBeat ? 'active' : undefined} />
          ))}
        </div>

        {/* Start is the primary action and Listen is deliberately not: a
            learner reaches for Listen first, but only one control on a screen
            may be the one a glance finds (docs/DESIGN.md). */}
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

          {/* The Rival-seat finding: this trainer's own persona does not
              already know the groove, and every shipping rival lets a learner
              hear a pattern before playing it. One press here would have
              settled the two-readings ambiguity `Money Beat (Open Hat)`
              shipped with. Gated on `running`, not `busy`, so the control
              that starts a preview stays reachable right up until a graded
              run actually begins — only the run itself, not another preview,
              should be able to take it away. */}
          <button
            type="button"
            className="groove-listen"
            aria-label={run.phase === 'preview' ? 'Stop listening' : 'Listen'}
            disabled={running}
            onClick={run.phase === 'preview' ? run.stop : run.preview}
          >
            <Icon name={run.phase === 'preview' ? 'stop' : 'ear'} />
            {run.phase === 'preview' ? 'Stop listening' : 'Listen'}
          </button>

          {/* With loop on, the single count-in's graded window repeats
              back-to-back with no gap and no further count-in — see
              `useGrooveRun`'s module comment (roadmap DR-09 "loop"). Disabled
              while busy for the same reason the groove picker and tempo field
              are: it must not flip out from under a run or preview already
              scheduled against the current setting. */}
          <button
            type="button"
            role="switch"
            aria-checked={loop}
            aria-label="Loop"
            className="groove-loop-toggle"
            disabled={busy}
            onClick={() => setLoop((value) => !value)}
          >
            <Icon name="rhythm" />
            Loop
          </button>
        </div>

        <p role="status" aria-label="Run state" className="groove-run-state">
          {runStateText(run.phase, run.countInBeat, run.bar, plan.gradedBars, loop, run.pass)}
        </p>

        {/* Per-hit live feedback (roadmap DR-09): every accepted hit gets an
            instant verdict, read here and echoed as a colour on the pad
            itself below — one sentence and one colour per stick, not just a
            score at the end. Empty until the first hit lands; never cleared
            by anything except a fresh start()/preview() (see `useGrooveRun`'s
            module comment on `lastHit`), so it still reads correctly if the
            learner glances down after the run has already stopped.
            `aria-live="off"` overrides `role="status"`'s own implicit
            "polite": this line updates at stroke rate (6+/s on sixteenths),
            which would otherwise bury the "Run state" line's announcements
            under a torrent of "Kick on time" — sighted learners still get it
            from the text and the pad colour below. */}
        <p
          role="status"
          aria-label="Last hit"
          aria-live="off"
          className="groove-live-hit"
          data-kind={run.lastHit?.kind}
        >
          {run.lastHit === undefined ? '' : liveHitText(run.lastHit)}
        </p>
      </div>

      <div className="groove-pads">
        {pads.map((pad) => {
          // Driven by `hitByPad`, not `lastHit`: a unison instant (hat and
          // kick together — every instant of the default Quarter-Note Rock)
          // would otherwise have the second accepted hit's single `lastHit`
          // slot overwrite the first pad's verdict within the same frame.
          // `hitByPad` keeps one verdict per pad so both survive.
          const verdict = run.hitByPad.get(pad)?.kind
          return (
            <Pad
              key={pad}
              pad={pad}
              lit={lit === pad}
              onHit={run.hit}
              {...(verdict === undefined ? {} : { verdict })}
            />
          )
        })}
      </div>

      {/* The summary of the PREVIOUS session, for a learner arriving fresh. Once this
          run has its own result panel the line is stale by definition, and printing
          both put two verdicts on screen at once — the visual pass caught it saying
          "not there yet" twice, a paragraph apart. */}
      {lastRunLine !== undefined && run.result === undefined && (
        <p className="groove-last-run">{lastRunLine}</p>
      )}

      {run.result !== undefined && (
        <section className="card groove-result" aria-label="Result">
          {/* Loop mode grades a pass at a time, and only Stop ends it — this
              is the running tally across every pass graded so far this run,
              not just the one the panel below is currently showing. Hidden
              outside a loop run: `passesGraded` never leaves 0 there. */}
          {run.passesGraded > 0 && (
            <p className="groove-pass-tally">
              {run.steadyPasses} of {run.passesGraded} {run.passesGraded === 1 ? 'pass' : 'passes'}{' '}
              steady
            </p>
          )}
          <p className="groove-verdict" data-steady={run.result.result.steady ? 'true' : 'false'}>
            {verdictText(run.result.result)}
          </p>
          {/* Always shown, so a learner who retunes after a run can still see
              what tempo the verdict they are reading actually came from
              (roadmap T.31) — the result itself survives the retune, but the
              tempo control on screen has already moved on. */}
          <p className="groove-graded-at">{gradedAtText(run.result.bpm)}</p>
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
  countInBeat: number,
  bar: number,
  gradedBars: number,
  loop: boolean,
  pass: number,
): string {
  switch (phase) {
    case 'idle':
      return 'Ready when you are'
    // Counts forward, 1 through the last count-in beat, in the chart's own
    // vocabulary — a teacher counts a bar in forwards, and beat 1 here must
    // land on the same instant the staff calls beat 1 (a MAJOR review finding:
    // this used to count DOWN, so "1" printed on the beat before the downbeat).
    case 'count-in':
      return `Counting in — ${countInBeat}`
    // The e2e pad driver takes the graded window's opening from this text
    // starting with "Playing" (see `e2e/drum-pads.ts`); no other phase's
    // wording may start with that word — including this one below. Looping
    // appends the pass number, since with no further count-in the bar count
    // alone no longer says which time around the learner is on.
    case 'playing':
      return loop
        ? `Playing — bar ${bar} of ${gradedBars}, pass ${pass}`
        : `Playing — bar ${bar} of ${gradedBars}`
    case 'graded':
      return 'Run finished'
    case 'preview':
      return 'Listening — the groove as written'
  }
}
