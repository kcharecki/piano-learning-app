/**
 * The `ui` (happy-dom) project has no real Web Bluetooth implementation, so
 * these tests fake `navigator.bluetooth`, the `BluetoothDevice`, its GATT
 * server, service and characteristic by hand — the same approach
 * `webmidi.test.ts` takes for `navigator.requestMIDIAccess`. Every assertion
 * on delivered notes is on the DOMAIN event (`MidiEvent`), built from real
 * BLE-MIDI packet bytes pushed through the characteristic's notification
 * listener, never on raw bytes directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectBluetoothMidi, isWebBluetoothSupported, BLE_MIDI_CHARACTERISTIC, BLE_MIDI_SERVICE } from './blemidi.ts'
import type { MidiDevice, MidiEvent } from '@core/ports/midi.ts'
import { FakeClock } from '@test/fakes.ts'

type ValueChangedListener = (event: { target: { value: DataView | null } }) => void
type DisconnectListener = () => void

/** Fakes the MIDI-data characteristic: `notify(bytes)` is the test's hand on the wire. */
class FakeCharacteristic {
  readonly uuid: string
  started = false
  private readonly listeners = new Set<ValueChangedListener>()

  constructor(uuid: string) {
    this.uuid = uuid
  }

  startNotifications(): Promise<this> {
    this.started = true
    return Promise.resolve(this)
  }

  stopNotifications(): Promise<this> {
    this.started = false
    return Promise.resolve(this)
  }

  addEventListener(_type: 'characteristicvaluechanged', listener: ValueChangedListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'characteristicvaluechanged', listener: ValueChangedListener): void {
    this.listeners.delete(listener)
  }

  /** Deliver one GATT notification, as real hardware would. */
  notify(bytes: number[]): void {
    const buffer = Uint8Array.from(bytes).buffer
    const value = new DataView(buffer)
    for (const listener of this.listeners) listener({ target: { value } })
  }
}

class FakeGattService {
  private readonly characteristic: FakeCharacteristic
  constructor(characteristic: FakeCharacteristic) {
    this.characteristic = characteristic
  }
  getCharacteristic(uuid: string): Promise<FakeCharacteristic> {
    if (uuid !== this.characteristic.uuid) return Promise.reject(new Error('no such characteristic'))
    return Promise.resolve(this.characteristic)
  }
}

class FakeGattServer {
  connected = false
  private readonly service: FakeGattService
  constructor(service: FakeGattService) {
    this.service = service
  }
  connect(): Promise<this> {
    this.connected = true
    return Promise.resolve(this)
  }
  disconnect(): void {
    this.connected = false
  }
  getPrimaryService(uuid: string): Promise<FakeGattService> {
    if (uuid !== BLE_MIDI_SERVICE) return Promise.reject(new Error('no such service'))
    return Promise.resolve(this.service)
  }
}

class FakeBluetoothDevice {
  readonly name: string
  readonly gatt: FakeGattServer | undefined
  private readonly disconnectListeners = new Set<DisconnectListener>()

  constructor(name: string, gatt: FakeGattServer | undefined) {
    this.name = name
    this.gatt = gatt
  }

  addEventListener(_type: 'gattserverdisconnected', listener: DisconnectListener): void {
    this.disconnectListeners.add(listener)
  }
  removeEventListener(_type: 'gattserverdisconnected', listener: DisconnectListener): void {
    this.disconnectListeners.delete(listener)
  }
  fireDisconnect(): void {
    for (const listener of this.disconnectListeners) listener()
  }
}

function stubBluetooth(requestDevice: () => Promise<FakeBluetoothDevice>): void {
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: vi.fn(requestDevice) } })
}

function buildFakeDevice(name = 'Test BLE Keyboard'): { device: FakeBluetoothDevice; characteristic: FakeCharacteristic } {
  const characteristic = new FakeCharacteristic(BLE_MIDI_CHARACTERISTIC)
  const service = new FakeGattService(characteristic)
  const gatt = new FakeGattServer(service)
  const device = new FakeBluetoothDevice(name, gatt)
  return { device, characteristic }
}

function collect<T>(): { handler: (v: T) => void; values: T[] } {
  const values: T[] = []
  return { handler: (v: T) => values.push(v), values }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isWebBluetoothSupported', () => {
  it('is false when navigator.bluetooth is absent', () => {
    expect(isWebBluetoothSupported({})).toBe(false)
  })

  it('is true when navigator.bluetooth is present', () => {
    expect(isWebBluetoothSupported({ bluetooth: { requestDevice: () => Promise.resolve() } } as never)).toBe(true)
  })

  it('falls back to the real navigator when none is given', () => {
    // happy-dom ships no Web Bluetooth implementation.
    expect(isWebBluetoothSupported()).toBe(false)
  })
})

