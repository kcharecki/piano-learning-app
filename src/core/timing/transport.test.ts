import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildTestScore,
  C_MAJOR_SCALE_RH,
  PICKUP_MEASURE,
  SIX_EIGHT,
  TEMPO_CHANGE,
  TIED_NOTES,
  TWO_HAND_CHORDS,
  type TestNote,
} from '@core/notation/fixtures.ts'
import type { Score } from '@core/notation/score.ts'
import { InvariantError } from '@core/shared/invariant.ts'
import { ticks as asTicks } from '@core/shared/units.ts'
import { FakeClock } from '@test/fakes.ts'
import { makeTempoMap } from './tempo.ts'
import { Transport, type LoopRange, type TransportEvent } from './transport.ts'

// -------------------------------------------------------------------- helpers

type Harness = { readonly clock: FakeClock; readonly transport: Transport }

type HarnessOptions = {
  readonly loop?: LoopRange
  readonly countInBeats?: number
  readonly scale?: number
}

const harness = (score: Score = C_MAJOR_SCALE_RH, opts: HarnessOptions = {}): Harness => {
  const clock = new FakeClock()
  const transport = new Transport({
    score,
    tempo: makeTempoMap(score.tempos, opts.scale ?? 1),
    clock,
    ...(opts.loop === undefined ? {} : { loop: opts.loop }),
    ...(opts.countInBeats === undefined ? {} : { countInBeats: opts.countInBeats }),
  })
  return { clock, transport }
}

/** Compact, readable form of an event, so assertions read like a piano roll. */
const label = (e: TransportEvent): string =>
  e.type === 'noteOn'
    ? `on:${e.note.midi}`
    : e.type === 'noteOff'
      ? `off:${e.note.midi}`
      : e.type === 'measure'
        ? `measure:${e.index}`
        : e.type === 'loop'
          ? `loop:${e.iteration}`
          : 'end'

const pump = (h: Harness, ms: number): string[] => {
  h.clock.advance(ms)
  return h.transport.tick().map(label)
}

const pumpRaw = (h: Harness, ms: number): readonly TransportEvent[] => {
  h.clock.advance(ms)
  return h.transport.tick()
}

const loopRange = (startTick: number, endTick: number): LoopRange => ({
  startTick: asTicks(startTick),
  endTick: asTicks(endTick),
})

/** Pump to the end of the piece, returning every event in order. */
const runToEnd = (h: Harness, stepMs = 250, maxSteps = 400): TransportEvent[] => {
  const events: TransportEvent[] = []
  for (let i = 0; i < maxSteps; i++) {
    const batch = pumpRaw(h, stepMs)
    events.push(...batch)
    if (batch.some((e) => e.type === 'end')) return events
  }
  throw new Error('transport never reached the end')
}

const QUARTER = 480
const BAR = 1920

// C_MAJOR_SCALE_RH: C4 D4 E4 F4 | G4 A4 B4 C5 as quarters at ♩=120 —
// one quarter is 500 ms, one 4/4 bar is 2000 ms, the whole fixture 4000 ms.
const SCALE_MIDI = [60, 62, 64, 65, 67, 69, 71, 72] as const

// ------------------------------------------------------------ initial state

describe('Transport construction', () => {
  it('starts stopped at the top of the piece', () => {
    const { transport } = harness()
    expect(transport.state).toBe('stopped')
    expect(transport.positionTicks).toBe(0)
    expect(transport.positionMs).toBe(0)
    expect(transport.currentMeasure).toBe(0)
    expect(transport.loop).toBeNull()
    expect(transport.loopIteration).toBe(0)
    expect(transport.soundingNotes).toEqual([])
    expect(transport.isCountingIn).toBe(false)
  })

  it('reports the end of the written music', () => {
    expect(harness().transport.endTick).toBe(2 * BAR)
    expect(harness(TWO_HAND_CHORDS).transport.endTick).toBe(4 * BAR)
    // 3/4 with a one-beat pickup: 480 + 1440 + 1440.
    expect(harness(PICKUP_MEASURE).transport.endTick).toBe(3360)
  })

  it('accepts a loop range up front', () => {
    const { transport } = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    expect(transport.loop).toEqual({ startTick: 0, endTick: BAR })
  })

  it('exposes the tempo map it was given', () => {
    const { transport } = harness(C_MAJOR_SCALE_RH, { scale: 0.5 })
    expect(transport.tempoMap.scale).toBe(0.5)
  })

  it('pumping a stopped transport does nothing', () => {
    const h = harness()
    expect(pump(h, 5000)).toEqual([])
    expect(h.transport.positionTicks).toBe(0)
    expect(h.transport.state).toBe('stopped')
  })

  const badCountIns: readonly (readonly [string, number])[] = [
    ['a negative count-in', -1],
    ['a NaN count-in', Number.NaN],
    ['an infinite count-in', Number.POSITIVE_INFINITY],
  ]
  for (const [name, beats] of badCountIns) {
    it(`throws on ${name}`, () => {
      expect(() => harness(C_MAJOR_SCALE_RH, { countInBeats: beats })).toThrow(InvariantError)
    })
  }
})

// ------------------------------------------------------------------ playback

