/**
 * Chord-quality and scale/mode recognition by ear (REQ-3.6.x).
 *
 * Two drills share this file because they share a shape: pick a quality/type
 * for the learner's current level, pick a spellable root/tonic inside a
 * playable range, build the real theory object (`Chord` / `Scale`), render it
 * as a one-bar `Score` and hand back an `EarItem` whose `answerKey` is the
 * bare quality/type string — never the root. Two items built on different
 * roots but the same quality get different `id`s (the id is derived from the
 * actual sounding pitches) but the identical `answerKey`. Note that this is
 * *not* what the SRS layer keys cards by: `session.ts` schedules cards by
 * item `id`, so each voicing is scheduled separately, not as one skill.
 *
 * Ids here are opaque handles, not a serialisation format: there is no
 * `chordQualityItemFromId`/`scaleModeItemFromId` to parse one back into an
 * `EarItem`. A caller that needs a due card's full prompt back (the SRS
 * due-card path) must persist the generated item, not regenerate it from id.
 *
 * **Inversions grade as their quality, never as their root.** A first-inversion
 * minor triad (E4 G4 C5, say) still answers `'minor'`. This is the whole point
 * of the drill: a learner who correctly hears "that's a minor triad" while it
 * happens to be voiced in first inversion is not wrong, and telling them they
 * are would be teaching something false. `gradeChordQualityAnswer` therefore
 * never looks at the prompt at all — it only ever compares against
 * `item.answerKey`, which is the quality the generator chose before it ever
 * picked an inversion.
 *
 * **Scales are rendered ascending only.** A scale prompt is one bar of eighth
 * notes: the scale from tonic to tonic, one octave, exactly as
 * `scaleNotes(tonic, type, 1)` already returns it. `melodicMinor` classically
 * *descends* as a natural minor — a different set of pitches — but rendering
 * that second, different-shaped phrase would double the size of this module
 * for a feature (dictating a descent) nothing here asks for. The simplest
 * correct choice, and the one this file makes, is ascending only; a future
 * drill that wants the descending form can reach for
 * `melodicMinorDescending` in `@core/theory/scales.ts` without changing
 * anything here.
 */
import { pick, randomInt, type Rng } from '@core/ports/rng.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { EIGHTH, midi, type Midi, WHOLE } from '@core/shared/units.ts'
import {
  buildChord,
  CHORD_QUALITIES,
  type ChordQuality,
  chordMidi,
  type Inversion,
  INVERSIONS,
  isTriad,
} from '@core/theory/chords.ts'
import { fromMidi, type SpelledPitch, toMidi } from '@core/theory/pitch.ts'
import { SCALE_INTERVALS, type ScaleType, scaleNotes } from '@core/theory/scales.ts'
import { keyFromFifths, type Key, type Mode } from '@core/theory/keys.ts'
import { type Hand, makeScore, type ScoreNoteInput } from '@core/notation/score.ts'
import type { EarGrade, EarItem } from './item.ts'

const MIDDLE_C = 60
/** Highest MIDI note this module will ever place a sounding pitch on. */
const MIDI_MAX = 127

// ---------------------------------------------------------------------------
// level ladders
// ---------------------------------------------------------------------------

/**
 * Cumulative tiers: level N draws from every quality/type introduced at or
 * before tier N. This is what makes both `*ForLevel` functions monotonic —
 * each level's set is a superset of the one before it — without needing a
 * second table to prove it.
 */
const CHORD_LEVEL_TIERS: readonly (readonly ChordQuality[])[] = [
  ['major', 'minor'],
  ['diminished', 'augmented', 'sus2', 'sus4'], // level 2: every triad
  ['dominant7', 'major7', 'minor7'], // level 3: sevenths begin
  ['halfDiminished7', 'diminished7'],
  ['minorMajor7', 'augmentedMajor7'], // level 5: every quality
]

