/**
 * Today's practice session (roadmap 4.7a, 5.44, 5.45, REQ-3.1.4).
 *
 * Two modes, one component:
 *  - PLANNING: pick a budget and (optionally) adjust the mix; `useSessionPlan`
 *    recomputes `plan` on every change and this renders a preview — same as
 *    before roadmap 5.44, minus the per-item "Open" being the only action.
 *  - RUNNING: once "Start session" is clicked, `useSessionRun` freezes that
 *    `plan` into a persisted run and this renders ONE item at a time — a
 *    live timer (driven by the injected `Clock`/`DateSource` via
 *    `usePracticeLog`, reused rather than a second logging path), an
 *    explicit "Complete" step that advances to the next item, and a visible
 *    "Item N of TOTAL". This is what makes the plan actually runnable —
 *    before this it was a list of links to elsewhere with no sense of
 *    progress (see ROADMAP.md 5.44's own description of the defect).
 *
 * The warm-up item (roadmap 5.45) is the one item that does not merely link
 * elsewhere: while it is current, this renders `WarmupChecklist` — a real
 * away-from-the-keys routine — inline, and "Complete" is gated on every step
 * being checked. Every other item keeps the pre-5.44 "Open" affordance
 * (`onOpen`, still the shell's job to route — this screen still never
 * imports `Shell.tsx` and never decides where an exercise's params take the
 * learner) alongside the new timer/complete controls, so a learner can still
 * jump straight to the real screen for that item while the session clock
 * keeps their overall position.
 *
 * Persistence for "which item is current, which are done" lives in
 * `useSessionRun`, independent of `useSessionPlan` (which stays exactly the
 * pure budget/mix/plan-preview hook it already was) — see that hook's own
 * module doc for why it keeps its own small persisted record instead of
 * reusing `useProgressStore`.
 */
import { useEffect, useState } from 'react'
import type { Clock, DateSource, Store } from '@core/ports/index.ts'
import {
  SESSION_LENGTHS,
  type MixableSegmentKind,
  type SessionSegmentKind,
} from '@core/curriculum/session.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import { useSessionPlan, MAX_BUDGET_MINUTES } from './useSessionPlan.ts'
import { useSessionRun } from './useSessionRun.ts'
import { WarmupChecklist } from './WarmupChecklist.tsx'

