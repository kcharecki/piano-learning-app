import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildTestScore,
  C_MAJOR_SCALE_RH,
  TIED_NOTES,
  TWO_HAND_CHORDS,
} from '@core/notation/fixtures.ts'
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
    const h = started(C_MAJOR_SCALE_RH, {
      controllerScore: buildTestScore([{ midi: 60, startTick: QUARTER }], { id: 'other' }),
    })
    expect(() => pump(h)).toThrow(InvariantError)
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

  it('keeps its invariants under an arbitrary stream of playing and pumping', () => {
    type Step =
      | { readonly kind: 'pump'; readonly ms: number }
      | { readonly kind: 'press'; readonly midi: number }
      | { readonly kind: 'lift'; readonly midi: number }

    const keys = fc.constantFrom(60, 61, 62, 63, 64, 65, 67, 69, 71, 72)
    const step: fc.Arbitrary<Step> = fc.oneof(
      fc.integer({ min: 0, max: 900 }).map((ms) => ({ kind: 'pump', ms }) as const),
      keys.map((midi) => ({ kind: 'press', midi }) as const),
      keys.map((midi) => ({ kind: 'lift', midi }) as const),
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
          // waiting agrees with the transport, and with the requirement itself
          expect(h.transport.state === 'waiting').toBe(state.waiting)
          if (state.waiting) expect(satisfied(state).length).toBeLessThan(new Set(pitches).size)
          // the playhead only ever moves forwards
          const now = h.transport.positionTicks as number
          expect(now).toBeGreaterThanOrEqual(previous)
          previous = now
        }

        for (const s of steps) {
          if (s.kind === 'pump') pump(h, s.ms)
          else if (s.kind === 'press') press(h, s.midi)
          else lift(h, s.midi)
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
