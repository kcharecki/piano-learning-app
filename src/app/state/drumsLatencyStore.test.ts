import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOCAL_INPUT_ID,
  type LatencyRecord,
  offsetFor,
  useDrumsLatencyStore,
} from './drumsLatencyStore.ts'

function record(overrides: Partial<LatencyRecord> = {}): LatencyRecord {
  return {
    offsetMs: 30,
    spreadMs: 5,
    samples: 16,
    at: 1_700_000_000_000,
    ...overrides,
  }
}

beforeEach(() => {
  useDrumsLatencyStore.setState({ offsets: {} })
})

describe('useDrumsLatencyStore', () => {
  it('starts empty', () => {
    expect(useDrumsLatencyStore.getState().offsets).toEqual({})
  })

  it('setOffset stores a record under the input id', () => {
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record())
    expect(useDrumsLatencyStore.getState().offsets).toEqual({ [LOCAL_INPUT_ID]: record() })
  })

  it('setOffset replaces a previous record for the same input id', () => {
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record({ offsetMs: 30 }))
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record({ offsetMs: -10 }))
    expect(useDrumsLatencyStore.getState().offsets[LOCAL_INPUT_ID]).toEqual(record({ offsetMs: -10 }))
  })

  it('keeps separate input ids independent', () => {
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record({ offsetMs: 30 }))
    useDrumsLatencyStore.getState().setOffset('midi-device-1', record({ offsetMs: -8 }))
    const offsets = useDrumsLatencyStore.getState().offsets
    expect(offsets[LOCAL_INPUT_ID]?.offsetMs).toBe(30)
    expect(offsets['midi-device-1']?.offsetMs).toBe(-8)
  })

  it('clearOffset removes just that input id', () => {
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record())
    useDrumsLatencyStore.getState().setOffset('midi-device-1', record())
    useDrumsLatencyStore.getState().clearOffset(LOCAL_INPUT_ID)
    const offsets = useDrumsLatencyStore.getState().offsets
    expect(offsets[LOCAL_INPUT_ID]).toBeUndefined()
    expect(offsets['midi-device-1']).toBeDefined()
  })

  it('clearOffset on an id with nothing stored is a no-op', () => {
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record())
    useDrumsLatencyStore.getState().clearOffset('nothing-here')
    expect(useDrumsLatencyStore.getState().offsets).toEqual({ [LOCAL_INPUT_ID]: record() })
  })

  it('hydrate replaces the whole collection', () => {
    useDrumsLatencyStore.getState().setOffset(LOCAL_INPUT_ID, record())
    const restored = { 'midi-device-9': record({ offsetMs: 12 }) }
    useDrumsLatencyStore.getState().hydrate({ offsets: restored })
    expect(useDrumsLatencyStore.getState().offsets).toEqual(restored)
  })
})

describe('offsetFor', () => {
  it('is 0 when inputId is undefined', () => {
    expect(offsetFor({ offsets: { [LOCAL_INPUT_ID]: record() } }, undefined)).toBe(0)
  })

  it('is 0 when nothing is stored for that input', () => {
    expect(offsetFor({ offsets: {} }, LOCAL_INPUT_ID)).toBe(0)
  })

  it('returns the stored offset for that input', () => {
    expect(offsetFor({ offsets: { [LOCAL_INPUT_ID]: record({ offsetMs: 42 }) } }, LOCAL_INPUT_ID)).toBe(42)
  })
})
