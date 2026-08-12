/**
 * `useDashboard` (roadmap 4.7, REQ-3.10.1/REQ-3.10.2): reads already-persisted
 * store state and reduces it for display via the core functions. Every
 * assertion below either (a) recomputes the expected value with the same
 * core function the hook uses, so a hardcoded `0` or a mislabelled stat
 * fails, or (b) asserts the documented empty state for a section with no
 * writer yet (only level state today — technique attempts and repertoire
 * pieces both have real writers now, roadmap 2.33, and are seeded and
 * asserted non-empty below).
 */
import type { DateSource } from '@core/ports/index.ts'
import {
  currentStreakDays,
  dailyTotals,
  longestStreakDays,
  minutesByKind,
  totalMinutes,
  type ActivityKind,
  type PracticeEntry,
} from '@core/progress/log.ts'
import { DAY_MS, retentionStats, type Card } from '@core/srs/scheduler.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import { TRACKS, type ExitCriterion } from '@core/curriculum/types.ts'
import {
  evaluateCriterion,
  initialLevelState,
  trackProgress,
  type LevelState,
  type ProgressEvidence,
} from '@core/progress/levels.ts'
import { levelAt } from '@core/curriculum/model.ts'
import { computeMilestones } from '@core/progress/milestones.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { act, renderHook, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { StoredAssessment } from '@app/state/progressStore.ts'
import type { AssessmentResult } from '@core/practice/assessment.ts'
import {
  emptyEarSession,
  EAR_MIN_LEVEL,
  type EarAttempt,
  type EarSessionState,
} from '@core/eartraining/session.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import { useDashboard, type UseDashboardOptions } from './useDashboard.ts'

class FakeDateSource implements DateSource {
  private current: number
  constructor(current: number) {
    this.current = current
  }
  epochMillis(): number {
    return this.current
  }
}

// Deliberately NOT a midnight instant: `now` sits at 20:00 on an arbitrary
// day, so subtracting a session's duration (or a whole number of days) never
// silently crosses a local-day boundary the fixture did not intend, under
// utcOffsetMinutes = 0.
const NOW = 20_000 * DAY_MS + 20 * 60 * 60 * 1000

function resetStores(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
  useTechniqueStore.setState({ attempts: [] })
  useRepertoireStore.setState({ pieces: [] })
  useLevelStore.setState({ levelState: initialLevelState() })
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
}

afterEach(() => {
  cleanup()
  resetStores()
})

function entry(
  dayOffset: number,
  minutes: number,
  kind: ActivityKind,
  itemName: string,
): PracticeEntry {
  // Ends at the same time-of-day, `dayOffset` days before `NOW` — so a
  // reasonable `minutes` duration never crosses into the previous local day.
  const endedAt = NOW - dayOffset * DAY_MS
  return {
    id: `pe-${dayOffset}-${kind}`,
    startedAt: endedAt - minutes * 60_000,
    endedAt,
    kind,
    itemName,
  }
}

function setup(overrides: Partial<UseDashboardOptions> = {}) {
  const date: DateSource = overrides.date ?? new FakeDateSource(NOW)
  const options: UseDashboardOptions = { date, utcOffsetMinutes: 0, ...overrides }
  return renderHook((p: UseDashboardOptions) => useDashboard(p), { initialProps: options })
}

