/**
 * Shared spaced-repetition summary (roadmap 5.31, REQ-3.9.4's four screens).
 *
 * `retentionStats` (`@core/srs/scheduler.ts`) returns Anki's own internal
 * vocabulary — `young`, `mature`, `ease` — which is exactly what a scheduler
 * needs to reason about and exactly what a piano beginner has no reason to
 * know. Nobody learning piano knows what a "mature card" is, and "ease 2.50"
 * reads as a bug report, not encouragement. This component is the one place
 * that translates those fields into words a learner actually wants:
 *
 * - **Due now** — what to do next. Unchanged from the scheduler's own `due`;
 *   already the plainest possible word for it.
 * - **New** — `total - young - mature`: cards never yet answered correctly
 *   (freshly introduced, or dropped back here by a lapse). Safe arithmetic,
 *   not a re-derivation of the algorithm: `young` requires `reps > 0` and
 *   `mature` requires `intervalDays >= MATURE_THRESHOLD_DAYS`, so the two are
 *   mutually exclusive and `young + mature <= total` always holds.
 * - **Learning** — the scheduler's `young`: recalled correctly at least once,
 *   but the interval is still short. "Still building the memory."
 * - **Mastered** — the scheduler's `mature`: the interval has grown past the
 *   21-day threshold. "You know this well now."
 *
 * The scheduler's own words (`Young`/`Mature`/`Average ease`) are not deleted
 * — they still answer "is the algorithm actually doing something sane with
 * my cards" during debugging — they just move behind a closed-by-default
 * `<details>` disclosure (the same convention `SightReadingCustomizer.tsx`,
 * `PracticeScreen.tsx`'s `.practice-more-tools` and `AnalysisPanel.tsx` all
 * already use for "not for a first-time learner, still one click away").
 * Every number is the same value the scheduler computed; only the label and
 * default visibility change.
 */
import type { RetentionStats } from '@core/srs/scheduler.ts'

export type SrsSummaryProps = {
  readonly stats: RetentionStats
  /** Prefixes every `data-testid` this component renders, e.g. `"theory-stats"`
   *  producing `"theory-stats-total"`, `"theory-stats-due"`, etc. — kept
   *  per-caller so each screen's existing testids (already asserted in their
   *  own tests) stay stable across this refactor. */
  readonly idPrefix: string
  /** Accessible name for the counts list, e.g. `"Retention"`. */
  readonly ariaLabel: string
}

export function SrsSummary({ stats, idPrefix, ariaLabel }: SrsSummaryProps) {
  // Mutually exclusive by construction — see the module doc — so this is
  // never negative.
  const newCount = stats.total - stats.young - stats.mature

  return (
    <div className="srs-summary">
      <dl className="srs-summary-counts" aria-label={ariaLabel}>
        <dt>Cards</dt>
        <dd>
          <div className="stat">
            <b data-testid={`${idPrefix}-total`}>{stats.total}</b>
            <small>Cards</small>
          </div>
        </dd>
        <dt>Due now</dt>
        <dd>
          <div className="stat">
            <b data-testid={`${idPrefix}-due`}>{stats.due}</b>
            <small>Due now</small>
          </div>
        </dd>
        <dt>New</dt>
        <dd>
          <div className="stat">
            <b data-testid={`${idPrefix}-new`}>{newCount}</b>
            <small>New</small>
          </div>
        </dd>
        <dt>Learning</dt>
        <dd>
          <div className="stat">
            <b data-testid={`${idPrefix}-learning`}>{stats.young}</b>
            <small>Learning</small>
          </div>
        </dd>
        <dt>Mastered</dt>
        <dd>
          <div className="stat">
            <b data-testid={`${idPrefix}-mastered`}>{stats.mature}</b>
            <small>Mastered</small>
          </div>
        </dd>
      </dl>

      {stats.total === 0 && (
        <p role="status" data-testid={`${idPrefix}-empty`}>
          Nothing recorded yet.
        </p>
      )}

      <details className="srs-summary-debug">
        <summary>Scheduler details</summary>
        <dl className="srs-summary-debug-list">
          <dt>Young</dt>
          <dd data-testid={`${idPrefix}-young`}>{stats.young}</dd>
          <dt>Mature</dt>
          <dd data-testid={`${idPrefix}-mature`}>{stats.mature}</dd>
          <dt>Average ease</dt>
          <dd data-testid={`${idPrefix}-ease`}>{stats.averageEase.toFixed(2)}</dd>
        </dl>
      </details>
    </div>
  )
}
