/**
 * Technique library — REQ-3.7.1: five-finger patterns, scales (all majors,
 * harmonic/melodic minors), chords and inversions, and arpeggios, organised by
 * level (requirements.md §2), each with recommended fingerings shown in the
 * score.
 *
 * The library is plain data, generated once at module load, deterministically —
 * no `Rng`, no clock. `techniqueScore` is the only part that does real work: it
 * turns a drill into a playable `Score`, in ticks (drills themselves carry no
 * musical-time state, only `octaves`/`hands`/`targetBpm`).
 *
 * ## Fingering, and where this deliberately goes beyond `scaleFingering`
 *
 * `scaleFingering` (scales.ts) covers the major scale (major/ionian) and the
 * three minor forms — harmonic and melodic minor, required by REQ-3.7.1 and
 * used at level 5, now have real entries rather than a stand-in. The modes and
 * the non-heptatonic scales still have none, so every note in a drill built
 * from one would fail the "a note with no fingering is a REQ-3.7.1 failure"
 * bar. This module therefore keeps falling back to the **parallel major's**
 * pattern for any scale type `scaleFingering` does not cover: it is
 * deterministic and it guarantees every note gets a finger. No drill in the
 * library needs that fallback today (the level-5 minors are all keys whose
 * minor fingering is its parallel major's anyway), but it stays as the total
 * function the drill builder requires.
 *
 * Multi-octave fingering for scales and arpeggios is derived, not tabulated: a
 * one-octave pattern's first 7 entries repeat once per octave, and only the
 * very last note (the true top) takes the pattern's 8th "closing" finger. The
 * descent mirrors the ascent finger-for-finger — not an assumption, but the
 * convention already encoded in scales.ts: `MAJOR_FINGERINGS`'s C-major
 * `leftHand` table is exactly its `rightHand` table reversed.
 *
 * Melodic minor is the one case where ascent and descent are different
 * *pitches* (the classical form descends as natural minor), so its descent is
 * built from `scaleNotes(tonic, 'naturalMinor', octaves)` reversed rather than
 * from mirroring the ascending array — the general, any-octave-count form of
 * what `melodicMinorDescending` documents for one octave.
 *
 * Chords and arpeggios have no codified fingering anywhere in `theory/`, so
 * this module defines one small, documented, defensible convention for each
 * (see `RH_ARPEGGIO_PATTERN` and `RH_TRIAD_FINGERS`) rather than inventing one
 * ad hoc per drill.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import {
  buildChord,
  invertChord,
  INVERSIONS,
  type ChordQuality,
  type Inversion,
} from '@core/theory/chords.ts'
import { keySignatureForTonic } from '@core/theory/keys.ts'
import { spell, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import {
  buildScale,
  scaleFingering,
  scaleName,
  scaleNotes,
  type Fingering,
  type ScaleType,
} from '@core/theory/scales.ts'
import { makeScore, type Hand, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { QUARTER, WHOLE } from '@core/shared/units.ts'

export type TechniqueKind = 'five-finger' | 'scale' | 'arpeggio' | 'chord-inversions'

export type TechniqueDrill = {
  /** Stable and content-derived, e.g. 'scale-c-major-2oct-hands-together'. */
  readonly id: string
  readonly kind: TechniqueKind
  readonly title: string
  readonly level: number
  readonly tonic: SpelledPitch
  readonly scaleType?: ScaleType
  /** Only meaningful for 'scale'/'arpeggio' drills, which span this many octaves.
   * Absent for 'five-finger' (spans a fifth) and 'chord-inversions' (no octave span). */
  readonly octaves?: number
  readonly hands: 'left' | 'right' | 'both'
  readonly targetBpm: number
}

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

/** Two-handed drills put the left hand this many octaves below the right's tonic. */
const HAND_OCTAVE_OFFSET = -2

const TONIC_OCTAVE = 4

