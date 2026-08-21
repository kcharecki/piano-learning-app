/**
 * The transport — the playback engine (roadmap 1.10, REQ-3.2.2, REQ-3.2.3).
 *
 * A pure, clock-driven state machine. It does NOT own a timer: the caller pumps
 * `tick()` from rAF or from an audio scheduler, and gets back everything that
 * happened since the previous pump, in musical order. That inversion is the
 * whole design:
 *  - a dropped frame cannot drop a note — a single late pump replays the entire
 *    gap, so "the browser stalled for 400 ms" costs latency, never notes;
 *  - the suite can advance a FakeClock by hand and assert to the tick.
 *
 * Two conventions worth knowing before reading on:
 *
 *  1. **The playhead moves only inside `tick()`.** `positionTicks` reports what
 *     the last pump processed, never a live extrapolation of the clock. That is
 *     what keeps position, loop wrapping and the event stream from ever
 *     disagreeing (a live playhead would run past `endTick` while the events
 *     stopped at it). Wall time that elapses while paused, held, or simply not
 *     pumped is discarded at the next state change, never replayed.
 *
 *  2. **Ties are not merged.** A note carrying `tiedFrom` still gets its own
 *     `noteOn`, because the transport reports the score as written and the score
 *     model splits a sustain at the barline. The audio adapter (which knows about
 *     legato re-articulation) and the matcher (which knows a tie expects no key
 *     press) are the ones that care; keeping it here would make "every note
 *     sounds exactly once" — the property that catches transport bugs — untrue.
 *
 *  3. **Three things can stop the playhead**, all of them checked inside `tick()`:
 *     the end of the written music (or the loop end, which wraps instead), a wait
 *     gate (`holdUntil`), and a barrier (`setBarrier`). A gate freezes the playhead
 *     wherever the last pump left it; a barrier freezes it on an exact tick, having
 *     emitted everything up to and including that tick. Wall time that elapses
 *     against either is discarded, never replayed.
 *
 * Event ordering inside one pump: by tick, and at an equal tick
 * `measure` → `noteOff` → `noteOn`, so a bar line is announced before the notes
 * on it and a release never lands after the next attack. A zero-length note is
 * the one exception: its `noteOff` follows its own `noteOn` immediately — ahead of
 * any other attack on that tick — because a release must never precede its attack.
 */
import { type Score, type ScoreNote } from '@core/notation/score.ts'
import { measureAtTick, notesInRange, scoreDurationTicks } from '@core/notation/scoreQueries.ts'
import type { Clock } from '@core/ports/index.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import {
  millis as asMillis,
  ticks as asTicks,
  TICKS_PER_QUARTER,
  type Millis,
  type Ticks,
} from '@core/shared/units.ts'
import { beatsToTicks, msToTick, tickToMs, withScale, type TempoMap } from './tempo.ts'

export type TransportState = 'stopped' | 'playing' | 'paused' | 'waiting'

/** Half-open: `startTick` sounds, `endTick` does not — it is where the wrap happens. */
export type LoopRange = { readonly startTick: Ticks; readonly endTick: Ticks }

/**
 * Shortest loop the transport will play: a demisemiquaver (a 32nd note).
 *
 * A loop is a musical gesture, and nothing shorter than a 32nd note is one —
 * below that the wrap stops being audible as a repeat and becomes a buzz. It is
 * also what keeps the cost of a pump bounded: one pump replays every wrap it
 * spans, so the event count is `elapsed / loopLength`, which runs away as the
 * range shrinks (a one-tick loop turns a single stalled frame into a six-figure
 * event array). `setLoop` widens a shorter range rather than refusing it.
 */
export const MIN_LOOP_TICKS = TICKS_PER_QUARTER / 8

export type TransportEvent =
  | { type: 'noteOn'; note: ScoreNote }
  | { type: 'noteOff'; note: ScoreNote }
  | { type: 'measure'; index: number }
  | { type: 'loop'; iteration: number }
  | { type: 'end' }

export type TransportOptions = {
  readonly score: Score
  readonly tempo: TempoMap
  readonly clock: Clock
  readonly loop?: LoopRange
  /** Quarter-note beats of silent lead-in before a fresh `play()`. */
  readonly countInBeats?: number
}

/** Play/pause axis, kept separate from the wait gate — `state` combines the two. */
type RunState = 'stopped' | 'paused' | 'running'

