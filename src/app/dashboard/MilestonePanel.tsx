/**
 * MilestonePanel (roadmap B.4, REQ-3.10.3) — light gamification: achieved
 * milestones with the date they were reached, and the nearest few still in
 * progress. Every value shown is `@core/progress/milestones.ts`'s own
 * `computeMilestones` output, verbatim — this component only groups (achieved
 * vs. in-progress) and sorts (most recent first; nearest-to-completion
 * first) for display. No number here is re-derived, and "0 of 5 achieved" /
 * "0 of 12 major scales" render exactly as reported, never hidden or
 * rounded away — REQ-3.10.3 rules out engagement-bait, and a padded or
 * fudged number would be exactly that.
 *
 * **Demotes**: the whole section sits behind a closed-by-default `<details>`
 * — the same disclosure convention `SrsSummary.tsx`'s "Scheduler details"
 * already uses on this same screen. The only thing visible on an unopened
 * Dashboard is one summary line ("Milestones — N of 5 achieved"); the full
 * achieved/in-progress lists are opt-in. So the screen gains exactly one
 * compact row, not a whole new always-open section (docs/DESIGN.md rule 3,
 * "adding means demoting" — here the section demotes its own body, rather
 * than displacing anything already on the screen).
 */
import type { Milestone } from '@core/progress/milestones.ts'

export type MilestonePanelProps = {
  readonly milestones: readonly Milestone[]
  /** How many not-yet-achieved milestones to show, nearest to completion first. Default 3. */
  readonly nearestCount?: number
}

const DATE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, DATE_FMT)
}

export function MilestonePanel({ milestones, nearestCount = 3 }: MilestonePanelProps) {
  const achieved = [...milestones]
    .filter((m) => m.achieved)
    .sort((a, b) => (b.achievedAt ?? 0) - (a.achievedAt ?? 0))
  const inProgress = [...milestones]
    .filter((m) => !m.achieved)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, nearestCount)

  return (
    <section aria-label="Milestones" role="region" className="milestone-panel">
      <details data-testid="milestone-panel-details">
        <summary>
          Milestones —{' '}
          <span data-testid="milestone-summary-count">
            {achieved.length} of {milestones.length}
          </span>{' '}
          achieved
        </summary>

        {achieved.length === 0 ? (
          <p role="status" data-testid="milestone-achieved-empty">
            None achieved yet — every milestone here is a real, checkable achievement, never a
            countdown or a badge for showing up.
          </p>
        ) : (
          <ul aria-label="Achieved milestones" className="milestone-list">
            {achieved.map((m) => (
              <li key={m.id} data-testid={`milestone-achieved-${m.id}`}>
                <span className="milestone-title">{m.title}</span>
                <span className="milestone-date">
                  {m.achievedAt === null ? '' : formatDate(m.achievedAt)}
                </span>
                <span className="milestone-detail" data-testid={`milestone-achieved-detail-${m.id}`}>
                  {m.progressLabel}
                </span>
              </li>
            ))}
          </ul>
        )}

        {inProgress.length > 0 && (
          <>
            <h4>Nearest</h4>
            <ul aria-label="Milestones in progress" className="milestone-list">
              {inProgress.map((m) => (
                <li key={m.id} data-testid={`milestone-progress-${m.id}`}>
                  <span className="milestone-title">{m.title}</span>
                  <span
                    className="milestone-progress-label"
                    data-testid={`milestone-progress-label-${m.id}`}
                  >
                    {m.progressLabel}
                  </span>
                  <div className="milestone-progress-bar" role="presentation">
                    <div
                      className="milestone-progress-fill"
                      style={{ width: `${Math.round(m.progress * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  )
}
