/**
 * Wait mode (roadmap 1.13, REQ-3.3.3) — playback that waits for the learner.
 *
 * The beginner's problem with hands-together practice is that the music does not
 * care whether you found the note. Wait mode inverts that: the playhead runs at
 * the written tempo up to the next onset the learner is responsible for, then
 * stops dead until the right key (or every key of the chord) is struck, and
 * carries on from exactly where it stopped.
 *
 * ## How the gate works
 *
 * `Transport.holdUntil(predicate)` is the whole mechanism. The transport checks
 * the predicate at the top of every pump; while it is false the pump returns
 * nothing and the playhead does not move, however much wall-clock time has gone
 * by. When the gate drops the transport re-anchors to the *current* position, so
 * the wait costs no musical time at all — the ten seconds you spent hunting for
 * F# are discarded, not replayed as a lurch forward.
 *
 * This controller owns that gate. Call `update()` INSTEAD of `Transport.tick()`,
 * once per frame: it pumps the transport, reads the events back, and arms the
 * next wait from them. Pumping the transport directly as well would hide the
 * events this controller needs to see.
 *
 * ## The rules, stated once
 *
 *  - **The wait is armed by the onset itself.** When a pump emits a `noteOn` for
 *    a note the learner owes, the playhead is at that onset — so the gate goes on
 *    right there, and the frozen position is the onset. Everything at that tick is
 *    armed together (via `notesAtTick`), not just the notes this pump happened to
 *    emit, so a chord is always armed whole.
 *  - **Only a fresh strike counts.** A requirement credits a pitch on `noteOn`,
 *    never from the set of keys already down. Holding C4 over from the previous
 *    chord therefore does nothing for the next one: the key has to be released and
 *    re-struck, which is exactly what the music asks for when a pitch repeats.
 *  - **…and the key must still be down.** `noteOff` withdraws the credit while the
 *    gate is up, so `requireAllChordNotes` really does mean "every note down at
 *    once" rather than "every note visited at some point".
 *  - **A tie is not a strike.** A `ScoreNote` with `tiedFrom` continues a key press
 *    that already happened, so it never arms a wait — the same rule the matcher
 *    applies to its expected list.
 *  - **Muted hands play themselves.** With `hands: ['right']`, left-hand onsets are
 *    emitted and passed straight through; nothing waits for them.
 *  - **A wrong note is inert by default.** `allowExtraNotes` (default true) makes an
 *    unrequired press a no-op: it does not advance the playhead and it does not
 *    punish. Set it to `false` and an unrequired press wipes the progress made on
 *    the current chord, so the chord has to come out clean.
 *
 * ## What this module deliberately does not do
 *
 * It does not score the playing. `NoteMatcher` does that, and it runs on wall-clock
 * milliseconds — which wait mode stops. Feed the matcher separately (or not at all
 * while waiting); mixing the two here would report a `missed` for every note the
 * learner was being waited for.
 */
import { HANDS, notesAtTick, type Hand, type Score, type ScoreNote } from '@core/notation/score.ts'
import { invariant } from '@core/shared/invariant.ts'
import { isValidMidi, type Midi, type Ticks } from '@core/shared/units.ts'
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
    return this.snapshot
  }

  // -------------------------------------------------------------------- input

  /**
   * Pump the transport and re-arm the gate. Returns the transport's events for
   * this frame plus the wait state they left behind.
   */
  update(): WaitModeUpdate {
    const events = this.transport.tick()
    this.consume(events)
    // `stop()` and the end of the piece both drop the gate on the transport side.
    if (this.transport.state === 'stopped') this.disarm()
    return { events, wait: this.snapshot }
  }

  /** One MIDI note-on. Credits the armed requirement and drops the gate when it is met. */
  noteOn(note: Midi): void {
    invariant(isValidMidi(note), `noteOn: ${note} is not a MIDI note number`)
    // A key that never came up cannot be struck again — this is what stops a
    // chord tone held over from the previous onset from satisfying this one.
    if (this.down.has(note)) return
    this.down.add(note)
    if (!this.holding) return

    if (this.requiredPitches.includes(note)) {
      if (!this.satisfied.includes(note)) this.satisfied.push(note)
      if (this.isSatisfied()) {
        this.holding = false
        // Released here rather than at the next pump, so the music resumes from
        // the instant of the press instead of the instant of the next frame.
        this.transport.release()
      }
    } else if (!this.allowExtra) {
      this.satisfied = []
    }
    this.publish()
  }

  /** One MIDI note-off. Withdraws the credit for that pitch while the gate is up. */
  noteOff(note: Midi): void {
    invariant(isValidMidi(note), `noteOff: ${note} is not a MIDI note number`)
    this.down.delete(note)
    if (!this.holding) return
    const index = this.satisfied.indexOf(note)
    if (index < 0) return
    this.satisfied.splice(index, 1)
    this.publish()
  }

  /** Forget the armed wait and every key believed to be down, and drop the gate. */
  reset(): void {
    this.down.clear()
    this.disarm()
  }

  // ---------------------------------------------------------------- internals

  /**
   * Arm on the LAST waited-for onset the pump emitted. A batch normally carries
   * at most one — the gate goes up as soon as one appears — and when a stalled
   * frame makes it carry several, the last is the one the playhead is actually
   * parked on. A loop wrap clears the candidate: anything before the wrap point
   * is behind the playhead now, and the notes after it re-arm the wait.
   */
  private consume(events: readonly TransportEvent[]): void {
    let armAt: Ticks | null = null
    for (const event of events) {
      if (event.type === 'loop') armAt = null
      else if (event.type === 'noteOn' && this.isWaitedFor(event.note)) armAt = event.note.startTick
    }
    if (armAt !== null) this.arm(armAt)
  }

  private arm(tick: Ticks): void {
    const required = notesAtTick(this.score, tick).filter((note) => this.isWaitedFor(note))
    invariant(
      required.length > 0,
      `wait mode armed at tick ${tick}, where its score has no waited-for note — ` +
        'the controller and the transport must share one score',
    )
    const pitches: Midi[] = []
    for (const note of required) if (!pitches.includes(note.midi)) pitches.push(note.midi)
    this.required = required
    this.requiredPitches = pitches
    this.satisfied = []
    this.holding = true
    this.transport.holdUntil(() => this.isSatisfied())
    this.publish()
  }

  private disarm(): void {
    if (!this.holding && this.required.length === 0) return
    this.required = NO_NOTES
    this.requiredPitches = NO_PITCHES
    this.satisfied = []
    this.holding = false
    this.transport.release()
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

  private publish(): void {
    this.snapshot =
      !this.holding && this.required.length === 0
        ? IDLE
        : {
            waiting: this.holding,
            requiredNotes: this.required,
            satisfiedNotes: [...this.satisfied],
          }
  }
}