describe('play', () => {
  it('emits the downbeat measure and the first note on the first pump', () => {
    const h = harness()
    h.transport.play()
    expect(h.transport.state).toBe('playing')
    expect(pump(h, 0)).toEqual(['measure:0', 'on:60'])
    expect(h.transport.positionTicks).toBe(0)
  })

  it('emits a release before the next attack', () => {
    const h = harness()
    h.transport.play()
    pump(h, 0)
    expect(pump(h, 500)).toEqual(['off:60', 'on:62'])
  })

  it('announces a bar line before the notes on it', () => {
    // Tick 1920 carries three things at once: the end of F4, the start of bar 2
    // and the start of G4. The bar line comes first, then the release, then the attack.
    const h = harness()
    h.transport.play()
    expect(pump(h, 2000)).toEqual([
      'measure:0',
      'on:60',
      'off:60',
      'on:62',
      'off:62',
      'on:64',
      'off:64',
      'on:65',
      'measure:1',
      'off:65',
      'on:67',
    ])
  })

  it('replays a long gap in full — a slow caller never loses a note', () => {
    const h = harness()
    h.transport.play()
    const events = pump(h, 4000)
    expect(events.filter((e) => e.startsWith('on:'))).toEqual(SCALE_MIDI.map((m) => `on:${m}`))
    expect(events.filter((e) => e.startsWith('off:'))).toEqual(SCALE_MIDI.map((m) => `off:${m}`))
    expect(events.filter((e) => e.startsWith('measure:'))).toEqual(['measure:0', 'measure:1'])
    expect(events.at(-1)).toBe('end')
  })

  it('emits the same stream however the wall clock is chopped up', () => {
    const oneShot = harness()
    oneShot.transport.play()
    const whole = pump(oneShot, 4000)

    const chopped = harness()
    chopped.transport.play()
    const pieces: string[] = []
    for (let i = 0; i < 400; i++) pieces.push(...pump(chopped, 17))
    expect(pieces).toEqual(whole)
  })

  it('tracks the playhead in ticks and milliseconds', () => {
    const h = harness()
    h.transport.play()
    pump(h, 250)
    expect(h.transport.positionTicks).toBe(240)
    expect(h.transport.positionMs).toBe(250)
    pump(h, 250)
    expect(h.transport.positionTicks).toBe(QUARTER)
    expect(h.transport.currentMeasure).toBe(0)
    pump(h, 1500)
    expect(h.transport.currentMeasure).toBe(1)
  })

  it('moves the playhead only inside tick()', () => {
    const h = harness()
    h.transport.play()
    h.clock.advance(1000)
    expect(h.transport.positionTicks).toBe(0)
    h.transport.tick()
    expect(h.transport.positionTicks).toBe(960)
  })

  it('reports what is sounding', () => {
    const h = harness(TWO_HAND_CHORDS)
    h.transport.play()
    pump(h, 100)
    // Bar 1: the C major triad C3 E3 G3 under the melody note C5.
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([48, 52, 55, 72])
  })

  it('is idempotent while already playing', () => {
    const h = harness()
    h.transport.play()
    pump(h, 500)
    h.transport.play()
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
  })

  it('stops at the end and restarts from the top when played again', () => {
    const h = harness()
    h.transport.play()
    pump(h, 5000)
    expect(h.transport.state).toBe('stopped')
    expect(h.transport.positionTicks).toBe(2 * BAR)
    expect(h.transport.currentMeasure).toBe(1)
    h.transport.play()
    expect(pump(h, 0)).toEqual(['measure:0', 'on:60'])
  })

  it('emits nothing but the bar lines and the end for a score with no notes', () => {
    const h = harness(buildTestScore([], { measureCount: 2 }))
    h.transport.play()
    expect(pump(h, 4000)).toEqual(['measure:0', 'measure:1', 'end'])
  })

  it('releases a zero-length note straight after attacking it', () => {
    const h = harness(buildTestScore([{ midi: 60, startTick: 0, durationTicks: 0 }]))
    h.transport.play()
    expect(pump(h, 0)).toEqual(['measure:0', 'on:60', 'off:60'])
  })

  it('keeps the zero-length pair adjacent when another note attacks on the same tick', () => {
    // A grace-note-ish C4 of no duration and a real E4 quarter, both on beat 1.
    // The release belongs to its own attack, so it must not sort after every
    // other attack on the tick — an adapter reading the stream would otherwise
    // hear C4 ring until after E4 had already started.
    const h = harness(
      buildTestScore([
        { midi: 60, startTick: 0, durationTicks: 0 },
        { midi: 64, startTick: 0, durationTicks: QUARTER },
      ]),
    )
    h.transport.play()
    expect(pump(h, 0)).toEqual(['measure:0', 'on:60', 'off:60', 'on:64'])
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([64])
  })

  it('does not merge a tie — the score is reported as written', () => {
    // E4 half | C4 half ~ | ~ C4 half | G4 half: the tied C4 is two ScoreNotes,
    // so it attacks twice here. Re-articulation is the audio adapter's problem.
    const h = harness(TIED_NOTES)
    h.transport.play()
    const events = pump(h, 4000)
    expect(events.filter((e) => e.startsWith('on:'))).toEqual(['on:64', 'on:60', 'on:60', 'on:67'])
  })
})

// -------------------------------------------------------------------- pause

describe('pause', () => {
  it('freezes the playhead and discards the wall time spent paused', () => {
    const h = harness()
    h.transport.play()
    expect(pump(h, 500)).toEqual(['measure:0', 'on:60', 'off:60', 'on:62'])
    h.transport.pause()
    expect(h.transport.state).toBe('paused')
    expect(pump(h, 10_000)).toEqual([])
    expect(h.transport.positionTicks).toBe(QUARTER)
    h.transport.play()
    expect(h.transport.state).toBe('playing')
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
    expect(h.transport.positionTicks).toBe(2 * QUARTER)
  })

  it('neither double-emits nor skips across many pause/resume cycles', () => {
    const h = harness()
    h.transport.play()
    const events: string[] = []
    for (let i = 0; i < 20; i++) {
      const batch = pumpRaw(h, 500)
      events.push(...batch.map(label))
      if (batch.some((e) => e.type === 'end')) break
      h.transport.pause()
      expect(pump(h, 3000)).toEqual([])
      h.transport.play()
    }
    expect(events.filter((e) => e.startsWith('on:'))).toEqual(SCALE_MIDI.map((m) => `on:${m}`))
    expect(events.at(-1)).toBe('end')
  })

  it('keeps a sounding note held across the pause', () => {
    const h = harness()
    h.transport.play()
    pump(h, 100)
    h.transport.pause()
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([60])
    expect(pump(h, 100)).toEqual([])
    h.transport.play()
    expect(pump(h, 400)).toEqual(['off:60', 'on:62'])
  })

  it('is a no-op when not playing', () => {
    const h = harness()
    h.transport.pause()
    expect(h.transport.state).toBe('stopped')
    h.transport.play()
    h.transport.pause()
    h.transport.pause()
    expect(h.transport.state).toBe('paused')
  })
})

// --------------------------------------------------------------------- stop

