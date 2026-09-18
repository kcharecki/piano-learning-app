/**
 * Read-only drums progress screen (roadmap DR-23 "drums progress MVP") — one
 * place a drummer sees where they stand across all four trainers' stores:
 * rudiment tier completion, best steady tempo per groove, which limb tends
 * early/late, and the reading trainer's level with its last few accuracies.
 *
 * Deliberately read-only and thin, the same rule `DrumsTodayScreen.tsx`
 * holds itself to: every number here is aggregated by `@core/drums/progress`
 * from state the other four trainers already write; this screen adds no
 * practice logic of its own, only wiring and wording (`progressText.ts`).
 *
 * `useDrumsReadingStore`'s `runs` are newest-first, same as
 * `useDrumsHistoryStore`'s `attempts` (`drumsReadingStore.ts`'s own module
 * comment: "Newest first and capped", `addRun` prepends) — so the three most
 * recent runs are `runs.slice(0, 3)`, newest first. The Reading line then
 * reverses them: "last runs 80%, 90%, 100%" reads left to right in the order
 * they were played, so an improving learner sees the climb, not its mirror.
 */
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import { RUDIMENTS } from '@content/drums/rudiments.ts'
import {
  grooveBests,
  grooveCoverage,
  grooveTrends,
  limbBias,
  milestones,
  rudimentCoverage,
  tierCompletion,
  type CoverageItem,
} from '@core/drums/progress/index.ts'
import {
  biasLine,
  bestLine,
  formatDay,
  grooveCoverageLine,
  milestoneLine,
  milestoneSummaryLine,
  readingLine,
  rudimentCoverageLine,
  tierLine,
  trendLine,
} from '@app/drums/progressText.ts'

/** How many of the reading trainer's most recent runs the Reading panel names. */
const RECENT_READING_RUNS = 3

/**
 * Coverage's two lists — the trainer's library grooves and the rudiment
 * curriculum — never change at runtime, so both are computed once at module
 * load rather than on every render.
 */
const GROOVE_LIBRARY: readonly CoverageItem[] = grooveTrainerLibrary().map((g) => ({
  id: g.id,
  title: g.title,
}))
const RUDIMENT_ITEMS: readonly CoverageItem[] = RUDIMENTS.map((r) => ({ id: r.id, title: r.name }))

export function DrumsProgressScreen() {
  const records = useDrumsRudimentStore((s) => s.records)
  const attempts = useDrumsHistoryStore((s) => s.attempts)
  const level = useDrumsReadingStore((s) => s.level)
  const runs = useDrumsReadingStore((s) => s.runs)

  const tiers = tierCompletion(RUDIMENTS, records)
  const bests = grooveBests(attempts)
  const bias = limbBias(attempts)
  const trends = grooveTrends(attempts)
  const coverage = grooveCoverage(GROOVE_LIBRARY, attempts)
  const rudimentsCoverage = rudimentCoverage(RUDIMENT_ITEMS, records)
  const milestoneRows = milestones({
    attempts,
    rudimentRecords: records,
    rudiments: RUDIMENTS,
    library: GROOVE_LIBRARY,
  })
  const reachedMilestones = milestoneRows.filter((m) => m.reachedAt !== undefined).length
  const recentAccuracies = runs
    .slice(0, RECENT_READING_RUNS)
    .map((run) => run.accuracy)
    .reverse()

  return (
    <div
      className="page page--focus drums-progress-screen"
      role="region"
      aria-label="Drums progress"
    >
      <div className="page-header">
        <h1>Progress</h1>
        <p className="page-header-subtitle">Where you stand across every drums trainer.</p>
      </div>

      <div className="drums-progress-grid">
        <section
          className="card drums-progress-card"
          aria-labelledby="drums-progress-rudiments-heading"
        >
          <h2 id="drums-progress-rudiments-heading">Rudiments</h2>
          <ul className="drums-progress-list">
            {tiers.map((tier) => (
              <li key={tier.tier}>{tierLine(tier)}</li>
            ))}
          </ul>
        </section>

        <section
          className="card drums-progress-card"
          aria-labelledby="drums-progress-grooves-heading"
        >
          <h2 id="drums-progress-grooves-heading">Grooves</h2>
          {bests.length === 0 ? (
            <p className="drums-progress-empty">No groove runs yet — start one in Groove.</p>
          ) : (
            <ul className="drums-progress-list">
              {bests.map((best) => (
                <li key={best.grooveId}>{bestLine(best)}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="card drums-progress-card" aria-labelledby="drums-progress-bias-heading">
          <h2 id="drums-progress-bias-heading">Limb bias</h2>
          {bias.length === 0 ? (
            <p className="drums-progress-empty">Play a few groove runs to see which limb drifts.</p>
          ) : (
            <ul className="drums-progress-list">
              {bias.map((row) => (
                <li key={row.pad}>{biasLine(row)}</li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="card drums-progress-card"
          aria-labelledby="drums-progress-trends-heading"
        >
          <h2 id="drums-progress-trends-heading">Trends</h2>
          {trends.length === 0 ? (
            <p className="drums-progress-empty">
              Play a few runs of one groove to see whether it is tightening.
            </p>
          ) : (
            <ul className="drums-progress-list">
              {trends.map((trend) => (
                <li key={trend.grooveId}>{trendLine(trend)}</li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="card drums-progress-card"
          aria-labelledby="drums-progress-coverage-heading"
        >
          <h2 id="drums-progress-coverage-heading">Coverage</h2>
          <p aria-label="Groove coverage">{grooveCoverageLine(coverage)}</p>
          <p aria-label="Rudiment coverage">{rudimentCoverageLine(rudimentsCoverage)}</p>
        </section>

        <section
          className="card drums-progress-card"
          aria-labelledby="drums-progress-milestones-heading"
        >
          <h2 id="drums-progress-milestones-heading">Milestones</h2>
          <p aria-label="Milestone summary">
            {milestoneSummaryLine(reachedMilestones, milestoneRows.length)}
          </p>
          <ul className="drums-progress-list" aria-label="Milestones">
            {milestoneRows.map((row) => (
              <li key={row.id}>{milestoneLine(row, formatDay)}</li>
            ))}
          </ul>
        </section>

        <section
          className="card drums-progress-card"
          aria-labelledby="drums-progress-reading-heading"
        >
          <h2 id="drums-progress-reading-heading">Reading</h2>
          <p>{readingLine(level, recentAccuracies)}</p>
        </section>
      </div>
    </div>
  )
}
