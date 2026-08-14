/**
 * `useBluetoothMidi` wiring: the injected fake never touches
 * `navigator.bluetooth`, and pairing/disconnect publish into the module
 * registry `useMidiConnection.ts` subscribes to (`subscribeBluetoothMidiInput`).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetBluetoothMidiForTests,
  subscribeBluetoothMidiInput,
  useBluetoothMidi,
  type ConnectBluetoothMidi,
} from './useBluetoothMidi.ts'
import type { BluetoothMidi } from '@adapters/midi/index.ts'
import type { MidiDevice, MidiInput } from '@core/ports/index.ts'

const DEVICE: MidiDevice = { id: 'bluetooth-midi', name: 'BLE Keyboard', manufacturer: 'Bluetooth LE' }

function fakeBleInput(devices: MidiDevice[] = [DEVICE]): MidiInput {
  return {
    listDevices: () => devices,
    onEvent: () => () => {},
    onDevicesChanged: () => () => {},
    selectDevice: () => {},
    selectedDeviceId: devices[0]?.id ?? null,
  }
}

function fakeBluetoothMidi(devices?: MidiDevice[]): BluetoothMidi & { dispose: ReturnType<typeof vi.fn> } {
  return { input: fakeBleInput(devices), dispose: vi.fn() }
}

/** Reads the registry's current value without leaving a listener subscribed. */
function registrySnapshot(): MidiInput | undefined {
  let snapshot: MidiInput | undefined
  subscribeBluetoothMidiInput((input) => {
    snapshot = input
  })()
  return snapshot
}

