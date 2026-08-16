/**
 * The `ui` (happy-dom) project has no real Web MIDI implementation, so these
 * tests fake the browser's MIDIAccess/MIDIPort objects by hand and inject
 * them by stubbing `navigator.requestMIDIAccess`. Every assertion is on the
 * events the DOMAIN sees (`MidiEvent`, `MidiDevice`), never on raw bytes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebMidi } from './webmidi.ts'
import { midi, millis } from '@core/shared/units.ts'
import type { MidiDevice, MidiEvent } from '@core/ports/midi.ts'

type FakeMessage = { data: Uint8Array; timeStamp: number }

/** Fakes a Web MIDI input port: real code attaches `onmidimessage`, tests fire it. */
class FakeMidiInputPort {
  readonly id: string
  readonly name: string
  readonly manufacturer: string
  readonly type = 'input' as const
  state: 'connected' | 'disconnected' = 'connected'
  onmidimessage: ((event: FakeMessage) => void) | null = null

  constructor(id: string, name = 'Fake Input', manufacturer = 'Test') {
    this.id = id
    this.name = name
    this.manufacturer = manufacturer
  }

  /** Deliver a raw MIDI message, as the browser would when hardware sends bytes. */
  fire(bytes: number[], timeStamp = 0): void {
    this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp })
  }
}

type SentMessage = { data: number[]; timestamp?: number }

/** Fakes a Web MIDI output port: records every `send()` call for assertion. */
class FakeMidiOutputPort {
  readonly id: string
  readonly name: string
  readonly manufacturer: string
  readonly type = 'output' as const
  state: 'connected' | 'disconnected' = 'connected'
  readonly sent: SentMessage[] = []

  constructor(id: string, name = 'Fake Output', manufacturer = 'Test') {
    this.id = id
    this.name = name
    this.manufacturer = manufacturer
  }

  send(data: number[] | Uint8Array, timestamp?: number): void {
    this.sent.push({
      data: Array.from(data),
      ...(timestamp === undefined ? {} : { timestamp }),
    })
  }
}

/** Fakes `MIDIAccess`: Maps of ports plus the single `onstatechange` slot. */
class FakeMidiAccess {
  readonly inputs = new Map<string, FakeMidiInputPort>()
  readonly outputs = new Map<string, FakeMidiOutputPort>()
  onstatechange: (() => void) | null = null
}

function stubMidiAccess(access: FakeMidiAccess | (() => Promise<FakeMidiAccess>)): void {
  const requestMIDIAccess =
    typeof access === 'function' ? vi.fn(access) : vi.fn().mockResolvedValue(access)
  vi.stubGlobal('navigator', { requestMIDIAccess })
}

function collect<T>(): { handler: (v: T) => void; values: T[] } {
  const values: T[] = []
  return { handler: (v: T) => values.push(v), values }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWebMidi — availability', () => {
  it('returns Err, never throws, when the Web MIDI API does not exist', async () => {
    vi.stubGlobal('navigator', {})

    const result = await createWebMidi()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not available/i)
  })

  it('returns Err with learner-safe copy, never the raw browser exception, when the user rejects the permission prompt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubMidiAccess(() => Promise.reject(new Error('Permission to use Web MIDI API was not granted.')))

    const result = await createWebMidi()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/blocked MIDI access/i)
      expect(result.error).not.toMatch(/Permission to use Web MIDI API was not granted/)
    }
    // The raw browser exception still reaches a developer — just not the screen.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('requestMIDIAccess failed'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('keeps the two failure messages distinct: unsupported browser vs. refused permission', async () => {
    vi.stubGlobal('navigator', {})
    const unsupported = await createWebMidi()

    vi.unstubAllGlobals()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubMidiAccess(() => Promise.reject(new Error('denied')))
    const refused = await createWebMidi()

    expect(unsupported.ok).toBe(false)
    expect(refused.ok).toBe(false)
    if (!unsupported.ok && !refused.ok) {
      expect(unsupported.error).not.toBe(refused.error)
    }
  })

  it('subscribes to statechange as soon as access is granted', async () => {
    const access = new FakeMidiAccess()
    stubMidiAccess(access)

    const result = await createWebMidi()

    expect(result.ok).toBe(true)
    expect(access.onstatechange).not.toBeNull()
  })
})

