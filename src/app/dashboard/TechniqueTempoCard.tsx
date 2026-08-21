/**
 * The dashboard's "Technique tempo" card — one line per drill (roadmap T.14).
 *
 * It used to be a single `TrendChart` fed by every drill's clean attempts
 * concatenated and sorted by time. That is only readable if every drill shares
 * a target tempo, and they do not: one clean solid-triad run at its target of
 * 72 followed by one clean broken-triad run at its target of 60 drew a line
 * going 72 → 60, so two successes in a row read as getting slower. The drill
 * id was in a per-point tooltip and nowhere else, and there was no legend, so
 * nothing on screen said the two points were different drills.
 *
 * Each drill now gets its own titled chart, its own best, and its own target
 * to read that best against — "72 of 72 bpm" is a sentence about mastery,
 * where a bare 72 next to a 60 was a sentence about decline that was not true.
 *
 * The card is capped at `MAX_SERIES` drills, most recently practised first,
 * and says how many it left out. A dashboard card that grows without bound
 * pushes everything below it off the screen, and the drill somebody played
 * this week is the one they are asking about.
 */
import { type ReactElement } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { TrendChart } from './TrendChart.tsx'
import type { TechniqueTempoSeries } from './useDashboard.ts'

/** How many drills the card draws before it starts counting instead. */
export const MAX_SERIES = 4

/** Below this many clean runs there is no trend to draw, only a number. */
export const MIN_CHART_POINTS = 2

export type TechniqueTempoCardProps = {
  readonly series: readonly TechniqueTempoSeries[]
}

/** `72 of 72 bpm` — the best reached, against what this drill is aiming at. */
function bestLine(series: TechniqueTempoSeries): string {
  const runs = series.points.length === 1 ? '1 clean run' : `${String(series.points.length)} clean runs`
  return `Best ${String(series.bestBpm)} of ${String(series.targetBpm)} bpm · ${runs}`
}

export function TechniqueTempoCard({ series }: TechniqueTempoCardProps): ReactElement {
  const shown = series.slice(0, MAX_SERIES)
  const hidden = series.length - shown.length

  return (
    <section className="card dashboard-card-trend" aria-label="Technique tempo trends" role="region">
      <h2>
        <Icon name="clock" /> Technique tempo
      </h2>
      {series.length === 0 ? (
        <p role="status" className="empty-state" data-testid="dashboard-technique-empty">
          <Icon name="clock" />
          No clean technique run yet &mdash; run a drill on the Technique screen.
        </p>
      ) : (
        <>
          <ul className="list technique-tempo-series" aria-label="Clean tempo per drill">
            {shown.map((s) => (
              <li key={s.drillId} data-testid={`dashboard-technique-series-${s.drillId}`}>
                <h3>{s.title}</h3>
                <p className="technique-tempo-best">{bestLine(s)}</p>
                {/* One clean run draws as a dot alone in an empty box, which
                    reads as a broken chart — and `bestLine` above already says
                    everything a single point can. The line starts when there
                    is a line. */}
                {s.points.length >= MIN_CHART_POINTS && (
                  <TrendChart
                    points={s.points.map((p, i) => ({
                      label: `${s.title} run ${String(i + 1)}`,
                      value: Math.round(p.bpm),
                    }))}
                    kind="line"
                    ariaLabel={`${s.title} — clean tempo over time`}
                    valueSuffix=" bpm"
                  />
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="technique-tempo-more" data-testid="dashboard-technique-more">
              {hidden === 1
                ? 'And 1 other drill practised less recently.'
                : `And ${String(hidden)} other drills practised less recently.`}
            </p>
          )}
        </>
      )}
    </section>
  )
}
