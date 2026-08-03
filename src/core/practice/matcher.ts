/**
 * The note matcher (roadmap 1.12, REQ-3.3.2, REQ-3.3.6) — the heart of practice
 * mode: it decides, in real time, whether what the learner played is what the
 * score asked for.
 *
 * A pure, incremental state machine. Events go in (`noteOn`, `noteOff`,
 * `advanceTo`), verdicts come out. It owns no clock and no timer — the caller
 * supplies the time on every call, which keeps `src/core` deterministic.
 *
 * ## Why a window, not a search
 *
 * Every expected onset is converted to milliseconds ONCE, at construction, via
 * the tempo map; after that the matcher keeps a single cursor `lo` into that
 * array. MIDI events arrive in (near-) time order and an expected note can only
 * be matched inside `±toleranceMs` of its onset, so the candidates for a press
 * are a short contiguous run starting at `lo`. Nothing ever rescans the score:
 * cost per event is proportional to how many onsets fall inside one
 * `2 × toleranceMs` window — a small constant for real music, and what keeps
 * feedback inside the 100 ms budget of REQ-4.1. `scanSteps` measures exactly
 * that, so the suite can pin it without touching a real clock.
 *
 * ## The rules, stated once
 *
 *  - **Attribution is nearest-first.** A press goes to the *closest pending
 *    expected note of the same pitch* within `toleranceMs`, not the first one in
 *    the score. Ties go to the earlier note, so a run of repeated identical
 *    pitches is consumed left to right, one press per note.
 *  - **A wrong key is a substitution, not two errors.** A press matching no
 *    pending pitch but landing inside a pending note's window is `wrongPitch`
 *    charged to that note — deliberately NOT an `extra` plus a later `missed`.
 *    A note already due outranks one still upcoming: you owe the note you passed.
 *  - **A self-correction is charged once, then credited.** Being charged does
 *    not *decide* the note: it stays matchable for the rest of its window, so
 *    the right key straight after the wrong one is `correct` — the beginner's
 *    commonest event scores 1 of 2, not 0 of 2. The note can only be charged
 *    once, so hammering wrong keys yields `wrongPitch` then `extra`, and a
 *    charged note that is never corrected closes silently: it never also
 *    reports `missed`. One expected note therefore produces at most two
 *    verdicts, and only ever as `wrongPitch` followed by `correct`.
 *  - **A re-strike is an extra.** A press repeating a pitch just matched
 *    correctly (within `toleranceMs` of that press) is a doubled note, not a
 *    substitution — otherwise a stutter would eat the note that follows.
 *  - **A window that closes unplayed is a miss**, reported with `atMs` set to
 *    the moment it closed (`onset + tolerance`), so the stream is the same
 *    however coarsely the caller pumps the clock and stays ordered by `atMs`.
 *  - **Time only moves forwards.** MIDI events can arrive a millisecond out of
 *    order; the internal clock clamps to the newest time seen and the verdict
 *    is recorded at that clamped time, so `results` is non-decreasing in `atMs`
 *    whatever the transport does.
 *  - **Chords are unordered**: nearest-first attribution makes the order inside
 *    a shared onset irrelevant. A chord is decided by the score, not by the
 *    clock: notes sharing a `startTick`. `chordWindowMs` widens the on-time band
 *    for members of such a chord (two or more notes), because a slightly rolled
 *    chord is technique, not a timing error. A lone melody note never gets the
 *    wider band, however close its neighbours fall — otherwise a fast run would
 *    silently buy itself a looser judgment, and buy more of it the faster the
 *    practice tempo.
 *  - **Ties are never expected.** A `ScoreNote` with `tiedFrom` continues an
 *    earlier key press, so it is not in the expected list and can never be
 *    reported as missed.
 *  - **Muted hands are invisible.** With `hands: ['right']`, a press landing on
 *    a left-hand note produces no verdict at all.
 *  - **Only onsets are judged.** `durationTicks` is never read: a note released
 *    the instant it is struck scores the same as one held for its written
 *    value. REQ-3.3.2 is about which key and when, and release timing is far
 *    noisier than onset timing on a beginner's keyboard.
 */
import { chordGroups, type Hand, type Score, type ScoreNote } from '@core/notation/score.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import {
  isValidMidi,
  millis as asMillis,
  type Midi,
  type Millis,
  type Ticks,
} from '@core/shared/units.ts'
import { tickToMs, type TempoMap } from '@core/timing/tempo.ts'

export type NoteVerdict = 'correct' | 'wrongPitch' | 'missed' | 'extra'
export type TimingVerdict = 'early' | 'onTime' | 'late'

