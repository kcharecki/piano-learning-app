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
 * from a WEIGHTED sum of five pieces of evidence (roadmap 3.19a) — flat
 * `minorVotes >= 2` unweighted-boolean counting was tried first and shipped a
 * known defect: a plagal minor piece ("iv | i | iv | i", bass D-A-D-A in A
 * minor — no leading tone anywhere, first bass not the tonic) casts only ONE
 * of the three old votes (`lastIsMinorTonic`) and so always read as C major,
 * even though closing on the minor tonic, driven there by its own
 * subdominant, is exactly what a plagal cadence in the minor key IS. The two
 * bass votes were also close to redundant with each other (first and last
 * bass are largely the same evidence — see `WEIGHT_FIRST_BASS` /
 * `WEIGHT_LAST_BASS` below for why they are no longer equal), and neither the
 * old scheme nor the new one can see a bass-driven cadence that never
 * reaches the tonic pitch class at all, only that it moved FROM the
 * subdominant TO the tonic — new evidence the old boolean set had no room
 * for.
 *
 * The five inputs, combined as `minorScore = Σ(weight × evidence)` and
 * compared against `MINOR_KEY_THRESHOLD`:
 *  1. `leadingToneResolves` (`WEIGHT_LEADING_TONE`) — the relative minor's
 *     raised leading tone actually resolving to the minor tonic AT THE
 *     PIECE'S OWN FINAL CADENCE (see `leadingToneResolvesToMinorTonic` below
 *     — not merely sounding anywhere, and not merely resolving somewhere in
 *     the middle of the piece).
 *  2. `lastIsMinorTonic` (`WEIGHT_LAST_BASS`) — the bass note (left-hand
 *     only — see `bassAt`) the piece ENDS on.
 *  3. `firstIsMinorTonic` (`WEIGHT_FIRST_BASS`) — the bass note the piece
 *     OPENS on.
 *  4. `plagalMotionIntoFinalMeasure` (`WEIGHT_PLAGAL_MOTION`) — the final
 *     bass reached the minor tonic AND was driven there from its own
 *     subdominant (see the doc comment on that function) — the roadmap-3.19a
 *     fix.
 *  5. `tonicTriadPrevalenceScore` (`WEIGHT_TONIC_TRIAD_PREVALENCE`) — a
 *     continuous, always-available tie-breaker: how much more of the piece's
 *     total note duration spells the minor tonic triad than the major one.
 *
 * A texture with no left-hand voice at all (see `bassAt`) casts none of
 * votes 1–4; only the prevalence tie-breaker remains, and it alone (bounded
 * well under `MINOR_KEY_THRESHOLD`) can never flip the key on its own — see
 * the monophonic-melody fixture. This gets a genuine modulating or modally
 * ambiguous piece wrong (Dorian, Mixolydian — this model only knows
 * major/minor); it was never meant to do more than the common case a
 * beginner's repertoire actually presents.
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
import {
  buildChord,
  type Chord,
  chordTones,
  identifyChord,
  type Inversion,
  invertChord,
} from './chords.ts'
import { classifyCadence, type CadenceType, romanNumeralFor, type RomanNumeral } from './harmony.ts'
import { keyFromFifths, type Key, relativeKey } from './keys.ts'
import { fromMidi, toMidi } from './pitch.ts'
import { type Score } from '@core/notation/score.ts'
import { measureAtTick, notesAtTick, notesInMeasure, scoreDurationTicks, soundingAtTick } from '@core/notation/scoreQueries.ts'
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

/** The bass is the lowest LEFT-HAND note sounding — never a decorative upper
 *  voice, and never a right-hand melody standing in for a missing bass. A
 *  texture with no left-hand voice sounding at `tick` (a monophonic melody, a
 *  bass rest) has no bass at all: `undefined`, not "whatever else happens to
 *  be sounding". */
function bassAt(score: Score, tick: Ticks): Midi | undefined {
  let lowest: Midi | undefined
  for (const note of soundingAtTick(score, tick)) {
    if (note.hand !== 'left') continue
    if (lowest === undefined || note.midi < lowest) lowest = note.midi
  }
  return lowest
}

