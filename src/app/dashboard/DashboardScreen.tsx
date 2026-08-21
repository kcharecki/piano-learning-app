/**
 * The dashboard (roadmap 4.7, REQ-3.10.1/REQ-3.10.2; redesigned roadmap UI-19,
 * 2026-08-12 UI audit) — a thin view over `useDashboard`. Every number shown
 * comes from that hook, which in turn reads already-persisted store state
 * through the core reducer functions; this file only lays the sections out as
 * a dashboard grid and renders an honest, teaching empty state (never a blank
 * panel, never a fabricated number) wherever the hook reports there is
 * nothing to show yet.
 *
 * UI-19 layout, top to bottom:
 *  - Row 1 (status, at a glance): Streak, This week, Levels.
 *  - Row 2 (advancement): one card per track — a real checklist, never a
 *    disabled radio, and an Advance button that renders ONLY when it would
 *    actually do something.
 *  - Row 3 (evidence): the trend/assessment/tempo charts, theory retention
 *    (embeds `SrsSummary` unrestyled), repertoire status, and milestones.
 *  - Row 4: the practice sheet and export/restore, side by side.
 *
 * The manual level override (REQ-2.3) moves off each card's face into an
 * "Adjust level…" disclosure inside the Levels card — it is an escape hatch,
 * not the primary UI, so it no longer competes with the read-only level rows
 * for attention.
 */
import { useId, type ReactNode } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { ExportPanel } from '@app/progress/ExportPanel.tsx'
import { PracticeSheet } from '@app/progress/PracticeSheet.tsx'
import { MilestonePanel } from './MilestonePanel.tsx'
import { SrsSummary } from '@app/srs/SrsSummary.tsx'
import { ACTIVITY_KIND_LABELS } from '@app/progress/activityKindLabels.ts'
import { ACTIVITY_KINDS } from '@core/progress/log.ts'
import { MIN_LEVEL, MAX_LEVEL, type Track } from '@core/curriculum/types.ts'
import { canAdvance, type ProgressEvidence } from '@core/progress/levels.ts'
import { levelAt } from '@core/curriculum/model.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { TrendChart, type TrendChartPoint } from './TrendChart.tsx'
import { TechniqueTempoCard } from './TechniqueTempoCard.tsx'
import {
  useDashboard,
  type AssessmentTrendPoint,
  type DashboardData,
  type DashboardTrackLevel,
  type UseDashboardOptions,
} from './useDashboard.ts'

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

