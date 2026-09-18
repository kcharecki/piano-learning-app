/**
 * The latency-offset slice (roadmap DR-08): the validator, the round trip
 * through `startPersisting` -> `restoreSession`, and the "corrupt payload
 * degrades to defaults" contract every slice honours.
 */
import { MemoryStore } from '@test/fakes.ts'
import { CountingStore, flush, persist, resetStore, teardownPersisters } from '@test/persistenceHarness.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDrumsLatencyStore, type LatencyRecord } from './drumsLatencyStore.ts'
import { isValidDrumsLatency } from './persistedShapes.ts'
import { DRUMS_LATENCY_COLLECTION, DRUMS_LATENCY_KEY, restoreSession } from './persistence.ts'

const RECORD: LatencyRecord = { offsetMs: 28.5, spreadMs: 6, samples: 16, at: 1_700_000_000_000 }

describe('isValidDrumsLatency', () => {
  it('accepts an empty collection and a well-formed record', () => {
    expect(isValidDrumsLatency({ offsets: {} })).toBe(true)
    expect(
      isValidDrumsLatency({ offsets: { local: RECORD, 'ekit-1': { ...RECORD, offsetMs: -12 } } }),
    ).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['offsets missing', {}],
    ['offsets is an array', { offsets: [] }],
    ['a record with a non-finite offset', { offsets: { x: { ...RECORD, offsetMs: Number.NaN } } }],
    ['a record with a negative spread', { offsets: { x: { ...RECORD, spreadMs: -1 } } }],
    ['a record with zero samples', { offsets: { x: { ...RECORD, samples: 0 } } }],
    ['a record missing its timestamp', { offsets: { x: { offsetMs: 1, spreadMs: 1, samples: 8 } } }],
  ])('rejects %s', (_label, payload) => {
    expect(isValidDrumsLatency(payload)).toBe(false)
  })
})

describe('the latency offsets slice', () => {
  beforeEach(() => {
    resetStore()
    useDrumsLatencyStore.setState({ offsets: {} })
  })

  afterEach(() => {
    teardownPersisters()
    useDrumsLatencyStore.setState({ offsets: {} })
  })

  it('round-trips an offset through startPersisting and restoreSession', async () => {
    const store = new MemoryStore()
    const unsubscribe = persist(store)

    useDrumsLatencyStore.getState().setOffset('ekit-1', RECORD)
    await flush()
    unsubscribe()

    useDrumsLatencyStore.setState({ offsets: {} })
    await restoreSession(store)

    expect(useDrumsLatencyStore.getState().offsets).toEqual({ 'ekit-1': RECORD })
  })

  it('degrades to no offsets on a corrupt payload instead of throwing', async () => {
    const store = new MemoryStore()
    await store.put(DRUMS_LATENCY_COLLECTION, DRUMS_LATENCY_KEY, { offsets: 'nope' })

    await expect(restoreSession(store)).resolves.toBe(false)

    expect(useDrumsLatencyStore.getState().offsets).toEqual({})
  })

  it('does not write the restored value straight back out', async () => {
    const store = new CountingStore()
    await store.put(DRUMS_LATENCY_COLLECTION, DRUMS_LATENCY_KEY, { offsets: { local: RECORD } })
    await restoreSession(store)
    persist(store)

    const before = store.putCount
    await flush()

    expect(store.putCount).toBe(before)
  })
})