describe('stop', () => {
  it('rewinds to the top, releasing anything sounding', () => {
    const h = harness()
    h.transport.play()
    pump(h, 100)
    h.transport.stop()
    expect(h.transport.state).toBe('stopped')
    expect(h.transport.positionTicks).toBe(0)
    expect(h.transport.soundingNotes).toEqual([])
    expect(pump(h, 0)).toEqual(['off:60'])
  })

  it('rewinds to the loop start when a loop is set', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(BAR, 2 * BAR) })
    h.transport.play()
    pump(h, 2500)
    h.transport.stop()
    expect(h.transport.positionTicks).toBe(BAR)
    expect(h.transport.currentMeasure).toBe(1)
  })

  it('resets the loop iteration count and clears a wait gate', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    pump(h, 2000)
    expect(h.transport.loopIteration).toBe(1)
    h.transport.holdUntil(() => false)
    h.transport.stop()
    expect(h.transport.loopIteration).toBe(0)
    expect(h.transport.state).toBe('stopped')
    h.transport.play()
    expect(h.transport.state).toBe('playing')
  })

  it('replays from the start after a stop', () => {
    const h = harness()
    h.transport.play()
    pump(h, 700)
    h.transport.stop()
    h.transport.play()
    expect(pump(h, 0)).toEqual(['off:62', 'measure:0', 'on:60'])
  })
})

// --------------------------------------------------------------------- seek

describe('seekTick', () => {
  it('releases anything sounding and continues from the destination', () => {
    const h = harness()
    h.transport.play()
    expect(pump(h, 250)).toEqual(['measure:0', 'on:60'])
    h.transport.seekTick(asTicks(BAR))
    expect(h.transport.positionTicks).toBe(BAR)
    expect(pump(h, 0)).toEqual(['off:60', 'measure:1', 'on:67'])
  })

  it('keeps playing after the jump', () => {
    const h = harness()
    h.transport.play()
    pump(h, 250)
    h.transport.seekTick(asTicks(BAR))
    expect(h.transport.state).toBe('playing')
    pump(h, 0)
    expect(pump(h, 500)).toEqual(['off:67', 'on:69'])
  })

  it('does not re-attack a note the playhead lands inside', () => {
    // Bar 1 of TWO_HAND_CHORDS is a whole-note triad; landing on beat 3 must not
    // re-sound it — a seek is not an articulation.
    const h = harness(TWO_HAND_CHORDS)
    h.transport.play()
    h.transport.seekTick(asTicks(960))
    expect(pump(h, 0)).toEqual(['on:76'])
  })

  it('clamps to the score', () => {
    const h = harness()
    h.transport.seekTick(asTicks(-500))
    expect(h.transport.positionTicks).toBe(0)
    h.transport.seekTick(asTicks(99_999))
    expect(h.transport.positionTicks).toBe(2 * BAR)
    expect(h.transport.currentMeasure).toBe(1)
  })

  it('works while stopped and emits nothing on its own', () => {
    const h = harness()
    h.transport.seekTick(asTicks(QUARTER))
    expect(pump(h, 1000)).toEqual([])
    h.transport.play()
    expect(pump(h, 0)).toEqual(['on:62'])
  })

  it('throws on a non-finite tick', () => {
    const h = harness()
    expect(() => h.transport.seekTick(asTicks(Number.NaN))).toThrow(InvariantError)
  })
})

describe('seekMeasure', () => {
  it('jumps to the start of a measure', () => {
    const h = harness()
    h.transport.seekMeasure(1)
    expect(h.transport.positionTicks).toBe(BAR)
    expect(h.transport.currentMeasure).toBe(1)
  })

  it('lands on the pickup and on the first full bar of a 3/4 pickup score', () => {
    // measure 0 is the 480-tick upbeat; measure 1 starts at 480.
    const h = harness(PICKUP_MEASURE)
    h.transport.seekMeasure(0)
    expect(h.transport.positionTicks).toBe(0)
    h.transport.seekMeasure(1)
    expect(h.transport.positionTicks).toBe(480)
    h.transport.play()
    expect(pump(h, 0)).toEqual(['measure:1', 'on:72'])
  })

  it('truncates and clamps the index', () => {
    const h = harness()
    h.transport.seekMeasure(1.9)
    expect(h.transport.positionTicks).toBe(BAR)
    h.transport.seekMeasure(-4)
    expect(h.transport.positionTicks).toBe(0)
    h.transport.seekMeasure(99)
    expect(h.transport.currentMeasure).toBe(1)
  })

  it('throws on a non-finite index', () => {
    const h = harness()
    expect(() => h.transport.seekMeasure(Number.NaN)).toThrow(InvariantError)
  })
})

// --------------------------------------------------------------------- loop

