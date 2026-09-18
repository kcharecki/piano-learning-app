import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingMidiOutput } from '@test/fakes.ts'
import { millis } from '@core/shared/units.ts'
import type { MidiDevice, MidiOutput } from '@core/ports/midi.ts'
import { DRUM_MIDI_CHANNEL } from '@adapters/audio/drumMidiOut.ts'

// `createDrumAudioOutput`/`createDrumAudioOutputWith` memoize a
// module-level singleton, so each test re-imports the module fresh (via
// `vi.resetModules()`) rather than sharing one singleton across tests.

describe('createDrumAudioOutput', () => {
  afterEach(() => {
    vi.resetModules()
  })

  // Kills a mutant that drops the memoization (builds a new `DrumAudioOutput`
  // — and so a new, gesture-losing `AudioContext` — on every call).
  it('createDrumAudioOutputWith memoizes: two calls return the same instance', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    // `createDrumSynth`'s `AudioContext` is built lazily on first strike/click,
    // so this factory is never actually invoked by just constructing the
    // output — no real (or fake) AudioContext needed here at all.
    const factory = () => {
      throw new Error('should not be called just to build the output')
    }

    const a = createDrumAudioOutputWith(factory)
    const b = createDrumAudioOutputWith(factory)
    expect(a).toBe(b)
  })

  // `createDrumAudioOutput` is the zero-arg default over the same seam.
  it('createDrumAudioOutput() also memoizes, with no context factory required', async () => {
    const { createDrumAudioOutput } = await import('@adapters/audio/drumAudio.ts')

    const a = createDrumAudioOutput()
    const b = createDrumAudioOutput()
    expect(a).toBe(b)
  })
})