/** Every type here must be heptatonic: the drill renders exactly 8 eighths into one bar. */
const SCALE_LEVEL_TIERS: readonly (readonly ScaleType[])[] = [
  ['major', 'naturalMinor'],
  ['dorian', 'mixolydian'], // the modes closest to major/minor
  ['phrygian', 'lydian'],
  ['locrian'],
  ['harmonicMinor', 'melodicMinor'],
]

/** A level below 1 clamps to 1; a non-finite level is a programmer error. */
function clampLevel(level: number): number {
  invariant(Number.isFinite(level), `level must be a finite number, got ${level}`)
  return Math.max(1, Math.trunc(level))
}

/** Level below 1 clamps to 1; a level past the ladder gets the full set. */
function cumulativeForLevel<T>(tiers: readonly (readonly T[])[], level: number): readonly T[] {
  const count = Math.min(clampLevel(level), tiers.length)
  return tiers.slice(0, count).flat()
}

/** Chord qualities a level draws from: triads first, sevenths later, monotonic in level. */
export function chordQualitiesForLevel(level: number): readonly ChordQuality[] {
  return cumulativeForLevel(CHORD_LEVEL_TIERS, level)
}

/** Scale types a level draws from: major/natural-minor first, then the modes. */
export function scaleTypesForLevel(level: number): readonly ScaleType[] {
  return cumulativeForLevel(SCALE_LEVEL_TIERS, level)
}

// ---------------------------------------------------------------------------
// max sounding span — how far above a root/tonic a quality/type can reach
// ---------------------------------------------------------------------------

/**
 * Highest semitone offset above the root any inversion of `quality` can sound
 * at. `range` (below) bounds only the root, so a candidate root is only safe
 * once this span is added: a root near the top of the keyboard can still push
 * an inverted seventh's top note past MIDI 127 (`toMidi` throws on that).
 * Computed once per quality at module load from a fixed C4 root — the offset
 * is transposition-invariant, so which root we compute it from does not matter.
 */
const CHORD_MAX_SPAN: Readonly<Record<ChordQuality, number>> = Object.freeze(
  Object.fromEntries(
    CHORD_QUALITIES.map((quality) => {
      const maxInversion = isTriad(quality) ? 2 : 3
      let span = 0
      for (let inv = 0; inv <= maxInversion; inv++) {
        const notes = chordMidi(buildChord(fromMidi(midi(MIDDLE_C)), quality, inv as Inversion))
        for (const n of notes) span = Math.max(span, n - MIDDLE_C)
      }
      return [quality, span]
    }),
  ),
) as Readonly<Record<ChordQuality, number>>

/** Every scale drawn here is rendered one octave, tonic to tonic (see below). */
const SCALE_MAX_SPAN = 12

type MidiRange = { readonly low: Midi; readonly high: Midi }

/** Every Midi in `range` whose highest possible sounding note (root + `maxSpan`) still fits in MIDI 0-127. */
function candidateRoots(range: MidiRange, maxSpan: number): readonly Midi[] {
  const out: Midi[] = []
  for (let m = range.low; m <= range.high; m++) {
    if (m + maxSpan <= MIDI_MAX) out.push(midi(m))
  }
  return out
}

// ---------------------------------------------------------------------------
// tonal context (roadmap 5.55) — shared by both drills in this file
// ---------------------------------------------------------------------------

/** Same bound `intervals.ts`'s own `pickContextKey` uses — see that
 *  function's doc, and `levelDefaults.ts`'s comment on the same bound
 *  applied to the sight-reading generator. */
const CONTEXT_MIN_FIFTHS = -4
const CONTEXT_MAX_FIFTHS = 4

/**
 * roadmap 5.55: the tonal-context triad establishes a real KEY, independent
 * of the quality/type this item actually draws. Both drills here already
 * anchor `contextTonicMidi` on the item's own root/tonic (see that field's
 * own doc in item.ts) — safe for the ROOT, since the root does not reveal
 * quality, but 5.28's fifth-only drone never had a third to worry about. Now
 * that the drone is a full triad, its MODE has to come from somewhere, and
 * tying it to the item's own quality would hand the answer over directly:
 * level 1's chord-quality set is exactly {major, minor} and level 1's
 * scale-mode set is exactly {major, naturalMinor} — a context chord matching
 * the drawn quality would let a learner answer from the drone alone, never
 * hearing the actual item. Drawing an independent key here — nothing else in
 * either drill ever reads it back — keeps the mode uninformative about the
 * answer, exactly like `intervals.ts`'s identical fix.
 */
