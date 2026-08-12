/**
 * Bluetooth LE MIDI adapter (roadmap B.2, REQ-3.3.1) — a second, explicit-gesture
 * connection path alongside `webmidi.ts`'s USB/OS-paired one. Web MIDI never
 * enumerates a BLE MIDI peripheral the OS has not already paired (there is no
 * pairing UI for it outside the OS Bluetooth settings on most platforms), so
 * this goes around it: `navigator.bluetooth.requestDevice` opens the browser's
 * own chooser, the learner picks their keyboard, and every note it sends comes
 * back through the GATT characteristic's notification stream — decoded by
 * `@core/midi/bleMidiPacket.ts` into this repo's own `MidiEvent` shape.
 *
 * Implements the exact same `MidiInput` port `webmidi.ts` does (mirroring how
 * `micPitchInput.ts` does it for the microphone fallback), so a BLE note flows
 * through the exact matcher / wait-mode / recording path a USB note does, with
 * nothing downstream able to tell the difference. `selectDevice` is a no-op and
 * `selectedDeviceId` is fixed: unlike a USB MIDI port list, there is exactly one
 * device here — the one the learner just paired — never a list to choose among.
 *
 * `@types/web-bluetooth` is not part of this project's dependency set, so every
 * Web Bluetooth type here is hand-written and structural, the same choice
 * `webmidi.ts` makes for `@types/webmidi` (see that file's module comment) —
 * these types describe only the handful of members this module actually calls.
 *
 * ## Clock anchoring
 *
 * `bleMidiPacket.ts`'s decoder is deliberately pure: it unwraps the
 * peripheral's OWN 13-bit millisecond clock, which starts near zero at power-on
 * and has no relationship to this page's clock. `webmidi.ts` never has this
 * problem — `MIDIMessageEvent.timeStamp` is spec'd to already share the
 * `performance.now()` epoch every `Clock` in this app uses. So this adapter is
 * the one place that must translate: on the FIRST decoded event, it anchors
 * `hostMsAtAnchor` (from `clock.now()`) against `deviceMsAtAnchor` (the
 * decoder's own unwrapped value), then every event's `time` is rewritten to
 * `hostMsAtAnchor + (decodedMs - deviceMsAtAnchor)` — preserving the relative
 * spacing between notes the peripheral reported, while landing on the epoch the
 * matcher's timing window actually compares against.
 */
import { createBleMidiDecoder } from '@core/midi/bleMidiPacket.ts'
import type { Clock, MidiDevice, MidiEvent, MidiInput, Unsubscribe } from '@core/ports/index.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { millis } from '@core/shared/units.ts'

/** BLE MIDI service/characteristic UUIDs, fixed by the (informal) BLE-MIDI spec. */
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3'

const BLUETOOTH_DEVICE_ID = 'bluetooth-midi'

type CharacteristicValueChangedEvent = { readonly target: { readonly value: DataView | null } }

type BleCharacteristic = {
  startNotifications(): Promise<BleCharacteristic>
  stopNotifications(): Promise<BleCharacteristic>
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (event: CharacteristicValueChangedEvent) => void,
  ): void
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (event: CharacteristicValueChangedEvent) => void,
  ): void
}

type BleService = { getCharacteristic(uuid: string): Promise<BleCharacteristic> }

type BleGattServer = {
  readonly connected: boolean
  connect(): Promise<BleGattServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BleService>
}

type BleDevice = {
  readonly name?: string
  readonly gatt?: BleGattServer
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void
}

type BluetoothRequestDeviceOptions = {
  readonly filters: readonly { readonly services: readonly string[] }[]
  readonly optionalServices?: readonly string[]
}

type BluetoothApi = { requestDevice(options: BluetoothRequestDeviceOptions): Promise<BleDevice> }

type BluetoothNavigator = { readonly bluetooth?: BluetoothApi }

/**
 * Whether this browser exposes Web Bluetooth at all — pure feature detection,
 * no prompt, mirroring `capability.ts`'s `isWebMidiSupported`. Safari and
 * Firefox ship no Web Bluetooth in any shell, so this is `false` there
 * regardless of the OS's own Bluetooth state.
 */
export function isWebBluetoothSupported(nav: BluetoothNavigator | undefined = undefined): boolean {
  const target = nav ?? (typeof navigator === 'undefined' ? undefined : (navigator as unknown as BluetoothNavigator))
  return typeof target?.bluetooth === 'object' && target.bluetooth !== null
}

export type BluetoothMidi = { readonly input: MidiInput; dispose(): void }

export type ConnectBluetoothMidiOptions = {
  /**
   * The host clock to anchor decoded device timestamps against (see the
   * module doc's "Clock anchoring" section). Defaults to a real
   * `performance.now()` clock, the same default `micPitchInput.ts` uses — an
   * injection seam so tests never depend on real elapsed wall-clock time.
   */
  readonly clock?: Clock
}

