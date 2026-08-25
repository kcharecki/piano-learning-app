import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { midi, millis } from '@core/shared/units.ts'
import { classifyHiHat, DEFAULT_HI_HAT_CONFIG, HI_HAT, pad, type KitMap } from './kitMap.ts'
import { createKitMapEngine, type KitMapOutput } from './engine.ts'

/**
 * A small synthetic kit map, independent of the shipped presets, that
 * exercises every code path: a plain kick/snare, a crash for choke tests, a
 * `HI_HAT` (CC#4-gated) entry — none of the shipped presets currently need
 * one, see `kitMap.ts`'s doc — and two fixed notes outside GM's 35-81 range
 * to prove range is never filtered.
 */
const TEST_KIT_MAP: KitMap = {
  name: 'test-kit',
  notes: {
    36: pad('kick'),
    38: pad('snare'),
    49: pad('crash1'),
    26: HI_HAT,
    22: pad('hhClosed'), // below GM's 35-81 range
    90: pad('crash2'), // above GM's 35-81 range
  },
}

function expectHit(out: readonly KitMapOutput[]): Extract<KitMapOutput, { kind: 'hit' }> {
  const first = out[0]
  if (first?.kind !== 'hit') throw new Error(`expected a hit, got ${JSON.stringify(out)}`)
  return first
}

describe('KitMapEngine — plain fixed-pad hits', () => {
  it('a mapped note-on produces a hit with the exact pad/velocity/time and no articulation', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const out = engine.handle({ type: 'noteOn', note: midi(36), velocity: 100, time: millis(1234) })

    expect(out).toEqual([{ kind: 'hit', hit: { pad: 'kick', velocity: 100, time: 1234, articulations: [] } }])
  })

  it('noteOff and sustain never produce output — drum notes are events, not held (research §3)', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    expect(engine.handle({ type: 'noteOff', note: midi(38), time: millis(0) })).toEqual([])
    expect(engine.handle({ type: 'sustain', down: true, time: millis(0) })).toEqual([])
  })

  it('resolves fixed notes outside the 35-81 GM range normally, never as unmapped', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const low = engine.handle({ type: 'noteOn', note: midi(22), velocity: 90, time: millis(0) })
    const high = engine.handle({ type: 'noteOn', note: midi(90), velocity: 90, time: millis(1000) })

    expect(low).toEqual([{ kind: 'hit', hit: { pad: 'hhClosed', velocity: 90, time: 0, articulations: [] } }])
    expect(high).toEqual([{ kind: 'hit', hit: { pad: 'crash2', velocity: 90, time: 1000, articulations: [] } }])
  })
})

describe('KitMapEngine — velocity-0 note-on (spec: treated as note-off, ignored for hits)', () => {
  it('produces no hit for a velocity-0 note-on, even though the adapter is documented to never send one (defense in depth)', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    expect(engine.handle({ type: 'noteOn', note: midi(36), velocity: 0, time: millis(0) })).toEqual([])
  })

  it('property: velocity 0 never produces a hit, for any mapped note or time', () => {
    fc.assert(
      fc.property(fc.constantFrom(36, 38, 49), fc.integer({ min: 0, max: 100_000 }), (note, t) => {
        const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })
        expect(engine.handle({ type: 'noteOn', note: midi(note), velocity: 0, time: millis(t) })).toEqual([])
      }),
    )
  })
})

