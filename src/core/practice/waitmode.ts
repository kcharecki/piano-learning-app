/**
 * Wait mode (roadmap 1.13, REQ-3.3.3) — playback that waits for the learner.
 *
 * The beginner's problem with hands-together practice is that the music does not
 * care whether you found the note. Wait mode inverts that: the playhead runs at
 * the written tempo up to the next onset the learner is responsible for, then
 * stops dead ON that onset, with its notes ringing, until the right key (or every
 * key of the chord) is struck — and carries on from exactly there.
 *
 * ## How the stop works
 *
 * `Transport.setBarrier(tick)` is the mechanism, and it is armed BEFORE the pump,
 * on the next onset the learner owes. The barrier is inclusive: the pump emits
 * everything up to and including that tick and nothing after it, and parks the
 * playhead exactly there however much wall-clock time the pump spanned. Arming
 * ahead rather than reacting to what came out is the whole point:
 *
 *  - a frame that spans several onsets cannot walk past the ones it owes. A
 *    background tab throttled to 1 Hz, or a 400 ms GC pause at semiquaver speed,
 *    stops on the first note owed, not the fourth;
 *  - the frozen position IS the onset — 0, 480, 960 — never a fraction of a frame
 *    past it, whatever the frame length. The learner never loses the front of the
 *    note they are being asked to play.
 *
 * `Transport.holdUntil` is armed alongside it, so `transport.state` reads
 * `'waiting'` while the learner is being waited for. It gates nothing the barrier
 * does not already gate; it is what makes the transport and this controller give
 * one answer to "are we waiting?".
 *
 * Call `update()` INSTEAD of `Transport.tick()`, once per frame: it arms the next
 * barrier, pumps the transport, and reads back the events. Pumping the transport
 * directly as well would let a frame run past an onset before the barrier for it
 * was armed.
 *
 * ## The rules, stated once
 *
 *  - **The wait is armed on the onset itself.** The barrier parks the playhead on
 *    the onset tick, and everything written at that tick is armed together (via
 *    `notesAtTick`), so a chord is always armed whole.
 *  - **Only a fresh strike counts.** A requirement credits a pitch on `noteOn`,
 *    never from the set of keys already down. Holding C4 over from the previous
 *    chord therefore does nothing for the next one: the key has to be released and
 *    re-struck, which is exactly what the music asks for when a pitch repeats.
 *  - **…and the key must still be down.** `noteOff` withdraws the credit while the
 *    wait is up, so `requireAllChordNotes` really does mean "every note down at
 *    once" rather than "every note visited at some point".
 *  - **A tie is not a strike.** A `ScoreNote` with `tiedFrom` continues a key press
 *    that already happened, so it never arms a wait — the same rule the matcher
 *    applies to its expected list.
 *  - **Muted hands play themselves.** With `hands: ['right']`, left-hand onsets are
 *    played straight through; nothing waits for them.
 *  - **A wrong note is inert by default.** `allowExtraNotes` (default true) makes an
 *    unrequired press a no-op: it does not advance the playhead and it does not
 *    punish. Set it to `false` and an unrequired press wipes the progress made on
 *    the current chord, so the chord has to come out clean.
 *  - **`waiting` means the transport is stopped on the onset.** It is derived, not
 *    remembered: pausing, stopping or seeking during a wait is reported as not
 *    waiting the instant it happens, because the playhead is no longer being held
 *    on an onset for the learner. The requirement itself survives a pause, so
 *    resuming carries on waiting for the same notes.
 *
 * ## What this module deliberately does not do
 *
 * It does not score the playing. `NoteMatcher` does that, and it runs on wall-clock
 * milliseconds — which wait mode stops. Feed the matcher separately (or not at all
 * while waiting); mixing the two here would report a `missed` for every note the
 * learner was being waited for.
 */
import { HANDS, notesAtTick, type Hand, type Score, type ScoreNote } from '@core/notation/score.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { isValidMidi, ticks as asTicks, type Midi } from '@core/shared/units.ts'
import type { Transport, TransportEvent } from '@core/timing/transport.ts'

