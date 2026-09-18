/**
 * Synthesized `DrumAudioOutput` (DR-06, roadmap T.32) — replaces the piano's
 * pitched triangle blip the Groove trainer used to play through every pad,
 * which made an open and closed hi-hat sound identical. See
 * `core/ports/drumAudio.ts`'s module comment for the port contract this
 * implements, in particular the open-hi-hat choke rule this module owns:
 * `hhOpen` rings until the next `hhClosed`/`hhPedal`/`hhOpen` strike on this
 * output — scheduled ahead or arriving live — never released by a wall-clock
 * timer (a fixed release length is wrong at speed: 240ms at 200bpm covers
 * the next three strokes the staff draws under it).
 *
 * `atMs` epoch handling mirrors `webaudio.ts`: every `atMs` is on the
 * `Clock` epoch (`performance.now()`), never `ctx.currentTime`, and the
 * offset between the two is re-measured on every public call and folded
 * into a slow running estimate — not captured once — for exactly the reason
 * `webaudio.ts`'s module comment gives: a frozen offset drifts as the
 * `AudioContext` hardware clock runs at a different rate than
 * `performance.now()`. (This module's task brief paraphrased `webaudio.ts`'s
 * approach as "capture the offset once", which undersells what that module
 * actually does — a genuine one-shot capture would reproduce the exact drift
 * bug its own comment documents. This mirrors `webaudio.ts`'s real
 * behaviour, the continuously-corrected anchor, not the paraphrase; flagged
 * rather than silently resolved.)
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { DrumAudioOutput } from '@core/ports/drumAudio.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import {
  buildNoiseBuffer,
  playNoiseVoice,
  playToneVoice,
  velocityToGain,
  type Engine,
  type Voice,
} from './drumVoices.ts'

export type DrumSynthOptions = {
  /**
   * Builds the `AudioContext`. Called lazily, on the first `strike`/`click`
   * — never at construction — so the context is created inside whatever
   * user gesture triggered the first sound (browsers refuse one otherwise).
   */
  readonly context: () => AudioContext
}

/** How long the choke ramp on a released open hat takes. Exported for the test's own timing assertions. */
export const CHOKE_RAMP_S = 0.02
/** Slack after the choke ramp reaches 0 before the source node is actually stopped. */
const CHOKE_STOP_TAIL_S = 0.005

const CLICK_DURATION_S = 0.035
const CLICK_FREQUENCY_HZ = 1500
const ACCENTED_CLICK_FREQUENCY_HZ = 2200
const CLICK_PEAK_GAIN = 0.5
const ACCENTED_CLICK_PEAK_GAIN = 0.8
/** `exponentialRampToValueAtTime` can never target exactly 0. */
const CLICK_RAMP_FLOOR = 0.0001

// Same offset-anchor filter as `webaudio.ts` — see that module's comment for
// the derivation of both constants.
const OFFSET_TIME_CONSTANT_MS = 2000
const OFFSET_RESNAP_THRESHOLD_MS = 250

type OpenHatVoice = {
  readonly voice: Voice
  readonly startSec: number
}

function isHiHatEvent(pad: MappedDrumPad): boolean {
  return pad === 'hhClosed' || pad === 'hhPedal' || pad === 'hhOpen'
}

/**
 * Exhaustive over `MappedDrumPad` (no `default`): adding a pad without a
 * case here is a compile error, not a silent gap in the kit.
 */
