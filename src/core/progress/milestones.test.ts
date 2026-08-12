import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '@test/fakes.ts'
import { techniqueLibrary, type TechniqueDrill } from '@core/technique/library.ts'
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import type { RepertoirePiece, RepertoireSession } from '@core/repertoire/repertoire.ts'
import { emptyEarSession, type EarAttempt, type EarSessionState } from '@core/eartraining/session.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import { computeMilestones, type Milestone, type MilestoneId, type MilestoneInputs } from './milestones.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000
const T0 = 1_700_000_000_000 // an arbitrary but fixed epoch-ms anchor, well in the past

function emptyInputs(): MilestoneInputs {
  return {
    practiceEntries: [],
    utcOffsetMinutes: 0,
    techniqueAttempts: [],
    repertoirePieces: [],
    earTraining: emptyEarSession(),
  }
}

function milestone(milestones: readonly Milestone[], id: MilestoneId): Milestone {
  const found = milestones.find((m) => m.id === id)
  if (found === undefined) throw new Error(`no milestone with id ${id}`)
  return found
}

let seq = 0
function practiceEntry(over: Partial<PracticeEntry> = {}): PracticeEntry {
  seq += 1
  const startedAt = over.startedAt ?? T0
  return {
    id: `pe${seq}`,
    startedAt,
    endedAt: startedAt + 10 * 60_000,
    kind: 'technique',
    itemName: 'Practice',
    ...over,
  }
}

function attempt(drillId: string, over: Partial<TechniqueAttempt> = {}): TechniqueAttempt {
  return {
    drillId,
    at: T0,
    bpm: 100,
    evenness: 1,
    accuracy: 1,
    clean: true,
    ...over,
  }
}

function repertoirePiece(over: Partial<RepertoirePiece> = {}): RepertoirePiece {
  return {
    id: 'p1',
    title: 'Für Elise',
    composer: 'Beethoven',
    level: 3,
    status: 'learning',
    sessions: [],
    bestAccuracy: 0,
    notes: '',
    ...over,
  }
}

function repertoireSession(over: Partial<RepertoireSession> = {}): RepertoireSession {
  return { at: T0, minutes: 10, ...over }
}

// The twelve real "major, 2 octaves, hands together" drills the module reads
// from `@core/technique/library.ts` — read from the real library rather than
// hardcoded ids/tempi, so these tests break if the library's own data (not
// just the module under test) ever drifts.
function twelveMajorScaleDrills(): readonly TechniqueDrill[] {
  return [3, 4]
    .flatMap((level) => techniqueLibrary(level))
    .filter((d) => d.kind === 'scale' && d.scaleType === 'major' && d.octaves === 2 && d.hands === 'both')
}

// ---------------------------------------------------------------------------
// empty / fresh profile
// ---------------------------------------------------------------------------

