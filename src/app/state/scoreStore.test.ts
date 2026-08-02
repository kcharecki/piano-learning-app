/**
 * `useScoreStore` holds state and calls into `@core` only for validation
 * (`clampScale`) — these tests pin exactly that boundary: setters store what
 * they're given, except tempo scale, which must come back clamped.
 *
 * Roadmap 2.29 (REQ-3.9.3): the per-loop tempo tests pin the two-home
 * contract from the module comment — `setTempoScale` writes through to
 * whichever of `loopTempoScales`/`unloopedTempoScale` is currently in effect,
 * and `setLoop` swaps which one `settings.tempoScale` mirrors — plus the LRU
 * cap on `loopTempoScales`.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { MAX_TEMPO_SCALE, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { ticks } from '@core/shared/units.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_LOOP_TEMPO_SCALES, useScoreStore } from './scoreStore.ts'

const testLoop: LoopRange = { startTick: ticks(0), endTick: ticks(960) }
const loopA: LoopRange = { startTick: ticks(0), endTick: ticks(960) }
const loopB: LoopRange = { startTick: ticks(960), endTick: ticks(1920) }

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
  loopTempoScales: new Map<string, number>(),
  unloopedTempoScale: 1,
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

  it('loadScore resets the per-loop tempo memory so a new piece never inherits an old one', () => {
    const { setLoop, setTempoScale, loadScore } = useScoreStore.getState()
    setLoop(testLoop)
    setTempoScale(0.6)
    setLoop(undefined)
    setTempoScale(0.75)

    const nextScore = makeTestScore('another-score')
    loadScore({ score: nextScore, sourceName: 'other.musicxml', musicXml: '<xml/>' })

    expect(useScoreStore.getState().loopTempoScales.size).toBe(0)
    expect(useScoreStore.getState().unloopedTempoScale).toBe(1)

    // Re-entering the same tick range on the new score must not come back at
    // the old score's 60% — it inherits the (reset) default instead.
    useScoreStore.getState().setLoop(testLoop)
    expect(useScoreStore.getState().settings.tempoScale).toBe(1)
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

describe('per-loop tempo scale (roadmap 2.29, REQ-3.9.3)', () => {
  it('each loop range remembers its own tempo scale, followed on switch', () => {
    const { setLoop, setTempoScale } = useScoreStore.getState()
    setLoop(loopA)
    setTempoScale(0.6)
    setLoop(loopB)
    setTempoScale(0.9)

    setLoop(loopA)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.6)

    setLoop(loopB)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.9)
  })

  it('turning looping off restores the unlooped tempo, not the last loop\'s', () => {
    const { setLoop, setTempoScale } = useScoreStore.getState()
    // Whole-piece tempo starts at the default (1); slow loop A down to 60%.
    setLoop(loopA)
    setTempoScale(0.6)

    setLoop(undefined)

    expect(useScoreStore.getState().settings.tempoScale).toBe(1)
    expect(useScoreStore.getState().settings.loop).toBeUndefined()
  })

  it('re-enabling the loop after turning off brings its own scale back', () => {
    const { setLoop, setTempoScale } = useScoreStore.getState()
    setLoop(loopA)
    setTempoScale(0.6)
    setLoop(undefined)

    setLoop(loopA)

    expect(useScoreStore.getState().settings.tempoScale).toBe(0.6)
  })

  it('setTempoScale while unlooped writes unloopedTempoScale, not just settings.tempoScale', () => {
    const { setTempoScale } = useScoreStore.getState()
    setTempoScale(0.75)
    expect(useScoreStore.getState().unloopedTempoScale).toBe(0.75)
  })

  it('setTempoScale while unlooped never touches a loop range\'s remembered scale', () => {
    const { setLoop, setTempoScale } = useScoreStore.getState()
    setLoop(loopA)
    setTempoScale(0.6)
    setLoop(undefined)

    // Changing the whole-piece tempo while unlooped...
    setTempoScale(0.75)
    // ...must not have touched loop A's own remembered 60%.
    setLoop(loopA)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.6)
  })

  it('a loop range seen for the first time inherits the scale that was in effect', () => {
    // Slowing the piece down and THEN looping the hard bar means "keep
    // practising this slowly" — springing back to 100% on checking Loop would
    // be the app arguing with the learner. Only a range with a remembered
    // scale of its own overrides what was inherited (the test above).
    const { setLoop, setTempoScale } = useScoreStore.getState()
    setTempoScale(0.5)
    setLoop(loopA)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.5)
    // ...and it is the LOOP's scale now: leaving the loop restores the
    // whole-piece 0.5 too, but changing it inside the loop must not follow us
    // out.
    setTempoScale(0.4)
    setLoop(undefined)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.5)
  })

  it('evicts the least-recently-used loop range past the cap', () => {
    const { setLoop, setTempoScale } = useScoreStore.getState()
    const ranges: LoopRange[] = Array.from({ length: MAX_LOOP_TEMPO_SCALES + 1 }, (_, i) => ({
      startTick: ticks(i * 960),
      endTick: ticks(i * 960 + 960),
    }))

    // Visit every range once, each with its own distinct tempo scale, in
    // order — the first range visited is the least-recently-used once the
    // (cap + 1)th range pushes the map over its limit.
    ranges.forEach((range, i) => {
      setLoop(range)
      setTempoScale(0.5 + i * 0.01)
    })

    expect(useScoreStore.getState().loopTempoScales.size).toBe(MAX_LOOP_TEMPO_SCALES)

    // The oldest (first) range was evicted: revisiting it no longer restores
    // the 0.5 it was set to. It inherits whatever is in effect instead, which
    // is what a range being seen for the "first" time does — so set a distinct
    // scale first, and assert it comes back rather than 0.5.
    setLoop(undefined)
    setTempoScale(0.42)
    setLoop(ranges[0] as LoopRange)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.42)

    // The most recently visited range (the one that triggered the eviction)
    // is still remembered.
    const last = ranges[ranges.length - 1] as LoopRange
    setLoop(last)
    expect(useScoreStore.getState().settings.tempoScale).toBeCloseTo(0.5 + MAX_LOOP_TEMPO_SCALES * 0.01)
  })

  it('entering a range with no remembered scale of its own does not insert an LRU entry for it', () => {
    const { setLoop, setTempoScale } = useScoreStore.getState()
    setLoop(loopA)
    setTempoScale(0.6)
    setLoop(loopB)
    setTempoScale(0.9)
    expect(useScoreStore.getState().loopTempoScales.size).toBe(2)

    // Entering a third range that was never given its own tempo (as a
    // measure-field keystroke does before the learner settles on a range)
    // must not consume a slot in the capped map — only setTempoScale does.
    const transientRange: LoopRange = { startTick: ticks(10_000), endTick: ticks(20_000) }
    setLoop(transientRange)
    expect(useScoreStore.getState().loopTempoScales.size).toBe(2)

    // loopA and loopB's remembered scales must be unaffected.
    setLoop(loopA)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.6)
    setLoop(loopB)
    expect(useScoreStore.getState().settings.tempoScale).toBe(0.9)
  })
})