describe('connectBluetoothMidi — availability and failure modes', () => {
  it('returns Err, never throws, when Web Bluetooth does not exist', async () => {
    vi.stubGlobal('navigator', {})

    const result = await connectBluetoothMidi()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not available/i)
  })

  it('returns Err, never throws, when the learner cancels the chooser', async () => {
    stubBluetooth(() => Promise.reject(new Error('User cancelled the requestDevice() chooser.')))

    const result = await connectBluetoothMidi()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/cancelled/i)
  })

  it('returns Err when GATT connection fails after pairing', async () => {
    const { device } = buildFakeDevice()
    // @ts-expect-error — deliberately breaking the fake's connect() for this one test
    device.gatt.connect = () => Promise.reject(new Error('GATT operation failed'))
    stubBluetooth(() => Promise.resolve(device))

    const result = await connectBluetoothMidi()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/connection failed/i)
  })
})

describe('connectBluetoothMidi — note delivery', () => {
  it('decodes a real BLE-MIDI packet delivered through the notify listener into a domain noteOn', async () => {
    const { device, characteristic } = buildFakeDevice()
    stubBluetooth(() => Promise.resolve(device))
    const clock = new FakeClock(5_000) // an arbitrary host time, unrelated to the device's own clock

    const result = await connectBluetoothMidi({ clock })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected Ok')
    const { input } = result.value
    const { handler, values } = collect<MidiEvent>()
    input.onEvent(handler)

    // header(ts-high=0), ts(low=10), status note-on ch0, note 60, velocity 100
    characteristic.notify([0x80, 0x8a, 0x90, 60, 100])

    // The FIRST decoded event anchors to the host clock's current time (5000),
    // not the device's own raw 10ms — see the module doc's "Clock anchoring".
    expect(values).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 5_000 }])
    expect(characteristic.started).toBe(true)
  })

  it('preserves the RELATIVE spacing the device reported once anchored to the host clock', async () => {
    const { device, characteristic } = buildFakeDevice()
    stubBluetooth(() => Promise.resolve(device))
    const clock = new FakeClock(5_000)

    const result = await connectBluetoothMidi({ clock })
    if (!result.ok) throw new Error('expected Ok')
    const { handler, values } = collect<MidiEvent>()
    result.value.input.onEvent(handler)

    // First packet: raw device ts=10, note-on. Second packet (device raw
    // ts=160, i.e. 150ms later on the device's OWN clock): running status
    // carries across packets (one decoder instance for the whole connection),
    // so this is just [header, ts, d1, d2] with d2=0 normalising to a
    // noteOff — header ts-high=160>>7=1, ts byte low=160&0x7f=32.
    // Real host time does not move at all between the two notifications —
    // this test is about the DEVICE's reported spacing surviving the anchor.
    characteristic.notify([0x80, 0x8a, 0x90, 60, 100])
    characteristic.notify([0x81, 0xa0, 60, 0])

    expect(values.map((e) => e.time)).toEqual([5_000, 5_150])
  })

  it('exposes the paired device once connected', async () => {
    const { device } = buildFakeDevice('My Keyboard')
    stubBluetooth(() => Promise.resolve(device))

    const result = await connectBluetoothMidi()
    if (!result.ok) throw new Error('expected Ok')

    const devices = result.value.input.listDevices()
    expect(devices).toHaveLength(1)
    expect((devices[0] as MidiDevice).name).toBe('My Keyboard')
  })

  it('surfaces a GATT disconnect as an empty device list, without throwing', async () => {
    const { device } = buildFakeDevice()
    stubBluetooth(() => Promise.resolve(device))
    const result = await connectBluetoothMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { handler, values } = collect<readonly MidiDevice[]>()
    result.value.input.onDevicesChanged(handler)

    expect(() => device.fireDisconnect()).not.toThrow()

    expect(values.at(-1)).toEqual([])
    expect(result.value.input.listDevices()).toEqual([])
  })

  it('dispose stops notifications and disconnects the GATT server, and stops delivering events', async () => {
    const { device, characteristic } = buildFakeDevice()
    stubBluetooth(() => Promise.resolve(device))
    const result = await connectBluetoothMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { input, dispose } = result.value
    input.onEvent(() => {
      throw new Error('should never fire after dispose')
    })

    dispose()

    expect(characteristic.started).toBe(false)
    expect(device.gatt?.connected).toBe(false)
    expect(() => characteristic.notify([0x80, 0x80, 0x90, 60, 100])).not.toThrow()
  })
})
