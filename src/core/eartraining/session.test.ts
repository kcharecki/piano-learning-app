import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { scriptedRng } from '@test/fakes.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import {
  adaptEarLevel,
  earStats,
  EAR_MAX_LEVEL,
  EAR_MIN_LEVEL,
  emptyEarSession,
  nextDueItemId,
  recordEarAttempt,
  type EarAttempt,
  type EarSessionState,
} from './session.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000 // an arbitrary but fixed epoch-ms anchor
const DAY_MS = 24 * 60 * 60 * 1000

const KINDS: readonly EarItemKind[] = [
  'interval-melodic',
  'interval-harmonic',
  'chord-quality',
  'scale-mode',
  'melodic-dictation',
  'rhythmic-dictation',
]

const attempt = (
  correct: boolean,
  overrides: Partial<EarAttempt> = {},
): EarAttempt => ({
  itemId: 'item-1',
  kind: 'interval-melodic',
  correct,
  at: T0,
  level: 1,
  ...overrides,
})

const runOf = (n: number, correct: boolean, overrides: Partial<EarAttempt> = {}): EarAttempt[] =>
  Array.from({ length: n }, () => attempt(correct, overrides))

/** Mirrors session.ts's private clampLevel, for asserting the property's "at most one step" bound. */
const clampLevelForTest = (level: number): number =>
  Math.min(EAR_MAX_LEVEL, Math.max(EAR_MIN_LEVEL, level))

// ---------------------------------------------------------------------------
// emptyEarSession
// ---------------------------------------------------------------------------

