/**
 * The MIDI recorder (roadmap 2.10, REQ-3.9.2) — one-tap capture of a practice
 * take, replayable against the score and exportable as a Standard MIDI File via
 * `recordingToScore` + `writeMidiFile` (`@core/notation/midifile.ts`).
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
 * just to capture a free improvisation. `recordingToScore` is the bridge for
 * when a take needs to become notation (for playback, or for `writeMidiFile`).
 *
 * ## Turning a note stream into notation
 *
 * `recordingToScore` has no hand information — a recording is one MIDI stream,
 * not two hand-tagged tracks — so it uses the same fallback the SMF reader uses
 * when it cannot tell hands apart from track layout (`@core/notation/midifile.ts`):
 * split at middle C, below goes left. It also has no time signature, because
 * nothing in a raw performance states one; it lays a uniform 4/4 grid under the
 * notes and splits any note that would cross a barline into tied fragments, the
 * same rule `Score` enforces everywhere else (see `core/notation/score.ts`).
 *
 * Overlapping presses of the same pitch (a fast repeat, the next note struck
 * before the previous one is released) are paired oldest-note-on-with-oldest-
 * note-off — a FIFO queue per pitch — so a fast repeat produces two adjacent
 * notes rather than one long one or a dropped one; that is the same pairing
 * `parseMidiFile` uses for exactly the same reason.
 *
 * A note-on that never got a matching note-off (the player stopped recording
 * mid-press, or lifted a sustain pedal note after `stop()`) is closed at the
 * recording's end rather than dropped or left unbounded — `MidiRecorder.stop()`
 * already does this for its own output, and `recordingToScore` does it again
 * defensively for any `Recording` handed to it, in case one was reconstructed
 * from storage.
 */
import {
  makeScore,
  measureDurationTicks,
  type Hand,
  type MeasureInput,
  type Score,
  type ScoreNoteInput,
} from '@core/notation/score.ts'
import type { Clock, DateSource, MidiEvent } from '@core/ports/index.ts'
import { invariant } from '@core/shared/invariant.ts'
import { isValidMidi, millis as asMillis, type Midi, type Ticks } from '@core/shared/units.ts'
import { msToTick, type TempoMap } from '@core/timing/tempo.ts'

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

// -------------------------------------------------------------- recordingToScore

export type RecordingToScoreOptions = {
  /** Snap every note's onset to the nearest multiple of this many ticks. */
  readonly quantiseTicks?: Ticks
}

/** A performance a recording is not tagged as: below this pitch is the left hand. */
const MIDDLE_C = 60
const GRID_TIME_SIGNATURE = { beats: 4, beatType: 4 }

type CompletedNote = {
  readonly midi: Midi
  readonly startTick: number
  readonly endTick: number
  readonly velocity: number
}

type HandNote = CompletedNote & { readonly hand: Hand }

/** One matched note-on/note-off pair, in ticks. `endTick` is always `> startTick`. */
function toCompletedNote(
  midi: Midi,
  startMs: number,
  endMs: number,
  velocity: number,
  tempo: TempoMap,
): CompletedNote {
  const startTick = Math.round(msToTick(tempo, asMillis(startMs)))
  const rawEndTick = Math.round(msToTick(tempo, asMillis(endMs)))
  return { midi, startTick, endTick: Math.max(startTick + 1, rawEndTick), velocity }
}

/**
 * Pair every note-on with its note-off (FIFO per pitch, so a fast repeat closes
 * the older press first, not the newer one) and convert onset/end to ticks.
 * Anything still open when the events run out is closed at `recording.durationMs`.
 */
function collectCompletedNotes(recording: Recording, tempo: TempoMap): CompletedNote[] {
  const pending = new Map<Midi, { startMs: number; velocity: number }[]>()
  const notes: CompletedNote[] = []
  for (const e of recording.events) {
    if (e.type === 'noteOn') {
      const queue = pending.get(e.note) ?? []
      queue.push({ startMs: e.time, velocity: e.velocity })
      pending.set(e.note, queue)
    } else if (e.type === 'noteOff') {
      const open = pending.get(e.note)?.shift()
      if (open === undefined) continue
      notes.push(toCompletedNote(e.note, open.startMs, e.time, open.velocity, tempo))
    }
  }
  for (const [note, queue] of pending) {
    for (const open of queue) {
      notes.push(toCompletedNote(note, open.startMs, recording.durationMs, open.velocity, tempo))
    }
  }
  notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi)
  return notes
}

