/**
 * The dashboard (roadmap 4.7, REQ-3.10.1/REQ-3.10.2) — a thin view over
 * `useDashboard`. Every number shown comes from that hook, which in turn
 * reads already-persisted store state through the core reducer functions;
 * this file only lays the six REQ-3.10.1 sections out and renders an honest
 * empty state (never a blank panel, never a fabricated number) wherever the
 * hook reports there is nothing to show yet.
 */
import { ExportPanel } from '@app/progress/ExportPanel.tsx'
import { ACTIVITY_KINDS } from '@core/progress/log.ts'
import { MIN_LEVEL, MAX_LEVEL, type Track } from '@core/curriculum/types.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { TrendChart, type TrendChartPoint } from './TrendChart.tsx'
import { useDashboard, type UseDashboardOptions } from './useDashboard.ts'

const LEVEL_OPTIONS: readonly number[] = Array.from(
  { length: MAX_LEVEL - MIN_LEVEL + 1 },
  (_, i) => MIN_LEVEL + i,
)

export type DashboardScreenProps = UseDashboardOptions

const TRACK_LABELS: Readonly<Record<Track, string>> = {
  playing: 'Playing',
  'sight-reading': 'Sight-reading',
  theory: 'Theory',
}

function round(value: number): number {
  return Math.round(value)
}