describe('computeMilestones — fresh profile with zero data', () => {
  it('reports all five milestones unachieved with honest zero progress, never a fabricated number', () => {
    const result = computeMilestones(emptyInputs(), new FakeClock(T0))
    expect(result).toHaveLength(5)
    for (const m of result) {
      expect(m.achieved).toBe(false)
      expect(m.achievedAt).toBeNull()
      expect(m.progress).toBe(0)
    }
    expect(milestone(result, 'twelve-major-scales').progressLabel).toBe('0 of 12 major scales')
    expect(milestone(result, 'repertoire-accuracy-90').progressLabel).toBe('No repertoire pieces yet.')
    expect(milestone(result, 'eartraining-level-3-all-kinds').progressLabel).toBe('0 of 6 kinds at level 3+')
    expect(milestone(result, 'streak-7-days').progressLabel).toBe('0 of 7 days')
  })

  it('is deterministic — recomputing from the same inputs never changes the verdict', () => {
    const inputs = emptyInputs()
    const a = computeMilestones(inputs, new FakeClock(T0))
    const b = computeMilestones(inputs, new FakeClock(T0))
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// twelve major scales
// ---------------------------------------------------------------------------

describe('twelve-major-scales', () => {
  it('is unachieved with partial progress once some, but not all, scales are clean at target tempo', () => {
    const drills = twelveMajorScaleDrills()
    expect(drills).toHaveLength(12)
    const first5 = drills.slice(0, 5)
    const attempts = first5.map((d) => attempt(d.id, { bpm: d.targetBpm, at: T0 }))
    const result = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0))
    const m = milestone(result, 'twelve-major-scales')
    expect(m.achieved).toBe(false)
    expect(m.achievedAt).toBeNull()
    expect(m.progress).toBeCloseTo(5 / 12)
    expect(m.progressLabel).toBe('5 of 12 major scales')
  })

  it('is achieved once every one of the 12 is clean at (or above) its own target tempo, dated to the last one reached', () => {
    const drills = twelveMajorScaleDrills()
    const attempts = drills.map((d, i) =>
      attempt(d.id, { bpm: d.targetBpm, at: T0 + i * DAY }), // each scale reached on a different, later day
    )
    const result = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0 + 100 * DAY))
    const m = milestone(result, 'twelve-major-scales')
    expect(m.achieved).toBe(true)
    expect(m.progress).toBe(1)
    expect(m.progressLabel).toBe('12 of 12 major scales')
    expect(m.achievedAt).toBe(T0 + 11 * DAY) // the LAST scale to reach target, not the first
  })

  it('an unclean attempt at the target tempo does not count (evenness/accuracy still matter)', () => {
    const drills = twelveMajorScaleDrills()
    const attempts = drills.map((d) => attempt(d.id, { bpm: d.targetBpm, clean: false }))
    const result = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0))
    expect(milestone(result, 'twelve-major-scales').achieved).toBe(false)
  })

  it('a clean attempt below target tempo does not count', () => {
    const drills = twelveMajorScaleDrills()
    const attempts = drills.map((d) => attempt(d.id, { bpm: d.targetBpm - 1 }))
    const result = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0))
    expect(milestone(result, 'twelve-major-scales').achieved).toBe(false)
  })

  it('a future-dated attempt (clock skew) does not count until "now" catches up to it', () => {
    const drills = twelveMajorScaleDrills()
    const attempts = drills.map((d) => attempt(d.id, { bpm: d.targetBpm, at: T0 + DAY }))
    const before = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0))
    expect(milestone(before, 'twelve-major-scales').achieved).toBe(false)
    const after = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0 + DAY))
    expect(milestone(after, 'twelve-major-scales').achieved).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// repertoire accuracy
// ---------------------------------------------------------------------------

describe('repertoire-accuracy-90', () => {
  it('shows honest partial progress from the best accuracy seen, below target', () => {
    const piece = repertoirePiece({ sessions: [repertoireSession({ accuracy: 0.62 })] })
    const result = computeMilestones({ ...emptyInputs(), repertoirePieces: [piece] }, new FakeClock(T0))
    const m = milestone(result, 'repertoire-accuracy-90')
    expect(m.achieved).toBe(false)
    expect(m.progress).toBeCloseTo(0.62 / 0.9)
    expect(m.progressLabel).toBe('Best so far: 62% (target 90%).')
  })

  it('is achieved once any piece has a session at or above 90%, dated to the first time and naming that piece', () => {
    const early = repertoirePiece({
      id: 'p-early',
      title: 'Minuet in G',
      sessions: [repertoireSession({ at: T0, accuracy: 0.91 })],
    })
    const late = repertoirePiece({
      id: 'p-late',
      title: 'Prelude in C',
      sessions: [repertoireSession({ at: T0 + DAY, accuracy: 0.95 })],
    })
    const result = computeMilestones(
      { ...emptyInputs(), repertoirePieces: [late, early] },
      new FakeClock(T0 + 10 * DAY),
    )
    const m = milestone(result, 'repertoire-accuracy-90')
    expect(m.achieved).toBe(true)
    expect(m.achievedAt).toBe(T0)
    expect(m.progressLabel).toBe('Minuet in G reached 90% accuracy.')
  })

  it('a session with no accuracy recorded is ignored, not treated as 0', () => {
    const piece = repertoirePiece({ sessions: [repertoireSession()] })
    const result = computeMilestones({ ...emptyInputs(), repertoirePieces: [piece] }, new FakeClock(T0))
    const m = milestone(result, 'repertoire-accuracy-90')
    expect(m.achieved).toBe(false)
    expect(m.progress).toBe(0)
    expect(m.progressLabel).toBe('Best so far: 0% (target 90%).')
  })
})

