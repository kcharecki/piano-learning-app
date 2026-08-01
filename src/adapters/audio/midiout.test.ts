import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMidiAudioOutput } from '@adapters/audio/midiout.ts'
import { RecordingMidiOutput } from '@test/fakes.ts'
import { midi, millis } from '@core/shared/units.ts'

describe('createMidiAudioOutput', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards noteOn to the MIDI output, with time and velocity intact', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.noteOn(midi(60), 100, millis(250))

    expect(midiOut.sent).toEqual([{ kind: 'noteOn', note: 60, at: 250 }])
  })

  it('forwards noteOff to the MIDI output', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.noteOff(midi(60), millis(500))

    expect(midiOut.sent).toEqual([{ kind: 'noteOff', note: 60, at: 500 }])
  })

  it('forwards calls with atMs omitted, unchanged', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.noteOn(midi(60), 100)

    expect(midiOut.sent).toEqual([{ kind: 'noteOn', note: 60 }])
  })

  it('click(accented) uses a distinct, higher, louder note than an unaccented click', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.click(false, millis(0))
    out.click(true, millis(100))

    expect(midiOut.sent).toHaveLength(4)
    const [plainOn, plainOff, accentedOn, accentedOff] = midiOut.sent
    expect(plainOn?.kind).toBe('noteOn')
    expect(accentedOn?.kind).toBe('noteOn')
    expect(accentedOn?.note).toBeGreaterThan(plainOn?.note ?? 0)
    // both notes get an explicit, matching, scheduled note-off
    expect(plainOff).toEqual({ kind: 'noteOff', note: plainOn?.note, at: expect.any(Number) })
    expect(accentedOff).toEqual({ kind: 'noteOff', note: accentedOn?.note, at: expect.any(Number) })
  })

  it('click schedules its own note-off shortly after the note-on, on the same clock', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.click(false, millis(1000))

    const [on, off] = midiOut.sent
    expect(on?.at).toBe(1000)
    expect(off?.at).toBeGreaterThan(1000)
    expect(off?.at).toBeLessThanOrEqual(1050) // a click is short
  })

  it('click resolves "now" from the MIDI clock when atMs is omitted, and still has a duration', () => {
    vi.spyOn(performance, 'now').mockReturnValue(9000)
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.click(false)

    const [on, off] = midiOut.sent
    expect(on?.at).toBe(9000)
    expect(off?.at).toBeGreaterThan(9000)
  })

  it('allNotesOff sends an immediate noteOff for every note believed still open, then the device panic', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.noteOn(midi(60), 100, millis(0))
    out.noteOn(midi(64), 100, millis(0)) // left open — no matching noteOff
    out.noteOff(midi(60), millis(200)) // closed before the panic

    midiOut.sent.length = 0 // only care about what allNotesOff itself sends
    out.allNotesOff()

    expect(midiOut.sent).toEqual([{ kind: 'noteOff', note: 64 }, { kind: 'allNotesOff' }])
  })

  it('allNotesOff clears tracking, so a second call sends nothing but the device panic', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.noteOn(midi(60), 100, millis(0))
    out.allNotesOff()
    midiOut.sent.length = 0

    out.allNotesOff()

    expect(midiOut.sent).toEqual([{ kind: 'allNotesOff' }])
  })

  it('a double-open note (e.g. overlapping clicks on the same pitch) needs two noteOffs before allNotesOff forgets it', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    out.noteOn(midi(60), 100, millis(0))
    out.noteOn(midi(60), 100, millis(10))
    out.noteOff(midi(60), millis(20)) // only closes one of the two

    midiOut.sent.length = 0
    out.allNotesOff()

    expect(midiOut.sent).toEqual([{ kind: 'noteOff', note: 60 }, { kind: 'allNotesOff' }])
  })

  it('setVolume is a no-op — MIDI routes to the instrument, which has no software volume knob here', () => {
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    expect(() => out.setVolume(0.5)).not.toThrow()
    expect(midiOut.sent).toEqual([])
  })

  it('now() reads performance.now()', () => {
    vi.spyOn(performance, 'now').mockReturnValue(12345)
    const midiOut = new RecordingMidiOutput()
    const out = createMidiAudioOutput(midiOut)

    expect(out.now()).toBe(12345)
  })
})