describe('KitMapEngine — unmapped bucket (spec: never silently dropped)', () => {
  it('an unrecognised note surfaces as an unmapped event carrying the raw note/velocity/time', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const out = engine.handle({ type: 'noteOn', note: midi(60), velocity: 77, time: millis(500) })

    expect(out).toEqual([{ kind: 'unmapped', event: { note: 60, velocity: 77, time: 500 } }])
  })

  it('unmapped entries are debounced per raw note number, independently of other unmapped notes', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const first = engine.handle({ type: 'noteOn', note: midi(70), velocity: 90, time: millis(0) })
    const dup = engine.handle({ type: 'noteOn', note: midi(70), velocity: 90, time: millis(5) })
    const other = engine.handle({ type: 'noteOn', note: midi(71), velocity: 90, time: millis(5) })

    expect(first).toHaveLength(1)
    expect(dup).toEqual([])
    expect(other).toHaveLength(1)
  })

  it('property: any note not in the kit map surfaces as unmapped across the FULL MIDI range, never dropped', () => {
    const mappedNotes = new Set(Object.keys(TEST_KIT_MAP.notes).map(Number))
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }).filter((n) => !mappedNotes.has(n)),
        fc.integer({ min: 1, max: 127 }),
        fc.integer({ min: 0, max: 100_000 }),
        (note, velocity, t) => {
          const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })
          const out = engine.handle({ type: 'noteOn', note: midi(note), velocity, time: millis(t) })
          expect(out).toEqual([{ kind: 'unmapped', event: { note, velocity, time: t } }])
        },
      ),
    )
  })
})

describe('KitMapEngine — minimum-velocity gate (spec: default low, ghosts must pass)', () => {
  it('property: ghost velocities (30-50) always pass the default gate on any pad', () => {
    fc.assert(
      fc.property(fc.integer({ min: 30, max: 50 }), fc.integer({ min: 0, max: 100_000 }), (velocity, t) => {
        const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })
        const out = engine.handle({ type: 'noteOn', note: midi(38), velocity, time: millis(t) })
        expect(expectHit(out).hit.velocity).toBe(velocity)
      }),
    )
  })

  it('a per-pad override gates only that pad, leaving others at the default', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP, minVelocity: { snare: 60 } })

    expect(engine.handle({ type: 'noteOn', note: midi(38), velocity: 59, time: millis(0) })).toEqual([])
    expect(engine.handle({ type: 'noteOn', note: midi(38), velocity: 60, time: millis(100) })).toHaveLength(1)
    // kick has no override — its ghost still passes.
    expect(engine.handle({ type: 'noteOn', note: midi(36), velocity: 35, time: millis(200) })).toHaveLength(1)
  })
})

describe('KitMapEngine — per-pad debounce (spec: default 20ms, exact boundary)', () => {
  it('suppresses a duplicate inside the window and accepts one exactly at the 20ms boundary', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    expect(engine.handle({ type: 'noteOn', note: midi(38), velocity: 80, time: millis(0) })).toHaveLength(1)
    expect(engine.handle({ type: 'noteOn', note: midi(38), velocity: 80, time: millis(19.9) })).toEqual([])
    expect(engine.handle({ type: 'noteOn', note: midi(38), velocity: 80, time: millis(20) })).toHaveLength(1)
  })

  it('tracks each pad independently — simultaneous hits on different pads never suppress each other', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const kick = engine.handle({ type: 'noteOn', note: midi(36), velocity: 90, time: millis(0) })
    const snare = engine.handle({ type: 'noteOn', note: midi(38), velocity: 90, time: millis(0) })

    expect(kick).toHaveLength(1)
    expect(snare).toHaveLength(1)
  })

  it('property: delta < debounceMs suppresses, delta >= debounceMs accepts, across random windows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 200 }), (debounceMs, delta) => {
        const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP, debounceMs })
        expect(engine.handle({ type: 'noteOn', note: midi(38), velocity: 80, time: millis(0) })).toHaveLength(1)
        const second = engine.handle({ type: 'noteOn', note: midi(38), velocity: 80, time: millis(delta) })
        if (delta < debounceMs) expect(second).toEqual([])
        else expect(second).toHaveLength(1)
      }),
    )
  })
})

