import { describe, expect, it } from 'vitest'
import { midi, millis } from '@core/shared/units.ts'
import { createKitMapEngine } from './engine.ts'
import {
  ALESIS_GM_KIT_MAP,
  GM_KIT_MAP,
  KIT_MAP_PRESETS,
  ROLAND_TD_KIT_MAP,
  YAMAHA_DTX_KIT_MAP,
} from './presets.ts'

describe('KIT_MAP_PRESETS', () => {
  it('ships exactly the four presets the DR-02 brief asks for, each with a distinct name', () => {
    expect(KIT_MAP_PRESETS).toHaveLength(4)
    expect(new Set(KIT_MAP_PRESETS.map((k) => k.name)).size).toBe(4)
    expect(KIT_MAP_PRESETS).toEqual([GM_KIT_MAP, ROLAND_TD_KIT_MAP, ALESIS_GM_KIT_MAP, YAMAHA_DTX_KIT_MAP])
  })

  it('every preset uses the Roland TD default closed threshold (90) unless it says otherwise', () => {
    for (const kitMap of KIT_MAP_PRESETS) expect(kitMap.hiHat?.closedThreshold).toBe(90)
  })
})

describe('GM_KIT_MAP — research §3 core kit table (lines 95-102)', () => {
  it('has the exact notes the research doc names', () => {
    expect(GM_KIT_MAP.notes[35]).toEqual({ kind: 'pad', pad: 'kick' })
    expect(GM_KIT_MAP.notes[36]).toEqual({ kind: 'pad', pad: 'kick' })
    expect(GM_KIT_MAP.notes[38]).toEqual({ kind: 'pad', pad: 'snare' })
    expect(GM_KIT_MAP.notes[40]).toEqual({ kind: 'pad', pad: 'snare' })
    expect(GM_KIT_MAP.notes[42]).toEqual({ kind: 'pad', pad: 'hhClosed' })
    expect(GM_KIT_MAP.notes[44]).toEqual({ kind: 'pad', pad: 'hhPedal' })
    expect(GM_KIT_MAP.notes[46]).toEqual({ kind: 'pad', pad: 'hhOpen' })
    expect(GM_KIT_MAP.notes[49]).toEqual({ kind: 'pad', pad: 'crash1' })
    expect(GM_KIT_MAP.notes[57]).toEqual({ kind: 'pad', pad: 'crash2' })
    expect(GM_KIT_MAP.notes[51]).toEqual({ kind: 'pad', pad: 'rideBow' })
    expect(GM_KIT_MAP.notes[59]).toEqual({ kind: 'pad', pad: 'rideBow' })
    expect(GM_KIT_MAP.notes[53]).toEqual({ kind: 'pad', pad: 'rideBell' })
    expect(GM_KIT_MAP.notes[55]).toEqual({ kind: 'pad', pad: 'splash' })
  })

  it('never uses the CC#4-gated hiHat entry kind — GM sends distinct notes per hi-hat state, no CC needed', () => {
    for (const entry of Object.values(GM_KIT_MAP.notes)) expect(entry.kind).toBe('pad')
  })

  it('resolves a kick hit end-to-end through the engine', () => {
    const engine = createKitMapEngine({ kitMap: GM_KIT_MAP })
    const out = engine.handle({ type: 'noteOn', note: midi(36), velocity: 100, time: millis(0) })
    expect(out).toEqual([{ kind: 'hit', hit: { pad: 'kick', velocity: 100, time: 0, articulations: [] } }])
  })
})