export type MatchResult = {
  readonly verdict: NoteVerdict
  /** The score note this verdict is about. Absent for `extra`. */
  readonly expected?: ScoreNote
  /** The key the learner actually pressed. Absent for `missed`. */
  readonly playedMidi?: Midi
  /** Present whenever a press was attributed to an expected note. */
  readonly timing?: TimingVerdict
  /** Signed: negative early, positive late. Present with `timing`. */
  readonly deviationMs?: number
  /** Press time; for `missed`, the moment the window closed. */
  readonly atMs: Millis
}

export type MatcherSettings = {
  /** Half-width of the window in which a played note can be attributed to an expected note. */
  readonly toleranceMs?: number
  /** Inside this band the timing is reported as onTime. */
  readonly onTimeMs?: number
  /** How far a *written* chord (notes sharing a startTick) may be rolled and still count as together. */
  readonly chordWindowMs?: number
  readonly ignoreOctaveErrors?: boolean
  /** Only evaluate these hands. Omit to evaluate everything the score contains. */
  readonly hands?: readonly Hand[]
}

export type MatchSummary = {
  readonly correct: number
  readonly wrongPitch: number
  readonly missed: number
  readonly extra: number
  /** `correct / (correct + wrongPitch + missed + extra)`; 1 when nothing was decided. */
  readonly accuracy: number
  /** Mean |deviationMs| over the presses that were attributed to a note; 0 when there were none. */
  readonly meanAbsDeviationMs: number
}

/** The tolerances a beginner-friendly practice session uses when nothing is stated. */
export const MATCHER_DEFAULTS = {
  toleranceMs: 150,
  onTimeMs: 50,
  chordWindowMs: 80,
} as const

const SEMITONES_PER_OCTAVE = 12
/** Compact `recent` once this many entries have been consumed — keeps it O(1). */
const RECENT_COMPACT_AT = 64

type Expected = {
  readonly note: ScoreNote
  readonly ms: number
  /** Notes sharing this note's written onset; 1 for a lone melody note. */
  readonly chordSize: number
}

type MutedNote = { readonly midi: number; readonly ms: number }

function requireNonNegative(value: number, name: string): number {
  invariant(
    Number.isFinite(value) && value >= 0,
    `${name} must be a finite number >= 0, got ${value}`,
  )
  return value
}

function requireTime(value: number, where: string): number {
  invariant(Number.isFinite(value), `${where}: atMs must be a finite time, got ${value}`)
  return value
}

/**
 * Onset milliseconds plus chord-group sizes. A chord is what the score writes as
 * one — notes sharing a `startTick` — grouped by `chordGroups()`, and NOT notes
 * that happen to land close together in milliseconds: grouping by elapsed time
 * would turn any run faster than the group window into a "chord", and would do
 * so more eagerly the faster the practice tempo.
 *
 * `chordGroups` takes the note list rather than a whole `Score` deliberately:
 * chord SIZES must be computed over `notes` as handed to this function — already
 * filtered to the hand(s) being practised — because a two-hand chord practised
 * right-hand-only is a smaller chord.
 *
 * `chordGroups` also skips `tiedFrom` notes, but the caller (`NoteMatcher`'s
 * constructor) has already filtered those out before `notes` reaches here, so
 * that skip is a no-op on this path. The invariant below asserts that
 * precondition rather than silently letting a tied note vanish from the
 * output — every input note must produce exactly one `Expected`.
 *
 * Notes arrive sorted by tick and `tickToMs` is monotonic, so the resulting `ms`
 * array is non-decreasing — the ordering every cursor in the matcher relies on.
 * `chordGroups` preserves input order (it only partitions into consecutive
 * runs), so flattening its groups lines back up with `notes` index-for-index.
 */
function buildExpected(notes: readonly ScoreNote[], tempo: TempoMap): readonly Expected[] {
  const groups = chordGroups(notes)
  const sizes: number[] = []
  for (const group of groups) for (let i = 0; i < group.length; i++) sizes.push(group.length)
  // Deliberately uncoverable: `buildExpected` is private with one call site
  // (`NoteMatcher`'s constructor), which already strips `tiedFrom` before calling this.
  // Kept as a programmer-error guard against a future call site skipping that filter.
  invariant(
    sizes.length === notes.length,
    'buildExpected: input must already be tied-filtered — chordGroups dropped a tiedFrom note',
  )
  return notes.map((note, i) => ({
    note,
    ms: tickToMs(tempo, note.startTick) as number,
    chordSize: at(sizes, i),
  }))
}

