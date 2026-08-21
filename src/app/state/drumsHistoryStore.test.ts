/**
 * `useDrumsHistoryStore` proves nothing about a groove run — it only holds
 * what `gradeGroovePerformance` (via `addAttempt`) or `persistence.ts`'s
 * restore (via `hydrate`) hands it, exactly as handed. These tests cover the
 * three behaviours the store's own module comment claims: newest-first
 * ordering, a hard cap at `MAX_STORED_GROOVE_ATTEMPTS` that drops the
 * OLDEST entry (not the newest), and `hydrate` replacing the whole
 * collection rather than merging into it — the same contract
 * `techniqueStore.ts` uses, since this module was built as its drums-side
 * counterpart.
 */
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_STORED_GROOVE_ATTEMPTS, useDrumsHistoryStore } from './drumsHistoryStore.ts'

function makeAttempt(overrides: Partial<DrumsGrooveAttempt> = {}): DrumsGrooveAttempt {
  return {
    grooveId: 'money-beat',
    grooveTitle: 'Money Beat',
    bpm: 80,
    repeats: 4,
    at: 1000,
    steady: true,
    pads: [
      {
        pad: 'hhClosed',
        expected: 16,
        matched: 16,
        missed: 0,
        extra: 0,
        meanOffsetMs: 3,
        worstOffsetMs: 8,
        spreadMs: 5,
        toleranceMs: 100,
        steadyBarMs: 35,
        gridTicks: 240,
        phaseSlipSteps: undefined,
        steady: true,
      },
    ],
    ...overrides,
  }
}

describe('useDrumsHistoryStore', () => {
  beforeEach(() => {
    useDrumsHistoryStore.setState({ attempts: [] })
  })

  it('addAttempt prepends, so attempts is newest first', () => {
    const first = makeAttempt({ grooveId: 'a' })
    const second = makeAttempt({ grooveId: 'b' })

    useDrumsHistoryStore.getState().addAttempt(first)
    useDrumsHistoryStore.getState().addAttempt(second)

    expect(useDrumsHistoryStore.getState().attempts).toEqual([second, first])
  })

  it(`caps the list at MAX_STORED_GROOVE_ATTEMPTS (${MAX_STORED_GROOVE_ATTEMPTS}), dropping the OLDEST entry`, () => {
    const total = MAX_STORED_GROOVE_ATTEMPTS + 1
    for (let i = 1; i <= total; i++) {
      useDrumsHistoryStore.getState().addAttempt(makeAttempt({ grooveId: `g${i}` }))
    }

    const { attempts } = useDrumsHistoryStore.getState()
    expect(attempts).toHaveLength(MAX_STORED_GROOVE_ATTEMPTS)
    // Newest (g{total}) survives at the front...
    expect(attempts[0]?.grooveId).toBe(`g${total}`)
    // ...and the very oldest (g1) is the one dropped, not some other entry.
    expect(attempts.some((a) => a.grooveId === 'g1')).toBe(false)
    expect(attempts.at(-1)?.grooveId).toBe('g2')
  })

  it('hydrate replaces the collection wholesale, not merges into it', () => {
    useDrumsHistoryStore.getState().addAttempt(makeAttempt({ grooveId: 'stale' }))

    const fresh = [makeAttempt({ grooveId: 'restored-1' }), makeAttempt({ grooveId: 'restored-2' })]
    useDrumsHistoryStore.getState().hydrate({ attempts: fresh })

    expect(useDrumsHistoryStore.getState().attempts).toEqual(fresh)
  })

  it('makes no judgement of its own: a self-contradictory attempt is stored exactly as given', () => {
    // steady: true even though the pad row shows a miss — a real caller would
    // never produce this, but the store's job is to hold what it is handed,
    // not to recompute or veto it. See the module comment on why this is
    // "STATE ONLY".
    const contradictory = makeAttempt({
      steady: true,
      pads: [
        {
          pad: 'snare',
          expected: 4,
          matched: 3,
          missed: 1,
          extra: 0,
          meanOffsetMs: -6,
          worstOffsetMs: -12,
          spreadMs: 6,
          toleranceMs: 100,
          steadyBarMs: 35,
          gridTicks: 240,
          phaseSlipSteps: undefined,
          steady: true,
        },
      ],
    })

    useDrumsHistoryStore.getState().addAttempt(contradictory)

    const [stored] = useDrumsHistoryStore.getState().attempts
    expect(stored?.steady).toBe(true)
    expect(stored?.pads).toEqual(contradictory.pads)
  })

  it('passes an unmatched pad row (undefined offsets) through untouched', () => {
    const withUnmatchedPad = makeAttempt({
      pads: [
        {
          pad: 'kick',
          expected: 4,
          matched: 0,
          missed: 4,
          extra: 0,
          meanOffsetMs: undefined,
          worstOffsetMs: undefined,
          spreadMs: undefined,
          toleranceMs: 100,
          steadyBarMs: 35,
          gridTicks: 240,
          phaseSlipSteps: undefined,
          steady: false,
        },
      ],
    })

    useDrumsHistoryStore.getState().addAttempt(withUnmatchedPad)

    expect(useDrumsHistoryStore.getState().attempts).toEqual([withUnmatchedPad])
  })
})