function buildVoices(engine: Engine, pad: MappedDrumPad, startSec: number, velocity: number): Voice[] {
  const g = velocityToGain(velocity)
  switch (pad) {
    case 'kick':
      return [
        playToneVoice(engine, {
          startSec,
          peakGain: 0.9 * g,
          waveform: 'sine',
          freq: 150,
          freqTo: 50,
          sweepS: 0.1,
          decayS: 0.25,
        }),
      ]
    case 'hhPedal':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.25 * g,
          filterType: 'highpass',
          filterFreq: 7000,
          decayS: 0.05,
        }),
      ]
    case 'tomFloor':
      return [
        playToneVoice(engine, {
          startSec,
          peakGain: 0.8 * g,
          waveform: 'sine',
          freq: 180,
          freqTo: 90,
          sweepS: 0.05,
          decayS: 0.3,
        }),
      ]
    case 'tomMid':
      return [
        playToneVoice(engine, {
          startSec,
          peakGain: 0.8 * g,
          waveform: 'sine',
          freq: 220,
          freqTo: 110,
          sweepS: 0.05,
          decayS: 0.3,
        }),
      ]
    case 'snare':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.7 * g,
          filterType: 'bandpass',
          filterFreq: 1800,
          filterQ: 0.7,
          decayS: 0.15,
        }),
        playToneVoice(engine, {
          startSec,
          peakGain: 0.4 * g,
          waveform: 'triangle',
          freq: 180,
          decayS: 0.05,
        }),
      ]
    case 'snareRim':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.9 * g,
          filterType: 'bandpass',
          filterFreq: 2200,
          filterQ: 0.7,
          decayS: 0.08,
        }),
        playToneVoice(engine, {
          startSec,
          peakGain: 0.5 * g,
          waveform: 'triangle',
          freq: 220,
          decayS: 0.03,
        }),
      ]
    case 'crossStick':
      return [
        playToneVoice(engine, {
          startSec,
          peakGain: 0.6 * g,
          waveform: 'triangle',
          freq: 800,
          decayS: 0.02,
        }),
      ]
    case 'tomHigh':
      return [
        playToneVoice(engine, {
          startSec,
          peakGain: 0.8 * g,
          waveform: 'sine',
          freq: 300,
          freqTo: 150,
          sweepS: 0.05,
          decayS: 0.3,
        }),
      ]
    case 'hhClosed':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.5 * g,
          filterType: 'highpass',
          filterFreq: 7000,
          decayS: 0.05,
        }),
      ]
    case 'hhOpen':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.5 * g,
          filterType: 'highpass',
          filterFreq: 7000,
          decayS: 1.5,
        }),
      ]
    case 'rideBow':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.5 * g,
          filterType: 'bandpass',
          filterFreq: 3000,
          filterQ: 1,
          decayS: 0.6,
        }),
      ]
    case 'rideBell':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.7 * g,
          filterType: 'bandpass',
          filterFreq: 5000,
          filterQ: 2,
          decayS: 0.25,
        }),
      ]
    case 'rideEdge':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.5 * g,
          filterType: 'bandpass',
          filterFreq: 4000,
          filterQ: 1,
          decayS: 1.5,
        }),
      ]
    case 'crash1':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.6 * g,
          filterType: 'highpass',
          filterFreq: 4000,
          decayS: 1.5,
        }),
      ]
    case 'crash2':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.6 * g,
          filterType: 'highpass',
          filterFreq: 4500,
          decayS: 1.5,
        }),
      ]
    case 'splash':
      return [
        playNoiseVoice(engine, {
          startSec,
          peakGain: 0.55 * g,
          filterType: 'highpass',
          filterFreq: 6000,
          decayS: 0.5,
        }),
      ]
  }
}

/**
 * The gain a voice's own attack/decay envelope would hold at `atSec`, had it
 * never been touched — linear interpolation across whichever ramp `atSec`
 * falls in, clamped to `[0, voice.peakGain]`. This is what a choke (or any
 * other early cut) must pin with `setValueAtTime` before cancelling the
 * scheduled ramp, or the cancel silently reverts the AudioParam to its last
 * explicit target (the attack's start-of-ramp value) instead of wherever the
 * envelope had actually decayed to.
 */
function envelopeValueAt(voice: Voice, atSec: number): number {
  if (atSec <= voice.startSec) return 0
  if (atSec < voice.attackEndSec) {
    const span = voice.attackEndSec - voice.startSec
    return span > 0 ? voice.peakGain * ((atSec - voice.startSec) / span) : voice.peakGain
  }
  if (atSec >= voice.decayEndSec) return 0
  const span = voice.decayEndSec - voice.attackEndSec
  return span > 0 ? voice.peakGain * ((voice.decayEndSec - atSec) / span) : 0
}

/**
 * Cap on how many times a throwing `context()` factory is retried, one per
 * `strike`/`click` call. A transient refusal (the browser's per-page
 * `AudioContext` construction cap, momentarily exceeded) must not mute drums
 * for the rest of the session — but an environment that will never succeed
 * (no Web Audio at all) should not retry forever either.
 */
const MAX_ENGINE_CONSTRUCTION_ATTEMPTS = 5

/**
 * Build a Web Audio-backed `DrumAudioOutput`. The `AudioContext` is created
 * lazily from the injected `context()` thunk on the first `strike`/`click`.
 * Structural typing on `AudioContext` (as `webaudio.ts` relies on) is what
 * lets a test hand in a fake instead of a real one.
 */