/** No "(s)"-style plural anywhere on this screen — "0 days", "1 day", "2 days". */
function pluralizeDay(count: number): string {
  return `${count} day${count === 1 ? '' : 's'}`
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

  const assessmentRunCounts: Record<string, number> = {}
  const assessmentPoints: readonly TrendChartPoint[] = data.assessmentTrend.map((p) => {
    const run = (assessmentRunCounts[p.scoreId] ?? 0) + 1
    assessmentRunCounts[p.scoreId] = run
    return { label: `${p.scoreTitle} run ${run}`, value: round(p.accuracy * 100) }
  })

  return (
    <div className="page page--wide dashboard-screen">
      <div className="page-header">
        <h1>Progress</h1>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-row dashboard-row--status">
          <StreakCard streak={data.streak} />
          <WeekCard weeklyMinutes={data.weeklyMinutes} minutesByKind={data.minutesByKind} />
          <LevelsCard levels={data.levels} />
        </div>

        <div className="dashboard-row dashboard-row--advance">
          {data.levels.map((l) => (
            <AdvanceCard key={l.track} level={l} evidence={data.evidence} />
          ))}
        </div>

        <div className="dashboard-row dashboard-row--evidence">
          <TrendCard
            title="Practice minutes"
            icon={<Icon name="chart" />}
            ariaLabel="Practice minutes trend"
            isEmpty={weeklyBarPoints.length === 0 || data.weeklyMinutes === 0}
            emptyTestId="dashboard-minutes-trend-empty"
            emptyText="No practice logged in the last week — start a session from Practice to see a trend here."
          >
            <TrendChart
              points={weeklyBarPoints}
              kind="bar"
              ariaLabel={`Minutes practiced per day, last ${data.dailyMinutes.length} days (rolling)`}
              valueSuffix=" min"
            />
          </TrendCard>

          <section
            className="card dashboard-card-trend"
            aria-label="Sight-reading accuracy trend"
            role="region"
          >
            <h2>
              <Icon name="chart" /> Sight-reading trend
            </h2>
            {/* roadmap 5.57: named and explained distinctly from the "sight-reading
                (curriculum track)" row in the Levels card — same word "level", two
                different numbers (see useDashboard.ts's module comment). This is the
                trainer's own adaptive level, known regardless of whether there is a
                run history yet to chart below — it must not hide behind the chart's
                own empty state. */}
            <p data-testid="dashboard-sightreading-level">
              Sight-reading trainer level: <b>{data.sightReadingLevel}</b>
            </p>
            <small data-testid="dashboard-sightreading-level-note">
              This chart plots the sight-reading trainer&rsquo;s own accuracy per run &mdash; it
              adapts automatically from your last few runs, separately from the curriculum track
              level in the Levels card.
            </small>
            {data.sightReadingTrend.length === 0 ? (
              <p role="status" className="empty-state" data-testid="dashboard-sightreading-empty">
                <Icon name="chart" />
                No sight-reading runs yet &mdash; start an exercise on the Sight reading screen.
              </p>
            ) : (
              <TrendChart
                points={sightReadingPoints}
                kind="line"
                ariaLabel="Sight-reading trainer accuracy over time"
                valueSuffix="%"
              />
            )}
          </section>

          <AssessmentCard
            points={assessmentPoints}
            isEmpty={data.assessmentTrend.length === 0}
            bestByScoreEntries={Object.entries(data.assessmentBestByScore)}
            assessmentTrend={data.assessmentTrend}
          />

          {/* Roadmap T.14: one line per drill, not every drill's clean bpm
              concatenated onto one. See TechniqueTempoCard's module doc. */}
          <TechniqueTempoCard series={data.techniqueTempoSeries} />

          {/* Roadmap UI-24: `card` was missing here and on nothing else in
              this row, so Theory retention alone rendered with no surface,
              padding or border between four neighbours that all had one. */}
          <section
            className="card dashboard-card-retention"
            aria-label="Theory retention"
            role="region"
          >
            <h2>
              <Icon name="cards" /> Theory retention
            </h2>
            <SrsSummary stats={data.retention} idPrefix="dashboard-retention" ariaLabel="Retention" />
          </section>

          <RepertoireCard pieces={data.repertoirePieces} due={data.repertoireDue} />

          <MilestonePanel milestones={data.milestones} />
        </div>

        <div className="dashboard-row dashboard-row--footer">
          <PracticeSheet {...props} />
          <ExportPanel />
        </div>
      </div>
    </div>
  )
}

type StreakCardProps = { readonly streak: DashboardData['streak'] }

function StreakCard({ streak }: StreakCardProps) {
  return (
    <section className="card dashboard-card-streak" aria-label="Streak" role="region">
      <h2>
        <Icon name="flame" /> Streak
      </h2>
      {/* Roadmap UI-24 (2026-08-15 final visual pass), DESIGN.md rule 6: a
          learner who has never practised was shown "0 days / 0 days" under
          Current and Longest — a row of zeros, the exact shape rule 6 names,
          and the one card on this screen that had no empty branch while every
          other card already teaches. Gated on `longestDays`, not
          `currentDays`: a lapsed streak (current 0, longest 12) is real
          history and the pair still says something worth reading. */}
      {streak.longestDays === 0 ? (
        <p role="status" className="empty-state" data-testid="dashboard-streak-empty">
          <Icon name="flame" />
          No streak yet &mdash; practise on two days in a row and it starts counting here.
        </p>
      ) : (
        <div className="stat-group" role="group" aria-label="Streak">
          <div className="stat">
            <b data-testid="dashboard-streak-current">{pluralizeDay(streak.currentDays)}</b>
            <small>Current</small>
          </div>
          <div className="stat">
            <b data-testid="dashboard-streak-longest">{pluralizeDay(streak.longestDays)}</b>
            <small>Longest</small>
          </div>
        </div>
      )}
    </section>
  )
}

type WeekCardProps = {
  readonly weeklyMinutes: number
  readonly minutesByKind: DashboardData['minutesByKind']
}