export type WaitModeSettings = {
  /** Hold until every distinct pitch of the chord is down. Default true. */
  readonly requireAllChordNotes?: boolean
  /**
   * Default true: an unrequired press neither advances the playhead nor fails.
   * False makes it wipe the progress made on the chord being waited for.
   */
  readonly allowExtraNotes?: boolean
  /** Wait only for these hands; onsets in the others play automatically. */
  readonly hands?: readonly Hand[]
}

export type WaitState = {
  /** True while the playhead is parked on an onset waiting for the learner. */
  readonly waiting: boolean
  /** Every note of the armed onset, chord members included. Empty when nothing is armed. */
  readonly requiredNotes: readonly ScoreNote[]
  /** Distinct required pitches struck since the wait was armed and still down. */
  readonly satisfiedNotes: readonly Midi[]
}

export type WaitModeUpdate = {
  readonly events: readonly TransportEvent[]
  readonly wait: WaitState
}

export const WAIT_MODE_DEFAULTS = {
  requireAllChordNotes: true,
  allowExtraNotes: true,
} as const

const NO_NOTES: readonly ScoreNote[] = []
const NO_PITCHES: readonly Midi[] = []
/** Nothing armed. Shared, so an idle controller keeps one stable state identity. */
const IDLE: WaitState = { waiting: false, requiredNotes: NO_NOTES, satisfiedNotes: NO_PITCHES }

