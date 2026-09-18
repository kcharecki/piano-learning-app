import { describe, expect, it } from 'vitest'
import type { KitMapOutput } from '@core/drums/kitmap/engine.ts'
import { makeDrumHit } from '@core/drums/model/hit.ts'
import { midi, millis } from '@core/shared/units.ts'
import type { MidiEvent } from '@core/ports/midi.ts'
import {
  appendEntry,
  classify,
  monitorGapText,
  monitorLine,
  MONITOR_CAPACITY,
  type MonitorEntry,
} from './monitor.ts'

function entry(seq: number, overrides: Partial<MonitorEntry> = {}): MonitorEntry {
  return {
    seq,
    atMs: seq,
    raw: { kind: 'noteOff', note: 38 },
    verdict: { kind: 'ignored' },
    ...overrides,
  }
}

describe('appendEntry', () => {
  it('puts the new entry first', () => {
    const result = appendEntry([entry(1)], entry(2))
    expect(result.map((e) => e.seq)).toEqual([2, 1])
  })

  it('caps at MONITOR_CAPACITY, dropping the oldest', () => {
    let entries: readonly MonitorEntry[] = []
    for (let i = 0; i < MONITOR_CAPACITY; i++) {
      entries = appendEntry(entries, entry(i))
    }
    expect(entries).toHaveLength(MONITOR_CAPACITY)

    const withOneMore = appendEntry(entries, entry(MONITOR_CAPACITY))
    expect(withOneMore).toHaveLength(MONITOR_CAPACITY)
    expect(withOneMore[0]?.seq).toBe(MONITOR_CAPACITY)
    expect(withOneMore.at(-1)?.seq).toBe(1)
  })
})

describe('classify', () => {
  it('a mapped note-on with a hit output classifies as pad', () => {
    const event: MidiEvent = { type: 'noteOn', note: midi(38), velocity: 92, time: millis(0) }
    const hit = makeDrumHit({ pad: 'snare', velocity: 92, time: millis(0) })
    const outputs: readonly KitMapOutput[] = [{ kind: 'hit', hit }]

    const result = classify(1, 100, event, outputs)

    expect(result).toEqual({
      seq: 1,
      atMs: 100,
      raw: { kind: 'noteOn', note: 38, velocity: 92 },
      verdict: { kind: 'pad', pad: 'snare', articulations: [] },
    })
  })

  it('a mapped note-on producing a choke hit carries the choke articulation', () => {
    const event: MidiEvent = { type: 'noteOn', note: midi(46), velocity: 80, time: millis(0) }
    const hit = makeDrumHit({ pad: 'hhOpen', velocity: 80, time: millis(0), articulations: ['choke'] })
    const outputs: readonly KitMapOutput[] = [{ kind: 'hit', hit }]

    const result = classify(1, 0, event, outputs)

    expect(result.verdict).toEqual({ kind: 'pad', pad: 'hhOpen', articulations: ['choke'] })
  })

  it('a note-on with an unmapped output classifies as unmapped', () => {
    const event: MidiEvent = { type: 'noteOn', note: midi(27), velocity: 60, time: millis(0) }
    const outputs: readonly KitMapOutput[] = [
      { kind: 'unmapped', event: { note: midi(27), velocity: 60, time: millis(0) } },
    ]

    const result = classify(1, 0, event, outputs)

    expect(result.verdict).toEqual({ kind: 'unmapped' })
  })

  it('a note-on with no output at all classifies as dropped', () => {
    const event: MidiEvent = { type: 'noteOn', note: midi(38), velocity: 92, time: millis(10) }

    const result = classify(1, 0, event, [])

    expect(result.verdict).toEqual({ kind: 'dropped' })
  })

  it('CC#4 always classifies as position, regardless of engine output', () => {
    const event: MidiEvent = { type: 'controlChange', controller: 4, value: 127, time: millis(0) }

    const result = classify(1, 0, event, [])

    expect(result.raw).toEqual({ kind: 'cc', controller: 4, value: 127 })
    expect(result.verdict).toEqual({ kind: 'position', value: 127 })
  })

  it('a control change other than CC#4 classifies as ignored', () => {
    const event: MidiEvent = { type: 'controlChange', controller: 64, value: 1, time: millis(0) }

    const result = classify(1, 0, event, [])

    expect(result.verdict).toEqual({ kind: 'ignored' })
  })

  it('note-off classifies as ignored', () => {
    const event: MidiEvent = { type: 'noteOff', note: midi(38), time: millis(0) }

    const result = classify(1, 0, event, [])

    expect(result.raw).toEqual({ kind: 'noteOff', note: 38 })
    expect(result.verdict).toEqual({ kind: 'ignored' })
  })

  it('poly aftertouch producing a choke hit classifies as pad, carrying the choke articulation', () => {
    const event: MidiEvent = { type: 'polyAftertouch', note: midi(49), pressure: 80, time: millis(0) }
    const hit = makeDrumHit({ pad: 'crash1', velocity: 80, time: millis(0), articulations: ['choke'] })
    const outputs: readonly KitMapOutput[] = [{ kind: 'hit', hit }]

    const result = classify(1, 0, event, outputs)

    expect(result.raw).toEqual({ kind: 'aftertouch', note: 49, pressure: 80 })
    expect(result.verdict).toEqual({ kind: 'pad', pad: 'crash1', articulations: ['choke'] })
  })

  it('poly aftertouch with no output classifies as ignored', () => {
    const event: MidiEvent = { type: 'polyAftertouch', note: midi(49), pressure: 80, time: millis(0) }

    const result = classify(1, 0, event, [])

    expect(result.raw).toEqual({ kind: 'aftertouch', note: 49, pressure: 80 })
    expect(result.verdict).toEqual({ kind: 'ignored' })
  })

  it('sustain down/up classify as ignored', () => {
    const down: MidiEvent = { type: 'sustain', down: true, time: millis(0) }
    const up: MidiEvent = { type: 'sustain', down: false, time: millis(0) }

    const downResult = classify(1, 0, down, [])
    expect(downResult.raw).toEqual({ kind: 'sustain', down: true })
    expect(downResult.verdict).toEqual({ kind: 'ignored' })

    const upResult = classify(1, 0, up, [])
    expect(upResult.raw).toEqual({ kind: 'sustain', down: false })
    expect(upResult.verdict).toEqual({ kind: 'ignored' })
  })
})

