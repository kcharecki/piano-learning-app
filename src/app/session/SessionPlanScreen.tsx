/**
 * Today's practice session (roadmap 4.7a, 5.44, 5.45, REQ-3.1.4; redesigned
 * UI-08, 2026-08-12 UI audit — see `docs/ui-audit/today--desktop--dark.png`
 * and `state--session-run-1.png`).
 *
 * Two modes, one component:
 *  - PLANNING: pick a budget and (optionally) adjust the mix; `useSessionPlan`
 *    recomputes `plan` on every change and this renders a preview — one
 *    `.card` per planned item (icon, title, duration badge), the WHOLE card
 *    the click target for every segment except warm-up (UI-08: the old
 *    lowercase "Open" link at an inconsistent x-position is gone).
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
 * being checked. During PLANNING the warm-up card is not a click target at
 * all (it has nowhere to "open" to yet — see the note rendered on it); every
 * other item's card opens the real destination (`onOpen`, still the shell's
 * job to route — this screen still never imports `Shell.tsx` and never
 * decides where an exercise's params take the learner).
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
  type PlannedSession,
  type SessionSegmentKind,
} from '@core/curriculum/session.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import type { IconName } from '../../design-system/icons/icons.ts'
import { Icon } from '@app/ui/Icon.tsx'
import { OnboardingGateway } from '@app/onboarding/OnboardingGateway.tsx'
import { useSessionPlan, MAX_BUDGET_MINUTES } from './useSessionPlan.ts'
import { useSessionRun, type SessionRunSnapshot } from './useSessionRun.ts'
import { WarmupChecklist } from './WarmupChecklist.tsx'

export type SessionPlanScreenProps = {
  /** Called with the exercise named by the item the learner clicked "Open" on. */
  readonly onOpen: (exercise: Exercise) => void
  /** Injection seams for tests — see `useSessionRun`'s own options; default to the real browser clock/IndexedDB, exactly like `PracticeScreen`'s own `clock`/`date` props. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly openStore?: () => Promise<Store>
}

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

/** One glance should say what kind of segment a card is, even before reading
 * its title (rule 4 of the nine screen rules — status sits WITH the thing it
 * describes). */
const SEGMENT_ICONS: Readonly<Record<SessionSegmentKind, IconName>> = {
  warmup: 'flame',
  technique: 'hand',
  'sight-reading': 'book',
  lesson: 'keyboard',
  'theory-ear': 'ear',
}

type QueueStatus = 'done' | 'current' | 'upcoming'

const QUEUE_STATUS_ICON: Readonly<Record<QueueStatus, IconName>> = {
  done: 'check',
  current: 'play',
  upcoming: 'clock',
}

