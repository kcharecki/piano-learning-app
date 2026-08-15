/**
 * Wiring test for roadmap U.2: this is the one real call site every screen
 * shares (see the module's own doc comment), so it is the file that proves
 * the MIDI-out route is actually reachable from Practice, not just that its
 * pieces (`selectAudioOutput`, `createMidiAudioOutput`, `audioRoute.ts`) are
 * independently correct in isolation. `vi.resetModules()` + a dynamic
 * `import()` per test is needed because `createDefaultAudioOutput` memoises a
 * module-level singleton on first call — exactly the behaviour under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingMidiOutput } from '@test/fakes.ts'
import { midi } from '@core/shared/units.ts'

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

describe('createDefaultAudioOutput', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@adapters/audio/audioRoute.ts')
  })

  it('routes through the MIDI-out adapter when a live, device-selected MidiOutput is ready at first press', async () => {
    const midiOut = new RecordingMidiOutput()
    vi.doMock('@adapters/audio/audioRoute.ts', () => ({
      getPlaybackMidiOutput: () => midiOut,
    }))

    const { createDefaultAudioOutput } = await import('./createDefaultAudioOutput.ts')
    const out = createDefaultAudioOutput()
    out.noteOn(midi(60), 100)

    expect(midiOut.sent).toEqual([{ kind: 'noteOn', note: 60 }])
  })

  it('falls back to Web Audio when no MIDI route is ready (the pre-U.2 default, unchanged)', async () => {
    vi.doMock('@adapters/audio/audioRoute.ts', () => ({
      getPlaybackMidiOutput: () => undefined,
    }))
    const ctx = new FakeAudioContext()
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => ctx),
    )

    const { createDefaultAudioOutput } = await import('./createDefaultAudioOutput.ts')
    const out = createDefaultAudioOutput()
    out.noteOn(midi(60), 100)

    expect(ctx.oscillators).toHaveLength(1)
  })

  it('shares one output across every caller within a session (module-level singleton, unchanged)', async () => {
    const midiOut = new RecordingMidiOutput()
    vi.doMock('@adapters/audio/audioRoute.ts', () => ({
      getPlaybackMidiOutput: () => midiOut,
    }))

    const { createDefaultAudioOutput } = await import('./createDefaultAudioOutput.ts')
    expect(createDefaultAudioOutput()).toBe(createDefaultAudioOutput())
  })
})
