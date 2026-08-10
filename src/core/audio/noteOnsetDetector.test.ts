import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ONSET_CONFIG,
  initialOnsetState,
  stepOnsetDetector,
  type OnsetConfig,
  type OnsetDetectorState,
} from '@core/audio/noteOnsetDetector.ts'
import { midiToFrequency } from '@core/audio/pitchDetection.ts'

const CONFIG = DEFAULT_ONSET_CONFIG
const strongSample = (note: number): { frequencyHz: number; clarity: number } => ({
  frequencyHz: midiToFrequency(note),
  clarity: 0.98,
})

function feedAll(
  frames: readonly ({ frequencyHz: number; clarity: number } | null)[],
  config: OnsetConfig = CONFIG,
): { state: OnsetDetectorState; events: (readonly { type: string; note: number }[])[] } {
  let state = initialOnsetState
  const events: (readonly { type: string; note: number }[])[] = []
  for (const frame of frames) {
    const step = stepOnsetDetector(state, frame, config)
    state = step.state
    events.push(step.events)
  }
  return { state, events }
}

describe('stepOnsetDetector', () => {
  it('does not fire a note-on before onsetFrames consecutive matching frames', () => {
    const frames = Array.from({ length: CONFIG.onsetFrames - 1 }, () => strongSample(60))
    const { events } = feedAll(frames)
    expect(events.flat()).toEqual([])
  })

  it('fires exactly one note-on on the frame that completes onsetFrames', () => {
    const frames = Array.from({ length: CONFIG.onsetFrames }, () => strongSample(60))
    const { events } = feedAll(frames)
    expect(events.flat()).toEqual([{ type: 'on', note: 60 }])
  })

  it('holding the same note for many more frames fires no further events', () => {
    const frames = Array.from({ length: CONFIG.onsetFrames + 20 }, () => strongSample(60))
    const { events } = feedAll(frames)
    expect(events.flat()).toEqual([{ type: 'on', note: 60 }])
  })

  it('fires note-off after releaseFrames consecutive silent frames', () => {
    const onFrames = Array.from({ length: CONFIG.onsetFrames }, () => strongSample(60))
    const silence = Array.from({ length: CONFIG.releaseFrames }, () => null)
    const { events } = feedAll([...onFrames, ...silence])
    expect(events.flat()).toEqual([
      { type: 'on', note: 60 },
      { type: 'off', note: 60 },
    ])
  })

  it('does not fire note-off before releaseFrames consecutive silent frames — a single dropout does not cut a held note', () => {
    const onFrames = Array.from({ length: CONFIG.onsetFrames }, () => strongSample(60))
    const briefGap = Array.from({ length: CONFIG.releaseFrames - 1 }, () => null)
    const { events } = feedAll([...onFrames, ...briefGap, strongSample(60)])
    expect(events.flat()).toEqual([{ type: 'on', note: 60 }])
  })

  it('a frame below minClarity is treated as silence, not as a detection', () => {
    const weakFrames = Array.from({ length: CONFIG.onsetFrames + 5 }, () => ({
      frequencyHz: midiToFrequency(60),
      clarity: CONFIG.minClarity - 0.01,
    }))
    const { events } = feedAll(weakFrames)
    expect(events.flat()).toEqual([])
  })

  it('a pitch more than maxCentsOff from the nearest semitone is not a note', () => {
    const bentFrames = Array.from({ length: CONFIG.onsetFrames + 5 }, () => ({
      frequencyHz: midiToFrequency(60) * 2 ** (0.5 / 12), // 50 cents sharp of C4
      clarity: 0.98,
    }))
    const { events } = feedAll(bentFrames)
    expect(events.flat()).toEqual([])
  })

  it('switching directly from one held note to another turns the old one off and the new one on together', () => {
    const holdFirst = Array.from({ length: CONFIG.onsetFrames + 3 }, () => strongSample(60))
    const switchToSecond = Array.from({ length: CONFIG.onsetFrames }, () => strongSample(64))
    const { events } = feedAll([...holdFirst, ...switchToSecond])
    expect(events.flat()).toEqual([
      { type: 'on', note: 60 },
      { type: 'off', note: 60 },
      { type: 'on', note: 64 },
    ])
  })

  it('a candidate that never reaches onsetFrames resets on silence, without ever firing', () => {
    const partial = Array.from({ length: CONFIG.onsetFrames - 1 }, () => strongSample(60))
    const { events } = feedAll([...partial, null, ...partial])
    expect(events.flat()).toEqual([])
  })

  it('property: for any frame sequence, note-on and note-off for a given note always alternate, starting with on', () => {
    const frameArb = fc.option(
      fc.record({
        frequencyHz: fc.integer({ min: 21, max: 108 }).map(midiToFrequency),
        clarity: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { nil: null },
    )
    fc.assert(
      fc.property(fc.array(frameArb, { minLength: 0, maxLength: 60 }), (frames) => {
        const { events } = feedAll(frames)
        const flat = events.flat()
        const byNote = new Map<number, string[]>()
        for (const event of flat) {
          const list = byNote.get(event.note) ?? []
          list.push(event.type)
          byNote.set(event.note, list)
        }
        for (const [, sequence] of byNote) {
          for (let i = 0; i < sequence.length; i++) {
            expect(sequence[i]).toBe(i % 2 === 0 ? 'on' : 'off')
          }
        }
      }),
    )
  })

  it('property: never more than one note held at a time (an "on" never appears without the prior note already having an "off")', () => {
    const frameArb = fc.option(fc.integer({ min: 21, max: 108 }).map(strongSample), { nil: null })
    fc.assert(
      fc.property(fc.array(frameArb, { minLength: 0, maxLength: 60 }), (frames) => {
        let heldCount = 0
        const { events } = feedAll(frames)
        for (const event of events.flat()) {
          if (event.type === 'on') {
            expect(heldCount).toBe(0)
            heldCount = 1
          } else {
            expect(heldCount).toBe(1)
            heldCount = 0
          }
        }
      }),
    )
  })
})