describe('useBluetoothMidi', () => {
  beforeEach(() => {
    resetBluetoothMidiForTests()
  })

  it('unmounting a consumer does not dispose the connection (regression: pairing must outlive a popover mount)', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const { result, unmount } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())
    await waitFor(() => expect(result.current.device).toEqual(DEVICE))

    unmount()

    expect(ble.dispose).not.toHaveBeenCalled()
    const seen: (MidiInput | undefined)[] = []
    const unsubscribe = subscribeBluetoothMidiInput((input) => seen.push(input))
    expect(seen.at(-1)).toBe(ble.input)
    unsubscribe()
  })

  it('starts unpaired, not pairing, with no error', () => {
    const { result } = renderHook(() => useBluetoothMidi({ connect: () => new Promise(() => {}) }))
    expect(result.current.pairing).toBe(false)
    expect(result.current.device).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })

  it('pair() connects and publishes the device', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const { result } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())

    expect(result.current.pairing).toBe(true)
    await waitFor(() => expect(result.current.device).toEqual(DEVICE))
    expect(result.current.pairing).toBe(false)
  })

  it('pair() publishes the input into the module registry for useMidiConnection to pick up', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const { result } = renderHook(() => useBluetoothMidi({ connect }))
    const seen: (MidiInput | undefined)[] = []
    const unsubscribe = subscribeBluetoothMidiInput((input) => seen.push(input))

    act(() => result.current.pair())
    await waitFor(() => expect(seen.at(-1)).toBe(ble.input))

    unsubscribe()
  })

  it('surfaces a cancelled/failed pairing as error, not a crash', async () => {
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: false, error: 'Bluetooth pairing was cancelled' })
    const { result } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())

    await waitFor(() => expect(result.current.error).toBe('Bluetooth pairing was cancelled'))
    expect(result.current.device).toBeUndefined()
    expect(result.current.pairing).toBe(false)
  })

  it('disconnect() disposes the connection, clears the device, and withdraws from the registry', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const { result } = renderHook(() => useBluetoothMidi({ connect }))
    const seen: (MidiInput | undefined)[] = []
    const unsubscribe = subscribeBluetoothMidiInput((input) => seen.push(input))

    act(() => result.current.pair())
    await waitFor(() => expect(result.current.device).toEqual(DEVICE))

    act(() => result.current.disconnect())

    expect(ble.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.device).toBeUndefined()
    expect(seen.at(-1)).toBeUndefined()
    unsubscribe()
  })

  it('a GATT disconnect (onDevicesChanged firing empty) clears the shown device', async () => {
    let changeHandler: ((devices: readonly MidiDevice[]) => void) | undefined
    const input: MidiInput = {
      listDevices: () => [DEVICE],
      onEvent: () => () => {},
      onDevicesChanged: (handler) => {
        changeHandler = handler
        return () => {}
      },
      selectDevice: () => {},
      selectedDeviceId: DEVICE.id,
    }
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: { input, dispose: vi.fn() } })
    const { result } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())
    await waitFor(() => expect(result.current.device).toEqual(DEVICE))

    act(() => changeHandler?.([]))

    await waitFor(() => expect(result.current.device).toBeUndefined())
  })

  it('two simultaneous consumers share one connection: pairing from one is seen by both, and unmounting one leaves the other (and the registry) untouched', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const a = renderHook(() => useBluetoothMidi({ connect }))
    const b = renderHook(() => useBluetoothMidi({ connect: () => new Promise(() => {}) }))

    act(() => a.result.current.pair())
    await waitFor(() => expect(a.result.current.device).toEqual(DEVICE))
    // The second consumer never called its own pair() — it must still observe
    // the pairing the first consumer made, because there is one connection.
    expect(b.result.current.device).toEqual(DEVICE)
    expect(b.result.current.pairing).toBe(false)

    a.unmount()

    expect(ble.dispose).not.toHaveBeenCalled()
    expect(b.result.current.device).toEqual(DEVICE)
    expect(registrySnapshot()).toBe(ble.input)

    b.unmount()
  })

  it('disconnect() tears down for every consumer at once', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const a = renderHook(() => useBluetoothMidi({ connect }))
    const b = renderHook(() => useBluetoothMidi({ connect }))

    act(() => a.result.current.pair())
    await waitFor(() => expect(a.result.current.device).toEqual(DEVICE))
    expect(b.result.current.device).toEqual(DEVICE)

    act(() => a.result.current.disconnect())

    expect(ble.dispose).toHaveBeenCalledTimes(1)
    expect(a.result.current.device).toBeUndefined()
    expect(b.result.current.device).toBeUndefined()
    expect(registrySnapshot()).toBeUndefined()

    a.unmount()
    b.unmount()
  })

  it('a pair() that is still in flight when disconnect() runs is disposed on late arrival, not adopted', async () => {
    const ble = fakeBluetoothMidi()
    let resolveConnect: (value: { ok: true; value: BluetoothMidi }) => void = () => {}
    const connect: ConnectBluetoothMidi = () =>
      new Promise((resolve) => {
        resolveConnect = resolve
      })
    const { result, unmount } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())
    act(() => result.current.disconnect())
    await act(async () => {
      resolveConnect({ ok: true, value: ble })
    })

    expect(ble.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.device).toBeUndefined()
    unmount()
  })

  it('a pair() superseded by a newer pair() (after a disconnect frees the guard) is disposed on late arrival, not adopted', async () => {
    const stale = fakeBluetoothMidi([{ id: 'stale', name: 'Stale Keyboard', manufacturer: 'Bluetooth LE' }])
    const fresh = fakeBluetoothMidi()
    let resolveStale: (value: { ok: true; value: BluetoothMidi }) => void = () => {}
    let calls = 0
    const connect: ConnectBluetoothMidi = () => {
      calls += 1
      if (calls === 1) return new Promise((resolve) => (resolveStale = resolve))
      return Promise.resolve({ ok: true, value: fresh })
    }
    const { result, unmount } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair()) // stale pairing, left in flight
    act(() => result.current.disconnect()) // frees the `pairing` guard without resolving it
    act(() => result.current.pair()) // fresh pairing, resolves immediately
    await waitFor(() => expect(result.current.device).toEqual(DEVICE))

    await act(async () => {
      resolveStale({ ok: true, value: stale })
    })

    expect(stale.dispose).toHaveBeenCalledTimes(1)
    expect(fresh.dispose).not.toHaveBeenCalled()
    // The late, disposed pairing must not have clobbered the fresh one.
    expect(result.current.device).toEqual(DEVICE)
    unmount()
  })

  it('re-pairing after a failed attempt clears the previous error', async () => {
    const ble = fakeBluetoothMidi()
    let attempt = 0
    const connect: ConnectBluetoothMidi = () => {
      attempt += 1
      return Promise.resolve(attempt === 1 ? { ok: false, error: 'no device chosen' } : { ok: true, value: ble })
    }
    const { result } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())
    await waitFor(() => expect(result.current.error).toBe('no device chosen'))

    act(() => result.current.pair())

    await waitFor(() => expect(result.current.device).toEqual(DEVICE))
    expect(result.current.error).toBeUndefined()
  })
})