describe('loop', () => {
  it('wraps exactly at endTick, releasing held notes before the loop event', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    expect(pump(h, 2000)).toEqual([
      'measure:0',
      'on:60',
      'off:60',
      'on:62',
      'off:62',
      'on:64',
      'off:64',
      'on:65',
      'off:65',
      'loop:1',
      'measure:0',
      'on:60',
    ])
    expect(h.transport.positionTicks).toBe(0)
    expect(h.transport.loopIteration).toBe(1)
  })

  it('never sounds a note that starts on endTick', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    const events = pump(h, 10_000)
    expect(events).not.toContain('on:67')
    expect(events.filter((e) => e === 'measure:1')).toEqual([])
  })

  it('counts iterations up across a long gap', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    const events = pump(h, 4100)
    expect(events.filter((e) => e.startsWith('loop:'))).toEqual(['loop:1', 'loop:2'])
    expect(h.transport.loopIteration).toBe(2)
    // 100 ms past the second wrap: 96 ticks into the bar at ♩=120.
    expect(h.transport.positionTicks).toBe(96)
  })

  it('loses no time when it wraps', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    pump(h, 2300)
    expect(h.transport.positionTicks).toBe(288) // 300 ms into the second pass
    pump(h, 200)
    expect(h.transport.positionTicks).toBe(480)
  })

  it('releases a note that sustains across the loop end', () => {
    const h = harness(TWO_HAND_CHORDS, { loop: loopRange(0, BAR) })
    h.transport.play()
    const events = pump(h, 2000)
    const wrap = events.indexOf('loop:1')
    // The whole-note triad and the beat-4 melody note all end on the bar line.
    expect(events.slice(wrap - 4, wrap)).toEqual(['off:48', 'off:52', 'off:55', 'off:77'])
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([48, 52, 55, 72])
  })

  it('loops a middle measure range and re-attacks it on the wrap', () => {
    // Bars 2–3 of TWO_HAND_CHORDS: the IV and V chords, F major then G major.
    const h = harness(TWO_HAND_CHORDS, { loop: loopRange(BAR, 3 * BAR) })
    h.transport.seekMeasure(1)
    h.transport.play()
    const events = pump(h, 4000)
    expect(events.filter((e) => e.startsWith('loop:'))).toEqual(['loop:1'])
    // E3 belongs to the C major triad of bars 1 and 4, both outside the loop.
    expect(events).not.toContain('on:52')
    expect(events.slice(events.indexOf('loop:1') + 1)).toEqual([
      'measure:1',
      'on:41',
      'on:45',
      'on:48',
      'on:77',
    ])
    expect(h.transport.positionTicks).toBe(BAR)
  })

  it('plays into the loop when the playhead starts before it', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(BAR, 2 * BAR) })
    h.transport.play()
    const events = pump(h, 2000)
    expect(events.slice(0, 2)).toEqual(['measure:0', 'on:60'])
    expect(events).not.toContain('loop:1')
  })

  it('jumps back into the loop, once, when the playhead is past it', () => {
    const h = harness()
    h.transport.play()
    pump(h, 3000)
    h.transport.setLoop(loopRange(0, BAR))
    const events = pump(h, 0)
    expect(events.filter((e) => e.startsWith('loop:'))).toEqual(['loop:1'])
    expect(h.transport.positionTicks).toBe(0)
  })

  it('clearing the loop lets playback run to the end', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    pump(h, 1000)
    h.transport.setLoop(null)
    expect(h.transport.loop).toBeNull()
    const events = pump(h, 5000)
    expect(events).toContain('on:67')
    expect(events.at(-1)).toBe('end')
  })

  it('setting a loop restarts the iteration count', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.play()
    pump(h, 2000)
    expect(h.transport.loopIteration).toBe(1)
    h.transport.setLoop(loopRange(0, 2 * BAR))
    expect(h.transport.loopIteration).toBe(0)
  })

  it('copies the range, so mutating the caller’s object cannot move the loop', () => {
    const range = { startTick: asTicks(0), endTick: asTicks(BAR) }
    const h = harness()
    h.transport.setLoop(range)
    expect(h.transport.loop).not.toBe(range)
    expect(h.transport.loop).toEqual({ startTick: 0, endTick: BAR })
  })

  it('clamps a range that runs off the end of the score, and still wraps', () => {
    // Bar 2 to well past the double bar. Unclamped, `endTick` would be a boundary
    // the playhead could never reach: it would sail past 3840 in silence, never
    // wrapping and never ending.
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(BAR, 99_999) })
    expect(h.transport.loop).toEqual({ startTick: BAR, endTick: 2 * BAR })
    h.transport.seekTick(asTicks(BAR))
    h.transport.play()
    // One pass of bar 2 is 2000 ms, so 6100 ms is three wraps and 100 ms over.
    const events = pump(h, 6100)
    expect(events.filter((e) => e.startsWith('loop:'))).toEqual(['loop:1', 'loop:2', 'loop:3'])
    expect(h.transport.positionTicks).toBe(BAR + 96)
    expect(h.transport.loopIteration).toBe(3)
    expect(events).not.toContain('end')
  })

  it('rejects a range that lies entirely past the end of the score', () => {
    const h = harness()
    expect(() => h.transport.setLoop(loopRange(10_000, 12_000))).toThrow(InvariantError)
    expect(() => harness(C_MAJOR_SCALE_RH, { loop: loopRange(10_000, 12_000) })).toThrow(
      InvariantError,
    )
    // The refusal leaves the transport loopless, so it still reaches the end.
    expect(h.transport.loop).toBeNull()
    h.transport.play()
    const events = pump(h, 6000)
    expect(events.at(-1)).toBe('end')
    expect(h.transport.state).toBe('stopped')
    expect(h.transport.positionTicks).toBe(2 * BAR)
  })

  it('rejects a range that starts exactly on the final tick', () => {
    const h = harness()
    expect(() => h.transport.setLoop(loopRange(2 * BAR, 3 * BAR))).toThrow(InvariantError)
  })

  const badRanges: readonly (readonly [string, LoopRange])[] = [
    ['an empty range', loopRange(BAR, BAR)],
    ['a backwards range', loopRange(2 * BAR, BAR)],
    ['a negative start', loopRange(-1, BAR)],
    ['a NaN start', loopRange(Number.NaN, BAR)],
    ['a NaN end', loopRange(0, Number.NaN)],
    ['an infinite end', loopRange(0, Number.POSITIVE_INFINITY)],
  ]
  for (const [name, range] of badRanges) {
    it(`throws on ${name}`, () => {
      const h = harness()
      expect(() => h.transport.setLoop(range)).toThrow(InvariantError)
      expect(() => harness(C_MAJOR_SCALE_RH, { loop: range })).toThrow(InvariantError)
    })
  }
})

// --------------------------------------------------------------- tempo scale

describe('setTempoScale', () => {
  it('does not move the playhead in ticks, and rescales it in milliseconds', () => {
    // 700 ms at ♩=120 is 672 ticks. The musical position is fixed; what changes is
    // how long those 672 ticks now take, so the ms reading tracks the scale exactly.
    const h = harness()
    h.transport.play()
    pump(h, 700)
    expect(h.transport.positionTicks).toBe(672)
    expect(h.transport.positionMs).toBe(700)
    h.transport.setTempoScale(0.5)
    expect(h.transport.positionTicks).toBe(672)
    expect(h.transport.positionMs).toBe(1400)
    h.transport.setTempoScale(2)
    expect(h.transport.positionTicks).toBe(672)
    expect(h.transport.positionMs).toBe(350)
  })

  it('halves the speed from the moment it is set', () => {
    const h = harness()
    h.transport.play()
    pump(h, 500)
    expect(h.transport.positionTicks).toBe(QUARTER)
    h.transport.setTempoScale(0.5)
    pump(h, 1000)
    // 1000 ms at half speed is one quarter note, not two.
    expect(h.transport.positionTicks).toBe(2 * QUARTER)
    expect(pump(h, 1000)).toEqual(['off:64', 'on:65'])
  })

  it('doubles the speed the same way', () => {
    const h = harness()
    h.transport.play()
    h.transport.setTempoScale(2)
    pump(h, 1000)
    expect(h.transport.positionTicks).toBe(4 * QUARTER)
  })

  it('clamps to the supported practice range', () => {
    const h = harness()
    h.transport.setTempoScale(99)
    expect(h.transport.tempoMap.scale).toBe(2)
    h.transport.setTempoScale(0.01)
    expect(h.transport.tempoMap.scale).toBe(0.25)
  })

  it('rejects a non-finite scale', () => {
    const h = harness()
    expect(() => h.transport.setTempoScale(Number.NaN)).toThrow(InvariantError)
  })

  it('still emits every note when the scale changes mid-piece', () => {
    const h = harness()
    h.transport.play()
    const events: string[] = []
    for (const scale of [1, 0.5, 2, 0.75]) {
      h.transport.setTempoScale(scale)
      events.push(...pump(h, 1500))
    }
    events.push(...pump(h, 20_000))
    expect(events.filter((e) => e.startsWith('on:'))).toEqual(SCALE_MIDI.map((m) => `on:${m}`))
  })
})

