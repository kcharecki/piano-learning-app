import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHOKE_RAMP_S, createDrumSynth } from '@adapters/audio/drumSynth.ts'
import { MAPPED_PADS } from '@core/drums/model/pad.ts'
import { millis } from '@core/shared/units.ts'

// ---------------------------------------------------------------- fake ctx
//
// No real AudioContext anywhere in this file — this adapter test runs in
// the `ui` vitest project (happy-dom), which does not implement one either,
// and even where it exists it is nondeterministic to assert against. This
// fake records every AudioParam automation call with its scheduled time,
// which is exactly what needs asserting: the *schedule*, not the sound.
// Same shape as `webaudio.test.ts`'s fake — reproduced here rather than
// imported, since each adapter test file is self-contained.

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

class FakeAudioBufferSourceNode {
  buffer: unknown = null
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

class FakeBiquadFilterNode {
  type = 'lowpass'
  readonly frequency = new FakeAudioParam()
  readonly Q = new FakeAudioParam()
  readonly connectedTo: unknown[] = []

  connect(dest: unknown): unknown {
    this.connectedTo.push(dest)
    return dest
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam()
  readonly connectedTo: unknown[] = []
  disconnectCount = 0

  connect(dest: unknown): unknown {
    this.connectedTo.push(dest)
    return dest
  }

  disconnect(): void {
    this.disconnectCount++
  }
}

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
  currentTime = 0
  readonly sampleRate = 44100
  readonly destination = { label: 'destination' }
  readonly oscillators: FakeOscillatorNode[] = []
  readonly bufferSources: FakeAudioBufferSourceNode[] = []
  readonly gains: FakeGainNode[] = []
  readonly filters: FakeBiquadFilterNode[] = []
  /** Defaults to 'running' — the common case a browser context starts in after a gesture. */
  state: 'running' | 'suspended' | 'closed' = 'running'
  resumeCalls = 0

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

  createBufferSource(): FakeAudioBufferSourceNode {
    const node = new FakeAudioBufferSourceNode()
    this.bufferSources.push(node)
    return node
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode()
    this.filters.push(node)
    return node
  }

  createBuffer(numChannels: number, length: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numChannels, length)
  }

  resume(): Promise<void> {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }
}

function makeCtx(): FakeAudioContext {
  return new FakeAudioContext()
}

/**
 * `createDrumSynth` wants a real `AudioContext` factory; the fake is
 * structural. Pins `performance.now()` to `ctx.currentTime * 1000`, exactly
 * as `webaudio.test.ts`'s `output()` helper does, so the plain "atMs value
 * in, same value out as ctx-seconds" assertions below mean what they say —
 * the dedicated epoch-conversion tests deliberately do NOT use this helper.
 */
function synth(ctx: FakeAudioContext) {
  vi.spyOn(performance, 'now').mockReturnValue(ctx.currentTime * 1000)
  return createDrumSynth({ context: () => ctx as unknown as AudioContext })
}

function lastZeroRampTime(gain: FakeGainNode): number | undefined {
  const zeroRamps = gain.gain.calls.filter(
    (c): c is Extract<ParamCall, { kind: 'linearRampToValueAtTime' }> =>
      c.kind === 'linearRampToValueAtTime' && c.value === 0,
  )
  return zeroRamps.at(-1)?.time
}

/** Was a choke (cancelScheduledValues) scheduled on this gain at (about) `atSec`? */
function wasChokedAt(gain: FakeGainNode, atSec: number): boolean {
  return gain.gain.calls.some(
    (c) => c.kind === 'cancelScheduledValues' && Math.abs(c.time - atSec) < 1e-6,
  )
}

function wasEverChoked(gain: FakeGainNode): boolean {
  return gain.gain.calls.some((c) => c.kind === 'cancelScheduledValues')
}

/** The value a `setValueAtTime` call pinned at (about) `atSec`, if any. */
function valuePinnedAt(gain: FakeGainNode, atSec: number): number | undefined {
  const call = gain.gain.calls.find(
    (c): c is Extract<ParamCall, { kind: 'setValueAtTime' }> =>
      c.kind === 'setValueAtTime' && Math.abs(c.time - atSec) < 1e-9,
  )
  return call?.value
}

