import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DAY_MS } from '@core/srs/scheduler.ts'
import { isOk, isErr, unwrap } from '@core/shared/result.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import {
  addPiece,
  daysSincePractice,
  maintenanceDue,
  recordSession,
  REPERTOIRE_STATUSES,
  sessionFromEntry,
  setNotes,
  setStatus,
  type RepertoirePiece,
  type RepertoireSession,
  type RepertoireStatus,
} from './repertoire.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000 // an arbitrary but fixed epoch-ms anchor

const freshPiece = (over: Partial<RepertoirePiece> = {}): RepertoirePiece => ({
  id: 'p1',
  title: 'Für Elise',
  composer: 'Beethoven',
  level: 3,
  status: 'learning',
  sessions: [],
  bestAccuracy: 0,
  notes: '',
  ...over,
})

const arbStatus: fc.Arbitrary<RepertoireStatus> = fc.constantFrom(...REPERTOIRE_STATUSES)

const arbSession: fc.Arbitrary<RepertoireSession> = fc
  .record({
    at: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    minutes: fc.double({ min: 0, max: 240, noNaN: true }),
    accuracy: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    tempoBpm: fc.option(fc.double({ min: 20, max: 240, noNaN: true }), { nil: undefined }),
  })
  .map(({ accuracy, tempoBpm, ...rest }) => ({
    ...rest,
    ...(accuracy === undefined ? {} : { accuracy }),
    ...(tempoBpm === undefined ? {} : { tempoBpm }),
  }))

const arbPiece: fc.Arbitrary<RepertoirePiece> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    composer: fc.string({ minLength: 0, maxLength: 20 }),
    level: fc.integer({ min: 1, max: 5 }),
    status: arbStatus,
    sessions: fc.array(arbSession, { maxLength: 6 }),
    bestAccuracy: fc.double({ min: 0, max: 1, noNaN: true }),
    notes: fc.string({ maxLength: 20 }),
  })
  .map((p) => ({ ...p }))

const arbPieces: fc.Arbitrary<readonly RepertoirePiece[]> = fc
  .uniqueArray(arbPiece, { selector: (p) => p.id, maxLength: 6 })
  .map((ps) => ps as readonly RepertoirePiece[])

// ---------------------------------------------------------------------------
// addPiece
// ---------------------------------------------------------------------------