// ---------------------------------------------------------------------------
// first hands-together
// ---------------------------------------------------------------------------

describe('first-hands-together', () => {
  it('is unachieved when only single-hand drills have been played clean', () => {
    const rightHandDrill = techniqueLibrary(1).find((d) => d.hands === 'right')
    if (rightHandDrill === undefined) throw new Error('fixture assumption failed: no right-hand level-1 drill')
    const attempts = [attempt(rightHandDrill.id, { clean: true })]
    const result = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0))
    expect(milestone(result, 'first-hands-together').achieved).toBe(false)
  })

  it('is achieved the first time any hands-together drill is played clean, naming that drill', () => {
    const bothDrill = techniqueLibrary(3).find((d) => d.hands === 'both')
    if (bothDrill === undefined) throw new Error('fixture assumption failed: no both-hands level-3 drill')
    const attempts = [
      attempt(bothDrill.id, { at: T0 + 2 * DAY, clean: true }),
      attempt(bothDrill.id, { at: T0, clean: true }), // earlier — this one should win
      attempt(bothDrill.id, { at: T0 - DAY, clean: false }), // earlier still, but not clean
    ]
    const result = computeMilestones({ ...emptyInputs(), techniqueAttempts: attempts }, new FakeClock(T0 + 3 * DAY))
    const m = milestone(result, 'first-hands-together')
    expect(m.achieved).toBe(true)
    expect(m.achievedAt).toBe(T0)
    expect(m.progressLabel).toBe(bothDrill.title)
  })
})

// ---------------------------------------------------------------------------
// streak
// ---------------------------------------------------------------------------

function entriesOnDays(dayIndices: readonly number[]): PracticeEntry[] {
  return dayIndices.map((d) => practiceEntry({ startedAt: d * DAY + 12 * 3_600_000 }))
}

describe('streak-7-days', () => {
  it('is unachieved below a 7-day run, with honest "N of 7" progress', () => {
    const entries = entriesOnDays([0, 1, 2, 3])
    const result = computeMilestones({ ...emptyInputs(), practiceEntries: entries }, new FakeClock(4 * DAY))
    const m = milestone(result, 'streak-7-days')
    expect(m.achieved).toBe(false)
    expect(m.progressLabel).toBe('4 of 7 days')
  })

  it('is achieved by the LONGEST run ever, dated to the day that run completed, even if practice has since lapsed', () => {
    const entries = entriesOnDays([0, 1, 2, 3, 4, 5, 6]) // a 7-day run, long since over
    const now = new FakeClock(30 * DAY) // "today" is day 30 — the streak is dead, current would be 0
    const result = computeMilestones({ ...emptyInputs(), practiceEntries: entries }, now)
    const m = milestone(result, 'streak-7-days')
    expect(m.achieved).toBe(true)
    expect(m.progressLabel).toBe('7 of 7 days')
    expect(m.achievedAt).toBe(6 * DAY + 12 * 3_600_000) // the 7th consecutive day
  })

  it('never un-achieves once reached — no streak-loss guilt (REQ-3.10.3)', () => {
    const entries = entriesOnDays([0, 1, 2, 3, 4, 5, 6])
    const day7 = computeMilestones({ ...emptyInputs(), practiceEntries: entries }, new FakeClock(7 * DAY))
    const day365 = computeMilestones({ ...emptyInputs(), practiceEntries: entries }, new FakeClock(365 * DAY))
    expect(milestone(day7, 'streak-7-days').achieved).toBe(true)
    expect(milestone(day365, 'streak-7-days').achieved).toBe(true)
    expect(milestone(day7, 'streak-7-days').achievedAt).toBe(milestone(day365, 'streak-7-days').achievedAt)
  })

  it('a 7-day run that is not the most recent one still counts (longest, not current)', () => {
    // Days 0..6 (a 7-day run), a gap, then a lone day 20 — currentStreakDays "now" would read very differently.
    const entries = entriesOnDays([0, 1, 2, 3, 4, 5, 6, 20])
    const result = computeMilestones({ ...emptyInputs(), practiceEntries: entries }, new FakeClock(20 * DAY + 3_600_000))
    expect(milestone(result, 'streak-7-days').achieved).toBe(true)
  })
})