function tonicSlug(p: SpelledPitch): string {
  const acc = p.alter < 0 ? 'b'.repeat(-p.alter) : p.alter > 0 ? 's'.repeat(p.alter) : ''
  return `${p.letter.toLowerCase()}${acc}`
}

function tonicName(p: SpelledPitch): string {
  const acc = p.alter < 0 ? 'b'.repeat(-p.alter) : p.alter > 0 ? '#'.repeat(p.alter) : ''
  return `${p.letter}${acc}`
}

/** camelCase -> kebab-case, e.g. 'harmonicMinor' -> 'harmonic-minor'. */
function scaleTypeSlug(type: ScaleType): string {
  return type.replace(/([A-Z])/g, '-$1').toLowerCase()
}

function handsSlug(hands: 'left' | 'right' | 'both'): string {
  return hands === 'both' ? 'together' : hands
}

function handsLabel(hands: 'left' | 'right' | 'both'): string {
  return hands === 'both' ? 'hands together' : `${hands} hand`
}

/**
 * Five-finger, arpeggio and chord-inversion drills only ever distinguish major
 * from minor. `scaleType` doubles as that quality flag outside of its literal
 * scale meaning for those kinds: 'major' (or 'ionian') means a major
 * triad/arpeggio, any minor-flavoured scale type means a minor one.
 */
function qualityOf(type: ScaleType): 'major' | 'minor' {
  return type === 'major' || type === 'ionian' ? 'major' : 'minor'
}

/**
 * The key signature (in fifths) a drill's own tonic and mode imply — NOT the
 * per-hand transposed tonic from `handTonic`, since transposing a hand by an
 * octave does not change the key. A tonic needing more than 7 accidentals
 * would be a bug in this file's own drill data, not user input, hence the
 * invariant rather than a silent fallback to 0.
 */
function keyFifthsFor(tonic: SpelledPitch, mode: 'major' | 'minor'): number {
  const result = keySignatureForTonic(tonic, mode)
  invariant(
    result.ok,
    `keyFifthsFor: ${tonicName(tonic)} ${mode}: ${result.ok ? '' : result.error}`,
  )
  return result.value.fifths
}

function handsList(hands: 'left' | 'right' | 'both'): readonly Hand[] {
  return hands === 'both' ? ['right', 'left'] : [hands]
}

/** The tonic a given hand plays: unchanged for a single-hand drill, transposed
 * down for the left hand of a two-handed one (see `HAND_OCTAVE_OFFSET`). */
function handTonic(
  tonic: SpelledPitch,
  hand: Hand,
  hands: 'left' | 'right' | 'both',
): SpelledPitch {
  if (hands === 'both' && hand === 'left') {
    return spell(tonic.letter, tonic.alter, tonic.octave + HAND_OCTAVE_OFFSET)
  }
  return tonic
}

/**
 * `scaleFingering` covers major/ionian and the three minor forms. Every other
 * scale type falls back to the parallel major's pattern — see the module doc
 * comment.
 */
function fingeringFor(tonic: SpelledPitch, type: ScaleType): Fingering {
  const direct = scaleFingering(tonic, type)
  if (direct) return direct
  const fallback = scaleFingering(tonic, 'major')
  invariant(fallback !== null, `no fallback major fingering for ${tonicName(tonic)}`)
  return fallback
}

// ---------------------------------------------------------------------------
// runs: a flat sequence of pitches with one finger per pitch
// ---------------------------------------------------------------------------

type Run = { readonly notes: readonly SpelledPitch[]; readonly fingers: readonly number[] }

/**
 * Finger for position `i` of `total` in a continuous, possibly multi-octave
 * ascending run: the one-octave `pattern`'s degrees 1..7 (indices 0..6) repeat
 * once per octave, and only the very last note — the true top of the whole
 * run — takes the pattern's 8th, "closing" finger (index 7). A one-octave run
 * is the degenerate case of this and reproduces `pattern` exactly.
 */
