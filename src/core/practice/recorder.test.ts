import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MidiEvent } from '@core/ports/index.ts'
import { InvariantError } from '@core/shared/invariant.ts'
import {
  TICKS_PER_QUARTER,
  bpm as asBpm,
  midi as asMidi,
  millis as asMillis,
  ticks as asTicks,
} from '@core/shared/units.ts'
import { makeTempoMap, type TempoMap, type TempoMark } from '@core/timing/tempo.ts'
import { FakeClock } from '@test/fakes.ts'
import { MidiRecorder, recordingToScore, replayEvents, type Recording } from './recorder.ts'

// -------------------------------------------------------------------- helpers

const mark = (tick: number, bpm: number): TempoMark => ({ tick: asTicks(tick), bpm: asBpm(bpm) })

const tempo: TempoMap = makeTempoMap([mark(0, 120)])

/** A finished `Recording`, built without going through `MidiRecorder` — for
 * exercising `recordingToScore` and `replayEvents` against hand-assembled input,
 * including shapes `MidiRecorder` itself would never produce (e.g. a dangling
 * note-on), which is what proves those functions are defensive on their own. */
function recordingOf(events: readonly MidiEvent[], durationMs: number, id = 'test-rec'): Recording {
  return { id, recordedAt: 0, durationMs, events }
}

const on = (note: number, velocity: number, time: number): MidiEvent => ({
  type: 'noteOn',
  note: asMidi(note),
  velocity,
  time: asMillis(time),
})
const off = (note: number, time: number): MidiEvent => ({
  type: 'noteOff',
  note: asMidi(note),
  time: asMillis(time),
})
const sus = (down: boolean, time: number): MidiEvent => ({
  type: 'sustain',
  down,
  time: asMillis(time),
})

// ----------------------------------------------------------------- MidiRecorder