describe('createDrumAudioOutputWith — routing (DR-06)', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('route "midi" with a connected output sends strike through that MidiOutput, on channel 10', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const midiOut = new RecordingMidiOutput()
    const neverBuildsAudioContext = () => {
      throw new Error('the MIDI route must never build an AudioContext')
    }

    const out = createDrumAudioOutputWith(neverBuildsAudioContext, {
      route: () => 'midi',
      midi: () => midiOut,
    })
    out.strike('kick', 100, millis(1000))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 36, at: 1000, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 36, at: 1060, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // Roadmap DR-06 review RED: `getMidi()` returning a defined `MidiOutput`
  // used to be treated as "connected" — but `WebMidiOutputAdapter` (and this
  // fake, matching it) never clears `selectedDeviceId` when the device
  // vanishes from `listDevices()`, it just makes `send()` a silent no-op.
  // Before the `pickTarget` fix, this hit every strike swallowed with
  // nothing routed to the synth either — total silence, mid-Groove-run, with
  // no fallback and no error. Must fail against the pre-fix code.
  it('a selected device that has been unplugged (non-undefined output, but no longer listed) falls back to the synth, not silence', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const deviceA: MidiDevice = { id: 'a', name: 'Drum Module', manufacturer: 'Test' }
    const midiOut = new RecordingMidiOutput([deviceA])
    const contextFactory = vi.fn(() => {
      throw new Error('fake environment has no real AudioContext — only call-tracking matters here')
    })

    const out = createDrumAudioOutputWith(contextFactory, {
      route: () => 'midi',
      midi: () => midiOut,
    })
    // the device disappears — `selectedDeviceId` is left stale, exactly like
    // the real adapter (see `WebMidiOutputAdapter.currentPort()`'s comment).
    midiOut.setDevices([])

    out.strike('kick', 100, millis(0))

    expect(midiOut.sent).toEqual([])
    expect(contextFactory).toHaveBeenCalled()
  })

  it('route "midi" with no connected output falls back to the synth (the context factory is reached)', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const contextFactory = vi.fn(() => {
      throw new Error('fake environment has no real AudioContext — only call-tracking matters here')
    })

    const out = createDrumAudioOutputWith(contextFactory, {
      route: () => 'midi',
      midi: () => undefined,
    })
    out.strike('kick', 100)

    expect(contextFactory).toHaveBeenCalled()
  })

  it('route "synth" never touches a connected MidiOutput', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const midiOut = new RecordingMidiOutput()
    const contextFactory = vi.fn(() => {
      throw new Error('fake environment has no real AudioContext — only call-tracking matters here')
    })

    const out = createDrumAudioOutputWith(contextFactory, {
      route: () => 'synth',
      midi: () => midiOut,
    })
    out.strike('kick', 100)

    expect(midiOut.sent).toEqual([])
    expect(contextFactory).toHaveBeenCalled()
  })

  it('allNotesOff reaches both the synth and a MIDI target already in use, even after the route switches away from it', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const midiOut = new RecordingMidiOutput()
    let currentRoute: 'synth' | 'midi' = 'midi'

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed — the synth side of allNotesOff no-ops with no engine built')
      },
      { route: () => currentRoute, midi: () => midiOut },
    )
    out.strike('kick', 100, millis(0)) // builds the MIDI target while route is 'midi'
    midiOut.sent.length = 0
    currentRoute = 'synth' // route switches away, but the MIDI target must still be silenced

    out.allNotesOff()

    expect(midiOut.sent).toEqual([{ kind: 'allNotesOff', channel: DRUM_MIDI_CHANNEL }])
  })

  it('setVolume reaches both targets — a MIDI target built after the volume change still gets it', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const midiOut = new RecordingMidiOutput()
    const sentVelocities: number[] = []
    const originalNoteOn = midiOut.noteOn.bind(midiOut)
    midiOut.noteOn = (note, velocity, atMs, channel) => {
      sentVelocities.push(velocity)
      originalNoteOn(note, velocity, atMs, channel)
    }

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed for this test')
      },
      { route: () => 'midi', midi: () => midiOut },
    )
    out.setVolume(0.5) // set before the MIDI target has ever been built
    out.strike('snare', 100, millis(0))

    expect(sentVelocities).toEqual([50])
  })

  // Review A6 — replaces a test that only asserted call counts (which passes
  // even under per-call construction) with observable proof of memoization:
  // a volume set BEFORE any device swap must still be applied by the voice
  // built for a SECOND device, and swapping devices must silence the first
  // one's voice (review A4) rather than leaving it able to ring forever.
  it('memoizes per MidiOutput instance: volume carries to a swapped device, and the old device is silenced on swap', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const firstMidi = new RecordingMidiOutput()
    const secondMidi = new RecordingMidiOutput()
    const secondVelocities: number[] = []
    const originalNoteOn = secondMidi.noteOn.bind(secondMidi)
    secondMidi.noteOn = (note, velocity, atMs, channel) => {
      secondVelocities.push(velocity)
      originalNoteOn(note, velocity, atMs, channel)
    }
    let current: MidiOutput = firstMidi

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed for this test')
      },
      { route: () => 'midi', midi: () => current },
    )
    out.setVolume(0.5)
    out.strike('kick', 100, millis(0)) // builds the voice for firstMidi
    firstMidi.sent.length = 0

    current = secondMidi // swap devices
    out.strike('snare', 100, millis(10)) // builds a NEW voice for secondMidi

    // the old device's voice was silenced before the reassignment (A4) —
    // no further notes are lost on it, only the panic from the swap itself.
    expect(firstMidi.sent).toEqual([{ kind: 'allNotesOff', channel: DRUM_MIDI_CHANNEL }])
    // the volume set before either device existed still reaches the voice
    // built for the second device — proves it's not rebuilt with defaults.
    expect(secondMidi.sent).toEqual([
      { kind: 'noteOn', note: 38, at: 10, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 38, at: 70, channel: DRUM_MIDI_CHANNEL },
    ])
    expect(secondVelocities).toEqual([50])
  })
})
