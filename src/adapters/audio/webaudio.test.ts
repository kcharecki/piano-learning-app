import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebAudioOutput } from '@adapters/audio/webaudio.ts'
import { midi, millis } from '@core/shared/units.ts'

// ---------------------------------------------------------------- fake ctx
//
// No real AudioContext anywhere in this file — happy-dom does not implement
// one, and even where it exists it is nondeterministic to assert against.
// This fake records every AudioParam automation call with its scheduled
// time, which is exactly what needs asserting: the *schedule*, not the sound.

type ParamCall =
  | { kind: 'setValueAtTime'; value: number; time: number }
  | { kind: 'linearRampToValueAtTime'; value: number; time: number }
  | { kind: 'exponentialRampToValueAtTime'; value: number; time: number }
  | { kind: 'cancelScheduledValues'; time: number }

class FakeAudioParam {
  readonly calls: ParamCall[] = []

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.calls.push({ kind: 'setValueAtTime', value, time })
    return this
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.calls.push({ kind: 'linearRampToValueAtTime', value, time })
    return this
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.calls.push({ kind: 'exponentialRampToValueAtTime', value, time })
    return this
  }

  cancelScheduledValues(time: number): FakeAudioParam {
    this.calls.push({ kind: 'cancelScheduledValues', time })
    return this
  }
}

class FakeOscillatorNode {
  type = 'sine'
  readonly frequency = new FakeAudioParam()
  readonly connectedTo: unknown[] = []
  readonly startedAt: number[] = []
  readonly stoppedAt: number[] = []
  onended: (() => void) | null = null

  connect(dest: unknown): unknown {
    this.connectedTo.push(dest)
    return dest
  }

  start(when = 0): void {
    this.startedAt.push(when)
  }

  stop(when = 0): void {
    this.stoppedAt.push(when)
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam()
  readonly connectedTo: unknown[] = []

  connect(dest: unknown): unknown {
    this.connectedTo.push(dest)
    return dest
  }
}

class FakeAudioContext {
  currentTime = 0
  readonly destination = { label: 'destination' }
  readonly oscillators: FakeOscillatorNode[] = []
  readonly gains: FakeGainNode[] = []

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode()
    this.oscillators.push(node)
    return node
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode()
    this.gains.push(node)
    return node
  }
}

function makeCtx(): FakeAudioContext {
  return new FakeAudioContext()
}

/**
 * `createWebAudioOutput` wants a real `AudioContext`; the fake is structural.
 *
 * Every test but the dedicated epoch-conversion ones below wants the old,
 * simple world where `atMs` lines up 1:1 with `ctx.currentTime * 1000` — that
 * was true before the fix only because both happened to start at the same
 * real-world instant in a fresh `AudioContext`. Pinning `performance.now()`
 * to exactly `ctx.currentTime * 1000` at construction makes the captured
 * `clockOffsetMs` zero, which reproduces that world deliberately rather than
 * by accident, so the existing assertions (`atMs` value in, same value out as
 * ctx-seconds) keep meaning what they say.
 */
function output(ctx: FakeAudioContext) {
  const restore = vi.spyOn(performance, 'now').mockReturnValue(ctx.currentTime * 1000)
  try {
    return createWebAudioOutput(ctx as unknown as AudioContext)
  } finally {
    restore.mockRestore()
  }
}

// The very first gain node any factory call creates is the master gain —
// nothing else runs before it in `createWebAudioOutput`.
function masterGain(ctx: FakeAudioContext): FakeGainNode {
  const gain = ctx.gains[0]
  if (gain === undefined) throw new Error('master gain was never created')
  return gain
}

// ------------------------------------------------------------------ tests

