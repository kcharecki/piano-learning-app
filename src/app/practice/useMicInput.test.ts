import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMicInput, type ConnectMic } from './useMicInput.ts'
import type { MicPitchInput } from '@adapters/audio/micPitchInput.ts'

function fakeMic(): MicPitchInput & { dispose: ReturnType<typeof vi.fn> } {
  return {
    listDevices: () => [{ id: 'microphone', name: 'Microphone', manufacturer: 'Built-in' }],
    onEvent: () => () => {},
    onDevicesChanged: () => () => {},
    selectDevice: () => {},
    selectedDeviceId: 'microphone',
    dispose: vi.fn(),
  }
}

describe('useMicInput', () => {
  it('starts disabled, with no input and no error', () => {
    const { result } = renderHook(() => useMicInput({ connect: () => new Promise(() => {}) }))
    expect(result.current.enabled).toBe(false)
    expect(result.current.input).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })

  it('enable() connects and publishes the resulting input', async () => {
    const mic = fakeMic()
    const connect: ConnectMic = () => Promise.resolve({ ok: true, value: mic })
    const { result } = renderHook(() => useMicInput({ connect }))

    act(() => result.current.enable())

    expect(result.current.enabled).toBe(true)
    await waitFor(() => expect(result.current.input).toBe(mic))
  })

  it('surfaces a failed connection (permission denied) as error, not a crash', async () => {
    const connect: ConnectMic = () => Promise.resolve({ ok: false, error: 'Permission denied' })
    const { result } = renderHook(() => useMicInput({ connect }))

    act(() => result.current.enable())

    await waitFor(() => expect(result.current.error).toBe('Permission denied'))
    expect(result.current.input).toBeUndefined()
  })

  it('disable() disposes the connected input and clears it', async () => {
    const mic = fakeMic()
    const connect: ConnectMic = () => Promise.resolve({ ok: true, value: mic })
    const { result } = renderHook(() => useMicInput({ connect }))

    act(() => result.current.enable())
    await waitFor(() => expect(result.current.input).toBe(mic))

    act(() => result.current.disable())

    expect(mic.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.input).toBeUndefined()
    expect(result.current.enabled).toBe(false)
  })

  it('disabling before a pending connect resolves disposes the input as soon as it arrives, instead of adopting it', async () => {
    const mic = fakeMic()
    let resolveConnect: (value: { ok: true; value: MicPitchInput }) => void = () => {}
    const connect: ConnectMic = () =>
      new Promise((resolve) => {
        resolveConnect = resolve
      })
    const { result } = renderHook(() => useMicInput({ connect }))

    act(() => result.current.enable())
    act(() => result.current.disable())
    await act(async () => {
      resolveConnect({ ok: true, value: mic })
    })

    expect(mic.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.input).toBeUndefined()
  })

  it('unmounting while connected disposes the input', async () => {
    const mic = fakeMic()
    const connect: ConnectMic = () => Promise.resolve({ ok: true, value: mic })
    const { result, unmount } = renderHook(() => useMicInput({ connect }))

    act(() => result.current.enable())
    await waitFor(() => expect(result.current.input).toBe(mic))

    unmount()

    expect(mic.dispose).toHaveBeenCalledTimes(1)
  })

  it('re-enabling after a failed attempt clears the previous error', async () => {
    const mic = fakeMic()
    let attempt = 0
    const connect: ConnectMic = () => {
      attempt += 1
      return Promise.resolve(
        attempt === 1 ? { ok: false, error: 'Permission denied' } : { ok: true, value: mic },
      )
    }
    const { result } = renderHook(() => useMicInput({ connect }))

    act(() => result.current.enable())
    await waitFor(() => expect(result.current.error).toBe('Permission denied'))

    act(() => result.current.disable())
    act(() => result.current.enable())

    await waitFor(() => expect(result.current.input).toBe(mic))
    expect(result.current.error).toBeUndefined()
  })
})
