/**
 * Roman-numeral analysis of a whole `Score` (REQ-3.5.5) — "what chord is this,
 * and what does it call itself in this key?" applied to real, notated music
 * rather than to a hand-built `Chord`.
 *
 * Two problems `harmony.ts` and `chords.ts` do not solve, because they start
 * one chord at a time:
 *
 *  - **Segmentation.** A score is a stream of notes, not a list of chords. A
 *    slice is a maximal tick span over which the SET of sounding MIDI pitches
 *    (`soundingAtTick`) does not change AND no note re-attacks — the boundary
 *    ticks are the union of every note's own start and end tick, and a fresh
 *    onset always starts a new slice even when it happens to repeat the same
 *    pitch set (a re-articulated chord is not the same slice as the one before it).
 *  - **Non-chord tones.** A melody note sounding over a held harmony is not
 *    part of that harmony just because it is sounding. The rule here: within
 *    a slice, the *core* pitches are whichever sounding pitches have the
 *    longest individual `ScoreNote.durationTicks` (a whole-note left-hand
 *    chord outlasts the quarter-note melody passing tones above it), and the
 *    chord is read from the core alone via `identifyChord` (from
 *    `chord-recognition.ts`, never reimplemented here) — a shorter-held
 *    pitch is ignored even when it would coincidentally complete a "neater"
 *    reading together with the core (an accompaniment holding G-B-D under a
 *    passing E is a triad with a decoration, not an E-minor-seventh). Only
 *    when the core alone is too thin to name anything (a single sustained
 *    note, say) does every sounding pitch get a look. If nothing recognisable
 *    comes back even then, the slice gets `numeral: null` — an honest "this
 *    doesn't spell a chord in this key", never a guess dressed up as an
 *    answer. The trade-off: a genuine chord tone that happens to be
 *    shorter-held than a neighbouring pitch (e.g. a bare open fifth held
 *    while a brief third passes through) will not get to disambiguate major
 *    from minor — this rule reads harmonic rhythm, not voice-leading.
 *
 * `identifyChord` always spells a candidate's root with the default sharp (or,
 * if asked, flat) spelling of its pitch class — it has no way to know the
 * key. `respellForKey` below tries both standard spellings and keeps whichever
 * one `romanNumeralFor` actually recognises (diatonic, applied/secondary, or
 * the common borrowed chords — whatever `romanNumeralFor` itself supports).
 * That still cannot reach the handful of exotic keys (Cb/C# major and their
 * relatives) whose diatonic roots need a letter no pitch class is ever
 * spelled with by default (Fb, B#, E#, Cb) — those chords legitimately come
 * back `null` here even when they are diatonic, a known, documented gap.
 *
 * `detectKey` is a signature-plus-heuristic, exactly as asked for, not a key
 * finder: it takes `measures[0].keyFifths` as given (the score already
 * carries the signature) and only decides **major vs. its relative minor**
 * from three pitch-content votes — the relative minor's raised leading tone
 * appearing anywhere, and the first/last sounding bass note landing on the
 * minor tonic rather than the major one. Two or more votes flip it to minor.
 * This gets a genuine modulating or modally ambiguous piece wrong (Dorian,
 * Mixolydian — this model only knows major/minor); it was never meant to do
 * more than the common case a beginner's repertoire actually presents.
 *
 * Cadences: chords are first grouped into "harmonic runs" — consecutive chord
 * readings that resolve to the same roman numeral, regardless of how many
 * slices a moving melody splits them into. A phrase end is a barline where a
 * new run starts (never mid-measure) and either that run holds materially
 * longer than the one before it, or it is the score's own final run, which is
 * always checked. `classifyCadence` (harmony.ts) decides the type; only
 * non-`'none'` results are recorded, since "no cadence here" at every plain
 * barline would swamp the useful ones.
 */
