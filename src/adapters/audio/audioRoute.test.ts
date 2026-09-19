/**
 * `vi.resetModules()` + a dynamic `import()` per test gives each test its own
 * copy of this module's `readyMidiOutput` cache — a module-level singleton by
 * design (see the module's own comment), which would otherwise leak between
 * tests in this file. The `localStorage`-backed route preference is real
 * browser storage, not module state, so it still needs its own `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingMidiOutput } from '@test/fakes.ts'
import type { MidiDevice, MidiOutput, Unsubscribe } from '@core/ports/midi.ts'
import type { Millis } from '@core/shared/units.ts'
import { err, ok } from '@core/shared/result.ts'
import { DRUM_MIDI_CHANNEL } from './drumMidiOut.ts'
import type * as AudioRoute from './audioRoute.ts'

/**
 * Ports `drumAudio.test.ts`'s `DeviceTrackingMidiOutput` here, kept local to
 * this file: `RecordingMidiOutput`/`FakeMultiPortMidiOutput` above don't stamp
 * which port a message actually reached, but the port-switch panic tests
 * below need to prove the ORDER messages land in relative to which device
 * was selected at send time — mirroring `WebMidiOutputAdapter.send()`, which
 * resolves the destination from its own mutable `selectedDeviceId` fresh on
 * every call (`webmidi.ts`'s `currentPort()`), never from what was selected
 * when the caller decided to send.
 */
class DeviceTrackingMidiOutput implements MidiOutput {
  readonly sent: {
    kind: 'noteOn' | 'noteOff' | 'allNotesOff'
    note?: number
    channel?: number
    deviceId: string | null
  }[] = []
  private readonly devices: readonly MidiDevice[]
  selectedDeviceId: string | null

  constructor(devices: readonly MidiDevice[], selectedDeviceId: string | null) {
    this.devices = devices
    this.selectedDeviceId = selectedDeviceId
  }

  listDevices(): readonly MidiDevice[] {
    return this.devices
  }

  onDevicesChanged(): Unsubscribe {
    return () => undefined
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  noteOn(note: number, _velocity: number, _atMs?: Millis, channel?: number): void {
    this.sent.push({ kind: 'noteOn', note, ...(channel === undefined ? {} : { channel }), deviceId: this.selectedDeviceId })
  }

  noteOff(note: number, _atMs?: Millis, channel?: number): void {
    this.sent.push({ kind: 'noteOff', note, ...(channel === undefined ? {} : { channel }), deviceId: this.selectedDeviceId })
  }

  allNotesOff(channel?: number): void {
    this.sent.push({ kind: 'allNotesOff', ...(channel === undefined ? {} : { channel }), deviceId: this.selectedDeviceId })
  }
}

async function freshAudioRoute(): Promise<typeof AudioRoute> {
  return import('./audioRoute.ts')
}

/**
 * `RecordingMidiOutput` (`@test/fakes.ts`) only ever lists one device — fine
 * for every other test in this file, but the port-picker tests below need a
 * connection with several ports to choose between. Built here rather than in
 * `fakes.ts` per this slice's brief (that file is out of scope for this
 * change).
 */
class FakeMultiPortMidiOutput implements MidiOutput {
  selectedDeviceId: string | null
  private readonly devices: readonly MidiDevice[]

  constructor(devices: readonly MidiDevice[], selectedDeviceId: string | null = null) {
    this.devices = devices
    this.selectedDeviceId = selectedDeviceId
  }

  listDevices(): readonly MidiDevice[] {
    return this.devices
  }

  // Hot-plug is exercised at the adapter layer (webmidi.test.ts) and the UI
  // layer (SettingsScreen.test.tsx); this fake only needs to satisfy the
  // `MidiOutput` shape for the picker logic under test here.
  onDevicesChanged(): Unsubscribe {
    return () => undefined
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  noteOn(): void {}
  noteOff(): void {}
  allNotesOff(): void {}
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  localStorage.clear()
})

describe('getAudioOutputRoute / setAudioOutputRoute', () => {
  it('defaults to webaudio when nothing has been chosen yet', async () => {
    const { getAudioOutputRoute } = await freshAudioRoute()
    expect(getAudioOutputRoute()).toBe('webaudio')
  })

  it('persists the learner’s choice — a fresh read sees it', async () => {
    const { getAudioOutputRoute, setAudioOutputRoute } = await freshAudioRoute()
    setAudioOutputRoute('midi')
    expect(getAudioOutputRoute()).toBe('midi')
  })

  it('round-trips back to webaudio', async () => {
    const { getAudioOutputRoute, setAudioOutputRoute } = await freshAudioRoute()
    setAudioOutputRoute('midi')
    setAudioOutputRoute('webaudio')
    expect(getAudioOutputRoute()).toBe('webaudio')
  })
})

describe('connectMidiOutputRoute / getPlaybackMidiOutput', () => {
  it('auto-selects the first output device and caches it for playback', async () => {
    const { connectMidiOutputRoute, getPlaybackMidiOutput, setAudioOutputRoute } = await freshAudioRoute()
    const midiOut = new RecordingMidiOutput()
    midiOut.selectDevice(null) // starts unselected, unlike the fake's own default
    const connect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))

    setAudioOutputRoute('midi')
    const result = await connectMidiOutputRoute(connect)

    expect(result.ok).toBe(true)
    expect(midiOut.selectedDeviceId).not.toBeNull()
    expect(getPlaybackMidiOutput()).toBe(midiOut)
  })