describe('addPiece', () => {
  it('adds a piece with fresh defaults', () => {
    const result = addPiece([], { id: 'p1', title: 'Für Elise', composer: 'Beethoven', level: 3 })
    expect(isOk(result)).toBe(true)
    const pieces = unwrap(result)
    expect(pieces).toEqual<readonly RepertoirePiece[]>([
      {
        id: 'p1',
        title: 'Für Elise',
        composer: 'Beethoven',
        level: 3,
        status: 'learning',
        sessions: [],
        bestAccuracy: 0,
        notes: '',
      },
    ])
  })

  it('carries an optional scoreId for an imported score (REQ-3.8.3)', () => {
    const result = addPiece([], {
      id: 'p1',
      title: 'My Import',
      composer: 'Unknown',
      level: 5,
      scoreId: 'score-42',
    })
    expect(unwrap(result).at(0)?.scoreId).toBe('score-42')
  })

  it('errs on a duplicate id', () => {
    const first = unwrap(
      addPiece([], { id: 'p1', title: 'A', composer: 'X', level: 1 }),
    )
    const second = addPiece(first, { id: 'p1', title: 'B', composer: 'Y', level: 2 })
    expect(isErr(second)).toBe(true)
  })

  it('errs on a blank title', () => {
    expect(isErr(addPiece([], { id: 'p1', title: '   ', composer: 'X', level: 1 }))).toBe(true)
  })

  it.each([0, 6, -1, 1.5])('errs on an out-of-range or non-integer level %s', (level) => {
    expect(isErr(addPiece([], { id: 'p1', title: 'A', composer: 'X', level }))).toBe(true)
  })

  it('does not mutate the input array', () => {
    const input: readonly RepertoirePiece[] = []
    addPiece(input, { id: 'p1', title: 'A', composer: 'X', level: 1 })
    expect(input).toEqual([])
  })

  it('permits any composer string unchecked, since only id/title/level are validated', () => {
    const result = addPiece([], { id: 'p1', title: 'A', composer: '', level: 1 })
    expect(isOk(result)).toBe(true)
  })

  it('appends to an existing library instead of discarding it', () => {
    const withFirst = unwrap(
      addPiece([], { id: 'p1', title: 'A', composer: 'X', level: 1 }),
    )
    const withBoth = unwrap(
      addPiece(withFirst, { id: 'p2', title: 'B', composer: 'Y', level: 2 }),
    )
    expect(withBoth.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

// ---------------------------------------------------------------------------
// setStatus
// ---------------------------------------------------------------------------

describe('setStatus', () => {
  it('updates only the matching piece', () => {
    const pieces = [freshPiece({ id: 'a' }), freshPiece({ id: 'b' })]
    const updated = setStatus(pieces, 'a', 'performance-ready')
    expect(updated.find((p) => p.id === 'a')?.status).toBe('performance-ready')
    expect(updated.find((p) => p.id === 'b')?.status).toBe('learning')
  })

  it('allows moving a piece backward (free-form status, no one-way progression)', () => {
    const pieces = [freshPiece({ id: 'a', status: 'maintained' })]
    const updated = setStatus(pieces, 'a', 'learning')
    expect(updated[0]?.status).toBe('learning')
  })

  it('does not mutate the input array', () => {
    const pieces = [freshPiece({ id: 'a' })]
    setStatus(pieces, 'a', 'maintained')
    expect(pieces[0]?.status).toBe('learning')
  })

  it('is a no-op for an unknown id', () => {
    const pieces = [freshPiece({ id: 'a' })]
    const updated = setStatus(pieces, 'nope', 'maintained')
    expect(updated).toEqual(pieces)
  })
})

// ---------------------------------------------------------------------------
// recordSession
// ---------------------------------------------------------------------------

describe('recordSession', () => {
  it('appends the session and raises bestAccuracy when the new one is higher', () => {
    const pieces = [freshPiece({ id: 'a', bestAccuracy: 0.5 })]
    const session: RepertoireSession = { at: T0, minutes: 10, accuracy: 0.8 }
    const updated = recordSession(pieces, 'a', session)
    expect(updated[0]?.sessions).toEqual([session])
    expect(updated[0]?.bestAccuracy).toBe(0.8)
  })

  it('never lowers bestAccuracy when a worse session is recorded', () => {
    const pieces = [freshPiece({ id: 'a', bestAccuracy: 0.9 })]
    const updated = recordSession(pieces, 'a', { at: T0, minutes: 5, accuracy: 0.3 })
    expect(updated[0]?.bestAccuracy).toBe(0.9)
  })

  it('leaves bestAccuracy untouched when the session has no accuracy', () => {
    const pieces = [freshPiece({ id: 'a', bestAccuracy: 0.4 })]
    const updated = recordSession(pieces, 'a', { at: T0, minutes: 5 })
    expect(updated[0]?.bestAccuracy).toBe(0.4)
  })

  it('does not mutate the input array or its piece', () => {
    const pieces = [freshPiece({ id: 'a' })]
    recordSession(pieces, 'a', { at: T0, minutes: 5, accuracy: 0.9 })
    expect(pieces[0]?.sessions).toEqual([])
    expect(pieces[0]?.bestAccuracy).toBe(0)
  })

  it('throws on an unknown id (a stale reference must not silently drop a session)', () => {
    const pieces = [freshPiece({ id: 'a' })]
    expect(() => recordSession(pieces, 'nope', { at: T0, minutes: 5 })).toThrow(/unknown piece id/)
  })

  it('property: bestAccuracy is monotonically non-decreasing across any sequence of sessions', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 0, maxLength: 20 }),
        (accuracies) => {
          let pieces: readonly RepertoirePiece[] = [freshPiece({ id: 'a' })]
          let runningMax = 0
          for (const [i, accuracy] of accuracies.entries()) {
            pieces = recordSession(pieces, 'a', { at: T0 + i, minutes: 1, accuracy })
            runningMax = Math.max(runningMax, accuracy)
            expect(pieces[0]?.bestAccuracy).toBeCloseTo(runningMax, 9)
          }
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// setNotes
// ---------------------------------------------------------------------------

describe('setNotes', () => {
  it('replaces notes for the matching piece', () => {
    const pieces = [freshPiece({ id: 'a', notes: 'old' })]
    const updated = setNotes(pieces, 'a', 'new notes')
    expect(updated[0]?.notes).toBe('new notes')
  })

  it('does not mutate the input', () => {
    const pieces = [freshPiece({ id: 'a', notes: 'old' })]
    setNotes(pieces, 'a', 'new')
    expect(pieces[0]?.notes).toBe('old')
  })
})

// ---------------------------------------------------------------------------
// daysSincePractice
// ---------------------------------------------------------------------------

describe('daysSincePractice', () => {
  it('is null when never practised', () => {
    expect(daysSincePractice(freshPiece(), T0)).toBeNull()
  })

  it('measures from the most recent session, not the first', () => {
    const piece = freshPiece({
      sessions: [
        { at: T0 - 10 * DAY_MS, minutes: 5 },
        { at: T0 - 2 * DAY_MS, minutes: 5 },
        { at: T0 - 5 * DAY_MS, minutes: 5 },
      ],
    })
    expect(daysSincePractice(piece, T0)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// maintenanceDue
// ---------------------------------------------------------------------------

describe('maintenanceDue', () => {
  it('only includes maintained pieces (a piece still being learned is not "decaying")', () => {
    const pieces = [
      freshPiece({ id: 'learning', status: 'learning' }),
      freshPiece({ id: 'polishing', status: 'polishing' }),
      freshPiece({ id: 'ready', status: 'performance-ready' }),
      freshPiece({ id: 'maintained', status: 'maintained' }),
    ]
    const due = maintenanceDue(pieces, T0)
    expect(due.map((p) => p.id)).toEqual(['maintained'])
  })

  it('a never-practised maintained piece is due immediately', () => {
    const pieces = [freshPiece({ id: 'a', status: 'maintained', sessions: [] })]
    expect(maintenanceDue(pieces, T0).map((p) => p.id)).toEqual(['a'])
  })

  it('a maintained piece practised recently is not due', () => {
    const pieces = [
      freshPiece({
        id: 'a',
        status: 'maintained',
        sessions: [{ at: T0 - 1 * DAY_MS, minutes: 5 }],
      }),
    ]
    expect(maintenanceDue(pieces, T0, { intervalDays: 21 })).toEqual([])
  })

  it('a maintained piece exactly at the interval boundary is due', () => {
    const pieces = [
      freshPiece({
        id: 'a',
        status: 'maintained',
        sessions: [{ at: T0 - 21 * DAY_MS, minutes: 5 }],
      }),
    ]
    expect(maintenanceDue(pieces, T0, { intervalDays: 21 }).map((p) => p.id)).toEqual(['a'])
  })

  it('respects a custom intervalDays', () => {
    const pieces = [
      freshPiece({
        id: 'a',
        status: 'maintained',
        sessions: [{ at: T0 - 5 * DAY_MS, minutes: 5 }],
      }),
    ]
    expect(maintenanceDue(pieces, T0, { intervalDays: 3 }).map((p) => p.id)).toEqual(['a'])
    expect(maintenanceDue(pieces, T0, { intervalDays: 10 })).toEqual([])
  })

  it('orders most overdue first, with never-practised pieces ahead of any practised one', () => {
    const pieces = [
      freshPiece({
        id: 'slightly-overdue',
        status: 'maintained',
        sessions: [{ at: T0 - 22 * DAY_MS, minutes: 5 }],
      }),
      freshPiece({ id: 'never-practised', status: 'maintained', sessions: [] }),
      freshPiece({
        id: 'very-overdue',
        status: 'maintained',
        sessions: [{ at: T0 - 60 * DAY_MS, minutes: 5 }],
      }),
    ]
    const due = maintenanceDue(pieces, T0, { intervalDays: 21 })
    expect(due.map((p) => p.id)).toEqual(['never-practised', 'very-overdue', 'slightly-overdue'])
  })

  it('does not mutate the input array', () => {
    const pieces = [freshPiece({ id: 'a', status: 'maintained' })]
    maintenanceDue(pieces, T0)
    expect(pieces).toHaveLength(1)
  })

  it('two never-practised maintained pieces both come back, input order preserved', () => {
    const pieces = [
      freshPiece({ id: 'a', status: 'maintained', sessions: [] }),
      freshPiece({ id: 'b', status: 'maintained', sessions: [] }),
    ]
    expect(maintenanceDue(pieces, T0).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('property: results are sorted most-overdue-first, contain exactly the due maintained pieces, and never-practised pieces sort ahead of practised ones', () => {
    fc.assert(
      fc.property(
        arbPieces,
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.integer({ min: 0, max: 60 }),
        (pieces, now, intervalDays) => {
          const due = maintenanceDue(pieces, now, { intervalDays })
          for (let i = 1; i < due.length; i++) {
            const prevPiece = due[i - 1]
            const currPiece = due[i]
            if (prevPiece === undefined || currPiece === undefined) continue
            const prev = daysSincePractice(prevPiece, now)
            const curr = daysSincePractice(currPiece, now)
            const prevKey = prev === null ? Number.POSITIVE_INFINITY : prev
            const currKey = curr === null ? Number.POSITIVE_INFINITY : curr
            expect(prevKey).toBeGreaterThanOrEqual(currKey)
          }
          const dueIds = new Set(due.map((p) => p.id))
          for (const p of pieces) {
            const since = daysSincePractice(p, now)
            const isDue = since === null || since >= intervalDays
            if (p.status === 'maintained' && isDue) {
              expect(dueIds.has(p.id)).toBe(true)
            } else {
              expect(dueIds.has(p.id)).toBe(false)
            }
          }
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// sessionFromEntry
// ---------------------------------------------------------------------------

describe('sessionFromEntry', () => {
  it('derives minutes from the entry duration and carries at/accuracy/tempoBpm through', () => {
    const entry: PracticeEntry = {
      id: 'e1',
      startedAt: T0,
      endedAt: T0 + 5 * 60_000,
      kind: 'repertoire',
      itemName: 'Für Elise',
      accuracy: 0.87,
      tempoBpm: 96,
    }
    expect(sessionFromEntry(entry)).toEqual<RepertoireSession>({
      at: T0,
      minutes: 5,
      accuracy: 0.87,
      tempoBpm: 96,
    })
  })

  it('omits accuracy/tempoBpm when the entry has neither', () => {
    const entry: PracticeEntry = {
      id: 'e1',
      startedAt: T0,
      endedAt: T0 + 60_000,
      kind: 'repertoire',
      itemName: 'Für Elise',
    }
    expect(sessionFromEntry(entry)).toEqual<RepertoireSession>({ at: T0, minutes: 1 })
  })
})

// ---------------------------------------------------------------------------
// purity (all mutating-looking ops return new arrays / objects)
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('property: setStatus, recordSession and setNotes never mutate their input', () => {
    fc.assert(
      fc.property(
        arbPieces.chain((pieces) =>
          fc.tuple(
            fc.constant(pieces),
            pieces.length === 0 ? fc.string() : fc.constantFrom(...pieces.map((p) => p.id)),
          ),
        ),
        arbStatus,
        arbSession,
        fc.string({ maxLength: 10 }),
        ([pieces, id], status, session, notes) => {
          const snapshot = JSON.parse(JSON.stringify(pieces)) as unknown
          setStatus(pieces, id, status)
          // recordSession throws on an unknown id (by design); only exercise it
          // when `id` matches, since the mutation-purity check below covers that
          // case, and setStatus/setNotes already cover the no-op/unknown-id path.
          if (pieces.some((p) => p.id === id)) {
            recordSession(pieces, id, session)
          }
          setNotes(pieces, id, notes)
          expect(JSON.parse(JSON.stringify(pieces)) as unknown).toEqual(snapshot)
        },
      ),
    )
  })
})