/**
 * The bass's own next move after a note starting at `noteStartTick` and
 * lasting `noteDurationTicks`: the first point at or after the note ends
 * where `bassAt` no longer equals what it was while the note was sounding
 * (sampled at the note's own start). `bass` is `undefined` when that move is
 * into silence (no left-hand note sounding there); the whole result is
 * `undefined` when the bass never moves again before the score ends.
 *
 * Deliberately not a fixed tick window: a window sized for one metre is
 * either too wide for a fast 2/2 phrase or too narrow for a slow 3/8 one, and
 * a held or arpeggiated dominant can keep the bass parked on the same note
 * for longer than any fixed width before it finally moves. "The next time
 * the bass actually moves" needs no size tuned to a rhythm at all — and
 * because it samples the bass's value, not just note onsets, a bass RELEASE
 * that exposes a different held pitch (or silence) with no new onset counts
 * as a move too.
 */
function nextBassChange(
  score: Score,
  noteStartTick: number,
  noteDurationTicks: number,
): { readonly tick: number; readonly bass: Midi | undefined } | undefined {
  const baseline = bassAt(score, asTicks(noteStartTick))
  const afterTick = noteStartTick + noteDurationTicks
  const candidateTicks = new Set<number>([afterTick])
  for (const note of score.notes) {
    if (note.hand !== 'left') continue
    if (note.startTick > afterTick) candidateTicks.add(note.startTick)
    const endTick = note.startTick + note.durationTicks
    if (endTick > afterTick) candidateTicks.add(endTick)
  }
  for (const tick of [...candidateTicks].sort((a, b) => a - b)) {
    const bass = bassAt(score, asTicks(tick))
    if (bass !== baseline) return { tick, bass }
  }
  return undefined
}

/**
 * The relative minor's raised leading tone is only real evidence of minor where
 * it does what a leading tone does at a place local pitch content cannot see:
 * function as the dominant of the PIECE'S OWN FINAL CADENCE, specifically —
 * not of some chord in the middle of it.
 *
 * The hard case this rule exists for: a secondary dominant (V/vi) resolving to
 * vi in the middle of an otherwise major piece, and V resolving to i in the
 * relative minor, are THE SAME SONORITY resolving the SAME WAY — a major triad
 * a semitone below the minor tonic, with the bass moving to that tonic right
 * after. No local rule can tell them apart, because there is nothing local to
 * find: the only thing that distinguishes them is WHERE in the piece the
 * resolution sits. A mid-piece V/vi is a passing tonicisation the piece then
 * leaves behind; the same motion landing at the piece's own final cadence is
 * the piece stating its key.
 *
 * So the vote only counts when the bass (`bassAt` — left-hand only, never a
 * decorative upper voice, and no vote at all where there is no left-hand
 * voice to read) reaches the minor tonic pitch class at its own next move
 * after the leading tone ends (`nextBassChange` — not "eventually, somewhere
 * later", which would just re-admit the old bug under a longer leash), AND
 * that move lands at or after the start of the score's own final measure.
 * Anywhere earlier, the same resolution is presumed a mid-piece tonicisation:
 * the V/vi case above, or a chromatic passing tone that merely threads through
 * the leading-tone pitch class without the bass ever moving to it because of it
 * (G-G#-A climbing to the diatonic 6th over a held IV, the bass never leaving
 * the IV chord's root).
 *
 * There is no unconditional "sounds in the final measure" escape hatch: even
 * there, the bass must actually reach the minor tonic. The previous version of
 * this vote — `pitchClasses.has(raisedLeadingToneClass)` — could not tell any
 * of this apart from a genuine minor cadence: one bar of V/vi anywhere in the
 * piece plus an A anywhere in the outer bass was enough to flip a whole C major
 * piece to A minor and mislabel every roman numeral downstream (roadmap 3.19,
 * REQ-3.5.5); a later, mid-fix revision let it back in through exactly that
 * escape hatch (any raised leading tone in the last bar voted, bass ignored).
 */
function leadingToneResolvesToMinorTonic(score: Score, minorTonicClass: number): boolean {
  const raisedLeadingToneClass = (minorTonicClass + 11) % 12
  const lastMeasure = at(score.measures, score.measures.length - 1)
  for (const note of score.notes) {
    if (note.midi % 12 !== raisedLeadingToneClass) continue
    const change = nextBassChange(score, note.startTick, note.durationTicks)
    if (
      change !== undefined &&
      change.bass !== undefined &&
      change.bass % 12 === minorTonicClass &&
      change.tick >= lastMeasure.startTick
    ) {
      return true
    }
  }
  return false
}