describe('WebMidi input — message normalisation', () => {
  async function setUp() {
    const access = new FakeMidiAccess()
    const port = new FakeMidiInputPort('dev-1')
    access.inputs.set(port.id, port)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { input } = result.value
    input.selectDevice(port.id)
    const { handler, values } = collect<MidiEvent>()
    input.onEvent(handler)
    return { access, port, input, events: values }
  }

  it('turns a note-on into a domain noteOn event', async () => {
    const { port, events } = await setUp()

    port.fire([0x90, 60, 100], 12.5)

    expect(events).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 12.5 }])
  })

  it('turns a note-off into a domain noteOff event', async () => {
    const { port, events } = await setUp()

    port.fire([0x80, 60, 64], 5)

    expect(events).toEqual([{ type: 'noteOff', note: 60, time: 5 }])
  })

  it('normalises a note-on with velocity 0 to a noteOff', async () => {
    const { port, events } = await setUp()

    port.fire([0x90, 60, 0], 1)

    expect(events).toEqual([{ type: 'noteOff', note: 60, time: 1 }])
  })

  it('ignores the channel nibble — any channel counts', async () => {
    const { port, events } = await setUp()

    port.fire([0x95, 60, 100], 1) // note-on, channel 6

    expect(events).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 1 }])
  })

  it('expands running status across bytes in one message', async () => {
    const { port, events } = await setUp()

    port.fire([0x90, 60, 100, 62, 90], 1) // one status byte, two note-ons

    expect(events).toEqual([
      { type: 'noteOn', note: 60, velocity: 100, time: 1 },
      { type: 'noteOn', note: 62, velocity: 90, time: 1 },
    ])
  })

  it('expands running status persisted across separate messages', async () => {
    const { port, events } = await setUp()

    port.fire([0x90, 60, 100], 1)
    port.fire([62, 0], 2) // no status byte: continues the prior note-on, velocity 0

    expect(events).toEqual([
      { type: 'noteOn', note: 60, velocity: 100, time: 1 },
      { type: 'noteOff', note: 62, time: 2 },
    ])
  })

  it('reports sustain down and up at the >=64 threshold', async () => {
    const { port, events } = await setUp()

    port.fire([0xb0, 64, 127], 1)
    port.fire([0xb0, 64, 64], 2)
    port.fire([0xb0, 64, 63], 3)

    expect(events).toEqual([
      { type: 'sustain', down: true, time: 1 },
      { type: 'sustain', down: true, time: 2 },
      { type: 'sustain', down: false, time: 3 },
    ])
  })

  it('turns a non-sustain control change (e.g. mod wheel) into a domain controlChange event', async () => {
    const { port, events } = await setUp()

    port.fire([0xb0, 1, 127], 1) // mod wheel, not sustain

    expect(events).toEqual([{ type: 'controlChange', controller: 1, value: 127, time: 1 }])
  })

  it('turns CC#4 (e-drum hi-hat pedal position) into a domain controlChange event, distinct from sustain', async () => {
    const { port, events } = await setUp()

    port.fire([0xb0, 4, 90], 1)

    expect(events).toEqual([{ type: 'controlChange', controller: 4, value: 90, time: 1 }])
  })

  it('turns polyphonic aftertouch (e-drum choke gesture) into a domain polyAftertouch event', async () => {
    const { port, events } = await setUp()

    port.fire([0xa0, 49, 80], 1)

    expect(events).toEqual([{ type: 'polyAftertouch', note: 49, pressure: 80, time: 1 }])
  })

  it('does not crash on program change, and keeps parsing correctly afterwards', async () => {
    const { port, events } = await setUp()

    // program change (1 data byte) then, via running status, two note-ons
    port.fire([0xc0, 5, 0x90, 60, 100, 62, 90], 1)

    expect(events).toEqual([
      { type: 'noteOn', note: 60, velocity: 100, time: 1 },
      { type: 'noteOn', note: 62, velocity: 90, time: 1 },
    ])
  })

  it('does not crash on an unsupported system-common/sysex byte', async () => {
    const { port, events } = await setUp()

    expect(() => port.fire([0xf0, 0x7e, 0x7f, 0xf7], 1)).not.toThrow()
    expect(events).toEqual([])
  })
})

describe('WebMidi input — device selection', () => {
  it('only forwards events from the currently selected device', async () => {
    const access = new FakeMidiAccess()
    const p1 = new FakeMidiInputPort('dev-1')
    const p2 = new FakeMidiInputPort('dev-2')
    access.inputs.set(p1.id, p1)
    access.inputs.set(p2.id, p2)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { input } = result.value
    const { handler, values } = collect<MidiEvent>()
    input.onEvent(handler)

    input.selectDevice(p1.id)
    p2.fire([0x90, 60, 100], 1)
    expect(values).toEqual([])

    p1.fire([0x90, 60, 100], 1)
    expect(values).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 1 }])

    input.selectDevice(p2.id)
    p1.fire([0x90, 61, 100], 2)
    expect(values).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 1 }])

    input.selectDevice(null)
    p2.fire([0x90, 62, 100], 3)
    expect(values).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 1 }])
  })
})