// --------------------------------------------------------- written tempo map

describe('written tempo changes', () => {
  it('follows a tempo change written into the score', () => {
    // TEMPO_CHANGE: bar 1 at ♩=120 (2000 ms), bar 2 at ♩=72 (1920 ticks = 3333.3 ms).
    const h = harness(TEMPO_CHANGE)
    h.transport.play()
    const first = pump(h, 2000)
    expect(first.at(-1)).toBe('on:67')
    expect(h.transport.positionTicks).toBe(BAR)
    pump(h, 1666.6666666666667)
    expect(h.transport.positionTicks).toBeCloseTo(2880, 6)
    const rest = pump(h, 2000)
    expect(rest).toEqual(['off:67', 'end'])
    expect(h.transport.positionMs).toBeCloseTo(5333.333333, 4)
  })

  it('emits 6/8 bar lines at the right ticks', () => {
    // SIX_EIGHT: two bars of 1440 ticks; at ♩=120 a bar lasts 1500 ms.
    const h = harness(SIX_EIGHT)
    h.transport.play()
    const first = pump(h, 1499)
    expect(first.filter((e) => e.startsWith('measure:'))).toEqual(['measure:0'])
    const second = pump(h, 1)
    expect(second).toEqual(['measure:1', 'off:69', 'on:72'])
  })
})

// ------------------------------------------------------------------ count-in

describe('count-in', () => {
  it('holds the position negative and emits nothing until the music starts', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 4 })
    h.transport.play()
    expect(h.transport.isCountingIn).toBe(true)
    expect(h.transport.positionTicks).toBe(-4 * QUARTER)
    expect(h.transport.positionMs).toBe(-2000)
    expect(h.transport.currentMeasure).toBe(0)
    expect(pump(h, 0)).toEqual([])
    expect(pump(h, 1000)).toEqual([])
    expect(h.transport.positionTicks).toBe(-960)
    expect(h.transport.isCountingIn).toBe(true)
    expect(pump(h, 999)).toEqual([])
    expect(pump(h, 1)).toEqual(['measure:0', 'on:60'])
    expect(h.transport.isCountingIn).toBe(false)
    expect(h.transport.positionTicks).toBe(0)
  })

  it('counts in before the seek destination, without replaying the music before it', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 2 })
    h.transport.seekMeasure(1)
    h.transport.play()
    expect(h.transport.positionTicks).toBe(BAR - 2 * QUARTER)
    expect(pump(h, 500)).toEqual([])
    expect(h.transport.positionTicks).toBe(1440)
    expect(pump(h, 500)).toEqual(['measure:1', 'on:67'])
  })

  it('counts in at the practice tempo', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 2, scale: 0.5 })
    h.transport.play()
    expect(h.transport.positionMs).toBe(-2000)
    expect(pump(h, 1999)).toEqual([])
    expect(pump(h, 1)).toEqual(['measure:0', 'on:60'])
  })

  it('does not count in again when resuming from a pause', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 4 })
    h.transport.play()
    pump(h, 2500)
    h.transport.pause()
    h.transport.play()
    expect(h.transport.isCountingIn).toBe(false)
    expect(h.transport.positionTicks).toBe(QUARTER)
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
  })

  it('counts in again after a stop', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 1 })
    h.transport.play()
    pump(h, 1000)
    h.transport.stop()
    h.transport.play()
    expect(h.transport.positionTicks).toBe(-QUARTER)
  })

  it('is cancelled by a seek', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 4 })
    h.transport.play()
    h.transport.seekTick(asTicks(QUARTER))
    expect(h.transport.isCountingIn).toBe(false)
    expect(pump(h, 0)).toEqual(['on:62'])
  })

  it('zero beats means no count-in at all', () => {
    const h = harness(C_MAJOR_SCALE_RH, { countInBeats: 0 })
    h.transport.play()
    expect(h.transport.isCountingIn).toBe(false)
    expect(pump(h, 0)).toEqual(['measure:0', 'on:60'])
  })
})

// ----------------------------------------------------------------- wait mode

describe('holdUntil / release', () => {
  it('waits without advancing, then continues where it left off', () => {
    const h = harness()
    h.transport.play()
    expect(pump(h, 500)).toEqual(['measure:0', 'on:60', 'off:60', 'on:62'])
    let satisfied = false
    h.transport.holdUntil(() => satisfied)
    expect(h.transport.state).toBe('waiting')
    expect(pump(h, 10_000)).toEqual([])
    expect(h.transport.positionTicks).toBe(QUARTER)
    satisfied = true
    expect(pump(h, 0)).toEqual([])
    expect(h.transport.state).toBe('playing')
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
  })

  it('polls the predicate once per pump', () => {
    const h = harness()
    let calls = 0
    h.transport.play()
    h.transport.holdUntil(() => {
      calls += 1
      return false
    })
    pump(h, 100)
    pump(h, 100)
    expect(calls).toBe(2)
  })

  it('releases on demand and discards the waiting time', () => {
    const h = harness()
    h.transport.play()
    pump(h, 500)
    h.transport.holdUntil(() => false)
    pump(h, 60_000)
    h.transport.release()
    expect(h.transport.state).toBe('playing')
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
  })

  it('releases even when the caller never pumped during the hold', () => {
    const h = harness()
    h.transport.play()
    pump(h, 500)
    h.transport.holdUntil(() => false)
    h.clock.advance(60_000)
    h.transport.release()
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
  })

  it('holds a note down while waiting', () => {
    const h = harness()
    h.transport.play()
    pump(h, 100)
    h.transport.holdUntil(() => false)
    pump(h, 5000)
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([60])
  })

  it('gates a note that lands exactly on the wait point', () => {
    const h = harness()
    h.transport.seekTick(asTicks(BAR))
    let satisfied = false
    h.transport.holdUntil(() => satisfied)
    h.transport.play()
    expect(h.transport.state).toBe('waiting')
    expect(pump(h, 5000)).toEqual([])
    satisfied = true
    expect(pump(h, 0)).toEqual(['measure:1', 'on:67'])
  })

  it('release is a no-op when nothing is held', () => {
    const h = harness()
    h.transport.play()
    h.transport.release()
    expect(h.transport.state).toBe('playing')
  })

  it('a hold set while stopped only takes effect once playing', () => {
    const h = harness()
    h.transport.holdUntil(() => false)
    expect(h.transport.state).toBe('stopped')
    h.transport.play()
    expect(h.transport.state).toBe('waiting')
    expect(pump(h, 5000)).toEqual([])
  })

  it('a paused transport reports paused even with a gate set', () => {
    const h = harness()
    h.transport.play()
    h.transport.holdUntil(() => false)
    h.transport.pause()
    expect(h.transport.state).toBe('paused')
  })
})

