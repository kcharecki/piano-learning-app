/**
 * `useScoreStore` holds state and calls into `@core` only for validation
 * (`clampScale`) — these tests pin exactly that boundary: setters store what
 * they're given, except tempo scale, which must come back clamped.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { MAX_TEMPO_SCALE, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { ticks } from '@core/shared/units.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { useScoreStore } from './scoreStore.ts'

const testLoop: LoopRange = { startTick: ticks(0), endTick: ticks(960) }

function makeTestScore(id = 'store-test'): Score {
  return makeScore({
    id,
    measures: [{}],
    notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right' }],
  })
}

const INITIAL_STATE = {
  loaded: undefined,
  importError: undefined,
  availableMidiDevices: [],
  selectedMidiDeviceId: null,
  settings: {
    tempoScale: 1,
    activeHands: ['left', 'right'] as const,
    metronomeEnabled: false,
    loop: undefined,
  },
}

beforeEach(() => {
  useScoreStore.setState(INITIAL_STATE)
})

describe('useScoreStore', () => {
  it('starts with no score loaded and default practice settings', () => {
    const state = useScoreStore.getState()
    expect(state.loaded).toBeUndefined()
    expect(state.settings).toEqual({
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    })
    expect(state.selectedMidiDeviceId).toBeNull()
  })

  it('loadScore stores the score and clears any previous import error', () => {
    useScoreStore.getState().setImportError('previous failure')
    const score = makeTestScore()

    useScoreStore.getState().loadScore({ score, sourceName: 'test.musicxml', musicXml: '<xml/>' })

    const state = useScoreStore.getState()
    expect(state.loaded?.score).toBe(score)
    expect(state.loaded?.sourceName).toBe('test.musicxml')
    expect(state.loaded?.musicXml).toBe('<xml/>')
    expect(state.importError).toBeUndefined()
  })

  it('loadScore accepts a score with no MusicXML (a MIDI import)', () => {
    const score = makeTestScore()
    useScoreStore.getState().loadScore({ score, sourceName: 'test.mid', musicXml: undefined })
    expect(useScoreStore.getState().loaded?.musicXml).toBeUndefined()
  })

  it('setImportError and clearImportError round-trip', () => {
    useScoreStore.getState().setImportError('bad file')
    expect(useScoreStore.getState().importError).toBe('bad file')

    useScoreStore.getState().clearImportError()
    expect(useScoreStore.getState().importError).toBeUndefined()
  })

  it('selectMidiDevice stores the id, including clearing it back to null', () => {
    useScoreStore.getState().selectMidiDevice('device-1')
    expect(useScoreStore.getState().selectedMidiDeviceId).toBe('device-1')

    useScoreStore.getState().selectMidiDevice(null)
    expect(useScoreStore.getState().selectedMidiDeviceId).toBeNull()
  })

  it('setAvailableMidiDevices stores the device list verbatim', () => {
    const devices = [{ id: 'a', name: 'Keyboard', manufacturer: 'Acme' }]
    useScoreStore.getState().setAvailableMidiDevices(devices)
    expect(useScoreStore.getState().availableMidiDevices).toEqual(devices)
  })

  it('setTempoScale stores an in-range value unchanged', () => {
    useScoreStore.getState().setTempoScale(1.5)
    expect(useScoreStore.getState().settings.tempoScale).toBe(1.5)
  })

  it('setTempoScale clamps a value below the supported range', () => {
    useScoreStore.getState().setTempoScale(0.01)
    expect(useScoreStore.getState().settings.tempoScale).toBe(MIN_TEMPO_SCALE)
  })

  it('setTempoScale clamps a value above the supported range', () => {
    useScoreStore.getState().setTempoScale(10)
    expect(useScoreStore.getState().settings.tempoScale).toBe(MAX_TEMPO_SCALE)
  })

  it('setActiveHands, setMetronomeEnabled and setLoop update settings independently', () => {
    useScoreStore.getState().setActiveHands(['left'])
    useScoreStore.getState().setMetronomeEnabled(true)
    useScoreStore.getState().setLoop(testLoop)

    const settings = useScoreStore.getState().settings
    expect(settings.activeHands).toEqual(['left'])
    expect(settings.metronomeEnabled).toBe(true)
    expect(settings.loop).toEqual(testLoop)
    // tempoScale, set earlier in other tests, must not leak here.
    expect(settings.tempoScale).toBe(1)
  })

  it('setLoop clears the loop range back to undefined', () => {
    useScoreStore.getState().setLoop(testLoop)
    useScoreStore.getState().setLoop(undefined)
    expect(useScoreStore.getState().settings.loop).toBeUndefined()
  })
})
