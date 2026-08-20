import { describe, expect, it } from 'vitest'
import { spell, spelledPitchClass } from '@core/theory/pitch.ts'
import { keySignatureForTonic, type Mode } from '@core/theory/keys.ts'
import { unwrap } from '@core/shared/result.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { validateScore, type ScoreNote } from '@core/notation/score.ts'
import {
  techniqueDrillById,
  techniqueLibrary,
  techniqueScore,
  type TechniqueDrill,
} from './library.ts'

/**
 * Independent re-derivation of "which mode does this drill's scaleType imply"
 * — a general rule about scale-type naming (major/ionian vs everything else
 * being minor-flavoured), not a restatement of `techniqueScore`'s key-fifths
 * logic. Used only to compute the expected fifths for the assertions below.
 */
function expectedMode(drill: TechniqueDrill): Mode {
  const type = drill.scaleType ?? 'major'
  return type === 'major' || type === 'ionian' ? 'major' : 'minor'
}

function expectedKeyFifths(drill: TechniqueDrill): number {
  return unwrap(keySignatureForTonic(drill.tonic, expectedMode(drill))).fifths
}

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

describe('fingering never repeats, jumps thumb-to-fifth, or lands a thumb on a black key', () => {
  // Roadmap 5.35 gave melodic minor its own ascending right-hand fingering in
  // C#/F# minor — the first case where a scale's ascending and descending
  // fingerings genuinely differ. `scaleUpAndDown` used to build the descent
  // from a SEPARATE natural-minor run, so in exactly these two keys the
  // descent's own fingering pattern disagreed with the ascent's at the top
  // note, landing finger 2 twice in a row across the turn. Neither key is in
  // the library today (`ALL_DRILLS`'s melodic minors are A/D/E/G/C/F, all of
  // which share one fingering with natural minor, so the bug was latent), so
  // this drives synthetic drills directly rather than relying on
  // `allDrills()` to reach them.
  const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

  /** Every note here comes from `techniqueScore`, which sets a fingering on
   * every note it emits (pinned by the 'every fingering ... 1..5' test above)
   * — undefined here would mean that guarantee broke, not a legitimate gap. */
  function orderedFingers(notes: readonly ScoreNote[]): readonly number[] {
    return notes.map((n) => {
      invariant(n.fingering !== undefined, 'techniqueScore note missing a fingering')
      return n.fingering
    })
  }

  function assertPlayable(notes: readonly ScoreNote[], label: string) {
    const fingers = orderedFingers(notes)
    for (let i = 1; i < fingers.length; i++) {
      const previous = at(fingers, i - 1)
      const finger = at(fingers, i)
      expect(finger, `${label}: repeated finger at ${i}`).not.toBe(previous)
      const pair = new Set([previous, finger])
      expect(pair.has(1) && pair.has(5), `${label}: thumb/fifth jump at ${i}`).toBe(false)
    }
    fingers.forEach((finger, i) => {
      if (finger === 1) {
        expect(
          BLACK_PITCH_CLASSES.has(at(notes, i).midi % 12),
          `${label}: thumb on a black key at ${i}`,
        ).toBe(false)
      }
    })
  }

  it('C# and F# melodic minor, both hands, 1-3 octaves', () => {
    for (const tonic of [spell('C', 1, 4), spell('F', 1, 4)]) {
      for (const octaves of [1, 2, 3]) {
        for (const hands of ['left', 'right'] as const) {
          const drill: TechniqueDrill = {
            id: 'synthetic-melodic-minor-turnaround',
            kind: 'scale',
            title: 'synthetic',
            level: 5,
            tonic,
            scaleType: 'melodicMinor',
            octaves,
            hands,
            targetBpm: 60,
          }
          const score = techniqueScore(drill, drill.targetBpm)
          const ordered = [...score.notes].sort((a, b) => a.startTick - b.startTick)
          assertPlayable(
            ordered,
            `${tonic.letter}${'#'.repeat(tonic.alter)} melodic minor, ${octaves} oct, ${hands}`,
          )
        }
      }
    }
  })

  it('holds across every shipped scale drill, both hands', () => {
    // Scoped to 'scale' drills: chord-inversions and arpeggios legitimately
    // reposition the hand (thumb-to-pinky included) between chord tones,
    // which is a different convention this property does not apply to — see
    // `chordInversionScore`'s and `arpeggioUpAndDown`'s own fingering tables.
    // `scaleUpAndDown` is the only run-builder this task touched.
    for (const d of allDrills().filter((d) => d.kind === 'scale')) {
      const score = techniqueScore(d, d.targetBpm)
      for (const hand of ['left', 'right'] as const) {
        const ordered = score.notes
          .filter((n) => n.hand === hand)
          .sort((a, b) => a.startTick - b.startTick)
        if (ordered.length === 0) continue
        assertPlayable(ordered, `${d.id} ${hand}`)
      }
    }
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

  // roadmap 5.13: a generated score with no title engraves as "Untitled Score".
  it('carries the drill title as the score title, for every drill kind', () => {
    for (const drill of allDrills()) {
      const score = techniqueScore(drill, drill.targetBpm)
      expect(score.meta.title).toBe(drill.title)
    }
  })

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

describe('the Preparatory A triad sequence (improve-app 2026-08-20-1)', () => {
  /**
   * RCM Piano Syllabus 2022, Preparatory A: the eight root-position diatonic
   * triads, one per scale degree, ascending one octave — read off the engraved
   * page and written here as MIDI numbers so a drill that ships under the right
   * title playing anything else (a scale, an arpeggio, inversions) fails.
   */
  const C_MAJOR_TRIAD_SEQUENCE = [
    60, 64, 67, 62, 65, 69, 64, 67, 71, 65, 69, 72, 67, 71, 74, 69, 72, 76, 71, 74, 77, 72, 76, 79,
  ]

  function sequenceDrills(): readonly TechniqueDrill[] {
    return techniqueLibrary(1).filter((d) => d.kind === 'triad-sequence')
  }

  it('offers both forms, both hands, at level 1 and at the syllabus tempi', () => {
    const drills = sequenceDrills()
    expect(drills.map((d) => d.id).sort()).toEqual([
      'triad-sequence-c-major-broken-hands-left',
      'triad-sequence-c-major-broken-hands-right',
      'triad-sequence-c-major-solid-hands-left',
      'triad-sequence-c-major-solid-hands-right',
    ])
    for (const drill of drills) {
      expect(drill.targetBpm).toBe(drill.form === 'broken' ? 60 : 72)
      expect(drill.hands).not.toBe('both')
    }
  })

  it('plays the syllabus sequence note for note, right hand, broken', () => {
    const drill = techniqueDrillById('triad-sequence-c-major-broken-hands-right')
    invariant(drill !== undefined, 'the broken RH triad sequence must be in the library')
    const score = techniqueScore(drill, drill.targetBpm)
    const ordered = [...score.notes].sort((a, b) => a.startTick - b.startTick)
    expect(ordered.map((n) => n.midi)).toEqual(C_MAJOR_TRIAD_SEQUENCE)
    // Broken, not blocked: 24 separate onsets, an eighth note apart.
    expect(new Set(ordered.map((n) => n.startTick)).size).toBe(C_MAJOR_TRIAD_SEQUENCE.length)
  })

  it('blocks the same eight triads for the solid form, one per two beats', () => {
    const drill = techniqueDrillById('triad-sequence-c-major-solid-hands-right')
    invariant(drill !== undefined, 'the solid RH triad sequence must be in the library')
    const score = techniqueScore(drill, drill.targetBpm)
    const ticks = [...new Set(score.notes.map((n) => n.startTick))].sort((a, b) => a - b)
    expect(ticks.length).toBe(8)
    // A quarter-note chord then a quarter rest — the gap IS the rest, and a
    // build that packed the blocks back to back would fail here.
    expect(ticks).toEqual([0, 960, 1920, 2880, 3840, 4800, 5760, 6720])
    for (const tick of ticks) {
      expect(score.notes.filter((n) => n.startTick === tick).length).toBe(3)
    }
    expect(
      [...score.notes]
        .sort((a, b) => a.startTick - b.startTick || a.midi - b.midi)
        .map((n) => n.midi),
    ).toEqual(C_MAJOR_TRIAD_SEQUENCE)
  })

  it('puts the left hand an octave below the right, inside the bass staff', () => {
    for (const form of ['broken', 'solid'] as const) {
      const right = techniqueDrillById(`triad-sequence-c-major-${form}-hands-right`)
      const left = techniqueDrillById(`triad-sequence-c-major-${form}-hands-left`)
      invariant(right !== undefined && left !== undefined, `both ${form} hands must exist`)
      const rightMidis = techniqueScore(right, right.targetBpm).notes.map((n) => n.midi)
      const leftMidis = techniqueScore(left, left.targetBpm).notes.map((n) => n.midi)
      expect(leftMidis.map((m) => m + 12)).toEqual(rightMidis)
      // The whole point of the offset: an ascending octave of triads from
      // middle C would put a left hand on G5. It tops out at G4 instead.
      expect(Math.max(...leftMidis)).toBe(67)
    }
  })
})

describe('techniqueScore key signatures', () => {
  it('sets measure 0 keyFifths to the fifths implied by the drill tonic/mode, for every drill', () => {
    for (const drill of allDrills()) {
      const score = techniqueScore(drill, drill.targetBpm)
      expect(score.measures[0]?.keyFifths).toBe(expectedKeyFifths(drill))
    }
  })

  // Hand-written expected numbers, so this cannot pass by sharing a bug with
  // the implementation. All four are 2-octave major scales, hands together,
  // from level 3 — real ids in the library (see scaleDrill's id format).
  it.each([
    ['scale-c-major-2oct-hands-together', 0], // C major
    ['scale-g-major-2oct-hands-together', 1], // G major
    ['scale-f-major-2oct-hands-together', -1], // F major
    ['scale-bb-major-2oct-hands-together', -2], // Bb major
  ])('%s has key signature %i fifths', (id, fifths) => {
    const drill = techniqueDrillById(id)
    expect(drill).toBeDefined()
    if (drill === undefined) return
    const score = techniqueScore(drill, drill.targetBpm)
    expect(score.measures[0]?.keyFifths).toBe(fifths)
  })

  it('sets the key signature on measure 0 only, and later measures inherit it', () => {
    const multiMeasureDrills = allDrills().filter((d) => {
      const score = techniqueScore(d, d.targetBpm)
      return score.measures.length > 1
    })
    expect(multiMeasureDrills.length).toBeGreaterThan(0)
    for (const drill of multiMeasureDrills) {
      const score = techniqueScore(drill, drill.targetBpm)
      const expected = expectedKeyFifths(drill)
      for (const m of score.measures) expect(m.keyFifths).toBe(expected)
    }
  })
})