function WeekCard({ weeklyMinutes, minutesByKind }: WeekCardProps) {
  return (
    <section className="card dashboard-card-week" aria-label="This week" role="region">
      <h2>
        <Icon name="clock" /> This week
      </h2>
      {weeklyMinutes === 0 ? (
        <p role="status" className="empty-state" data-testid="dashboard-weekly-empty">
          <Icon name="clock" />
          No practice logged this week yet &mdash; start a session from Practice.
        </p>
      ) : (
        <>
          <p className="dashboard-glance-value" data-testid="dashboard-weekly-minutes">
            {round(weeklyMinutes)} min
          </p>
          <ul className="list" aria-label="Minutes by activity kind">
            {ACTIVITY_KINDS.map((kind) => (
              <li key={kind} data-testid={`dashboard-minutes-${kind}`}>
                {ACTIVITY_KIND_LABELS[kind]}: {round(minutesByKind[kind])} min
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

type LevelsCardProps = { readonly levels: readonly DashboardTrackLevel[] }

function LevelsCard({ levels }: LevelsCardProps) {
  const idPrefix = useId()
  return (
    <section className="card dashboard-card-levels" aria-label="Current level per track" role="region">
      <h2>
        <Icon name="target" /> Levels
      </h2>
      <ul className="level-track-list list">
        {levels.map((l) => {
          const met = l.criteria.filter((c) => c.met).length
          const pct = l.criteria.length === 0 ? 0 : Math.round((met / l.criteria.length) * 100)
          return (
            <li key={l.track} data-testid={`dashboard-level-${l.track}`} className="level-track-row">
              <div className="level-track-text">
                <span>
                  {TRACK_LABELS[l.track]}
                  {/* roadmap 5.57: only sight-reading gets the "(curriculum track)"
                      qualifier — see the sight-reading trend card's own note. */}
                  {l.track === 'sight-reading' ? ' (curriculum track)' : ''}: level <b>{l.level}</b>
                </span>
                <span>{l.overridden ? ' (overridden)' : ''}</span>
              </div>
              {l.track === 'sight-reading' && (
                <small data-testid="dashboard-level-sight-reading-note">
                  Moves when you meet this level&rsquo;s exit criteria or set it by hand below
                  &mdash; separate from the sight-reading trainer&rsquo;s own adaptive level in the
                  accuracy-trend card.
                </small>
              )}
              <div className="level-track-progress-bar" role="presentation">
                <div className="level-track-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </li>
          )
        })}
      </ul>

      <details className="level-adjust">
        <summary className="btn btn-ghost">Adjust level&hellip;</summary>
        <div className="level-adjust-body">
          {levels.map((l) => (
            <div className="field" key={l.track}>
              <label htmlFor={`${idPrefix}-${l.track}`}>{TRACK_LABELS[l.track]} level</label>
              <select
                id={`${idPrefix}-${l.track}`}
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
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}

type TrendCardProps = {
  readonly title: string
  readonly icon: ReactNode
  readonly ariaLabel: string
  readonly isEmpty: boolean
  readonly emptyTestId: string
  readonly emptyText: string
  readonly children: ReactNode
}

function TrendCard({ title, icon, ariaLabel, isEmpty, emptyTestId, emptyText, children }: TrendCardProps) {
  return (
    <section className="card dashboard-card-trend" aria-label={ariaLabel} role="region">
      <h2>
        {icon} {title}
      </h2>
      {isEmpty ? (
        <p role="status" className="empty-state" data-testid={emptyTestId}>
          {icon}
          {emptyText}
        </p>
      ) : (
        children
      )}
    </section>
  )
}

type AssessmentCardProps = {
  readonly points: readonly TrendChartPoint[]
  readonly isEmpty: boolean
  readonly bestByScoreEntries: readonly (readonly [string, number])[]
  readonly assessmentTrend: readonly AssessmentTrendPoint[]
}

function AssessmentCard({ points, isEmpty, bestByScoreEntries, assessmentTrend }: AssessmentCardProps) {
  return (
    <section className="card dashboard-card-trend" aria-label="Assessment accuracy" role="region">
      <h2>
        <Icon name="target" /> Assessment accuracy
      </h2>
      {isEmpty ? (
        <p role="status" className="empty-state" data-testid="dashboard-assessment-empty">
          <Icon name="target" />
          No assessment recorded yet &mdash; run an assessment from the Practice screen.
        </p>
      ) : (
        <>
          <TrendChart points={points} kind="line" ariaLabel="Assessment accuracy over time" valueSuffix="%" />
          <h3>Best accuracy per piece</h3>
          <ul aria-label="Best assessment accuracy per piece" className="list">
            {bestByScoreEntries.map(([scoreId, accuracy]) => {
              const scoreTitle =
                [...assessmentTrend].reverse().find((p) => p.scoreId === scoreId)?.scoreTitle ?? scoreId
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
  )
}

type RepertoireCardProps = {
  readonly pieces: DashboardData['repertoirePieces']
  readonly due: DashboardData['repertoireDue']
}

function RepertoireCard({ pieces, due }: RepertoireCardProps) {
  return (
    <section className="card dashboard-card-repertoire" aria-label="Repertoire status" role="region">
      <h2>
        <Icon name="book" /> Repertoire status
      </h2>
      {pieces.length === 0 ? (
        <p role="status" className="empty-state" data-testid="dashboard-repertoire-empty">
          <Icon name="book" />
          No repertoire pieces yet &mdash; add one from the Repertoire screen.
        </p>
      ) : (
        <>
          <ul aria-label="Repertoire pieces" className="list">
            {pieces.map((p) => (
              <li key={p.id} data-testid={`dashboard-repertoire-piece-${p.id}`}>
                {p.title}: {p.status}
              </li>
            ))}
          </ul>
          <h3>Due for review</h3>
          {due.length === 0 ? (
            <p role="status" data-testid="dashboard-repertoire-due-empty">
              Nothing due for review.
            </p>
          ) : (
            <ul aria-label="Repertoire pieces due for review" className="list">
              {due.map((p) => (
                <li key={p.id} data-testid={`dashboard-repertoire-due-${p.id}`}>
                  {p.title}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

type AdvanceCardProps = {
  readonly level: DashboardTrackLevel
  readonly evidence: ProgressEvidence
}

/**
 * One track's exit-criteria checklist plus its "Advance" control (roadmap
 * 2.36's second half, REQ-2.2; redesigned UI-19). Criteria render as a
 * checklist — a `check` icon when met, a hollow circle when not, never a
 * disabled radio input. The Advance button renders ONLY when the track can
 * actually advance: every criterion met AND not manually overridden.
 * `canAdvance` — the real core function, never re-derived from `criteria` by
 * hand — decides whether every criterion is met.
 */
function AdvanceCard({ level, evidence }: AdvanceCardProps) {
  const { track, level: levelNumber, overridden, criteria } = level
  return (
    <section
      className="card dashboard-card-advance"
      aria-label={`${TRACK_LABELS[track]} advancement`}
      role="region"
      data-testid={`dashboard-criteria-${track}`}
    >
      <h2>{TRACK_LABELS[track]}</h2>
      {criteria.length === 0 ? (
        <p role="status" className="empty-state" data-testid={`dashboard-criteria-empty-${track}`}>
          No curriculum content loaded for level {levelNumber} yet &mdash; nothing to check.
        </p>
      ) : (
        <TrackAdvancePanel
          track={track}
          level={levelNumber}
          overridden={overridden}
          criteria={criteria}
          evidence={evidence}
        />
      )}
    </section>
  )
}

type TrackAdvancePanelProps = {
  readonly track: Track
  readonly level: number
  readonly overridden: boolean
  readonly criteria: DashboardTrackLevel['criteria']
  readonly evidence: ProgressEvidence
}

function TrackAdvancePanel({ track, level, overridden, criteria, evidence }: TrackAdvancePanelProps) {
  const curriculumLevel = levelAt(CURRICULUM, level)
  // Defensive only: the caller already gates on `criteria.length > 0`, which
  // only happens once `curriculumLevel` was found — see useDashboard.ts.
  if (curriculumLevel === undefined) return null

  const meetsAllCriteria = canAdvance(
    useLevelStore.getState().levelState,
    curriculumLevel,
    track,
    evidence,
  )
  // REQ-2.3: an overridden track never auto-advances — `advanceTrack`
  // silently no-ops on it — so the button only ever renders when clicking it
  // would actually do something.
  const canAdvanceNow = !overridden && meetsAllCriteria

  return (
    <>
      <ul aria-label={`${TRACK_LABELS[track]} exit criteria`} className="exit-criteria list">
        {criteria.map((c, i) => (
          <li
            key={c.criterion.id}
            data-testid={`dashboard-criterion-${track}-${i}`}
            data-state={c.met ? 'met' : undefined}
            className="exit-criterion"
          >
            <span className="exit-criterion-icon" aria-hidden="true">
              {c.met ? <Icon name="check" /> : <span className="exit-criterion-circle" />}
            </span>
            <span className="exit-criterion-text">
              <span data-testid={`dashboard-criterion-status-${track}-${i}`}>
                {c.met ? 'Met' : 'Not met'}
              </span>{' '}
              {c.criterion.description}{' '}
              <span className="exit-criterion-progress">({round(c.progress * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>

      {canAdvanceNow && (
        <button
          type="button"
          className="btn-primary"
          data-testid={`dashboard-advance-${track}`}
          onClick={() => useLevelStore.getState().advanceTrack(curriculumLevel, track, evidence)}
        >
          Advance {TRACK_LABELS[track]}
        </button>
      )}

      {overridden && (
        <p
          role="status"
          data-testid={`dashboard-advance-disabled-reason-${track}`}
          className="dashboard-advance-note"
        >
          This track was placed manually and will not auto-advance.
        </p>
      )}
    </>
  )
}