/**
 * Sort ranks for events landing on the same tick. A zero-length note's release
 * shares the `noteOn` rank and is pushed straight after its own attack, so the
 * pair stays adjacent even when other notes attack on the same tick.
 */
const RANK = { measure: 0, noteOff: 1, noteOn: 2 } as const

type Timed = {
  readonly tick: number
  readonly rank: number
  readonly seq: number
  readonly event: TransportEvent
}

export class Transport {
  private readonly score: Score
  private readonly clock: Clock
  /** End of the written music; where playback stops when no loop is set. */
  private readonly finalTick: number
  private readonly countInTicks: number
  private tempo: TempoMap
  private loopRange: LoopRange | null = null
  private runState: RunState = 'stopped'
  private posTick = 0
  /** Clock reading at which the playhead would be at tick 0 of the tempo map. */
  private originMs = 0
  /** Lowest tick not yet emitted, and whether an event exactly on it still counts. */
  private nextFrom = 0
  private nextFromInclusive = true
  /** Bumped every time the cursor is rewound by hand; see `cursorGeneration`. */
  private cursorGen = 0
  private iteration = 0
  private countInEndTick: number | null = null
  /** Tick the playhead must stop on, inclusive; `null` when nothing is armed. */
  private barrier: number | null = null
  /** True once a pump has parked on the barrier — from then on wall time is discarded. */
  private atBarrier = false
  private hold: (() => boolean) | null = null
  private readonly held = new Map<string, ScoreNote>()
  /** Releases queued by `stop`/`seek`, handed out by the next pump. */
  private pending: TransportEvent[] = []

  constructor(options: TransportOptions) {
    this.score = options.score
    this.clock = options.clock
    this.tempo = options.tempo
    this.finalTick = scoreDurationTicks(options.score)
    const beats = options.countInBeats ?? 0
    invariant(
      Number.isFinite(beats) && beats >= 0,
      `countInBeats must be a finite count >= 0, got ${beats}`,
    )
    this.countInTicks = beatsToTicks(beats)
    if (options.loop !== undefined) this.setLoop(options.loop)
  }

  // ------------------------------------------------------------------ queries

  get state(): TransportState {
    if (this.runState === 'stopped') return 'stopped'
    if (this.runState === 'paused') return 'paused'
    return this.hold === null ? 'playing' : 'waiting'
  }

  /** Negative during a count-in — the lead-in sits before the first written tick. */
  get positionTicks(): Ticks {
    return asTicks(this.posTick)
  }

  get positionMs(): Millis {
    return tickToMs(this.tempo, this.positionTicks)
  }

  /** Index of the measure under the playhead; clamped during a count-in and at the end. */
  get currentMeasure(): number {
    const measure = measureAtTick(this.score, this.positionTicks)
    if (measure !== undefined) return measure.index
    return this.posTick < 0 ? 0 : this.score.measures.length - 1
  }

  /** End of the written music, in ticks. */
  get endTick(): Ticks {
    return asTicks(this.finalTick)
  }

  get loop(): LoopRange | null {
    return this.loopRange
  }

  /** Completed loop passes since the range was set; the `loop` event carries the same number. */
  get loopIteration(): number {
    return this.iteration
  }

  get tempoMap(): TempoMap {
    return this.tempo
  }

  /** Notes whose `noteOn` has been emitted and whose `noteOff` has not. */
  get soundingNotes(): readonly ScoreNote[] {
    return [...this.held.values()]
  }

  get isCountingIn(): boolean {
    return this.countInEndTick !== null
  }

  /** The tick the playhead is not allowed past, or `null`. See `setBarrier`. */
  get barrierTick(): Ticks | null {
    return this.barrier === null ? null : asTicks(this.barrier)
  }

  /** True once a pump has parked the playhead exactly on the armed barrier. */
  get isAtBarrier(): boolean {
    return this.atBarrier
  }

  /**
   * Counts the times the cursor has been rewound by hand — `stop`, either seek,
   * and the restart `play()` does at the end of the piece. Everything already
   * emitted from the destination on is unspent again, so a caller tracking what
   * the transport has played (wait mode) must forget it.
   *
   * The position alone cannot say that: seeking to the tick the playhead is
   * already parked on rewinds the cursor without moving the playhead one bit,
   * and that is the ordinary "play me that note again" gesture.
   */
  get cursorGeneration(): number {
    return this.cursorGen
  }