function pickContextKey(rng: Rng): Key {
  const fifths = randomInt(rng, CONTEXT_MIN_FIFTHS, CONTEXT_MAX_FIFTHS)
  const mode: Mode = randomInt(rng, 0, 1) === 0 ? 'major' : 'minor'
  return keyFromFifths(fifths, mode)
}

// ---------------------------------------------------------------------------
// chord-quality drill
// ---------------------------------------------------------------------------

export type ChordItemOptions = {
  /** All notes together (default) or arpeggiated up. */
  readonly arpeggiated?: boolean
  /** Inversions enter above level 3; pass false to force root position. */
  readonly allowInversions?: boolean
  readonly range?: MidiRange
}

/** C3–C5: a comfortable two-octave window for a root that a triad or seventh sits inside.
 * Bounds only the root — `pickChordRoot` also drops any root whose highest
 * possible inversion would sound past MIDI 127. */
const DEFAULT_CHORD_RANGE: MidiRange = { low: midi(48), high: midi(72) }

function pickChordRoot(quality: ChordQuality, range: MidiRange, rng: Rng): SpelledPitch {
  const candidates = candidateRoots(range, CHORD_MAX_SPAN[quality])
  invariant(candidates.length > 0, `no root in the given range can sound a ${quality} chord within MIDI 0-127`)
  return fromMidi(pick(rng, candidates))
}

/**
 * Root position below level 4 unless the caller overrides; `false` always
 * forces root position. sus2 and sus4 are always root position regardless:
 * they are rotations of the same pitch-class set (sus2 = 0,2,7; sus4 = 0,5,7
 * — sus2's second inversion is sus4's root position transposed), so inverting
 * either would make the two indistinguishable by ear and grade one of them
 * "wrong" for a voicing that is honestly ambiguous.
 */
function pickInversion(level: number, quality: ChordQuality, opts: ChordItemOptions, rng: Rng): Inversion {
  if (quality === 'sus2' || quality === 'sus4') return 0
  const allowed = opts.allowInversions === false ? false : opts.allowInversions === true || level > 3
  if (!allowed) return 0
  const maxInversion = isTriad(quality) ? 2 : 3
  return at(INVERSIONS, randomInt(rng, 0, maxInversion))
}

/** Every tone at tick 0, held for the whole bar. */
function blockChordNotes(notes: readonly Midi[], hand: Hand): readonly ScoreNoteInput[] {
  return notes.map((noteMidi) => ({ midi: noteMidi, startTick: 0, durationTicks: WHOLE, hand }))
}

/** Ascending eighths, then the top note sustained to the end of the bar. */
function arpeggiatedChordNotes(notes: readonly Midi[], hand: Hand): readonly ScoreNoteInput[] {
  const out: ScoreNoteInput[] = []
  for (let i = 0; i < notes.length - 1; i++) {
    out.push({ midi: at(notes, i), startTick: i * EIGHTH, durationTicks: EIGHTH, hand })
  }
  const topStart = (notes.length - 1) * EIGHTH
  out.push({ midi: at(notes, notes.length - 1), startTick: topStart, durationTicks: WHOLE - topStart, hand })
  return out
}

