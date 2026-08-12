/**
 * Bluetooth LE MIDI pairing (roadmap B.2, REQ-3.3.1) — the `useMidiConnection`
 * sibling for a BLE keyboard. Opt-in and explicit-gesture, like `useMicInput`:
 * `navigator.bluetooth.requestDevice` opens a real browser chooser, so it can
 * only ever fire from a direct click (`pair()`), never on mount.
 *
 * `MidiDeviceStatus` — rendered by all eight note-answered screens, none of
 * which this task may edit — calls this hook directly to grow the "Pair
 * Bluetooth MIDI" control without a new required prop on any of them. That
 * leaves exactly one open problem: how does the paired input actually reach
 * the matcher on those eight screens, none of which know this hook exists?
 *
 * The answer is `subscribeBluetoothMidiInput`: a module-level registry (one
 * `MidiInput | undefined` slot, shared by every import of this module in the
 * page — there is only ever one physical BLE pairing at a time, so one slot
 * is correct, not a simplification). `pair()` publishes into it and
 * `disconnect()`/unmount/a GATT drop clears it; `useMidiConnection.ts`
 * subscribes to it and fans its events into the same `input` it already
 * returns, additive to its existing shape (see that file's module comment).
 */
import { connectBluetoothMidi, isWebBluetoothSupported } from '@adapters/midi/index.ts'
import type { BluetoothMidi } from '@adapters/midi/index.ts'
import type { MidiDevice, MidiInput, Unsubscribe } from '@core/ports/index.ts'
import type { Result } from '@core/shared/result.ts'
import { useEffect, useRef, useState } from 'react'

/** Unlike `ConnectMidi`, this keeps `dispose` — a BLE pairing is a real, live
 *  GATT connection that must be torn down, not a fire-and-forget browser API. */
export type ConnectBluetoothMidi = () => Promise<Result<BluetoothMidi, string>>

type RegistryListener = (input: MidiInput | undefined) => void

const registryListeners = new Set<RegistryListener>()
let registryInput: MidiInput | undefined

function publish(input: MidiInput | undefined): void {
  registryInput = input
  for (const listener of registryListeners) listener(input)
}

/**
 * `useMidiConnection.ts`'s subscription seam — called once from that hook,
 * never from a screen. Fires immediately with whatever is currently paired
 * (or `undefined`), then again on every pair/disconnect.
 */
export function subscribeBluetoothMidiInput(listener: RegistryListener): Unsubscribe {
  registryListeners.add(listener)
  listener(registryInput)
  return () => {
    registryListeners.delete(listener)
  }
}

export type UseBluetoothMidiOptions = {
  /** Overrides how a real connection is made. Defaults to the Web Bluetooth adapter. */
  readonly connect?: ConnectBluetoothMidi
}

export type BluetoothMidiState = {
  /** Pure feature detection — no prompt. `false` hides the control entirely (roadmap B.7-style honesty). */
  readonly supported: boolean
  readonly pairing: boolean
  readonly device: MidiDevice | undefined
  /** Set when pairing or the connection attempt failed — cleared on the next `pair()`. */
  readonly error: string | undefined
  readonly pair: () => void
  readonly disconnect: () => void
}

const defaultConnect: ConnectBluetoothMidi = () => connectBluetoothMidi()

export function useBluetoothMidi(options: UseBluetoothMidiOptions = {}): BluetoothMidiState {
  const { connect = defaultConnect } = options
  const supported = isWebBluetoothSupported()
  const [pairing, setPairing] = useState(false)
  const [input, setInput] = useState<BluetoothMidi['input'] | undefined>(undefined)
  const [device, setDevice] = useState<MidiDevice | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  // A ref, not state: this must NOT trigger a re-render or an effect re-run
  // on its own (a `useState`-driven cleanup effect would fire its cleanup on
  // every value change, not only on unmount, wrongly publishing `undefined`
  // the instant a fresh pairing sets it).
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  // Guards a `pair()` promise resolving after this component already
  // unmounted (or a new `pair()` superseded it) — without this, that connect
  // would set state on a gone component and leak a GATT handle nothing ever
  // disposes.
  const liveRef = useRef(0)

  // Keep the device name live over a hot GATT disconnect (an empty device
  // list from `onDevicesChanged` means the peripheral dropped, mirroring
  // `useMidiConnection`'s own hot-plug handling).
  useEffect(() => {
    if (input === undefined) return undefined
    return input.onDevicesChanged((devices) => setDevice(devices[0]))
  }, [input])

  // Unmount only: clean up the real connection so a dropped screen does not
  // leave a GATT connection (and the browser's Bluetooth indicator) open
  // forever, and withdraw this hook's input from the shared registry.
  useEffect(() => {
    return () => {
      liveRef.current += 1
      disposeRef.current?.()
      disposeRef.current = undefined
      publish(undefined)
    }
  }, [])

  return {
    supported,
    pairing,
    device,
    error,
    pair: (): void => {
      if (pairing) return
      setError(undefined)
      setPairing(true)
      const generation = liveRef.current
      connect()
        .then((result) => {
          const stillLive = generation === liveRef.current
          if (stillLive) setPairing(false)
          if (!result.ok) {
            if (stillLive) setError(result.error)
            return
          }
          if (!stillLive) {
            // Unmounted (or the connection was superseded) while the browser's
            // chooser/GATT handshake was in flight — this pairing arrived too
            // late to use, but it still opened a real GATT connection that
            // must still be torn down.
            result.value.dispose()
            return
          }
          // Re-pairing while already connected: tear down the previous
          // connection first rather than leaking its GATT handle.
          disposeRef.current?.()
          const { input: newInput, dispose } = result.value
          disposeRef.current = dispose
          setInput(newInput)
          setDevice(newInput.listDevices()[0])
          publish(newInput)
        })
        .catch((reason: unknown) => {
          if (generation === liveRef.current) {
            setPairing(false)
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        })
    },
    disconnect: (): void => {
      disposeRef.current?.()
      disposeRef.current = undefined
      setInput(undefined)
      setDevice(undefined)
      publish(undefined)
    },
  }
}