/**
 * Evidence weights for `detectKey`'s `minorScore` (see the module comment above for
 * the full rationale). Larger = stronger evidence for the relative minor. Named
 * constants, never buried in the scoring expression itself, per roadmap 3.19a.
 */

/** A leading tone that genuinely resolves to the minor tonic AT THE PIECE'S OWN FINAL
 *  CADENCE (`leadingToneResolvesToMinorTonic`) is the strongest single piece of
 *  evidence this heuristic can gather: by construction it can only fire at the one
 *  place in the piece that actually states the key. Weighted equal to the final bass —
 *  the other single vote strong enough to matter on its own once corroborated. */
const WEIGHT_LEADING_TONE = 2

/** The bass note the piece actually ENDS on. Weighted TWICE the opening bass below,
 *  because a piece's LAST bass note is much stronger evidence of its key than its
 *  first: the ending is where a piece commits to its key, while the opening can still
 *  be an anacrusis, a plagal introduction, or simply "wrong" for the eventual key
 *  (see the "single vote" fixture: a piece that opens on the major tonic and closes on
 *  the minor one is NOT thereby minor). */
const WEIGHT_LAST_BASS = 2

/** The bass note the piece OPENS on. Real but weaker evidence than the closing bass
 *  (`WEIGHT_LAST_BASS`) — corroborating, never decisive alone. */
const WEIGHT_FIRST_BASS = 1

/** A plagal (iv -> i) bass motion arriving at the piece's own final measure — the
 *  roadmap-3.19a fix (see `plagalMotionIntoFinalMeasure`). A piece closing "iv | i" has
 *  no leading tone to vote and, on its own, only the single "last bass" vote — exactly
 *  the same evidence a merely-ambiguous piece (major tonic bass at one end, minor
 *  tonic bass at the other) also produces. What tells them apart is that the bass
 *  didn't just LAND on the minor tonic, it was DRIVEN there by its own subdominant —
 *  real harmonic motion, not coincidence. Weighted the same as the opening bass: real
 *  corroborating evidence, not decisive alone, but enough together with the last-bass
 *  vote to cross `MINOR_KEY_THRESHOLD` where the merely-ambiguous case does not. */
const WEIGHT_PLAGAL_MOTION = 1

/** Coefficient on the continuous duration-weighted tonic-triad-prevalence signal
 *  (`tonicTriadPrevalenceScore`, magnitude well under 1 in every fixture this module
 *  has seen). Always present, small relative to the boolean votes above: a genuinely
 *  close call gets nudged, but this alone can never reach `MINOR_KEY_THRESHOLD` — a
 *  tie-breaker, not a vote (see the monophonic fixture, whose melody alone produces a
 *  real-looking tilt with zero harmonic evidence behind it). */
const WEIGHT_TONIC_TRIAD_PREVALENCE = 1

/** The `minorScore` a piece needs to read as the relative minor. Chosen so the two
 *  strong, independent votes together (`WEIGHT_LEADING_TONE + WEIGHT_LAST_BASS`, or
 *  `WEIGHT_LAST_BASS + WEIGHT_PLAGAL_MOTION`) already clear it, while any single vote
 *  alone (2, or 1 for the weaker ones) never does — the same "needs corroboration"
 *  shape as the old `minorVotes >= 2` rule, extended to weighted, continuous evidence. */
const MINOR_KEY_THRESHOLD = 2.5

/** The maximum magnitude the continuous prevalence signal may contribute to
 *  `minorScore`, strictly less than the gap between any two attainable boolean-vote
 *  sums (which are always whole numbers at least 1 apart at `MINOR_KEY_THRESHOLD`'s
 *  neighbourhood). This is what makes the tie-breaker claim in
 *  `WEIGHT_TONIC_TRIAD_PREVALENCE`'s comment actually true: with `MINOR_KEY_THRESHOLD`
 *  set below the common boolean sum of 3 (first bass + last bass on the minor tonic),
 *  prevalence could otherwise still flip that case to major on its own if it swung
 *  negative — clamping keeps it sub-decisive in both directions. */
const PREVALENCE_CLAMP = 0.49

/** The three pitch classes of a tonic triad built on `tonicClass`, root position:
 *  tonic, third (major = +4 semitones, minor = +3) and perfect fifth (+7). */