import { buildChord, type Chord, chordTones, identifyChord, type Inversion, invertChord } from './chords.ts'
import { classifyCadence, type CadenceType, romanNumeralFor, type RomanNumeral } from './harmony.ts'
import { keyFromFifths, type Key, relativeKey } from './keys.ts'
import { fromMidi, toMidi } from './pitch.ts'
import {
  measureAtTick,
  notesAtTick,
  notesInMeasure,
  type Score,
  scoreDurationTicks,
  soundingAtTick,
} from '@core/notation/score.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { type Midi, type Ticks, ticks as asTicks } from '@core/shared/units.ts'

export type AnalysedChord = {
  readonly measureIndex: number
  readonly startTick: Ticks
  readonly durationTicks: Ticks
  /** Every pitch sounding across this slice, lowest first — not only the ones
   *  that produced the reading; a shorter-held non-chord tone is still reported here. */
  readonly midi: readonly Midi[]
  /** null when the sounding pitches spell nothing analysable in the key. */
  readonly numeral: RomanNumeral | null
  /** The bass pitch — what decides the inversion. */
  readonly bass: Midi
}

export type Analysis = {
  readonly key: Key
  readonly chords: readonly AnalysedChord[]
  /** Cadences found at phrase ends, by the index into `chords` of the FINAL chord. */
  readonly cadences: readonly { readonly atChordIndex: number; readonly type: CadenceType }[]
}

// ---------------------------------------------------------------------------
// detectKey
// ---------------------------------------------------------------------------

function bassAt(score: Score, tick: Ticks): Midi | undefined {
  let lowest: Midi | undefined
  for (const note of soundingAtTick(score, tick)) {
    if (lowest === undefined || note.midi < lowest) lowest = note.midi
  }
  return lowest
}

/** Guess the key from the score's own key signature and its pitch content. */
export function detectKey(score: Score): Key {
  const fifths = score.measures[0]?.keyFifths ?? 0
  const major = keyFromFifths(fifths, 'major')
  if (score.notes.length === 0) return major
  const minor = relativeKey(major)

  const minorTonicClass = toMidi(minor.tonic) % 12
  const raisedLeadingToneClass = (minorTonicClass + 11) % 12

  const pitchClasses = new Set(score.notes.map((n) => n.midi % 12))
  const leadingTonePresent = pitchClasses.has(raisedLeadingToneClass)

  const firstBass = bassAt(score, asTicks(0))
  const lastTick = Math.max(0, scoreDurationTicks(score) - 1)
  const lastBass = bassAt(score, asTicks(lastTick))

  const firstIsMinorTonic = firstBass !== undefined && firstBass % 12 === minorTonicClass
  const lastIsMinorTonic = lastBass !== undefined && lastBass % 12 === minorTonicClass

  const minorVotes = [leadingTonePresent, firstIsMinorTonic, lastIsMinorTonic].filter(
    Boolean,
  ).length
  return minorVotes >= 2 ? minor : major
}

// ---------------------------------------------------------------------------
// segmentation
// ---------------------------------------------------------------------------

type RawSlice = {
  readonly startTick: number
  readonly endTick: number
  readonly pitches: ReadonlySet<Midi>
  /** Longest `ScoreNote.durationTicks` seen for each pitch sounding in this slice. */
  readonly maxDurationByPitch: ReadonlyMap<Midi, number>
}

function boundaryTicks(score: Score): readonly number[] {
  const bounds = new Set<number>([0, scoreDurationTicks(score)])
  for (const note of score.notes) {
    bounds.add(note.startTick)
    bounds.add(note.startTick + note.durationTicks)
  }
  return [...bounds].sort((a, b) => a - b)
}