export class NoteMatcher {
  private readonly tempo: TempoMap
  private readonly tolerance: number
  private readonly onTime: number
  private readonly chordWindow: number
  private readonly ignoreOctave: boolean
  private readonly expected: readonly Expected[]
  private readonly muted: readonly MutedNote[]
  /** No longer matchable: it produced its final verdict, or was charged and closed. */
  private readonly decided: boolean[]
  /** Already carries a `wrongPitch`, so it cannot be charged again or be missed. */
  private readonly charged: boolean[]
  private readonly held = new Set<Midi>()
  private readonly out: MatchResult[] = []
  /** Lowest expected index that is still undecided — the window's left edge. */
  private lo = 0
  private mutedLo = 0
  private nowMs = -Infinity
  /** Pitches matched correctly and still inside their tolerance window. */
  private recent: { midi: number; ms: number }[] = []
  private recentLo = 0
  private correctCount = 0
  private wrongPitchCount = 0
  private missedCount = 0
  private extraCount = 0
  private deviationSum = 0
  private deviationCount = 0
  private steps = 0

  constructor(score: Score, tempo: TempoMap, settings: MatcherSettings = {}) {
    this.tempo = tempo
    this.tolerance = requireNonNegative(
      settings.toleranceMs ?? MATCHER_DEFAULTS.toleranceMs,
      'toleranceMs',
    )
    this.onTime = requireNonNegative(settings.onTimeMs ?? MATCHER_DEFAULTS.onTimeMs, 'onTimeMs')
    this.chordWindow = requireNonNegative(
      settings.chordWindowMs ?? MATCHER_DEFAULTS.chordWindowMs,
      'chordWindowMs',
    )
    this.ignoreOctave = settings.ignoreOctaveErrors ?? false

    const hands = settings.hands
    // A tied continuation is sustained, not struck: it is never expected.
    const playable = score.notes.filter((n) => !n.tiedFrom)
    const active = hands === undefined ? playable : playable.filter((n) => hands.includes(n.hand))
    this.expected = buildExpected(active, tempo)
    this.muted =
      hands === undefined
        ? []
        : playable
            .filter((n) => !hands.includes(n.hand))
            .map((n) => ({ midi: n.midi, ms: tickToMs(tempo, n.startTick) as number }))
    this.decided = new Array<boolean>(this.expected.length).fill(false)
    this.charged = new Array<boolean>(this.expected.length).fill(false)
  }

  // -------------------------------------------------------------------- input

  /**
   * Feed one MIDI note-on. The internal clock is advanced to `atMs` first, so
   * any window that closed before this press is reported as `missed` ahead of
   * this press's own verdict. An event that arrives out of order is judged (and
   * recorded) at the clock's current value, never in the past.
   */
  noteOn(note: Midi, atMs: Millis): readonly MatchResult[] {
    invariant(isValidMidi(note), `noteOn: ${note} is not a MIDI note number`)
    const produced: MatchResult[] = []
    this.closeWindows(requireTime(atMs, 'noteOn'), produced)
    this.held.add(note)
    this.classify(note, this.nowMs, produced)
    return produced
  }

  /** Release. Nothing is decided on a release; it only clears the held-key set. */
  noteOff(note: Midi, atMs: Millis): void {
    invariant(isValidMidi(note), `noteOff: ${note} is not a MIDI note number`)
    requireTime(atMs, 'noteOff')
    this.held.delete(note)
  }

  /** Advance the internal clock: expected notes whose window has closed become `missed`. */
  advanceTo(atMs: Millis): readonly MatchResult[] {
    const produced: MatchResult[] = []
    this.closeWindows(requireTime(atMs, 'advanceTo'), produced)
    return produced
  }

  // ------------------------------------------------------------------ queries

  /** Everything decided so far, in order. Also non-decreasing in `atMs`. */
  get results(): readonly MatchResult[] {
    return this.out
  }

  /** Keys currently down, for the UI keyboard overlay. */
  get heldNotes(): readonly Midi[] {
    return [...this.held]
  }

  /**
   * Diagnostic: inner-loop steps the attribution scans have taken since
   * construction (or the last `reset`). It is the cost model of this module made
   * observable — it must stay linear in the number of events, never quadratic in
   * the length of the score. Not part of the practice model; do not show it.
   */
  get scanSteps(): number {
    return this.steps
  }

  /**
   * Expected notes not yet decided, in score order — wait mode gates on the
   * leading run of these. Pass `limit` when only the first few are wanted; the
   * UI cursor should use `nextPending()`.
   */
  pendingNotes(limit?: number): readonly ScoreNote[] {
    const max = limit ?? Number.POSITIVE_INFINITY
    invariant(max >= 0, `pendingNotes: limit must be a number >= 0, got ${limit}`)
    const out: ScoreNote[] = []
    for (let i = this.lo; i < this.expected.length && out.length < max; i++) {
      if (this.decided[i] === true) continue
      out.push(at(this.expected, i).note)
    }
    return out
  }

