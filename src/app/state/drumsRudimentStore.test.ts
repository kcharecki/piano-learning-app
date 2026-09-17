import { beforeEach, describe, expect, it } from 'vitest'
import { type RudimentRecord, useDrumsRudimentStore } from './drumsRudimentStore.ts'

function record(overrides: Partial<RudimentRecord> = {}): RudimentRecord {
  return {
    bestCleanBpm: 80,
    lastBpm: 80,
    at: 1_700_000_000_000,
    ...overrides,
  }
}

beforeEach(() => {
  useDrumsRudimentStore.setState({ records: {} })
})

describe('useDrumsRudimentStore', () => {
  it('starts empty', () => {
    expect(useDrumsRudimentStore.getState().records).toEqual({})
  })

  it('records a first run under the rudiment id', () => {
    useDrumsRudimentStore.getState().recordRun('single-stroke-roll', record())
    expect(useDrumsRudimentStore.getState().records).toEqual({
      'single-stroke-roll': record(),
    })
  })

  it('keeps the higher bestCleanBpm across calls for the same rudiment', () => {
    useDrumsRudimentStore.getState().recordRun('single-paradiddle', record({ bestCleanBpm: 80, lastBpm: 80 }))
    useDrumsRudimentStore.getState().recordRun('single-paradiddle', record({ bestCleanBpm: 70, lastBpm: 70 }))
    expect(useDrumsRudimentStore.getState().records['single-paradiddle']).toEqual(
      record({ bestCleanBpm: 80, lastBpm: 70 }),
    )
  })

  it('raises bestCleanBpm when a later run clears a higher tempo', () => {
    useDrumsRudimentStore.getState().recordRun('flam', record({ bestCleanBpm: 60, lastBpm: 60 }))
    useDrumsRudimentStore.getState().recordRun('flam', record({ bestCleanBpm: 65, lastBpm: 65, at: 2 }))
    expect(useDrumsRudimentStore.getState().records.flam).toEqual({ bestCleanBpm: 65, lastBpm: 65, at: 2 })
  })

  it('keeps separate rudiments independent', () => {
    useDrumsRudimentStore.getState().recordRun('drag', record({ bestCleanBpm: 90 }))
    useDrumsRudimentStore.getState().recordRun('flam', record({ bestCleanBpm: 50 }))
    const records = useDrumsRudimentStore.getState().records
    expect(records.drag?.bestCleanBpm).toBe(90)
    expect(records.flam?.bestCleanBpm).toBe(50)
  })

  it('hydrate replaces the whole collection', () => {
    useDrumsRudimentStore.getState().recordRun('flam', record())
    const restored = { 'single-stroke-roll': record({ bestCleanBpm: 120, lastBpm: 120, at: 9 }) }
    useDrumsRudimentStore.getState().hydrate({ records: restored })
    expect(useDrumsRudimentStore.getState().records).toEqual(restored)
  })
})
