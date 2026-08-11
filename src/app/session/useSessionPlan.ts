/**
 * Wires `planSession` (`core/curriculum/session.ts`) to the app's real state
 * (roadmap 4.7a, REQ-3.1.4): the loaded score and the sight-reading level from
 * their stores become today's candidates (`candidates.ts`), the learner picks
 * a budget — 15/30/60 or any typed value — and an optionally adjusted mix,
 * and this hook returns the resulting `PlannedSession` or a readable error.
 *
 * `planSession` is pure; this hook's only job is reading the two stores,
 * holding the two pieces of UI state (`budgetMinutes`, `mix`) and re-running
 * the pure computation on every render where an input changed.
 */
import { useMemo, useState } from 'react'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import {
  DEFAULT_MIX,
  SESSION_LENGTHS,
  planSession,
  type MixableSegmentKind,
  type PlannedSession,
} from '@core/curriculum/session.ts'
import { isOk } from '@core/shared/result.ts'
import { sessionCandidates } from './candidates.ts'

/** The middle of `SESSION_LENGTHS` (30) — a sensible first budget to show. */
const DEFAULT_BUDGET_MINUTES = SESSION_LENGTHS[1] ?? 30

/** Upper bound on a learner-typed budget. `fillSegment` emits roughly one
 * item per few minutes, so an unbounded budget (a mistyped extra digit)
 * would synchronously build thousands of list items inside `useMemo` and
 * freeze the tab. 240 minutes (4 hours) is far beyond any real practice
 * session but still small enough to render instantly. */
export const MAX_BUDGET_MINUTES = 240

export type UseSessionPlanResult = {
  readonly budgetMinutes: number
  /** Sets the budget to any positive number — 15/30/60 or a learner-typed value (REQ-3.1.4). */
  readonly setBudgetMinutes: (minutes: number) => void
  /** Warm-up (roadmap 5.45) has no mix share — see `session.ts`'s module doc — so this only ever has the four mixable keys. */
  readonly mix: Readonly<Record<MixableSegmentKind, number>>
  /** Adjusts one segment's share; the others keep theirs (`planSession` normalises). */
  readonly setMixShare: (segment: MixableSegmentKind, share: number) => void
  readonly resetMix: () => void
  readonly plan: PlannedSession | undefined
  /** Set exactly when `plan` is undefined — `planSession`'s own error message, never swallowed. */
  readonly error: string | undefined
}

export function useSessionPlan(): UseSessionPlanResult {
  const loadedScore = useScoreStore((s) => s.loaded)
  const sightReadingLevel = useSightReadingStore((s) => s.level)

  const [budgetMinutes, setBudgetMinutesRaw] = useState<number>(DEFAULT_BUDGET_MINUTES)
  const [mix, setMix] = useState<Readonly<Record<MixableSegmentKind, number>>>(DEFAULT_MIX)

  // Clamp only the upper bound — non-positive/non-finite values are left as
  // given so planSession's own validation still rejects them with a readable
  // error (see useSessionPlan.test.ts's negative-budget case).
  const setBudgetMinutes = (minutes: number): void => {
    setBudgetMinutesRaw(Math.min(MAX_BUDGET_MINUTES, Math.floor(minutes)))
  }

  const setMixShare = (segment: MixableSegmentKind, share: number): void => {
    setMix((current) => ({ ...current, [segment]: share }))
  }
  const resetMix = (): void => setMix(DEFAULT_MIX)

  const candidates = useMemo(
    () => sessionCandidates({ sightReadingLevel, loadedScore }),
    [sightReadingLevel, loadedScore],
  )

  const result = useMemo(
    () => planSession(budgetMinutes, { mix, candidates }),
    [budgetMinutes, mix, candidates],
  )

  return {
    budgetMinutes,
    setBudgetMinutes,
    mix,
    setMixShare,
    resetMix,
    plan: isOk(result) ? result.value : undefined,
    error: isOk(result) ? undefined : result.error,
  }
}
