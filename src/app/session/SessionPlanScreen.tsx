/**
 * Today's practice session (roadmap 4.7a, REQ-3.1.4). A thin view over
 * `useSessionPlan` — the budget, the mix and the resulting `PlannedSession`
 * (or its error) all live there; this file only renders the plan as a list
 * and forwards which item the learner picked.
 *
 * Navigation is the shell's job (see this module's build report for exactly
 * what the shell must do with an `Exercise`): this screen never imports
 * `Shell.tsx` and never decides where an exercise's params take the learner —
 * it only calls `onOpen(exercise)`.
 */
import { useEffect, useState } from 'react'
import { SESSION_LENGTHS, type SessionSegmentKind } from '@core/curriculum/session.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import { useSessionPlan, MAX_BUDGET_MINUTES } from './useSessionPlan.ts'

export type SessionPlanScreenProps = {
  /** Called with the exercise named by the item the learner clicked "Open" on. */
  readonly onOpen: (exercise: Exercise) => void
}

const SEGMENT_ORDER: readonly SessionSegmentKind[] = [
  'technique',
  'sight-reading',
  'lesson',
  'theory-ear',
]

const SEGMENT_LABELS: Readonly<Record<SessionSegmentKind, string>> = {
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

export function SessionPlanScreen({ onOpen }: SessionPlanScreenProps) {
  const { budgetMinutes, setBudgetMinutes, mix, setMixShare, resetMix, plan, error } =
    useSessionPlan()
  const [budgetText, setBudgetText] = useState(String(budgetMinutes))

  // Keep the text field in sync when the budget changes from elsewhere (the
  // 15/30/60 buttons, or clamping to MAX_BUDGET_MINUTES).
  useEffect(() => {
    setBudgetText(String(budgetMinutes))
  }, [budgetMinutes])

  function handleBudgetTextChange(text: string): void {
    setBudgetText(text)
    // Leave the previous plan on screen while the field is empty or holds a
    // transient, not-yet-a-number value, instead of collapsing to 0.
    if (text.trim() === '') return
    setBudgetMinutes(Number(text))
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

      <div role="group" aria-label="Session mix">
        {SEGMENT_ORDER.map((segment) => (
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
                <button
                  type="button"
                  aria-label={`Open ${item.exercise.title}`}
                  onClick={() => onOpen(item.exercise)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