describe('useDashboard — empty stores', () => {
  it('reports honest zeros/empties for every section, never a fabricated number', () => {
    const { result } = setup()
    const data = result.current

    expect(data.streak).toEqual({ currentDays: 0, longestDays: 0 })
    expect(data.weeklyMinutes).toBe(0)
    for (const kind of Object.values(data.minutesByKind)) expect(kind).toBe(0)
    // A rolling 7*24h window touches 7 or 8 distinct local calendar days
    // depending on what time of day "now" is — dailyTotals's own job, not
    // this hook's to second-guess — so assert "at least a week's worth of
    // zero-filled days", not a hardcoded bucket count.
    expect(data.dailyMinutes.length).toBeGreaterThanOrEqual(7)
    expect(data.dailyMinutes.every((d) => d.minutes === 0)).toBe(true)

    expect(data.sightReadingLevel).toBe(MIN_LEVEL)
    expect(data.sightReadingTrend).toEqual([])
    expect(data.assessmentTrend).toEqual([])
    expect(data.assessmentBestByScore).toEqual({})

    expect(data.retention).toEqual({ total: 0, due: 0, young: 0, mature: 0, averageEase: 0 })

    expect(data.techniqueAttempts).toEqual([])
    expect(data.repertoirePieces).toEqual([])
    expect(data.repertoireDue).toEqual([])

    // The shipped curriculum (roadmap 4.9) covers levels 1-3, and every track
    // starts at level 1 (initialLevelState), so curriculumAvailable is true
    // and criteria are populated — never a hardcoded `[]` — even with zero
    // evidence recorded anywhere. Derive the expectation from the real core
    // function/content rather than restating each CriterionStatus by hand.
    expect(data.curriculumAvailable).toBe(true)
    expect(data.levels).toHaveLength(TRACKS.length)
    const initial = initialLevelState()
    const emptyEvidence: ProgressEvidence = {
      assessments: {},
      bestAssessmentAccuracy: 0,
      sightReadingLevel: MIN_LEVEL,
      sightReadingAccuracy: 0,
      theoryRetention: 0,
      // A never-touched ear-training session has recorded zero attempts, so
      // earTrainingLevel is 0 (no-evidence), not EAR_MIN_LEVEL — every kind
      // starting at EAR_MIN_LEVEL is what an untouched session looks like,
      // not evidence that level 1 was ever demonstrated.
      earTrainingLevel: 0,
      techniqueBpm: {},
    }
    const level1 = levelAt(CURRICULUM, 1)
    if (level1 === undefined) throw new Error('test setup: CURRICULUM must ship level 1')
    for (const l of data.levels) {
      expect(l.level).toBe(initial.levels[l.track])
      expect(l.overridden).toBe(initial.overridden[l.track])
      expect(l.criteria).toEqual(trackProgress(initial, level1, l.track, emptyEvidence))
      // Nothing has been recorded anywhere, so every criterion at level 1 —
      // which always has at least one — must read unmet.
      expect(l.criteria.length).toBeGreaterThan(0)
      expect(l.criteria.every((c) => !c.met)).toBe(true)
    }

    expect(data.techniqueTrend).toEqual([])
    expect(data.techniqueBestBpmByDrill).toEqual({})

    // Milestones (roadmap B.4): honest zeros on a fresh profile, never a
    // fabricated achievement — five milestones, all unachieved.
    expect(data.milestones).toHaveLength(5)
    for (const m of data.milestones) {
      expect(m.achieved).toBe(false)
      expect(m.achievedAt).toBeNull()
      expect(m.progress).toBe(0)
    }
  })
})

describe('useDashboard — milestones (roadmap B.4, REQ-3.10.3)', () => {
  it('matches computeMilestones exactly for the same seeded inputs — never re-derived by hand', () => {
    const attempts: TechniqueAttempt[] = [
      { drillId: 'scale-c-major-2oct-hands-together', at: NOW - 1_000, bpm: 84, evenness: 1, accuracy: 1, clean: true },
    ]
    useTechniqueStore.setState({ attempts })

    const { result } = setup()
    const expected = computeMilestones(
      {
        practiceEntries: [],
        utcOffsetMinutes: 0,
        techniqueAttempts: attempts,
        repertoirePieces: [],
        earTraining: emptyEarSession(),
      },
      new FakeDateSource(NOW),
    )
    expect(result.current.milestones).toEqual(expected)
    // Sanity: this seed is a real clean hands-together attempt, so the
    // first-hands-together milestone must actually be achieved, not just
    // structurally equal to some other empty computation.
    const handsTogether = result.current.milestones.find((m) => m.id === 'first-hands-together')
    expect(handsTogether?.achieved).toBe(true)
  })
})

