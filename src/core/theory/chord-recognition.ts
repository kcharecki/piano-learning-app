/**
 * Chord recognition — the direction of travel that starts from *sounding* MIDI
 * notes rather than from a spelling.
 *
 * Construction (`chords.ts`) is exact: it knows the letters. Recognition has
 * already lost them, so it answers in pitch classes and offers a default sharp
 * spelling, and it is legitimately ambiguous — a diminished 7th has four
 * equally good roots and Csus2 is also Gsus4 — so `identifyChord` returns a
 * ranked list rather than one answer.
 *
 * `matchesChord` is the other half: not "what is this?" but "is this the chord
 * I asked for?", which a drill needs to grade a played voicing.
 *
 * Both are re-exported from `chords.ts`.
 */
import { at } from '@core/shared/invariant.ts'
import { midi, type Midi } from '@core/shared/units.ts'
import { fromMidi, pitchClass } from './pitch.ts'
import {
  buildChord,
  type Chord,
  CHORD_INTERVALS,
  CHORD_QUALITIES,
  type ChordQuality,
  chordMidi,
  type Inversion,
  INVERSIONS,
} from './chords.ts'

export type ChordMatch = { readonly chord: Chord; readonly confidence: number }

const SEMITONES_PER_OCTAVE = 12

/**
 * Which reading wins a tie in {@link identifyChord}, lowest first. Plain triads
 * and the everyday sevenths come before the exotica, so C E G reads as C major
 * rather than as a rootless something.
 *
 * A `Record` rather than a list, for the same reason as the tables in
 * `chords.ts`: it has to be **total** over {@link CHORD_QUALITIES}, and only the
 * record shape makes an omission a compile error. A list consulted with
 * `indexOf` answers -1 for a quality nobody added, which would quietly rank that
 * quality ahead of major in every tie rather than failing loudly.
 */
export const QUALITY_PRIORITY: Readonly<Record<ChordQuality, number>> = {
  major: 0,
  minor: 1,
  dominant7: 2,
  major7: 3,
  minor7: 4,
  diminished: 5,
  halfDiminished7: 6,
  diminished7: 7,
  augmented: 8,
  sus4: 9,
  sus2: 10,
  minorMajor7: 11,
  augmentedMajor7: 12,
}

/**
 * A reading must share strictly more than half of the pitch classes involved
 * (Jaccard overlap) to be offered at all. This is what makes a chromatic
 * cluster return nothing instead of a page of 40% guesses.
 */
const CONFIDENCE_FLOOR = 0.5

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

/** Which inversion puts `bassClass` in the bass, or root position if it is not a chord tone. */
function inversionForBass(rootClass: number, quality: ChordQuality, bassClass: number): Inversion {
  const index = CHORD_INTERVALS[quality].findIndex(
    (s) => (rootClass + s) % SEMITONES_PER_OCTAVE === bassClass,
  )
  return index < 0 ? 0 : at(INVERSIONS, index)
}

type Candidate = {
  readonly chord: Chord
  readonly confidence: number
  readonly rootClass: number
  readonly rootIsBass: boolean
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence
  if (a.rootIsBass !== b.rootIsBass) return a.rootIsBass ? -1 : 1
  const byQuality = QUALITY_PRIORITY[a.chord.quality] - QUALITY_PRIORITY[b.chord.quality]
  if (byQuality !== 0) return byQuality
  return a.rootClass - b.rootClass
}

/**
 * What chord is being played? Works from pitch classes, so octave doubling and
 * notes spread across the keyboard are free, and the lowest sounding note picks
 * the inversion.
 *
 * Confidence is the overlap between the played pitch classes and the chord's:
 * 1 when the two sets are equal, less when notes are missing or extra. Genuine
 * ambiguity is reported, not resolved — a diminished 7th comes back four times,
 * once per root, all at confidence 1, and Csus2 always brings Gsus4 with it.
 * Returns an empty array when nothing is plausible.
 */
export function identifyChord(notes: readonly Midi[]): readonly ChordMatch[] {
  if (notes.length === 0) return []

  const played = new Set(notes.map(pitchClass))
  const bassClass = pitchClass(notes.reduce((low, n) => (n < low ? n : low)))

  const candidates: Candidate[] = []
  for (let rootClass = 0; rootClass < SEMITONES_PER_OCTAVE; rootClass++) {
    // A sharp spelling is the only defensible default: the sounding notes carry
    // no evidence for Eb over D#. Callers that know the key should re-spell.
    const root = fromMidi(midi(rootClass + 60))
    for (const quality of CHORD_QUALITIES) {
      const target = new Set(
        CHORD_INTERVALS[quality].map((s) => (rootClass + s) % SEMITONES_PER_OCTAVE),
      )
      const common = [...target].filter((pc) => played.has(pc)).length
      const confidence = common / (target.size + played.size - common)
      if (confidence <= CONFIDENCE_FLOOR) continue
      candidates.push({
        chord: buildChord(root, quality, inversionForBass(rootClass, quality, bassClass)),
        confidence,
        rootClass,
        rootIsBass: rootClass === bassClass,
      })
    }
  }

  return candidates.sort(compareCandidates).map(({ chord, confidence }) => ({ chord, confidence }))
}

/**
 * Did the learner play exactly this chord?
 *
 * By default the voicing must match note for note, inversion included — and
 * "note for note" counts notes, so playing middle C twice against a three-note
 * voicing is four notes and does not match. With `ignoreOctave` only the
 * pitch-class set has to agree, which is what a "play a D minor chord anywhere"
 * drill wants. With `allowDoubling` the written voicing must still be present
 * but extra doublings of chord tones — including a repeat of a note already in
 * the voicing — are forgiven.
 *
 * @public — the counterpart to {@link identifyChord} (live in production via `analysis.ts`):
 * identifyChord answers "what chord is this", matchesChord answers "is this the chord I asked
 * for", which a drill needs to grade a played voicing. Re-exported from `chords.ts`.
 */
export function matchesChord(
  played: readonly Midi[],
  expected: Chord,
  opts?: { ignoreOctave?: boolean; allowDoubling?: boolean },
): boolean {
  if (played.length === 0) return false

  const wanted = chordMidi(expected)
  const playedClasses = new Set(played.map(pitchClass))
  const wantedClasses = new Set(wanted.map(pitchClass))

  if (opts?.ignoreOctave ?? false) return sameSet(playedClasses, wantedClasses)

  const playedNotes = new Set<number>(played)
  if (opts?.allowDoubling ?? false) {
    return wanted.every((n) => playedNotes.has(n)) && sameSet(playedClasses, wantedClasses)
  }
  // Count before de-duplicating: a repeated note is an extra note, not a no-op.
  return played.length === wanted.length && wanted.every((n) => playedNotes.has(n))
}