  // ---------------------------------------------------------------- transport

  play(): void {
    if (this.runState === 'running') return
    const fresh = this.runState === 'stopped'
    // Pressing play at the end of the piece restarts it rather than doing nothing.
    if (fresh && this.loopRange === null && this.posTick >= this.finalTick) this.moveTo(0)
    this.runState = 'running'
    if (fresh && this.countInTicks > 0) {
      this.countInEndTick = this.posTick
      this.posTick -= this.countInTicks
    }
    this.reanchor()
  }

  /** Freeze where the last pump left the playhead. Held notes stay held. */
  pause(): void {
    if (this.runState !== 'running') return
    this.runState = 'paused'
  }

  /** Full reset: release everything and rewind to the loop start, or to 0. */
  stop(): void {
    this.releaseHeldInto(this.pending)
    this.runState = 'stopped'
    this.hold = null
    this.barrier = null
    this.iteration = 0
    this.countInEndTick = null
    this.moveTo(this.loopRange?.startTick ?? 0)
  }

  /** Jump the playhead, clamped to `[0, endTick]`. Anything sounding is released. */
  seekTick(tick: Ticks): void {
    invariant(Number.isFinite(tick), `seekTick: ${tick} is not a finite tick`)
    this.releaseHeldInto(this.pending)
    this.countInEndTick = null
    this.moveTo(Math.min(this.finalTick, Math.max(0, tick)))
  }

  /** Jump to the start of a measure; the index is truncated and clamped to the score. */
  seekMeasure(index: number): void {
    invariant(Number.isFinite(index), `seekMeasure: ${index} is not a finite index`)
    const last = this.score.measures.length - 1
    const clamped = Math.min(last, Math.max(0, Math.trunc(index)))
    this.seekTick(at(this.score.measures, clamped).startTick)
  }

  /**
   * Set or clear the loop (REQ-3.2.3) and restart the iteration count. The
   * playhead is left alone: before the range it plays in, past the range it wraps
   * on the next pump.
   *
   * The end is clamped into the score, exactly as `seekTick` clamps: a drag that
   * runs off the last bar loops to the end of the piece. Left unclamped, a loop
   * end past `endTick` is a boundary the playhead can never reach, so playback
   * would run into the silence past the final bar and neither wrap nor ever emit
   * `end`. A range that starts at or after `endTick` contains no music at all and
   * cannot be repaired by clamping — where would it go? — so it throws, the same
   * treatment an empty or backwards range gets.
   *
   * Clamping the end can leave a range far shorter than the drag that made it —
   * a selection anchored a few ticks before the double bar clamps to a fraction
   * of a beat — so the result is widened to `MIN_LOOP_TICKS`, backwards from the
   * end first (the end is where the wrap is heard) and then forwards, never past
   * the score. Unlike a range with no music in it this one CAN be repaired, and
   * a UI control that produces a buzz is a UI bug: playing the nearest real loop
   * beats both throwing and grinding out thousands of wraps per frame.
   */
  setLoop(range: LoopRange | null): void {
    if (range === null) {
      this.loopRange = null
      this.iteration = 0
      return
    }
    invariant(
      Number.isFinite(range.startTick) && range.startTick >= 0,
      `loop start must be a finite tick >= 0, got ${range.startTick}`,
    )
    invariant(
      Number.isFinite(range.endTick) && range.endTick > range.startTick,
      `loop end ${range.endTick} must be after loop start ${range.startTick}`,
    )
    invariant(
      range.startTick < this.finalTick,
      `loop start ${range.startTick} is at or past the end of the score (${this.finalTick})`,
    )
    const clampedEnd = Math.min(this.finalTick, range.endTick)
    const startTick = Math.min(range.startTick, Math.max(0, clampedEnd - MIN_LOOP_TICKS))
    const endTick = Math.max(clampedEnd, Math.min(this.finalTick, startTick + MIN_LOOP_TICKS))
    // Copied, so a later mutation of the caller's object cannot move the loop.
    this.loopRange = { startTick: asTicks(startTick), endTick: asTicks(endTick) }
    this.iteration = 0
  }

  /**
   * Practice tempo (REQ-3.2.2), clamped by `withScale`. The musical position is
   * preserved exactly: only the mapping from here on changes, so the playhead
   * never jumps when the slider moves.
   */
  setTempoScale(scale: number): void {
    this.tempo = withScale(this.tempo, scale)
    this.reanchor()
  }

