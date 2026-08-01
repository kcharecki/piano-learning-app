/**
 * MIDI connection wiring: the injected fake never touches
 * `navigator.requestMIDIAccess`, and the store's device list / selection stay
 * in sync with it (`@app/state/scoreStore.ts` owns that state — this only
 * asserts the hook publishes into it correctly).
 */
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { MidiDevice } from '@core/ports/index.ts'
import { act, renderHook, waitFor } from '@testing-library/react'
import { FakeMidiInput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMidiConnection, type ConnectMidi } from './useMidiConnection.ts'

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