function defaultClock(): Clock {
  return { now: () => millis(performance.now()) }
}

/**
 * Open the browser's Bluetooth chooser filtered to BLE-MIDI peripherals,
 * connect its GATT server, and start listening for notifications on the
 * MIDI-data characteristic. Never throws: API absence, the learner cancelling
 * the chooser, and a GATT connection failure all come back as `err(...)`, the
 * same contract `createWebMidi` has. Reads `navigator.bluetooth` directly
 * (never an injected seam) — same choice `createWebMidi` makes for
 * `navigator.requestMIDIAccess` — so tests stub `navigator` itself; `clock` is
 * the one injected seam, needed because (unlike Web MIDI's `timeStamp`) a BLE
 * device's own timestamp has no relationship to real elapsed time at all.
 */
export async function connectBluetoothMidi(
  options: ConnectBluetoothMidiOptions = {},
): Promise<Result<BluetoothMidi, string>> {
  const clock = options.clock ?? defaultClock()
  const bluetooth =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as BluetoothNavigator).bluetooth
  if (bluetooth === undefined) {
    return err('Web Bluetooth API is not available in this browser.')
  }

  let device: BleDevice
  try {
    device = await bluetooth.requestDevice({
      filters: [{ services: [BLE_MIDI_SERVICE] }],
      optionalServices: [BLE_MIDI_SERVICE],
    })
  } catch (cause) {
    // Covers the learner cancelling the chooser (NotFoundError in Chrome) the
    // same way a denied Web MIDI prompt is covered: no throw, just `Err`.
    const message = cause instanceof Error ? cause.message : String(cause)
    return err(`Bluetooth pairing was cancelled or failed: ${message}`)
  }

  if (device.gatt === undefined) {
    return err('Paired Bluetooth device does not offer a GATT server.')
  }

  let characteristic: BleCharacteristic
  try {
    const server = await device.gatt.connect()
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE)
    characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC)
    await characteristic.startNotifications()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return err(`Bluetooth MIDI connection failed: ${message}`)
  }

  const device_: MidiDevice = {
    id: BLUETOOTH_DEVICE_ID,
    name: device.name ?? 'Bluetooth MIDI device',
    manufacturer: 'Bluetooth LE',
  }

  const decoder = createBleMidiDecoder()
  const handlers = new Set<(event: MidiEvent) => void>()
  const deviceHandlers = new Set<(devices: readonly MidiDevice[]) => void>()
  let connected = true
  let disposed = false
  // Set on the first decoded event — see the module doc's "Clock anchoring".
  let anchor: { readonly hostMs: number; readonly deviceMs: number } | undefined

  /** Rewrite a decoded event's device-relative time onto the host clock's epoch. */
  function toHostTime(event: MidiEvent): MidiEvent {
    if (anchor === undefined) anchor = { hostMs: clock.now(), deviceMs: event.time }
    const hostTime = millis(anchor.hostMs + (event.time - anchor.deviceMs))
    return { ...event, time: hostTime }
  }

  function onValueChanged(event: CharacteristicValueChangedEvent): void {
    const value = event.target.value
    if (value === null) return
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    for (const domainEvent of decoder.decode(bytes)) {
      const hostEvent = toHostTime(domainEvent)
      for (const handler of handlers) handler(hostEvent)
    }
  }

  // A GATT disconnect (out of range, powered off) is surfaced, never thrown:
  // the device list goes empty so `MidiDeviceStatus`-style consumers can show
  // it, and the notify listener is left attached but harmless — the browser
  // will not fire it again on a dead connection.
  function onGattDisconnected(): void {
    connected = false
    for (const handler of deviceHandlers) handler([])
  }

  characteristic.addEventListener('characteristicvaluechanged', onValueChanged)
  device.addEventListener('gattserverdisconnected', onGattDisconnected)

  const input: MidiInput = {
    listDevices(): readonly MidiDevice[] {
      return connected ? [device_] : []
    },
    onEvent(handler: (event: MidiEvent) => void): Unsubscribe {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe {
      deviceHandlers.add(handler)
      return () => deviceHandlers.delete(handler)
    },
    selectDevice(): void {},
    selectedDeviceId: device_.id,
  }

  return ok({
    input,
    dispose(): void {
      if (disposed) return
      disposed = true
      characteristic.removeEventListener('characteristicvaluechanged', onValueChanged)
      device.removeEventListener('gattserverdisconnected', onGattDisconnected)
      handlers.clear()
      deviceHandlers.clear()
      void characteristic.stopNotifications().catch(() => {})
      if (device.gatt?.connected === true) device.gatt.disconnect()
    },
  })
}