describe('MidiRecorder', () => {
  it('stores event times relative to start(), not the raw clock reading', () => {
    // The clock has been running a long time before this recording starts — the
    // obvious bug is storing clock.now() directly, which would begin at 500_000
    // and never replay the same way twice. Everything must be relative to 0.
    const clock = new FakeClock(500_000)
    const recorder = new MidiRecorder(clock, clock)

    recorder.start()
    clock.advance(500)
    recorder.noteOn(asMidi(60), 80)
    clock.advance(250)
    recorder.noteOff(asMidi(60))
    const recording = recorder.stop()

    expect(recording).toBeDefined()
    expect(recording?.events).toEqual([on(60, 80, 500), off(60, 750)])
    expect(recording?.durationMs).toBe(750)
  })

  it('stop() without start() returns undefined and recording stays false', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    expect(recorder.recording).toBe(false)
    expect(recorder.stop()).toBeUndefined()
  })

  it('recording reflects the active state across start/stop', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    expect(recorder.recording).toBe(false)
    recorder.start()
    expect(recorder.recording).toBe(true)
    recorder.stop()
    expect(recorder.recording).toBe(false)
  })

  it('rejects noteOn, noteOff and sustain before start()', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    expect(() => recorder.noteOn(asMidi(60), 80)).toThrow(InvariantError)
    expect(() => recorder.noteOff(asMidi(60))).toThrow(InvariantError)
    expect(() => recorder.sustain(true)).toThrow(InvariantError)
  })

  it('preserves sustain events in order alongside notes', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    recorder.start()
    recorder.sustain(true)
    clock.advance(100)
    recorder.noteOn(asMidi(60), 70)
    clock.advance(100)
    recorder.sustain(false)
    clock.advance(100)
    recorder.noteOff(asMidi(60))
    const recording = recorder.stop()

    expect(recording?.events).toEqual([
      sus(true, 0),
      on(60, 70, 100),
      sus(false, 200),
      off(60, 300),
    ])
  })

  it('closes an unmatched note-on at the recording end instead of dropping it', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    recorder.start()
    recorder.noteOn(asMidi(60), 80) // never released
    clock.advance(300)
    recorder.noteOn(asMidi(62), 90) // never released either
    clock.advance(100)
    const recording = recorder.stop()

    expect(recording?.durationMs).toBe(400)
    expect(recording?.events).toEqual([on(60, 80, 0), on(62, 90, 300), off(60, 400), off(62, 400)])
  })

  it('overlapping presses of the same pitch each get their own close (FIFO)', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    recorder.start()
    recorder.noteOn(asMidi(60), 80)
    clock.advance(100)
    recorder.noteOn(asMidi(60), 90) // second press before the first is released
    clock.advance(100)
    recorder.noteOff(asMidi(60)) // closes the OLDER open note-on
    clock.advance(100)
    recorder.noteOff(asMidi(60))
    const recording = recorder.stop()

    expect(recording?.events).toEqual([on(60, 80, 0), on(60, 90, 100), off(60, 200), off(60, 300)])
  })

  it('defaults the id from the wall-clock start time; an explicit id overrides it', () => {
    const clock = new FakeClock(0)
    const date = new FakeClock(1_700_000_000_000)
    const recorder = new MidiRecorder(clock, date)

    recorder.start()
    const first = recorder.stop()
    expect(first?.id).toBe('rec-1700000000000')
    expect(first?.recordedAt).toBe(1_700_000_000_000)

    recorder.start({ id: 'my-take' })
    const second = recorder.stop()
    expect(second?.id).toBe('my-take')
  })

  it('omits scoreId and tempoBpm entirely when not given, and carries them when given', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)

    recorder.start()
    const bare = recorder.stop()
    expect(bare).toBeDefined()
    expect('scoreId' in (bare as Recording)).toBe(false)
    expect('tempoBpm' in (bare as Recording)).toBe(false)

    recorder.start({ scoreId: 'piece-1', tempoBpm: 96 })
    const tagged = recorder.stop()
    expect(tagged?.scoreId).toBe('piece-1')
    expect(tagged?.tempoBpm).toBe(96)
  })

  it('a fresh start() discards whatever the previous take had captured', () => {
    const clock = new FakeClock()
    const recorder = new MidiRecorder(clock, clock)
    recorder.start()
    recorder.noteOn(asMidi(60), 80)
    recorder.start() // abandon the take above without stopping it
    recorder.noteOn(asMidi(62), 80)
    recorder.noteOff(asMidi(62))
    const recording = recorder.stop()
    expect(recording?.events).toEqual([on(62, 80, 0), off(62, 0)])
  })
})

// -------------------------------------------------------------- recordingToScore

