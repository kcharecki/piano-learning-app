/**
 * `useOnboardingGate` (roadmap 5.40): the restore/persist contract behind the
 * first-run banner. `MemoryStore` (`@test/fakes`) stands in for IndexedDB —
 * no real browser storage in this test, per the testing rules.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '@test/fakes.ts'
import type { Store } from '@core/ports/index.ts'
import {
  ONBOARDING_COLLECTION,
  ONBOARDING_KEY,
  useOnboardingGate,
  type OnboardingRecord,
} from './useOnboardingGate.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useOnboardingGate', () => {
  it('starts not hydrated, then resolves completed=false against an empty store (a genuine fresh install)', async () => {
    const store = new MemoryStore()
    const { result } = renderHook(() => useOnboardingGate({ openStore: async () => store }))

    expect(result.current.hydrated).toBe(false)

    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.completed).toBe(false)
  })

  it('restores completed=true from an existing record', async () => {
    const store = new MemoryStore()
    await store.put<OnboardingRecord>(ONBOARDING_COLLECTION, ONBOARDING_KEY, { completed: true })

    const { result } = renderHook(() => useOnboardingGate({ openStore: async () => store }))

    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.completed).toBe(true)
  })

  it('fails OPEN on a broken store — never traps the learner behind onboarding they cannot reach', async () => {
    const openStore = async (): Promise<Store> => {
      throw new Error('IndexedDB unavailable')
    }
    const { result } = renderHook(() => useOnboardingGate({ openStore }))

    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.completed).toBe(true)
  })

  it('markCompleted flips state immediately and persists it', async () => {
    const store = new MemoryStore()
    const { result } = renderHook(() => useOnboardingGate({ openStore: async () => store }))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => {
      result.current.markCompleted()
    })
    expect(result.current.completed).toBe(true)

    await waitFor(async () => {
      const raw = await store.get<OnboardingRecord>(ONBOARDING_COLLECTION, ONBOARDING_KEY)
      expect(raw).toEqual({ completed: true })
    })
  })

  it('does not crash when markCompleted is called against a broken store', async () => {
    const openStore = async (): Promise<Store> => {
      throw new Error('IndexedDB unavailable')
    }
    const { result } = renderHook(() => useOnboardingGate({ openStore }))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(() => {
      act(() => {
        result.current.markCompleted()
      })
    }).not.toThrow()
  })
})