function degreeFinger(pattern: readonly number[], i: number, total: number, hand: Hand): number {
  if (hand === 'left') {
    if (i === 0) return at(pattern, 0)
    if (i === total - 1) return at(pattern, 7)
    return at(pattern, ((i - 1) % 7) + 1)
  }
  if (i === total - 1) return at(pattern, 7)
  return at(pattern, i % 7)
}

function ascendingScaleRun(
  tonic: SpelledPitch,
  type: ScaleType,
  octaves: number,
  hand: Hand,
): Run {
  const notes = scaleNotes(tonic, type, octaves)
  const fingering = fingeringFor(tonic, type)
  const pattern = hand === 'right' ? fingering.rightHand : fingering.leftHand
  const fingers = notes.map((_, i) => degreeFinger(pattern, i, notes.length, hand))
  return { notes, fingers }
}

/**
 * Ascend `octaves` octaves, then return to the tonic. The descent mirrors the
 * ascending fingering finger-for-finger (see the module doc comment) — except
 * for melodic minor, whose classical descent is a *different* run of pitches
 * (natural minor), built the same way `melodicMinorDescending` documents for
 * one octave, generalised to any octave count.
 */
function scaleUpAndDown(tonic: SpelledPitch, type: ScaleType, octaves: number, hand: Hand): Run {
  const up = ascendingScaleRun(tonic, type, octaves, hand)
  // Pitches descend as natural minor (the classical convention — see
  // `melodicMinorDescending`'s doc comment); FINGERS mirror the ascent,
  // never natural minor's own. Roadmap 5.35 gave melodic minor ascending its
  // own right-hand fingering in C#/F# minor (scales.ts's
  // `MELODIC_MINOR_RIGHT_HANDS`), the first case where ascending and
  // descending fingerings genuinely differ — reusing natural minor's fingers
  // for the descent put a different pattern's closing finger right next to
  // the ascent's, and in those two keys the two disagreed at the turn (both
  // landed finger 2), a repeated finger across the top note. Mirroring the
  // ascent's own fingers instead keeps every run self-consistent by
  // construction, and is a no-op everywhere else: natural minor and
  // melodic-minor-ascending share one fingering table in the other ten keys.
  const downNotes =
    type === 'melodicMinor'
      ? [...ascendingScaleRun(tonic, 'naturalMinor', octaves, hand).notes].slice(0, -1).reverse()
      : [...up.notes].slice(0, -1).reverse()
  const downFingers = [...up.fingers].slice(0, -1).reverse()
  return { notes: [...up.notes, ...downNotes], fingers: [...up.fingers, ...downFingers] }
}

const RH_FIVE_FINGER = [1, 2, 3, 4, 5, 4, 3, 2, 1] as const
const LH_FIVE_FINGER = [5, 4, 3, 2, 1, 2, 3, 4, 5] as const

/** 1-2-3-4-5-4-3-2-1 under the hand, degrees 1..5 of the tonic's scale
 * (major, or natural minor when `type` is a minor-flavoured scale type). */
function fiveFingerRun(tonic: SpelledPitch, hand: Hand, type: ScaleType): Run {
  const scaleForDegrees = qualityOf(type) === 'major' ? 'major' : 'naturalMinor'
  const degrees = scaleNotes(tonic, scaleForDegrees, 1).slice(0, 5)
  const notes = [...degrees, ...[...degrees].slice(0, -1).reverse()]
  const fingers = hand === 'right' ? RH_FIVE_FINGER : LH_FIVE_FINGER
  return { notes, fingers: [...fingers] }
}

/**
 * Broken-triad fingering convention used here: the right hand cycles 1-2-3
 * (root, third, fifth) once per octave and closes on 5 at the true top; the
 * left hand mirrors it, cycling 5-3-2 and closing on 1. This is one documented
 * convention among several found in method books, not an authoritative
 * edition's fingering — chosen for being simple, hand-symmetric and total over
 * every arpeggio this library generates.
 */