describe('recordingToScore', () => {
  it('splits an unmatched note-on to the recording end rather than dropping it', () => {
    // 1000 ms at 120 bpm is 960 ticks — well inside the first 1920-tick bar, so
    // this exercises the close-at-end path without also exercising bar-splitting.
    const recording = recordingOf([on(60, 80, 0)], 1000)
    const score = recordingToScore(recording, tempo)

    expect(score.notes).toHaveLength(1)
    expect(score.notes[0]).toMatchObject({ midi: 60, startTick: 0, durationTicks: 960 })
  })

  it('gives overlapping presses of the same pitch two separate notes, not one', () => {
    const recording = recordingOf([on(60, 80, 0), on(60, 90, 100), off(60, 200), off(60, 300)], 300)
    const score = recordingToScore(recording, tempo)

    const sixties = score.notes.filter((n) => n.midi === 60)
    expect(sixties).toHaveLength(2)
    // 100 ms and 300 ms at 120 bpm are 96 and 288 ticks.
    expect(sixties.map((n) => n.startTick)).toEqual([0, 96])
    expect(sixties.map((n) => n.durationTicks)).toEqual([192, 192])
  })

  it('never produces a zero-length note, even from a same-millisecond on/off', () => {
    const recording = recordingOf([on(60, 80, 240), off(60, 240)], 240)
    const score = recordingToScore(recording, tempo)
    expect(score.notes).toHaveLength(1)
    expect(score.notes[0]?.durationTicks).toBeGreaterThan(0)
  })

  it('splits a note that crosses a barline into tied fragments', () => {
    // One bar is 1920 ticks = 2000 ms at 120 bpm. A note from 1500ms to 2500ms
    // (1440 to 2400 ticks) straddles the barline at 1920.
    const recording = recordingOf([on(60, 80, 1500), off(60, 2500)], 2500)
    const score = recordingToScore(recording, tempo)

    const fragments = score.notes.filter((n) => n.midi === 60)
    expect(fragments).toHaveLength(2)
    expect(fragments[0]).toMatchObject({ startTick: 1440, tiedFrom: false, tiedTo: true })
    expect(fragments[1]).toMatchObject({ startTick: 1920, tiedFrom: true, tiedTo: false })
    expect(fragments[0]?.startTick).toBeLessThan(fragments[1]?.startTick as number)
  })

  it('assigns hands by splitting at middle C, the same rule the SMF reader uses', () => {
    const recording = recordingOf([on(59, 80, 0), off(59, 100), on(60, 80, 500), off(60, 600)], 600)
    const score = recordingToScore(recording, tempo)
    expect(score.notes.find((n) => n.midi === 59)?.hand).toBe('left')
    expect(score.notes.find((n) => n.midi === 60)?.hand).toBe('right')
  })

  it('carries the tempo map marks into the built score', () => {
    const twoTempo = makeTempoMap([mark(0, 120), mark(1920, 90)])
    const recording = recordingOf([on(60, 80, 0), off(60, 100)], 100)
    const score = recordingToScore(recording, twoTempo)
    expect(score.tempos.map((t) => t.bpm)).toEqual([120, 90])
  })

  it('quantising never reorders two notes and never produces a non-positive duration', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: 1, max: 5 * TICKS_PER_QUARTER }),
        (t1, delta, lengthMs, q) => {
          const t2 = t1 + delta
          const events = [
            on(60, 80, t1),
            off(60, t1 + lengthMs),
            on(61, 80, t2),
            off(61, t2 + lengthMs),
          ].sort((a, b) => a.time - b.time)
          const recording = recordingOf(events, Math.max(t1, t2) + lengthMs)

          const score = recordingToScore(recording, tempo, { quantiseTicks: asTicks(q) })

          for (const note of score.notes) expect(note.durationTicks).toBeGreaterThan(0)

          const start60 = score.notes.find((n) => n.midi === 60 && !n.tiedFrom)?.startTick
          const start61 = score.notes.find((n) => n.midi === 61 && !n.tiedFrom)?.startTick
          expect(start60).toBeDefined()
          expect(start61).toBeDefined()
          // t1 <= t2 (delta >= 0), and rounding to a grid is monotonic non-decreasing,
          // so the note that started no later must still start no later once quantised.
          expect(start60 as number).toBeLessThanOrEqual(start61 as number)
        },
      ),
    )
  })

  it('rejects a non-positive quantiseTicks', () => {
    const recording = recordingOf([on(60, 80, 0), off(60, 100)], 100)
    expect(() => recordingToScore(recording, tempo, { quantiseTicks: asTicks(0) })).toThrow(
      InvariantError,
    )
  })
})

// -------------------------------------------------------------------- replayEvents

describe('replayEvents', () => {
  const recording = recordingOf([on(60, 80, 0), off(60, 100), on(62, 70, 200), off(62, 300)], 300)

  it('includes both boundary events exactly at fromMs and toMs', () => {
    const windowed = replayEvents(recording, asMillis(100), asMillis(200))
    expect(windowed).toEqual([off(60, 100), on(62, 70, 200)])
  })

  it('a zero-width window returns only events at that exact instant', () => {
    expect(replayEvents(recording, asMillis(0), asMillis(0))).toEqual([on(60, 80, 0)])
    expect(replayEvents(recording, asMillis(150), asMillis(150))).toEqual([])
  })

  it('defaults to the whole recording', () => {
    expect(replayEvents(recording)).toEqual(recording.events)
  })

  it('rejects fromMs after toMs', () => {
    expect(() => replayEvents(recording, asMillis(200), asMillis(100))).toThrow(InvariantError)
  })
})
