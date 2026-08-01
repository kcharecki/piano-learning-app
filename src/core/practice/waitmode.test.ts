import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildTestScore,
  C_MAJOR_SCALE_RH,
  TIED_NOTES,
  TWO_HAND_CHORDS,
} from '@test/fixtures.ts'
import type { Hand, Score } from '@core/notation/score.ts'
import { InvariantError, at } from '@core/shared/invariant.ts'
import {
  QUARTER,
  midi as asMidi,
  millis as asMillis,
  ticks as asTicks,
  type Midi,
} from '@core/shared/units.ts'
import { makeTempoMap, msToTick, type TempoMap } from '@core/timing/tempo.ts'
import { Transport, type LoopRange, type TransportEvent } from '@core/timing/transport.ts'
import { FakeClock } from '@test/fakes.ts'
import {
  WaitModeController,
  type WaitModeSettings,
  type WaitModeUpdate,
  type WaitState,
} from './waitmode.ts'

// -------------------------------------------------------------------- helpers

type Harness = {
  readonly clock: FakeClock
  readonly transport: Transport
  readonly wait: WaitModeController
}

type SetupOptions = {
  readonly settings?: WaitModeSettings
  readonly loop?: LoopRange
  /** Deliberately hand the controller a score the transport is not playing. */
  readonly controllerScore?: Score
}

const tempoFor = (score: Score): TempoMap => makeTempoMap(score.tempos)

const setup = (score: Score = C_MAJOR_SCALE_RH, opts: SetupOptions = {}): Harness => {
  const clock = new FakeClock()
  const transport = new Transport({
    score,
    tempo: tempoFor(score),
    clock,
    ...(opts.loop === undefined ? {} : { loop: opts.loop }),
  })
  const wait = new WaitModeController(transport, opts.controllerScore ?? score, opts.settings)
  return { clock, transport, wait }
}

/** A harness whose transport is already rolling — the usual starting point. */
const started = (score?: Score, opts?: SetupOptions): Harness => {
  const h = setup(score, opts)
  h.transport.play()
  return h
}

const pump = (h: Harness, ms = 0): WaitModeUpdate => {
  h.clock.advance(ms)
  return h.wait.update()
}

const label = (e: TransportEvent): string =>
  e.type === 'noteOn'
    ? `on:${e.note.midi}`
    : e.type === 'noteOff'
      ? `off:${e.note.midi}`
      : e.type === 'measure'
        ? `measure:${e.index}`
        : e.type === 'loop'
          ? `loop:${e.iteration}`
          : 'end'

const labels = (u: WaitModeUpdate): string[] => u.events.map(label)

const press = (h: Harness, ...notes: readonly number[]): void => {
  for (const n of notes) h.wait.noteOn(asMidi(n))
}

const lift = (h: Harness, ...notes: readonly number[]): void => {
  for (const n of notes) h.wait.noteOff(asMidi(n))
}

/** Press and release, as one struck note. */
const strike = (h: Harness, ...notes: readonly number[]): void => {
  press(h, ...notes)
  lift(h, ...notes)
}

const required = (s: WaitState): number[] => s.requiredNotes.map((n) => n.midi)
const satisfied = (s: WaitState): number[] => [...s.satisfiedNotes]

const loopRange = (startTick: number, endTick: number): LoopRange => ({
  startTick: asTicks(startTick),
  endTick: asTicks(endTick),
})

// C_MAJOR_SCALE_RH: C4 D4 E4 F4 | G4 A4 B4 C5 as quarters at ♩=120 —
// one quarter is 480 ticks and 500 ms; the fixture is 2 bars / 4000 ms long.
const SCALE_MIDI = [60, 62, 64, 65, 67, 69, 71, 72] as const
const BAR = 1920

// -------------------------------------------------------------- initial state

describe('WaitModeController construction', () => {
  it('starts idle', () => {
    const { wait } = setup()
    expect(wait.state).toEqual({ waiting: false, requiredNotes: [], satisfiedNotes: [] })
  })

  it('pumping a stopped transport stays idle and emits nothing', () => {
    const h = setup()
    const u = pump(h, 5000)
    expect(u.events).toEqual([])
    expect(u.wait.waiting).toBe(false)
    expect(h.transport.positionTicks).toBe(0)
  })

  it('rejects a hand that is not a hand', () => {
    expect(() => setup(C_MAJOR_SCALE_RH, { settings: { hands: ['up' as Hand] } })).toThrow(
      InvariantError,
    )
  })

  it('copies the hands array, so a later mutation cannot change what is waited for', () => {
    const hands: Hand[] = ['right']
    const h = started(TWO_HAND_CHORDS, { settings: { hands } })
    hands.push('left')
    expect(required(pump(h).wait)).toEqual([72])
  })
})

// ------------------------------------------------------------- holding a note

