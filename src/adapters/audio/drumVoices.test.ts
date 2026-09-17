import { describe, expect, it } from 'vitest'
import {
  ATTACK_S,
  LONGEST_VOICE_DECAY_S,
  NOISE_BUFFER_SECONDS,
  STOP_TAIL_S,
  buildNoiseBuffer,
} from '@adapters/audio/drumVoices.ts'

// ---------------------------------------------------------------- fake ctx
//
// `buildNoiseBuffer` only needs `sampleRate` and `createBuffer` off the
// context — a real `Float32Array`-backed buffer, not a call-recording fake,
// since what needs asserting here is the actual sample data (length and
// determinism), not a schedule.

class FakeAudioBuffer {
  private readonly channels: Float32Array[]

  constructor(numChannels: number, length: number) {
    this.channels = Array.from({ length: numChannels }, () => new Float32Array(length))
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel]
    if (data === undefined) throw new Error(`no such channel: ${channel}`)
    return data
  }
}

class FakeAudioContext {
  readonly sampleRate: number

  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate
  }

  createBuffer(numChannels: number, length: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numChannels, length)
  }
}

describe('buildNoiseBuffer', () => {
  // Kills a mutant that shrinks the buffer (or the constants it should stay
  // coupled to) below the longest voice's actual stop time, which would
  // make a long-decaying voice (hhOpen, rideEdge, crash1/2) run off the end
  // of the shared noise buffer partway through its own ring.
  it('is long enough to outlast the longest voice envelope, attack through stop tail', () => {
    const ctx = new FakeAudioContext()
    const buffer = buildNoiseBuffer(ctx as unknown as AudioContext)

    const bufferSeconds = buffer.getChannelData(0).length / ctx.sampleRate
    const longestVoiceStopSec = ATTACK_S + LONGEST_VOICE_DECAY_S + STOP_TAIL_S

    expect(bufferSeconds).toBeCloseTo(NOISE_BUFFER_SECONDS, 6)
    expect(bufferSeconds).toBeGreaterThan(longestVoiceStopSec)
  })

  // Kills a mutant that seeds the LCG from `Math.random()` (or otherwise
  // makes it non-reproducible): every noise-based voice depends on the
  // buffer being identical from one context to the next for its schedule to
  // be assertable at all.
  it('produces identical samples on every build (deterministic LCG, no Math.random)', () => {
    const bufferA = buildNoiseBuffer(new FakeAudioContext() as unknown as AudioContext)
    const bufferB = buildNoiseBuffer(new FakeAudioContext() as unknown as AudioContext)

    expect(Array.from(bufferB.getChannelData(0))).toEqual(Array.from(bufferA.getChannelData(0)))
  })
})