  /**
   * Stop the playhead ON `tick` (wait mode, roadmap 1.13): a pump emits
   * everything up to and INCLUDING the barrier and nothing after it, and leaves
   * the position exactly there, however much wall time the pump spanned. Pass
   * `null` to clear it and carry on.
   *
   * The barrier is inclusive because it exists to park the playhead on an onset:
   * the notes at the barrier tick sound, and the wait happens with them ringing.
   *
   * Time is not consumed while parked. Clearing the barrier resumes from the
   * barrier tick with no lost music and no lurch forward, exactly as `pause` and
   * `release` do — so a barrier at every onset plays the piece complete, only
   * slower. The barrier stays armed until it is cleared: it re-parks the playhead
   * on every pump, and on every loop pass.
   *
   * A barrier behind the playhead, at or past the loop end, or past the final
   * tick is unreachable and simply never fires. `stop()` clears it.
   */
  setBarrier(tick: Ticks | null): void {
    if (tick !== null) {
      invariant(Number.isFinite(tick), `setBarrier: ${tick} is not a finite tick`)
    }
    this.barrier = tick
    // Leaving a barrier is a resume: the wall time spent parked on it is dropped
    // rather than replayed as a jump.
    if (!this.atBarrier) return
    this.atBarrier = false
    this.reanchor()
  }

  /** Gate playback until `predicate` is true — wait mode (roadmap 1.13). */
  holdUntil(predicate: () => boolean): void {
    this.hold = predicate
  }

  /** Drop the gate. Wall time spent waiting is discarded, not replayed. */
  release(): void {
    if (this.hold === null) return
    this.hold = null
    this.reanchor()
  }

  /** Advance to the clock's current time, returning everything that happened, in order. */
  tick(): readonly TransportEvent[] {
    const out = this.pending
    this.pending = []
    if (this.runState !== 'running') return out
    const nowMs = this.clock.now()
    if (this.hold !== null) {
      if (!this.hold()) return out
      this.hold = null
      this.originMs = nowMs - tickToMs(this.tempo, this.positionTicks)
    }
    this.advance(nowMs, out)
    return out
  }

  // --------------------------------------------------------------- internals

  private advance(nowMs: number, out: TransportEvent[]): void {
    for (;;) {
      // `msToTick(tickToMs(t))` is not exactly `t` for every tick — 86 of the
      // 3841 integer ticks of a two-bar scale come back a few times 1e-13 short —
      // so recovering the target from the origin can land a hair BEHIND the tick
      // the origin was anchored on. Clamping to the cursor keeps the one ordering
      // guarantee the transport makes (the playhead never goes backwards between
      // commands) exact rather than approximate.
      const target = Math.max(this.posTick, msToTick(this.tempo, asMillis(nowMs - this.originMs)))
      if (this.countInEndTick !== null && target >= this.countInEndTick) this.countInEndTick = null
      const loop = this.loopRange
      const boundary = loop === null ? this.finalTick : loop.endTick
      const barrier = this.barrierStop(target, loop)
      if (barrier !== null) {
        this.emitThrough(barrier, true, out)
        this.posTick = barrier
        this.atBarrier = true
        // Anchor the origin on the barrier, so the rest of this pump — and every
        // pump until the barrier is cleared — costs no musical time. Anchored on
        // the instant this pump was given, not on a fresh reading: under a real
        // monotonic clock a second reading is later than the first, and the gap
        // between them would be swallowed as musical time on every park.
        this.originMs = nowMs - tickToMs(this.tempo, this.positionTicks)
        return
      }
      if (target < boundary) {
        this.emitThrough(target, true, out)
        this.posTick = target
        return
      }
      if (loop !== null) {
        // The loop end is exclusive: a note starting on it belongs to the next bar.
        this.emitThrough(loop.endTick, false, out)
        this.releaseHeldInto(out)
        this.iteration += 1
        out.push({ type: 'loop', iteration: this.iteration })
        // Carry the overshoot into the new pass, so wrapping loses no time. When
        // the playhead was already past the end (a seek out of the range), there
        // is no crossing to carry — restart from now instead of replaying passes.
        const crossMs =
          this.posTick < loop.endTick ? this.originMs + tickToMs(this.tempo, loop.endTick) : nowMs
        this.originMs = crossMs - tickToMs(this.tempo, loop.startTick)
        this.posTick = loop.startTick
        this.nextFrom = loop.startTick
        this.nextFromInclusive = true
        continue
      }
      this.emitThrough(this.finalTick, true, out)
      this.releaseHeldInto(out)
      this.posTick = this.finalTick
      this.runState = 'stopped'
      out.push({ type: 'end' })
      return
    }
  }