describe('createWebAudioOutput', () => {
  it('connects the master gain to the context destination', () => {
    const ctx = makeCtx()
    output(ctx)
    expect(masterGain(ctx).connectedTo).toEqual([ctx.destination])
  })

  it('connects a custom destination when given one', () => {
    const ctx = makeCtx()
    const dest = { label: 'custom' }
    createWebAudioOutput(ctx as unknown as AudioContext, {
      destination: dest as unknown as AudioNode,
    })
    expect(masterGain(ctx).connectedTo).toEqual([dest])
  })

  it('noteOn schedules an oscillator at the given pitch and time, with an attack/decay envelope', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.noteOn(midi(69), 127, millis(2000)) // A4 = 440 Hz, 2000ms = 2s on the ctx clock

    const osc = ctx.oscillators.at(-1)
    if (osc === undefined) throw new Error('no oscillator created')
    expect(osc.frequency.calls).toEqual([{ kind: 'setValueAtTime', value: 440, time: 2 }])
    expect(osc.startedAt).toEqual([2])

    const gain = ctx.gains.at(-1)
    if (gain === undefined) throw new Error('no voice gain created')
    // Envelope shape: silence, ramp up to a peak, then settle to a lower
    // sustain — every event scheduled at or after the note's start time.
    expect(gain.gain.calls[0]).toEqual({ kind: 'setValueAtTime', value: 0, time: 2 })
    const [, attack, decay] = gain.gain.calls
    expect(attack?.kind).toBe('linearRampToValueAtTime')
    expect(decay?.kind).toBe('linearRampToValueAtTime')
    const attackValue = attack !== undefined && 'value' in attack ? attack.value : undefined
    const decayValue = decay !== undefined && 'value' in decay ? decay.value : undefined
    expect(attack?.time).toBeGreaterThan(2)
    expect(decay?.time).toBeGreaterThan(attack?.time ?? 0)
    expect(attackValue).toBeGreaterThan(0)
    expect(decayValue).toBeGreaterThan(0)
    expect(decayValue).toBeLessThan(attackValue ?? 0)
    for (const call of gain.gain.calls) expect(call.time).toBeGreaterThanOrEqual(2)
  })

  it('louder velocity produces a higher peak gain', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.noteOn(midi(60), 20, millis(0))
    out.noteOn(midi(60), 120, millis(0))

    const [quietGain, loudGain] = ctx.gains.slice(1) // skip the master gain
    const quietPeak = quietGain?.gain.calls[1]
    const loudPeak = loudGain?.gain.calls[1]
    const quietValue = quietPeak !== undefined && 'value' in quietPeak ? quietPeak.value : 0
    const loudValue = loudPeak !== undefined && 'value' in loudPeak ? loudPeak.value : 0
    expect(loudValue).toBeGreaterThan(quietValue)
  })

  it('routes oscillator -> voice gain -> master gain', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.noteOn(midi(60), 100, millis(0))

    const osc = ctx.oscillators.at(-1)
    const voiceGain = ctx.gains.at(-1)
    expect(osc?.connectedTo).toEqual([voiceGain])
    expect(voiceGain?.connectedTo).toEqual([masterGain(ctx)])
  })

  it('every started oscillator eventually gets a stop() scheduled (no leaked voice)', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.noteOn(midi(60), 100, millis(0))
    out.noteOn(midi(64), 100, millis(500))
    out.click(true, millis(1000))
    out.click(false, millis(1200))

    for (const osc of ctx.oscillators) {
      expect(osc.startedAt).toHaveLength(1)
      expect(osc.stoppedAt.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('noteOff reschedules an earlier release than the safety-net stop from noteOn', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.noteOn(midi(60), 100, millis(0))
    const osc = ctx.oscillators.at(-1)
    if (osc === undefined) throw new Error('no oscillator')
    const safetyNetStop = osc.stoppedAt[0]

    out.noteOff(midi(60), millis(300))
    const releaseStop = osc.stoppedAt.at(-1)
    expect(releaseStop).toBeLessThan(safetyNetStop ?? Infinity)
    // release ramp targets 0, scheduled after the noteOff time
    const gain = ctx.gains.at(-1)
    const rampToZero = gain?.gain.calls.at(-1)
    expect(rampToZero).toMatchObject({ kind: 'linearRampToValueAtTime', value: 0 })
    expect(rampToZero?.time).toBeGreaterThanOrEqual(0.3)
  })

  it('noteOff on a note that was never played is a silent no-op', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    expect(() => out.noteOff(midi(60), millis(0))).not.toThrow()
    expect(ctx.oscillators).toHaveLength(0)
  })

  it('click(accented) is louder and higher-pitched than an unaccented click', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.click(false, millis(0))
    out.click(true, millis(0))

    const [plainOsc, accentedOsc] = ctx.oscillators
    const plainFreq = plainOsc?.frequency.calls[0]
    const accentedFreq = accentedOsc?.frequency.calls[0]
    const plainFreqValue = plainFreq !== undefined && 'value' in plainFreq ? plainFreq.value : 0
    const accentedFreqValue =
      accentedFreq !== undefined && 'value' in accentedFreq ? accentedFreq.value : 0
    expect(accentedFreqValue).toBeGreaterThan(plainFreqValue)

    const [plainGain, accentedGain] = ctx.gains.slice(1)
    const plainPeak = plainGain?.gain.calls[1]
    const accentedPeak = accentedGain?.gain.calls[1]
    const plainPeakValue = plainPeak !== undefined && 'value' in plainPeak ? plainPeak.value : 0
    const accentedPeakValue =
      accentedPeak !== undefined && 'value' in accentedPeak ? accentedPeak.value : 0
    expect(accentedPeakValue).toBeGreaterThan(plainPeakValue)
  })

  it('click is short: it stops within tens of milliseconds of starting', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.click(false, millis(1000))

    const osc = ctx.oscillators.at(-1)
    const start = osc?.startedAt[0] ?? 0
    const stop = osc?.stoppedAt[0] ?? 0
    expect(stop - start).toBeGreaterThan(0)
    expect(stop - start).toBeLessThanOrEqual(0.05)
  })

  it('click does not respond to a later noteOff for the same pitch as a note', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.click(false, millis(0)) // uses whatever note/gain it uses internally
    const clickStopsBefore = ctx.oscillators.at(-1)?.stoppedAt.slice()
    out.noteOff(midi(60), millis(0)) // unrelated note, never played
    expect(ctx.oscillators.at(-1)?.stoppedAt).toEqual(clickStopsBefore)
  })

  it('allNotesOff silences currently playing notes immediately', () => {
    const ctx = makeCtx()
    ctx.currentTime = 5
    const out = output(ctx)
    out.noteOn(midi(60), 100, millis(5000))
    out.allNotesOff()

    const gain = ctx.gains.at(-1)
    const osc = ctx.oscillators.at(-1)
    expect(gain?.gain.calls.at(-2)).toEqual({ kind: 'cancelScheduledValues', time: 5 })
    expect(gain?.gain.calls.at(-1)).toEqual({ kind: 'setValueAtTime', value: 0, time: 5 })
    expect(osc?.stoppedAt.at(-1)).toBe(5)
  })

  it('allNotesOff cancels notes scheduled to start in the future, before they ever sound', () => {
    const ctx = makeCtx()
    ctx.currentTime = 0
    const out = output(ctx)
    out.noteOn(midi(72), 100, millis(5000)) // starts at t=5s, well in the future
    out.allNotesOff()

    const osc = ctx.oscillators.at(-1)
    // stop() scheduled at (or before) the node's own start time means it
    // never produces a sample of output.
    expect(osc?.stoppedAt.at(-1)).toBe(0)
    expect(osc?.startedAt[0]).toBe(5)
  })

  it('allNotesOff also cancels a future scheduled click', () => {
    const ctx = makeCtx()
    ctx.currentTime = 0
    const out = output(ctx)
    out.click(true, millis(3000))
    out.allNotesOff()

    const osc = ctx.oscillators.at(-1)
    expect(osc?.stoppedAt.at(-1)).toBe(0)
  })

  it('allNotesOff clears tracking, so a second call touches nothing new', () => {
    const ctx = makeCtx()
    const out = output(ctx)
    out.noteOn(midi(60), 100, millis(0))
    out.allNotesOff()
    const callsAfterFirst = ctx.oscillators.at(-1)?.stoppedAt.length
    out.allNotesOff()
    expect(ctx.oscillators.at(-1)?.stoppedAt.length).toBe(callsAfterFirst)
  })

  it('setVolume applies to the master gain, clamped to 0..1', () => {
    const ctx = makeCtx()
    ctx.currentTime = 1.5
    const out = output(ctx)

    out.setVolume(0.6)
    expect(masterGain(ctx).gain.calls.at(-1)).toEqual({
      kind: 'setValueAtTime',
      value: 0.6,
      time: 1.5,
    })

    out.setVolume(5)
    expect(masterGain(ctx).gain.calls.at(-1)).toMatchObject({ value: 1 })

    out.setVolume(-2)
    expect(masterGain(ctx).gain.calls.at(-1)).toMatchObject({ value: 0 })
  })

  it('now() reads the context clock in milliseconds, when the Clock and ctx epochs coincide', () => {
    const ctx = makeCtx()
    ctx.currentTime = 2.5
    const out = output(ctx)
    expect(out.now()).toBe(2500)
  })

  // ------------------------------------------------------- epoch conversion
  //
  // `atMs` is on the Clock epoch (`performance.now()`), not `ctx.currentTime`
  // — see the module comment and `core/ports/audio.ts`. Every test above uses
  // the `output()` helper, which pins the two epochs together so the plain
  // "atMs in, same value out as ctx-seconds" assertions keep working. These
  // tests are the ones that would catch an offset bug: they construct the
  // context with `ctx.currentTime` already non-zero (an AudioContext that has
  // been running a while) and a `performance.now()` far ahead of it (a
  // session that started even earlier), which is exactly the case an
  // unconverted `atMs` gets wrong.
  describe('when the Clock epoch and ctx.currentTime have drifted apart', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('shifts a scheduled atMs from the Clock epoch into ctx.currentTime using the offset captured at construction', () => {
      const ctx = makeCtx()
      ctx.currentTime = 100 // the AudioContext has been running for 100s
      vi.spyOn(performance, 'now').mockReturnValue(2_500_100) // Clock: 2500.1s in
      const out = createWebAudioOutput(ctx as unknown as AudioContext)
      // offset = 2_500_100 - 100_000 = 2_400_100
      out.noteOn(midi(60), 100, millis(2_500_600)) // Clock-epoch time, 500ms after construction

      const osc = ctx.oscillators.at(-1)
      expect(osc?.startedAt).toEqual([100.5]) // (2_500_600 - 2_400_100) / 1000
    })

    it('now() converts ctx.currentTime back to the Clock epoch using the same offset', () => {
      const ctx = makeCtx()
      ctx.currentTime = 100
      vi.spyOn(performance, 'now').mockReturnValue(2_500_100)
      const out = createWebAudioOutput(ctx as unknown as AudioContext)

      ctx.currentTime = 100.5 // 500ms of ctx-time has passed
      expect(out.now()).toBe(2_500_600) // back on the Clock epoch
    })

    it('a construction-time offset error is exactly what this catches: a zero offset would misplace every schedule', () => {
      const ctx = makeCtx()
      ctx.currentTime = 100
      vi.spyOn(performance, 'now').mockReturnValue(2_500_100)
      const out = createWebAudioOutput(ctx as unknown as AudioContext)

      out.noteOn(midi(60), 100, millis(2_500_600))
      const osc = ctx.oscillators.at(-1)
      // Treating atMs as already being ctx-time (the old bug) would schedule
      // this 2.5 million seconds in the future instead of half a second from
      // now.
      expect(osc?.startedAt.at(-1)).not.toBe(2_500_600)
      expect(osc?.startedAt.at(-1)).toBe(100.5)
    })
  })

  it('noteOn defaults to "now" on the context clock when atMs is omitted', () => {
    const ctx = makeCtx()
    ctx.currentTime = 3
    const out = output(ctx)
    out.noteOn(midi(60), 100)
    expect(ctx.oscillators.at(-1)?.startedAt).toEqual([3])
  })

  it('uses a custom waveform when given one', () => {
    const ctx = makeCtx()
    const out = createWebAudioOutput(ctx as unknown as AudioContext, { waveform: 'sawtooth' })
    out.noteOn(midi(60), 100, millis(0))
    expect(ctx.oscillators.at(-1)?.type).toBe('sawtooth')
  })
})
