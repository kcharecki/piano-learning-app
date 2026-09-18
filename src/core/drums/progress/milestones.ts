/**
 * Milestones (roadmap DR-23 "milestones") — a fixed set of six achievements
 * a drummer can reach across the groove and rudiment trainers, DERIVED from
 * attempts/records the other four `progress` modules already read, never a
 * separate "awarded" flag stored anywhere.
 *
 * STATE-FREE, the same shape every `progress` module here holds itself to:
 * `milestones` takes an already-read attempts/records/rudiments/library
 * collection and never decides what counts as "steady" or "at target"
 * beyond what the caller's own data says — that judgement lives in
 * `@core/drums/practice/grade.ts` and `useDrumsRudimentStore` (steady) and
 * in `rudimentTiers.ts`'s own `bestCleanBpm >= bpmBand.target` predicate
 * (at target), reused here rather than re-derived.
 *
 * Each attempt/record/rudiment parameter below is a narrowed structural
 * type carrying only the fields this module reads (grooveId/bpm/at/steady;
 * bestCleanBpm/at; id/tier/bpmBand.target) rather than the richer
 * `DrumsGrooveAttempt` (`@core/drums/practice/attempt.ts`), `RudimentRecord`
 * (`@app/state/drumsRudimentStore.ts` — `src/core` must never import
 * `@app/*`), or `Rudiment` (`@content/drums/rudiments.ts` — `src/core` must
 * never import `@content/*` either) — the same "pass the fields read, not
 * the record they live on" rule `coverage.ts` follows for its own
 * `CoverageItem`/attempts parameters.
 */

export type MilestoneId =
  | 'first-steady-run'
  | 'money-beat-100'
  | 'ten-steady-runs'
  | 'all-library-grooves-steady'
  | 'first-rudiment-at-target'
  | 'tier-1-complete'

export type MilestoneStatus = {
  readonly id: MilestoneId
  readonly title: string
  /** One line on how a learner reaches it — shown while `reachedAt` is undefined. */
  readonly how: string
  /** Epoch ms the milestone was reached; `undefined` when not yet reached. */
  readonly reachedAt: number | undefined
}

type MilestoneDefinition = {
  readonly id: MilestoneId
  readonly title: string
  /** One line: how a learner reaches this — carried onto `MilestoneStatus.how`. */
  readonly how: string
}

/** Fixed, ordered definitions — `milestones()` always outputs exactly these six, in this order. */
const MILESTONE_DEFINITIONS: readonly MilestoneDefinition[] = [
  {
    id: 'first-steady-run',
    title: 'First steady run',
    how: 'Play any groove steady once.',
  },
  {
    id: 'money-beat-100',
    title: 'Money Beat at 100',
    how: 'Play Money Beat steady at 100 bpm or faster.',
  },
  {
    id: 'ten-steady-runs',
    title: 'Ten steady runs',
    how: 'Reach 10 steady groove attempts, any groove.',
  },
  {
    id: 'all-library-grooves-steady',
    title: 'Every library groove steady',
    how: 'Play every groove in the library steady at least once.',
  },
  {
    id: 'first-rudiment-at-target',
    title: 'First rudiment at target',
    how: 'Bring any rudiment up to its own target tempo.',
  },
  {
    id: 'tier-1-complete',
    title: 'Tier 1 complete',
    how: 'Bring every tier-1 rudiment up to its own target tempo.',
  },
]

type GrooveAttemptLike = {
  readonly grooveId: string
  readonly bpm: number
  /** epoch ms */
  readonly at: number
  readonly steady: boolean
}

type RudimentRecordLike = {
  readonly bestCleanBpm: number
  /** epoch ms */
  readonly at: number
}

type RudimentLike = {
  readonly id: string
  readonly tier: number
  readonly bpmBand: { readonly target: number }
}

export type MilestonesInput = {
  readonly attempts: readonly GrooveAttemptLike[]
  readonly rudimentRecords: Readonly<Record<string, RudimentRecordLike>>
  readonly rudiments: readonly RudimentLike[]
  /** The library grooves `all-library-grooves-steady` is measured against; ids not in here are ignored by that milestone only. */
  readonly library: readonly { readonly id: string }[]
}

/** Earliest `at` in a non-empty list, `undefined` for an empty one. */
function earliestAt(ats: readonly number[]): number | undefined {
  return ats.length === 0 ? undefined : Math.min(...ats)
}