function sameMidiSet(a: ReadonlySet<Midi>, b: ReadonlySet<Midi>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/** Segment the score into maximal spans where the sounding pitch set is constant. */
function segmentSlices(score: Score): readonly RawSlice[] {
  const bounds = boundaryTicks(score)
  const slices: RawSlice[] = []

  let currentStart: number | undefined
  let currentEnd = 0
  let currentPitches: Set<Midi> = new Set()
  let currentMaxDur = new Map<Midi, number>()

  const flush = (): void => {
    if (currentStart === undefined) return
    slices.push({
      startTick: currentStart,
      endTick: currentEnd,
      pitches: currentPitches,
      maxDurationByPitch: currentMaxDur,
    })
  }

  for (let i = 0; i < bounds.length - 1; i++) {
    const start = at(bounds, i)
    const end = at(bounds, i + 1)

    const sounding = soundingAtTick(score, asTicks(start))
    const pitches = new Set<Midi>(sounding.map((n) => n.midi))

    // A re-articulated chord (a fresh onset at this boundary) must start a new slice
    // even when its pitch set happens to match the one before it — otherwise a
    // repeated block chord across a barline would be swallowed into one slice and
    // the barline would never be seen by cadence detection.
    const hasOnsetHere = notesAtTick(score, asTicks(start)).length > 0
    if (currentStart !== undefined && !hasOnsetHere && sameMidiSet(currentPitches, pitches)) {
      for (const note of sounding) {
        const previous = currentMaxDur.get(note.midi) ?? 0
        if (note.durationTicks > previous) currentMaxDur.set(note.midi, note.durationTicks)
      }
      currentEnd = end
      continue
    }

    flush()
    currentStart = start
    currentEnd = end
    currentPitches = pitches
    currentMaxDur = new Map(sounding.map((n) => [n.midi, n.durationTicks]))
  }

  flush()
  return slices
}

// ---------------------------------------------------------------------------
// naming a slice
// ---------------------------------------------------------------------------

/**
 * `identifyChord` only ever spells a root with the default sharp (or flat)
 * spelling of its pitch class. Try both, keep whichever one `romanNumeralFor`
 * actually recognises in this key — that is the spelling the key itself
 * uses, not a re-derivation of key-finding.
 *
 * Tries every ranked candidate `identifyChord` offers, not just its top pick.
 * `identifyChord`'s own tiebreak (does the bass double the root?) is about
 * which reading is most PLAUSIBLE in isolation; it has no way to know which
 * one the key can actually name. For a symmetric chord (a diminished 7th, an
 * augmented triad) several roots tie at full confidence, and the top-ranked
 * one can easily be the one this key cannot spell at all — trying the rest
 * before giving up is what keeps a wrong-but-confident answer from winning
 * over a correct-but-lower-ranked one.
 */
function firstRecognisedReading(
  candidates: readonly { readonly chord: Chord }[],
  key: Key,
): Chord | undefined {
  const preferenceOrder: readonly boolean[] =
    key.signature.fifths < 0 ? [true, false] : [false, true]
  for (const { chord } of candidates) {
    const soundingRoot = toMidi(chord.root)
    for (const preferFlats of preferenceOrder) {
      const candidateRoot = fromMidi(soundingRoot, preferFlats)
      try {
        const rebuilt = buildChord(candidateRoot, chord.quality, chord.inversion)
        if (romanNumeralFor(rebuilt, key) !== null) return rebuilt
      } catch {
        // Unwritable spelling (a triple accidental) — try the next candidate/spelling.
      }
    }
  }
  return undefined
}

/** Best-effort respelling when nothing in the ranked list names anything in this key. */
function respellNaive(chord: Chord, key: Key): Chord {
  const soundingRoot = toMidi(chord.root)
  const preferenceOrder: readonly boolean[] =
    key.signature.fifths < 0 ? [true, false] : [false, true]
  for (const preferFlats of preferenceOrder) {
    const candidateRoot = fromMidi(soundingRoot, preferFlats)
    try {
      return buildChord(candidateRoot, chord.quality, chord.inversion)
    } catch {
      continue
    }
  }
  return chord
}

/**
 * Read the chord from the core (longest-sounding) pitches alone, ignoring every
 * shorter-held pitch entirely — that is what "not a chord" means for a passing tone,
 * rather than a discount applied after the fact. Only when the core is too thin to name
 * anything on its own (a single sustained note, say) does the full sounding set get a look,
 * since at that point every pitch is equally "the best information available". `recognised`
 * is false only for the last-resort case where nothing in either ranked list names anything
 * in this key at all — the caller reports `numeral: null` rather than a guess.
 */
function bestChordForSlice(
  pitches: readonly Midi[],
  corePitches: readonly Midi[],
  key: Key,
): { readonly chord: Chord; readonly recognised: boolean } | null {
  const coreCandidates = identifyChord(corePitches)
  const coreMatch = firstRecognisedReading(coreCandidates, key)
  if (coreMatch !== undefined) return { chord: coreMatch, recognised: true }

  const fallbackCandidates = identifyChord(pitches)
  const fallbackMatch = firstRecognisedReading(fallbackCandidates, key)
  if (fallbackMatch !== undefined) return { chord: fallbackMatch, recognised: true }

  const best = coreCandidates[0] ?? fallbackCandidates[0]
  if (best === undefined) return null
  return { chord: respellNaive(best.chord, key), recognised: false }
}

/**
 * `bass` (the lowest SOUNDING pitch of the whole slice) is documented as what decides
 * the inversion — but `identifyChord` only ever sees the CORE pitches, so a held root-
 * position chord under a moving bass note would otherwise keep reporting root position
 * while a different pitch class sits in the bass. Re-seat onto the real bass: root
 * position when the bass is not one of the chord's own tones.
 */
function reseatOnBass(chord: Chord, bass: Midi): Chord {
  const bassClass = bass % 12
  const rootPositionTones = chordTones(chord)
  const index = rootPositionTones.findIndex((t) => toMidi(t) % 12 === bassClass)
  const inversion = (index < 0 ? 0 : index) as Inversion
  return inversion === chord.inversion ? chord : invertChord(chord, inversion)
}

type ChordReading = {
  readonly analysed: AnalysedChord
  readonly chord: Chord | null
  /** The start tick of the measure this reading's slice falls in — for an exact
   *  (not measure-index) test of whether the next reading arrives on a barline. */
  readonly measureStartTick: Ticks
}

function analyseSlice(score: Score, key: Key, slice: RawSlice): ChordReading | undefined {
  if (slice.pitches.size === 0) return undefined

  const midi = [...slice.pitches].sort((a, b) => a - b)
  const bass = at(midi, 0)

  let maxDur = 0
  for (const duration of slice.maxDurationByPitch.values()) if (duration > maxDur) maxDur = duration
  const corePitches: Midi[] = []
  for (const [pitch, duration] of slice.maxDurationByPitch) {
    if (duration === maxDur) corePitches.push(pitch)
  }

  const found = bestChordForSlice(midi, corePitches, key)
  const chord = found === null ? null : reseatOnBass(found.chord, bass)
  const numeral = found === null || !found.recognised || chord === null ? null : romanNumeralFor(chord, key)

  const measure = measureAtTick(score, asTicks(slice.startTick))
  invariant(measure !== undefined, `analyseSlice: slice at tick ${slice.startTick} lies outside every measure`)

  const analysed: AnalysedChord = {
    measureIndex: measure.index,
    startTick: asTicks(slice.startTick),
    durationTicks: asTicks(slice.endTick - slice.startTick),
    midi,
    numeral,
    bass,
  }
  return { analysed, chord, measureStartTick: measure.startTick }
}

// ---------------------------------------------------------------------------
// cadences
// ---------------------------------------------------------------------------

/** A maximal run of consecutive readings that resolve to the same roman numeral — a
 *  moving melody can split one held harmony across several slices, and the phrase-end
 *  test below needs to compare whole harmonies, not individual melody-driven slices. */
type HarmonicRun = {
  /** Index into `readings` of this run's first slice — where the harmony arrives. */
  readonly startIndex: number
  /** Index into `readings` of this run's last slice — the chord right before it changes. */
  readonly endIndex: number
  readonly totalDurationTicks: number
  /** Does this run's first slice start exactly at its measure's own start tick? */
  readonly arrivesOnBarline: boolean
}

function sameFunction(a: RomanNumeral | null, b: RomanNumeral | null): boolean {
  if (a === null || b === null) return false
  return (
    a.degree === b.degree &&
    a.quality === b.quality &&
    a.appliedTo === b.appliedTo &&
    a.alter === b.alter
  )
}

function buildHarmonicRuns(readings: readonly ChordReading[]): readonly HarmonicRun[] {
  const runs: HarmonicRun[] = []
  let i = 0
  while (i < readings.length) {
    const first = at(readings, i)
    // A null numeral never merges with anything, not even a run of its own — this
    // reading always occupies at least one slot on its own, which is also what
    // guarantees `j` advances past `i` on every iteration of the outer loop.
    let j = i + 1
    let total: number = first.analysed.durationTicks
    while (j < readings.length && sameFunction(at(readings, j).analysed.numeral, first.analysed.numeral)) {
      total += at(readings, j).analysed.durationTicks
      j++
    }
    runs.push({
      startIndex: i,
      endIndex: j - 1,
      totalDurationTicks: total,
      arrivesOnBarline: first.measureStartTick === first.analysed.startTick,
    })
    i = j
  }
  return runs
}

/** How much longer an arriving run's total duration must be than the one it replaces
 *  to count as "the harmonic rhythm stopping" rather than just the next scheduled change. */
const MATERIALLY_LONGER_FACTOR = 1.5

/** The highest pitch of the upper-staff (melody) notes sounding across the arriving
 *  chord's whole measure — not whatever happens to be sounding at the slice's first
 *  tick, which can be an inner voice when the melody rests on the downbeat. Falls back
 *  to the top of the reported sounding set when the measure has no right-hand notes. */
function sopranoForCadence(score: Score, reading: ChordReading): Midi {
  const melodyNotes = notesInMeasure(score, reading.analysed.measureIndex).filter(
    (n) => n.hand === 'right',
  )
  if (melodyNotes.length === 0) return at(reading.analysed.midi, reading.analysed.midi.length - 1)
  return melodyNotes.reduce((highest, n) => (n.midi > highest ? n.midi : highest), at(melodyNotes, 0).midi)
}

function findCadences(
  score: Score,
  key: Key,
  readings: readonly ChordReading[],
): readonly { readonly atChordIndex: number; readonly type: CadenceType }[] {
  const runs = buildHarmonicRuns(readings)
  const cadences: { readonly atChordIndex: number; readonly type: CadenceType }[] = []

  for (let i = 0; i < runs.length - 1; i++) {
    const previousRun = at(runs, i)
    const nextRun = at(runs, i + 1)

    const isLastPair = i + 2 === runs.length
    if (!isLastPair) {
      if (!nextRun.arrivesOnBarline) continue
      const materiallyLonger =
        nextRun.totalDurationTicks > previousRun.totalDurationTicks * MATERIALLY_LONGER_FACTOR
      if (!materiallyLonger) continue
    }

    const penultimateChord = at(readings, previousRun.endIndex).chord
    const finalReading = at(readings, nextRun.startIndex)
    const finalChord = finalReading.chord
    if (penultimateChord === null || finalChord === null) continue

    const sopranoMidi = sopranoForCadence(score, finalReading)
    const type = classifyCadence(penultimateChord, finalChord, key, sopranoMidi)
    if (type !== 'none') cadences.push({ atChordIndex: nextRun.startIndex, type })
  }

  return cadences
}

// ---------------------------------------------------------------------------
// analyseScore
// ---------------------------------------------------------------------------

export function analyseScore(score: Score, key?: Key): Analysis {
  const resolvedKey = key ?? detectKey(score)
  const slices = segmentSlices(score)

  const readings: ChordReading[] = []
  for (const slice of slices) {
    const reading = analyseSlice(score, resolvedKey, slice)
    if (reading !== undefined) readings.push(reading)
  }

  return {
    key: resolvedKey,
    chords: readings.map((r) => r.analysed),
    cadences: findCadences(score, resolvedKey, readings),
  }
}