// ------------------------------------------------------------------ barrier

describe('setBarrier', () => {
  it('parks the playhead exactly on the barrier, however long the pump', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(QUARTER))
    expect(h.transport.barrierTick).toBe(QUARTER)
    h.transport.play()
    // One 5 s pump would otherwise run the whole piece out; it stops on beat 2,
    // with the note that starts there already sounding.
    expect(pump(h, 5000)).toEqual(['measure:0', 'on:60', 'off:60', 'on:62'])
    expect(h.transport.positionTicks).toBe(QUARTER)
    expect(h.transport.positionMs).toBe(500)
    expect(h.transport.isAtBarrier).toBe(true)
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([62])
  })

  it('consumes no time while parked, and resumes from the barrier when cleared', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(QUARTER))
    h.transport.play()
    pump(h, 5000)
    expect(pump(h, 5000)).toEqual([])
    expect(h.transport.positionTicks).toBe(QUARTER)
    h.transport.setBarrier(null)
    expect(h.transport.barrierTick).toBeNull()
    expect(h.transport.isAtBarrier).toBe(false)
    // The 10 s spent parked are discarded, exactly as a pause discards them: the
    // next 500 ms is the next quarter note, not a lurch into the middle of bar 2.
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
    expect(h.transport.positionTicks).toBe(2 * QUARTER)
  })

  it('is released even when the caller never pumped while parked', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(QUARTER))
    h.transport.play()
    pump(h, 5000)
    h.clock.advance(60_000)
    h.transport.setBarrier(null)
    expect(pump(h, 500)).toEqual(['off:62', 'on:64'])
  })

  it('plays the whole piece when every onset is a barrier', () => {
    const h = harness()
    h.transport.play()
    const events: string[] = []
    for (let tick = 0; tick <= 7 * QUARTER; tick += QUARTER) {
      h.transport.setBarrier(asTicks(tick))
      events.push(...pump(h, 5000))
      expect(h.transport.positionTicks).toBe(tick)
      h.transport.setBarrier(null)
    }
    events.push(...pump(h, 5000))
    expect(events.filter((e) => e.startsWith('on:'))).toEqual(SCALE_MIDI.map((m) => `on:${m}`))
    expect(events.filter((e) => e.startsWith('off:'))).toEqual(SCALE_MIDI.map((m) => `off:${m}`))
    expect(events.filter((e) => e.startsWith('measure:'))).toEqual(['measure:0', 'measure:1'])
    expect(events.at(-1)).toBe('end')
  })

  it('a barrier behind the playhead never fires', () => {
    const h = harness()
    h.transport.play()
    pump(h, 1000)
    h.transport.setBarrier(asTicks(QUARTER))
    expect(pump(h, 500)).toEqual(['off:64', 'on:65'])
    expect(h.transport.positionTicks).toBe(3 * QUARTER)
    expect(h.transport.isAtBarrier).toBe(false)
  })

  it('a barrier on or past the loop end never fires — the loop wraps as usual', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.setBarrier(asTicks(BAR))
    h.transport.play()
    const events = pump(h, 2100)
    expect(events.filter((e) => e.startsWith('loop:'))).toEqual(['loop:1'])
    expect(h.transport.positionTicks).toBe(96)
  })

  it('parks again on the next loop pass when it is re-armed behind the playhead', () => {
    const h = harness(C_MAJOR_SCALE_RH, { loop: loopRange(0, BAR) })
    h.transport.setBarrier(asTicks(QUARTER))
    h.transport.play()
    expect(pump(h, 5000)).toEqual(['measure:0', 'on:60', 'off:60', 'on:62'])
    h.transport.setBarrier(null)
    expect(pump(h, 100)).toEqual([])
    // Re-armed behind the playhead it is inert for the rest of this pass, and
    // catches the second pass on its beat 2 — a wrap puts it ahead again.
    h.transport.setBarrier(asTicks(QUARTER))
    expect(pump(h, 5000)).toEqual([
      'off:62',
      'on:64',
      'off:64',
      'on:65',
      'off:65',
      'loop:1',
      'measure:0',
      'on:60',
      'off:60',
      'on:62',
    ])
    expect(h.transport.positionTicks).toBe(QUARTER)
    expect(h.transport.loopIteration).toBe(1)
  })

  it('parks immediately when armed on the tick the playhead is already on', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(QUARTER))
    h.transport.play()
    pump(h, 5000)
    // Still at 480 and still armed at 480: the playhead has arrived, so it stays.
    h.transport.setBarrier(asTicks(QUARTER))
    expect(pump(h, 5000)).toEqual([])
    expect(h.transport.positionTicks).toBe(QUARTER)
  })

  it('holds back the end of the piece when it sits on the final tick', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(2 * BAR))
    h.transport.play()
    const events = pump(h, 9000)
    expect(events).not.toContain('end')
    expect(h.transport.positionTicks).toBe(2 * BAR)
    expect(h.transport.state).toBe('playing')
    h.transport.setBarrier(null)
    expect(pump(h, 0)).toEqual(['end'])
    expect(h.transport.state).toBe('stopped')
  })

  it('a seek out of a parked barrier hands the clock back to playback', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(QUARTER))
    h.transport.play()
    pump(h, 5000)
    expect(h.transport.isAtBarrier).toBe(true)
    h.transport.seekTick(asTicks(0))
    expect(h.transport.isAtBarrier).toBe(false)
    // The seek already re-anchored, so this half second is ordinary playing time
    // and must be replayed — dropping the barrier must not discard it a second time.
    h.clock.advance(500)
    h.transport.setBarrier(null)
    expect(pump(h, 0)).toEqual(['off:62', 'measure:0', 'on:60', 'off:60', 'on:62'])
    expect(h.transport.positionTicks).toBe(QUARTER)
  })

  it('is cleared by stop', () => {
    const h = harness()
    h.transport.setBarrier(asTicks(QUARTER))
    h.transport.play()
    pump(h, 5000)
    h.transport.stop()
    expect(h.transport.barrierTick).toBeNull()
    expect(h.transport.isAtBarrier).toBe(false)
    h.transport.play()
    expect(pump(h, 1000).filter((e) => e.startsWith('on:'))).toEqual(['on:60', 'on:62', 'on:64'])
  })

  it('clearing an unarmed barrier is a no-op', () => {
    const h = harness()
    h.transport.setBarrier(null)
    expect(h.transport.barrierTick).toBeNull()
    h.transport.play()
    expect(pump(h, 500)).toEqual(['measure:0', 'on:60', 'off:60', 'on:62'])
  })

  it('gates a chord whole: the wait happens with the barrier tick sounding', () => {
    // What wait mode needs: park ON the onset, with every note of it ringing.
    const h = harness(TWO_HAND_CHORDS)
    h.transport.setBarrier(asTicks(BAR))
    h.transport.play()
    const events = pump(h, 60_000)
    expect(events.slice(-4)).toEqual(['on:41', 'on:45', 'on:48', 'on:77'])
    expect(h.transport.positionTicks).toBe(BAR)
    expect(h.transport.soundingNotes.map((n) => n.midi)).toEqual([41, 45, 48, 77])
  })

  it('throws on a non-finite barrier', () => {
    const h = harness()
    expect(() => h.transport.setBarrier(asTicks(Number.NaN))).toThrow(InvariantError)
  })
})