function tonicTriadClasses(tonicClass: number, thirdInterval: 3 | 4): readonly number[] {
  return [tonicClass, (tonicClass + thirdInterval) % 12, (tonicClass + 7) % 12]
}

/**
 * How much more of the score's own note duration spells the minor tonic triad than
 * the major one, as a fraction of the score's total note duration: positive leans
 * minor, negative leans major. Magnitude stays well under 1 in every fixture this
 * module has seen, because the relative major and minor tonic triads always share two
 * of their three pitch classes (they are built a third apart, so one triad's root and
 * third are the other's third and fifth) — the two prevalence sums necessarily overlap
 * heavily and can never diverge as sharply as a clean boolean vote.
 *
 * Cheap and always available — unlike the bass votes, it needs no left-hand voice at
 * all — which is exactly why it is weighted as a tie-breaker
 * (`WEIGHT_TONIC_TRIAD_PREVALENCE`) rather than a vote: a melody-only texture can rack
 * up a real-looking prevalence tilt from its own tune with no harmonic evidence behind
 * it at all (see the monophonic fixture), and must never be enough on its own to
 * decide the key.
 */
function tonicTriadPrevalenceScore(
  score: Score,
  minorTonicClass: number,
  majorTonicClass: number,
): number {
  const minorClasses = new Set(tonicTriadClasses(minorTonicClass, 3))
  const majorClasses = new Set(tonicTriadClasses(majorTonicClass, 4))
  let minorTicks = 0
  let majorTicks = 0
  let totalTicks = 0
  for (const note of score.notes) {
    const pitchClass = note.midi % 12
    totalTicks += note.durationTicks
    if (minorClasses.has(pitchClass)) minorTicks += note.durationTicks
    if (majorClasses.has(pitchClass)) majorTicks += note.durationTicks
  }
  return totalTicks === 0 ? 0 : (minorTicks - majorTicks) / totalTicks
}

/**
 * The tick, at or after `measureStartTick`, of the earliest left-hand onset in
 * the measure — a fresh onset exactly on the downbeat, or the earliest
 * left-hand onset later in the measure. `undefined` when no left-hand voice
 * ever sounds in this measure at all.
 *
 * Exists because a late-entering left hand — a rest on the downbeat, or an
 * upper-voice pickup sounding first while the bass waits a beat — has no bass at
 * the measure's own start tick even though it plainly does have one, one beat
 * later, once it enters. Sampling only `measureStartTick` would silently read
 * that as "no bass here" and drop real evidence rather than report it honestly.
 */
function firstBassTickInMeasure(score: Score, measureStartTick: number): number | undefined {
  const candidateTicks = new Set<number>()
  for (const note of score.notes) {
    if (note.hand !== 'left') continue
    if (note.startTick >= measureStartTick) candidateTicks.add(note.startTick)
  }
  for (const tick of [...candidateTicks].sort((a, b) => a - b)) {
    if (bassAt(score, asTicks(tick)) !== undefined) return tick
  }
  return undefined
}

/**
 * The pitch class of the bass's own last distinct value before `beforeTick`,
 * skipping any left-hand onset whose bass pitch class equals `excludeClass` —
 * walking backwards from `beforeTick` through left-hand onsets until one is
 * found whose bass differs from the tonic just reached. Anchoring to the
 * barline tick instead (as a prior version of this function did) breaks on a
 * left-hand rest straddling the barline from the OTHER side: an early release
 * before the barline leaves the barline tick silent even though the
 * subdominant plainly sounded a beat earlier, in the same measure.
 */
function priorDistinctBassClass(
  score: Score,
  beforeTick: number,
  excludeClass: number,
): number | undefined {
  const onsets = new Set<number>()
  for (const note of score.notes) {
    if (note.hand === 'left' && note.startTick < beforeTick) onsets.add(note.startTick)
  }
  for (const onset of [...onsets].sort((a, b) => b - a)) {
    const bass = bassAt(score, asTicks(onset))
    if (bass !== undefined && bass % 12 !== excludeClass) return bass % 12
  }
  return undefined
}

