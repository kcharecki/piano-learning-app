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
import { err, ok } from '@core/shared/result.ts'
import type * as AudioRoute from './audioRoute.ts'

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
