/**
 * Bluetooth LE MIDI pairing (roadmap B.2, REQ-3.3.1) — the `useMidiConnection`
 * sibling for a BLE keyboard. Opt-in and explicit-gesture, like `useMicInput`:
 * `navigator.bluetooth.requestDevice` opens a real browser chooser, so it can
 * only ever fire from a direct click (`pair()`), never on mount.
 *
 * `MidiDeviceStatus` calls this hook directly to grow the "Pair Bluetooth
 * MIDI" control without a new required prop on any of its callers. That
 * leaves exactly one open problem: how does the paired input actually reach
 * the matcher on the screens that render `MidiDeviceStatus`, none of which
 * know this hook exists?
 *
 * The answer is `subscribeBluetoothMidiInput`: a module-level registry (one
 * `MidiInput | undefined` slot, shared by every import of this module in the
 * page — there is only ever one physical BLE pairing at a time, so one slot
 * is correct, not a simplification). `pair()` publishes into it and
 * `disconnect()` (or a newer `pair()` superseding an in-flight one) clears
 * it. A dropped peripheral (an empty `onDevicesChanged` list) only clears the
 * shown device name, not the registry entry — the input object itself keeps
 * listening for the peripheral's return, mirroring `useMidiConnection`'s own
 * hot-plug handling. `useMidiConnection.ts` subscribes to the registry and
 * fans its events into the same `input` it already returns, additive to its
 * existing shape (see that file's module comment).
 *
 * ## Why the connection lives in module scope, not per-hook state
 *
 * Roadmap UI-04b moved `MidiDeviceStatus` out of screens' content flow and
 * into a topbar chip's popover, which is mounted only while the popover is
 * open — and the popover closes on any outside click, including clicking
 * Play. A pairing is app-global state (there is exactly one BLE keyboard, and
 * the learner expects it to stay connected until they disconnect it) that
 * must outlive any one component's mount. Tying GATT teardown to a
 * component's unmount effect made every close of the popover — or mounting a
 * second consumer, e.g. `SettingsScreen`'s Input section, alongside it —
 * silently kill the connection. So the connection, its `dispose` handle, and
 * its derived state (`pairing` / `device` / `error`) live here as a
 * singleton; `useBluetoothMidi()` is only a subscriber to it via
 * `useSyncExternalStore`. Multiple simultaneous consumers share one
 * connection and see identical state; mounting or unmounting one never
 * disturbs another. The only user-facing teardown is an explicit
 * `disconnect()` call, or the peripheral itself dropping.
 */
import { connectBluetoothMidi, isWebBluetoothSupported } from '@adapters/midi/index.ts'
import type { BluetoothMidi } from '@adapters/midi/index.ts'
import type { MidiDevice, MidiInput, Unsubscribe } from '@core/ports/index.ts'
import type { Result } from '@core/shared/result.ts'
import { useSyncExternalStore } from 'react'

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

// --- module-scope singleton: the live connection and its derived state -----

type ConnectionState = {
  readonly pairing: boolean
  readonly device: MidiDevice | undefined
  readonly error: string | undefined
}

const stateListeners = new Set<() => void>()
let connectionState: ConnectionState = { pairing: false, device: undefined, error: undefined }

/** The real GATT teardown for whatever is currently published, if anything. */
let disposeConnection: (() => void) | undefined
/** Unsubscribes from the currently-paired input's own hot-plug events. */
let unsubscribeDevicesChanged: (() => void) | undefined
/** Bumped by every `pair()` and every `disconnect()` — a `pair()` promise
 *  that resolves after its generation has been superseded disposes the
 *  connection it just opened instead of adopting it, so an in-flight pairing
 *  can never leak a GATT handle nor clobber a newer one. */
let pairGeneration = 0

function setConnectionState(next: ConnectionState): void {
  connectionState = next
  for (const listener of stateListeners) listener()
}

function subscribeConnectionState(listener: () => void): Unsubscribe {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

function getConnectionState(): ConnectionState {
  return connectionState
}

/** Keep the shown device name live over a hot GATT disconnect (an empty
 *  device list from `onDevicesChanged` means the peripheral dropped). Replaces
 *  any previous subscription, since it always tracks the currently-published input. */
function watchDeviceChanges(input: MidiInput | undefined): void {
  unsubscribeDevicesChanged?.()
  unsubscribeDevicesChanged = input?.onDevicesChanged((devices) => {
    setConnectionState({ ...connectionState, device: devices[0] })
  })
}

function pairBluetoothMidi(connect: ConnectBluetoothMidi): void {
  if (connectionState.pairing) return
  pairGeneration += 1
  const generation = pairGeneration
  setConnectionState({ ...connectionState, pairing: true, error: undefined })
  connect()
    .then((result) => {
      const stillCurrent = generation === pairGeneration
      if (!result.ok) {
        if (stillCurrent) setConnectionState({ ...connectionState, pairing: false, error: result.error })
        return
      }
      if (!stillCurrent) {
        // A newer `pair()` or a `disconnect()` ran while the browser's
        // chooser/GATT handshake was in flight — this pairing arrived too
        // late to use, but it still opened a real GATT connection that
        // must still be torn down.
        result.value.dispose()
        return
      }
      // Re-pairing while already connected: tear down the previous
      // connection first rather than leaking its GATT handle.
      disposeConnection?.()
      const { input, dispose } = result.value
      disposeConnection = dispose
      watchDeviceChanges(input)
      setConnectionState({ pairing: false, error: undefined, device: input.listDevices()[0] })
      publish(input)
    })
    .catch((reason: unknown) => {
      if (generation === pairGeneration) {
        setConnectionState({
          ...connectionState,
          pairing: false,
          error: reason instanceof Error ? reason.message : String(reason),
        })
      }
    })
}

function disconnectBluetoothMidi(): void {
  pairGeneration += 1 // supersede any in-flight pair() so its late resolution disposes, not adopts
  disposeConnection?.()
  disposeConnection = undefined
  watchDeviceChanges(undefined)
  setConnectionState({ pairing: false, device: undefined, error: undefined })
  publish(undefined)
}

/**
 * Test-only: resets the singleton between test cases, since module state
 * would otherwise persist across every test in a file. Never call this from
 * application code.
 *
 * @public knip: consumed only by tests, which production mode does not see.
 */
export function resetBluetoothMidiForTests(): void {
  disposeConnection = undefined
  unsubscribeDevicesChanged?.()
  unsubscribeDevicesChanged = undefined
  pairGeneration = 0
  connectionState = { pairing: false, device: undefined, error: undefined }
  registryInput = undefined
  stateListeners.clear()
  registryListeners.clear()
}

// --- the hook: a subscriber to the singleton above --------------------------

export function useBluetoothMidi(options: UseBluetoothMidiOptions = {}): BluetoothMidiState {
  const { connect = defaultConnect } = options
  const supported = isWebBluetoothSupported()
  const state = useSyncExternalStore(subscribeConnectionState, getConnectionState, getConnectionState)

  return {
    supported,
    pairing: state.pairing,
    device: state.device,
    error: state.error,
    pair: (): void => pairBluetoothMidi(connect),
    disconnect: disconnectBluetoothMidi,
  }
}
