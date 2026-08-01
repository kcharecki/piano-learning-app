/**
 * The pump, tested by pumping it by hand — no real `requestAnimationFrame`
 * anywhere in this file. See `useTransportLoop.ts` for what each guarantee is
 * protecting against.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTransportLoop, type FrameDriver } from './useTransportLoop.ts'

type ManualDriver = {
  readonly driver: FrameDriver
  /** Invoke the frame callback the loop last subscribed with, if any. */
  pump(): void
  subscribed(): boolean
  cancelCount(): number
}

function manualDriver(): ManualDriver {
  let callback: (() => void) | undefined
  let cancels = 0
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      cancels += 1
      callback = undefined
    }
  }
  return {
    driver,
    pump: () => callback?.(),
    subscribed: () => callback !== undefined,
    cancelCount: () => cancels,
  }
}

describe('useTransportLoop', () => {
  it('never subscribes to the driver while inactive', () => {
    const manual = manualDriver()
    const onFrame = vi.fn()
    renderHook(() => useTransportLoop({ active: false, onFrame, driver: manual.driver }))

    expect(manual.subscribed()).toBe(false)
    manual.pump()
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('calls onFrame once per manual pump while active', () => {
    const manual = manualDriver()
    const onFrame = vi.fn()
    renderHook(() => useTransportLoop({ active: true, onFrame, driver: manual.driver }))

    expect(manual.subscribed()).toBe(true)
    manual.pump()
    manual.pump()
    expect(onFrame).toHaveBeenCalledTimes(2)
  })

  it('always calls the latest onFrame, never a stale closure', () => {
    const manual = manualDriver()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ onFrame }: { onFrame: () => void }) =>
        useTransportLoop({ active: true, onFrame, driver: manual.driver }),
      { initialProps: { onFrame: first } },
    )

    rerender({ onFrame: second })
    manual.pump()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes when active turns false, and resubscribes when it turns true again', () => {
    const manual = manualDriver()
    const onFrame = vi.fn()
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useTransportLoop({ active, onFrame, driver: manual.driver }),
      { initialProps: { active: true } },
    )

    expect(manual.subscribed()).toBe(true)
    rerender({ active: false })
    expect(manual.subscribed()).toBe(false)
    expect(manual.cancelCount()).toBe(1)

    rerender({ active: true })
    expect(manual.subscribed()).toBe(true)
    manual.pump()
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const manual = manualDriver()
    const onFrame = vi.fn()
    const { unmount } = renderHook(() =>
      useTransportLoop({ active: true, onFrame, driver: manual.driver }),
    )

    expect(manual.subscribed()).toBe(true)
    unmount()
    expect(manual.subscribed()).toBe(false)
    expect(manual.cancelCount()).toBe(1)
  })
})