describe('emptyEarSession', () => {
  it('starts every kind at EAR_MIN_LEVEL, with no attempts and no cards', () => {
    const state = emptyEarSession()
    for (const kind of KINDS) expect(state.levels[kind]).toBe(EAR_MIN_LEVEL)
    expect(state.attempts).toEqual([])
    expect(state.cards).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// adaptEarLevel
// ---------------------------------------------------------------------------

describe('adaptEarLevel', () => {
  it('holds the level when there are fewer than a full window of attempts', () => {
    expect(adaptEarLevel(2, runOf(4, true))).toBe(2)
    expect(adaptEarLevel(2, [])).toBe(2)
  })

  it('raises the level by exactly one after five correct attempts in a row', () => {
    expect(adaptEarLevel(1, runOf(5, true))).toBe(2)
  })

  it('never raises by more than one, however long the correct run', () => {
    expect(adaptEarLevel(1, runOf(20, true))).toBe(2)
  })

  it('lowers the level by exactly one after five wrong attempts in a row', () => {
    expect(adaptEarLevel(3, runOf(5, false))).toBe(2)
  })

  it('never lowers by more than one, however long the wrong run', () => {
    expect(adaptEarLevel(5, runOf(20, false))).toBe(4)
  })

  it('holds on a mixed run (4 correct, 1 wrong = exactly the band edge, exclusive)', () => {
    const mixed = [...runOf(4, true), ...runOf(1, false)]
    expect(adaptEarLevel(3, mixed)).toBe(3)
  })

  it('holds on a mixed run strictly inside the band (window=20, 17/20 = 0.85)', () => {
    const mixed = [...runOf(17, true), ...runOf(3, false)]
    expect(adaptEarLevel(3, mixed, { window: 20 })).toBe(3)
  })

  it('holds on a 3-correct-2-wrong run of 5 (60% success), unlike a success-rate rule which would demote', () => {
    const mixed = [...runOf(3, true), ...runOf(2, false)]
    expect(adaptEarLevel(3, mixed)).toBe(3)
  })

  it('sequential trajectory: c,c,c,w,w holds (mixed window), then the next correct still holds, not a second demotion', () => {
    let state = emptyEarSession()
    const sequence = [true, true, true, false, false, true]
    sequence.forEach((correct, i) => {
      state = recordEarAttempt(state, attempt(correct, { itemId: `q-${i}`, at: T0 + i }), T0 + i)
    })
    // every 5-window in this sequence is mixed, so the level never moves from its start
    expect(state.levels['interval-melodic']).toBe(EAR_MIN_LEVEL)
  })

  it('never rises above EAR_MAX_LEVEL or falls below EAR_MIN_LEVEL', () => {
    expect(adaptEarLevel(EAR_MAX_LEVEL, runOf(5, true))).toBe(EAR_MAX_LEVEL)
    expect(adaptEarLevel(EAR_MIN_LEVEL, runOf(5, false))).toBe(EAR_MIN_LEVEL)
  })

  it('clamps an out-of-range current level even when it holds', () => {
    expect(adaptEarLevel(9, [attempt(true), attempt(false)])).toBe(EAR_MAX_LEVEL)
    expect(adaptEarLevel(-3, [attempt(true), attempt(false)])).toBe(EAR_MIN_LEVEL)
  })

  it('only the most recent `window` attempts matter, not the whole history', () => {
    const history = [...runOf(5, false), ...runOf(5, true)]
    expect(adaptEarLevel(2, history)).toBe(3)
  })

  it('respects a custom window and band', () => {
    expect(adaptEarLevel(2, runOf(1, true), { window: 1 })).toBe(3)
    expect(
      adaptEarLevel(2, [attempt(true), attempt(false)], { window: 2, band: [0.1, 0.6] }),
    ).toBe(2)
  })

  it('property: five correct attempts always raise by exactly one, whatever the starting level (short of the ceiling)', () => {
    fc.assert(
      fc.property(fc.integer({ min: EAR_MIN_LEVEL, max: EAR_MAX_LEVEL - 1 }), (level) => {
        expect(adaptEarLevel(level, runOf(5, true))).toBe(level + 1)
      }),
    )
  })

  it('property: five wrong attempts always lower by exactly one, whatever the starting level (short of the floor)', () => {
    fc.assert(
      fc.property(fc.integer({ min: EAR_MIN_LEVEL + 1, max: EAR_MAX_LEVEL }), (level) => {
        expect(adaptEarLevel(level, runOf(5, false))).toBe(level - 1)
      }),
    )
  })

  it('property: the level never leaves [EAR_MIN_LEVEL, EAR_MAX_LEVEL] for any run of attempts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: EAR_MIN_LEVEL - 3, max: EAR_MAX_LEVEL + 3 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }),
        (start, corrects) => {
          const recent = corrects.map((c) => attempt(c))
          const result = adaptEarLevel(start, recent)
          expect(result).toBeGreaterThanOrEqual(EAR_MIN_LEVEL)
          expect(result).toBeLessThanOrEqual(EAR_MAX_LEVEL)
          expect(Math.abs(result - clampLevelForTest(start))).toBeLessThanOrEqual(1)
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// recordEarAttempt
// ---------------------------------------------------------------------------

describe('recordEarAttempt', () => {
  it('never mutates the input state', () => {
    const state = emptyEarSession()
    const snapshot = structuredClone(state)
    recordEarAttempt(state, attempt(true), T0)
    expect(state).toEqual(snapshot)
  })

  it('rejects a now that disagrees with attempt.at (roadmap 2.19 substitution class)', () => {
    const state = emptyEarSession()
    expect(() => recordEarAttempt(state, attempt(true, { at: T0 }), T0 + 1)).toThrow()
  })

  it('always appends exactly one attempt', () => {
    const state = emptyEarSession()
    const next = recordEarAttempt(state, attempt(true), T0)
    expect(next.attempts).toHaveLength(1)
    expect(next.attempts[0]).toEqual(attempt(true))
    const next2 = recordEarAttempt(next, attempt(false, { itemId: 'item-2', at: T0 + 1 }), T0 + 1)
    expect(next2.attempts).toHaveLength(2)
  })

  it('property: appends exactly one attempt and never mutates the input, from any starting state', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 0, maxLength: 10 }),
        fc.boolean(),
        (history, correct) => {
          const seeded = history.reduce<EarSessionState>(
            (s, c, i) => recordEarAttempt(s, attempt(c, { itemId: `item-${i}`, at: T0 + i }), T0 + i),
            emptyEarSession(),
          )
          const before = structuredClone(seeded)
          const attemptCountBefore = seeded.attempts.length
          const next = recordEarAttempt(
            seeded,
            attempt(correct, { itemId: 'new-item', at: T0 + 100 }),
            T0 + 100,
          )
          expect(seeded).toEqual(before)
          expect(next.attempts).toHaveLength(attemptCountBefore + 1)
        },
      ),
    )
  })

  it('creates a new SRS card for a never-seen item id, due immediately', () => {
    const state = emptyEarSession()
    const next = recordEarAttempt(state, attempt(true), T0)
    expect(next.cards).toHaveLength(1)
    expect(next.cards[0]?.id).toBe('item-1')
  })

  it('reviews the existing card on a repeat attempt instead of creating a second one', () => {
    const state = emptyEarSession()
    const once = recordEarAttempt(state, attempt(true), T0)
    const twice = recordEarAttempt(once, attempt(true, { at: T0 + DAY_MS }), T0 + DAY_MS)
    expect(twice.cards).toHaveLength(1)
    expect(twice.cards[0]?.reps).toBe(2)
  })

  it('a wrong attempt increases lapses and schedules a short relearning step', () => {
    const state = emptyEarSession()
    const next = recordEarAttempt(state, attempt(false), T0)
    const card = next.cards[0]
    expect(card?.lapses).toBe(1)
    expect(card?.due).toBeLessThan(T0 + DAY_MS)
  })

  it('only adapts the level of the attempted kind, leaving other kinds untouched', () => {
    let state = emptyEarSession()
    for (let i = 0; i < 5; i++) {
      state = recordEarAttempt(
        state,
        attempt(true, { itemId: `mel-${i}`, kind: 'interval-melodic', at: T0 + i }),
        T0 + i,
      )
    }
    expect(state.levels['interval-melodic']).toBe(2)
    expect(state.levels['chord-quality']).toBe(EAR_MIN_LEVEL)
  })

  it('passing an rng fuzzes the interval away from the exact deterministic value', () => {
    const state = emptyEarSession()
    const withoutRng = recordEarAttempt(state, attempt(true), T0)
    const withRng = recordEarAttempt(state, attempt(true), T0, scriptedRng([0.9]))
    expect(withRng.cards[0]?.due).not.toBe(withoutRng.cards[0]?.due)
  })
})

// ---------------------------------------------------------------------------
// nextDueItemId
// ---------------------------------------------------------------------------

describe('nextDueItemId', () => {
  it('returns null when there are no cards at all', () => {
    expect(nextDueItemId(emptyEarSession(), KINDS, T0)).toBeNull()
  })

  it('returns null when cards exist but none are due yet', () => {
    const state = recordEarAttempt(emptyEarSession(), attempt(true), T0)
    // the reviewed card is due days in the future; "now" is still T0
    expect(nextDueItemId(state, KINDS, T0)).toBeNull()
  })

  it('returns the sole due card id when only one is due', () => {
    const state = recordEarAttempt(emptyEarSession(), attempt(false), T0)
    // a wrong attempt schedules a short (~10 min) relearning step, so it is due soon
    const soon = T0 + DAY_MS
    expect(nextDueItemId(state, KINDS, soon)).toBe('item-1')
  })

  it('returns the MOST overdue card, not merely a due one, when several are due', () => {
    let state = emptyEarSession()
    // three items, each wrong once at a different time so their due times differ
    state = recordEarAttempt(state, attempt(false, { itemId: 'a', at: T0 }), T0)
    state = recordEarAttempt(state, attempt(false, { itemId: 'b', at: T0 + 1000 }), T0 + 1000)
    state = recordEarAttempt(state, attempt(false, { itemId: 'c', at: T0 + 2000 }), T0 + 2000)
    // all three are due long before "now"; 'a' was scheduled earliest, so it is most overdue
    const now = T0 + DAY_MS
    expect(nextDueItemId(state, KINDS, now)).toBe('a')
  })

  it('ignores cards whose kind is not in the requested set', () => {
    let state = emptyEarSession()
    state = recordEarAttempt(
      state,
      attempt(false, { itemId: 'chord-1', kind: 'chord-quality', at: T0 }),
      T0,
    )
    const now = T0 + DAY_MS
    expect(nextDueItemId(state, ['interval-melodic'], now)).toBeNull()
    expect(nextDueItemId(state, ['chord-quality'], now)).toBe('chord-1')
  })

  it('throws rather than silently excluding a card whose id has no entry in state.kinds', () => {
    const state = recordEarAttempt(emptyEarSession(), attempt(false), T0)
    const tampered: EarSessionState = { ...state, kinds: {} }
    expect(() => nextDueItemId(tampered, KINDS, T0 + DAY_MS)).toThrow()
  })

  it('property: among several wrong-once cards, the earliest-attempted one is always returned as most overdue', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 5000 }), { minLength: 2, maxLength: 6 }),
        (offsets) => {
          let state = emptyEarSession()
          offsets.forEach((offset, i) => {
            state = recordEarAttempt(
              state,
              attempt(false, { itemId: `id-${i}`, at: T0 + offset }),
              T0 + offset,
            )
          })
          const now = T0 + 10 * DAY_MS
          const minOffsetIndex = offsets.indexOf(Math.min(...offsets))
          expect(nextDueItemId(state, KINDS, now)).toBe(`id-${minOffsetIndex}`)
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// earStats
// ---------------------------------------------------------------------------

describe('earStats', () => {
  it('reports zeros for an empty session', () => {
    const stats = earStats(emptyEarSession(), T0)
    expect(stats.total).toBe(0)
    expect(stats.due).toBe(0)
  })

  it('counts a card as due once its relearning step has elapsed', () => {
    const state = recordEarAttempt(emptyEarSession(), attempt(false), T0)
    const stats = earStats(state, T0 + DAY_MS)
    expect(stats.total).toBe(1)
    expect(stats.due).toBe(1)
  })
})
