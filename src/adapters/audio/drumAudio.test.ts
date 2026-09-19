import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingMidiOutput } from '@test/fakes.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import type { MidiDevice, MidiOutput, Unsubscribe } from '@core/ports/midi.ts'
import { DRUM_MIDI_CHANNEL } from '@adapters/audio/drumMidiOut.ts'

// `createDrumAudioOutput`/`createDrumAudioOutputWith` memoize a
// module-level singleton, so each test re-imports the module fresh (via
// `vi.resetModules()`) rather than sharing one singleton across tests.

/**
 * `RecordingMidiOutput` (`@test/fakes.ts`) records `sent` WITHOUT which
 * device id each message went to — it never modelled per-port routing, only
 * "was something sent on this instance". The DR-06 port-switch tests below
 * need to prove which port a `noteOff` actually reached, so this local fake
 * stamps each entry with `this.selectedDeviceId` AT SEND TIME — mirroring
 * `WebMidiOutputAdapter.send()`, which resolves the destination port from
 * its own mutable `selectedDeviceId` fresh on every call (`webmidi.ts`
 * `currentPort()`), not from whatever was selected when the note was
 * scheduled.
 */
class DeviceTrackingMidiOutput implements MidiOutput {
  readonly sent: {
    kind: 'noteOn' | 'noteOff' | 'allNotesOff'
    note?: number
    at?: number
    channel?: number
    deviceId: string | null
  }[] = []
  private devices: MidiDevice[]
  private readonly deviceHandlers = new Set<(devices: readonly MidiDevice[]) => void>()
  selectedDeviceId: string | null

  constructor(devices: MidiDevice[]) {
    this.devices = devices
    this.selectedDeviceId = devices[0]?.id ?? null
  }

  listDevices(): readonly MidiDevice[] {
    return this.devices
  }

  onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    this.deviceHandlers.add(handler)
    return () => this.deviceHandlers.delete(handler)
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  noteOn(note: number, _velocity: number, atMs?: Millis, channel?: number): void {
    this.sent.push({
      kind: 'noteOn',
      note,
      ...(atMs === undefined ? {} : { at: atMs }),
      ...(channel === undefined ? {} : { channel }),
      deviceId: this.selectedDeviceId,
    })
  }

  noteOff(note: number, atMs?: Millis, channel?: number): void {
    this.sent.push({
      kind: 'noteOff',
      note,
      ...(atMs === undefined ? {} : { at: atMs }),
      ...(channel === undefined ? {} : { channel }),
      deviceId: this.selectedDeviceId,
    })
  }