/**
 * A plagal (iv -> i) bass motion arriving at the piece's own final measure: the bass
 * at the first tick the left hand actually sounds within the final measure
 * (`firstBassTickInMeasure` — not necessarily the measure's own start tick; see its
 * doc comment) is the minor tonic, AND the bass's own last distinct value before that
 * (`priorDistinctBassClass` — not necessarily sampled at the barline; see its doc
 * comment) is the minor subdominant (a perfect fourth below the tonic, i.e.
 * `tonicClass + 5`). This is the evidence the plagal defect (roadmap 3.19a) needs and
 * the plain "last bass is the minor tonic" vote cannot supply on its own: a piece can
 * land on the minor-tonic bass at its very end by simple coincidence (see the "single
 * vote" fixture, where the piece's other half is the unrelated major tonic) — but the
 * bass actually being DRIVEN there by its own subdominant right before is real
 * harmonic motion, not coincidence.
 *
 * The bass landing on the tonic class is not enough on its own: it says nothing about
 * whether the chord actually arriving there is the minor tonic TRIAD (as opposed to,
 * say, a ii or vi built on an unrelated scale degree that merely happens to share the
 * bass pitch class). So this also requires the minor third above the tonic
 * (`minorTonicClass + 3`) to be sounding somewhere at that same tick, in either hand.
 */
function plagalMotionIntoFinalMeasure(score: Score, minorTonicClass: number): boolean {
  const lastMeasure = at(score.measures, score.measures.length - 1)
  if (lastMeasure.startTick <= 0) return false
  const finalBassTick = firstBassTickInMeasure(score, lastMeasure.startTick)
  if (finalBassTick === undefined) return false
  const finalBass = bassAt(score, asTicks(finalBassTick))
  if (finalBass === undefined || finalBass % 12 !== minorTonicClass) return false
  const minorThirdClass = (minorTonicClass + 3) % 12
  const hasMinorThird = soundingAtTick(score, asTicks(finalBassTick)).some(
    (note) => note.midi % 12 === minorThirdClass,
  )
  if (!hasMinorThird) return false
  const subdominantClass = (minorTonicClass + 5) % 12
  const priorBassClass = priorDistinctBassClass(score, finalBassTick, minorTonicClass)
  return priorBassClass === subdominantClass
}

/** Guess the key from the score's own key signature and its pitch content. */
export function detectKey(score: Score): Key {
  const fifths = score.measures[0]?.keyFifths ?? 0
  const major = keyFromFifths(fifths, 'major')
  if (score.notes.length === 0) return major
  const minor = relativeKey(major)

  const minorTonicClass = toMidi(minor.tonic) % 12
  const majorTonicClass = toMidi(major.tonic) % 12
  const leadingToneResolves = leadingToneResolvesToMinorTonic(score, minorTonicClass)

  const firstBass = bassAt(score, asTicks(0))
  const lastTick = Math.max(0, scoreDurationTicks(score) - 1)
  const lastBass = bassAt(score, asTicks(lastTick))

  const firstIsMinorTonic = firstBass !== undefined && firstBass % 12 === minorTonicClass
  const lastIsMinorTonic = lastBass !== undefined && lastBass % 12 === minorTonicClass
  const plagalIntoFinal = plagalMotionIntoFinalMeasure(score, minorTonicClass)
  const prevalence = tonicTriadPrevalenceScore(score, minorTonicClass, majorTonicClass)

  const prevalenceTerm = Math.max(
    -PREVALENCE_CLAMP,
    Math.min(PREVALENCE_CLAMP, prevalence * WEIGHT_TONIC_TRIAD_PREVALENCE),
  )

  const minorScore =
    (leadingToneResolves ? WEIGHT_LEADING_TONE : 0) +
    (firstIsMinorTonic ? WEIGHT_FIRST_BASS : 0) +
    (lastIsMinorTonic ? WEIGHT_LAST_BASS : 0) +
    (plagalIntoFinal ? WEIGHT_PLAGAL_MOTION : 0) +
    prevalenceTerm

  return minorScore >= MINOR_KEY_THRESHOLD ? minor : major
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
  const numeral =
    found === null || !found.recognised || chord === null ? null : romanNumeralFor(chord, key)

  const measure = measureAtTick(score, asTicks(slice.startTick))
  invariant(
    measure !== undefined,
    `analyseSlice: slice at tick ${slice.startTick} lies outside every measure`,
  )

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
    while (
      j < readings.length &&
      sameFunction(at(readings, j).analysed.numeral, first.analysed.numeral)
    ) {
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
  return melodyNotes.reduce(
    (highest, n) => (n.midi > highest ? n.midi : highest),
    at(melodyNotes, 0).midi,
  )
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
