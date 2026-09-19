import { describe, expect, it } from 'vitest'
import {
  CLICK_ACCENT_NOTE,
  CLICK_NOTE,
  createMidiDrumOutput,
  DRUM_MIDI_CHANNEL,
  STRIKE_GATE_MS,
} from '@adapters/audio/drumMidiOut.ts'
import { RecordingMidiOutput } from '@test/fakes.ts'
import { millis } from '@core/shared/units.ts'

function outputAt(startMs: number) {
  let current = startMs
  const midiOut = new RecordingMidiOutput()
  const out = createMidiDrumOutput({ output: midiOut, now: () => millis(current) })
  return {
    midiOut,
    out,
    advance(ms: number) {
      current += ms
    },
  }
}

describe('createMidiDrumOutput', () => {
  it('strike sends a gated noteOn/noteOff pair on channel 10, at now()', () => {
    const { midiOut, out } = outputAt(1000)

    out.strike('kick', 100)

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 36, at: 1000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 36, at: 1000 + STRIKE_GATE_MS, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  it('strike honours an explicit atMs instead of now()', () => {
    const { midiOut, out } = outputAt(1000)

    out.strike('snare', 100, millis(5000))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 38, at: 5000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 38, at: 5000 + STRIKE_GATE_MS, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  it('click(true) plays the accented wood-block note', () => {
    const { midiOut, out } = outputAt(0)

    out.click(true)

    expect(midiOut.sent[0]).toMatchObject({ kind: 'noteOn', note: CLICK_ACCENT_NOTE })
  })

  it('click(false) plays the plain wood-block note', () => {
    const { midiOut, out } = outputAt(0)

    out.click(false)

    expect(midiOut.sent[0]).toMatchObject({ kind: 'noteOn', note: CLICK_NOTE })
  })

  it('click with gain <= 0 schedules nothing at all', () => {
    const { midiOut, out } = outputAt(0)

    out.click(false, undefined, 0)

    expect(midiOut.sent).toEqual([])
  })

  it('velocity is never rounded down to 0 — a whisper-quiet strike still sounds', () => {
    const midiOut = new RecordingMidiOutput()
    const sentVelocities: number[] = []
    const originalNoteOn = midiOut.noteOn.bind(midiOut)
    midiOut.noteOn = (note, velocity, atMs, channel) => {
      sentVelocities.push(velocity)
      originalNoteOn(note, velocity, atMs, channel)
    }
    const out = createMidiDrumOutput({ output: midiOut, now: () => millis(0) })

    out.setVolume(0.01)
    out.strike('kick', 1)

    expect(sentVelocities).toEqual([1])
  })

  it('setVolume(0.5) then strike velocity 100 sends MIDI velocity 50', () => {
    const midiOut = new RecordingMidiOutput()
    const sentVelocities: number[] = []
    const originalNoteOn = midiOut.noteOn.bind(midiOut)
    midiOut.noteOn = (note, velocity, atMs, channel) => {
      sentVelocities.push(velocity)
      originalNoteOn(note, velocity, atMs, channel)
    }
    const out = createMidiDrumOutput({ output: midiOut, now: () => millis(0) })

    out.setVolume(0.5)
    out.strike('snare', 100)

    expect(sentVelocities).toEqual([50])
  })

  it('allNotesOff sends the device panic on channel 10', () => {
    const { midiOut, out } = outputAt(0)

    out.allNotesOff()

    expect(midiOut.sent).toEqual([{ kind: 'allNotesOff', channel: DRUM_MIDI_CHANNEL }])
  })

  it('now() reads the injected clock, never a real clock', () => {
    const { out } = outputAt(4242)

    expect(out.now()).toBe(4242)
  })

  // Review A2 — kills a mutant that drops `volume <= 0` from strike's guard
  // (leaving only `velocity <= 0`), which would let a muted output still send
  // a floored, audible velocity-1 note.
  it('setVolume(0) mutes strike entirely, even with a loud velocity', () => {
    const { midiOut, out } = outputAt(0)

    out.setVolume(0)
    out.strike('kick', 127)

    expect(midiOut.sent).toEqual([])
  })

  // Review A2 — kills the same class of mutant on click's guard.
  it('setVolume(0) mutes click entirely, even with a loud gain', () => {
    const { midiOut, out } = outputAt(0)

    out.setVolume(0)
    out.click(true, undefined, 1)

    expect(midiOut.sent).toEqual([])
  })

  // Review A2 — velocity 0 (not just volume 0) is also silence, not a floored note-on.
  it('strike with velocity <= 0 schedules nothing', () => {
    const { midiOut, out } = outputAt(0)

    out.strike('kick', 0)

    expect(midiOut.sent).toEqual([])
  })

  // Review A3 — kills a mutant that keeps the old fixed +STRIKE_GATE_MS
  // noteOff for hhOpen: the port contract (core/ports/drumAudio.ts) says an
  // open hi-hat rings until the next hi-hat event, never a timer, so no
  // noteOff should be scheduled at strike time at all.
  it('hhOpen schedules only a noteOn — no gated noteOff at +STRIKE_GATE_MS', () => {
    const { midiOut, out } = outputAt(1000)

    out.strike('hhOpen', 100)

    expect(midiOut.sent).toEqual([{ kind: 'noteOn', note: 46, at: 1000, channel: DRUM_MIDI_CHANNEL }])
  })

  // Review A3 — kills a mutant that forgets to release the ringing open-hat
  // note on the NEXT hi-hat event: the exact scenario from the finding —
  // hhOpen at 1000, then hhClosed at 1500 — must release note 46 at 1500
  // (the closing strike's own `at`, before its own noteOn), then gate its
  // own noteOff normally at 1500 + STRIKE_GATE_MS.
  it('a later hhClosed releases the still-ringing hhOpen note at the closing strike time', () => {
    const { midiOut, out } = outputAt(1000)

    out.strike('hhOpen', 100)
    out.strike('hhClosed', 100, millis(1500))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, at: 1000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 46, at: 1500, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOn', note: 42, at: 1500, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 1500 + STRIKE_GATE_MS, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // Review A3 — allNotesOff must forget the ringing open-hat bookkeeping too,
  // so a hi-hat strike after a panic never tries to release a stale note.
  it('allNotesOff clears the open-hat memory — a hhClosed afterward releases nothing extra', () => {
    const { midiOut, out } = outputAt(1000)

    out.strike('hhOpen', 100)
    out.allNotesOff()
    midiOut.sent.length = 0
    out.strike('hhClosed', 100, millis(2000))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 42, at: 2000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 2000 + STRIKE_GATE_MS, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // Review round 4 AMBER 1 — kills a mutant that clamps an out-of-order
  // release forward to the open hat's own onset (`Math.max(at, openHat.at)`,
  // this file's round-3 fix): that stamps a noteOff at the exact same
  // instant as its noteOn, a zero-length note that silences the open hat
  // right at its onset on any device that honours it. A scheduled hhOpen at
  // 2000 released by a live hhClosed stamped at 500 (trainer dispatches a
  // pass up front while live hits arrive at `now()`) must emit NO release at
  // all for the out-of-order strike — the hhClosed still plays its own note
  // — and `openHat` must stay set for the next, correctly-ordered event.
  it('a hi-hat "release" scheduled BEFORE its own onset (out-of-order at) is skipped, not clamped', () => {
    const { midiOut, out } = outputAt(0)

    out.strike('hhOpen', 100, millis(2000))
    out.strike('hhClosed', 100, millis(500))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, at: 2000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOn', note: 42, at: 500, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 560, channel: DRUM_MIDI_CHANNEL },
    ])

    // the open hat is still ringing (its release was skipped) — the next
    // hi-hat event that actually arrives in order releases it.
    out.strike('hhClosed', 100, millis(2500))

    expect(midiOut.sent.slice(3)).toEqual([
      { kind: 'noteOff', note: 46, at: 2500, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOn', note: 42, at: 2500, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 2560, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // Review round 3 NIT — kills a mutant that keeps the release inside (or
  // after) the volume/velocity silence guard: a muted hi-hat strike is still
  // a real choke gesture and must still release the ringing open hat, even
  // though it plays no note of its own.
  it('a muted hhClosed still releases a ringing hhOpen, even though it plays nothing itself', () => {
    const { midiOut, out } = outputAt(1000)

    out.strike('hhOpen', 100)
    out.setVolume(0)
    out.strike('hhClosed', 100, millis(1500))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, at: 1000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 46, at: 1500, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // DR-06 review nit — `reset()` exists so `drumAudio.ts`'s router can forget
  // a pending open hat on this cached voice when a strike falls back to the
  // synth (the device stopped being listed), without pretending the device
  // actually got a note-off it may never have asked for.
  describe('reset()', () => {
    it('forgets a pending open hat without sending a note-off, so the next hi-hat plays clean', () => {
      const { midiOut, out } = outputAt(1000)

      out.strike('hhOpen', 100)
      out.reset()
      midiOut.sent.length = 0
      out.strike('hhClosed', 100, millis(1500))

      // no noteOff for note 46 (the forgotten open hat) anywhere — just the
      // new hi-hat's own gated pair.
      expect(midiOut.sent).toEqual([
        { kind: 'noteOn', note: 42, at: 1500, channel: DRUM_MIDI_CHANNEL },
        { kind: 'noteOff', note: 42, at: 1500 + STRIKE_GATE_MS, channel: DRUM_MIDI_CHANNEL },
      ])
    })

    it('sends nothing itself', () => {
      const { midiOut, out } = outputAt(1000)

      out.strike('hhOpen', 100)
      midiOut.sent.length = 0
      out.reset()

      expect(midiOut.sent).toEqual([])
    })

    it('is a no-op when there is no pending open hat', () => {
      const { midiOut, out } = outputAt(1000)

      out.reset()

      expect(midiOut.sent).toEqual([])
    })

    // A fresh hhOpen struck AFTER reset() must re-arm exactly like any other
    // hhOpen — noteOn only, no stray noteOff for the forgotten one, and the
    // hat is still live: the next hi-hat event releases THIS one normally.
    it('a fresh hhOpen after reset() re-arms normally — noteOn only, then released by the next hi-hat', () => {
      const { midiOut, out } = outputAt(1000)

      out.strike('hhOpen', 100) // openHat set on note 46 at 1000
      out.reset() // forgotten — no noteOff sent
      out.strike('hhOpen', 100, millis(1500)) // re-armed

      expect(midiOut.sent).toEqual([
        { kind: 'noteOn', note: 46, at: 1000, channel: DRUM_MIDI_CHANNEL },
        { kind: 'noteOn', note: 46, at: 1500, channel: DRUM_MIDI_CHANNEL },
      ])

      out.strike('hhClosed', 100, millis(2000))

      expect(midiOut.sent.slice(2)).toEqual([
        { kind: 'noteOff', note: 46, at: 2000, channel: DRUM_MIDI_CHANNEL },
        { kind: 'noteOn', note: 42, at: 2000, channel: DRUM_MIDI_CHANNEL },
        { kind: 'noteOff', note: 42, at: 2000 + STRIKE_GATE_MS, channel: DRUM_MIDI_CHANNEL },
      ])
    })
  })
})