  allNotesOff(channel?: number): void {
    this.sent.push({
      kind: 'allNotesOff',
      ...(channel === undefined ? {} : { channel }),
      deviceId: this.selectedDeviceId,
    })
  }
}

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

  // DR-06 wave 14 — port switch mid-session. `selectMidiOutputPort`
  // (`audioRoute.ts`) calls `selectDevice(id)` on the SAME `MidiOutput`
  // instance, so `ensureMidiTarget`'s `output !== midiOutputInstance` check
  // cannot see it. Must fail against a stub that only rebuilds on a
  // different instance: the old code would send `hhClosed`'s open-hat
  // release (`noteOff` note 46) to port B, which never had it on.
  it('selecting a different port on the SAME MidiOutput instance forgets the old ringing hat instead of misdirecting its note-off', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const deviceA: MidiDevice = { id: 'a', name: 'A', manufacturer: 'Test' }
    const deviceB: MidiDevice = { id: 'b', name: 'B', manufacturer: 'Test' }
    const midiOut = new DeviceTrackingMidiOutput([deviceA, deviceB]) // starts selected on A

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed for this test')
      },
      { route: () => 'midi', midi: () => midiOut },
    )

    out.strike('hhOpen', 100, millis(0)) // open hat rings on A (selectedDeviceId 'a')
    midiOut.selectDevice('b') // Settings port switch — same instance, no onDevicesChanged event
    out.strike('hhClosed', 100, millis(100))

    const onB = midiOut.sent.filter((m) => m.deviceId === 'b')
    // no stray noteOff for note 46 (A's open hat) is sent to B at all —
    // the switch forgets it rather than releasing it on the wrong port.
    expect(onB.some((m) => m.kind === 'noteOff' && m.note === 46)).toBe(false)
    expect(onB).toEqual([
      { kind: 'noteOn', note: 42, at: 100, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' },
      { kind: 'noteOff', note: 42, at: 160, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' },
    ])
    // What happened to A's ringing hat in THIS test: "forgotten here;
    // silenced for real elsewhere." This test drives `midiOut.selectDevice`
    // directly (isolating this router's own reset()-vs-rebuild bookkeeping)
    // rather than through the real `selectMidiOutputPort` (`audioRoute.ts`),
    // which is what actually panics the old port with CC 123 the instant
    // BEFORE reassigning `selectedDeviceId` — see that function's own
    // comment. By the time any strike reaches `ensureMidiTarget`, that
    // reassignment (real or, as here, test-simulated) has already happened,
    // so `WebMidiOutputAdapter.send()` would resolve an `allNotesOff()`
    // issued from here to the NEW port, not the old one — this router only
    // ever forgets its own `openHat` memory (`reset()`), never repeats the
    // device-level panic.
  })

  // What this actually guards: NOT the port-switch detection itself (a
  // version of `ensureMidiTarget` that never noticed a same-instance port
  // switch at all would still pass this exact assertion — nothing was ever
  // rung on B for a stray release to leak back onto A). What it does pin
  // down is the reset()-vs-allNotesOff() choice on the switch-back branch:
  // if that branch called `midiDrumOutput.allNotesOff()` instead of
  // `reset()`, the resulting `{ kind: 'allNotesOff', channel:
  // DRUM_MIDI_CHANNEL, deviceId: 'a' }` would show up in `onA` and break the
  // exact-array equality below — `reset()` sends nothing, so it does not.
  it('switching back to the first port sends only reset bookkeeping, never an extra allNotesOff, on the new voice', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const deviceA: MidiDevice = { id: 'a', name: 'A', manufacturer: 'Test' }
    const deviceB: MidiDevice = { id: 'b', name: 'B', manufacturer: 'Test' }
    const midiOut = new DeviceTrackingMidiOutput([deviceA, deviceB])

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed for this test')
      },
      { route: () => 'midi', midi: () => midiOut },
    )

    out.strike('hhOpen', 100, millis(0)) // rings on A
    midiOut.selectDevice('b')
    out.strike('hhClosed', 100, millis(100)) // switch forgets A's hat; plain hit on B
    midiOut.selectDevice('a') // switch back to A
    out.strike('hhClosed', 100, millis(200))

    const onA = midiOut.sent.filter((m) => m.deviceId === 'a')
    expect(onA).toEqual([
      { kind: 'noteOn', note: 46, at: 0, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
      { kind: 'noteOn', note: 42, at: 200, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
      { kind: 'noteOff', note: 42, at: 260, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
    ])
  })

  // Re-selecting the SAME id (Settings re-click on the already-active port)
  // must not rebuild or reset the voice — a still-ringing open hat stays
  // tracked and gets released normally on the next hi-hat hit.
  it('reselecting the SAME port id does not rebuild or reset — an open hat stays tracked', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const deviceA: MidiDevice = { id: 'a', name: 'A', manufacturer: 'Test' }
    const midiOut = new DeviceTrackingMidiOutput([deviceA])

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed for this test')
      },
      { route: () => 'midi', midi: () => midiOut },
    )

    out.strike('hhOpen', 100, millis(0)) // open hat rings, tracked
    midiOut.selectDevice('a') // Settings re-click on the same port — no-op switch
    out.strike('hhClosed', 100, millis(200))

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, at: 0, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
      { kind: 'noteOff', note: 46, at: 200, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' }, // the still-tracked open hat, released first
      { kind: 'noteOn', note: 42, at: 200, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
      { kind: 'noteOff', note: 42, at: 260, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
    ])
  })

  // Round 2 finding 2 (MEDIUM) — `midiSelectedId = output.selectedDeviceId`
  // in the port-switch branch of `ensureMidiTarget` survives deletion of
  // that one line alone: without it, `midiSelectedId` stays stuck on the
  // FIRST switch's target id, so a SECOND switch (back, or to a third port)
  // is never detected as a port change and the branch never fires again.
  // Proven below by literally deleting that assignment and re-running — see
  // this test's own trailing comment for the failing assertion it produced.
  it('a second port switch is still detected — midiSelectedId is updated on the reset branch, not just read', async () => {
    const { createDrumAudioOutputWith } = await import('@adapters/audio/drumAudio.ts')
    const deviceA: MidiDevice = { id: 'a', name: 'A', manufacturer: 'Test' }
    const deviceB: MidiDevice = { id: 'b', name: 'B', manufacturer: 'Test' }
    const midiOut = new DeviceTrackingMidiOutput([deviceA, deviceB])

    const out = createDrumAudioOutputWith(
      () => {
        throw new Error('never needed for this test')
      },
      { route: () => 'midi', midi: () => midiOut },
    )

    out.strike('hhOpen', 100, millis(0)) // rings on A
    midiOut.selectDevice('b') // first switch, a -> b
    out.strike('hhOpen', 100, millis(100)) // forgets A's hat (reset), rings 46 fresh on B
    out.strike('hhClosed', 100, millis(200)) // no further switch — B's own hat, released normally

    const onB = midiOut.sent.filter((m) => m.deviceId === 'b')
    expect(onB).toEqual([
      { kind: 'noteOn', note: 46, at: 100, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' },
      { kind: 'noteOff', note: 46, at: 200, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' },
      { kind: 'noteOn', note: 42, at: 200, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' },
      { kind: 'noteOff', note: 42, at: 260, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' },
    ])
    // Mutant proof (actually run, not predicted): deleting `midiSelectedId =
    // output.selectedDeviceId` from the reset branch in `ensureMidiTarget`
    // (drumAudio.ts) and re-running this test fails with:
    //   AssertionError: expected [ …(3) ] to deeply equal [ …(4) ]
    //   - Expected  (4 items, incl. { kind: 'noteOff', note: 46, at: 200,
    //     channel: 9, deviceId: 'b' })
    //   + Received  (3 items — the noteOff-46 entry is missing entirely)
    // `midiSelectedId` stuck on 'a' after the first switch makes the THIRD
    // call above (`hhClosed` at millis(200)) see `output.selectedDeviceId`
    // ('b') !== `midiSelectedId` ('a') as still true, so it wrongly
    // re-enters the reset branch a second time and forgets the open hat this
    // test just rang at millis(100) before it can be released. Source was
    // restored immediately after confirming this failure.
  })
})