describe('ROLAND_TD_KIT_MAP — research §3 extended zone map', () => {
  it('has the exact extension notes the research doc names', () => {
    expect(ROLAND_TD_KIT_MAP.notes[22]).toEqual({ kind: 'pad', pad: 'hhClosed' }) // hi-hat edge, closed
    expect(ROLAND_TD_KIT_MAP.notes[26]).toEqual({ kind: 'pad', pad: 'hhOpen' }) // hi-hat edge, open
    expect(ROLAND_TD_KIT_MAP.notes[40]).toEqual({ kind: 'pad', pad: 'snareRim' }) // overrides GM's electric snare
    expect(ROLAND_TD_KIT_MAP.notes[53]).toEqual({ kind: 'pad', pad: 'rideBell' })
    expect(ROLAND_TD_KIT_MAP.notes[59]).toEqual({ kind: 'pad', pad: 'rideEdge' }) // overrides GM's ride-2 fallback
  })

  it('does not model the ambiguous aux (27/28) or colliding tom-rim (47/50/58) numbers', () => {
    expect(ROLAND_TD_KIT_MAP.notes[27]).toBeUndefined()
    expect(ROLAND_TD_KIT_MAP.notes[28]).toBeUndefined()
    // 47/50 stay claimed by the base tom BOW zone, not overridden to a rim.
    expect(ROLAND_TD_KIT_MAP.notes[47]).toEqual({ kind: 'pad', pad: 'tomMid' })
    expect(ROLAND_TD_KIT_MAP.notes[50]).toEqual({ kind: 'pad', pad: 'tomHigh' })
  })

  it('inherits the GM-compatible base zone for kick/snare/toms', () => {
    expect(ROLAND_TD_KIT_MAP.notes[35]).toEqual({ kind: 'pad', pad: 'kick' })
    expect(ROLAND_TD_KIT_MAP.notes[41]).toEqual({ kind: 'pad', pad: 'tomFloor' })
  })

  it('resolves the hi-hat edge extension end-to-end (closed and open, distinct notes — no CC needed)', () => {
    const engine = createKitMapEngine({ kitMap: ROLAND_TD_KIT_MAP })
    const closed = engine.handle({ type: 'noteOn', note: midi(22), velocity: 90, time: millis(0) })
    const open = engine.handle({ type: 'noteOn', note: midi(26), velocity: 90, time: millis(1000) })
    expect(closed).toEqual([{ kind: 'hit', hit: { pad: 'hhClosed', velocity: 90, time: 0, articulations: [] } }])
    expect(open).toEqual([{ kind: 'hit', hit: { pad: 'hhOpen', velocity: 90, time: 1000, articulations: [] } }])
  })
})

describe('ALESIS_GM_KIT_MAP — GM mode is literally the GM map', () => {
  it("is GM_KIT_MAP's own table, not a re-typed copy that could drift from it", () => {
    expect(ALESIS_GM_KIT_MAP.notes).toBe(GM_KIT_MAP.notes)
  })

  it('has its own preset name, distinct from GM_KIT_MAP', () => {
    expect(ALESIS_GM_KIT_MAP.name).not.toBe(GM_KIT_MAP.name)
  })
})

describe('YAMAHA_DTX_KIT_MAP — research §3: ride 83, toms 43/51/49, splash 47', () => {
  it('has the exact notes the research doc names', () => {
    expect(YAMAHA_DTX_KIT_MAP.notes[83]).toEqual({ kind: 'pad', pad: 'rideBow' })
    expect(YAMAHA_DTX_KIT_MAP.notes[43]).toEqual({ kind: 'pad', pad: 'tomFloor' })
    expect(YAMAHA_DTX_KIT_MAP.notes[51]).toEqual({ kind: 'pad', pad: 'tomMid' })
    expect(YAMAHA_DTX_KIT_MAP.notes[49]).toEqual({ kind: 'pad', pad: 'tomHigh' })
    expect(YAMAHA_DTX_KIT_MAP.notes[47]).toEqual({ kind: 'pad', pad: 'splash' })
  })

  it('has no crash1/crash2/rideEdge/snareRim entry — no honest fallback slot survived Yamaha\'s own reassignments', () => {
    const mappedPads = new Set(
      Object.values(YAMAHA_DTX_KIT_MAP.notes).map((e) => (e.kind === 'pad' ? e.pad : undefined)),
    )
    expect(mappedPads.has('crash1')).toBe(false)
    expect(mappedPads.has('crash2')).toBe(false)
    expect(mappedPads.has('rideEdge')).toBe(false)
    expect(mappedPads.has('snareRim')).toBe(false)
  })

  it('resolves the out-of-GM-range ride note (83) end-to-end', () => {
    const engine = createKitMapEngine({ kitMap: YAMAHA_DTX_KIT_MAP })
    const out = engine.handle({ type: 'noteOn', note: midi(83), velocity: 90, time: millis(0) })
    expect(out).toEqual([{ kind: 'hit', hit: { pad: 'rideBow', velocity: 90, time: 0, articulations: [] } }])
  })

  it('a note research does not name for Yamaha (e.g. a crash) surfaces as unmapped, not a guess', () => {
    const engine = createKitMapEngine({ kitMap: YAMAHA_DTX_KIT_MAP })
    const out = engine.handle({ type: 'noteOn', note: midi(49), velocity: 90, time: millis(0) })
    // 49 is repurposed as tomHigh for Yamaha, not silently absent — reaffirms the override, not a guess.
    expect(out).toEqual([{ kind: 'hit', hit: { pad: 'tomHigh', velocity: 90, time: 0, articulations: [] } }])
  })
})