export type SessionPlanScreenProps = {
  /** Called with the exercise named by the item the learner clicked "Open" on. */
  readonly onOpen: (exercise: Exercise) => void
  /** Injection seams for tests — see `useSessionRun`'s own options; default to the real browser clock/IndexedDB, exactly like `PracticeScreen`'s own `clock`/`date` props. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly openStore?: () => Promise<Store>
}

const SEGMENT_ORDER: readonly SessionSegmentKind[] = [
  'warmup',
  'technique',
  'sight-reading',
  'lesson',
  'theory-ear',
]

const MIXABLE_SEGMENT_ORDER: readonly MixableSegmentKind[] = [
  'technique',
  'sight-reading',
  'lesson',
  'theory-ear',
]

const SEGMENT_LABELS: Readonly<Record<SessionSegmentKind, string>> = {
  warmup: 'Warm-up',
  technique: 'Technique',
  'sight-reading': 'Sight-reading',
  lesson: 'Lesson / repertoire',
  'theory-ear': 'Theory / ear training',
}

/** Turns `planSession`'s own error message into a sentence a learner can act
 * on, rather than rendering the internal parameter name verbatim. Falls back
 * to the raw message (kept in `title` for debugging) for cases not named
 * here. */
function friendlyError(raw: string): string {
  if (/positive whole number of minutes/.test(raw)) {
    return 'Enter a session length of at least 1 minute.'
  }
  if (/mix normalises to zero|mix share for/.test(raw)) {
    return 'Adjust the mix so at least one segment has a share.'
  }
  return 'Could not build a session with these settings.'
}

/** `90000` -> `"1:30"`. Never negative — a stray sub-zero elapsed reading renders as `0:00`. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function SessionPlanScreen({ onOpen, clock, date, openStore }: SessionPlanScreenProps) {
  const { budgetMinutes, setBudgetMinutes, mix, setMixShare, resetMix, plan, error } =
    useSessionPlan()
  const run = useSessionRun({
    ...(clock === undefined ? {} : { clock }),
    ...(date === undefined ? {} : { date }),
    ...(openStore === undefined ? {} : { openStore }),
  })
  const [budgetText, setBudgetText] = useState(String(budgetMinutes))
  const [warmupAllChecked, setWarmupAllChecked] = useState(false)
  // Forces a re-render once a second while a timer is running, so the live
  // "elapsed" readout actually ticks — `elapsedMs()` itself always reads the
  // current value; nothing about the timer's own correctness depends on this.
  const [, forceTick] = useState(0)

  const currentIndex = run.currentIndex
  const currentItem =
    run.run !== undefined && currentIndex !== undefined ? run.run.plan.items[currentIndex] : undefined
  const isRunComplete = run.run !== undefined && currentIndex === undefined

  // Keep the text field in sync when the budget changes from elsewhere (the
  // 15/30/60 buttons, or clamping to MAX_BUDGET_MINUTES).
  useEffect(() => {
    setBudgetText(String(budgetMinutes))
  }, [budgetMinutes])

  // A fresh item starts with nothing checked off.
  useEffect(() => {
    setWarmupAllChecked(false)
  }, [currentIndex])

  useEffect(() => {
    if (!run.running) return
    const interval = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [run.running])

  function handleBudgetTextChange(text: string): void {
    setBudgetText(text)
    // Leave the previous plan on screen while the field is empty or holds a
    // transient, not-yet-a-number value, instead of collapsing to 0.
    if (text.trim() === '') return
    setBudgetMinutes(Number(text))
  }

  if (!run.hydrated) {
    return (
      <div className="session-plan-screen">
        <h2>Today&apos;s session</h2>
        <p role="status">Loading today&apos;s session…</p>
      </div>
    )
  }

  if (run.run !== undefined && currentItem !== undefined) {
    const isWarmup = currentItem.segment === 'warmup'
    const canComplete = !isWarmup || warmupAllChecked
    const position = currentIndex !== undefined ? currentIndex + 1 : 0
    return (
      <div className="session-plan-screen session-run-active">
        <h2>Today&apos;s session</h2>
        <p className="session-run-position" data-testid="session-run-position">
          Item {position} of {run.run.plan.items.length}
        </p>
        <div className="progress-bar" role="progressbar" aria-valuenow={position - 1} aria-valuemin={0} aria-valuemax={run.run.plan.items.length}>
          <span style={{ width: `${((position - 1) / run.run.plan.items.length) * 100}%` }} />
        </div>

        <section className="card session-run-current" aria-label="Current item">
          <p className="session-run-segment">{SEGMENT_LABELS[currentItem.segment]}</p>
          <h3>{currentItem.exercise.title}</h3>
          <p data-testid="session-run-elapsed">
            {formatElapsed(run.elapsedMs())} elapsed — {currentItem.minutes} min planned
          </p>

          {isWarmup ? (
            <>
              <p className="session-run-warmup-hint">
                Away from the keyboard — no notes yet. Check off every step to continue.
              </p>
              <WarmupChecklist onAllCheckedChange={setWarmupAllChecked} />
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => onOpen(currentItem.exercise)}>
              Open {currentItem.exercise.title}
            </button>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={!canComplete}
            onClick={() => run.completeCurrentItem()}
          >
            {isWarmup ? 'Complete warm-up' : 'Complete item'}
          </button>
        </section>

        <ol className="session-run-item-list" aria-label="Session items">
          {run.run.plan.items.map((item, index) => {
            const isDone = run.run?.doneFlags[index] === true
            const isCurrent = index === currentIndex
            const status = isDone ? 'Done' : isCurrent ? 'Current' : 'Upcoming'
            return (
              <li
                key={`${item.segment}-${item.exercise.id}-${index}`}
                data-testid={`session-run-item-${index}`}
                data-status={status.toLowerCase()}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="session-run-item-status">{isDone ? '✓' : index + 1}</span>
                <span>{SEGMENT_LABELS[item.segment]}</span>
                <span>{item.exercise.title}</span>
                <span className="session-run-item-badge">{status}</span>
              </li>
            )
          })}
        </ol>

        <button type="button" className="btn-ghost" onClick={() => run.planNewSession()}>
          Stop session
        </button>
      </div>
    )
  }

  if (isRunComplete && run.run !== undefined) {
    return (
      <div className="session-plan-screen">
        <h2>Today&apos;s session</h2>
        <p role="status" className="is-ok" data-testid="session-run-complete">
          Session complete — {run.run.plan.items.length} of {run.run.plan.items.length} items done,{' '}
          {run.run.plan.totalMinutes} minutes planned.
        </p>
        <button type="button" className="btn-primary" onClick={() => run.planNewSession()}>
          Plan a new session
        </button>
      </div>
    )
  }

  return (
    <div className="session-plan-screen">
      <h2>Today&apos;s session</h2>

      <div role="group" aria-label="Session length">
        {SESSION_LENGTHS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={budgetMinutes === minutes}
            onClick={() => setBudgetMinutes(minutes)}
          >
            {minutes} min
          </button>
        ))}
        <label htmlFor="session-plan-custom-minutes">Custom minutes</label>
        <input
          id="session-plan-custom-minutes"
          type="number"
          min={1}
          max={MAX_BUDGET_MINUTES}
          value={budgetText}
          onChange={(e) => handleBudgetTextChange(e.target.value)}
        />
      </div>

      <details className="session-plan-mix-disclosure">
        <summary>Adjust mix</summary>
        <div role="group" aria-label="Session mix">
          {MIXABLE_SEGMENT_ORDER.map((segment) => (
            <div key={segment}>
              <label htmlFor={`session-plan-mix-${segment}`}>
                {SEGMENT_LABELS[segment]} share
              </label>
              <input
                id={`session-plan-mix-${segment}`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={mix[segment]}
                onChange={(e) => setMixShare(segment, Number(e.target.value))}
              />
            </div>
          ))}
          <button type="button" onClick={resetMix}>
            Reset mix
          </button>
        </div>
      </details>

      {error !== undefined && (
        <p role="alert" data-testid="session-plan-error" title={error}>
          {friendlyError(error)}
        </p>
      )}

      {plan !== undefined && (
        <section aria-label="Session plan">
          <p data-testid="session-plan-total">Total: {plan.totalMinutes} minutes</p>

          <section aria-label="Minutes by segment">
            <dl>
              {SEGMENT_ORDER.map((segment) => (
                <div key={segment}>
                  <dt>{SEGMENT_LABELS[segment]}</dt>
                  <dd data-testid={`session-plan-segment-${segment}`}>
                    {plan.bySegment[segment]} min
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {plan.bySegment.lesson === 0 && (
            <p role="status">Load a score to fill the lesson segment.</p>
          )}

          <ul aria-label="Session items">
            {plan.items.map((item, index) => (
              <li key={`${item.segment}-${item.exercise.id}-${index}`}>
                <span>{SEGMENT_LABELS[item.segment]}</span>{' — '}
                <span>{item.exercise.title}</span>{' — '}
                <span>{item.minutes} min</span>{' '}
                {item.segment === 'warmup' ? (
                  <span className="session-plan-warmup-note">opens as a checklist</span>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-label={`Open ${item.exercise.title}`}
                    onClick={() => onOpen(item.exercise)}
                  >
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>

          <button type="button" className="btn-primary" onClick={() => run.startSession(plan)}>
            Start session
          </button>
        </section>
      )}
    </div>
  )
}