// -------------------------------------------------------------- named cases

describe('real-music cases', () => {
  it('plays a C major scale as eight even quarter notes, 500 ms apart', () => {
    // C4 D4 E4 F4 G4 A4 B4 C5 at ♩=120 — the attacks land at 0, 500, ... 3500 ms.
    const h = harness()
    h.transport.play()
    const attacks: number[] = []
    for (let ms = 0; ms <= 4000; ms += 50) {
      for (const event of h.transport.tick()) {
        if (event.type === 'noteOn') attacks.push(ms)
      }
      h.clock.advance(50)
    }
    expect(attacks).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500])
  })

  it('sounds a four-bar I–IV–V–I progression with 25 notes', () => {
    // TWO_HAND_CHORDS: 12 left-hand triad notes + 13 right-hand melody notes.
    const h = harness(TWO_HAND_CHORDS)
    h.transport.play()
    const events = runToEnd(h)
    expect(events.filter((e) => e.type === 'noteOn')).toHaveLength(25)
    expect(events.filter((e) => e.type === 'noteOff')).toHaveLength(25)
    expect(events.filter((e) => e.type === 'measure')).toHaveLength(4)
    expect(h.transport.positionMs).toBe(8000) // four 4/4 bars at ♩=120
  })

  it('starts a 3/4 pickup piece on the upbeat', () => {
    // G4 | C5 D5 E5 | F5 — measure 0 is one beat long, so bar 1 starts at 480.
    const h = harness(PICKUP_MEASURE)
    h.transport.play()
    expect(pump(h, 0)).toEqual(['measure:0', 'on:67'])
    expect(pump(h, 500)).toEqual(['measure:1', 'off:67', 'on:72'])
  })
})

// -------------------------------------------------------------- property tests

/** Notes that never cross a bar line, so `makeScore` accepts them. */
const arbNote = fc
  .record({
    bar: fc.integer({ min: 0, max: 3 }),
    slot: fc.integer({ min: 0, max: 7 }),
    eighths: fc.integer({ min: 0, max: 8 }),
    midi: fc.integer({ min: 36, max: 96 }),
    hand: fc.constantFrom<'left' | 'right'>('left', 'right'),
  })
  .map(({ bar, slot, eighths, midi, hand }): TestNote => {
    const eighth = 240
    return {
      midi,
      startTick: bar * BAR + slot * eighth,
      durationTicks: Math.min(eighths, 8 - slot) * eighth,
      hand,
    }
  })

const arbScore = fc
  .array(arbNote, { maxLength: 14 })
  .map((notes) => buildTestScore(notes, { measureCount: 4 }))

const arbAdvances = fc.array(fc.integer({ min: 0, max: 1500 }), { maxLength: 25 })

/** Play `score` to the end, pumping with the given wall-clock gaps. */
const play = (
  score: Score,
  advances: readonly number[],
  opts: HarnessOptions = {},
): TransportEvent[] => {
  const h = harness(score, opts)
  h.transport.play()
  const events: TransportEvent[] = []
  let ended = false
  for (const ms of advances) {
    const batch = pumpRaw(h, ms)
    events.push(...batch)
    ended ||= batch.some((e) => e.type === 'end')
  }
  for (let i = 0; i < 60 && !ended; i++) {
    const batch = pumpRaw(h, 2000)
    events.push(...batch)
    ended ||= batch.some((e) => e.type === 'end')
  }
  expect(ended).toBe(true)
  return events
}

const idsOf = (events: readonly TransportEvent[], type: 'noteOn' | 'noteOff'): string[] =>
  events.flatMap((e) => (e.type === type ? [e.note.id] : []))

