/**
 * The `ui` (happy-dom) project has no real `getUserMedia`/`AudioContext`, so
 * these tests fake both by hand, the same way `webmidi.test.ts` fakes
 * `MIDIAccess`. Every assertion is on the `MidiEvent`s the adapter emits,
 * never on internals of the fakes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMicPitchInput, MIC_VELOCITY } from './micPitchInput.ts'
import { midiToFrequency } from '@core/audio/pitchDetection.ts'
import { DEFAULT_ONSET_CONFIG } from '@core/audio/noteOnsetDetector.ts'
import { FakeClock } from '@test/fakes.ts'
import type { MidiEvent } from '@core/ports/midi.ts'

const SAMPLE_RATE = 44100
const FFT_SIZE = 4096

class FakeMediaStreamTrack {
  stopped = false
  stop(): void {
    this.stopped = true
  }
}

class FakeMediaStream {
  readonly tracks = [new FakeMediaStreamTrack()]
  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks
  }
}

class FakeAnalyserNode {
  fftSize = FFT_SIZE
  /** The buffer the next `getFloatTimeDomainData` call fills from — silence until a test sets it. */
  nextBuffer: Float32Array<ArrayBuffer> = new Float32Array(FFT_SIZE)
  connected: FakeAnalyserNode[] = []
  disconnected = false

  getFloatTimeDomainData(target: Float32Array): void {
    for (let i = 0; i < target.length; i++) target[i] = this.nextBuffer[i] ?? 0
  }

  disconnect(): void {
    this.disconnected = true
  }
}

class FakeSourceNode {
  connectedTo: FakeAnalyserNode | undefined
  disconnected = false
  connect(node: FakeAnalyserNode): void {
    this.connectedTo = node
  }
  disconnect(): void {
    this.disconnected = true
  }
}

class FakeAudioContext {
  readonly sampleRate = SAMPLE_RATE
  closed = false
  readonly analyser = new FakeAnalyserNode()
  readonly source = new FakeSourceNode()
  createMediaStreamSource(): FakeSourceNode {
    return this.source
  }
  createAnalyser(): FakeAnalyserNode {
    return this.analyser
  }
  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

/** A sine tone at `note`'s frequency, loud and clean enough to clear the onset detector's clarity gate. */
function toneBuffer(note: number): Float32Array<ArrayBuffer> {
  const freq = midiToFrequency(note)
  const buffer = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    buffer[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  }
  return buffer
}

function silenceBuffer(): Float32Array<ArrayBuffer> {
  return new Float32Array(FFT_SIZE)
}

/** Builds a harness: an injected manual ticker plus a real `FakeAudioContext`/`FakeMediaStream` pair. */
function harness() {
  const stream = new FakeMediaStream()
  const ctx = new FakeAudioContext()
  const events: MidiEvent[] = []
  const clock = new FakeClock()
  let capturedTick: (() => boolean) | undefined
  let unsubscribed = false

  const resultPromise = createMicPitchInput({
    getUserMedia: () => Promise.resolve(stream as unknown as MediaStream),
    createContext: () => ctx as unknown as AudioContext,
    clock,
    scheduleTick: (tick) => {
      capturedTick = tick
      return () => {
        unsubscribed = true
      }
    },
  })

  function setBuffer(buffer: Float32Array<ArrayBuffer>): void {
    ctx.analyser.nextBuffer = buffer
  }

  function tick(): boolean {
    if (capturedTick === undefined) throw new Error('scheduleTick was never called')
    return capturedTick()
  }

  return {
    stream,
    ctx,
    events,
    clock,
    resultPromise,
    setBuffer,
    tick,
    isUnsubscribed: () => unsubscribed,
  }
}

describe('createMicPitchInput', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves ok with a MidiInput once getUserMedia grants access', async () => {
    const h = harness()
    const result = await h.resultPromise
    expect(result.ok).toBe(true)
  })

  it('resolves err with learner-safe copy, never throws or leaks the raw browser exception, when getUserMedia rejects (permission denied)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const denied = new DOMException('Permission denied by the user', 'NotAllowedError')
    const result = await createMicPitchInput({
      getUserMedia: () => Promise.reject(denied),
      createContext: () => new FakeAudioContext() as unknown as AudioContext,
      scheduleTick: () => () => {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/blocked microphone access/i)
      expect(result.error).not.toMatch(/Permission denied by the user/)
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('getUserMedia failed'), denied)
    warn.mockRestore()
  })

  it('lists exactly one synthetic "Microphone" device once connected', async () => {
    const h = harness()
    const result = await h.resultPromise
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.listDevices()).toEqual([
      { id: 'microphone', name: 'Microphone', manufacturer: 'Built-in' },
    ])
    expect(result.value.selectedDeviceId).toBe('microphone')
  })

  it('fires noteOn after onsetFrames consecutive clean ticks of the same pitch, and noteOff after silence', async () => {
    const h = harness()
    const result = await h.resultPromise
    if (!result.ok) throw new Error('expected ok')
    const events: MidiEvent[] = []
    result.value.onEvent((e) => events.push(e))

    h.setBuffer(toneBuffer(60))
    for (let i = 0; i < DEFAULT_ONSET_CONFIG.onsetFrames; i++) h.tick()
    expect(events).toEqual([{ type: 'noteOn', note: 60, velocity: MIC_VELOCITY, time: expect.any(Number) }])

    h.setBuffer(silenceBuffer())
    for (let i = 0; i < DEFAULT_ONSET_CONFIG.releaseFrames; i++) h.tick()
    expect(events).toEqual([
      { type: 'noteOn', note: 60, velocity: MIC_VELOCITY, time: expect.any(Number) },
      { type: 'noteOff', note: 60, time: expect.any(Number) },
    ])
  })

  it('dispose() stops the microphone track, closes the context, and unsubscribes the tick loop', async () => {
    const h = harness()
    const result = await h.resultPromise
    if (!result.ok) throw new Error('expected ok')

    result.value.dispose()

    expect(h.stream.tracks[0]?.stopped).toBe(true)
    expect(h.ctx.closed).toBe(true)
    expect(h.isUnsubscribed()).toBe(true)
    expect(result.value.listDevices()).toEqual([])
  })

  it('emits nothing after dispose even if the scheduler fires one more tick', async () => {
    const h = harness()
    const result = await h.resultPromise
    if (!result.ok) throw new Error('expected ok')
    const events: MidiEvent[] = []
    result.value.onEvent((e) => events.push(e))

    result.value.dispose()
    h.setBuffer(toneBuffer(60))
    const keepGoing = h.tick()

    expect(keepGoing).toBe(false)
    expect(events).toEqual([])
  })
})
