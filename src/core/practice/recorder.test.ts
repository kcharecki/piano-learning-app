import { describe, expect, it } from 'vitest'
import type { MidiEvent } from '@core/ports/index.ts'
import { InvariantError } from '@core/shared/invariant.ts'
import { midi as asMidi, millis as asMillis } from '@core/shared/units.ts'
import { FakeClock } from '@test/fakes.ts'
import { MidiRecorder, type Recording } from './recorder.ts'

// -------------------------------------------------------------------- helpers

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
