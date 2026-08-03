/**
 * The MIDI recorder (roadmap 2.10, REQ-3.9.2) — one-tap capture of a practice
 * take, replayable against the score. `app/practice`'s record & replay panel
 * (roadmap 2.14) is the only consumer this ever gets — see ROADMAP.md 2.14 —
 * so this module is deliberately just capture: no notation conversion, no file
 * export.
 *
 * ## Relative time, not absolute time
 *
 * Every event's `time` is milliseconds since `start()`, NOT the `Clock` value it
 * was captured at. A `Clock` is "monotonic since some fixed origin" (see
 * `core/ports/clock.ts`) and that origin is whatever moment the page happened to
 * load — it is not stable across sessions, is not zero at the start of any
 * particular recording, and two recordings in the same session do not share it.
 * Storing the raw `Clock` reading would make a recording replay differently (or
 * not at all, if a later session's clock starts lower) depending on when it
 * happens to be loaded. Subtracting the clock reading at `start()` from every
 * event as it is captured is what makes a `Recording` a self-contained object:
 * it always begins at 0 and always replays the same way, however far into a
 * session it was made.
 *
 * ## Why the recorder does not do the matching itself
 *
 * A `MidiRecorder` only records; it does not judge. `NoteMatcher` already does
 * real-time judging against a score, and mixing the two here would mean every
 * recorded take also has to carry a score and tempo map even when the point is
 * just to capture a free improvisation.
 */
import type { Clock, DateSource, MidiEvent } from '@core/ports/index.ts'
import { invariant } from '@core/shared/invariant.ts'
import { isValidMidi, millis as asMillis, type Midi } from '@core/shared/units.ts'

/** A finished take: every MIDI event, timed from 0 at the moment `start()` was called. */
export type Recording = {
  readonly id: string
  /** The score this take was practising, if any. */
  readonly scoreId?: string
  /** Wall-clock date the recording was made, for the practice log — `DateSource.epochMillis()`. */
  readonly recordedAt: number
  readonly durationMs: number
  readonly events: readonly MidiEvent[]
  /** The tempo it was recorded at, for display; not used to compute anything here. */
  readonly tempoBpm?: number
}

export type RecorderStartOptions = {
  readonly scoreId?: string
  readonly tempoBpm?: number
  /**
   * Defaults to `rec-<recordedAt epoch ms>`. Two recordings started in the same
   * millisecond (only possible with a `DateSource` faked to a fixed value) would
   * otherwise collide — pass an explicit id when that matters to the caller.
   */
  readonly id?: string
}

/**
 * Captures MIDI events as they happen and hands back a `Recording` on `stop()`.
 * Owns no timer of its own: the caller (the MIDI-input adapter) calls `noteOn` /
 * `noteOff` / `sustain` as events arrive, and this class stamps each one from
 * the injected `Clock`, which is what keeps it deterministic under test.
 */
export class MidiRecorder {
  private readonly clock: Clock
  private readonly date: DateSource
  private active = false
  private startClockMs = 0
  private startEpochMs = 0
  private id = ''
  private scoreId: string | undefined
  private tempoBpm: number | undefined
  private events: MidiEvent[] = []
  /** Note-ons not yet matched by a note-off, per pitch — closed at `stop()`. */
  private readonly pendingOpens = new Map<Midi, number>()

  constructor(clock: Clock, date: DateSource) {
    this.clock = clock
    this.date = date
  }

  /** Begin a new take, discarding whatever the previous one (if any) had captured. */
  start(opts: RecorderStartOptions = {}): void {
    this.active = true
    this.startClockMs = this.clock.now()
    this.startEpochMs = this.date.epochMillis()
    this.id = opts.id ?? `rec-${this.startEpochMs}`
    this.scoreId = opts.scoreId
    this.tempoBpm = opts.tempoBpm
    this.events = []
    this.pendingOpens.clear()
  }

  /** Elapsed time since `start()`, in ms — the "relative time" every event is stamped with. */
  private elapsedMs(): number {
    return this.clock.now() - this.startClockMs
  }

  noteOn(note: Midi, velocity: number): void {
    this.requireActive('noteOn')
    invariant(isValidMidi(note), `noteOn: ${note} is not a MIDI note number`)
    invariant(
      Number.isInteger(velocity) && velocity >= 0 && velocity <= 127,
      `noteOn: velocity out of range: ${velocity}`,
    )
    this.events.push({ type: 'noteOn', note, velocity, time: asMillis(this.elapsedMs()) })
    this.pendingOpens.set(note, (this.pendingOpens.get(note) ?? 0) + 1)
  }

  noteOff(note: Midi): void {
    this.requireActive('noteOff')
    invariant(isValidMidi(note), `noteOff: ${note} is not a MIDI note number`)
    this.events.push({ type: 'noteOff', note, time: asMillis(this.elapsedMs()) })
    const open = this.pendingOpens.get(note) ?? 0
    if (open > 0) this.pendingOpens.set(note, open - 1)
  }

  sustain(down: boolean): void {
    this.requireActive('sustain')
    this.events.push({ type: 'sustain', down, time: asMillis(this.elapsedMs()) })
  }

  /**
   * End the take. `undefined` when nothing was started — a no-op stop (a
   * double-tap of a "stop recording" button, say) is not a programmer error.
   * Every pitch still holding an open note-on gets a synthetic note-off at the
   * recording's end, so a `Recording` never carries a dangling press.
   */
  stop(): Recording | undefined {
    if (!this.active) return undefined
    const durationMs = this.elapsedMs()
    for (const [note, count] of this.pendingOpens) {
      for (let i = 0; i < count; i++) {
        this.events.push({ type: 'noteOff', note, time: asMillis(durationMs) })
      }
    }
    const recording: Recording = {
      id: this.id,
      ...(this.scoreId === undefined ? {} : { scoreId: this.scoreId }),
      recordedAt: this.startEpochMs,
      durationMs,
      events: this.events,
      ...(this.tempoBpm === undefined ? {} : { tempoBpm: this.tempoBpm }),
    }
    this.active = false
    this.pendingOpens.clear()
    return recording
  }

  get recording(): boolean {
    return this.active
  }

  private requireActive(method: string): void {
    invariant(this.active, `MidiRecorder.${method}: not recording — call start() first`)
  }
}