/**
 * Snap onsets to the grid, keeping each note's original length. Rounding to the
 * nearest multiple of `q` is monotonic non-decreasing in the input, so notes
 * that started in order still start in order (ties are possible, never a swap).
 * The length is untouched — never recomputed from a quantised end — so a note
 * that was already `>= 1` tick long (every `CompletedNote` is, by construction)
 * stays that long; quantising can shift a note, never collapse it.
 */
function quantiseNotes(notes: readonly CompletedNote[], q: number): CompletedNote[] {
  return notes.map((n) => {
    const length = n.endTick - n.startTick
    const startTick = Math.round(n.startTick / q) * q
    return { ...n, startTick, endTick: startTick + length }
  })
}

/**
 * Cut a note at every barline it crosses, joining the pieces with ties — the
 * same rule `parseMidiFile` applies (`@core/notation/midifile.ts`), because the
 * score model has the same requirement here: a note may not cross a barline.
 */
function splitNoteAtBars(note: HandNote, barTicks: number): ScoreNoteInput[] {
  const out: ScoreNoteInput[] = []
  let start = note.startTick
  for (;;) {
    const barEnd = (Math.floor(start / barTicks) + 1) * barTicks
    const segmentEnd = Math.min(note.endTick, barEnd)
    const tiedTo = segmentEnd < note.endTick
    out.push({
      midi: note.midi,
      startTick: start,
      durationTicks: Math.max(1, segmentEnd - start),
      hand: note.hand,
      velocity: note.velocity,
      tiedFrom: out.length > 0,
      tiedTo,
    })
    if (!tiedTo) return out
    start = barEnd
  }
}

/**
 * Turn a recorded take into a `Score`, so it can be shown against the notation
 * or written out with `writeMidiFile`. `tempo` supplies both the tick <-> ms
 * conversion used to place the notes and the tempo marks the resulting score is
 * built with — pass the map the take was actually played against (or a fresh
 * `makeTempoMap` at the intended playback tempo for a free improvisation).
 *
 * `opts.quantiseTicks`, when given, snaps every onset to that grid; omit it to
 * keep the performance exactly as played.
 */
export function recordingToScore(
  recording: Recording,
  tempo: TempoMap,
  opts: RecordingToScoreOptions = {},
): Score {
  const q = opts.quantiseTicks
  if (q !== undefined) {
    invariant(Number.isInteger(q) && q > 0, `recordingToScore: quantiseTicks must be > 0, got ${q}`)
  }

  const completed = collectCompletedNotes(recording, tempo)
  const quantised = q === undefined ? completed : quantiseNotes(completed, q)
  const notes: HandNote[] = quantised.map((n) => ({
    ...n,
    hand: n.midi >= MIDDLE_C ? 'right' : 'left',
  }))

  const barTicks = measureDurationTicks(GRID_TIME_SIGNATURE)
  const lastNoteEndTick = notes.reduce((max, n) => Math.max(max, n.endTick), 0)
  const recordedTicks = Math.max(1, Math.round(msToTick(tempo, asMillis(recording.durationMs))))
  const totalTicks = Math.max(lastNoteEndTick, recordedTicks)
  const measureCount = Math.max(1, Math.ceil(totalTicks / barTicks))
  const measures: MeasureInput[] = Array.from({ length: measureCount }, () => ({}))

  return makeScore({
    id: recording.id,
    meta: { title: `Recording ${recording.id}`, composer: '', source: 'recording' },
    measures,
    notes: notes.flatMap((n) => splitNoteAtBars(n, barTicks)),
    tempos: tempo.marks.map((m) => ({ tick: m.tick, bpm: m.bpm })),
  })
}

// -------------------------------------------------------------------- replay

/**
 * Events whose `time` falls inside `[fromMs, toMs]` (both ends included, so a
 * scrubber that windows on an event's own timestamp does not lose it). Defaults
 * to the whole recording. `recording.events` is always in non-decreasing `time`
 * order — every event is stamped from the same monotonic `Clock` as it happens —
 * so this is a single linear pass.
 */
export function replayEvents(
  recording: Recording,
  fromMs = asMillis(0),
  toMs = asMillis(recording.durationMs),
): readonly MidiEvent[] {
  invariant(fromMs <= toMs, `replayEvents: fromMs (${fromMs}) must be <= toMs (${toMs})`)
  return recording.events.filter((e) => e.time >= fromMs && e.time <= toMs)
}