describe('monitorLine', () => {
  it('renders a mapped hit', () => {
    const line = monitorLine(
      entry(1, {
        raw: { kind: 'noteOn', note: 38, velocity: 92 },
        verdict: { kind: 'pad', pad: 'snare', articulations: [] },
      }),
    )
    expect(line).toBe('note 38 · vel 92 → Snare')
  })

  it('renders a choke suffix and omits other articulations', () => {
    const line = monitorLine(
      entry(1, {
        raw: { kind: 'noteOn', note: 46, velocity: 80 },
        verdict: { kind: 'pad', pad: 'hhOpen', articulations: ['choke'] },
      }),
    )
    expect(line).toBe('note 46 · vel 80 → Open hi-hat (choke)')

    const openOnly = monitorLine(
      entry(1, {
        raw: { kind: 'noteOn', note: 46, velocity: 80 },
        verdict: { kind: 'pad', pad: 'hhOpen', articulations: ['open'] },
      }),
    )
    expect(openOnly).toBe('note 46 · vel 80 → Open hi-hat')
  })

  it('renders unmapped', () => {
    const line = monitorLine(
      entry(1, { raw: { kind: 'noteOn', note: 27, velocity: 60 }, verdict: { kind: 'unmapped' } }),
    )
    expect(line).toBe('note 27 · vel 60 → not in the map')
  })

  it('renders dropped', () => {
    const line = monitorLine(
      entry(1, { raw: { kind: 'noteOn', note: 38, velocity: 92 }, verdict: { kind: 'dropped' } }),
    )
    expect(line).toBe('note 38 · vel 92 → dropped (bounce or too soft)')
  })

  it('renders CC#4 as pedal position', () => {
    const line = monitorLine(
      entry(1, { raw: { kind: 'cc', controller: 4, value: 127 }, verdict: { kind: 'position', value: 127 } }),
    )
    expect(line).toBe('CC 4 = 127 → pedal position')
  })

  it('renders note off as ignored', () => {
    const line = monitorLine(entry(1, { raw: { kind: 'noteOff', note: 38 }, verdict: { kind: 'ignored' } }))
    expect(line).toBe('note off 38 → ignored')
  })

  it('renders an aftertouch choke', () => {
    const line = monitorLine(
      entry(1, {
        raw: { kind: 'aftertouch', note: 49, pressure: 80 },
        verdict: { kind: 'pad', pad: 'crash1', articulations: ['choke'] },
      }),
    )
    expect(line).toBe('aftertouch note 49 · pressure 80 → Crash (choke)')
  })

  it('renders aftertouch with no output as ignored', () => {
    const line = monitorLine(
      entry(1, { raw: { kind: 'aftertouch', note: 49, pressure: 80 }, verdict: { kind: 'ignored' } }),
    )
    expect(line).toBe('aftertouch note 49 · pressure 80 → ignored')
  })

  it('renders sustain down and up as ignored', () => {
    const down = monitorLine(entry(1, { raw: { kind: 'sustain', down: true }, verdict: { kind: 'ignored' } }))
    expect(down).toBe('sustain down → ignored')

    const up = monitorLine(entry(1, { raw: { kind: 'sustain', down: false }, verdict: { kind: 'ignored' } }))
    expect(up).toBe('sustain up → ignored')
  })
})

describe('monitorGapText', () => {
  it('is empty for the oldest entry shown (no older neighbour)', () => {
    expect(monitorGapText(entry(1, { atMs: 1000 }), undefined)).toBe('')
  })

  it('reports the rounded ms gap since the older neighbour', () => {
    const newer = entry(2, { atMs: 1004.4 })
    const older = entry(1, { atMs: 1000 })
    expect(monitorGapText(newer, older)).toBe('+4 ms')
  })

  it('clamps at 0 ms when the older neighbour is actually later', () => {
    const newer = entry(2, { atMs: 1000 })
    const older = entry(1, { atMs: 1004 })
    expect(monitorGapText(newer, older)).toBe('+0 ms')
  })
})
