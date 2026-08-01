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
 */
import { createWebMidi } from '@adapters/midi/index.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import type { MidiDevice, MidiInput } from '@core/ports/index.ts'
import type { Result } from '@core/shared/result.ts'
import { useEffect, useState } from 'react'

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

export function useMidiConnection(options: UseMidiConnectionOptions = {}): MidiConnection {
  const { midiInput, connect = defaultConnect } = options
  const [connected, setConnected] = useState<MidiInput | undefined>(midiInput)
  const [connectionError, setConnectionError] = useState<string | undefined>(undefined)
  const devices = useScoreStore((s) => s.availableMidiDevices)
  const selectedDeviceId = useScoreStore((s) => s.selectedMidiDeviceId)
  const setAvailableMidiDevices = useScoreStore((s) => s.setAvailableMidiDevices)
  const selectMidiDevice = useScoreStore((s) => s.selectMidiDevice)

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

  return { input: connected, devices, selectedDeviceId, connectionError }
}
