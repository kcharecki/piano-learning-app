import { describe, expect, it, vi } from 'vitest'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import type { MidiEvent } from '@core/ports/index.ts'
import { midi, millis, type Midi } from '@core/shared/units.ts'
import { createPlayableInput, ON_SCREEN_VELOCITY } from './playableInput.ts'

const C4 = midi(60)
const E4 = midi(64)

function collect(): { events: MidiEvent[]; handler: (e: MidiEvent) => void } {
  const events: MidiEvent[] = []
  return { events, handler: (e) => events.push(e) }
}

describe('createPlayableInput', () => {
  it('exists, and emits, with no hardware device at all', () => {
    // The whole point (roadmap 5.4): on a browser with no Web MIDI the
    // practice screen still has a working input rather than `undefined`.
    const clock = new FakeClock(1000)
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.press(C4)
    clock.advance(120)
    input.release(C4)

    expect(events).toEqual([
      { type: 'noteOn', note: C4, velocity: ON_SCREEN_VELOCITY, time: millis(1000) },
      { type: 'noteOff', note: C4, time: millis(1120) },
    ])
  })

  it('stamps events off the injected clock, never real time', () => {
    const clock = new FakeClock(50_000)
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)
    input.press(E4)
    expect(events[0]?.time).toBe(50_000)
  })

  it('forwards the hardware device untouched when there is one', () => {
    const device = new FakeMidiInput()
    const clock = new FakeClock()
    const input = createPlayableInput(device, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    device.play(C4, 10, 100, 96)

    expect(events).toEqual([
      { type: 'noteOn', note: C4, velocity: 96, time: millis(10) },
      { type: 'noteOff', note: C4, time: millis(110) },
    ])
  })

  it('merges both sources into one stream', () => {
    const device = new FakeMidiInput()
    const clock = new FakeClock(200)
    const input = createPlayableInput(device, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.press(C4)
    device.emit({ type: 'noteOn', note: E4, velocity: 100, time: millis(205) })
    input.release(C4)

    expect(events.map((e) => [e.type, 'note' in e ? e.note : null])).toEqual([
      ['noteOn', C4],
      ['noteOn', E4],
      ['noteOff', C4],
    ])
  })

  it('ignores a repeated press of a key already down', () => {
    // A held Enter autorepeats and a second pointer can land on the same key.
    // A doubled note-on with no note-off between reads to the matcher as an
    // EXTRA note, which would score the learner down for holding a key.
    const clock = new FakeClock()
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.press(C4)
    input.press(C4)
    input.press(C4)

    expect(events).toHaveLength(1)
  })

  it('ignores a release of a key that is not down', () => {
    const clock = new FakeClock()
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.release(C4)
    input.press(C4)
    input.release(C4)
    input.release(C4)

    expect(events.map((e) => e.type)).toEqual(['noteOn', 'noteOff'])
  })

  it('does not swallow a hardware note that shares a pitch with a held on-screen note', () => {
    // The down-set tracks only THIS object's notes. A device note-on must
    // never be filtered by it — the two sources are independent, and the
    // matcher is what reconciles them.
    const device = new FakeMidiInput()
    const clock = new FakeClock()
    const input = createPlayableInput(device, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.press(C4)
    device.emit({ type: 'noteOn', note: C4, velocity: 100, time: millis(5) })

    expect(events).toHaveLength(2)
  })

  it('releases everything still held on releaseAll', () => {
    const clock = new FakeClock()
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.press(C4)
    input.press(E4)
    input.releaseAll()

    expect(events.filter((e) => e.type === 'noteOff').map((e) => 'note' in e && e.note)).toEqual([
      C4,
      E4,
    ])
    // And a second releaseAll has nothing left to do.
    const before = events.length
    input.releaseAll()
    expect(events).toHaveLength(before)
  })

  it('releases held notes on dispose, so wait mode is not left crediting a phantom key', () => {
    // `core/practice/waitmode.ts` gates the transport on required notes being
    // HELD. A note left down when the screen unmounts would keep its credit.
    const clock = new FakeClock()
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.press(C4)
    input.dispose()

    expect(events.map((e) => e.type)).toEqual(['noteOn', 'noteOff'])
  })

  it('unsubscribes from the device on dispose', () => {
    const device = new FakeMidiInput()
    const clock = new FakeClock()
    const input = createPlayableInput(device, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    input.dispose()
    device.play(C4, 10)

    expect(events.filter((e) => e.type === 'noteOn')).toHaveLength(0)
  })

  it('stops delivering to a handler that unsubscribed', () => {
    const clock = new FakeClock()
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    const off = input.onEvent(handler)

    input.press(C4)
    off()
    input.release(C4)

    expect(events).toHaveLength(1)
  })

  describe('device metadata', () => {
    it('proxies straight through to the hardware input', () => {
      const device = new FakeMidiInput()
      const input = createPlayableInput(device, new FakeClock())

      expect(input.listDevices()).toEqual(device.listDevices())
      expect(input.selectedDeviceId).toBe(device.selectedDeviceId)

      input.selectDevice(null)
      expect(device.selectedDeviceId).toBeNull()

      const onDevices = vi.fn()
      input.onDevicesChanged(onDevices)
      device.setDevices([{ id: 'x', name: 'X', manufacturer: 'Y' }])
      expect(onDevices).toHaveBeenCalledOnce()
    })

    it('reports NO devices when there is no hardware, rather than inventing itself', () => {
      // Roadmap 5.6: `MidiDeviceStatus` and `RecordPanel` ask about real
      // hardware. Answering "connected" because the screen has a clickable
      // keyboard is the silent-degradation lie, not a fix for it.
      const input = createPlayableInput(undefined, new FakeClock())

      expect(input.listDevices()).toEqual([])
      expect(input.selectedDeviceId).toBeNull()
      // And the no-device subscribe/select paths are inert, not crashes.
      expect(() => input.selectDevice('anything')).not.toThrow()
      const unsubscribe = input.onDevicesChanged(vi.fn())
      expect(() => unsubscribe()).not.toThrow()
    })
  })

  it('presses every playable pitch without inventing one outside the MIDI range', () => {
    const clock = new FakeClock()
    const input = createPlayableInput(undefined, clock)
    const { events, handler } = collect()
    input.onEvent(handler)

    for (let n = 21; n <= 108; n++) input.press(n as Midi)

    expect(events).toHaveLength(88)
    for (const event of events) {
      expect(event.type).toBe('noteOn')
      if (event.type !== 'noteOn') continue
      expect(event.velocity).toBeGreaterThan(0)
      expect(event.velocity).toBeLessThanOrEqual(127)
    }
  })
})
