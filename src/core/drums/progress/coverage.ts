/**
 * Practice coverage (roadmap DR-23 "coverage") — which library grooves and
 * curriculum rudiments a drummer has never touched, or touched but not yet
 * played steady. Answers "what have I not touched yet" rather than "how good
 * am I at what I have played", which is what `grooveBests.ts`/
 * `rudimentTiers.ts` already answer.
 *
 * STATE-FREE, the same shape every `progress` module here holds itself to:
 * `grooveCoverage`/`rudimentCoverage` take an already-read library/curriculum
 * list and an already-read attempts/records collection, and never decide
 * what counts as "steady" or "started" beyond what the caller's own data
 * says — that judgement lives in `@core/drums/practice/grade.ts` and
 * `useDrumsRudimentStore` respectively.
 *
 * `CoverageItem` is a minimal structural echo of a library groove
 * (`GrooveScore`, `@core/drums/practice/library.ts`) or a curriculum
 * `Rudiment` (`@content/drums/rudiments.ts`) — only `id`/`title` are needed
 * here, so the caller maps its richer value down rather than this module
 * importing either (avoiding a `@core` -> `@content` edge, and keeping this
 * module usable for any future coverage list with the same shape).
 */

export type CoverageItem = {
  readonly id: string
  readonly title: string
}

export type GrooveCoverage = {
  readonly total: number
  /** Distinct library grooves with >= 1 attempt. */
  readonly played: number
  /** Distinct library grooves with >= 1 steady attempt. */
  readonly steady: number
  /** Library grooves with no attempt at all, in library order. */
  readonly neverPlayed: readonly CoverageItem[]
  /** Library grooves with an attempt but no steady attempt, in library order. */
  readonly playedNotSteady: readonly CoverageItem[]
}

/**
 * Attempts on a `grooveId` outside `library` are ignored entirely — they can
 * never be found by the `id ->` item lookup below, so they never contribute
 * to `played`, `steady`, or either list.
 */
export function grooveCoverage(
  library: readonly CoverageItem[],
  attempts: readonly { readonly grooveId: string; readonly steady: boolean }[],
): GrooveCoverage {
  const anyAttempt = new Set<string>()
  const steadyAttempt = new Set<string>()
  for (const attempt of attempts) {
    anyAttempt.add(attempt.grooveId)
    if (attempt.steady) steadyAttempt.add(attempt.grooveId)
  }

  const neverPlayed: CoverageItem[] = []
  const playedNotSteady: CoverageItem[] = []
  let played = 0
  let steady = 0

  for (const item of library) {
    const hasAttempt = anyAttempt.has(item.id)
    const hasSteady = steadyAttempt.has(item.id)
    if (hasAttempt) played += 1
    if (hasSteady) steady += 1
    if (!hasAttempt) neverPlayed.push(item)
    else if (!hasSteady) playedNotSteady.push(item)
  }

  return { total: library.length, played, steady, neverPlayed, playedNotSteady }
}

export type RudimentCoverage = {
  readonly total: number
  /** Rudiments with a record. */
  readonly started: number
  /** The first `n` unstarted rudiments, in the given curriculum order. */
  readonly nextUp: readonly CoverageItem[]
}

/**
 * A record keyed by an id that names no rudiment in `rudiments` is silently
 * ignored, the same rule `tierCompletion` holds itself to: it can never be
 * found by any rudiment's own id, so it never counts toward `started` or
 * excludes anything from `nextUp`.
 */
export function rudimentCoverage(
  rudiments: readonly CoverageItem[],
  records: Readonly<Record<string, unknown>>,
  n = 3,
): RudimentCoverage {
  let started = 0
  const nextUp: CoverageItem[] = []

  for (const rudiment of rudiments) {
    const hasRecord = records[rudiment.id] !== undefined
    if (hasRecord) {
      started += 1
    } else if (nextUp.length < n) {
      nextUp.push(rudiment)
    }
  }

  return { total: rudiments.length, started, nextUp }
}
