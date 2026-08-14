/**
 * Shared spaced-repetition summary (roadmap 5.31, REQ-3.9.4's four screens).
 *
 * `retentionStats` (`@core/srs/scheduler.ts`) returns Anki's own internal
 * vocabulary — `young`, `mature`, `ease` — which is exactly what a scheduler
 * needs to reason about and exactly what a piano beginner has no reason to
 * know. Nobody learning piano knows what a "mature card" is, and "ease 2.50"
 * reads as a bug report, not encouragement.
 *
 * REWORKED (roadmap UI-07, 2026-08-12 UI audit): the previous shape stacked
 * three elements of raw scheduler internals under every drill — a full-width
 * "0 CARDS · 0 DUE NOW · 0 NEW · 0 LEARNING · 0 MASTERED" row, a "Nothing
 * recorded yet." box, and a "Scheduler details" disclosure — dominating
 * screens whose star is the drill. Now:
 *
 * - **Headline** (rule 4, status sits with the thing it describes): one
 *   compact line, a `cards` icon plus learner language — "12 cards · 3 to
 *   review". Each clause appears only when its count is non-zero (rule 7:
 *   no "0 day(s)"-style zero-plurals rendered as prose).
 * - **Empty state** (rule 6, empty states teach): exactly one sentence, no
 *   zero-row, no second empty box.
 * - **Everything else — the five-way breakdown (new / learning / mastered)
 *   and the scheduler's own words (Young / Mature / average ease) — lives
 *   behind ONE `<chevron-down>` disclosure**, closed by default. The
 *   breakdown numbers and the raw scheduler figures were always the same
 *   underlying values under two label sets; merging them into one
 *   disclosure body means a learner who opens it once sees both without a
 *   second nested toggle.
 *
 * Every number rendered is still exactly the value the scheduler computed —
 * `new = total - young - mature` is the only derived figure, and it is safe
 * arithmetic, not a re-derivation of the algorithm (`young` requires
 * `reps > 0`, `mature` requires `intervalDays >= MATURE_THRESHOLD_DAYS`, so
 * the two are mutually exclusive and `young + mature <= total` always
 * holds).
 *
 * Prop contract is UNCHANGED from before this rework — `stats`, `idPrefix`,
 * `ariaLabel` — so all four existing callers (Flashcards, Ear training,
 * Theory drills, Dashboard) keep working without edits. Every `data-testid`
 * this component previously produced is still produced, in the same shape,
 * so each caller's own pre-existing assertions (e.g.
 * `dashboard-retention-total`, `theory-stats-total`) keep passing — they
 * just now live inside the closed-by-default disclosure instead of an
 * always-open row. Testing-library's `getByTestId`/`toHaveTextContent`
 * queries do not filter on the browser's native `<details>` visibility, so
 * this is not a contradiction: the numbers are honest and queryable, just
 * not the first thing a learner's eye lands on.
 */
import { Icon } from '@app/ui/Icon.tsx'
import type { RetentionStats } from '@core/srs/scheduler.ts'

export type SrsSummaryProps = {
  readonly stats: RetentionStats
  /** Prefixes every `data-testid` this component renders, e.g. `"theory-stats"`
   *  producing `"theory-stats-total"`, `"theory-stats-due"`, etc. — kept
   *  per-caller so each screen's existing testids (already asserted in their
   *  own tests) stay stable across this refactor. */
  readonly idPrefix: string
  /** Accessible name for the breakdown group inside the disclosure, e.g.
   *  `"Retention"`. */
  readonly ariaLabel: string
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function SrsSummary({ stats, idPrefix, ariaLabel }: SrsSummaryProps) {
  // Mutually exclusive by construction — see the module doc — so this is
  // never negative.
  const newCount = stats.total - stats.young - stats.mature

  const headline = [
    stats.total > 0 ? pluralize(stats.total, 'card') : null,
    stats.due > 0 ? `${stats.due} to review` : null,
  ]
    .filter((clause): clause is string => clause !== null)
    .join(' · ')

  return (
    <div className="card card--sunken srs-summary">
      {stats.total === 0 ? (
        <p role="status" data-testid={`${idPrefix}-empty`} className="srs-summary-empty">
          Answers you give here come back for review at the right moment — play the first card
          to start.
        </p>
      ) : (
        <p className="srs-summary-headline" data-testid={`${idPrefix}-headline`}>
          <Icon name="cards" />
          {headline}
        </p>
      )}

      <details className="srs-summary-details">
        <summary>
          <Icon name="chevron-down" />
          Review breakdown
        </summary>

        <div className="stat-group" role="group" aria-label={ariaLabel}>
          <div className="stat">
            <b data-testid={`${idPrefix}-total`}>{stats.total}</b>
            <small>Cards</small>
          </div>
          <div className="stat">
            <b data-testid={`${idPrefix}-due`}>{stats.due}</b>
            <small>Due now</small>
          </div>
          <div className="stat">
            <b data-testid={`${idPrefix}-new`}>{newCount}</b>
            <small>New</small>
          </div>
          <div className="stat">
            <b data-testid={`${idPrefix}-learning`}>{stats.young}</b>
            <small>Learning</small>
          </div>
          <div className="stat">
            <b data-testid={`${idPrefix}-mastered`}>{stats.mature}</b>
            <small>Mastered</small>
          </div>
        </div>

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
