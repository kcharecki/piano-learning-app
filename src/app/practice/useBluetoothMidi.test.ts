/**
 * `useBluetoothMidi` wiring: the injected fake never touches
 * `navigator.bluetooth`, and pairing/disconnect publish into the module
 * registry `useMidiConnection.ts` subscribes to (`subscribeBluetoothMidiInput`).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { subscribeBluetoothMidiInput, useBluetoothMidi, type ConnectBluetoothMidi } from './useBluetoothMidi.ts'
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

describe('useBluetoothMidi', () => {
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

  it('unmounting while paired disposes the connection and withdraws from the registry', async () => {
    const ble = fakeBluetoothMidi()
    const connect: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: ble })
    const { result, unmount } = renderHook(() => useBluetoothMidi({ connect }))
    const seen: (MidiInput | undefined)[] = []
    const unsubscribe = subscribeBluetoothMidiInput((input) => seen.push(input))

    act(() => result.current.pair())
    await waitFor(() => expect(result.current.device).toEqual(DEVICE))

    unmount()

    expect(ble.dispose).toHaveBeenCalledTimes(1)
    expect(seen.at(-1)).toBeUndefined()
    unsubscribe()
  })

  it('unmounting before a pending pair() resolves disposes it as soon as it arrives, instead of adopting it', async () => {
    const ble = fakeBluetoothMidi()
    let resolveConnect: (value: { ok: true; value: BluetoothMidi }) => void = () => {}
    const connect: ConnectBluetoothMidi = () =>
      new Promise((resolve) => {
        resolveConnect = resolve
      })
    const { result, unmount } = renderHook(() => useBluetoothMidi({ connect }))

    act(() => result.current.pair())
    unmount()
    await act(async () => {
      resolveConnect({ ok: true, value: ble })
    })

    expect(ble.dispose).toHaveBeenCalledTimes(1)
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
