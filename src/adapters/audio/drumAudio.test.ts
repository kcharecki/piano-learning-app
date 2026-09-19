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

  // DR-06 review nit — the test above proves the FALLBACK; this proves the
  // RECOVERY: a re-plugged device resumes MIDI on the very next strike, with
  // no Settings visit anywhere in this test, and the synth's AudioContext
  // factory (already reached once, by the fallback) is never reached again.
  it('a re-plugged device resumes MIDI on the very next strike — no Settings visit, and the synth context factory is not built again', async () => {
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

    out.strike('kick', 100, millis(0))
    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 36, at: 0, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 36, at: 60, channel: DRUM_MIDI_CHANNEL },
    ])

    midiOut.setDevices([]) // unplugged
    midiOut.sent.length = 0
    out.strike('kick', 100, millis(100))
    expect(midiOut.sent).toEqual([]) // fell back to the synth
    expect(contextFactory).toHaveBeenCalledTimes(1)

    midiOut.setDevices([deviceA]) // re-plugged — same MidiOutput instance
    out.strike('kick', 100, millis(200))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 36, at: 200, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 36, at: 260, channel: DRUM_MIDI_CHANNEL },
    ])
    // resuming MIDI never rebuilds the synth's engine — the factory was only
    // ever reached during the fallback strike above.
    expect(contextFactory).toHaveBeenCalledTimes(1)
  })

  // DR-06 review nit — the stray note-off: an `hhOpen` still ringing when the
  // device drops must not leave the cached MIDI voice believing it, because
  // `ensureMidiTarget` only rebuilds the voice on a DIFFERENT `MidiOutput`
  // instance and a re-plug of the SAME device is the same instance. Without
  // `pickTarget` resetting the voice on fallback, the first hi-hat event
  // after the re-plug would send a `noteOff` for note 46 (the old open hat)
  // that the device never asked to have released.
  it('unplug -> re-plug leaves no stray note-off for an open hat the device never released', async () => {
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

    out.strike('hhOpen', 100, millis(0)) // open hat rings while still connected
    midiOut.sent.length = 0

    midiOut.setDevices([]) // unplugged
    out.strike('hhClosed', 100, millis(100)) // fallback strike — resets the cached voice
    expect(midiOut.sent).toEqual([]) // nothing reaches the vanished MIDI output

    midiOut.setDevices([deviceA]) // re-plugged — same MidiOutput instance
    out.strike('hhClosed', 100, millis(200))

    // exactly one noteOn/noteOff pair for the new closed hi-hat hit — no
    // stray noteOff for note 46 (the forgotten open hat) before it.
    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 42, at: 200, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 260, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // DR-06 review amber 5 — the per-hit fallback reset in `pickTarget` only
  // fires when a strike/click actually lands DURING the outage. An unplug
  // immediately followed by a re-plug with NO strike in between never calls
  // `pickTarget` while unlisted, so that alone would leave `openHat` stale.
  // `ensureMidiTarget` also subscribes to `output.onDevicesChanged`: the
  // unplug event's payload (`[]`) drops the selected device, so THAT event
  // resets the voice — not a strike, and not the later re-plug event either
  // (its payload still lists the selected device, so it's a no-op; the hat
  // was already forgotten). `RecordingMidiOutput.setDevices()` emits
  // `onDevicesChanged` on every call (`src/test/fakes.ts`), same as the real adapter.
  it('unplug -> re-plug with NO strike in between still forgets a ringing open hat', async () => {
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

    out.strike('hhOpen', 100, millis(0)) // open hat rings; builds the voice and subscribes
    midiOut.sent.length = 0

    midiOut.setDevices([]) // unplug — fires onDevicesChanged
    midiOut.setDevices([deviceA]) // re-plug — fires onDevicesChanged again; no strike in between

    out.strike('hhClosed', 100, millis(200))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 42, at: 200, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 260, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // DR-06 RED round 2 — `MidiAccess.onstatechange` fires for every port on
  // the system, input or output (webmidi.ts). An unrelated device appearing
  // (the learner's piano getting plugged in, say) while the selected drum
  // module never moved must NOT reset a legitimately still-ringing open hat
  // and drop its real note-off. The subscription must check the emitted
  // payload for whether the SELECTED output is still in it, not react to
  // just any device-list event.
  it('an unrelated device appearing (the selected output still listed) does not reset a ringing open hat', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const deviceA: MidiDevice = { id: 'a', name: 'Drum Module', manufacturer: 'Test' }
    const deviceB: MidiDevice = { id: 'b', name: 'Learner Piano', manufacturer: 'Test' }
    const midiOut = new RecordingMidiOutput([deviceA])
    const contextFactory = vi.fn(() => {
      throw new Error('fake environment has no real AudioContext — only call-tracking matters here')
    })

    const out = createDrumAudioOutputWith(contextFactory, {
      route: () => 'midi',
      midi: () => midiOut,
    })

    out.strike('hhOpen', 100, millis(0)) // open hat rings on A
    midiOut.sent.length = 0

    midiOut.setDevices([deviceA, deviceB]) // unrelated device appears; A is still listed

    out.strike('hhClosed', 100, millis(200))

    // the still-ringing open hat (note 46) is released normally FIRST, then
    // the new hi-hat's own gated pair — it was never wrongly forgotten.
    expect(midiOut.sent).toEqual([
      { kind: 'noteOff', note: 46, at: 200, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOn', note: 42, at: 200, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 260, channel: DRUM_MIDI_CHANNEL },
    ])
  })

  // Swapping to a different MidiOutput must unsubscribe from the old one's
  // `onDevicesChanged` — otherwise a device-list event on the OLD (no longer
  // used) output could still reach the NEW voice's `reset()`.
  it('swapping to a different MidiOutput unsubscribes from the old one — a device-list event on it no longer resets the new voice', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const midiA = new RecordingMidiOutput([{ id: 'a', name: 'A', manufacturer: 'Test' }])
    const midiB = new RecordingMidiOutput([{ id: 'b', name: 'B', manufacturer: 'Test' }])
    let current: MidiOutput = midiA
    const contextFactory = vi.fn(() => {
      throw new Error('never needed for this test')
    })

    const out = createDrumAudioOutputWith(contextFactory, {
      route: () => 'midi',
      midi: () => current,
    })

    out.strike('hhOpen', 100, millis(0)) // builds the voice for A, subscribes to A
    current = midiB
    out.strike('kick', 100, millis(10)) // swaps to B — unsubscribes from A, subscribes to B
    midiB.sent.length = 0
    out.strike('hhOpen', 100, millis(20)) // open hat rings on B

    midiA.setDevices([]) // a device-list event on the OLD output — must be a no-op now

    out.strike('hhClosed', 100, millis(30))

    // B's still-ringing open hat is released normally — A's stale event
    // never reached B's voice because the old subscription was torn down.
    expect(midiB.sent).toEqual([
      { kind: 'noteOn', note: 46, at: 20, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 46, at: 30, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOn', note: 42, at: 30, channel: DRUM_MIDI_CHANNEL },
      { kind: 'noteOff', note: 42, at: 90, channel: DRUM_MIDI_CHANNEL },
    ])
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
