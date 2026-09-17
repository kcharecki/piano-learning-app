import { beforeEach, describe, expect, it } from 'vitest'
import type { ReadingRunRecord } from '@core/drums/reading/index.ts'
import { MAX_STORED_READING_RUNS, useDrumsReadingStore } from './drumsReadingStore.ts'

function run(overrides: Partial<ReadingRunRecord> = {}): ReadingRunRecord {
  return { level: 1, accuracy: 0.8, ...overrides }
}

beforeEach(() => {
  useDrumsReadingStore.setState({ level: 1, runs: [] })
})

describe('useDrumsReadingStore', () => {
  it('starts at level 1 with no runs', () => {
    expect(useDrumsReadingStore.getState().level).toBe(1)
    expect(useDrumsReadingStore.getState().runs).toEqual([])
  })

  it('setLevel replaces the level only', () => {
    useDrumsReadingStore.getState().addRun(run({ accuracy: 0.5 }))
    useDrumsReadingStore.getState().setLevel(3)
    expect(useDrumsReadingStore.getState().level).toBe(3)
    expect(useDrumsReadingStore.getState().runs).toHaveLength(1)
  })

  it('keeps the newest run first', () => {
    const first = run({ accuracy: 0.5 })
    const second = run({ accuracy: 0.9 })
    useDrumsReadingStore.getState().addRun(first)
    useDrumsReadingStore.getState().addRun(second)
    expect(useDrumsReadingStore.getState().runs).toEqual([second, first])
  })

  /** Persisted on every change; an uncapped history grows the saved blob without bound. */
  it('drops the oldest run past the cap', () => {
    for (let i = 0; i <= MAX_STORED_READING_RUNS; i++) {
      useDrumsReadingStore.getState().addRun(run({ accuracy: i / 100 }))
    }
    const runs = useDrumsReadingStore.getState().runs
    expect(runs).toHaveLength(MAX_STORED_READING_RUNS)
    expect(runs[0]?.accuracy).toBeCloseTo(MAX_STORED_READING_RUNS / 100)
    expect(runs.some((r) => r.accuracy === 0)).toBe(false)
  })

  it('hydrate replaces level and runs wholesale', () => {
    useDrumsReadingStore.getState().addRun(run({ accuracy: 0.1 }))
    const restored = run({ level: 4, accuracy: 0.95 })
    useDrumsReadingStore.getState().hydrate({ level: 4, runs: [restored] })
    expect(useDrumsReadingStore.getState().level).toBe(4)
    expect(useDrumsReadingStore.getState().runs).toEqual([restored])
  })

  it('hydrate can replace just one field, leaving the other alone', () => {
    useDrumsReadingStore.getState().addRun(run({ accuracy: 0.2 }))
    useDrumsReadingStore.getState().hydrate({ level: 5 })
    expect(useDrumsReadingStore.getState().level).toBe(5)
    expect(useDrumsReadingStore.getState().runs).toHaveLength(1)
  })
})