  /**
   * The tick this pump must stop on, or `null` when the barrier is unarmed, not
   * reached yet, already behind the playhead, or out of reach entirely. The loop
   * end is exclusive, so a barrier on it is never played; the final tick is
   * inclusive, so a barrier on it is (and holds back `end` until it is cleared).
   */
  private barrierStop(target: number, loop: LoopRange | null): number | null {
    const barrier = this.barrier
    if (barrier === null || barrier > target || barrier < this.posTick) return null
    if (loop === null) return barrier <= this.finalTick ? barrier : null
    return barrier < loop.endTick ? barrier : null
  }

  /**
   * Emit everything between the cursor and `to`, then park the cursor on `to`.
   * A `to` behind the cursor (the count-in, or a loop end left behind by a seek)
   * emits nothing and leaves the cursor where it is.
   */
  private emitThrough(to: number, inclusiveTop: boolean, out: TransportEvent[]): void {
    const from = this.nextFrom
    if (to < from) return
    const fromInclusive = this.nextFromInclusive
    const lowOk = (tick: number): boolean => (fromInclusive ? tick >= from : tick > from)
    const highOk = (tick: number): boolean => (inclusiveTop ? tick <= to : tick < to)

    const items: Timed[] = []
    let seq = 0
    const push = (tick: number, rank: number, event: TransportEvent): void => {
      items.push({ tick, rank, seq: seq++, event })
    }

    for (const [id, note] of this.held) {
      const endsAt = note.startTick + note.durationTicks
      if (!highOk(endsAt)) continue
      this.held.delete(id)
      push(endsAt, RANK.noteOff, { type: 'noteOff', note })
    }

    // `+1` widens the half-open query to cover a note starting exactly on `to`;
    // `highOk` throws it back out when the top is exclusive.
    const scanFrom = asTicks(Math.max(0, from))
    for (const note of notesInRange(this.score, scanFrom, asTicks(to + 1))) {
      if (!lowOk(note.startTick) || !highOk(note.startTick)) continue
      push(note.startTick, RANK.noteOn, { type: 'noteOn', note })
      const endsAt = note.startTick + note.durationTicks
      if (!highOk(endsAt)) {
        this.held.set(note.id, note)
      } else {
        // A zero-length note releases at its own attack tick: same rank, next
        // `seq`, so it sorts immediately after that attack and before any other.
        const rank = endsAt === note.startTick ? RANK.noteOn : RANK.noteOff
        push(endsAt, rank, { type: 'noteOff', note })
      }
    }

    const measures = this.score.measures
    for (let i = this.firstMeasureFrom(from); i < measures.length; i++) {
      const measure = at(measures, i)
      if (!highOk(measure.startTick)) break
      if (lowOk(measure.startTick)) {
        push(measure.startTick, RANK.measure, { type: 'measure', index: measure.index })
      }
    }

    items.sort((a, b) => a.tick - b.tick || a.rank - b.rank || a.seq - b.seq)
    for (const item of items) out.push(item.event)
    this.nextFrom = to
    this.nextFromInclusive = false
  }

  /** First measure whose start is at or after `tick` — the scan never walks the score. */
  private firstMeasureFrom(tick: number): number {
    const measures = this.score.measures
    let lo = 0
    let hi = measures.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (at(measures, mid).startTick < tick) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private releaseHeldInto(sink: TransportEvent[]): void {
    for (const note of this.held.values()) sink.push({ type: 'noteOff', note })
    this.held.clear()
  }

  /** Move the playhead and the cursor together: events on the destination still fire. */
  private moveTo(tick: number): void {
    // A jump ends any parking: `reanchor` below settles the books, so leaving the
    // barrier later must not settle them a second time and eat real playing time.
    this.atBarrier = false
    this.posTick = tick
    this.nextFrom = tick
    this.nextFromInclusive = true
    this.cursorGen += 1
    this.reanchor()
  }

  private reanchor(): void {
    this.originMs = this.clock.now() - tickToMs(this.tempo, this.positionTicks)
  }
}