/** First index whose `startTick` is >= `tick`; the score is sorted by onset. */
function firstNoteFrom(notes: readonly ScoreNote[], tick: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (at(notes, mid).startTick < tick) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class WaitModeController {
  private readonly transport: Transport
  private readonly score: Score
  private readonly requireAll: boolean
  private readonly allowExtra: boolean
  /** `null` means every hand is waited for. */
  private readonly hands: readonly Hand[] | null
  private required: readonly ScoreNote[] = NO_NOTES
  /** Distinct pitches of `required` — a chord may double a pitch across voices. */
  private requiredPitches: readonly Midi[] = NO_PITCHES
  private satisfied: Midi[] = []
  /** Keys physically down, so a held-over key cannot be re-credited. */
  private readonly down = new Set<Midi>()
  private holding = false
  /** Onset the barrier is armed on; `null` when it is unarmed or holds a fence. */
  private armedOnset: number | null = null
  /** Onset the playhead is parked on and whose notes the transport has emitted. */
  private consumedOnset: number | null = null
  /** Where the last `update` left the playhead — anything else means it was moved. */
  private lastPosition: number | null = null
  /** The transport's cursor generation at the last `update`; a bump is a rewind. */
  private lastCursor = 0
  private snapshot: WaitState = IDLE

  /** `score` must be the score the transport is playing — the wait is armed from it. */
  constructor(transport: Transport, score: Score, settings: WaitModeSettings = {}) {
    this.transport = transport
    this.score = score
    this.requireAll = settings.requireAllChordNotes ?? WAIT_MODE_DEFAULTS.requireAllChordNotes
    this.allowExtra = settings.allowExtraNotes ?? WAIT_MODE_DEFAULTS.allowExtraNotes
    const hands = settings.hands
    if (hands === undefined) {
      this.hands = null
    } else {
      for (const hand of hands) invariant(HANDS.includes(hand), `unknown hand: ${hand}`)
      this.hands = [...hands]
    }
  }

  // ------------------------------------------------------------------ queries

  get state(): WaitState {
    // `waiting` is derived from the transport, which the caller can pause, stop or
    // seek behind this controller's back, so the cached snapshot is refreshed here
    // rather than only at the points where this controller changes something.
    if (this.snapshot.waiting !== this.isWaiting()) this.publish()
    return this.snapshot
  }

  // -------------------------------------------------------------------- input

  /**
   * Arm the barrier on the next owed onset, pump the transport, and arm the wait
   * if the pump parked on that onset. Returns the transport's events for this
   * frame plus the wait state they left behind.
   */
  update(): WaitModeUpdate {
    this.noticeMovedPlayhead()
    if (!this.holding && this.transport.state !== 'stopped') this.armBarrier()
    const events = this.transport.tick()
    this.armFromPark(events)
    // `stop()` and the end of the piece both drop the gate on the transport side.
    if (this.transport.state === 'stopped') {
      this.consumedOnset = null
      this.disarm()
    }
    this.lastPosition = this.transport.positionTicks
    this.lastCursor = this.transport.cursorGeneration
    return { events, wait: this.state }
  }

  /** One MIDI note-on. Credits the armed requirement and resumes when it is met. */
  noteOn(note: Midi): void {
    invariant(isValidMidi(note), `noteOn: ${note} is not a MIDI note number`)
    // A key that never came up cannot be struck again — this is what stops a
    // chord tone held over from the previous onset from satisfying this one.
    if (this.down.has(note)) return
    this.down.add(note)
    if (!this.holding) return

    if (this.requiredPitches.includes(note)) {
      if (!this.satisfied.includes(note)) this.satisfied.push(note)
      // Resumed here rather than at the next pump, so the music carries on from
      // the instant of the press instead of the instant of the next frame.
      if (this.isSatisfied()) this.openGate()
    } else if (!this.allowExtra) {
      this.satisfied = []
    }
    this.publish()
  }

  /** One MIDI note-off. Withdraws the credit for that pitch while the wait is up. */
  noteOff(note: Midi): void {
    invariant(isValidMidi(note), `noteOff: ${note} is not a MIDI note number`)
    this.down.delete(note)
    if (!this.holding) return
    const index = this.satisfied.indexOf(note)
    if (index < 0) return
    this.satisfied.splice(index, 1)
    this.publish()
  }

  /** Forget the armed wait and every key believed to be down, and let playback run. */
  reset(): void {
    this.down.clear()
    this.disarm()
  }

  // ---------------------------------------------------------------- internals

  /**
   * Put the barrier on the next onset the learner owes, BEFORE the pump that
   * would otherwise sail past it. The search starts one tick past the onset the
   * playhead is parked on — its notes are already out — and otherwise from the
   * playhead itself, which is where a seek or a count-in leaves the cursor.
   *
   * Inside a loop the search stops at the loop end (a barrier there never fires)
   * and then restarts from the loop start, so the wrap re-arms the first onset of
   * the next pass. A wrap-side onset BEHIND the playhead is armed straight away —
   * it is inert until the wrap moves the playhead back before it. One that is not
   * behind the playhead means the pass owes a single onset and the playhead is
   * standing on it; arming that would park on it again without emitting anything,
   * so the pump is fenced short of the wrap instead, and the pump after it wraps
   * with the onset armed behind the playhead, where it is inert until the wrap
   * puts it back in front.
   *
   * The fence goes on the last whole tick before the wrap rather than just ahead
   * of the playhead: the rest of the pass owes nothing, so it may be played at
   * the written tempo, and an ordinary frame never reaches the fence at all. Only
   * the frame that would cross the wrap is stopped by it — which is the frame
   * that has to be stopped — and the playhead is left on a whole tick, not on the
   * half tick that would otherwise ride along for the rest of the pass. When the
   * onset IS that last whole tick there is none left to stop on, so the fence
   * falls half way to the wrap.
   */
  private armBarrier(): void {
    const position = this.transport.positionTicks
    const loop = this.transport.loop
    const from = this.consumedOnset === position ? position + 1 : position
    const limit = loop === null ? Number.POSITIVE_INFINITY : loop.endTick
    const ahead = this.nextOwedOnset(from, limit)
    if (ahead !== null || loop === null) {
      this.armOnset(ahead)
      return
    }
    const wrapped = this.nextOwedOnset(loop.startTick, loop.endTick)
    if (wrapped === null || wrapped < position) {
      this.armOnset(wrapped)
      return
    }
    this.armedOnset = null
    const lastWholeTick = Math.ceil(loop.endTick) - 1
    const fence = Math.max(lastWholeTick, (position + loop.endTick) / 2)
    this.transport.setBarrier(asTicks(fence))
  }

  /** Tick of the first onset the learner owes in `[fromTick, limitTick)`, or `null`. */
  private nextOwedOnset(fromTick: number, limitTick: number): number | null {
    const notes = this.score.notes
    for (let i = firstNoteFrom(notes, fromTick); i < notes.length; i++) {
      const note = at(notes, i)
      if (note.startTick >= limitTick) return null
      if (this.isWaitedFor(note)) return note.startTick
    }
    return null
  }

  private armOnset(tick: number | null): void {
    this.armedOnset = tick
    this.transport.setBarrier(tick === null ? null : asTicks(tick))
  }

  /** Take up the wait if the pump parked the playhead on the onset we armed. */
  private armFromPark(events: readonly TransportEvent[]): void {
    const onset = this.armedOnset
    if (onset === null || this.holding) return
    if (!this.transport.isAtBarrier || this.transport.positionTicks !== onset) return
    this.arm(onset, events)
  }

  private arm(tick: number, events: readonly TransportEvent[]): void {
    // The pump parked on this tick because this controller's score says a note
    // starts here. If the transport sounded something else instead, the two are
    // reading different scores and every wait armed from here on is fiction.
    invariant(
      events.some((event) => event.type === 'noteOn' && event.note.startTick === tick),
      `wait mode parked the playhead on tick ${tick}, where the transport sounded nothing — ` +
        'the controller and the transport must share one score',
    )
    const required = notesAtTick(this.score, asTicks(tick)).filter((note) => this.isWaitedFor(note))
    invariant(required.length > 0, `wait mode armed at tick ${tick} with nothing to wait for`)
    const pitches: Midi[] = []
    for (const note of required) if (!pitches.includes(note.midi)) pitches.push(note.midi)
    this.required = required
    this.requiredPitches = pitches
    this.satisfied = []
    this.holding = true
    this.consumedOnset = tick
    this.transport.holdUntil(() => this.isSatisfied())
    this.publish()
  }

  /**
   * Notice the transport being driven behind this controller's back. Only
   * `tick()` moves the playhead, so a position that changed between updates is a
   * seek, a stop or a fresh `play()`; and a wait whose playhead is no longer
   * parked on its barrier has been unpicked the same way. Either means whatever
   * was armed describes the old position, and that the tick it parked on is no
   * longer spent — those calls all rewind the transport's cursor, so its notes
   * come out again and can be waited for again.
   *
   * The cursor generation is watched alongside the position because the position
   * cannot see the case that matters most: seeking to the tick the playhead is
   * parked on — "play me that note again" — rewinds the cursor without moving the
   * playhead, and the onset would otherwise sound with no wait at all.
   */
  private noticeMovedPlayhead(): void {
    const rewound = this.transport.cursorGeneration !== this.lastCursor
    const moved =
      this.lastPosition !== null && (rewound || this.transport.positionTicks !== this.lastPosition)
    if (!moved && (!this.holding || this.transport.isAtBarrier)) return
    this.consumedOnset = null
    this.disarm()
  }

  /** Drop the gate and the barrier, leaving the requirement alone. */
  private openGate(): void {
    this.holding = false
    this.armedOnset = null
    this.transport.release()
    this.transport.setBarrier(null)
  }

  private disarm(): void {
    if (!this.holding && this.required.length === 0 && this.armedOnset === null) return
    this.required = NO_NOTES
    this.requiredPitches = NO_PITCHES
    this.satisfied = []
    this.openGate()
    this.publish()
  }

  private isWaitedFor(note: ScoreNote): boolean {
    if (note.tiedFrom) return false
    return this.hands === null || this.hands.includes(note.hand)
  }

  /**
   * The gate predicate. `requiredPitches` is non-empty whenever this can run:
   * `arm` is the only place that installs the predicate and it refuses to arm an
   * empty requirement, and both `disarm` and a met requirement drop the gate.
   */
  private isSatisfied(): boolean {
    return this.requireAll
      ? this.satisfied.length === this.requiredPitches.length
      : this.satisfied.length > 0
  }

  /**
   * Waiting is the transport's answer, not a remembered flag: the gate is up AND
   * the playhead is parked on the onset. A pause, a stop or a seek breaks one of
   * the two, so it stops reporting a wait the moment it happens rather than at the
   * next pump.
   */
  private isWaiting(): boolean {
    return this.holding && this.transport.state === 'waiting' && this.transport.isAtBarrier
  }

  private publish(): void {
    this.snapshot =
      !this.holding && this.required.length === 0
        ? IDLE
        : {
            waiting: this.isWaiting(),
            requiredNotes: this.required,
            satisfiedNotes: [...this.satisfied],
          }
  }
}