  it('getPlaybackMidiOutput is undefined when the route is webaudio, even with a live connection', async () => {
    const { connectMidiOutputRoute, getPlaybackMidiOutput, setAudioOutputRoute } = await freshAudioRoute()
    const midiOut = new RecordingMidiOutput()
    const connect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))

    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(connect)
    setAudioOutputRoute('webaudio')

    expect(getPlaybackMidiOutput()).toBeUndefined()
  })

  it('getPlaybackMidiOutput is undefined when midi is preferred but no connection has completed', async () => {
    const { getPlaybackMidiOutput, setAudioOutputRoute } = await freshAudioRoute()
    setAudioOutputRoute('midi')
    expect(getPlaybackMidiOutput()).toBeUndefined()
  })

  it('surfaces a connect failure (e.g. no Web MIDI support, permission denied) and does not cache a broken output', async () => {
    const { connectMidiOutputRoute, getPlaybackMidiOutput, setAudioOutputRoute } = await freshAudioRoute()
    const connect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(err('Web MIDI API is not available in this browser.'))

    setAudioOutputRoute('midi')
    const result = await connectMidiOutputRoute(connect)

    expect(result).toEqual({ ok: false, error: 'Web MIDI API is not available in this browser.' })
    expect(getPlaybackMidiOutput()).toBeUndefined()
  })

  it('fails with an actionable message when Web MIDI connects but no output device is present', async () => {
    const { connectMidiOutputRoute, getPlaybackMidiOutput, setAudioOutputRoute } = await freshAudioRoute()
    const midiOutWithNoDevices: MidiOutput = {
      listDevices: () => [],
      onDevicesChanged: () => () => undefined,
      selectDevice: () => undefined,
      noteOn: () => undefined,
      noteOff: () => undefined,
      allNotesOff: () => undefined,
      selectedDeviceId: null,
    }
    const connect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOutWithNoDevices }))

    setAudioOutputRoute('midi')
    const result = await connectMidiOutputRoute(connect)

    expect(result.ok).toBe(false)
    expect(getPlaybackMidiOutput()).toBeUndefined()
  })

  it('getConnectedMidiOutput sees the live connection even when the piano route is webaudio', async () => {
    const { connectMidiOutputRoute, getConnectedMidiOutput, getPlaybackMidiOutput, setAudioOutputRoute } =
      await freshAudioRoute()
    const midiOut = new RecordingMidiOutput()
    const connect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))

    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(connect)
    setAudioOutputRoute('webaudio')

    expect(getConnectedMidiOutput()).toBe(midiOut)
    expect(getPlaybackMidiOutput()).toBeUndefined()
  })

  it('getConnectedMidiOutput is undefined until a connection has completed', async () => {
    const { getConnectedMidiOutput } = await freshAudioRoute()
    expect(getConnectedMidiOutput()).toBeUndefined()
  })

  it('a later failed reconnect clears a previously-ready output', async () => {
    const { connectMidiOutputRoute, getPlaybackMidiOutput, setAudioOutputRoute } = await freshAudioRoute()
    const midiOut = new RecordingMidiOutput()
    const goodConnect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(ok({ output: midiOut }))
    const badConnect: AudioRoute.ConnectMidiOutput = () => Promise.resolve(err('device unplugged'))

    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(goodConnect)
    expect(getPlaybackMidiOutput()).toBe(midiOut)

    await connectMidiOutputRoute(badConnect)
    expect(getPlaybackMidiOutput()).toBeUndefined()
  })
})