describe('WebMidi input — hot-plug', () => {
  it('re-emits the device list, and attaches to newly connected ports', async () => {
    const access = new FakeMidiAccess()
    const p1 = new FakeMidiInputPort('dev-1')
    access.inputs.set(p1.id, p1)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { input } = result.value
    const { handler: deviceHandler, values: deviceLists } = collect<readonly MidiDevice[]>()
    input.onDevicesChanged(deviceHandler)
    const { handler: eventHandler, values: events } = collect<MidiEvent>()
    input.onEvent(eventHandler)

    const p2 = new FakeMidiInputPort('dev-2')
    access.inputs.set(p2.id, p2)
    access.onstatechange?.()

    expect(deviceLists.at(-1)?.map((d) => d.id)).toEqual(['dev-1', 'dev-2'])

    input.selectDevice(p2.id)
    p2.fire([0x90, 60, 100], 1)
    expect(events).toEqual([{ type: 'noteOn', note: 60, velocity: 100, time: 1 }])
  })

  it('a device disappearing while selected does not throw, and leaves selection stale', async () => {
    const access = new FakeMidiAccess()
    const p1 = new FakeMidiInputPort('dev-1')
    access.inputs.set(p1.id, p1)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { input } = result.value
    input.selectDevice('dev-1')
    const { handler, values: deviceLists } = collect<readonly MidiDevice[]>()
    input.onDevicesChanged(handler)

    access.inputs.delete('dev-1')
    expect(() => access.onstatechange?.()).not.toThrow()

    expect(deviceLists.at(-1)).toEqual([])
    expect(input.selectedDeviceId).toBe('dev-1')
  })

  it('excludes disconnected ports from listDevices', async () => {
    const access = new FakeMidiAccess()
    const p1 = new FakeMidiInputPort('dev-1')
    const p2 = new FakeMidiInputPort('dev-2')
    p2.state = 'disconnected'
    access.inputs.set(p1.id, p1)
    access.inputs.set(p2.id, p2)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')

    expect(result.value.input.listDevices().map((d) => d.id)).toEqual(['dev-1'])
  })
})

describe('WebMidi output', () => {
  async function setUp() {
    const access = new FakeMidiAccess()
    const port = new FakeMidiOutputPort('out-1')
    access.outputs.set(port.id, port)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { output } = result.value
    output.selectDevice(port.id)
    return { access, port, output }
  }

  it('sends note-on/note-off without a timestamp using the immediate send form', async () => {
    const { port, output } = await setUp()

    output.noteOn(midi(60), 100)
    output.noteOff(midi(60))

    expect(port.sent).toEqual([{ data: [0x90, 60, 100] }, { data: [0x80, 60, 0] }])
  })

  it('sends note-on/note-off with an absolute timestamp using the scheduling form', async () => {
    const { port, output } = await setUp()

    output.noteOn(midi(60), 100, millis(1234.5))
    output.noteOff(midi(60), millis(1240))

    expect(port.sent).toEqual([
      { data: [0x90, 60, 100], timestamp: 1234.5 },
      { data: [0x80, 60, 0], timestamp: 1240 },
    ])
  })

  it('sends an All Notes Off control change', async () => {
    const { port, output } = await setUp()

    output.allNotesOff()

    expect(port.sent).toEqual([{ data: [0xb0, 123, 0] }])
  })

  it('is a silent no-op, never a throw, when no device is selected', async () => {
    const { port, output } = await setUp()
    output.selectDevice(null)

    expect(() => output.noteOn(midi(60), 100)).not.toThrow()
    expect(port.sent).toEqual([])
  })

  it('is a silent no-op when the selected device has disappeared', async () => {
    const { port, output } = await setUp()
    output.selectDevice('does-not-exist')

    expect(() => output.noteOn(midi(60), 100)).not.toThrow()
    expect(port.sent).toEqual([])
  })

  it('excludes disconnected ports from listDevices', async () => {
    const { access, output } = await setUp()
    const p2 = new FakeMidiOutputPort('out-2')
    p2.state = 'disconnected'
    access.outputs.set(p2.id, p2)

    expect(output.listDevices().map((d) => d.id)).toEqual(['out-1'])
  })
})

describe('dispose', () => {
  it('detaches every input listener and the statechange subscription', async () => {
    const access = new FakeMidiAccess()
    const port = new FakeMidiInputPort('dev-1')
    access.inputs.set(port.id, port)
    stubMidiAccess(access)
    const result = await createWebMidi()
    if (!result.ok) throw new Error('expected Ok')
    const { input, dispose } = result.value
    input.selectDevice(port.id)
    input.onEvent(() => {
      throw new Error('should never fire after dispose')
    })
    expect(port.onmidimessage).not.toBeNull()

    dispose()

    expect(port.onmidimessage).toBeNull()
    expect(access.onstatechange).toBeNull()
    expect(() => port.fire([0x90, 60, 100], 1)).not.toThrow()
  })
})
