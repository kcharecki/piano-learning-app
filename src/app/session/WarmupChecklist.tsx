/**
 * The warm-up segment's real destination (roadmap 5.45): an away-from-the-
 * keys checklist, not a label. Content lives in
 * `@content/curriculum/warmups.ts`; this component only renders it and
 * tracks which steps are checked, entirely local state — nothing here
 * decides when the segment counts as "done" (that stays
 * `useSessionRun.completeCurrentItem`, called by the parent once every step
 * is checked, matching every other segment's "the learner declares it
 * done" model).
 */
import { useState } from 'react'
import { WARMUP_STEPS } from '@content/curriculum/warmups.ts'

export type WarmupChecklistProps = {
  /** Called whenever the all-checked state changes, so the parent can gate its "Complete" action. */
  readonly onAllCheckedChange: (allChecked: boolean) => void
}

export function WarmupChecklist({ onAllCheckedChange }: WarmupChecklistProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())

  function toggle(stepId: string, isChecked: boolean): void {
    const next = new Set(checked)
    if (isChecked) next.add(stepId)
    else next.delete(stepId)
    setChecked(next)
    onAllCheckedChange(next.size === WARMUP_STEPS.length)
  }

  return (
    <ul className="warmup-checklist list" aria-label="Warm-up checklist">
      {WARMUP_STEPS.map((step) => {
        const isChecked = checked.has(step.id)
        return (
          <li key={step.id}>
            <label>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) => toggle(step.id, event.target.checked)}
              />
              {step.instruction}
            </label>
          </li>
        )
      })}
    </ul>
  )
}
