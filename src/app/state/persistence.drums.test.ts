/**
 * The rudiment trainer's persisted slice (roadmap DR-10): the validator, the
 * round trip through `startPersisting` → `restoreSession`, and the
 * "corrupt payload degrades to defaults" contract every slice honours. The
 * groove-history and reading slices that share `persistence.drums.ts` are
 * covered in `persistence.collections.test.ts` and `drumsReadingStore.test.ts`.
 */
import { MemoryStore } from '@test/fakes.ts'
import { CountingStore, flush, persist, resetStore, teardownPersisters } from '@test/persistenceHarness.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDrumsRudimentStore, type RudimentRecord } from './drumsRudimentStore.ts'
import { isValidDrumsRudiments } from './persistedShapes.ts'
import { DRUMS_RUDIMENTS_COLLECTION, DRUMS_RUDIMENTS_KEY, restoreSession } from './persistence.ts'

const RECORD: RudimentRecord = { bestCleanBpm: 96, lastBpm: 104, at: 1_700_000_000_000 }

describe('isValidDrumsRudiments', () => {
  it('accepts an empty collection and a well-formed record', () => {
    expect(isValidDrumsRudiments({ records: {} })).toBe(true)
    expect(isValidDrumsRudiments({ records: { 'single-paradiddle': RECORD } })).toBe(true)
  })

  it.each([
    ['not an object', 'nope'],
    ['records missing', {}],
    ['records is an array', { records: [] }],
    ['a record with a non-finite best', { records: { x: { ...RECORD, bestCleanBpm: Number.NaN } } }],
    ['a record with a zero best', { records: { x: { ...RECORD, bestCleanBpm: 0 } } }],
    ['a record missing its timestamp', { records: { x: { bestCleanBpm: 96, lastBpm: 104 } } }],
  ])('rejects %s', (_label, payload) => {
    expect(isValidDrumsRudiments(payload)).toBe(false)
  })
})

describe('the rudiment records slice', () => {
  beforeEach(() => {
    resetStore()
    useDrumsRudimentStore.setState({ records: {} })
  })

  afterEach(() => {
    teardownPersisters()
    useDrumsRudimentStore.setState({ records: {} })
  })

  it('round-trips a record through startPersisting and restoreSession', async () => {
    const store = new MemoryStore()
    const unsubscribe = persist(store)

    useDrumsRudimentStore.getState().recordRun('single-paradiddle', RECORD)
    await flush()
    unsubscribe()

    useDrumsRudimentStore.setState({ records: {} })
    await restoreSession(store)

    expect(useDrumsRudimentStore.getState().records).toEqual({ 'single-paradiddle': RECORD })
  })

  it('degrades to no records on a corrupt payload instead of throwing', async () => {
    const store = new MemoryStore()
    await store.put(DRUMS_RUDIMENTS_COLLECTION, DRUMS_RUDIMENTS_KEY, { records: 'nope' })

    await expect(restoreSession(store)).resolves.toBe(false)

    expect(useDrumsRudimentStore.getState().records).toEqual({})
  })

  it('does not write the restored value straight back out', async () => {
    const store = new CountingStore()
    await store.put(DRUMS_RUDIMENTS_COLLECTION, DRUMS_RUDIMENTS_KEY, { records: { flam: RECORD } })
    await restoreSession(store)
    persist(store)

    const before = store.putCount
    await flush()

    expect(store.putCount).toBe(before)
  })
})