function firstPeakGain(gain: FakeGainNode): number {
  const ramp = gain.gain.calls.find((c) => c.kind === 'linearRampToValueAtTime')
  if (ramp === undefined || !('value' in ramp)) throw new Error('no peak ramp scheduled')
  return ramp.value
}

// ------------------------------------------------------------------ tests

describe('createDrumSynth', () => {
  // Every `performance.now()` spy set up by a test (directly, or via the
  // `synth()` helper) is cleaned up here, regardless of which style of mock
  // it used — nothing below relies on a spy surviving past its test.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Kills a mutant that releases hhOpen on a fixed wall-clock timer (e.g.
  // "decay over 240ms regardless of what follows") instead of on the next
  // hi-hat event, and one that forgets to pin the envelope's actual value
  // before ramping it to 0 (roadmap review finding: cancelScheduledValues
  // alone reverts the gain to its attack peak, not to wherever the natural
  // decay had actually reached, so a choke well into the ring produces a
  // fade from full volume instead of from the true current level).
  it('chokes hhOpen at exactly the context time of the next hhClosed strike, pinning the true envelope value before the ramp, and stops the source early', () => {
    const ctx = makeCtx()
    const out = synth(ctx)
    const bpm = 120
    const eighthMs = 30000 / bpm

    out.strike('hhOpen', 100, millis(0))
    const openGain = ctx.gains.at(-1)
    const openSource = ctx.bufferSources.at(-1)
    if (openGain === undefined || openSource === undefined) throw new Error('no open-hat voice')
    const naturalStop = openSource.stoppedAt.at(-1)
    if (naturalStop === undefined) throw new Error('no natural stop scheduled')

    out.strike('hhClosed', 100, millis(eighthMs))
    const closedGain = ctx.gains.at(-1)
    if (closedGain === undefined) throw new Error('no closed-hat gain')

    const t1Sec = eighthMs / 1000
    expect(wasChokedAt(openGain, t1Sec)).toBe(true)
    expect(wasEverChoked(closedGain)).toBe(false)

    // The envelope value pinned at the choke instant must be a real,
    // strictly-positive mid-decay value — not left implicit (which would
    // silently keep whatever `cancelScheduledValues` reverted to).
    const pinnedValue = valuePinnedAt(openGain, t1Sec)
    expect(pinnedValue).toBeGreaterThan(0)

    // The choke ramp itself lands exactly CHOKE_RAMP_S after the choke instant.
    expect(lastZeroRampTime(openGain)).toBeCloseTo(t1Sec + CHOKE_RAMP_S, 9)

    // The source is stopped well before its natural (un-choked) stop time.
    const chokedStop = openSource.stoppedAt.at(-1)
    expect(chokedStop).toBeLessThan(naturalStop)
  })

  // Kills a mutant that only recognises hhClosed as a choke trigger (the
  // obvious "close the hat" case) and misses hhPedal / a second hhOpen —
  // and, separately, a mutant that chokes on ANY strike rather than just
  // the three hi-hat pads.
  it('hhPedal and a second hhOpen also choke a ringing open hat; a snare or kick strike does not', () => {
    for (const choker of ['hhPedal', 'hhOpen'] as const) {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.strike('hhOpen', 100, millis(0))
      const openGain = ctx.gains.at(-1)
      if (openGain === undefined) throw new Error('no open-hat gain')

      out.strike(choker, 100, millis(100))
      expect(wasChokedAt(openGain, 0.1)).toBe(true)
    }

    for (const nonChoker of ['snare', 'kick'] as const) {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.strike('hhOpen', 100, millis(0))
      const openGain = ctx.gains.at(-1)
      if (openGain === undefined) throw new Error('no open-hat gain')

      out.strike(nonChoker, 100, millis(100))
      expect(wasEverChoked(openGain)).toBe(false)
    }
  })

  // Kills a mutant that removes (or inverts) the `ohv.startSec < atSec`
  // out-of-order guard: a strike scheduled ahead of a not-yet-started hhOpen
  // must never choke it — there is nothing ringing yet to release.
  it('a hhClosed scheduled earlier than a still-future hhOpen never chokes it', () => {
    const ctx = makeCtx()
    const out = synth(ctx)
    out.strike('hhOpen', 100, millis(200))
    const openGain = ctx.gains.at(-1)
    if (openGain === undefined) throw new Error('no open-hat gain')

    out.strike('hhClosed', 100, millis(100))
    expect(wasEverChoked(openGain)).toBe(false)
  })

  // Kills a mutant that gives hhOpen the same short envelope as hhClosed
  // (the bug this whole feature exists to fix: today's placeholder plays an
  // indistinguishable blip for both).
  it("the open hat's own natural decay outlasts the closed hat's", () => {
    const openCtx = makeCtx()
    synth(openCtx).strike('hhOpen', 100, millis(0))
    const openGain = openCtx.gains.at(-1)
    if (openGain === undefined) throw new Error('no open-hat gain')
    const openEnd = lastZeroRampTime(openGain)

    const closedCtx = makeCtx()
    synth(closedCtx).strike('hhClosed', 100, millis(0))
    const closedGain = closedCtx.gains.at(-1)
    if (closedGain === undefined) throw new Error('no closed-hat gain')
    const closedEnd = lastZeroRampTime(closedGain)

    if (openEnd === undefined || closedEnd === undefined) {
      throw new Error('expected a natural-decay-to-zero ramp on both voices')
    }
    expect(openEnd).toBeGreaterThan(closedEnd)
  })

  describe('epoch conversion', () => {
    // Kills a mutant that schedules a live strike at ctx time 0 (or at
    // whatever `now()` was at construction) instead of the context's
    // *current* time.
    it('a live strike (no atMs) schedules at the context current time', () => {
      const ctx = makeCtx()
      ctx.currentTime = 3
      const out = synth(ctx)
      out.strike('kick', 100)
      const osc = ctx.oscillators.at(-1)
      if (osc === undefined) throw new Error('no oscillator created')
      expect(osc.startedAt).toEqual([3])
    })

    // Kills a mutant that treats atMs as already being ctx-time (schedules
    // 2.5 million seconds in the future instead of half a second from now)
    // — the exact bug `webaudio.test.ts` guards against for the piano side.
    it('an atMs strike lands at (atMs - epochOffset) in context seconds', () => {
      const ctx = makeCtx()
      ctx.currentTime = 100 // the AudioContext has been running for 100s
      vi.spyOn(performance, 'now').mockReturnValue(2_500_100) // Clock: 2500.1s in
      const out = createDrumSynth({ context: () => ctx as unknown as AudioContext })

      // offset, captured when the engine is built on this first call:
      // 2_500_100 - 100_000 = 2_400_100
      out.strike('kick', 100, millis(2_500_600))
      const osc = ctx.oscillators.at(-1)
      if (osc === undefined) throw new Error('no oscillator created')
      expect(osc.startedAt).toEqual([100.5]) // (2_500_600 - 2_400_100) / 1000
    })

    // -------------------------------------------- offset anchor (roadmap review)
    //
    // Ported from `webaudio.test.ts`'s "offset anchor tracking" suite: this
    // module's `updateOffsetAnchor` is a byte-for-byte copy of that one, and
    // was entirely untested here. See that file's comments for the full
    // derivation of the filter's time constant and resnap threshold.
    describe('offset anchor tracking', () => {
      it('rejects a slow clock drift that would defeat a frozen offset', () => {
        const DRIFT_MS_PER_MS = -15 / 60_000 // -15 ms/min, the measured rate
        const SESSION_MS = 12 * 60_000
        const STEP_MS = 250
        const LEAD_MS = 300 // schedule ahead of "now" so the past-time clamp never fires
        const trueOffsetMs = (perfMs: number): number => DRIFT_MS_PER_MS * perfMs

        const ctx = makeCtx()
        const perfNow = vi.spyOn(performance, 'now').mockReturnValue(0)
        ctx.currentTime = 0
        const out = createDrumSynth({ context: () => ctx as unknown as AudioContext })

        let maxSchedulingErrorMs = 0
        for (let elapsedMs = 0; elapsedMs <= SESSION_MS; elapsedMs += STEP_MS) {
          perfNow.mockReturnValue(elapsedMs)
          ctx.currentTime = (elapsedMs - trueOffsetMs(elapsedMs)) / 1000

          const atMs = elapsedMs + LEAD_MS
          const expectedCtxSeconds = (atMs - trueOffsetMs(atMs)) / 1000

          out.strike('kick', 100, millis(atMs))
          const actualCtxSeconds = ctx.oscillators.at(-1)?.startedAt.at(-1) ?? Number.NaN
          const errorMs = Math.abs(actualCtxSeconds - expectedCtxSeconds) * 1000
          maxSchedulingErrorMs = Math.max(maxSchedulingErrorMs, errorMs)
        }

        expect(maxSchedulingErrorMs).toBeLessThan(1)
      })

      it('rejects a 17ms peak-to-peak sawtooth on ctx.currentTime with no underlying drift', () => {
        const SAWTOOTH_PERIOD_MS = 16
        const SAWTOOTH_PEAK_TO_PEAK_MS = 17
        const CALL_STEP_MS = 16.7 // deliberately not a multiple of the sawtooth period
        const WARMUP_MS = 10_000 // let the 2s time-constant filter settle first
        const RUN_MS = 20_000
        const LEAD_MS = 100
        const noiseMs = (perfMs: number): number => {
          const phase = (perfMs % SAWTOOTH_PERIOD_MS) / SAWTOOTH_PERIOD_MS
          return phase * SAWTOOTH_PEAK_TO_PEAK_MS - SAWTOOTH_PEAK_TO_PEAK_MS / 2
        }

        const ctx = makeCtx()
        const perfNow = vi.spyOn(performance, 'now').mockReturnValue(0)
        ctx.currentTime = 0
        const out = createDrumSynth({ context: () => ctx as unknown as AudioContext })

        let maxWobbleMs = 0
        for (let elapsedMs = 0; elapsedMs <= RUN_MS; elapsedMs += CALL_STEP_MS) {
          perfNow.mockReturnValue(elapsedMs)
          ctx.currentTime = (elapsedMs - noiseMs(elapsedMs)) / 1000

          const atMs = elapsedMs + LEAD_MS
          const expectedCtxSeconds = atMs / 1000

          out.strike('kick', 100, millis(atMs))

          if (elapsedMs >= WARMUP_MS) {
            const actualCtxSeconds = ctx.oscillators.at(-1)?.startedAt.at(-1) ?? Number.NaN
            const wobbleMs = Math.abs(actualCtxSeconds - expectedCtxSeconds) * 1000
            maxWobbleMs = Math.max(maxWobbleMs, wobbleMs)
          }
        }

        expect(maxWobbleMs).toBeLessThan(1)
      })

      it('snaps to the new offset immediately on a large jump, instead of crawling toward it', () => {
        const ctx = makeCtx()
        const perfNow = vi.spyOn(performance, 'now').mockReturnValue(0)
        ctx.currentTime = 0
        const out = createDrumSynth({ context: () => ctx as unknown as AudioContext })
        out.strike('kick', 100, millis(0)) // establishes the anchor at offset 0

        perfNow.mockReturnValue(10) // only 10ms of real time passed
        ctx.currentTime = 5.01 // but ctx jumped 5s ahead — raw offset is now -5000

        out.strike('snare', 100, millis(110)) // 100ms lead on the new "now"
        const actualCtxSeconds = ctx.oscillators.at(-1)?.startedAt.at(-1)

        expect(actualCtxSeconds).toBeCloseTo(5.11, 6)
      })
    })
  })

  // Kills a mutant that uses a flat/constant gain regardless of velocity, or
  // one that maps velocity non-monotonically.
  it('velocity maps to gain monotonically: 127 louder than 64 louder than 1', () => {
    const peakFor = (velocity: number): number => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.strike('snare', velocity, millis(0))
      const gain = ctx.gains.at(-1)
      if (gain === undefined) throw new Error('no gain created')
      return firstPeakGain(gain)
    }

    const quiet = peakFor(1)
    const mid = peakFor(64)
    const loud = peakFor(127)
    expect(mid).toBeGreaterThan(quiet)
    expect(loud).toBeGreaterThan(mid)
  })

  describe('velocity boundaries', () => {
    // Kills a mutant that treats velocity 0 as an ordinary (very quiet)
    // strike: velocity 0 is MIDI note-off and must schedule nothing at all.
    it('velocity 0 schedules nothing', () => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.strike('snare', 0, millis(0))
      expect(ctx.oscillators).toHaveLength(0)
      expect(ctx.bufferSources).toHaveLength(0)
    })

    it('velocity 1 and velocity 127 both still strike', () => {
      for (const velocity of [1, 127]) {
        const ctx = makeCtx()
        const out = synth(ctx)
        out.strike('snare', velocity, millis(0))
        expect(ctx.oscillators.length + ctx.bufferSources.length).toBeGreaterThan(0)
      }
    })
  })

  // Kills a mutant that leaves a choked/panicked voice's source running (no
  // stop() call), and one that lets allNotesOff permanently wedge the synth
  // so nothing sounds afterwards. Snapshots counts *before* calling
  // allNotesOff and asserts growth, rather than only re-checking properties
  // that build-time scheduling (`setValueAtTime(0, startSec)` /
  // `stop(stopSec)`) already satisfies on its own — those assertions alone
  // would pass even if `allNotesOff` were a no-op.
  it('allNotesOff stops every live source and chokes a ringing open hat; strikes after it sound again', () => {
    const ctx = makeCtx()
    const out = synth(ctx)

    out.strike('hhOpen', 100, millis(0))
    const openSource = ctx.bufferSources.at(-1)
    const openGain = ctx.gains.at(-1)
    if (openSource === undefined || openGain === undefined) throw new Error('no open-hat voice')

    out.strike('kick', 100, millis(10))
    const kickOsc = ctx.oscillators.at(-1)
    if (kickOsc === undefined) throw new Error('no kick oscillator')

    // Distinct from every stop/ramp time already scheduled above (the open
    // hat's natural stop is ~1.552s, the kick's ~0.312s), so a real new
    // schedule at this instant is unambiguous.
    ctx.currentTime = 0.6
    const openStopCountBefore = openSource.stoppedAt.length
    const kickStopCountBefore = kickOsc.stoppedAt.length
    const openGainCallCountBefore = openGain.gain.calls.length

    out.allNotesOff()

    expect(openSource.stoppedAt.length).toBeGreaterThan(openStopCountBefore)
    expect(openSource.stoppedAt.at(-1)).toBe(0.6)
    expect(kickOsc.stoppedAt.length).toBeGreaterThan(kickStopCountBefore)
    expect(kickOsc.stoppedAt.at(-1)).toBe(0.6)
    expect(openGain.gain.calls.length).toBeGreaterThan(openGainCallCountBefore)
    expect(openGain.gain.calls.at(-1)).toEqual({ kind: 'setValueAtTime', value: 0, time: 0.6 })

    const oscCountBefore = ctx.oscillators.length
    out.strike('snare', 100, millis(20))
    expect(ctx.oscillators.length).toBeGreaterThan(oscCountBefore)
  })

  // Kills a mutant that drops the onended cleanup's disconnect() call,
  // leaving every finished voice's gain node attached to the graph forever.
  describe('voice cleanup on end', () => {
    it("a struck voice's gain node is disconnected once its source ends", () => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.strike('kick', 100, millis(0))
      const gain = ctx.gains.at(-1)
      const osc = ctx.oscillators.at(-1)
      if (gain === undefined || osc === undefined) throw new Error('no kick voice')

      expect(gain.disconnectCount).toBe(0)
      osc.onended?.()
      expect(gain.disconnectCount).toBe(1)
    })

    it("a click's gain node is disconnected once its oscillator ends", () => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.click(false, millis(0))
      const gain = ctx.gains.at(-1)
      const osc = ctx.oscillators.at(-1)
      if (gain === undefined || osc === undefined) throw new Error('no click voice')

      expect(gain.disconnectCount).toBe(0)
      osc.onended?.()
      expect(gain.disconnectCount).toBe(1)
    })
  })

  // Kills a mutant with a non-exhaustive (or mis-ordered) switch that throws
  // or silently drops sound for some pad — e.g. a `default` case papering
  // over a missing one instead of the compiler catching it.
  it('every MappedDrumPad strikes without throwing and creates at least one source node', () => {
    for (const pad of MAPPED_PADS) {
      const ctx = makeCtx()
      const out = synth(ctx)
      const before = ctx.oscillators.length + ctx.bufferSources.length
      expect(() => out.strike(pad, 100, millis(0))).not.toThrow()
      expect(ctx.oscillators.length + ctx.bufferSources.length).toBeGreaterThan(before)
    }
  })

  describe('click', () => {
    // Kills a mutant that gives the accent no effect on frequency or gain.
    it('an accented click is louder and higher-pitched than an unaccented one', () => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.click(false, millis(0))
      out.click(true, millis(0))

      const [plainOsc, accentedOsc] = ctx.oscillators
      const plainFreq = plainOsc?.frequency.calls[0]
      const accentedFreq = accentedOsc?.frequency.calls[0]
      const plainFreqValue = plainFreq !== undefined && 'value' in plainFreq ? plainFreq.value : 0
      const accentedFreqValue =
        accentedFreq !== undefined && 'value' in accentedFreq ? accentedFreq.value : 0
      expect(accentedFreqValue).toBeGreaterThan(plainFreqValue)

      const [plainGain, accentedGain] = ctx.gains.slice(1) // skip the master gain
      const plainPeak = plainGain?.gain.calls[1]
      const accentedPeak = accentedGain?.gain.calls[1]
      const plainPeakValue = plainPeak !== undefined && 'value' in plainPeak ? plainPeak.value : 0
      const accentedPeakValue =
        accentedPeak !== undefined && 'value' in accentedPeak ? accentedPeak.value : 0
      expect(accentedPeakValue).toBeGreaterThan(plainPeakValue)
    })

    // Kills a mutant that lets a click ring on (or stop immediately at start).
    it('a click stops within tens of milliseconds of its start', () => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.click(false, millis(1000))

      const osc = ctx.oscillators.at(-1)
      const start = osc?.startedAt[0] ?? 0
      const stop = osc?.stoppedAt[0] ?? 0
      expect(stop - start).toBeGreaterThan(0)
      expect(stop - start).toBeLessThanOrEqual(0.05)
    })
  })

  describe('AudioContext resume', () => {
    // Kills a mutant that drops the resume check entirely: a context built
    // from a MIDI-event-driven first strike (no click/tap for the browser
    // to treat as a user gesture) can start `suspended` and would otherwise
    // stay silent forever.
    it('resumes a context that starts suspended', () => {
      const ctx = makeCtx()
      ctx.state = 'suspended'
      const out = synth(ctx)
      out.strike('kick', 100, millis(0))
      expect(ctx.resumeCalls).toBeGreaterThan(0)
    })

    it('does not bother resuming an already-running context', () => {
      const ctx = makeCtx()
      ctx.state = 'running'
      const out = synth(ctx)
      out.strike('kick', 100, millis(0))
      expect(ctx.resumeCalls).toBe(0)
    })
  })

  describe('engine construction retry', () => {
    // Kills a mutant that latches a construction failure permanently (the
    // old `engineFailed` flag): a single transient refusal must not mute
    // drums for the rest of the session — the very next call retries.
    it('a throwing context factory is swallowed on the first call and retried on the next', () => {
      const realCtx = makeCtx()
      let callCount = 0
      const out = createDrumSynth({
        context: () => {
          callCount++
          if (callCount === 1) throw new Error('AudioContext construction refused')
          return realCtx as unknown as AudioContext
        },
      })
      vi.spyOn(performance, 'now').mockReturnValue(0)

      expect(() => out.strike('kick', 100, millis(0))).not.toThrow()
      expect(realCtx.oscillators).toHaveLength(0) // first attempt failed — nothing built, nothing scheduled

      out.strike('kick', 100, millis(0))
      expect(realCtx.oscillators.length).toBeGreaterThan(0) // second attempt succeeded and played
    })

    it('gives up after the documented attempt cap instead of retrying forever', () => {
      let callCount = 0
      const out = createDrumSynth({
        context: () => {
          callCount++
          throw new Error('always refused')
        },
      })
      vi.spyOn(performance, 'now').mockReturnValue(0)

      for (let i = 0; i < 10; i++) out.strike('kick', 100, millis(0))
      const callsAtCap = callCount
      out.strike('kick', 100, millis(0))
      expect(callCount).toBe(callsAtCap) // no further attempts once the cap is hit
    })
  })

  describe('setVolume / now', () => {
    // Kills a mutant that ignores setVolume, or does not clamp it.
    it('applies the clamped volume to the master gain', () => {
      const ctx = makeCtx()
      ctx.currentTime = 1.5
      const out = synth(ctx)
      out.strike('kick', 100, millis(0)) // build the engine (and its master gain)
      const master = ctx.gains[0]
      if (master === undefined) throw new Error('no master gain')

      out.setVolume(0.6)
      expect(master.gain.calls.at(-1)).toEqual({
        kind: 'setValueAtTime',
        value: 0.6,
        time: 1.5,
      })

      out.setVolume(5)
      expect(master.gain.calls.at(-1)).toMatchObject({ value: 1 })

      out.setVolume(-2)
      expect(master.gain.calls.at(-1)).toMatchObject({ value: 0 })
    })

    // Kills a mutant that drops `pendingVolume`, so a volume set before any
    // sound has played is lost instead of applied once the engine builds.
    it('a volume set before the engine exists is applied on the first strike', () => {
      const ctx = makeCtx()
      const out = synth(ctx)
      out.setVolume(0.42) // no engine yet — must not force-build the AudioContext
      expect(ctx.gains).toHaveLength(0)

      out.strike('kick', 100, millis(0))
      const master = ctx.gains[0]
      if (master === undefined) throw new Error('no master gain')
      expect(master.gain.calls[0]).toEqual({ kind: 'setValueAtTime', value: 0.42, time: 0 })
    })

    // Kills a mutant that breaks the now()/toCtxSeconds round trip (e.g.
    // now() using a stale anchor, or one on a different epoch than atMs).
    it('now() round-trips through toCtxSeconds back to ctx.currentTime', () => {
      const ctx = makeCtx()
      ctx.currentTime = 2.5
      const out = synth(ctx)
      out.strike('kick', 100, millis(0)) // build the engine so now() has a real anchor

      const nowMs = out.now()
      out.strike('snare', 100, nowMs)
      const osc = ctx.oscillators.at(-1)
      expect(osc?.startedAt.at(-1)).toBeCloseTo(2.5, 9)
    })
  })

  // Kills a mutant that lets a throwing context factory propagate out of
  // `strike`/`click` and crash the caller (the Groove trainer's playback
  // loop) instead of just producing no sound.
  it('does not throw when the injected context factory throws (a refused AudioContext construction)', () => {
    const out = createDrumSynth({
      context: () => {
        throw new Error('AudioContext construction refused')
      },
    })
    expect(() => out.strike('kick', 100, millis(0))).not.toThrow()
    expect(() => out.click(false, millis(0))).not.toThrow()
    expect(() => out.allNotesOff()).not.toThrow()
    expect(() => out.setVolume(0.5)).not.toThrow()
    expect(() => out.now()).not.toThrow()
  })
})