const RH_ARPEGGIO_PATTERN = [1, 2, 3] as const
const RH_ARPEGGIO_TOP = 5
// The left hand opens on the thumb-adjacent 5 (not part of the repeating
// cycle) and closes on the thumb at the true top; the cycle itself is 3-2-1.
const LH_ARPEGGIO_PATTERN = [3, 2, 1] as const
const LH_ARPEGGIO_OPEN = 5
const LH_ARPEGGIO_TOP = 1

function arpeggioFinger(
  pattern: readonly number[],
  top: number,
  i: number,
  total: number,
  hand: Hand,
): number {
  if (hand === 'left') {
    if (i === 0) return LH_ARPEGGIO_OPEN
    if (i === total - 1) return top
    return at(pattern, (i - 1) % 3)
  }
  if (i === total - 1) return top
  return at(pattern, i % 3)
}

function arpeggioNotes(
  tonic: SpelledPitch,
  quality: ChordQuality,
  octaves: number,
): readonly SpelledPitch[] {
  const tones = buildChord(tonic, quality, 0).notes // root, third, fifth — root position
  const notes: SpelledPitch[] = []
  for (let oct = 0; oct < octaves; oct++) {
    for (const p of tones) notes.push(spell(p.letter, p.alter, p.octave + oct))
  }
  notes.push(spell(tonic.letter, tonic.alter, tonic.octave + octaves))
  return notes
}

function ascendingArpeggioRun(
  tonic: SpelledPitch,
  quality: ChordQuality,
  octaves: number,
  hand: Hand,
): Run {
  const notes = arpeggioNotes(tonic, quality, octaves)
  const pattern = hand === 'right' ? RH_ARPEGGIO_PATTERN : LH_ARPEGGIO_PATTERN
  const top = hand === 'right' ? RH_ARPEGGIO_TOP : LH_ARPEGGIO_TOP
  const fingers = notes.map((_, i) => arpeggioFinger(pattern, top, i, notes.length, hand))
  return { notes, fingers }
}

/** Ascend then return, mirroring the ascending fingering (see `scaleUpAndDown`). */
function arpeggioUpAndDown(
  tonic: SpelledPitch,
  quality: ChordQuality,
  octaves: number,
  hand: Hand,
): Run {
  const up = ascendingArpeggioRun(tonic, quality, octaves, hand)
  const downNotes = [...up.notes].slice(0, -1).reverse()
  const downFingers = [...up.fingers].slice(0, -1).reverse()
  return { notes: [...up.notes, ...downNotes], fingers: [...up.fingers, ...downFingers] }
}

/**
 * Root-position triad fingering, one convention (see the arpeggio comment for
 * the same caveat): root 1-3-5, first inversion 1-2-4, second inversion 1-2-5.
 * The left hand is tabulated explicitly rather than mirrored — mirroring
 * through `6 - f` only holds for the root-position pattern by coincidence and
 * gives an unplayable, thumbless first inversion for the left hand. The
 * standard left-hand fingerings close on the thumb at the top note: 5-3-1,
 * 5-3-1, 5-2-1.
 */
const RH_TRIAD_FINGERS: Readonly<Record<0 | 1 | 2, readonly number[]>> = {
  0: [1, 3, 5],
  1: [1, 2, 4],
  2: [1, 2, 5],
}
const LH_TRIAD_FINGERS: Readonly<Record<0 | 1 | 2, readonly number[]>> = {
  0: [5, 3, 1],
  1: [5, 3, 1],
  2: [5, 2, 1],
}

function isTriadInversion(i: Inversion): i is 0 | 1 | 2 {
  return i <= 2
}

const TRIAD_INVERSIONS: readonly (0 | 1 | 2)[] = INVERSIONS.filter(isTriadInversion)