describe('holding at a required onset', () => {
  it('arms on the first onset and freezes the playhead there', () => {
    const h = started()
    const u = pump(h)
    expect(labels(u)).toEqual(['measure:0', 'on:60'])
    expect(u.wait.waiting).toBe(true)
    expect(required(u.wait)).toEqual([60])
    expect(satisfied(u.wait)).toEqual([])
    expect(h.transport.state).toBe('waiting')
    expect(h.transport.positionTicks).toBe(0)
  })

  it('does not move the playhead however long the clock runs on', () => {
    const h = started()
    pump(h)
    for (const ms of [1, 250, 4000, 60_000]) {
      const u = pump(h, ms)
      expect(u.events).toEqual([])
      expect(u.wait.waiting).toBe(true)
      expect(h.transport.positionTicks).toBe(0)
    }
  })

  it('releases within the same update and loses no musical time', () => {
    const h = started()
    pump(h)
    pump(h, 30_000) // half a minute of hunting for the note
    press(h, 60)
    expect(h.wait.state.waiting).toBe(false)
    expect(h.transport.state).toBe('playing')
    // The 30 s wait is discarded: one more quarter note of wall time buys exactly
    // one more quarter note of music.
    const u = pump(h, 500)
    expect(labels(u)).toEqual(['off:60', 'on:62'])
    expect(h.transport.positionTicks).toBe(QUARTER)
  })

  it('the pump that drops the gate advances nothing by itself', () => {
    const h = started()
    pump(h)
    press(h, 60)
    const u = pump(h)
    expect(u.events).toEqual([])
    expect(h.transport.positionTicks).toBe(0)
  })

  it('re-arms on every following onset', () => {
    const h = started()
    pump(h)
    strike(h, 60)
    const u = pump(h, 500)
    expect(u.wait.waiting).toBe(true)
    expect(required(u.wait)).toEqual([62])
    expect(h.transport.positionTicks).toBe(QUARTER)
  })

  it('waits for nothing when no hand is waited for', () => {
    const h = started(C_MAJOR_SCALE_RH, { settings: { hands: [] } })
    expect(labels(pump(h))).toEqual(['measure:0', 'on:60'])
    expect(h.wait.state.waiting).toBe(false)
    expect(labels(pump(h, 500))).toEqual(['off:60', 'on:62'])
    expect(h.transport.positionTicks).toBe(QUARTER)
    expect(h.transport.state).toBe('playing')
  })
})

// ------------------------------------------------------- pumps that stall
//
// requestAnimationFrame is throttled to about 1 Hz in a background tab, and a GC
// pause can swallow several beats at once. One pump may therefore span more
// onsets than one — and every one of them is owed.