describe('useDashboard — practice log', () => {
  it('matches core/progress/log\'s own functions for streak, weekly time, per-kind and daily totals', () => {
    const entries: PracticeEntry[] = [
      entry(0, 30, 'technique', 'Scales'),
      entry(1, 15, 'sightreading', 'Level 2 piece'),
      entry(3, 10, 'repertoire', 'Fur Elise'),
      entry(4, 10, 'theory', 'Key signatures'),
      entry(5, 10, 'eartraining', 'Interval drill'),
    ]
    useProgressStore.setState({ practiceEntries: entries })

    const { result } = setup()
    const data = result.current

    const from = NOW - 7 * DAY_MS
    expect(data.streak.currentDays).toBe(currentStreakDays(entries, NOW, 0))
    expect(data.streak.longestDays).toBe(longestStreakDays(entries, 0))
    // Sanity: the fixture is built so today+yesterday streak (2) differs from
    // the longer, older run of three consecutive days (3) — a stat that
    // silently swapped current/longest would still pass an `.toBe(core(...))`
    // assertion against itself, so pin the actual numbers too.
    expect(data.streak.currentDays).toBe(2)
    expect(data.streak.longestDays).toBe(3)

    expect(data.weeklyMinutes).toBe(totalMinutes(entries, from, NOW))
    expect(data.weeklyMinutes).toBe(75)

    expect(data.minutesByKind).toEqual(minutesByKind(entries, from, NOW))
    expect(data.minutesByKind.technique).toBe(30)
    expect(data.minutesByKind.sightreading).toBe(15)

    expect(data.dailyMinutes).toEqual(dailyTotals(entries, from, NOW, 0))
  })

  it('buckets by LOCAL day, not UTC day — a non-zero offset changes the streak and daily totals', () => {
    // A session that ends 30 minutes after UTC midnight: under offset 0 it
    // falls on the later UTC day; under offset -720 (UTC-12) local time is
    // still the previous day. A hardcoded `0` in place of the offset option
    // would make both runs agree.
    const utcMidnight = 20_000 * DAY_MS
    const entries: PracticeEntry[] = [
      {
        id: 'pe-boundary',
        startedAt: utcMidnight,
        endedAt: utcMidnight + 30 * 60_000,
        kind: 'technique',
        itemName: 'Scales',
      },
    ]
    useProgressStore.setState({ practiceEntries: entries })
    const now = utcMidnight + 30 * 60_000

    const zeroOffset = renderHook((p: UseDashboardOptions) => useDashboard(p), {
      initialProps: { date: new FakeDateSource(now), utcOffsetMinutes: 0 },
    })
    const negativeOffset = renderHook((p: UseDashboardOptions) => useDashboard(p), {
      initialProps: { date: new FakeDateSource(now), utcOffsetMinutes: -720 },
    })

    expect(negativeOffset.result.current.dailyMinutes).not.toEqual(
      zeroOffset.result.current.dailyMinutes,
    )
    expect(negativeOffset.result.current.streak.currentDays).toBe(
      currentStreakDays(entries, now, -720),
    )
    expect(negativeOffset.result.current.dailyMinutes).toEqual(
      dailyTotals(entries, now - 7 * DAY_MS, now, -720),
    )

    zeroOffset.unmount()
    negativeOffset.unmount()
  })
})

describe('useDashboard — sight-reading history', () => {
  it('reports the persisted level and an oldest-first accuracy trend regardless of storage order', () => {
    const history: SightReadingRecord[] = [
      { pieceId: 'p2', readAt: NOW - 1_000, accuracy: 0.9, level: 3 },
      { pieceId: 'p1', readAt: NOW - 5_000, accuracy: 0.7, level: 2 },
    ]
    useSightReadingStore.setState({ level: 4, history })

    const { result } = setup()
    const data = result.current

    expect(data.sightReadingLevel).toBe(4)
    expect(data.sightReadingTrend).toEqual([
      { at: NOW - 5_000, accuracy: 0.7 },
      { at: NOW - 1_000, accuracy: 0.9 },
    ])
  })
})

