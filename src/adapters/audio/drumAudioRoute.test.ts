/**
 * `vi.resetModules()` + a dynamic `import()` per test isolates each test's
 * copy of this module's in-memory `listeners` set, mirroring
 * `audioRoute.test.ts`'s own reasoning for its module-level cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DrumAudioRouteModule from './drumAudioRoute.ts'

async function freshDrumAudioRoute(): Promise<typeof DrumAudioRouteModule> {
  return import('./drumAudioRoute.ts')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  localStorage.clear()
})

describe('getDrumAudioRoute / setDrumAudioRoute', () => {
  it('defaults to synth when nothing has been chosen yet', async () => {
    const { getDrumAudioRoute } = await freshDrumAudioRoute()
    expect(getDrumAudioRoute()).toBe('synth')
  })

  it('persists the learner’s choice — a fresh read sees it', async () => {
    const { getDrumAudioRoute, setDrumAudioRoute } = await freshDrumAudioRoute()
    setDrumAudioRoute('midi')
    expect(getDrumAudioRoute()).toBe('midi')
  })

  it('round-trips back to synth', async () => {
    const { getDrumAudioRoute, setDrumAudioRoute } = await freshDrumAudioRoute()
    setDrumAudioRoute('midi')
    setDrumAudioRoute('synth')
    expect(getDrumAudioRoute()).toBe('synth')
  })
})

describe('subscribeDrumAudioRoute', () => {
  it('fires every subscriber with the new route on setDrumAudioRoute', async () => {
    const { setDrumAudioRoute, subscribeDrumAudioRoute } = await freshDrumAudioRoute()
    const seen: string[] = []
    subscribeDrumAudioRoute((route) => seen.push(route))

    setDrumAudioRoute('midi')
    setDrumAudioRoute('synth')

    expect(seen).toEqual(['midi', 'synth'])
  })

  it('the returned unsubscribe stops further notifications', async () => {
    const { setDrumAudioRoute, subscribeDrumAudioRoute } = await freshDrumAudioRoute()
    const seen: string[] = []
    const unsubscribe = subscribeDrumAudioRoute((route) => seen.push(route))

    setDrumAudioRoute('midi')
    unsubscribe()
    setDrumAudioRoute('synth')

    expect(seen).toEqual(['midi'])
  })

  it('two independent subscribers each see every change', async () => {
    const { setDrumAudioRoute, subscribeDrumAudioRoute } = await freshDrumAudioRoute()
    const a: string[] = []
    const b: string[] = []
    subscribeDrumAudioRoute((route) => a.push(route))
    subscribeDrumAudioRoute((route) => b.push(route))

    setDrumAudioRoute('midi')

    expect(a).toEqual(['midi'])
    expect(b).toEqual(['midi'])
  })
})
