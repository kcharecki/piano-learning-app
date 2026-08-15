/**
 * `vi.resetModules()` + a dynamic `import()` per test gives each test its own
 * copy of this module's `readyMidiOutput` cache — a module-level singleton by
 * design (see the module's own comment), which would otherwise leak between
 * tests in this file. The `localStorage`-backed route preference is real
 * browser storage, not module state, so it still needs its own `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingMidiOutput } from '@test/fakes.ts'
import type { MidiOutput } from '@core/ports/midi.ts'
import { err, ok } from '@core/shared/result.ts'
import type * as AudioRoute from './audioRoute.ts'

async function freshAudioRoute(): Promise<typeof AudioRoute> {
  return import('./audioRoute.ts')
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