describe('a pump that spans several onsets', () => {
  it('stops on the first onset it owes, not the last', () => {
    // 1000 ms is two quarter notes: C4 must sound and the pump must stop there.
    const h = started()
    const u = pump(h, 1000)
    expect(labels(u)).toEqual(['measure:0', 'on:60'])
    expect(required(u.wait)).toEqual([60])
    expect(u.wait.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(0)
  })

  it('one pump longer than the whole piece still stops on the first onset', () => {
    const h = started()
    const u = pump(h, 60_000)
    expect(labels(u)).toEqual(['measure:0', 'on:60'])
    expect(h.transport.state).toBe('waiting')
    expect(h.transport.positionTicks).toBe(0)
  })

  it('waits for every note of the phrase in turn under 1 Hz frames', () => {
    const h = started()
    const sounded: number[] = []
    for (const note of SCALE_MIDI) {
      const u = pump(h, 1000)
      for (const e of u.events) if (e.type === 'noteOn') sounded.push(e.note.midi)
      expect(required(u.wait)).toEqual([note])
      expect(u.wait.waiting).toBe(true)
      // one owed onset per pump, so nothing can slip through unplayed
      expect(u.events.filter((e) => e.type === 'noteOn')).toHaveLength(1)
      strike(h, note)
    }
    expect(sounded).toEqual([...SCALE_MIDI])
  })

  it('sounds no chord it has not stopped on, however stalled the frame', () => {
    // TWO_HAND_CHORDS is 8 s long; this one pump is longer than two bars of it.
    const h = started(TWO_HAND_CHORDS, { settings: { hands: ['left'] } })
    const u = pump(h, 10_000)
    expect(required(u.wait)).toEqual([48, 52, 55])
    expect(u.events.filter((e) => e.type === 'noteOn').map((e) => e.note.midi)).toEqual([
      48, 52, 55, 72,
    ])
    expect(h.transport.positionTicks).toBe(0)
  })
})

// ------------------------------------------------------ where it freezes
//
// Every wait-mode test above pumps in exact multiples of the beat, where any
// overshoot is exactly zero. These do not.

describe('the frozen position is the onset itself', () => {
  it('parks exactly on the onset with 503 ms frames', () => {
    const h = started()
    const frozen: number[] = []
    for (const note of [60, 62, 64, 65]) {
      const u = pump(h, 503)
      expect(u.wait.waiting).toBe(true)
      expect(required(u.wait)).toEqual([note])
      frozen.push(h.transport.positionTicks)
      strike(h, note)
    }
    // not [482.88, 965.76, 1448.64, 1931.52]
    expect(frozen).toEqual([0, QUARTER, 2 * QUARTER, 3 * QUARTER])
  })

  it('parks exactly on the onset whatever the frame length', () => {
    for (const frame of [37, 503, 1234, 4999]) {
      const h = started()
      const frozen: number[] = []
      for (const note of SCALE_MIDI) {
        let u = pump(h, frame)
        for (let i = 0; i < 100 && !u.wait.waiting; i++) u = pump(h, frame)
        expect(required(u.wait)).toEqual([note])
        frozen.push(h.transport.positionTicks)
        strike(h, note)
      }
      expect(frozen).toEqual(SCALE_MIDI.map((_, i) => i * QUARTER))
    }
  })

  it('parks on a chord onset with every note of it ringing', () => {
    const h = started(TWO_HAND_CHORDS, { settings: { hands: ['left'] } })
    pump(h, 37)
    strike(h, 48, 52, 55)
    let u = pump(h, 1234)
    for (let i = 0; i < 100 && !u.wait.waiting; i++) u = pump(h, 1234)
    expect(required(u.wait)).toEqual([41, 45, 48])
    expect(h.transport.positionTicks).toBe(BAR)
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([41, 45, 48, 77])
  })
})

// --------------------------------------------- the transport moved under it

describe('pause, seek, stop and tempo during a wait', () => {
  it('a pause during a wait is not a wait', () => {
    const h = started()
    pump(h)
    expect(h.wait.state.waiting).toBe(true)

    h.transport.pause()
    expect(h.transport.state).toBe('paused')
    expect(h.wait.state.waiting).toBe(false)
    // the requirement survives the pause, so resuming waits for the same note
    expect(required(h.wait.state)).toEqual([60])
    expect(pump(h, 5000).events).toEqual([])
    expect(h.transport.positionTicks).toBe(0)

    h.transport.play()
    expect(h.transport.state).toBe('waiting')
    expect(h.wait.state.waiting).toBe(true)
    press(h, 60)
    expect(h.wait.state.waiting).toBe(false)
    expect(labels(pump(h, 500))).toEqual(['off:60', 'on:62'])
  })

  it('a seek during a wait re-arms on the new position', () => {
    const h = started()
    pump(h)
    strike(h, 60)
    expect(required(pump(h, 500).wait)).toEqual([62])

    h.transport.seekTick(asTicks(2 * QUARTER))
    expect(h.wait.state.waiting).toBe(false) // the playhead is no longer on an onset
    const u = pump(h)
    expect(labels(u)).toEqual(['off:62', 'on:64'])
    expect(required(u.wait)).toEqual([64])
    expect(u.wait.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(2 * QUARTER)

    strike(h, 64)
    expect(labels(pump(h, 500))).toEqual(['off:64', 'on:65'])
  })

  it('a seek backwards waits for the note it lands on all over again', () => {
    const h = started()
    pump(h)
    strike(h, 60)
    pump(h, 500)
    h.transport.seekTick(asTicks(0))
    const u = pump(h)
    expect(labels(u)).toEqual(['off:62', 'measure:0', 'on:60'])
    expect(required(u.wait)).toEqual([60])
    expect(u.wait.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(0)
  })

  it('a seek to the tick the playhead is parked on waits for that onset again', () => {
    // "Play me that note again" — the commonest gesture there is, and the one
    // the position alone cannot see, because it does not move. The seek rewinds
    // the transport's cursor, so D4 sounds again; without noticing the rewind the
    // controller still counts tick 480 as spent, arms the barrier on 960 instead,
    // and D4 goes past unwaited-for with E4 sounding straight after it.
    const h = started()
    pump(h)
    strike(h, 60)
    expect(required(pump(h, 500).wait)).toEqual([62])
    strike(h, 62)

    h.transport.seekTick(asTicks(QUARTER))
    expect(h.transport.positionTicks).toBe(QUARTER)
    const again = pump(h, 500)
    expect(labels(again)).toEqual(['off:62', 'on:62'])
    expect(required(again.wait)).toEqual([62])
    expect(again.wait.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(QUARTER)
  })

  it('a seek to the measure the playhead is parked on does the same', () => {
    const h = started()
    pump(h)
    strike(h, 60)

    h.transport.seekMeasure(0)
    const again = pump(h, 500)
    expect(labels(again)).toEqual(['off:60', 'measure:0', 'on:60'])
    expect(required(again.wait)).toEqual([60])
    expect(again.wait.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(0)
  })

  it('a stop during a wait clears it, and playing again waits from the top', () => {
    const h = started()
    pump(h)
    strike(h, 60)
    pump(h, 500)

    h.transport.stop()
    expect(h.wait.state.waiting).toBe(false)
    const stopped = pump(h, 1000)
    expect(labels(stopped)).toEqual(['off:62'])
    expect(stopped.wait).toEqual({ waiting: false, requiredNotes: [], satisfiedNotes: [] })
    expect(h.transport.barrierTick).toBeNull()

    h.transport.play()
    const again = pump(h)
    expect(labels(again)).toEqual(['measure:0', 'on:60'])
    expect(required(again.wait)).toEqual([60])
    expect(h.transport.positionTicks).toBe(0)
  })

  it('a stop and an immediate replay does not let the music run past the wait', () => {
    // No update between the two: the controller has to notice on its own that the
    // gate it installed was taken away by `stop`.
    const h = started()
    pump(h)
    h.transport.stop()
    h.transport.play()
    const u = pump(h, 5000)
    expect(labels(u)).toEqual(['off:60', 'measure:0', 'on:60'])
    expect(required(u.wait)).toEqual([60])
    expect(h.transport.positionTicks).toBe(0)
  })

  it('a tempo change during a wait leaves the playhead on the onset', () => {
    const h = started()
    pump(h)
    strike(h, 60)
    expect(required(pump(h, 503).wait)).toEqual([62])

    h.transport.setTempoScale(0.5)
    expect(h.transport.state).toBe('waiting')
    expect(h.wait.state.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(QUARTER)

    press(h, 62)
    // half speed: a quarter note is now a full second of wall time
    expect(pump(h, 500).events).toEqual([])
    expect(labels(pump(h, 500))).toEqual(['off:62', 'on:64'])
    expect(h.transport.positionTicks).toBe(2 * QUARTER)
  })
})

// -------------------------------------------------------------------- chords

describe('chords', () => {
  // TWO_HAND_CHORDS bar 1: LH C major triad C3 E3 G3 = 48 52 55, under RH C5 = 72.
  const leftHand = (settings: WaitModeSettings = {}): Harness =>
    started(TWO_HAND_CHORDS, { settings: { hands: ['left'], ...settings } })

  it('holds until every note of the triad is down', () => {
    const h = leftHand()
    const u = pump(h)
    expect(required(u.wait)).toEqual([48, 52, 55])

    press(h, 48)
    expect(h.wait.state.waiting).toBe(true)
    expect(satisfied(h.wait.state)).toEqual([48])
    press(h, 52)
    expect(h.wait.state.waiting).toBe(true)
    expect(satisfied(h.wait.state)).toEqual([48, 52])
    press(h, 55)
    expect(h.wait.state.waiting).toBe(false)
    expect(satisfied(h.wait.state)).toEqual([48, 52, 55])
  })

  it('accepts the chord notes in any order and across several updates', () => {
    const h = leftHand()
    pump(h)
    press(h, 55)
    expect(pump(h, 200).wait.waiting).toBe(true)
    press(h, 48)
    expect(pump(h, 200).wait.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(0)
    press(h, 52)
    expect(pump(h, 500).wait.waiting).toBe(false)
    expect(h.transport.positionTicks).toBe(QUARTER)
  })

  it('withdraws a chord note that is released again before the chord completes', () => {
    const h = leftHand()
    pump(h)
    press(h, 48, 52)
    expect(satisfied(h.wait.state)).toEqual([48, 52])
    lift(h, 48)
    expect(satisfied(h.wait.state)).toEqual([52])
    expect(h.wait.state.waiting).toBe(true)
    press(h, 55)
    expect(h.wait.state.waiting).toBe(true)
    press(h, 48)
    expect(h.wait.state.waiting).toBe(false)
  })

  it('releases on the first note when requireAllChordNotes is off', () => {
    const h = leftHand({ requireAllChordNotes: false })
    pump(h)
    press(h, 52)
    expect(h.wait.state.waiting).toBe(false)
    expect(satisfied(h.wait.state)).toEqual([52])
  })

  it('counts a doubled pitch once', () => {
    // Two voices on the same C4, plus an E4 — two distinct pitches to strike.
    const score = buildTestScore([
      { midi: 60, startTick: 0, voice: 1 },
      { midi: 60, startTick: 0, voice: 2 },
      { midi: 64, startTick: 0 },
    ])
    const h = started(score)
    expect(required(pump(h).wait)).toEqual([60, 60, 64])
    press(h, 60)
    expect(h.wait.state.waiting).toBe(true)
    press(h, 64)
    expect(h.wait.state.waiting).toBe(false)
  })

  it('a key held over from the previous onset does not satisfy a repeated pitch', () => {
    // C4 C4 — the same pitch twice, so the key must be released and re-struck.
    const score = buildTestScore([
      { midi: 60, startTick: 0 },
      { midi: 60, startTick: QUARTER },
    ])
    const h = started(score)
    pump(h)
    press(h, 60) // still down from here on
    const u = pump(h, 500)
    expect(required(u.wait)).toEqual([60])
    expect(u.wait.waiting).toBe(true)

    press(h, 60) // the key never came up: no strike, no credit
    expect(h.wait.state.waiting).toBe(true)
    expect(satisfied(h.wait.state)).toEqual([])
    expect(pump(h, 500).events).toEqual([])
    expect(h.transport.positionTicks).toBe(QUARTER)

    lift(h, 60)
    press(h, 60)
    expect(h.wait.state.waiting).toBe(false)
  })
})

// -------------------------------------------------------------- wrong notes

describe('wrong notes', () => {
  it('never advance the playhead', () => {
    const h = started()
    pump(h)
    for (const wrong of [59, 61, 62, 72, 21]) {
      press(h, wrong)
      const u = pump(h, 300)
      expect(u.events).toEqual([])
      expect(u.wait.waiting).toBe(true)
      expect(satisfied(u.wait)).toEqual([])
      expect(h.transport.positionTicks).toBe(0)
      lift(h, wrong)
    }
    press(h, 60)
    expect(h.wait.state.waiting).toBe(false)
  })

  it('wipe the chord progress when allowExtraNotes is off', () => {
    const h = started(TWO_HAND_CHORDS, {
      settings: { hands: ['left'], allowExtraNotes: false },
    })
    pump(h)
    press(h, 48, 52)
    expect(satisfied(h.wait.state)).toEqual([48, 52])
    press(h, 50) // a wrong note in the middle of the chord
    expect(satisfied(h.wait.state)).toEqual([])
    expect(h.wait.state.waiting).toBe(true)
    // and the chord has to come out clean
    lift(h, 48, 52)
    press(h, 48, 52, 55)
    expect(h.wait.state.waiting).toBe(false)
  })

  it('are inert while nothing is armed', () => {
    const h = started(C_MAJOR_SCALE_RH, { settings: { hands: [] } })
    pump(h)
    press(h, 61)
    expect(h.wait.state).toEqual({ waiting: false, requiredNotes: [], satisfiedNotes: [] })
    lift(h, 61)
    expect(h.transport.state).toBe('playing')
  })
})

// -------------------------------------------------------------------- hands

describe('hands', () => {
  it('plays the muted hand automatically and never waits for it', () => {
    // hands: ['right'] over TWO_HAND_CHORDS — the LH triads sound without being played.
    const h = started(TWO_HAND_CHORDS, { settings: { hands: ['right'] } })
    const first = pump(h)
    expect(labels(first)).toEqual(['measure:0', 'on:48', 'on:52', 'on:55', 'on:72'])
    expect(required(first.wait)).toEqual([72])

    const armed: number[][] = []
    for (const note of [72, 74, 76, 77]) {
      expect(required(h.wait.state)).toEqual([note])
      armed.push(required(h.wait.state))
      strike(h, note)
      pump(h, 500)
    }
    // Nothing left-handed was ever asked for.
    expect(armed.flat()).toEqual([72, 74, 76, 77])
    expect(h.transport.positionTicks).toBe(4 * QUARTER)
  })

  it('waits for the left hand alone over the first two bars', () => {
    // TWO_HAND_CHORDS: bar 1 is I (C3 E3 G3 = 48 52 55), bar 2 is IV (F2 A2 C3 = 41 45 48).
    const h = started(TWO_HAND_CHORDS, { settings: { hands: ['left'] } })
    expect(required(pump(h).wait)).toEqual([48, 52, 55])
    strike(h, 48, 52, 55)

    // The RH melody plays itself for the rest of the bar.
    expect(labels(pump(h, 500))).toEqual(['off:72', 'on:74'])
    expect(pump(h, 500).wait.waiting).toBe(false)

    const u = pump(h, 1000)
    expect(u.wait.waiting).toBe(true)
    expect(required(u.wait)).toEqual([41, 45, 48])
    expect(h.transport.positionTicks).toBe(BAR)
  })
})

// --------------------------------------------------------------------- ties

describe('ties', () => {
  it('never waits for a tied continuation', () => {
    // TIED_NOTES: E4 half | C4 half ~ | ~ C4 half | G4 half. The third note
    // continues the second, so no key press is expected on it.
    const h = started(TIED_NOTES)
    expect(required(pump(h).wait)).toEqual([64])
    strike(h, 64)

    const second = pump(h, 1000) // a half note is 1000 ms at ♩=120
    expect(required(second.wait)).toEqual([60])
    press(h, 60) // held through the tie, deliberately not released

    const across = pump(h, 1000)
    expect(labels(across)).toEqual(['measure:1', 'off:60', 'on:60'])
    expect(across.wait.waiting).toBe(false)
    expect(h.transport.positionTicks).toBe(BAR)

    const fourth = pump(h, 1000)
    expect(required(fourth.wait)).toEqual([67])
    expect(fourth.wait.waiting).toBe(true)
  })
})

// ------------------------------------------------------------------ looping

describe('looping', () => {
  const twoQuarters = (): Harness => started(C_MAJOR_SCALE_RH, { loop: loopRange(0, 2 * QUARTER) })

  it('re-arms the wait at the wrap point', () => {
    const h = twoQuarters()
    expect(required(pump(h).wait)).toEqual([60])
    strike(h, 60)
    expect(required(pump(h, 500).wait)).toEqual([62])
    strike(h, 62)

    const wrapped = pump(h, 500)
    expect(labels(wrapped)).toEqual(['off:62', 'loop:1', 'measure:0', 'on:60'])
    expect(wrapped.wait.waiting).toBe(true)
    expect(required(wrapped.wait)).toEqual([60])
    expect(satisfied(wrapped.wait)).toEqual([])
    expect(h.transport.positionTicks).toBe(0)
    expect(h.transport.loopIteration).toBe(1)
  })

  it('makes a pitch held across the wrap be struck again', () => {
    const h = twoQuarters()
    pump(h)
    press(h, 60) // satisfies the first quarter, and is never released
    pump(h, 500) // arms D4
    strike(h, 62)
    const wrapped = pump(h, 500) // wraps and re-arms on C4, which is still down

    expect(required(wrapped.wait)).toEqual([60])
    expect(h.wait.state.waiting).toBe(true)
    press(h, 60)
    expect(h.wait.state.waiting).toBe(true)
    lift(h, 60)
    press(h, 60)
    expect(h.wait.state.waiting).toBe(false)
  })

  it('re-arms after the wrap when the pass owes a single onset', () => {
    // The one owed onset of the pass is the one the playhead is standing on, so
    // the wrap has to happen before the wait can be armed again — and it must not
    // run past that onset on the way, however long the frames are.
    const h = started(TWO_HAND_CHORDS, {
      settings: { hands: ['left'] },
      loop: loopRange(0, BAR),
    })
    expect(required(pump(h).wait)).toEqual([48, 52, 55])
    strike(h, 48, 52, 55)

    const events: string[] = []
    for (let i = 0; i < 3; i++) events.push(...labels(pump(h, 5000)))
    // the right hand finishes the bar by itself, then the pass starts over
    expect(events.filter((e) => e.startsWith('on:'))).toEqual([
      'on:74',
      'on:76',
      'on:77',
      'on:48',
      'on:52',
      'on:55',
      'on:72',
    ])
    expect(events).toContain('loop:1')
    expect(required(h.wait.state)).toEqual([48, 52, 55])
    expect(h.wait.state.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(0)
    expect(h.transport.loopIteration).toBe(1)
  })

  it('costs the pass no music when it owes a single onset', () => {
    // Loop over E4 alone (tick 960 to 1440), at 60 Hz. Once E4 is struck the pass
    // owes nothing more, so the fence that keeps the pump from wrapping ahead of
    // the wait belongs at the wrap, not under the playhead: 480 ticks of music at
    // 16 ticks a frame is 30 frames, and not one of them may be spent standing
    // still. Fenced half a tick ahead instead, two frames in a row froze and the
    // half tick then rode along for the rest of the pass.
    const h = setup(C_MAJOR_SCALE_RH, { loop: loopRange(2 * QUARTER, 3 * QUARTER) })
    h.transport.seekTick(asTicks(2 * QUARTER))
    h.transport.play()
    expect(required(pump(h).wait)).toEqual([64])
    strike(h, 64)

    const barriers: (number | null)[] = []
    const wrapEvents: string[] = []
    let frames = 0
    for (let i = 0; i < 60 && wrapEvents.length === 0; i++) {
      const u = pump(h, 1000 / 60)
      barriers.push(h.transport.barrierTick)
      frames += 1
      if (u.events.some((e) => e.type === 'loop')) wrapEvents.push(...labels(u))
    }
    expect(frames).toBe(30)
    // and every barrier armed along the way is a whole tick, so no consumer of
    // positionTicks is handed a fraction of one
    for (const barrier of barriers) expect(barrier === null || Number.isInteger(barrier)).toBe(true)
    expect(wrapEvents).toEqual(['off:64', 'loop:1', 'on:64'])
    expect(required(h.wait.state)).toEqual([64])
    expect(h.wait.state.waiting).toBe(true)
    expect(h.transport.positionTicks).toBe(2 * QUARTER)
  })

  it('fences half way when the onset is the last whole tick of the pass', () => {
    // Nothing whole left to stop on: the onset IS the tick before the wrap. The
    // pump must still be stopped short of the wrap, however long the frame.
    const score = buildTestScore([{ midi: 60, startTick: 479, durationTicks: 1 }])
    const h = setup(score, { loop: loopRange(0, 480) })
    h.transport.seekTick(asTicks(479))
    h.transport.play()
    expect(required(pump(h).wait)).toEqual([60])
    strike(h, 60)

    const events: string[] = []
    for (let i = 0; i < 4; i++) events.push(...labels(pump(h, 5000)))
    expect(events.filter((e) => e.startsWith('on:'))).toEqual(['on:60'])
    expect(events).toContain('loop:1')
    expect(h.wait.state.waiting).toBe(true)
    expect(required(h.wait.state)).toEqual([60])
    expect(h.transport.positionTicks).toBe(479)
  })

  it('a wrap that lands on nothing waited for leaves the gate down', () => {
    // Loop over the second half of bar 1 only, with the left hand muted: the wrap
    // point (tick 960) carries no right-hand onset, so nothing re-arms there.
    const h = started(C_MAJOR_SCALE_RH, {
      settings: { hands: ['left'] },
      loop: loopRange(0, 2 * QUARTER),
    })
    const first = pump(h)
    expect(first.wait.waiting).toBe(false)
    const wrapped = pump(h, 1000)
    expect(labels(wrapped)).toContain('loop:1')
    expect(wrapped.wait.waiting).toBe(false)
  })
})

// ------------------------------------------------------------ end and reset

describe('end, stop and reset', () => {
  it('clears the wait when the piece ends', () => {
    const h = started()
    pump(h)
    for (const note of SCALE_MIDI) {
      expect(h.wait.state.waiting).toBe(true)
      strike(h, note)
      pump(h, 500)
    }
    expect(h.transport.state).toBe('stopped')
    expect(h.wait.state).toEqual({ waiting: false, requiredNotes: [], satisfiedNotes: [] })
  })

  it('clears the wait after the transport is stopped', () => {
    const h = started()
    pump(h)
    expect(h.wait.state.waiting).toBe(true)
    h.transport.stop()
    const u = pump(h, 1000)
    expect(labels(u)).toEqual(['off:60'])
    expect(u.wait.waiting).toBe(false)
    expect(u.wait.requiredNotes).toEqual([])
  })

  it('reset drops the gate and lets playback carry on', () => {
    const h = started()
    pump(h)
    h.wait.reset()
    expect(h.wait.state).toEqual({ waiting: false, requiredNotes: [], satisfiedNotes: [] })
    expect(h.transport.state).toBe('playing')
    const u = pump(h, 500)
    expect(labels(u)).toEqual(['off:60', 'on:62'])
    expect(required(u.wait)).toEqual([62])
  })

  it('reset forgets the keys believed to be down', () => {
    const h = started()
    pump(h)
    press(h, 62) // wrong note, now down
    h.wait.reset()
    pump(h, 500) // arms on D4
    press(h, 62) // would be ignored as "already down" without the reset
    expect(h.wait.state.waiting).toBe(false)
  })

  it('reset is idempotent', () => {
    const h = started()
    pump(h)
    h.wait.reset()
    const first = h.wait.state
    h.wait.reset()
    expect(h.wait.state).toBe(first)
  })
})

// -------------------------------------------------------- programmer errors

describe('programmer errors', () => {
  it('rejects a note number outside the MIDI range', () => {
    const h = started()
    expect(() => h.wait.noteOn(128 as unknown as Midi)).toThrow(InvariantError)
    expect(() => h.wait.noteOff(-1 as unknown as Midi)).toThrow(InvariantError)
  })

  it('rejects a controller score that is not the one the transport is playing', () => {
    // The controller stops the playhead on tick 240, where its own score has a
    // note and the score actually being played has none: nothing sounds there,
    // and the wait it would arm is fiction.
    const h = started(C_MAJOR_SCALE_RH, {
      controllerScore: buildTestScore([{ midi: 60, startTick: 240 }], { id: 'other' }),
    })
    expect(() => pump(h, 500)).toThrow(InvariantError)
  })
})

// ---------------------------------------------------------------- real music

describe('real music', () => {
  it('walks the C major scale one note at a time', () => {
    // C4 D4 E4 F4 | G4 A4 B4 C5 — at ♩=120 each note is 480 ticks / 500 ms, and
    // the playhead may only sit on multiples of 480 however long the learner takes.
    const h = started()
    pump(h)
    for (let i = 0; i < SCALE_MIDI.length; i++) {
      const note = at(SCALE_MIDI, i)
      expect(h.wait.state.waiting).toBe(true)
      expect(required(h.wait.state)).toEqual([note])
      expect(h.transport.positionTicks).toBe(i * QUARTER)
      pump(h, 3000) // dawdling costs nothing
      expect(h.transport.positionTicks).toBe(i * QUARTER)
      strike(h, note)
      pump(h, 500)
    }
    expect(h.transport.state).toBe('stopped')
  })
})

// --------------------------------------------------------------- properties

describe('WaitModeController properties', () => {
  const scaleTempo = tempoFor(C_MAJOR_SCALE_RH)
  const runs = { numRuns: 60 }

  it('freezes the playhead for as long as the gate is up', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20_000 }), { maxLength: 10 }), (deltas) => {
        const h = started()
        pump(h)
        for (const ms of deltas) {
          const u = pump(h, ms)
          expect(u.events).toEqual([])
          expect(u.wait.waiting).toBe(true)
          expect(h.transport.positionTicks).toBe(0)
        }
      }),
      runs,
    )
  })

  it('never advances on notes that were not asked for', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 21, max: 108 }).filter((n) => n !== 60),
          { maxLength: 8 },
        ),
        (wrong) => {
          const h = started()
          pump(h)
          for (const n of wrong) press(h, n)
          const u = pump(h, 1000)
          expect(u.events).toEqual([])
          expect(u.wait.waiting).toBe(true)
          expect(satisfied(u.wait)).toEqual([])
          expect(h.transport.positionTicks).toBe(0)
        },
      ),
      runs,
    )
  })

  it('loses no musical time however long the wait lasted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60_000 }),
        fc.integer({ min: 0, max: 499 }),
        (waitMs, resumeMs) => {
          const h = started()
          pump(h)
          pump(h, waitMs)
          press(h, 60)
          pump(h, resumeMs)
          // The playhead is where `resumeMs` of playing time puts it, full stop.
          expect(h.transport.positionTicks).toBe(msToTick(scaleTempo, asMillis(resumeMs)))
        },
      ),
      runs,
    )
  })

  it('is indifferent to the order the chord notes arrive in', () => {
    const permutations = [
      [48, 52, 55],
      [48, 55, 52],
      [52, 48, 55],
      [52, 55, 48],
      [55, 48, 52],
      [55, 52, 48],
    ] as const
    fc.assert(
      fc.property(fc.constantFrom(...permutations), (order) => {
        const h = started(TWO_HAND_CHORDS, { settings: { hands: ['left'] } })
        pump(h)
        for (let i = 0; i < order.length; i++) {
          press(h, at(order, i))
          expect(h.wait.state.waiting).toBe(i < order.length - 1)
        }
        expect(
          satisfied(h.wait.state)
            .slice()
            .sort((a, b) => a - b),
        ).toEqual([48, 52, 55])
        pump(h, 500)
        expect(h.transport.positionTicks).toBe(QUARTER)
      }),
      runs,
    )
  })

  it('sounds at most one owed onset per pump, however long the pump', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 30 }),
        fc.boolean(),
        (deltas, playAlong) => {
          const h = started()
          const heard: number[] = []
          for (const ms of deltas) {
            const u = pump(h, ms)
            const attacks = u.events.filter((e) => e.type === 'noteOn')
            // every note of this fixture is owed, so a pump may sound one at most
            expect(attacks.length).toBeLessThanOrEqual(1)
            for (const e of attacks) heard.push(e.note.midi)
            // nothing sounds out of order and nothing is skipped
            expect(heard).toEqual(SCALE_MIDI.slice(0, heard.length))
            if (playAlong && u.wait.waiting) strike(h, at(SCALE_MIDI, heard.length - 1))
          }
        },
      ),
      runs,
    )
  })

  it('keeps its invariants under an arbitrary stream of playing and pumping', () => {
    type Step =
      | { readonly kind: 'pump'; readonly ms: number }
      | { readonly kind: 'press'; readonly midi: number }
      | { readonly kind: 'lift'; readonly midi: number }
      | { readonly kind: 'pause' }
      | { readonly kind: 'resume' }
      | { readonly kind: 'stop' }
      | { readonly kind: 'seek'; readonly tick: number }
      | { readonly kind: 'tempo'; readonly scale: number }

    const keys = fc.constantFrom(60, 61, 62, 63, 64, 65, 67, 69, 71, 72)
    // Transport commands are rare on purpose: they must not drown out the runs
    // that simply play the piece.
    const step: fc.Arbitrary<Step> = fc.oneof(
      {
        weight: 6,
        arbitrary: fc.integer({ min: 0, max: 900 }).map((ms) => ({ kind: 'pump', ms }) as const),
      },
      { weight: 4, arbitrary: keys.map((midi) => ({ kind: 'press', midi }) as const) },
      { weight: 4, arbitrary: keys.map((midi) => ({ kind: 'lift', midi }) as const) },
      { weight: 1, arbitrary: fc.constant({ kind: 'pause' } as const) },
      { weight: 1, arbitrary: fc.constant({ kind: 'resume' } as const) },
      { weight: 1, arbitrary: fc.constant({ kind: 'stop' } as const) },
      {
        weight: 1,
        arbitrary: fc
          .integer({ min: 0, max: 4 * BAR })
          .map((tick) => ({ kind: 'seek', tick }) as const),
      },
      {
        weight: 1,
        arbitrary: fc
          .constantFrom(0.5, 1, 1.75)
          .map((scale) => ({ kind: 'tempo', scale }) as const),
      },
    )

    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const h = started()
        let previous = 0
        const check = (): void => {
          const state = h.wait.state
          const pitches = required(state)
          // satisfied is always a duplicate-free subset of what was asked for
          expect(new Set(satisfied(state)).size).toBe(satisfied(state).length)
          for (const s of satisfied(state)) expect(pitches).toContain(s)
          // waiting says exactly what the transport says: the gate is up AND the
          // playhead is parked on the onset. A pause, a stop or a seek breaks one
          // of the two, and is reported as not waiting the moment it happens.
          expect(state.waiting).toBe(h.transport.state === 'waiting' && h.transport.isAtBarrier)
          if (state.waiting) {
            expect(satisfied(state).length).toBeLessThan(new Set(pitches).size)
            // and it is frozen ON the onset, never a fraction of a frame past it
            expect(h.transport.positionTicks).toBe(at(state.requiredNotes, 0).startTick)
          }
          // the playhead only ever moves forwards between transport commands
          const now = h.transport.positionTicks as number
          expect(now).toBeGreaterThanOrEqual(previous)
          previous = now
        }

        for (const s of steps) {
          if (s.kind === 'pump') pump(h, s.ms)
          else if (s.kind === 'press') press(h, s.midi)
          else if (s.kind === 'lift') lift(h, s.midi)
          else if (s.kind === 'pause') h.transport.pause()
          else if (s.kind === 'resume') h.transport.play()
          else if (s.kind === 'stop') h.transport.stop()
          else if (s.kind === 'seek') h.transport.seekTick(asTicks(s.tick))
          else h.transport.setTempoScale(s.scale)
          // a command that moves the playhead restarts the monotonicity check
          if (s.kind !== 'pump' && s.kind !== 'press' && s.kind !== 'lift') {
            previous = h.transport.positionTicks as number
          }
          check()
        }
      }),
      runs,
    )
  })

  it('reset always returns the same idle state', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 900 }), { maxLength: 12 }), (deltas) => {
        const h = started()
        for (const ms of deltas) {
          pump(h, ms)
          press(h, 60)
        }
        h.wait.reset()
        const idle = h.wait.state
        h.wait.reset()
        expect(h.wait.state).toBe(idle)
        expect(idle).toEqual({ waiting: false, requiredNotes: [], satisfiedNotes: [] })
      }),
      runs,
    )
  })
})