function assessmentResult(accuracy: number, completedAt: number): AssessmentResult {
  return {
    scoreId: 'irrelevant', // StoredAssessment.scoreId is the one the hook reads
    accuracy,
    timingConsistency: 1,
    meanAbsDeviationMs: 0,
    tempoBpm: 120,
    measures: [],
    counts: { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt,
  }
}

function storedAssessment(
  id: string,
  scoreId: string,
  scoreTitle: string,
  at: number,
  accuracy: number,
): StoredAssessment {
  return { id, scoreId, scoreTitle, at, result: assessmentResult(accuracy, at) }
}

describe('useDashboard — repertoire assessment history (roadmap 4.7c, REQ-3.3.4)', () => {
  it('reports an oldest-first trend across scores and the MAXIMUM accuracy per scoreId, not the latest or first', () => {
    // 'piece-a' has its best run in the MIDDLE (0.95) — the mutant that
    // matters: a "latest" or "first" reduction would report 0.7 or 0.6.
    // Seeded neither ascending nor descending by `at` — `applyProgressSnapshot`
    // can replace `assessments` wholesale with any storage order, so a
    // `.reverse()` mutant in place of the real `.sort` must also fail here.
    const assessments: StoredAssessment[] = [
      storedAssessment('a2', 'piece-a', 'Fur Elise', NOW - 3_000, 0.95),
      storedAssessment('a3', 'piece-a', 'Fur Elise', NOW - 1_000, 0.7),
      storedAssessment('b1', 'piece-b', 'Clair de Lune', NOW - 2_000, 0.5),
      storedAssessment('a1', 'piece-a', 'Fur Elise', NOW - 5_000, 0.6),
    ]
    useProgressStore.setState({ assessments })

    const { result } = setup()
    const data = result.current

    expect(data.assessmentTrend).toEqual([
      { at: NOW - 5_000, accuracy: 0.6, scoreId: 'piece-a', scoreTitle: 'Fur Elise' },
      { at: NOW - 3_000, accuracy: 0.95, scoreId: 'piece-a', scoreTitle: 'Fur Elise' },
      { at: NOW - 2_000, accuracy: 0.5, scoreId: 'piece-b', scoreTitle: 'Clair de Lune' },
      { at: NOW - 1_000, accuracy: 0.7, scoreId: 'piece-a', scoreTitle: 'Fur Elise' },
    ])
    expect(data.assessmentBestByScore).toEqual({ 'piece-a': 0.95, 'piece-b': 0.5 })
  })

  it('keeps the assessment trend and the sight-reading trend as two separate, non-conflated sources', () => {
    const assessments: StoredAssessment[] = [
      storedAssessment('a1', 'piece-a', 'Fur Elise', NOW - 1_000, 0.8),
    ]
    useProgressStore.setState({ assessments })
    const sightReadingHistory: SightReadingRecord[] = [
      { pieceId: 'p1', readAt: NOW - 4_000, accuracy: 0.4, level: 1 },
    ]
    useSightReadingStore.setState({ level: 1, history: sightReadingHistory })

    const { result } = setup()
    const data = result.current

    expect(data.assessmentTrend).toEqual([
      { at: NOW - 1_000, accuracy: 0.8, scoreId: 'piece-a', scoreTitle: 'Fur Elise' },
    ])
    expect(data.sightReadingTrend).toEqual([{ at: NOW - 4_000, accuracy: 0.4 }])
  })

  it('recomputes when an assessment is added AFTER the initial render, not just on mount', () => {
    const { result } = setup()
    expect(result.current.assessmentTrend).toEqual([])

    act(() => {
      useProgressStore
        .getState()
        .addAssessment(storedAssessment('a2', 'piece-a', 'Fur Elise', NOW - 1_000, 0.9))
    })

    expect(result.current.assessmentTrend).toEqual([
      { at: NOW - 1_000, accuracy: 0.9, scoreId: 'piece-a', scoreTitle: 'Fur Elise' },
    ])
    expect(result.current.assessmentBestByScore).toEqual({ 'piece-a': 0.9 })
  })
})

describe('useDashboard — flashcard SRS retention', () => {
  it('matches core/srs/scheduler\'s retentionStats over the persisted theory cards, excluding reading-drill cards', () => {
    const theoryCards: Card[] = [
      {
        id: 'key-signature-0',
        due: NOW - 1,
        intervalDays: 30,
        ease: 2.6,
        reps: 5,
        lapses: 0,
        introducedAt: NOW - 100 * DAY_MS,
      },
      {
        id: 'interval-on-staff-60-3-major',
        due: NOW + DAY_MS,
        intervalDays: 3,
        ease: 2.3,
        reps: 2,
        lapses: 1,
        introducedAt: NOW - 10 * DAY_MS,
      },
    ]
    // Reading-drill cards (not theory) — must be excluded from "Theory retention".
    const readingCards: Card[] = [
      { id: 'note-name-60', due: NOW, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: NOW },
      { id: 'staff-to-key-64', due: NOW, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: NOW },
    ]
    const cardsById = Object.fromEntries(
      [...theoryCards, ...readingCards].map((c) => [c.id, c]),
    )
    useFlashcardStore.setState({ cardsById })

    const { result } = setup()

    expect(result.current.retention).toEqual(retentionStats(theoryCards, NOW))
    expect(result.current.retention.total).toBe(2)
  })
})

describe('useDashboard — repertoire maintenance', () => {
  it('calls the real maintenanceDue(repertoirePieces, now) — a piece practiced long ago is due, one practiced recently is not', () => {
    const overdue: RepertoirePiece = {
      id: 'piece-overdue',
      title: 'Fur Elise',
      composer: 'Beethoven',
      level: 3,
      status: 'maintained',
      // 40 days since the last session, well past the maintenance interval.
      sessions: [{ at: NOW - 40 * DAY_MS, minutes: 20, accuracy: 0.9 }],
      bestAccuracy: 0.9,
      notes: '',
    }
    const recent: RepertoirePiece = {
      id: 'piece-recent',
      title: 'Clair de Lune',
      composer: 'Debussy',
      level: 4,
      status: 'maintained',
      // 2 days since the last session — nowhere near due.
      sessions: [{ at: NOW - 2 * DAY_MS, minutes: 15, accuracy: 0.85 }],
      bestAccuracy: 0.85,
      notes: '',
    }
    useRepertoireStore.setState({ pieces: [overdue, recent] })

    const { result } = setup()

    expect(result.current.repertoirePieces).toEqual([overdue, recent])
    expect(result.current.repertoireDue.map((p) => p.id)).toEqual(['piece-overdue'])
  })
})

describe('useDashboard — technique tempo trend', () => {
  it("reads useTechniqueStore's attempts and computes a non-empty trend carrying the seeded drill ids — the assertion 4.4b's staleness would have caught", () => {
    const attempts: TechniqueAttempt[] = [
      { drillId: 'scale-c-major', at: NOW - 3 * DAY_MS, bpm: 80, evenness: 0.9, accuracy: 1, clean: true },
      { drillId: 'scale-c-major', at: NOW - 1 * DAY_MS, bpm: 92, evenness: 0.95, accuracy: 1, clean: true },
      { drillId: 'arpeggio-g-major', at: NOW - 2 * DAY_MS, bpm: 70, evenness: 0.8, accuracy: 1, clean: true },
    ]
    useTechniqueStore.setState({ attempts })

    const { result } = setup()

    expect(result.current.techniqueAttempts).toEqual(attempts)
    expect(result.current.techniqueTrend.length).toBeGreaterThan(0)
    const drillIds = new Set(result.current.techniqueTrend.map((p) => p.drillId))
    expect(drillIds).toEqual(new Set(['scale-c-major', 'arpeggio-g-major']))
    expect(result.current.techniqueBestBpmByDrill['scale-c-major']).toBe(92)
    expect(result.current.techniqueBestBpmByDrill['arpeggio-g-major']).toBe(70)
  })
})

describe('useDashboard — level store (roadmap 2.36)', () => {
  it('reports the real curriculum level and overridden flag per track from useLevelStore', () => {
    // Playing and sight-reading sit at 4/5, which roadmap 3.24 authored for
    // THEORY only — so those two tracks have no exit criteria there, while
    // theory at 4 does. That split is the point: this test is about level and
    // overridden being reported verbatim per track, and it must not depend on
    // every track happening to be uncovered.
    const levelState: LevelState = {
      levels: { playing: 4, 'sight-reading': 5, theory: 4 },
      overridden: { playing: true, 'sight-reading': false, theory: true },
    }
    useLevelStore.setState({ levelState })

    const { result } = setup()
    const data = result.current

    expect(data.levels).toHaveLength(TRACKS.length)
    for (const track of TRACKS) {
      const row = data.levels.find((l) => l.track === track)
      expect(row?.level).toBe(levelState.levels[track])
      expect(row?.overridden).toBe(levelState.overridden[track])
    }
    expect(data.levels.find((l) => l.track === 'playing')?.criteria).toEqual([])
    expect(data.levels.find((l) => l.track === 'sight-reading')?.criteria).toEqual([])
    expect(
      data.levels.find((l) => l.track === 'theory')?.criteria.length,
    ).toBeGreaterThan(0)
    expect(data.curriculumAvailable).toBe(false)
  })

  it('keeps the curriculum sight-reading level and the adaptive sightReadingLevel independent — they are different numbers', () => {
    // The curriculum track level (from useLevelStore) and the adaptive
    // trainer's own difficulty (from useSightReadingStore) must never be
    // collapsed into one number — see useDashboard's module comment.
    useLevelStore.setState({
      levelState: {
        levels: { playing: 1, 'sight-reading': 5, theory: 1 },
        overridden: { playing: false, 'sight-reading': false, theory: false },
      },
    })
    useSightReadingStore.setState({ level: 2, history: [] })

    const { result } = setup()
    const data = result.current

    expect(data.sightReadingLevel).toBe(2)
    const sightReadingRow = data.levels.find((l) => l.track === 'sight-reading')
    expect(sightReadingRow?.level).toBe(5)
    expect(data.sightReadingLevel).not.toBe(sightReadingRow?.level)
  })
})

describe('useDashboard — ear-training level (roadmap 3.22)', () => {
  // A non-empty `attempts` array marks this as a session that has actually
  // recorded evidence, distinguishing "several kinds already practised at
  // these levels" from "completely untouched" — see useDashboard's
  // earTrainingLevel doc comment for why that distinction matters.
  function sessionWithLevels(levels: Readonly<Record<EarItemKind, number>>): EarSessionState {
    const seedAttempt: EarAttempt = {
      itemId: 'seed',
      kind: 'interval-melodic',
      accuracy: 1,
      at: 0,
      level: 1,
    }
    return { ...emptyEarSession(), levels, attempts: [seedAttempt] }
  }

  it('reports the MINIMUM of the six per-kind levels, not their mean or max', () => {
    const levels: Record<EarItemKind, number> = {
      'interval-melodic': 3,
      'interval-harmonic': 4,
      'chord-quality': 2,
      'scale-mode': 5,
      'melodic-dictation': 4,
      'rhythmic-dictation': 3,
    }
    useEarTrainingStore.setState({ session: sessionWithLevels(levels), itemsById: {} })

    const { result } = setup()

    // The minimum (2), not the mean (~3.5, which would round to 3 or 4) or
    // the max (5) — a mean/max reduction would report a number the learner
    // never actually demonstrated on the weakest kind (chord-quality).
    expect(result.current.evidence.earTrainingLevel).toBe(2)
  })

  it('a kind that was never practised (still at EAR_MIN_LEVEL) pins the minimum down — the flattering-advance case', () => {
    const levels: Record<EarItemKind, number> = {
      'interval-melodic': 5,
      'interval-harmonic': 5,
      'chord-quality': 5,
      'scale-mode': 5,
      'melodic-dictation': 5,
      'rhythmic-dictation': EAR_MIN_LEVEL, // never practised — still at its starting level
    }
    useEarTrainingStore.setState({ session: sessionWithLevels(levels), itemsById: {} })

    const { result } = setup()

    // Stub this kills: a mean-based reduction would report ~4.2 (rounds to 4
    // or 5), and a max-based one would report 5 — either would let an
    // `ear-training` exit check advance on evidence that was never collected
    // for rhythmic dictation. The minimum correctly refuses to be flattered
    // by the five strong kinds.
    expect(result.current.evidence.earTrainingLevel).toBe(EAR_MIN_LEVEL)
  })

  it('a fresh session with zero attempts reports 0, not EAR_MIN_LEVEL — the no-evidence case', () => {
    const { result } = setup()
    // Stub this kills: reducing an untouched session's per-kind levels
    // (all EAR_MIN_LEVEL) with Math.min alone, without checking for zero
    // recorded attempts first, reports 1 here instead of 0.
    expect(result.current.evidence.earTrainingLevel).toBe(0)
  })

  it('an { kind: "ear-training", minLevel: 1 } exit criterion reads UNMET on a fresh session', () => {
    const { result } = setup()
    const criterion: ExitCriterion = {
      id: 'test-ear-training-floor',
      track: 'theory',
      description: 'test criterion',
      check: { kind: 'ear-training', minLevel: 1 },
    }
    // Stub this kills: earTrainingLevel reporting EAR_MIN_LEVEL (1) for zero
    // attempts would make `1 >= 1` read MET, advancing an ear-training exit
    // check on evidence that was never collected.
    expect(evaluateCriterion(criterion, result.current.evidence).met).toBe(false)
  })

  it('recomputes when the ear-training store changes AFTER the initial render, not just on mount', () => {
    const { result } = setup()
    expect(result.current.evidence.earTrainingLevel).toBe(0)

    act(() => {
      useEarTrainingStore.setState({
        session: sessionWithLevels({
          'interval-melodic': 2,
          'interval-harmonic': 2,
          'chord-quality': 2,
          'scale-mode': 2,
          'melodic-dictation': 2,
          'rhythmic-dictation': 2,
        }),
        itemsById: {},
      })
    })

    expect(result.current.evidence.earTrainingLevel).toBe(2)
  })
})

describe('useDashboard — exit criteria evidence assembly (roadmap 2.36 second half, REQ-2.2)', () => {
  it('builds evidence from real store state and matches trackProgress for a track with SOME criteria met and others not', () => {
    // 'playing' at level 1 has exactly two exit checks: assessment and
    // technique (see LEVEL_1_EXIT_CRITERIA in curriculum.ts) — seed one met,
    // one unmet, so a "both true" or "both false" mutant in the evidence
    // assembly would be caught.
    useProgressStore.setState({
      assessments: [
        storedAssessment(
          'a1',
          'demo-five-finger-c-major-hands-separately',
          'Simple piece',
          NOW - 1_000,
          0.9, // >= the 0.75 threshold: MET
        ),
      ],
    })
    useTechniqueStore.setState({
      attempts: [
        {
          drillId: 'five-finger-c-major-hands-right',
          at: NOW - 1_000,
          bpm: 40, // below the 56 bpm threshold: UNMET
          evenness: 0.9,
          accuracy: 1,
          clean: true,
        },
      ],
    })
    // 'sight-reading' at level 1 needs level >= 1 and mean recent accuracy
    // >= 0.8 — both cleared, so this track's single criterion is fully MET.
    useSightReadingStore.setState({
      level: 1,
      history: [
        { pieceId: 'p1', readAt: NOW - 3_000, accuracy: 0.9, level: 1 },
        { pieceId: 'p2', readAt: NOW - 2_000, accuracy: 0.85, level: 1 },
        { pieceId: 'p3', readAt: NOW - 1_000, accuracy: 0.8, level: 1 },
      ],
    })
    // 'theory' at level 1 needs >= 0.7 retention — one young (non-mature)
    // card gives a mature-ratio of 0, so this track's criterion is UNMET.
    useFlashcardStore.setState({
      cardsById: {
        'key-signature-0': {
          id: 'key-signature-0',
          due: NOW + DAY_MS,
          intervalDays: 5,
          ease: 2.5,
          reps: 1,
          lapses: 0,
          introducedAt: NOW - 5 * DAY_MS,
        },
      },
    })

    const { result } = setup()
    const data = result.current

    const level1 = levelAt(CURRICULUM, 1)
    if (level1 === undefined) throw new Error('test setup: CURRICULUM must ship level 1')

    // Mirrors exactly what the hook itself derives from the state seeded
    // above (see useDashboard.ts's inline comments for each reduction).
    const expectedEvidence: ProgressEvidence = {
      assessments: { 'demo-five-finger-c-major-hands-separately': 0.9 },
      bestAssessmentAccuracy: 0.9,
      sightReadingLevel: 1,
      sightReadingAccuracy: (0.9 + 0.85 + 0.8) / 3,
      theoryRetention: 0,
      // No ear-training store state was seeded in this test, so it is still
      // the untouched default — zero attempts recorded, hence 0 (no-evidence).
      earTrainingLevel: 0,
      techniqueBpm: { 'five-finger-c-major-hands-right': 40 },
    }
    const initial = initialLevelState()

    for (const track of TRACKS) {
      const row = data.levels.find((l) => l.track === track)
      const expected = trackProgress(initial, level1, track, expectedEvidence)
      expect(row?.criteria).toEqual(expected)
    }

    const playingRow = data.levels.find((l) => l.track === 'playing')
    expect(playingRow?.criteria.map((c) => c.met)).toEqual([true, false])
    const sightReadingRow = data.levels.find((l) => l.track === 'sight-reading')
    expect(sightReadingRow?.criteria.every((c) => c.met)).toBe(true)
    const theoryRow = data.levels.find((l) => l.track === 'theory')
    expect(theoryRow?.criteria.every((c) => !c.met)).toBe(true)

    expect(data.curriculumAvailable).toBe(true)
  })

  it('reports curriculumAvailable false when a manual override places a track at a level the content does not cover', () => {
    // Levels 4-5 exist (roadmap 3.24) but author theory content only, so a
    // PLAYING track placed at 5 is the uncovered case now. Asserting through
    // a level that merely does not exist would no longer reach this branch:
    // `levelAt` resolves for every level MAX_LEVEL permits.
    useLevelStore.setState({
      levelState: {
        levels: { playing: 5, 'sight-reading': 1, theory: 1 },
        overridden: { playing: true, 'sight-reading': false, theory: false },
      },
    })

    const { result } = setup()
    const data = result.current

    const playingRow = data.levels.find((l) => l.track === 'playing')
    expect(playingRow?.criteria).toEqual([])
    expect(data.curriculumAvailable).toBe(false)
    // The other two tracks are still covered — curriculumAvailable is a
    // whole-dashboard AND across tracks, not per-track.
    const theoryRow = data.levels.find((l) => l.track === 'theory')
    expect(theoryRow?.criteria.length).toBeGreaterThan(0)
  })
})