/** Latest `at` in a non-empty list, `undefined` for an empty one. */
function latestAt(ats: readonly number[]): number | undefined {
  return ats.length === 0 ? undefined : Math.max(...ats)
}

function firstSteadyRun(attempts: readonly GrooveAttemptLike[]): number | undefined {
  return earliestAt(attempts.filter((a) => a.steady).map((a) => a.at))
}

function moneyBeat100(attempts: readonly GrooveAttemptLike[]): number | undefined {
  return earliestAt(
    attempts.filter((a) => a.steady && a.grooveId === 'money-beat' && a.bpm >= 100).map((a) => a.at),
  )
}

/** `at` of the Nth steady attempt in chronological (ascending `at`) order, or `undefined` if fewer than `n` exist. */
function nthSteadyRun(attempts: readonly GrooveAttemptLike[], n: number): number | undefined {
  const chronological = attempts
    .filter((a) => a.steady)
    .map((a) => a.at)
    .sort((a, b) => a - b)
  return chronological.length < n ? undefined : chronological[n - 1]
}

const TEN_STEADY_RUNS_THRESHOLD = 10

function allLibraryGroovesSteady(
  attempts: readonly GrooveAttemptLike[],
  library: readonly { readonly id: string }[],
): number | undefined {
  if (library.length === 0) return undefined

  const perGrooveFirstSteady: number[] = []
  for (const item of library) {
    const at = earliestAt(
      attempts.filter((a) => a.steady && a.grooveId === item.id).map((a) => a.at),
    )
    if (at === undefined) return undefined
    perGrooveFirstSteady.push(at)
  }
  return latestAt(perGrooveFirstSteady)
}

/** A rudiment record "at target" — same predicate `rudimentTiers.ts`'s `tierCompletion` uses, reused rather than re-invented. */
function isAtTarget(rudiment: RudimentLike, record: RudimentRecordLike): boolean {
  return record.bestCleanBpm >= rudiment.bpmBand.target
}

function atTargetRecordTimes(
  rudiments: readonly RudimentLike[],
  records: Readonly<Record<string, RudimentRecordLike>>,
  tier?: number,
): readonly number[] {
  const times: number[] = []
  for (const rudiment of rudiments) {
    if (tier !== undefined && rudiment.tier !== tier) continue
    const record = records[rudiment.id]
    if (record !== undefined && isAtTarget(rudiment, record)) times.push(record.at)
  }
  return times
}

function firstRudimentAtTarget(
  rudiments: readonly RudimentLike[],
  records: Readonly<Record<string, RudimentRecordLike>>,
): number | undefined {
  return earliestAt(atTargetRecordTimes(rudiments, records))
}

const TIER_1: number = 1

function tier1Complete(
  rudiments: readonly RudimentLike[],
  records: Readonly<Record<string, RudimentRecordLike>>,
): number | undefined {
  const tier1Rudiments = rudiments.filter((r) => r.tier === TIER_1)
  if (tier1Rudiments.length === 0) return undefined
  const atTargetTimes = atTargetRecordTimes(tier1Rudiments, records, TIER_1)
  if (atTargetTimes.length < tier1Rudiments.length) return undefined
  return latestAt(atTargetTimes)
}

function reachedAtFor(id: MilestoneId, input: MilestonesInput): number | undefined {
  switch (id) {
    case 'first-steady-run':
      return firstSteadyRun(input.attempts)
    case 'money-beat-100':
      return moneyBeat100(input.attempts)
    case 'ten-steady-runs':
      return nthSteadyRun(input.attempts, TEN_STEADY_RUNS_THRESHOLD)
    case 'all-library-grooves-steady':
      return allLibraryGroovesSteady(input.attempts, input.library)
    case 'first-rudiment-at-target':
      return firstRudimentAtTarget(input.rudiments, input.rudimentRecords)
    case 'tier-1-complete':
      return tier1Complete(input.rudiments, input.rudimentRecords)
  }
}

/** All six milestones, always in `MILESTONE_DEFINITIONS` order, `reachedAt` `undefined` for any not yet reached. */
export function milestones(input: MilestonesInput): readonly MilestoneStatus[] {
  return MILESTONE_DEFINITIONS.map((def) => ({
    id: def.id,
    title: def.title,
    how: def.how,
    reachedAt: reachedAtFor(def.id, input),
  }))
}
