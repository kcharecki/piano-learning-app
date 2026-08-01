import { describe, expect, it, vi } from 'vitest'
import { selectAudioOutput } from '@adapters/audio/index.ts'
import { RecordingMidiOutput } from '@test/fakes.ts'
import { midi, millis } from '@core/shared/units.ts'

// A minimal structural AudioContext fake, just enough for selectAudioOutput's
// Web Audio path to run: create the master gain, connect it, and let a
// noteOn create an oscillator we can see.
class FakeAudioParam {
  value = 0
  setValueAtTime(value: number): FakeAudioParam {
    this.value = value
    return this
  }
  linearRampToValueAtTime(value: number): FakeAudioParam {
    this.value = value
    return this
  }
  exponentialRampToValueAtTime(value: number): FakeAudioParam {
    this.value = value
    return this
  }
  cancelScheduledValues(): FakeAudioParam {
    return this
  }
}

class FakeOscillatorNode {
  type = 'sine'
  readonly frequency = new FakeAudioParam()
  onended: (() => void) | null = null
  connect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeGainNode {
  readonly gain = new FakeAudioParam()
  connect(): void {}
}

class FakeAudioContext {
  currentTime = 0
  readonly destination = {}
  readonly oscillators: FakeOscillatorNode[] = []

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode()
    this.oscillators.push(node)
    return node
  }

  createGain(): FakeGainNode {
    return new FakeGainNode()
  }
}

describe('selectAudioOutput', () => {
  it('picks MIDI when a device is selected', () => {
    const midiOut = new RecordingMidiOutput() // selectedDeviceId is set by default
    const context = vi.fn(() => new FakeAudioContext() as unknown as AudioContext)

    const out = selectAudioOutput({ midi: midiOut, context })
    out.noteOn(midi(60), 100, millis(0))

    expect(midiOut.sent).toEqual([{ kind: 'noteOn', note: 60, at: 0 }])
    expect(context).not.toHaveBeenCalled()
  })

  it('falls back to Web Audio when the MIDI output has no device selected', () => {
    const midiOut = new RecordingMidiOutput()
    midiOut.selectDevice(null)
    const ctx = new FakeAudioContext()
    const context = vi.fn(() => ctx as unknown as AudioContext)

    const out = selectAudioOutput({ midi: midiOut, context })
    out.noteOn(midi(60), 100, millis(0))

    expect(context).toHaveBeenCalledTimes(1)
    expect(ctx.oscillators).toHaveLength(1)
    expect(midiOut.sent).toEqual([])
  })

  it('falls back to Web Audio when no midi option is given at all', () => {
    const ctx = new FakeAudioContext()
    const out = selectAudioOutput({ context: () => ctx as unknown as AudioContext })
    out.noteOn(midi(60), 100, millis(0))
    expect(ctx.oscillators).toHaveLength(1)
  })

  it('constructs the AudioContext lazily — only when Web Audio is actually chosen', () => {
    const midiOut = new RecordingMidiOutput()
    const context = vi.fn(() => new FakeAudioContext() as unknown as AudioContext)
    selectAudioOutput({ midi: midiOut, context })
    expect(context).not.toHaveBeenCalled()
  })

  it('throws when neither a selected MIDI device nor a context factory is available', () => {
    expect(() => selectAudioOutput({})).toThrow(/no MIDI device/)
  })

  it('throws when midi has no device selected and no context is given', () => {
    const midiOut = new RecordingMidiOutput()
    midiOut.selectDevice(null)
    expect(() => selectAudioOutput({ midi: midiOut })).toThrow(/no MIDI device/)
  })
})
