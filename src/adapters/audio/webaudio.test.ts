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
 * Every test but the dedicated epoch-conversion / drift / jitter ones below
 * wants the old, simple world where `atMs` lines up 1:1 with
 * `ctx.currentTime * 1000` — that was true before the fix only because both
 * happened to start at the same real-world instant in a fresh
 * `AudioContext`. Pinning `performance.now()` to exactly
 * `ctx.currentTime * 1000` — and, importantly, leaving it pinned there for
 * the rest of the test, since the offset anchor now re-reads
 * `performance.now()` on every public call, not just once at construction —
 * reproduces that world deliberately rather than by accident, so the
 * existing assertions (`atMs` value in, same value out as ctx-seconds) keep
 * meaning what they say. The mock is cleaned up by the top-level `afterEach`
 * below.
 */
function output(ctx: FakeAudioContext) {
  vi.spyOn(performance, 'now').mockReturnValue(ctx.currentTime * 1000)
  return createWebAudioOutput(ctx as unknown as AudioContext)
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
  // Every `performance.now()` spy set up by a test (directly, or via the
  // `output()` helper) is cleaned up here, regardless of which style of
  // mock it used — nothing below relies on a spy surviving past its test.
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

    it('now() converts ctx.currentTime back to the Clock epoch using the same offset — and toCtxSeconds(now()) round-trips to ctx.currentTime', () => {
      const ctx = makeCtx()
      ctx.currentTime = 100
      const perfNow = vi.spyOn(performance, 'now').mockReturnValue(2_500_100)
      const out = createWebAudioOutput(ctx as unknown as AudioContext)

      // Advance both clocks by the same 500ms — no drift between them, just
      // time passing — so the offset anchor has nothing to re-converge on
      // and the round trip should be exact. (Advancing ctx.currentTime alone
      // here, the way the old frozen-offset test did, would look to the new
      // anchor tracker exactly like a several-hundred-ms clock jump and
      // trigger the resnap escape hatch instead of exercising the plain
      // conversion — that scenario has its own dedicated test below.)
      ctx.currentTime = 100.5
      perfNow.mockReturnValue(2_500_600)
      const nowMs = out.now()
      expect(nowMs).toBe(2_500_600) // back on the Clock epoch

      // Round trip: feeding that value straight back in as an `atMs` must
      // reproduce ctx.currentTime exactly, per the module contract.
      const osc = ctx.oscillators
      out.noteOn(midi(72), 100, nowMs)
      expect(osc.at(-1)?.startedAt).toEqual([100.5])
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

  // -------------------------------------------- offset anchor (roadmap 2.32e)
  //
  // The old implementation captured `performance.now() - ctx.currentTime *
  // 1000` exactly once, at construction, and used it forever. Measured on
  // this machine (least-squares fit, ~170 samples over ~43s, three runs
  // agreeing to within ~1 ms/min): the AudioContext hardware clock runs
  // about -15 ms/min relative to `performance.now()`. A frozen offset goes
  // stale by that much every minute — ~150ms after ten minutes of practice.
  // The fix re-measures the offset on every public call and folds it into a
  // running estimate with a time-based exponential filter, which has to
  // satisfy two competing tests at once: it must reject the drift ramp
  // *and* the ~17ms peak-to-peak sawtooth that the raw per-call measurement
  // carries (`ctx.currentTime` advances in render-quantum steps, not
  // continuously).
  describe('offset anchor tracking', () => {
    it('rejects a slow clock drift that would defeat a frozen offset', () => {
      // Simulate a ~255 ppm fast hardware clock (matches the measured
      // -15 ms/min) over a 12-simulated-minute session, sampling every
      // simulated 250ms — comparable to a metronome or note-scheduling call
      // rate. `trueOffsetMs(t)` is the exact, analytically-known offset our
      // simulation defines at real-time `t`; nothing about it is estimated.
      const DRIFT_MS_PER_MS = -15 / 60_000 // -15 ms/min, the measured rate
      const SESSION_MS = 12 * 60_000
      const STEP_MS = 250
      const LEAD_MS = 300 // schedule ahead of "now" so the past-time clamp never fires
      const trueOffsetMs = (perfMs: number): number => DRIFT_MS_PER_MS * perfMs

      const ctx = makeCtx()
      const perfNow = vi.spyOn(performance, 'now').mockReturnValue(0)
      ctx.currentTime = 0
      const out = createWebAudioOutput(ctx as unknown as AudioContext)

      let maxSchedulingErrorMs = 0
      for (let elapsedMs = 0; elapsedMs <= SESSION_MS; elapsedMs += STEP_MS) {
        perfNow.mockReturnValue(elapsedMs)
        ctx.currentTime = (elapsedMs - trueOffsetMs(elapsedMs)) / 1000

        const atMs = elapsedMs + LEAD_MS
        const expectedCtxSeconds = (atMs - trueOffsetMs(atMs)) / 1000

        out.noteOn(midi(60), 100, millis(atMs))
        const actualCtxSeconds = ctx.oscillators.at(-1)?.startedAt.at(-1) ?? Number.NaN
        const errorMs = Math.abs(actualCtxSeconds - expectedCtxSeconds) * 1000
        maxSchedulingErrorMs = Math.max(maxSchedulingErrorMs, errorMs)
      }

      // The old frozen-offset implementation captures offset = 0 at t=0 and
      // never updates it, so its error at t=12min would be
      // |trueOffsetMs(SESSION_MS)| = 15 * 12 = 180ms — two orders of
      // magnitude over this bound. This is the mutant this test kills:
      // reverting `updateOffsetAnchor` to a construction-time-only capture
      // fails this assertion by ~180x.
      expect(maxSchedulingErrorMs).toBeLessThan(1)
    })

    it('rejects a 17ms peak-to-peak sawtooth on ctx.currentTime with no underlying drift', () => {
      // No drift here: the *true* offset is a constant 0 for the whole run.
      // What varies is the raw, per-call measurement of it, which — exactly
      // as on real hardware — carries a sawtooth because `ctx.currentTime`
      // only advances in render-quantum steps. `noiseMs` reproduces that: it
      // walks the full 17ms peak-to-peak swing every SAWTOOTH_PERIOD_MS of
      // *real* time, independent of when the app happens to call in.
      //
      // The call cadence (CALL_STEP_MS, one simulated ~60fps animation
      // frame) is deliberately NOT a multiple of SAWTOOTH_PERIOD_MS — if it
      // were, every call would sample the exact same phase of the sawtooth
      // and the "noise" would collapse into a constant bias instead of
      // actually varying from call to call, which is the whole point of
      // this test.
      const SAWTOOTH_PERIOD_MS = 16 // one simulated render-quantum-scale cycle
      const SAWTOOTH_PEAK_TO_PEAK_MS = 17
      const CALL_STEP_MS = 16.7 // one simulated ~60fps animation frame
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
      const out = createWebAudioOutput(ctx as unknown as AudioContext)

      let maxWobbleMs = 0
      for (let elapsedMs = 0; elapsedMs <= RUN_MS; elapsedMs += CALL_STEP_MS) {
        perfNow.mockReturnValue(elapsedMs)
        // Raw offset (perf - ctx*1000) carries the sawtooth: ctx.currentTime
        // is perf time *minus* the noise so that perf - ctx*1000 = +noise.
        ctx.currentTime = (elapsedMs - noiseMs(elapsedMs)) / 1000

        const atMs = elapsedMs + LEAD_MS
        // True offset is always 0, so the ideal scheduled time is just
        // atMs/1000 regardless of the noise riding on the raw measurement.
        const expectedCtxSeconds = atMs / 1000

        out.noteOn(midi(60), 100, millis(atMs))

        if (elapsedMs >= WARMUP_MS) {
          const actualCtxSeconds = ctx.oscillators.at(-1)?.startedAt.at(-1) ?? Number.NaN
          const wobbleMs = Math.abs(actualCtxSeconds - expectedCtxSeconds) * 1000
          maxWobbleMs = Math.max(maxWobbleMs, wobbleMs)
        }
      }

      // A naive per-call re-anchor (`anchor = raw` every call, no filter) is
      // exactly the trap this test catches: it would pass the raw noise
      // straight through, wobbling by up to the full ~17ms peak-to-peak
      // swing — 17x over this bound. Reverting `updateOffsetAnchor` to
      // "return performance.now() - ctx.currentTime * 1000" unfiltered
      // fails this assertion.
      expect(maxWobbleMs).toBeLessThan(1)
    })

    it('snaps to the new offset immediately on a large jump, instead of crawling toward it', () => {
      const ctx = makeCtx()
      const perfNow = vi.spyOn(performance, 'now').mockReturnValue(0)
      ctx.currentTime = 0
      const out = createWebAudioOutput(ctx as unknown as AudioContext)
      out.noteOn(midi(60), 100, millis(0)) // establishes the anchor at offset 0

      // A suspend/resume (or a backgrounded tab) jumps the raw offset by
      // several seconds in a single step — deliberately with only a small
      // amount of real time (`performance.now()`) passing between calls, so
      // a slow blend (dt this small -> alpha this small) would barely move
      // the anchor and a naive re-anchor-only-on-a-schedule fix would still
      // be wrong on the very next call.
      perfNow.mockReturnValue(10) // only 10ms of real time passed
      ctx.currentTime = 5.01 // but ctx jumped 5s ahead — raw offset is now -5000

      out.noteOn(midi(64), 100, millis(110)) // 100ms lead on the new "now"
      const actualCtxSeconds = ctx.oscillators.at(-1)?.startedAt.at(-1)

      // Expected: (110 - (-5000)) / 1000 = 5.11 — the new offset applied in
      // full. A slow blend (alpha = 1 - exp(-10/2000) ~= 0.005) would move
      // the anchor by only ~25ms toward -5000, landing near 0.135s instead
      // (and likely clamped up to ctx.currentTime = 5.01s) — nowhere near
      // 5.11s. That is the mutant this test kills: deleting the
      // escape-hatch branch in `updateOffsetAnchor` fails this assertion.
      expect(actualCtxSeconds).toBeCloseTo(5.11, 6)
    })
  })
})