describe('KitMapEngine — choke (polyphonic aftertouch on a mapped pad)', () => {
  it('produces a hit carrying the choke articulation, with velocity taken from the aftertouch pressure', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const out = engine.handle({ type: 'polyAftertouch', note: midi(49), pressure: 64, time: millis(0) })

    expect(out).toEqual([{ kind: 'hit', hit: { pad: 'crash1', velocity: 64, time: 0, articulations: ['choke'] } }])
  })

  it('is dropped, not bucketed, on a note the kit map does not recognise', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    expect(engine.handle({ type: 'polyAftertouch', note: midi(100), pressure: 64, time: millis(0) })).toEqual([])
  })

  it('choke ordering: a hit and its later choke on the same pad both surface, in order', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const hitOut = engine.handle({ type: 'noteOn', note: midi(49), velocity: 100, time: millis(0) })
    const chokeOut = engine.handle({ type: 'polyAftertouch', note: midi(49), pressure: 80, time: millis(500) })

    expect(hitOut).toEqual([{ kind: 'hit', hit: { pad: 'crash1', velocity: 100, time: 0, articulations: [] } }])
    expect(chokeOut).toEqual([
      { kind: 'hit', hit: { pad: 'crash1', velocity: 80, time: 500, articulations: ['choke'] } },
    ])
  })

  it('is itself subject to the same pad debounce window as a normal hit', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    expect(
      engine.handle({ type: 'polyAftertouch', note: midi(49), pressure: 80, time: millis(0) }),
    ).toHaveLength(1)
    expect(
      engine.handle({ type: 'polyAftertouch', note: midi(49), pressure: 80, time: millis(10) }),
    ).toEqual([])
  })
})

describe('KitMapEngine — CC#4 hi-hat state machine (spec: LAST seen value at note-on time)', () => {
  it('defaults to a closed reading before any CC#4 message arrives', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })

    const out = engine.handle({ type: 'noteOn', note: midi(26), velocity: 90, time: millis(0) })

    expect(expectHit(out).hit.pad).toBe('hhClosed')
  })

  it('`initialCC4` overrides the default starting reading', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP, initialCC4: 0 })

    const out = engine.handle({ type: 'noteOn', note: midi(26), velocity: 90, time: millis(0) })

    const hit = expectHit(out).hit
    expect(hit.pad).toBe('hhOpen')
    expect(hit.articulations).toEqual(['open'])
  })

  it('property: CC#4 arriving BEFORE note-on determines the classification (order A)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 127 }), fc.integer({ min: 0, max: 100_000 }), (cc4Value, t) => {
        const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP })
        engine.handle({ type: 'controlChange', controller: 4, value: cc4Value, time: millis(0) })

        const out = engine.handle({ type: 'noteOn', note: midi(26), velocity: 90, time: millis(t) })

        const expected = classifyHiHat(cc4Value, DEFAULT_HI_HAT_CONFIG)
        expect(expectHit(out).hit.pad).toBe(expected === 'closed' ? 'hhClosed' : 'hhOpen')
      }),
    )
  })

  it('property: a CC#4 change AFTER note-on never retroactively changes the hit already emitted (order B)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 127 }), fc.integer({ min: 0, max: 127 }), (before, after) => {
        const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP, initialCC4: before })

        const out = engine.handle({ type: 'noteOn', note: midi(26), velocity: 90, time: millis(0) })
        engine.handle({ type: 'controlChange', controller: 4, value: after, time: millis(1) })

        const expected = classifyHiHat(before, DEFAULT_HI_HAT_CONFIG)
        expect(expectHit(out).hit.pad).toBe(expected === 'closed' ? 'hhClosed' : 'hhOpen')
      }),
    )
  })

  it('a control change on a controller other than 4 never affects hi-hat classification', () => {
    const engine = createKitMapEngine({ kitMap: TEST_KIT_MAP, initialCC4: 127 })

    engine.handle({ type: 'controlChange', controller: 1, value: 0, time: millis(0) }) // mod wheel
    const out = engine.handle({ type: 'noteOn', note: midi(26), velocity: 90, time: millis(1) })

    expect(expectHit(out).hit.pad).toBe('hhClosed')
  })
})