  /** The note the UI cursor sits on: first undecided expected note, if any. */
  nextPending(): ScoreNote | undefined {
    for (let i = this.lo; i < this.expected.length; i++) {
      if (this.decided[i] !== true) return at(this.expected, i).note
    }
    return undefined
  }

  /** Aggregate for the review overlay. */
  summary(): MatchSummary {
    const total = this.correctCount + this.wrongPitchCount + this.missedCount + this.extraCount
    return {
      correct: this.correctCount,
      wrongPitch: this.wrongPitchCount,
      missed: this.missedCount,
      extra: this.extraCount,
      accuracy: total === 0 ? 1 : this.correctCount / total,
      meanAbsDeviationMs: this.deviationCount === 0 ? 0 : this.deviationSum / this.deviationCount,
    }
  }

  /**
   * Rewind. With no argument, back to bar one. With `fromTick`, the matcher restarts as if the
   * performance began there: expected notes written before it retire silently, so a loop wrap does
   * not charge the learner for everything before the loop start.
   */
  reset(fromTick?: Ticks): void {
    if (fromTick !== undefined) {
      invariant(
        Number.isFinite(fromTick) && fromTick >= 0,
        `reset: fromTick must be a finite tick >= 0, got ${fromTick}`,
      )
    }

    this.decided.fill(false)
    this.charged.fill(false)
    this.out.length = 0
    this.held.clear()
    this.recent = []
    this.recentLo = 0
    this.lo = 0
    this.mutedLo = 0
    this.nowMs = -Infinity
    this.correctCount = 0
    this.wrongPitchCount = 0
    this.missedCount = 0
    this.extraCount = 0
    this.deviationSum = 0
    this.deviationCount = 0
    this.steps = 0

    if (fromTick === undefined) return
    // Retire everything strictly before `fromTick`, silently: no `missed` verdict, no trace in
    // `results`. A chord's members share one `startTick`, so a chord is never split by this — the
    // threshold either clears the whole group or none of it. `lo`/`mutedLo` move forward only, so
    // the skip costs exactly the number of retired notes, never a rescan of the score.
    const thresholdMs = tickToMs(this.tempo, fromTick)
    while (this.lo < this.expected.length && at(this.expected, this.lo).ms < thresholdMs) {
      // defensive: no reader can observe this — every reader starts scanning from `this.lo`,
      // which this loop is about to advance past index `this.lo` anyway.
      this.decided[this.lo] = true
      this.lo += 1
    }
    while (this.mutedLo < this.muted.length && at(this.muted, this.mutedLo).ms < thresholdMs) {
      this.mutedLo += 1
    }
  }

  // ---------------------------------------------------------------- internals

  /**
   * Move the clock forward and retire everything the move left behind. The
   * clock never goes backwards, so a stray out-of-order event cannot un-decide
   * a note or rewind a cursor. A note already charged with a `wrongPitch`
   * retires silently: it has been paid for once already.
   */
  private closeWindows(atMs: number, produced: MatchResult[]): void {
    if (atMs > this.nowMs) this.nowMs = atMs
    const now = this.nowMs
    while (this.lo < this.expected.length) {
      const e = at(this.expected, this.lo)
      if (this.decided[this.lo] === true) {
        this.lo += 1
        continue
      }
      // Still reachable: a press at exactly `ms + tolerance` must count.
      if (e.ms + this.tolerance >= now) break
      const wasCharged = this.charged[this.lo] === true
      this.decided[this.lo] = true
      if (!wasCharged) {
        this.record(
          { verdict: 'missed', expected: e.note, atMs: asMillis(e.ms + this.tolerance) },
          produced,
        )
      }
      this.lo += 1
    }
    while (
      this.recentLo < this.recent.length &&
      at(this.recent, this.recentLo).ms + this.tolerance < now
    ) {
      this.recentLo += 1
    }
    if (this.recentLo > RECENT_COMPACT_AT) {
      this.recent = this.recent.slice(this.recentLo)
      this.recentLo = 0
    }
    while (
      this.mutedLo < this.muted.length &&
      at(this.muted, this.mutedLo).ms + this.tolerance < now
    )
      this.mutedLo += 1
  }