export function generateChordQualityItem(level: number, opts: ChordItemOptions, rng: Rng): EarItem {
  const clampedLevel = clampLevel(level)
  const quality = pick(rng, chordQualitiesForLevel(level))
  const range = opts.range ?? DEFAULT_CHORD_RANGE
  const root = pickChordRoot(quality, range, rng)
  const inversion = pickInversion(level, quality, opts, rng)
  const notes = chordMidi(buildChord(root, quality, inversion))
  const arpeggiated = opts.arpeggiated ?? false
  const hand: Hand = at(notes, 0) >= MIDDLE_C ? 'right' : 'left'

  const id = `chord-quality:${quality}:${arpeggiated ? 'arp' : 'block'}:${notes.join('-')}`
  const prompt = makeScore({
    id,
    measures: [{}],
    notes: arpeggiated ? arpeggiatedChordNotes(notes, hand) : blockChordNotes(notes, hand),
  })
  // The chord's own root — not affected by which inversion actually sounds
  // (roadmap 5.28): `contextTonicMidi` stays the ROOT as a reference (see
  // item.ts's own doc on why RevealPanel's use of it is untouched), exactly
  // like the answer itself is graded by quality, never by voicing (see this
  // module's own doc on inversions grading as their quality). `contextKey`
  // (roadmap 5.55) is the independent key the PRE-answer triad actually
  // plays from — see `pickContextKey`'s own doc above for why it must not be
  // the chord's own quality.
  return {
    id,
    kind: 'chord-quality',
    prompt,
    answerKey: quality,
    level: clampedLevel,
    contextTonicMidi: toMidi(root),
    contextKey: pickContextKey(rng),
  }
}

export function gradeChordQualityAnswer(item: EarItem, answer: ChordQuality): EarGrade {
  return { correct: answer === item.answerKey, expected: item.answerKey, given: answer }
}

// ---------------------------------------------------------------------------
// scale/mode drill
// ---------------------------------------------------------------------------

export type ScaleItemOptions = { readonly range?: MidiRange }

/** Same comfortable window as the chord drill's default; also root-only (see `pickChordRoot`). */
const DEFAULT_SCALE_RANGE: MidiRange = { low: midi(48), high: midi(72) }

function pickScaleTonic(type: ScaleType, range: MidiRange, rng: Rng): SpelledPitch {
  const candidates = candidateRoots(range, SCALE_MAX_SPAN)
  invariant(candidates.length > 0, `no tonic in the given range can sound a ${type} scale within MIDI 0-127`)
  return fromMidi(pick(rng, candidates))
}

export function generateScaleModeItem(level: number, opts: ScaleItemOptions, rng: Rng): EarItem {
  const clampedLevel = clampLevel(level)
  const type = pick(rng, scaleTypesForLevel(level))
  invariant(
    SCALE_INTERVALS[type].length === 7,
    `generateScaleModeItem renders exactly 8 eighths into one bar; ${type} is not heptatonic`,
  )
  const range = opts.range ?? DEFAULT_SCALE_RANGE
  const tonic = pickScaleTonic(type, range, rng)

  // Ascending, one octave, tonic to tonic — see the module comment on why this
  // never renders the (different) descending form of melodic minor.
  const pitches = scaleNotes(tonic, type, 1)
  const notes = pitches.map(toMidi)
  const hand: Hand = at(notes, 0) >= MIDDLE_C ? 'right' : 'left'
  const noteInputs: ScoreNoteInput[] = notes.map((noteMidi, i) => ({
    midi: noteMidi,
    startTick: i * EIGHTH,
    durationTicks: EIGHTH,
    hand,
  }))

  const id = `scale-mode:${type}:${notes.join('-')}`
  const prompt = makeScore({ id, measures: [{}], notes: noteInputs })
  // roadmap 5.28: `contextTonicMidi` stays the scale's own tonic — it is
  // also the prompt's own first and last sounding note, and RevealPanel
  // reads it unchanged (item.ts's own doc). `contextKey` (roadmap 5.55) is
  // the independent key the PRE-answer triad actually plays from — see
  // `pickContextKey`'s own doc above for why it must not be the drawn scale
  // type (level 1 is exactly {major, naturalMinor}).
  return {
    id,
    kind: 'scale-mode',
    prompt,
    answerKey: type,
    level: clampedLevel,
    contextTonicMidi: toMidi(tonic),
    contextKey: pickContextKey(rng),
  }
}

export function gradeScaleModeAnswer(item: EarItem, answer: ScaleType): EarGrade {
  return { correct: answer === item.answerKey, expected: item.answerKey, given: answer }
}