describe('properties', () => {
  it('sounds every note exactly once, however the wall clock is chopped up', () => {
    fc.assert(
      fc.property(
        arbScore,
        arbAdvances,
        fc.integer({ min: 0, max: 4 }),
        (score, advances, beats) => {
          const events = play(score, advances, beats === 0 ? {} : { countInBeats: beats })
          expect(idsOf(events, 'noteOn').sort()).toEqual(score.notes.map((n) => n.id).sort())
        },
      ),
    )
  })

  it('releases every note exactly once, never before its attack', () => {
    fc.assert(
      fc.property(arbScore, arbAdvances, (score, advances) => {
        const events = play(score, advances)
        const sounding = new Set<string>()
        for (const event of events) {
          if (event.type === 'noteOn') {
            expect(sounding.has(event.note.id)).toBe(false)
            sounding.add(event.note.id)
          } else if (event.type === 'noteOff') {
            expect(sounding.delete(event.note.id)).toBe(true)
          }
        }
        expect([...sounding]).toEqual([])
        expect(idsOf(events, 'noteOff').sort()).toEqual(score.notes.map((n) => n.id).sort())
      }),
    )
  })

  it('emits attacks in non-decreasing tick order', () => {
    fc.assert(
      fc.property(arbScore, arbAdvances, (score, advances) => {
        const events = play(score, advances)
        let previous = Number.NEGATIVE_INFINITY
        for (const event of events) {
          if (event.type !== 'noteOn') continue
          expect(event.note.startTick).toBeGreaterThanOrEqual(previous)
          previous = event.note.startTick
        }
      }),
    )
  })

  it('emits bar lines once each, in order, and ends with `end`', () => {
    fc.assert(
      fc.property(arbScore, arbAdvances, (score, advances) => {
        const events = play(score, advances)
        const measures = events.flatMap((e) => (e.type === 'measure' ? [e.index] : []))
        expect(measures).toEqual(score.measures.map((m) => m.index))
        expect(events.at(-1)?.type).toBe('end')
      }),
    )
  })

  it('pausing and resuming changes nothing about what is emitted', () => {
    fc.assert(
      fc.property(arbScore, arbAdvances, (score, advances) => {
        const straight = play(score, advances).map(label)

        const h = harness(score)
        h.transport.play()
        const events: string[] = []
        let ended = false
        for (const ms of advances) {
          if (ended) break
          const batch = pumpRaw(h, ms)
          events.push(...batch.map(label))
          ended = batch.some((e) => e.type === 'end')
          if (ended) break
          h.transport.pause()
          expect(pumpRaw(h, 7777)).toEqual([])
          h.transport.play()
        }
        for (let i = 0; i < 60 && !ended; i++) {
          const batch = pumpRaw(h, 2000)
          events.push(...batch.map(label))
          ended ||= batch.some((e) => e.type === 'end')
        }
        expect(events).toEqual(straight)
      }),
    )
  })

  it('a tempo scale never changes what is emitted, only when', () => {
    fc.assert(
      fc.property(
        arbScore,
        arbAdvances,
        fc.integer({ min: 25, max: 200 }),
        (score, advances, pct) => {
          const straight = play(score, advances).map(label)
          const h = harness(score)
          h.transport.setTempoScale(pct / 100)
          h.transport.play()
          const events: string[] = []
          for (let i = 0; i < 200; i++) {
            const batch = pumpRaw(h, 500)
            events.push(...batch.map(label))
            if (batch.some((e) => e.type === 'end')) break
          }
          // The WHOLE stream, not just the attacks: a scale that dropped a
          // release, doubled a bar line or lost the `end` would pass otherwise.
          expect(events).toEqual(straight)
        },
      ),
    )
  })

  it('a barrier on every onset changes nothing about what is emitted', () => {
    // Wait mode's shape, minus the waiting: park on each onset in turn, let go
    // immediately, and the piece must come out bit-for-bit the same.
    const nextOnsetAfter = (score: Score, tick: number): number | null =>
      score.notes.find((n) => n.startTick > tick)?.startTick ?? null

    fc.assert(
      fc.property(arbScore, arbAdvances, (score, advances) => {
        const straight = play(score, advances).map(label)
        const h = harness(score)
        h.transport.play()
        const events: string[] = []
        let ended = false
        for (const ms of [...advances, ...Array<number>(60).fill(2000)]) {
          if (ended) break
          const next = nextOnsetAfter(score, h.transport.positionTicks)
          h.transport.setBarrier(next === null ? null : asTicks(next))
          const batch = pumpRaw(h, ms)
          events.push(...batch.map(label))
          ended = batch.some((e) => e.type === 'end')
          h.transport.setBarrier(null)
        }
        expect(ended).toBe(true)
        expect(events).toEqual(straight)
      }),
    )
  })

  it('the playhead never goes backwards while playing', () => {
    fc.assert(
      fc.property(arbScore, arbAdvances, (score, advances) => {
        const h = harness(score)
        h.transport.play()
        let previous = h.transport.positionTicks as number
        for (const ms of advances) {
          pumpRaw(h, ms)
          const now = h.transport.positionTicks as number
          expect(now).toBeGreaterThanOrEqual(previous)
          previous = now
        }
      }),
    )
  })

  it('a loop never sounds a note outside its range', () => {
    fc.assert(
      fc.property(
        arbScore,
        arbAdvances,
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (score, advances, from, span) => {
          const startTick = from * BAR
          const endTick = Math.min(4, from + span) * BAR
          const h = harness(score, {
            loop: { startTick: asTicks(startTick), endTick: asTicks(endTick) },
          })
          h.transport.seekTick(asTicks(startTick))
          h.transport.play()
          const events: TransportEvent[] = []
          for (const ms of advances) events.push(...pumpRaw(h, ms))
          for (const event of events) {
            if (event.type !== 'noteOn') continue
            expect(event.note.startTick).toBeGreaterThanOrEqual(startTick)
            expect(event.note.startTick).toBeLessThan(endTick)
          }
          const iterations = events.filter((e) => e.type === 'loop').map((e) => e.iteration)
          expect(iterations).toEqual(iterations.map((_, i) => i + 1))
        },
      ),
    )
  })

  it('seeking releases everything that was sounding', () => {
    fc.assert(
      fc.property(arbScore, fc.integer({ min: 0, max: 8000 }), (score, ms) => {
        const h = harness(score)
        h.transport.play()
        pumpRaw(h, ms)
        const sounding = h.transport.soundingNotes.map((n) => n.id)
        h.transport.seekTick(asTicks(0))
        expect(h.transport.soundingNotes).toEqual([])
        const released = h.transport
          .tick()
          .flatMap((e) => (e.type === 'noteOff' ? [e.note.id] : []))
        expect(released.slice(0, sounding.length)).toEqual(sounding)
      }),
    )
  })

  it('position in ticks and in milliseconds always agree', () => {
    fc.assert(
      fc.property(
        arbScore,
        arbAdvances,
        fc.integer({ min: 25, max: 200 }),
        (score, advances, pct) => {
          const h = harness(score, { scale: pct / 100 })
          h.transport.play()
          for (const ms of advances) {
            pumpRaw(h, ms)
            const map = h.transport.tempoMap
            const expected = (h.transport.positionTicks as number) * (125 / 120 / map.scale)
            expect(h.transport.positionMs as number).toBeCloseTo(expected, 6)
          }
        },
      ),
    )
  })
})