// ---------------------------------------------------------------------------
// score rendering
// ---------------------------------------------------------------------------

function noteInputs(run: Run, hand: Hand, noteDuration: number): ScoreNoteInput[] {
  return run.notes.map((p, i) => ({
    midi: toMidi(p),
    startTick: i * noteDuration,
    durationTicks: noteDuration,
    hand,
    fingering: at(run.fingers, i),
  }))
}

function scoreFromRuns(
  id: string,
  title: string,
  runs: readonly { readonly run: Run; readonly hand: Hand }[],
  bpm: number,
  keyFifths: number,
): Score {
  const noteDuration = QUARTER
  let maxLen = 0
  for (const r of runs) maxLen = Math.max(maxLen, r.run.notes.length)
  const notes: ScoreNoteInput[] = []
  for (const { run, hand } of runs) notes.push(...noteInputs(run, hand, noteDuration))
  const measureCount = Math.max(1, Math.ceil((maxLen * noteDuration) / WHOLE))
  const measures = Array.from({ length: measureCount }, (_, i) => (i === 0 ? { keyFifths } : {}))
  return makeScore({ id, meta: { title }, measures, notes, tempos: [{ tick: 0, bpm }] })
}

function chordInversionScore(
  id: string,
  title: string,
  tonic: SpelledPitch,
  quality: 'major' | 'minor',
  hands: 'left' | 'right' | 'both',
  bpm: number,
  keyFifths: number,
): Score {
  const notes: ScoreNoteInput[] = []
  for (const hand of handsList(hands)) {
    const root = handTonic(tonic, hand, hands)
    const rootChord = buildChord(root, quality, 0)
    const fingerTable = hand === 'right' ? RH_TRIAD_FINGERS : LH_TRIAD_FINGERS
    for (const inv of TRIAD_INVERSIONS) {
      const chord = inv === 0 ? rootChord : invertChord(rootChord, inv)
      const fingers = fingerTable[inv]
      chord.notes.forEach((p, i) => {
        notes.push({
          midi: toMidi(p),
          startTick: inv * WHOLE,
          durationTicks: WHOLE,
          hand,
          fingering: at(fingers, i),
        })
      })
    }
  }
  const measures = Array.from({ length: TRIAD_INVERSIONS.length }, (_, i) =>
    i === 0 ? { keyFifths } : {},
  )
  return makeScore({ id, meta: { title }, measures, notes, tempos: [{ tick: 0, bpm }] })
}

