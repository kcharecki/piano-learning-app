/**
 * `sightReadingStore` (roadmap 2.12) — state only. `addRecord` must use
 * `retire()`'s append-only rule rather than reimplementing it.
 */
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useSightReadingStore } from './sightReadingStore.ts'

function resetStore(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
}

afterEach(resetStore)

const RECORD_A: SightReadingRecord = { pieceId: 'a', readAt: 100, accuracy: 0.9, level: 1 }
const RECORD_B: SightReadingRecord = { pieceId: 'b', readAt: 200, accuracy: 0.5, level: 1 }

describe('useSightReadingStore', () => {
  it('starts at the minimum level with no history', () => {
    expect(useSightReadingStore.getState().level).toBe(MIN_LEVEL)
    expect(useSightReadingStore.getState().history).toEqual([])
  })

  it('setLevel replaces the level', () => {
    useSightReadingStore.getState().setLevel(3)
    expect(useSightReadingStore.getState().level).toBe(3)
  })

  it('addRecord appends, in order, without dropping earlier records', () => {
    useSightReadingStore.getState().addRecord(RECORD_A)
    useSightReadingStore.getState().addRecord(RECORD_B)

    expect(useSightReadingStore.getState().history).toEqual([RECORD_A, RECORD_B])
  })

  // Kills a mutant that has `hydrate` ignore its arguments (or fold them into
  // `setLevel`/`addRecord` and so re-append onto whatever is already there):
  // this is a wholesale replace, used by `persistence.ts`'s `restoreSession`.
  it('hydrate replaces level and history wholesale, not append', () => {
    useSightReadingStore.getState().addRecord(RECORD_A)
    useSightReadingStore.getState().setLevel(2)

    useSightReadingStore.getState().hydrate(4, [RECORD_B])

    expect(useSightReadingStore.getState().level).toBe(4)
    expect(useSightReadingStore.getState().history).toEqual([RECORD_B])
  })
})