export function DashboardScreen(props: DashboardScreenProps) {
  const data = useDashboard(props)

  const weeklyBarPoints: readonly TrendChartPoint[] = data.dailyMinutes.map((d) => ({
    label: d.date,
    value: round(d.minutes),
  }))

  const sightReadingPoints: readonly TrendChartPoint[] = data.sightReadingTrend.map((p, i) => ({
    label: `Run ${i + 1}`,
    value: round(p.accuracy * 100),
  }))

  const techniquePoints: readonly TrendChartPoint[] = data.techniqueTrend.map((p) => ({
    label: p.drillId,
    value: round(p.bpm),
  }))

  const assessmentRunCounts: Record<string, number> = {}
  const assessmentPoints: readonly TrendChartPoint[] = data.assessmentTrend.map((p) => {
    const run = (assessmentRunCounts[p.scoreId] ?? 0) + 1
    assessmentRunCounts[p.scoreId] = run
    return { label: `${p.scoreTitle} run ${run}`, value: round(p.accuracy * 100) }
  })
  const assessmentBestByScoreEntries = Object.entries(data.assessmentBestByScore)

  return (
    <div className="dashboard-screen">
      <h2>Progress</h2>

      <section aria-label="Current level per track" role="region">
        <h3>Current level per track</h3>
        <ul>
          {data.levels.map((l) => (
            <li key={l.track} data-testid={`dashboard-level-${l.track}`}>
              <span>
                {TRACK_LABELS[l.track]}: level {l.level}
                {l.overridden ? ' (overridden)' : ''}
              </span>
              <select
                aria-label={`${TRACK_LABELS[l.track]} level`}
                data-testid={`dashboard-level-select-${l.track}`}
                value={l.level}
                onChange={(e) =>
                  useLevelStore.getState().setTrackLevel(l.track, Number(e.target.value))
                }
              >
                {LEVEL_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <h4>Exit criteria toward the next level</h4>
        {data.curriculumAvailable ? (
          <ul aria-label="Exit criteria">
            {data.levels.flatMap((l) =>
              l.criteria.map((c, i) => (
                <li key={`${l.track}-${i}`} data-testid={`dashboard-criterion-${l.track}-${i}`}>
                  {c.criterion.description}: {c.met ? 'met' : 'not met'}
                </li>
              )),
            )}
          </ul>
        ) : (
          <p role="status" data-testid="dashboard-criteria-empty">
            No curriculum content loaded yet — nothing to check.
          </p>
        )}
      </section>

      <section aria-label="Practice streak and weekly time" role="region">
        <h3>Practice streak &amp; weekly time</h3>
        <dl>
          <dt>Current streak</dt>
          <dd data-testid="dashboard-streak-current">{data.streak.currentDays} day(s)</dd>
          <dt>Longest streak</dt>
          <dd data-testid="dashboard-streak-longest">{data.streak.longestDays} day(s)</dd>
          <dt>This week</dt>
          <dd data-testid="dashboard-weekly-minutes">{round(data.weeklyMinutes)} min</dd>
        </dl>
        {data.weeklyMinutes === 0 ? (
          <p role="status" data-testid="dashboard-weekly-empty">
            Nothing recorded yet.
          </p>
        ) : (
          <TrendChart
            points={weeklyBarPoints}
            kind="bar"
            ariaLabel={`Minutes practiced per day, last ${data.dailyMinutes.length} days (rolling)`}
            valueSuffix=" min"
          />
        )}
        <ul aria-label="Minutes by activity kind">
          {ACTIVITY_KINDS.map((kind) => (
            <li key={kind} data-testid={`dashboard-minutes-${kind}`}>
              {kind}: {round(data.minutesByKind[kind])} min
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Sight-reading accuracy trend" role="region">
        <h3>Sight-reading accuracy trend</h3>
        <p data-testid="dashboard-sightreading-level">Level {data.sightReadingLevel}</p>
        {data.sightReadingTrend.length === 0 ? (
          <p role="status" data-testid="dashboard-sightreading-empty">
            Nothing recorded yet.
          </p>
        ) : (
          <TrendChart
            points={sightReadingPoints}
            kind="line"
            ariaLabel="Sight-reading accuracy over time"
            valueSuffix="%"
          />
        )}
      </section>

      <section aria-label="Assessment accuracy" role="region">
        <h3>Assessment accuracy</h3>
        {data.assessmentTrend.length === 0 ? (
          <p role="status" data-testid="dashboard-assessment-empty">
            Nothing recorded yet — no repertoire assessment has been run.
          </p>
        ) : (
          <>
            <TrendChart
              points={assessmentPoints}
              kind="line"
              ariaLabel="Assessment accuracy over time"
              valueSuffix="%"
            />
            <h4>Best accuracy per piece</h4>
            <ul aria-label="Best assessment accuracy per piece">
              {assessmentBestByScoreEntries.map(([scoreId, accuracy]) => {
                const scoreTitle =
                  [...data.assessmentTrend].reverse().find((p) => p.scoreId === scoreId)
                    ?.scoreTitle ?? scoreId
                return (
                  <li key={scoreId} data-testid={`dashboard-assessment-best-${scoreId}`}>
                    {scoreTitle}: {round(accuracy * 100)}%
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Technique tempo trends" role="region">
        <h3>Technique tempo trends</h3>
        {data.techniqueAttempts.length === 0 ? (
          <p role="status" data-testid="dashboard-technique-empty">
            Nothing recorded yet — no technique attempts have been logged.
          </p>
        ) : (
          <TrendChart
            points={techniquePoints}
            kind="line"
            ariaLabel="Technique clean tempo over time"
            valueSuffix=" bpm"
          />
        )}
      </section>

      <section aria-label="Theory retention stats" role="region">
        <h3>Theory retention</h3>
        <dl>
          <dt>Cards</dt>
          <dd data-testid="dashboard-retention-total">{data.retention.total}</dd>
          <dt>Due</dt>
          <dd data-testid="dashboard-retention-due">{data.retention.due}</dd>
          <dt>Young</dt>
          <dd data-testid="dashboard-retention-young">{data.retention.young}</dd>
          <dt>Mature</dt>
          <dd data-testid="dashboard-retention-mature">{data.retention.mature}</dd>
          <dt>Average ease</dt>
          <dd data-testid="dashboard-retention-ease">{data.retention.averageEase.toFixed(2)}</dd>
        </dl>
        {data.retention.total === 0 && (
          <p role="status" data-testid="dashboard-retention-empty">
            Nothing recorded yet.
          </p>
        )}
      </section>

      <section aria-label="Repertoire status" role="region">
        <h3>Repertoire status</h3>
        {data.repertoirePieces.length === 0 ? (
          <p role="status" data-testid="dashboard-repertoire-empty">
            Nothing recorded yet — no repertoire pieces have been added.
          </p>
        ) : (
          <>
            <ul aria-label="Repertoire pieces">
              {data.repertoirePieces.map((p) => (
                <li key={p.id} data-testid={`dashboard-repertoire-piece-${p.id}`}>
                  {p.title}: {p.status}
                </li>
              ))}
            </ul>
            <h4>Due for review</h4>
            {data.repertoireDue.length === 0 ? (
              <p role="status" data-testid="dashboard-repertoire-due-empty">
                Nothing due for review.
              </p>
            ) : (
              <ul aria-label="Repertoire pieces due for review">
                {data.repertoireDue.map((p) => (
                  <li key={p.id} data-testid={`dashboard-repertoire-due-${p.id}`}>
                    {p.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* REQ-3.10.4: the learner owns this data locally, which means being able
          to take it out and put it back (roadmap 4.6a). */}
      <ExportPanel />
    </div>
  )
}