const QUEUE_STATUS_LABEL: Readonly<Record<QueueStatus, string>> = {
  done: 'Done',
  current: 'Current',
  upcoming: 'Upcoming',
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

/** Sentence-case, grammatically correct plural — rule 7 forbids "0 day(s)"-style shortcuts. */
function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
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
      <div className="page page--focus session-plan-screen">
        <h1>Today&apos;s session</h1>
        <p role="status">Loading today&apos;s session…</p>
      </div>
    )
  }

  if (run.run !== undefined && currentIndex !== undefined && currentItem !== undefined) {
    return (
      <SessionRunView
        run={run.run}
        currentIndex={currentIndex}
        currentItem={currentItem}
        elapsedMs={run.elapsedMs()}
        warmupAllChecked={warmupAllChecked}
        onWarmupAllCheckedChange={setWarmupAllChecked}
        onOpen={onOpen}
        onCompleteCurrentItem={() => run.completeCurrentItem()}
        onStopSession={() => run.planNewSession()}
      />
    )
  }

  if (isRunComplete && run.run !== undefined) {
    const totalItems = run.run.plan.items.length
    return (
      <div className="page page--focus session-plan-screen">
        <header className="page-header">
          <h1>Today&apos;s session</h1>
        </header>
        {/* Session-complete moment (roadmap UI-22, motion pass): this whole
            block only exists in the DOM between "the run just finished" and
            the next "Plan a new session" click, so its own mount IS the
            one-time trigger — no key/JS retrigger needed, unlike the
            Flashcards pill (a node reused across many answers). The card
            raise (`--dur-3`) and the check-draw (a `stroke-dasharray`
            reveal on the shared `<Icon name="check">` glyph, also `--dur-3`)
            are the emotional peak DESIGN.md rule 5 asks feedback to have —
            this screen previously ended a session on a plain status line. */}
        <div className="card session-complete-card">
          <span className="session-complete-check" aria-hidden="true">
            <Icon name="check" />
          </span>
          <p role="status" className="is-ok" data-testid="session-run-complete">
            Session complete — {totalItems} of {pluralize(totalItems, 'item')} done,{' '}
            {pluralize(run.run.plan.totalMinutes, 'minute')} planned.
          </p>
          <button type="button" className="btn-primary" onClick={() => run.planNewSession()}>
            Plan a new session
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page page--focus session-plan-screen">
      {/* Roadmap UI-08: the onboarding callout renders HERE rather than in
          Shell, which is where it used to live. It has to disappear while a
          session is running (it competed with the run's own single primary
          action), and only this screen knows that — Shell would have had to
          call `useSessionRun` a second time to find out, starting a second
          timer against the same persisted run. Reaching this return already
          means "not running and not just-completed", so the condition is the
          position, with `sessionRunning` kept as an explicit belt-and-braces
          signal for anyone who moves this call. */}
      <OnboardingGateway show sessionRunning={false} />
      <header className="page-header">
        <div>
          <h1>Today&apos;s session</h1>
          <p className="page-header-subtitle">
            <TodayLabel date={date} />
            {plan !== undefined && (
              <>
                {' · '}
                <span data-testid="session-plan-total">
                  {pluralize(plan.totalMinutes, 'minute')} planned
                </span>
              </>
            )}
          </p>
        </div>
      </header>

      <div className="field-row session-plan-length">
        <div className="field">
          <label id="session-length-label">Session length</label>
          <div className="seg-control" role="radiogroup" aria-labelledby="session-length-label">
            {SESSION_LENGTHS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={budgetMinutes === minutes}
                onClick={() => setBudgetMinutes(minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="session-plan-custom-minutes">Custom minutes</label>
          <input
            id="session-plan-custom-minutes"
            className="session-plan-custom-input"
            type="number"
            min={1}
            max={MAX_BUDGET_MINUTES}
            value={budgetText}
            onChange={(e) => handleBudgetTextChange(e.target.value)}
          />
        </div>
      </div>

      <details className="card--sunken session-plan-mix-disclosure">
        <summary>Adjust mix</summary>
        <div className="field-row" role="group" aria-label="Session mix">
          {MIXABLE_SEGMENT_ORDER.map((segment) => (
            <div className="field" key={segment}>
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
        </div>
        <button type="button" onClick={resetMix}>
          Reset mix
        </button>
      </details>

      {error !== undefined && (
        <p role="alert" data-testid="session-plan-error" title={error}>
          {friendlyError(error)}
        </p>
      )}

      {plan !== undefined && (
        <>
          <ul className="session-plan-items" aria-label="Session items">
            {plan.items.map((item, index) => (
              <li key={`${item.segment}-${item.exercise.id}-${index}`} data-segment={item.segment}>
                {item.segment === 'warmup' ? (
                  <div className="card session-plan-item" data-testid={`session-plan-item-${index}`}>
                    <Icon name={SEGMENT_ICONS[item.segment]} />
                    <span className="session-plan-item-body">
                      <span className="session-plan-item-kicker">{SEGMENT_LABELS[item.segment]}</span>
                      <span className="session-plan-item-title">{item.exercise.title}</span>
                      <span className="session-plan-item-note">Opens as a checklist</span>
                    </span>
                    <span className="badge session-plan-item-duration">{item.minutes} min</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="card session-plan-item"
                    data-testid={`session-plan-item-${index}`}
                    aria-label={`Open ${item.exercise.title}, ${pluralize(item.minutes, 'minute')}`}
                    onClick={() => onOpen(item.exercise)}
                  >
                    <Icon name={SEGMENT_ICONS[item.segment]} />
                    <span className="session-plan-item-body">
                      <span className="session-plan-item-kicker">{SEGMENT_LABELS[item.segment]}</span>
                      <span className="session-plan-item-title">{item.exercise.title}</span>
                    </span>
                    <span className="badge session-plan-item-duration">{item.minutes} min</span>
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* roadmap 4.10: the lesson segment now always has a candidate
              (loaded score > first repertoire piece > curriculum's first
              lesson — see candidates.ts), so it is never literally empty on
              a real curriculum. What's still worth telling the learner: when
              the ONLY reason it's filled is the generic curriculum fallback
              (kind 'play', see lessonCandidates) rather than something of
              their own — that's the "no score loaded, no repertoire yet"
              state this note now targets, instead of a segment that could
              actually read 0 min. */}
          {plan.items.some((item) => item.segment === 'lesson' && item.exercise.kind === 'play') && (
            <div className="card--sunken session-plan-note" role="status">
              <Icon name="book" />
              <p>
                No score loaded and no repertoire saved yet — today&apos;s lesson segment opens the
                curriculum&apos;s first lesson. Load a score or add a piece to your repertoire to
                personalize it.
              </p>
            </div>
          )}

          <button type="button" className="btn-primary" onClick={() => run.startSession(plan)}>
            Start session
          </button>
        </>
      )}
    </div>
  )
}

/** `date` defaults exactly like `useSessionRun`'s own internal fallback — a
 * plain `DateSource` reading the real clock — so a caller that already
 * injects a fake `date` for determinism (every test in this suite) gets a
 * stable label too. */
function TodayLabel({ date }: { readonly date: DateSource | undefined }) {
  const source = date ?? { epochMillis: () => Date.now() }
  const label = new Date(source.epochMillis()).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  return <>{label}</>
}

// ------------------------------------------------------------- running view

type SessionRunViewProps = {
  readonly run: SessionRunSnapshot
  readonly currentIndex: number
  readonly currentItem: PlannedSession['items'][number]
  readonly elapsedMs: number
  readonly warmupAllChecked: boolean
  readonly onWarmupAllCheckedChange: (allChecked: boolean) => void
  readonly onOpen: (exercise: Exercise) => void
  readonly onCompleteCurrentItem: () => void
  readonly onStopSession: () => void
}

function queueStatus(run: SessionRunSnapshot, index: number, currentIndex: number): QueueStatus {
  if (run.doneFlags[index] === true) return 'done'
  if (index === currentIndex) return 'current'
  return 'upcoming'
}

function SessionRunView({
  run,
  currentIndex,
  currentItem,
  elapsedMs,
  warmupAllChecked,
  onWarmupAllCheckedChange,
  onOpen,
  onCompleteCurrentItem,
  onStopSession,
}: SessionRunViewProps) {
  const isWarmup = currentItem.segment === 'warmup'
  const canComplete = !isWarmup || warmupAllChecked
  const position = currentIndex + 1
  const totalItems = run.plan.items.length

  return (
    <div className="page page--focus session-plan-screen session-run-active">
      <header className="page-header">
        <div>
          <h1>Today&apos;s session</h1>
          <p className="page-header-subtitle" data-testid="session-run-position">
            Item {position} of {totalItems}
          </p>
        </div>
      </header>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={position - 1}
        aria-valuemin={0}
        aria-valuemax={totalItems}
      >
        <span style={{ width: `${((position - 1) / totalItems) * 100}%` }} />
      </div>

      <section className="card session-run-current" aria-label="Current item">
        <p className="session-run-segment">
          <Icon name={SEGMENT_ICONS[currentItem.segment]} />
          {SEGMENT_LABELS[currentItem.segment]}
        </p>
        <h2>{currentItem.exercise.title}</h2>
        <p data-testid="session-run-elapsed">
          {formatElapsed(elapsedMs)} elapsed — {currentItem.minutes} min planned
        </p>

        {isWarmup ? (
          <>
            <p className="session-run-warmup-hint">
              Away from the keyboard — no notes yet. Check off every step to continue.
            </p>
            <WarmupChecklist onAllCheckedChange={onWarmupAllCheckedChange} />
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
          onClick={onCompleteCurrentItem}
        >
          {isWarmup ? 'Complete warm-up' : 'Complete item'}
        </button>
      </section>

      <div className="card--sunken session-run-queue">
        <ol className="session-run-item-list" aria-label="Session items">
          {run.plan.items.map((item, index) => {
            const status = queueStatus(run, index, currentIndex)
            return (
              <li
                key={`${item.segment}-${item.exercise.id}-${index}`}
                data-testid={`session-run-item-${index}`}
                data-status={status}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                <span className="session-run-item-status">
                  <Icon name={QUEUE_STATUS_ICON[status]} />
                </span>
                <span>{item.exercise.title}</span>
                <span className="session-run-item-badge">{QUEUE_STATUS_LABEL[status]}</span>
              </li>
            )
          })}
        </ol>
      </div>

      <button type="button" className="btn-ghost" onClick={onStopSession}>
        Stop session
      </button>
    </div>
  )
}