describe('streak-7-days properties', () => {
  it('achievedAt, when set, is always the timestamp of a real logged PracticeEntry', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 30 }),
        (days) => {
          const entries = entriesOnDays(days)
          const result = computeMilestones(
            { ...emptyInputs(), practiceEntries: entries },
            new FakeClock(61 * DAY),
          )
          const m = milestone(result, 'streak-7-days')
          if (m.achievedAt !== null) {
            expect(entries.some((e) => e.startedAt === m.achievedAt)).toBe(true)
          }
        },
      ),
    )
  })

  it('achieved is exactly "longest run >= 7 days", agreeing with log.ts through every input', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -200, max: 200 }), { minLength: 0, maxLength: 40 }),
        (days) => {
          const entries = entriesOnDays(days)
          const result = computeMilestones(
            { ...emptyInputs(), practiceEntries: entries },
            new FakeClock(201 * DAY),
          )
          const m = milestone(result, 'streak-7-days')
          // Independent re-check via the run lengths in the sorted day list —
          // not calling longestStreakDays again, to avoid the property
          // vacuously restating the implementation.
          const sorted = [...new Set(days)].sort((a, b) => a - b)
          let longest = 0
          let current = 0
          let prev: number | null = null
          for (const d of sorted) {
            current = prev !== null && d === prev + 1 ? current + 1 : 1
            longest = Math.max(longest, current)
            prev = d
          }
          expect(m.achieved).toBe(longest >= 7)
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// ear training
// ---------------------------------------------------------------------------

const ALL_EAR_KINDS: readonly EarItemKind[] = [
  'interval-melodic',
  'interval-harmonic',
  'chord-quality',
  'scale-mode',
  'melodic-dictation',
  'rhythmic-dictation',
]

function earAttempt(kind: EarItemKind, level: number, at: number): EarAttempt {
  return { itemId: `${kind}-item`, kind, accuracy: 1, at, level }
}

function earSessionAtLevels(levels: Readonly<Record<EarItemKind, number>>, attempts: readonly EarAttempt[] = []): EarSessionState {
  return { ...emptyEarSession(), levels, attempts, cards: [], kinds: {} }
}

describe('eartraining-level-3-all-kinds', () => {
  it('is unachieved on a fresh session (every kind starts at level 1)', () => {
    const result = computeMilestones(emptyInputs(), new FakeClock(T0))
    const m = milestone(result, 'eartraining-level-3-all-kinds')
    expect(m.achieved).toBe(false)
    expect(m.progressLabel).toBe('0 of 6 kinds at level 3+')
  })

  it('shows honest partial progress when some, but not all, kinds have reached level 3', () => {
    const levels = Object.fromEntries(ALL_EAR_KINDS.map((k, i) => [k, i < 2 ? 3 : 1])) as Record<
      EarItemKind,
      number
    >
    const result = computeMilestones({ ...emptyInputs(), earTraining: earSessionAtLevels(levels) }, new FakeClock(T0))
    const m = milestone(result, 'eartraining-level-3-all-kinds')
    expect(m.achieved).toBe(false)
    expect(m.progressLabel).toBe('2 of 6 kinds at level 3+')
  })

  it('is achieved once every kind is at level 3 or higher, dated to the last kind to get there', () => {
    const levels = Object.fromEntries(ALL_EAR_KINDS.map((k) => [k, 3])) as Record<EarItemKind, number>
    const attempts = ALL_EAR_KINDS.map((k, i) => earAttempt(k, 3, T0 + i * DAY))
    const session = earSessionAtLevels(levels, attempts)
    const result = computeMilestones({ ...emptyInputs(), earTraining: session }, new FakeClock(T0 + 30 * DAY))
    const m = milestone(result, 'eartraining-level-3-all-kinds')
    expect(m.achieved).toBe(true)
    expect(m.progressLabel).toBe('6 of 6 kinds at level 3+')
    expect(m.achievedAt).toBe(T0 + 5 * DAY) // the last kind to reach level 3
  })
})