export function createDrumSynth(opts: DrumSynthOptions): DrumAudioOutput {
  let engine: Engine | undefined
  let engineConstructionAttempts = 0
  let pendingVolume = 1

  let offsetAnchorMs = 0
  let lastAnchorUpdateMs = 0

  let liveVoices: Voice[] = []
  let openHatVoices: OpenHatVoice[] = []
  /**
   * `startSec` of every hi-hat event (`isHiHatEvent`) `strike()` has
   * scheduled, whether already sounded or still ahead — this is what lets a
   * live/late-registering `hhOpen` find a hi-hat event that was scheduled
   * ahead of it but arrives (in ctx time) before it, which `chokeOpenHats`
   * alone cannot: that function only walks *already-registered* open-hat
   * voices at the chokER's call time, so a choker scheduled ahead of an
   * `hhOpen` that has not been struck yet has nothing to choke when it runs.
   * Pruned of stale (past) entries on every `strike()` call — see the prune
   * below — so this cannot grow unbounded over a long session.
   */
  let pendingHiHatSec: number[] = []

  function removeLiveVoice(voice: Voice): void {
    const i = liveVoices.indexOf(voice)
    if (i !== -1) liveVoices.splice(i, 1)
    const j = openHatVoices.findIndex((v) => v.voice === voice)
    if (j !== -1) openHatVoices.splice(j, 1)
  }

  /** Re-measure the raw Clock/ctx offset and fold it into the running anchor — see the module comment. */
  function updateOffsetAnchor(ctx: AudioContext): number {
    const nowMs = performance.now()
    const rawOffsetMs = nowMs - ctx.currentTime * 1000
    const dtMs = nowMs - lastAnchorUpdateMs
    if (Math.abs(rawOffsetMs - offsetAnchorMs) > OFFSET_RESNAP_THRESHOLD_MS) {
      offsetAnchorMs = rawOffsetMs
    } else {
      const alpha = 1 - Math.exp(-dtMs / OFFSET_TIME_CONSTANT_MS)
      offsetAnchorMs += alpha * (rawOffsetMs - offsetAnchorMs)
    }
    lastAnchorUpdateMs = nowMs
    return offsetAnchorMs
  }

  /** Clock-epoch `atMs` -> `ctx.currentTime` seconds, under a given anchor. */
  function toCtxSeconds(clockMs: number, anchorMs: number, ctx: AudioContext): number {
    const seconds = (clockMs - anchorMs) / 1000
    // Never hand Web Audio a time in the past — see `webaudio.ts`'s
    // `toCtxSeconds` for why: one throw here would take a whole scheduled
    // preview down with it.
    return Math.max(ctx.currentTime, seconds)
  }

  /**
   * Lazily builds the engine, retrying a throwing `context()` thunk on every
   * subsequent call rather than latching the failure permanently — a
   * browser refusing a new `AudioContext` outside a gesture, or momentarily
   * past its construction cap, is typically transient, and a single failed
   * attempt must not mute drums for the rest of the session. Retries are
   * capped at `MAX_ENGINE_CONSTRUCTION_ATTEMPTS`: an environment that will
   * never succeed (no Web Audio at all) should stop trying rather than pay
   * the cost of a doomed `new AudioContext()` on every strike forever.
   *
   * Contract note: `webaudio.ts` itself takes an already-built `ctx` as a
   * parameter and has no posture on this failure mode at all, and
   * `app/practice/createDefaultAudioOutput.ts`'s lazy `new AudioContext()`
   * call is not defended either — a construction failure there propagates
   * to the caller (that module's own comment names this as a real, if rare,
   * failure mode: "the next construction past that cap throws inside the
   * click handler"). This module is deliberately stricter than either,
   * because the task's own test requirement is unambiguous that a throwing
   * context must never escape `strike`/`click` — flagged here rather than
   * silently reconciled with "mirror webaudio.ts's posture".
   */
  function getEngine(): Engine | undefined {
    if (engine !== undefined) return engine
    if (engineConstructionAttempts >= MAX_ENGINE_CONSTRUCTION_ATTEMPTS) return undefined
    engineConstructionAttempts++
    try {
      const ctx = opts.context()
      const masterGain = ctx.createGain()
      masterGain.gain.setValueAtTime(pendingVolume, ctx.currentTime)
      masterGain.connect(ctx.destination)
      const noiseBuffer = buildNoiseBuffer(ctx)
      const constructionMs = performance.now()
      offsetAnchorMs = constructionMs - ctx.currentTime * 1000
      lastAnchorUpdateMs = constructionMs
      // A context built from a MIDI-event-driven first strike (no click/tap
      // for the browser to treat as a user gesture) can start `suspended`
      // and stay silent forever without an explicit resume — see
      // `ensureRunning`, called again per-call below in case this promise
      // has not settled by the next strike.
      ensureRunning(ctx)
      engine = { ctx, masterGain, noiseBuffer }
      return engine
    } catch {
      return undefined
    }
  }

  /** Cheap on a running context; nudges a suspended one back to life. */
  function ensureRunning(ctx: AudioContext): void {
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
  }

  /**
   * Releases one open-hat voice at `atSec`: pins its true envelope value
   * before cancelling the in-flight ramp (see the inline comment this
   * replaces, preserved below), ramps to 0 over `CHOKE_RAMP_S`, then stops
   * the source shortly after. Shared by `chokeOpenHats` (choking an
   * already-registered voice when a later hi-hat event arrives) and
   * `strike`'s `hhOpen` registration path (choking a brand-new voice
   * immediately, when a hi-hat event already pending ahead of it will
   * release it before it would otherwise ring).
   *
   * `cancelScheduledValues` deletes the in-flight attack/decay ramp
   * outright — without pinning the envelope's actual value at `atSec` first,
   * the choke ramp below starts from whatever value the AudioParam happens
   * to hold (its last explicit target, i.e. the attack peak), not from where
   * the decay had actually reached. That turns a mid-ring choke into an
   * audible discontinuity, and a choke scheduled well into the decay into a
   * fade that runs the full choke... from full volume over CHOKE_RAMP_S.
   * Same pattern `webaudio.ts`'s `noteOff` uses for exactly this reason.
   */
  function chokeVoiceAt(ohv: OpenHatVoice, atSec: number): void {
    const pinnedGain = envelopeValueAt(ohv.voice, atSec)
    ohv.voice.gain.gain.cancelScheduledValues(atSec)
    ohv.voice.gain.gain.setValueAtTime(pinnedGain, atSec)
    ohv.voice.gain.gain.linearRampToValueAtTime(0, atSec + CHOKE_RAMP_S)
    ohv.voice.source.stop(atSec + CHOKE_RAMP_S + CHOKE_STOP_TAIL_S)
  }

  /**
   * The choke rule (`core/ports/drumAudio.ts`'s module comment): every open
   * hat that started before `atSec` is released now (see `chokeVoiceAt`). A
   * voice not yet started by `atSec` (a strike scheduled out of order) is
   * left alone — it has not rung yet, so there is nothing to release.
   *
   * This only reaches voices already in `openHatVoices` at call time — the
   * case where the hi-hat event doing the choking was scheduled *ahead* of
   * an `hhOpen` that has not been struck yet is handled separately, at the
   * `hhOpen` registration site in `strike`, via `pendingHiHatSec`.
   */
  function chokeOpenHats(atSec: number): void {
    const remaining: OpenHatVoice[] = []
    for (const ohv of openHatVoices) {
      if (ohv.startSec < atSec) {
        chokeVoiceAt(ohv, atSec)
      } else {
        remaining.push(ohv)
      }
    }
    openHatVoices = remaining
  }

  function strike(pad: MappedDrumPad, velocity: number, atMs?: Millis): void {
    // Velocity 0 is MIDI note-off, not a silent hit: building and starting a
    // full (inaudible) voice chain for it, and registering hhOpen bookkeeping
    // that then sits around waiting to be choked, is pure waste.
    if (velocity <= 0) return
    const eng = getEngine()
    if (eng === undefined) return
    ensureRunning(eng.ctx)
    try {
      // Entries that can no longer choke anything new (their instant has
      // already passed on the ctx clock) are pruned on every call — see
      // `pendingHiHatSec`'s own comment.
      pendingHiHatSec = pendingHiHatSec.filter((t) => t >= eng.ctx.currentTime)
      const startSec =
        atMs === undefined
          ? eng.ctx.currentTime
          : toCtxSeconds(atMs, updateOffsetAnchor(eng.ctx), eng.ctx)
      if (isHiHatEvent(pad)) {
        pendingHiHatSec.push(startSec)
        chokeOpenHats(startSec)
      }
      const voices = buildVoices(eng, pad, startSec, velocity)
      for (const voice of voices) {
        liveVoices.push(voice)
        voice.source.onended = () => {
          removeLiveVoice(voice)
          try {
            voice.gain.disconnect()
          } catch {
            // best-effort cleanup only — a node already disconnected (e.g.
            // by allNotesOff racing this callback) must not throw here.
          }
        }
        if (pad === 'hhOpen') {
          const ohv: OpenHatVoice = { voice, startSec }
          // A hi-hat event already pending strictly after this voice's own
          // start (scheduled ahead, e.g. the groove trainer's muted-hat
          // pre-schedule, or a live one that just happened to be struck
          // first) releases it right away, at that instant — see this
          // module's header comment and `pendingHiHatSec`'s own comment for
          // why `chokeOpenHats` alone cannot catch this ordering. A hat at
          // the exact same instant is a unison, not a release: left alone.
          const futureHiHatSec = pendingHiHatSec.filter((t) => t > startSec)
          if (futureHiHatSec.length > 0) {
            chokeVoiceAt(ohv, Math.min(...futureHiHatSec))
          } else {
            openHatVoices.push(ohv)
          }
        }
      }
    } catch {
      // A node-creation call throwing mid-strike must not escape — see
      // `getEngine`'s comment on this module's error posture.
    }
  }

  function click(accented: boolean, atMs?: Millis, clickGain = 1): void {
    // gain <= 0 schedules nothing — see `core/ports/drumAudio.ts`'s module
    // comment. Checked before `getEngine()` so a fully-muted subdivision
    // click never forces the `AudioContext` into existence either.
    if (!(clickGain > 0)) return
    const clampedGain = Math.min(1, clickGain)
    const eng = getEngine()
    if (eng === undefined) return
    ensureRunning(eng.ctx)
    try {
      const startSec =
        atMs === undefined
          ? eng.ctx.currentTime
          : toCtxSeconds(atMs, updateOffsetAnchor(eng.ctx), eng.ctx)
      const freq = accented ? ACCENTED_CLICK_FREQUENCY_HZ : CLICK_FREQUENCY_HZ
      const peak = (accented ? ACCENTED_CLICK_PEAK_GAIN : CLICK_PEAK_GAIN) * clampedGain

      const oscillator = eng.ctx.createOscillator()
      oscillator.type = 'square'
      oscillator.frequency.setValueAtTime(freq, startSec)

      const gain = eng.ctx.createGain()
      gain.gain.setValueAtTime(0, startSec)
      gain.gain.linearRampToValueAtTime(peak, startSec + 0.001)
      gain.gain.exponentialRampToValueAtTime(CLICK_RAMP_FLOOR, startSec + CLICK_DURATION_S)
      gain.gain.setValueAtTime(0, startSec + CLICK_DURATION_S)

      oscillator.connect(gain)
      gain.connect(eng.masterGain)
      oscillator.start(startSec)
      oscillator.stop(startSec + CLICK_DURATION_S)

      const voice: Voice = {
        source: oscillator,
        gain,
        startSec,
        stopSec: startSec + CLICK_DURATION_S,
        attackEndSec: startSec + 0.001,
        peakGain: peak,
        decayEndSec: startSec + CLICK_DURATION_S,
      }
      liveVoices.push(voice)
      oscillator.onended = () => {
        removeLiveVoice(voice)
        try {
          gain.disconnect()
        } catch {
          // see strike()'s onended comment
        }
      }
    } catch {
      // see strike()'s comment
    }
  }

  function allNotesOff(): void {
    if (engine !== undefined) {
      const atSec = engine.ctx.currentTime
      for (const voice of liveVoices) {
        try {
          // Cut every voice, including one whose `start(atMs)` is still in
          // the future — stopping before a node's own start time means it
          // never sounds at all, exactly what a panic needs. The try/catch
          // is per-voice, not around the whole loop: one throwing stop()
          // must not leave every voice after it in the list still ringing.
          voice.gain.gain.cancelScheduledValues(atSec)
          voice.gain.gain.setValueAtTime(0, atSec)
          voice.source.stop(atSec)
        } catch {
          // see strike()'s comment
        }
      }
    }
    liveVoices = []
    openHatVoices = []
    pendingHiHatSec = []
  }

  function setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    pendingVolume = clamped
    // Deliberately does not force-build the engine: a volume slider touched
    // before any sound has ever played should not be what constructs the
    // `AudioContext` outside a gesture. `pendingVolume` is applied as soon
    // as `getEngine` does build one.
    if (engine === undefined) return
    try {
      engine.masterGain.gain.setValueAtTime(clamped, engine.ctx.currentTime)
    } catch {
      // see strike()'s comment
    }
  }

  function now(): Millis {
    if (engine === undefined) return millis(performance.now())
    try {
      return millis(updateOffsetAnchor(engine.ctx) + engine.ctx.currentTime * 1000)
    } catch {
      return millis(performance.now())
    }
  }

  return { strike, click, allNotesOff, setVolume, now }
}