/** The drill as a playable, engravable Score WITH fingerings on every note (REQ-3.7.1). */
export function techniqueScore(drill: TechniqueDrill, bpm: number): Score {
  const id = `${drill.id}-render`
  switch (drill.kind) {
    case 'five-finger': {
      const type = drill.scaleType ?? 'major'
      const runs = handsList(drill.hands).map((hand) => ({
        run: fiveFingerRun(handTonic(drill.tonic, hand, drill.hands), hand, type),
        hand,
      }))
      return scoreFromRuns(id, drill.title, runs, bpm, keyFifthsFor(drill.tonic, qualityOf(type)))
    }
    case 'scale': {
      invariant(drill.scaleType !== undefined, 'scale drill requires scaleType')
      invariant(drill.octaves !== undefined, 'scale drill requires octaves')
      const type = drill.scaleType
      const octaves = drill.octaves
      const runs = handsList(drill.hands).map((hand) => ({
        run: scaleUpAndDown(handTonic(drill.tonic, hand, drill.hands), type, octaves, hand),
        hand,
      }))
      return scoreFromRuns(id, drill.title, runs, bpm, keyFifthsFor(drill.tonic, qualityOf(type)))
    }
    case 'arpeggio': {
      invariant(drill.scaleType !== undefined, 'arpeggio drill requires scaleType')
      invariant(drill.octaves !== undefined, 'arpeggio drill requires octaves')
      const quality: ChordQuality = qualityOf(drill.scaleType)
      const octaves = drill.octaves
      const runs = handsList(drill.hands).map((hand) => ({
        run: arpeggioUpAndDown(
          handTonic(drill.tonic, hand, drill.hands),
          quality,
          octaves,
          hand,
        ),
        hand,
      }))
      return scoreFromRuns(
        id,
        drill.title,
        runs,
        bpm,
        keyFifthsFor(drill.tonic, qualityOf(drill.scaleType)),
      )
    }
    case 'chord-inversions': {
      invariant(drill.scaleType !== undefined, 'chord-inversions drill requires scaleType')
      const quality = qualityOf(drill.scaleType)
      return chordInversionScore(
        id,
        drill.title,
        drill.tonic,
        quality,
        drill.hands,
        bpm,
        keyFifthsFor(drill.tonic, quality),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// library data
// ---------------------------------------------------------------------------

const C = spell('C', 0, TONIC_OCTAVE)
const G = spell('G', 0, TONIC_OCTAVE)
const D = spell('D', 0, TONIC_OCTAVE)
const A = spell('A', 0, TONIC_OCTAVE)
const E = spell('E', 0, TONIC_OCTAVE)
const B = spell('B', 0, TONIC_OCTAVE)
const F = spell('F', 0, TONIC_OCTAVE)
const Db = spell('D', -1, TONIC_OCTAVE)
const Eb = spell('E', -1, TONIC_OCTAVE)
const Ab = spell('A', -1, TONIC_OCTAVE)
const Bb = spell('B', -1, TONIC_OCTAVE)
const Fs = spell('F', 1, TONIC_OCTAVE)

function scaleDrill(
  level: number,
  tonic: SpelledPitch,
  scaleType: ScaleType,
  octaves: number,
  hands: 'left' | 'right' | 'both',
  targetBpm: number,
): TechniqueDrill {
  const id = `scale-${tonicSlug(tonic)}-${scaleTypeSlug(scaleType)}-${octaves}oct-hands-${handsSlug(hands)}`
  const name = scaleName(buildScale(tonic, scaleType))
  const title = `${name} scale, ${octaves} octave${octaves === 1 ? '' : 's'}, ${handsLabel(hands)}`
  return { id, kind: 'scale', title, level, tonic, scaleType, octaves, hands, targetBpm }
}

function fiveFingerDrill(
  level: number,
  tonic: SpelledPitch,
  hands: 'left' | 'right' | 'both',
  targetBpm: number,
): TechniqueDrill {
  const id = `five-finger-${tonicSlug(tonic)}-major-hands-${handsSlug(hands)}`
  const title = `${tonicName(tonic)} major five-finger pattern, ${handsLabel(hands)}`
  // No `octaves`: a five-finger position spans a fifth, not an octave — see
  // the field's doc comment on `TechniqueDrill`.
  return {
    id,
    kind: 'five-finger',
    title,
    level,
    tonic,
    scaleType: 'major',
    hands,
    targetBpm,
  }
}

function arpeggioDrill(
  level: number,
  tonic: SpelledPitch,
  scaleType: ScaleType,
  octaves: number,
  hands: 'left' | 'right' | 'both',
  targetBpm: number,
): TechniqueDrill {
  const quality = qualityOf(scaleType)
  const id = `arpeggio-${tonicSlug(tonic)}-${quality}-${octaves}oct-hands-${handsSlug(hands)}`
  const title = `${tonicName(tonic)} ${quality} arpeggio, ${octaves} octave${octaves === 1 ? '' : 's'}, ${handsLabel(hands)}`
  return { id, kind: 'arpeggio', title, level, tonic, scaleType, octaves, hands, targetBpm }
}

function chordDrill(
  level: number,
  tonic: SpelledPitch,
  scaleType: ScaleType,
  hands: 'left' | 'right' | 'both',
  targetBpm: number,
): TechniqueDrill {
  const quality = qualityOf(scaleType)
  const id = `chord-inversions-${tonicSlug(tonic)}-${quality}-hands-${handsSlug(hands)}`
  const title = `${tonicName(tonic)} ${quality} triad and inversions, ${handsLabel(hands)}`
  // No `octaves` — a block-chord-and-inversions drill has no octave span either.
  return {
    id,
    kind: 'chord-inversions',
    title,
    level,
    tonic,
    scaleType,
    hands,
    targetBpm,
  }
}

/**
 * Every drill, every level, built once and filtered/looked-up from below.
 * Ordered by level, then by how it was authored — stable across calls because
 * nothing here is random.
 */
const ALL_DRILLS: readonly TechniqueDrill[] = [
  // Level 1 — five-finger positions, hands separately (requirements.md §2).
  ...([C, G, F] as const).flatMap((tonic) =>
    (['right', 'left'] as const).map((hand) => fiveFingerDrill(1, tonic, hand, 60)),
  ),

  // Level 2 — one-octave major scales, hands separately, C/G/F.
  ...([C, G, F] as const).flatMap((tonic) =>
    (['right', 'left'] as const).map((hand) => scaleDrill(2, tonic, 'major', 1, hand, 72)),
  ),

  // Level 3 — two-octave scales hands together (keys to 2 sharps/flats),
  // major/minor triads and inversions.
  ...([C, G, D, F, Bb] as const).map((tonic) => scaleDrill(3, tonic, 'major', 2, 'both', 84)),
  ...([C, G, F] as const).map((tonic) => chordDrill(3, tonic, 'major', 'right', 80)),
  ...([A, E, D] as const).map((tonic) => chordDrill(3, tonic, 'naturalMinor', 'right', 80)),

  // Level 4 — the remaining major keys (all twelve reachable across 2-4), and arpeggios.
  ...([Db, Eb, A, E, B, Fs, Ab] as const).map((tonic) =>
    scaleDrill(4, tonic, 'major', 2, 'both', 96),
  ),
  ...([C, G, D, F, Bb] as const).map((tonic) => arpeggioDrill(4, tonic, 'major', 2, 'right', 88)),

  // Level 5 — harmonic and melodic minor (both forms), faster tempi.
  ...([A, D, E, G, C, F] as const).flatMap((tonic) => [
    scaleDrill(5, tonic, 'harmonicMinor', 2, 'both', 100),
    scaleDrill(5, tonic, 'melodicMinor', 2, 'both', 100),
  ]),
  ...([A, D, E] as const).map((tonic) =>
    arpeggioDrill(5, tonic, 'harmonicMinor', 2, 'both', 96),
  ),
  ...([Db, Ab] as const).map((tonic) => chordDrill(5, tonic, 'major', 'both', 90)),
  ...([G, C] as const).map((tonic) => chordDrill(5, tonic, 'naturalMinor', 'both', 90)),
]

const BY_ID: ReadonlyMap<string, TechniqueDrill> = new Map(ALL_DRILLS.map((d) => [d.id, d]))

/** Every drill for a level, deterministic and ordered. Levels 1..5 (requirements.md §2). */
export function techniqueLibrary(level: number): readonly TechniqueDrill[] {
  return ALL_DRILLS.filter((d) => d.level === level)
}

/**
 * Resolves a planned session item's `params.drillId` (built in
 * `src/app/session/candidates.ts`) to the drill it names. `Shell.tsx` calls
 * this when opening a technique item, and passes BOTH the id and the drill's
 * own `level` to `TechniqueScreen` — the level matters because
 * `useTechniqueDrill` builds its picker from `techniqueLibrary(level)` and
 * silently falls back to that level's first drill for an id absent from it,
 * which is precisely how this wiring was inert until roadmap 2.34.
 */
export function techniqueDrillById(id: string): TechniqueDrill | undefined {
  return BY_ID.get(id)
}
