import { describe, expect, it } from 'vitest'
import { spelledPitchClass } from '@core/theory/pitch.ts'
import { validateScore } from '@core/notation/score.ts'
import {
  techniqueDrillById,
  techniqueLibrary,
  techniqueScore,
  type TechniqueDrill,
} from './library.ts'

const LEVELS = [1, 2, 3, 4, 5] as const

function allDrills(): readonly TechniqueDrill[] {
  return LEVELS.flatMap((level) => techniqueLibrary(level))
}

describe('techniqueLibrary', () => {
  it('returns a non-empty, level-correct list for every level 1..5', () => {
    for (const level of LEVELS) {
      const drills = techniqueLibrary(level)
      expect(drills.length).toBeGreaterThan(0)
      for (const d of drills) expect(d.level).toBe(level)
    }
  })

  it('is deterministic across calls', () => {
    for (const level of LEVELS) {
      expect(techniqueLibrary(level).map((d) => d.id)).toEqual(
        techniqueLibrary(level).map((d) => d.id),
      )
    }
  })

  it('has unique, stable ids across the whole library', () => {
    const ids = allDrills().map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('makes all twelve major keys reachable across the levels', () => {
    const majorPitchClasses = new Set(
      allDrills()
        .filter((d) => d.kind === 'scale' && d.scaleType === 'major')
        .map((d) => spelledPitchClass(d.tonic)),
    )
    expect(majorPitchClasses.size).toBe(12)
  })

  it('makes both minor scale forms reachable', () => {
    const types = new Set(allDrills().map((d) => d.scaleType))
    expect(types.has('harmonicMinor')).toBe(true)
    expect(types.has('melodicMinor')).toBe(true)
  })
})

describe('techniqueDrillById', () => {
  it('finds every drill in the library by its own id', () => {
    for (const d of allDrills()) {
      expect(techniqueDrillById(d.id)).toEqual(d)
    }
  })

  it('is undefined for an unknown id', () => {
    expect(techniqueDrillById('not-a-real-drill')).toBeUndefined()
  })
})

describe('fingering correctness', () => {
  it('pins the exact finger sequence for a 2-octave C major scale, RH and LH', () => {
    const rh = techniqueDrillById('scale-c-major-2oct-hands-together')
    expect(rh).toBeDefined()
    if (rh === undefined) return
    const score = techniqueScore(rh, rh.targetBpm)
    const rightFingers = score.notes
      .filter((n) => n.hand === 'right')
      .sort((a, b) => a.startTick - b.startTick)
      .map((n) => n.fingering)
    const leftFingers = score.notes
      .filter((n) => n.hand === 'left')
      .sort((a, b) => a.startTick - b.startTick)
      .map((n) => n.fingering)
    // Up-and-down: 15 notes up, 14 back down (mirrored), same for both hands.
    expect(rightFingers).toEqual([
      1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1,
    ])
    expect(leftFingers).toEqual([
      5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5,
    ])
  })

  it('every fingering in the library is a playable finger 1..5', () => {
    for (const d of allDrills()) {
      const score = techniqueScore(d, d.targetBpm)
      for (const n of score.notes) {
        expect(n.fingering).toBeGreaterThanOrEqual(1)
        expect(n.fingering).toBeLessThanOrEqual(5)
      }
    }
  })

  it('pins the exact LH finger sequence for a 2-octave harmonic minor arpeggio (the interior-5 defect)', () => {
    const drill = techniqueDrillById('arpeggio-a-minor-2oct-hands-together')
    expect(drill).toBeDefined()
    if (drill === undefined) return
    const score = techniqueScore(drill, drill.targetBpm)
    const leftFingers = score.notes
      .filter((n) => n.hand === 'left')
      .sort((a, b) => a.startTick - b.startTick)
      .map((n) => n.fingering)
    // 2-octave arpeggio: 7 notes up, 6 back down (mirrored).
    expect(leftFingers).toEqual([5, 3, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 5])
  })
})

describe('techniqueScore', () => {
  for (const drill of allDrills()) {
    it(`${drill.id}: parses, has fingerings on every note`, () => {
      const score = techniqueScore(drill, drill.targetBpm)
      const result = validateScore(score)
      expect(result.ok).toBe(true)
      expect(score.notes.length).toBeGreaterThan(0)
      for (const n of score.notes) {
        expect(n.fingering).toBeDefined()
        expect(Number.isInteger(n.fingering)).toBe(true)
      }
    })
  }

  // For a two-handed drill each hand independently spans `octaves` octaves;
  // the two hands sit in different registers, so only one hand's notes are
  // checked here rather than the combined (wider) range of both.
  function oneHandSpan(score: ReturnType<typeof techniqueScore>, hands: TechniqueDrill['hands']) {
    const hand = hands === 'left' ? 'left' : 'right'
    const midis = score.notes.filter((n) => n.hand === hand).map((n) => n.midi)
    return Math.max(...midis) - Math.min(...midis)
  }

  it('spans exactly `octaves` octaves for scale drills', () => {
    for (const drill of allDrills().filter((d) => d.kind === 'scale')) {
      const score = techniqueScore(drill, drill.targetBpm)
      expect(drill.octaves).toBeDefined()
      expect(oneHandSpan(score, drill.hands)).toBe((drill.octaves ?? 0) * 12)
    }
  })

  it('spans exactly `octaves` octaves for arpeggio drills', () => {
    for (const drill of allDrills().filter((d) => d.kind === 'arpeggio')) {
      const score = techniqueScore(drill, drill.targetBpm)
      expect(drill.octaves).toBeDefined()
      expect(oneHandSpan(score, drill.hands)).toBe((drill.octaves ?? 0) * 12)
    }
  })

  it('spans a perfect fifth (7 semitones) for five-finger drills', () => {
    for (const drill of allDrills().filter((d) => d.kind === 'five-finger')) {
      const score = techniqueScore(drill, drill.targetBpm)
      const midis = score.notes.map((n) => n.midi)
      const span = Math.max(...midis) - Math.min(...midis)
      expect(span).toBe(7)
    }
  })

  it('plays all three inversions of the triad for chord-inversions drills', () => {
    for (const drill of allDrills().filter((d) => d.kind === 'chord-inversions')) {
      const score = techniqueScore(drill, drill.targetBpm)
      const ticksUsed = new Set(score.notes.map((n) => n.startTick))
      expect(ticksUsed.size).toBe(3) // root, first inversion, second inversion
      for (const tick of ticksUsed) {
        const chordNotes = score.notes.filter((n) => n.startTick === tick)
        // one chord per hand: 3 notes for a single hand, 6 for hands together
        expect(chordNotes.length % 3).toBe(0)
      }
    }
  })

  it('renders a hands-together scale as two synchronized, distinct-register streams', () => {
    const drill = techniqueLibrary(3).find((d) => d.kind === 'scale' && d.hands === 'both')
    expect(drill).toBeDefined()
    if (drill === undefined) return
    const score = techniqueScore(drill, drill.targetBpm)
    const rightNotes = score.notes.filter((n) => n.hand === 'right')
    const leftNotes = score.notes.filter((n) => n.hand === 'left')
    expect(rightNotes.length).toBe(leftNotes.length)
    // The left hand is transposed down (HAND_OCTAVE_OFFSET); its top note can
    // coincide with the right hand's bottom note (both land on the tonic
    // pitch class) but never rise above it.
    expect(Math.max(...leftNotes.map((n) => n.midi))).toBeLessThanOrEqual(
      Math.min(...rightNotes.map((n) => n.midi)),
    )
  })
})
