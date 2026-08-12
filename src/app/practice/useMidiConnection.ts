/**
 * MIDI keyboard connection (roadmap 1.18, REQ-4.1): connects to the learner's
 * device via Web MIDI, publishes what it finds into the shared score store
 * (`availableMidiDevices` / `selectedMidiDeviceId`, both already declared
 * there — see `@app/state/scoreStore.ts` — for exactly this), and degrades to
 * "no MIDI keyboard connected" instead of failing: the app has to stay usable
 * for listening and reading with no hardware at all.
 *
 * Real connection is `createWebMidi` from `@adapters/midi`; both it and the
 * resulting `MidiInput` are injection seams (`connect` / `midiInput`) so
 * tests never touch `navigator.requestMIDIAccess`.
 *
 * Device selection is deliberately simple (REQ-4.6): the first device seen is
 * auto-selected, because a single-user app with one keyboard plugged in has
 * nothing to ask the user about.
 *
 * ## Bluetooth MIDI fan-in (roadmap B.2, REQ-3.3.1)
 *
 * `useBluetoothMidi.ts` cannot be wired in here as a second `connect` source
 * (its pairing is an explicit user gesture from a control deep in
 * `MidiDeviceStatus`, not something this hook can trigger itself) — instead it
 * publishes into a small module-level registry, and this hook subscribes to
 * it (`subscribeBluetoothMidiInput`) so a BLE note reaches the exact same
 * `MidiConnection.input` a USB note does, additive to the existing returned
 * shape. USB selection semantics (`selectedDeviceId`, auto-select-first,
 * `selectDevice`) stay anchored to the Web MIDI device exclusively — a paired
 * BLE keyboard is always-on the instant it is paired, never a candidate you
 * "select" among USB ports, mirroring how the microphone fallback
 * (`useMicInput`) is never a `MidiDevice` in this store either. When BOTH a
 * USB device and a BLE device are live, `input`'s events are the UNION of
 * both streams; when only BLE is live (no Web MIDI in this browser at all —
 * Safari, Firefox, iPadOS), `input` IS the BLE input directly.
 */
import { createWebMidi } from '@adapters/midi/index.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { subscribeBluetoothMidiInput } from './useBluetoothMidi.ts'
import type { MidiDevice, MidiEvent, MidiInput, Unsubscribe } from '@core/ports/index.ts'
import type { Result } from '@core/shared/result.ts'
import { useEffect, useMemo, useState } from 'react'

export type ConnectMidi = () => Promise<Result<{ readonly input: MidiInput }, string>>

export type UseMidiConnectionOptions = {
  /** A ready-made input — the test seam. Skips `connect` entirely when given. */
  readonly midiInput?: MidiInput
  /** Overrides how a real connection is made. Defaults to the Web MIDI adapter. */
  readonly connect?: ConnectMidi
}

export type MidiConnection = {
  readonly input: MidiInput | undefined
  readonly devices: readonly MidiDevice[]
  readonly selectedDeviceId: string | null
  /** Set when a real connection attempt failed — absent while still connecting. */
  readonly connectionError: string | undefined
}

async function defaultConnect(): Promise<Result<{ readonly input: MidiInput }, string>> {
  const result = await createWebMidi()
  if (!result.ok) return result
  return { ok: true, value: { input: result.value.input } }
}

/**
 * Fan a USB device's events together with a BLE device's, while every other
 * member (device list, selection) stays anchored to `primary` (the USB/Web
 * MIDI side) — see this file's module comment on why BLE never joins USB
 * device-selection semantics.
 */
function mergeInputs(primary: MidiInput, secondary: MidiInput): MidiInput {
  return {
    listDevices: () => primary.listDevices(),
    onEvent(handler: (event: MidiEvent) => void): Unsubscribe {
      const unsubscribePrimary = primary.onEvent(handler)
      const unsubscribeSecondary = secondary.onEvent(handler)
      return () => {
        unsubscribePrimary()
        unsubscribeSecondary()
      }
    },
    onDevicesChanged: (handler) => primary.onDevicesChanged(handler),
    selectDevice: (deviceId) => primary.selectDevice(deviceId),
    get selectedDeviceId() {
      return primary.selectedDeviceId
    },
  }
}

export function useMidiConnection(options: UseMidiConnectionOptions = {}): MidiConnection {
  const { midiInput, connect = defaultConnect } = options
  const [connected, setConnected] = useState<MidiInput | undefined>(midiInput)
  const [connectionError, setConnectionError] = useState<string | undefined>(undefined)
  const devices = useScoreStore((s) => s.availableMidiDevices)
  const selectedDeviceId = useScoreStore((s) => s.selectedMidiDeviceId)
  const setAvailableMidiDevices = useScoreStore((s) => s.setAvailableMidiDevices)
  const selectMidiDevice = useScoreStore((s) => s.selectMidiDevice)

  // A paired Bluetooth input, if any (roadmap B.2) — published by
  // `useBluetoothMidi.ts`'s pairing control deep inside `MidiDeviceStatus`,
  // picked up here through the module registry rather than a prop, since
  // pairing is an explicit gesture this hook has no way to trigger itself.
  const [bleInput, setBleInput] = useState<MidiInput | undefined>(undefined)
  useEffect(() => subscribeBluetoothMidiInput(setBleInput), [])

  // The input everything downstream reads. Additive over the pre-B.2 shape:
  // with no BLE pairing this is exactly `connected`, unchanged; with ONLY a
  // BLE pairing (no Web MIDI in this browser at all) it IS the BLE input; with
  // both, a note from either reaches the same event stream. Memoised on
  // identity of the two underlying inputs — `PracticeScreen` rebuilds its
  // `PlayableMidiInput` (unsubscribing/resubscribing) whenever `midi.input`'s
  // reference changes, so a fresh object here on every render would tear that
  // down and rebuild it every render, not just on an actual (re)connect.
  const input = useMemo<MidiInput | undefined>(() => {
    if (connected === undefined) return bleInput
    if (bleInput === undefined) return connected
    return mergeInputs(connected, bleInput)
  }, [connected, bleInput])

  // Connect once (or adopt the injected fake), never touching real hardware
  // when a test has already handed us an input.
  useEffect(() => {
    if (midiInput !== undefined) {
      setConnected(midiInput)
      return undefined
    }
    let cancelled = false
    connect()
      .then((result) => {
        if (cancelled) return
        if (result.ok) setConnected(result.value.input)
        else setConnectionError(result.error)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setConnectionError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [midiInput, connect])

  // Publish the device list into the shared store and keep it live over hot-plug.
  useEffect(() => {
    if (connected === undefined) return undefined
    setAvailableMidiDevices(connected.listDevices())
    return connected.onDevicesChanged((next) => setAvailableMidiDevices(next))
  }, [connected, setAvailableMidiDevices])

  // Auto-select the first device, and keep the adapter's own selection in sync
  // with the store whenever the store's choice changes.
  useEffect(() => {
    if (connected === undefined) return
    if (selectedDeviceId !== null) {
      connected.selectDevice(selectedDeviceId)
      return
    }
    const first = devices[0]
    if (first !== undefined) selectMidiDevice(first.id)
  }, [connected, devices, selectedDeviceId, selectMidiDevice])

  return { input, devices, selectedDeviceId, connectionError }
}