  /** Decide one press. Produces exactly one verdict, or none when it is muted. */
  private classify(note: Midi, t: number, produced: MatchResult[]): void {
    const pitched = this.nearestPendingOfPitch(note, t)
    if (pitched >= 0) {
      const e = at(this.expected, pitched)
      this.decided[pitched] = true
      this.recent.push({ midi: note, ms: t })
      this.record(this.attributed('correct', e, note, t), produced)
      return
    }

    // A muted hand is not the learner's problem right now: no verdict at all.
    if (this.matchesMuted(note, t)) return

    // A stutter on the note just played is a doubling, not a substitution.
    if (!this.wasJustPlayed(note, t)) {
      const substituted = this.nearestChargeable(t)
      if (substituted >= 0) {
        const e = at(this.expected, substituted)
        // Charged, not decided: the correction that usually follows must still
        // be able to land on this note.
        this.charged[substituted] = true
        this.record(this.attributed('wrongPitch', e, note, t), produced)
        return
      }
    }
    this.record({ verdict: 'extra', playedMidi: note, atMs: asMillis(t) }, produced)
  }

  /** Build the verdict for a press that was pinned to an expected note. */
  private attributed(
    verdict: 'correct' | 'wrongPitch',
    e: Expected,
    note: Midi,
    t: number,
  ): MatchResult {
    const deviationMs = t - e.ms
    // A rolled chord is one gesture, so its members get the wider band.
    const band = e.chordSize > 1 ? Math.max(this.onTime, this.chordWindow) : this.onTime
    const timing: TimingVerdict =
      Math.abs(deviationMs) <= band ? 'onTime' : deviationMs < 0 ? 'early' : 'late'
    return {
      verdict,
      expected: e.note,
      playedMidi: note,
      timing,
      deviationMs,
      atMs: asMillis(t),
    }
  }

  /** Closest undecided expected note of this pitch to `t`; `-1` if none. */
  private nearestPendingOfPitch(note: Midi, t: number): number {
    let best = -1
    let bestDistance = Infinity
    for (let i = this.lo; i < this.expected.length; i++) {
      this.steps += 1
      const e = at(this.expected, i)
      if (e.ms > t + this.tolerance) break
      if (this.decided[i] === true) continue
      const distance = Math.abs(e.ms - t)
      if (distance > this.tolerance || !this.samePitch(e.note.midi, note)) continue
      // `<` not `<=`: on a tie the earlier note wins, so repeated pitches are
      // consumed left to right.
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    return best
  }

  /**
   * The expected note a wrong key press should be charged to: nearest, but a
   * note already due outranks one still to come, and a note already charged is
   * out of the running. One pass, both preferences.
   */
  private nearestChargeable(t: number): number {
    let due = -1
    let dueDistance = Infinity
    let upcoming = -1
    let upcomingDistance = Infinity
    for (let i = this.lo; i < this.expected.length; i++) {
      this.steps += 1
      const e = at(this.expected, i)
      if (e.ms > t + this.tolerance) break
      if (this.decided[i] === true || this.charged[i] === true) continue
      const distance = Math.abs(e.ms - t)
      if (distance > this.tolerance) continue
      if (e.ms <= t) {
        if (distance < dueDistance) {
          dueDistance = distance
          due = i
        }
      } else if (distance < upcomingDistance) {
        upcomingDistance = distance
        upcoming = i
      }
    }
    return due >= 0 ? due : upcoming
  }

  private samePitch(a: number, b: number): boolean {
    return this.ignoreOctave ? (a - b) % SEMITONES_PER_OCTAVE === 0 : a === b
  }

  private matchesMuted(note: Midi, t: number): boolean {
    for (let i = this.mutedLo; i < this.muted.length; i++) {
      const m = at(this.muted, i)
      if (m.ms > t + this.tolerance) return false
      if (Math.abs(m.ms - t) <= this.tolerance && this.samePitch(m.midi, note)) return true
    }
    return false
  }

  private wasJustPlayed(note: Midi, t: number): boolean {
    for (let i = this.recentLo; i < this.recent.length; i++) {
      const r = at(this.recent, i)
      if (Math.abs(r.ms - t) <= this.tolerance && this.samePitch(r.midi, note)) return true
    }
    return false
  }

  private record(result: MatchResult, produced: MatchResult[]): void {
    this.out.push(result)
    produced.push(result)
    if (result.verdict === 'correct') this.correctCount += 1
    else if (result.verdict === 'wrongPitch') this.wrongPitchCount += 1
    else if (result.verdict === 'missed') this.missedCount += 1
    else this.extraCount += 1
    if (result.deviationMs !== undefined) {
      this.deviationSum += Math.abs(result.deviationMs)
      this.deviationCount += 1
    }
  }
}