describe('MIDI output port picker (roadmap DR-06 wave 12)', () => {
  const deviceA: MidiDevice = { id: 'a', name: 'Digital Piano', manufacturer: 'Yamaha' }
  const deviceB: MidiDevice = { id: 'b', name: 'Drum Module', manufacturer: 'Roland' }

  it('a persisted preferred id, still listed, is selected instead of the first device', async () => {
    const { connectMidiOutputRoute, getPlaybackMidiOutput, setAudioOutputRoute, setPreferredMidiOutputPortId } =
      await freshAudioRoute()
    const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB])
    setPreferredMidiOutputPortId(deviceB.id)
    setAudioOutputRoute('midi')

    const result = await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))

    expect(result.ok).toBe(true)
    expect(midiOut.selectedDeviceId).toBe(deviceB.id)
    expect(getPlaybackMidiOutput()).toBe(midiOut)
  })

  it('a preferred id that matches no listed device falls back to the first device, and the stale preference survives unchanged', async () => {
    const { connectMidiOutputRoute, getPreferredMidiOutputPortId, setAudioOutputRoute, setPreferredMidiOutputPortId } =
      await freshAudioRoute()
    const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB])
    setPreferredMidiOutputPortId('unplugged-device')
    setAudioOutputRoute('midi')

    await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))

    expect(midiOut.selectedDeviceId).toBe(deviceA.id)
    // the device may simply be unplugged, not un-chosen — the preference is
    // left alone, not silently overwritten with the fallback.
    expect(getPreferredMidiOutputPortId()).toBe('unplugged-device')
  })

  it('selectMidiOutputPort selects the device on the live output and persists the choice', async () => {
    const { connectMidiOutputRoute, getPreferredMidiOutputPortId, selectMidiOutputPort, setAudioOutputRoute } =
      await freshAudioRoute()
    const midiOut = new FakeMultiPortMidiOutput([deviceA, deviceB], deviceA.id)
    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))

    const result = selectMidiOutputPort(deviceB.id)

    expect(result).toEqual({ ok: true, value: undefined })
    expect(midiOut.selectedDeviceId).toBe(deviceB.id)
    expect(getPreferredMidiOutputPortId()).toBe(deviceB.id)
  })

  it('selectMidiOutputPort errs when nothing is connected yet', async () => {
    const { selectMidiOutputPort } = await freshAudioRoute()

    expect(selectMidiOutputPort('anything')).toEqual({ ok: false, error: 'No MIDI output is connected.' })
  })

  it('selectMidiOutputPort errs when the id is no longer among listDevices(), and never touches the live selection', async () => {
    const { connectMidiOutputRoute, selectMidiOutputPort, setAudioOutputRoute } = await freshAudioRoute()
    const midiOut = new FakeMultiPortMidiOutput([deviceA], deviceA.id)
    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))

    const result = selectMidiOutputPort('unplugged-device')

    expect(result).toEqual({ ok: false, error: 'That MIDI output is no longer listed.' })
    expect(midiOut.selectedDeviceId).toBe(deviceA.id)
  })

  // DR-06 wave 14, RED-SPEC round 2 — Opus review found the prior claim (in
  // drumAudio.ts) that the old port can never be panicked once a switch
  // happens false: `readyMidiOutput` is still selected on the OLD device the
  // instant BEFORE `selectDevice(id)` below reassigns it, and
  // `WebMidiOutputAdapter.send()` resolves the destination fresh from that
  // mutable field at send time — so `allNotesOff` issued from HERE, before
  // the reassignment, does land on the outgoing port. Asserts the ORDER of
  // the whole `sent` array end to end, not just membership: the two panics
  // (drum channel, then the piano's default channel) must both be stamped
  // with the OLD id, strictly before the next message that arrives after the
  // switch, which is stamped with the NEW id.
  it('selectMidiOutputPort panics the OLD port — both the drum and default channel — strictly before switching', async () => {
    const { connectMidiOutputRoute, selectMidiOutputPort, setAudioOutputRoute } = await freshAudioRoute()
    const midiOut = new DeviceTrackingMidiOutput([deviceA, deviceB], deviceA.id)
    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))
    midiOut.noteOn(46, 100, undefined, DRUM_MIDI_CHANNEL) // a ringing open hat on A, drum channel

    const result = selectMidiOutputPort(deviceB.id)

    expect(result).toEqual({ ok: true, value: undefined })
    midiOut.noteOn(42, 100, undefined, DRUM_MIDI_CHANNEL) // the next hit, after the switch, lands on B

    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
      { kind: 'allNotesOff', channel: DRUM_MIDI_CHANNEL, deviceId: 'a' }, // drum channel panic, still on A
      { kind: 'allNotesOff', deviceId: 'a' }, // piano's default channel panic, still on A
      { kind: 'noteOn', note: 42, channel: DRUM_MIDI_CHANNEL, deviceId: 'b' }, // only now on B
    ])
  })

  // Re-picking the ALREADY-selected port (Settings re-click, same id) is not
  // a switch — nothing outgoing to panic, and panicking anyway would cut off
  // a note that is still legitimately ringing on this same port for no
  // reason. Must return the identical success value the normal switch path
  // returns and send nothing at all; the still-ringing note must still
  // release normally afterward, proving nothing was reset or redirected.
  it('selectMidiOutputPort re-picking the SAME port sends nothing, returns the normal success result, and still persists the pick', async () => {
    const { connectMidiOutputRoute, getPreferredMidiOutputPortId, selectMidiOutputPort, setAudioOutputRoute } =
      await freshAudioRoute()
    const midiOut = new DeviceTrackingMidiOutput([deviceA, deviceB], deviceA.id)
    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))
    midiOut.noteOn(46, 100, undefined, DRUM_MIDI_CHANNEL) // a ringing open hat on A

    // `connectMidiOutputRoute` auto-picks `devices[0]` and selects it on the
    // live output, but never persists a preference — with none pre-seeded,
    // it stays unset even though a device is already actively selected.
    // `selectMidiOutputPort` is the ONLY place that ever writes the
    // preference, so this same-id early path is a learner's one and only
    // chance to pin the auto-picked port without first picking something
    // else — skipping the persist here would silently strand that learner.
    expect(getPreferredMidiOutputPortId()).toBeUndefined()

    const result = selectMidiOutputPort(deviceA.id) // re-pick the already-active port

    expect(result).toEqual({ ok: true, value: undefined }) // same shape as the normal switch's success
    expect(getPreferredMidiOutputPortId()).toBe(deviceA.id) // the pick is now persisted
    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
    ]) // no allNotesOff, no selectDevice-driven send — nothing further sent at all

    midiOut.noteOff(46, undefined, DRUM_MIDI_CHANNEL) // the later hhClosed's release
    expect(midiOut.sent).toEqual([
      { kind: 'noteOn', note: 46, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
      { kind: 'noteOff', note: 46, channel: DRUM_MIDI_CHANNEL, deviceId: 'a' },
    ]) // still lands on A — the re-pick disturbed nothing
  })

  it('the early error-return paths never panic the live port — a stale pick leaves it untouched', async () => {
    const { connectMidiOutputRoute, selectMidiOutputPort, setAudioOutputRoute } = await freshAudioRoute()
    const midiOut = new DeviceTrackingMidiOutput([deviceA], deviceA.id)
    setAudioOutputRoute('midi')
    await connectMidiOutputRoute(() => Promise.resolve(ok({ output: midiOut })))

    const result = selectMidiOutputPort('unplugged-device')

    expect(result).toEqual({ ok: false, error: 'That MIDI output is no longer listed.' })
    // A failed pick must not silence a port that is still legitimately in
    // use — no allNotesOff (or anything else) was sent.
    expect(midiOut.sent).toEqual([])
  })

  it('selectMidiOutputPort with nothing connected yet never panics anything (nothing to panic)', async () => {
    const { selectMidiOutputPort } = await freshAudioRoute()

    expect(selectMidiOutputPort('anything')).toEqual({ ok: false, error: 'No MIDI output is connected.' })
    // No live `MidiOutput` exists yet in this case — there is nothing this
    // assertion could check a `sent` log on; the guarantee here is just that
    // the early return happens before any output is touched, which the
    // module's own `readyMidiOutput === undefined` guard (audioRoute.ts)
    // enforces structurally.
  })

  it('setPreferredMidiOutputPortId(undefined) removes the stored preference', async () => {
    const { getPreferredMidiOutputPortId, setPreferredMidiOutputPortId } = await freshAudioRoute()
    setPreferredMidiOutputPortId('x')
    expect(getPreferredMidiOutputPortId()).toBe('x')

    setPreferredMidiOutputPortId(undefined)

    expect(getPreferredMidiOutputPortId()).toBeUndefined()
  })

  it('a throwing localStorage never escapes get/set — reads as unset, writes are silently dropped', async () => {
    const { getPreferredMidiOutputPortId, setPreferredMidiOutputPortId } = await freshAudioRoute()
    // Spying on `Storage.prototype` (rather than the `localStorage` instance
    // itself) is unreliable here: jsdom lazily installs `getItem`/`setItem`
    // as instance-own properties the first time either is touched, which the
    // many real localStorage calls earlier in this file already trigger — so
    // a prototype spy this late silently fails to intercept.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(() => setPreferredMidiOutputPortId('x')).not.toThrow()
    expect(() => getPreferredMidiOutputPortId()).not.toThrow()
    expect(getPreferredMidiOutputPortId()).toBeUndefined()

    vi.restoreAllMocks()
  })
})
