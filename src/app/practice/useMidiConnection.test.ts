/**
 * MIDI connection wiring: the injected fake never touches
 * `navigator.requestMIDIAccess`, and the store's device list / selection stay
 * in sync with it (`@app/state/scoreStore.ts` owns that state — this only
 * asserts the hook publishes into it correctly).
 */
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { MidiDevice, MidiEvent } from '@core/ports/index.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, renderHook, waitFor } from '@testing-library/react'
import { FakeMidiInput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMidiConnection, type ConnectMidi } from './useMidiConnection.ts'
import {
  useBluetoothMidi,
  resetBluetoothMidiForTests,
  type ConnectBluetoothMidi,
} from './useBluetoothMidi.ts'

const DEVICE_A: MidiDevice = { id: 'a', name: 'Keyboard A', manufacturer: 'Test' }
const DEVICE_B: MidiDevice = { id: 'b', name: 'Keyboard B', manufacturer: 'Test' }

function resetStore(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
}

beforeEach(resetStore)
afterEach(resetStore)

// A BLE pairing is app-global state that deliberately outlives every component
// (see useBluetoothMidi.ts — tying it to a mount is what silently killed a
// learner's pairing the moment they clicked anything). That means it also
// outlives a TEST: without this, one case's pairing stays in the shared
// registry and the next case's `useMidiConnection` merges a BLE input it never
// asked for, so `input` is a merged stream rather than the USB input.
beforeEach(resetBluetoothMidiForTests)
afterEach(resetBluetoothMidiForTests)

describe('useMidiConnection', () => {
  it('reports no connection and no devices when nothing is injected and connect is never asked to resolve', () => {
    const { result } = renderHook(() => useMidiConnection({ connect: () => new Promise(() => {}) }))
    expect(result.current.input).toBeUndefined()
    expect(result.current.devices).toEqual([])
    expect(result.current.connectionError).toBeUndefined()
  })

  it('adopts an injected MidiInput directly, publishing its devices into the store', async () => {
    const fake = new FakeMidiInput([DEVICE_A])
    const { result } = renderHook(() => useMidiConnection({ midiInput: fake }))

    await waitFor(() => expect(result.current.input).toBe(fake))
    await waitFor(() => expect(result.current.devices).toEqual([DEVICE_A]))
    await waitFor(() => expect(result.current.selectedDeviceId).toBe('a'))
  })

  it('auto-selects the first device when nothing is selected yet', async () => {
    const fake = new FakeMidiInput([DEVICE_A, DEVICE_B])
    const { result } = renderHook(() => useMidiConnection({ midiInput: fake }))

    await waitFor(() => expect(result.current.selectedDeviceId).toBe('a'))
    expect(fake.selectedDeviceId).toBe('a')
    expect(useScoreStore.getState().selectedMidiDeviceId).toBe('a')
  })

  it('follows a hot-plug device list change', async () => {
    const fake = new FakeMidiInput([DEVICE_A])
    const { result } = renderHook(() => useMidiConnection({ midiInput: fake }))
    await waitFor(() => expect(result.current.devices).toEqual([DEVICE_A]))
    await waitFor(() => expect(result.current.selectedDeviceId).toBe('a'))

    act(() => fake.setDevices([DEVICE_A, DEVICE_B]))

    await waitFor(() => expect(result.current.devices).toEqual([DEVICE_A, DEVICE_B]))
  })

  it('surfaces a failed real connection as connectionError, not a crash', async () => {
    const connect: ConnectMidi = () =>
      Promise.resolve({ ok: false, error: 'no Web MIDI in this browser' })
    const { result } = renderHook(() => useMidiConnection({ connect }))

    await waitFor(() => expect(result.current.connectionError).toBe('no Web MIDI in this browser'))
    expect(result.current.input).toBeUndefined()
  })

  it('connects via the provided factory and publishes its devices', async () => {
    const fake = new FakeMidiInput([DEVICE_A])
    const connect: ConnectMidi = () => Promise.resolve({ ok: true, value: { input: fake } })
    const { result } = renderHook(() => useMidiConnection({ connect }))

    await waitFor(() => expect(result.current.input).toBe(fake))
    await waitFor(() => expect(result.current.devices).toEqual([DEVICE_A]))
    await waitFor(() => expect(result.current.selectedDeviceId).toBe('a'))
  })
})

describe('useMidiConnection — Bluetooth MIDI fan-in (roadmap B.2)', () => {
  const BLE_DEVICE: MidiDevice = { id: 'bluetooth-midi', name: 'BLE Keyboard', manufacturer: 'Bluetooth LE' }

  it('when only BLE is paired (no Web MIDI in this browser), input IS the BLE input', async () => {
    const ble = new FakeMidiInput([BLE_DEVICE])
    const connectBle: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: { input: ble, dispose: () => {} } })
    const connectMidi: ConnectMidi = () => new Promise(() => {}) // never resolves: no Web MIDI here
    const { result } = renderHook(() => ({
      midi: useMidiConnection({ connect: connectMidi }),
      bluetooth: useBluetoothMidi({ connect: connectBle }),
    }))

    act(() => result.current.bluetooth.pair())
    await waitFor(() => expect(result.current.bluetooth.device).toEqual(BLE_DEVICE))

    expect(result.current.midi.input).toBe(ble)
  })

  it('when both a USB device and BLE are connected, a note from either reaches the merged input', async () => {
    const usb = new FakeMidiInput([DEVICE_A])
    const ble = new FakeMidiInput([BLE_DEVICE])
    const connectBle: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: { input: ble, dispose: () => {} } })
    const { result } = renderHook(() => ({
      midi: useMidiConnection({ midiInput: usb }),
      bluetooth: useBluetoothMidi({ connect: connectBle }),
    }))
    await waitFor(() => expect(result.current.midi.input).toBe(usb))

    act(() => result.current.bluetooth.pair())
    await waitFor(() => expect(result.current.bluetooth.device).toEqual(BLE_DEVICE))

    const seen: MidiEvent[] = []
    act(() => {
      result.current.midi.input?.onEvent((event) => seen.push(event))
    })
    act(() => usb.emit({ type: 'noteOn', note: midi(60), velocity: 100, time: millis(1) }))
    act(() => ble.emit({ type: 'noteOn', note: midi(64), velocity: 90, time: millis(2) }))

    expect(seen).toEqual([
      { type: 'noteOn', note: 60, velocity: 100, time: 1 },
      { type: 'noteOn', note: 64, velocity: 90, time: 2 },
    ])
    // Device selection/list stays anchored to the USB side, unaffected by BLE.
    expect(result.current.midi.devices).toEqual([DEVICE_A])
  })

  it('disconnecting BLE removes it from the merged stream without disturbing the USB connection', async () => {
    const usb = new FakeMidiInput([DEVICE_A])
    const ble = new FakeMidiInput([BLE_DEVICE])
    const connectBle: ConnectBluetoothMidi = () => Promise.resolve({ ok: true, value: { input: ble, dispose: () => {} } })
    const { result } = renderHook(() => ({
      midi: useMidiConnection({ midiInput: usb }),
      bluetooth: useBluetoothMidi({ connect: connectBle }),
    }))
    await waitFor(() => expect(result.current.midi.input).toBe(usb))
    act(() => result.current.bluetooth.pair())
    await waitFor(() => expect(result.current.midi.input).not.toBe(usb))

    act(() => result.current.bluetooth.disconnect())

    await waitFor(() => expect(result.current.midi.input).toBe(usb))
  })
})
