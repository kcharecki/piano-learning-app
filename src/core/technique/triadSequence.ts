/**
 * Triad sequence — REQ-3.7.1, the RCM Piano Syllabus 2022 Preparatory A
 * technical test: the eight root-position diatonic triads of a key, one per
 * scale degree, played ascending exactly one octave. In C major that is
 * C4-E4-G4, D4-F4-A4, E4-G4-B4, F4-A4-C5, G4-B4-D5, A4-C5-E5, B4-D5-F5,
 * C5-E5-G5 — eight triads, no descending tail.
 *
 * The triad on scale degree `d` is degrees `d`, `d+2`, `d+4`, read straight
 * off `noteAtDegree` (scales.ts), which already wraps degrees past the
 * octave into the next octave with correct spelling. Nothing here hardcodes
 * a key or a fixed semitone stack, which is what lets the triad on degree 7
 * come out diminished (in major, B-D-F: 3 and 6 semitones above the root)
 * without special-casing it — it falls straight out of the scale's own
 * spelling.
 *
 * Fingering is the root-position convention already used elsewhere in this
 * library for triads (`technique/library.ts`'s `RH_TRIAD_FINGERS`/
 * `LH_TRIAD_FINGERS`, inversion 0): right hand 1-3-5 bottom-to-top, left hand
 * 5-3-1. Every note gets a finger, and it never varies by degree or triad
 * quality — the syllabus test does not refinger the diminished triad.
 *
 * ## Tick layout (`triadSequenceNotes`)
 *
 * Two engraved forms, both starting at tick 0:
 *  - **broken**: the 24 notes played one after another as EIGHTH-NOTE TRIPLETS
 *    — three to a quarter, so one triad per beat. Each note is
 *    `TRIPLET_EIGHTH` (160 ticks) and carries a 3:2 `Tuplet`; onsets fall at
 *    0, 160, 320, … 3680; total span 3840 ticks (2 bars of 4/4).
 *
 *    The triplet is OUR engraving choice and is recorded as one. What the
 *    syllabus fixes is only what `runs/2026-08-20-1/syllabus.md` quotes
 *    verbatim from p. 9: "Triad Sequence / broken", "C major", "HS",
 *    "1 octave, ascending". It names no note value and no tempo for this row,
 *    and the earlier attempt at this drill was reverted partly for asserting
 *    that it did (1120597). So the note value is argued here, from the music:
 *
 *    A broken triad is three notes of ONE harmony. Three to a beat is what
 *    makes them read as a chord rather than as a three-note melodic figure,
 *    and it puts every triad root on a beat, which is the pulse the learner
 *    is counting. The alternative — straight eighths — was tried first and is
 *    worse on its own arithmetic: 24 eighths is 12 beats, so triads start at
 *    beats 0, 1.5, 3, 4.5 … and four of the eight begin off the beat; the
 *    drill also runs 12.0 s instead of 8.0 s, so a learner earning "Clean at
 *    60bpm" would be playing the pattern at an effective ♩=40. One triad per
 *    beat additionally means no triad straddles a barline, which straight
 *    eighths in 4/4 cannot avoid.
 *  - **solid**: the same 8 triads as blocks. Each block is a QUARTER note
 *    (480 ticks) followed by a quarter rest, so blocks start at ticks 0,
 *    960, 1920, … 6720; total span 7680 ticks (4 bars of 4/4). All three
 *    notes of a block share one `startTick`. The rests are not emitted as
 *    notes — the engraver fills tick gaps with rests on its own.
 *
 * Output is ordered by `startTick`, then bottom-to-top within a block —
 * both forms build their notes in that order already, so no extra sort is
 * needed.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { spell, toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { buildScale, noteAtDegree, type ScaleType } from '@core/theory/scales.ts'
import { makeScore, type Hand, type Score, type ScoreNoteInput, type Tuplet } from '@core/notation/score.ts'
import { QUARTER, TRIPLET_EIGHTH, WHOLE } from '@core/shared/units.ts'

export type TriadForm = 'broken' | 'solid'

/** One triad of the sequence: three ascending pitches, root position, one finger each. */
export type TriadSequenceStep = {
  /** Exactly 3, ascending in sounding pitch, root position. */
  readonly notes: readonly SpelledPitch[]
  /** Exactly 3, aligned with `notes` bottom-to-top. */
  readonly fingers: readonly number[]
}

/** How many triads a sequence has — one per scale degree, plus the closing octave. */
export const TRIAD_SEQUENCE_STEPS = 8

/** Notes per triad — always a root-position triad, never voiced any other way. */
const NOTES_PER_TRIAD = 3

/** Root-position fingering, bottom-to-top: thumb-middle-pinky for the right hand,
 * pinky-middle-thumb for the left — see the module doc comment. */
const RIGHT_HAND_FINGERS: readonly number[] = [1, 3, 5]
const LEFT_HAND_FINGERS: readonly number[] = [5, 3, 1]

/** Two scale degrees between each note of the stack — a third, letter-wise. */
const THIRD_STEP = 2

/** Three triplet eighths sound in the written time of two plain ones. */
const TRIPLET_RATIO = { actual: 3, normal: 2 } as const

/** Where note `i` of a triad sits in its triplet bracket — the group is always 3. */
function tripletPosition(i: number): Tuplet {
  const position = i === 0 ? 'start' : i === NOTES_PER_TRIAD - 1 ? 'stop' : 'inner'
  return { ...TRIPLET_RATIO, position }
}

/**
 * The eight root-position diatonic triads of `tonic`/`scaleType`, one per
 * degree, ascending one octave. `hand` selects the fingering only; it does
 * not transpose.
 */
export function triadSequenceSteps(
  tonic: SpelledPitch,
  scaleType: ScaleType,
  hand: Hand,
): readonly TriadSequenceStep[] {
  const scale = buildScale(tonic, scaleType)
  const fingers = hand === 'right' ? RIGHT_HAND_FINGERS : LEFT_HAND_FINGERS
  const steps: TriadSequenceStep[] = []
  for (let degree = 1; degree <= TRIAD_SEQUENCE_STEPS; degree++) {
    const notes = [
      noteAtDegree(scale, degree),
      noteAtDegree(scale, degree + THIRD_STEP),
      noteAtDegree(scale, degree + 2 * THIRD_STEP),
    ]
    steps.push({ notes, fingers })
  }
  return steps
}

/**
 * The whole drill as engravable, playable note inputs in ticks — see the
 * tick layout in the module doc comment.
 */
export function triadSequenceNotes(
  tonic: SpelledPitch,
  scaleType: ScaleType,
  hand: Hand,
  form: TriadForm,
): readonly ScoreNoteInput[] {
  const steps = triadSequenceSteps(tonic, scaleType, hand)
  const out: ScoreNoteInput[] = []
  if (form === 'broken') {
    let index = 0
    for (const step of steps) {
      step.notes.forEach((pitch, i) => {
        out.push({
          midi: toMidi(pitch),
          startTick: index * TRIPLET_EIGHTH,
          durationTicks: TRIPLET_EIGHTH,
          hand,
          fingering: at(step.fingers, i),
          spelling: pitch,
          tuplet: tripletPosition(i),
        })
        index += 1
      })
    }
    return out
  }
  // solid: one block per step, both quarter note and its trailing rest count
  // toward the next block's start (2 * QUARTER), but only the note itself —
  // never the rest — is emitted.
  steps.forEach((step, stepIndex) => {
    const startTick = stepIndex * 2 * QUARTER
    step.notes.forEach((pitch, i) => {
      out.push({
        midi: toMidi(pitch),
        startTick,
        durationTicks: QUARTER,
        hand,
        fingering: at(step.fingers, i),
        spelling: pitch,
      })
    })
  })
  return out
}

/** Total duration of the drill in ticks: broken 3840 (2 bars of 4/4), solid 7680 (4 bars). */
export function triadSequenceDurationTicks(form: TriadForm): number {
  if (form === 'broken') {
    // One triad per beat: three triplet eighths make exactly one QUARTER.
    return TRIAD_SEQUENCE_STEPS * QUARTER
  }
  invariant(form === 'solid', `triadSequenceDurationTicks: unknown form ${String(form)}`)
  return TRIAD_SEQUENCE_STEPS * 2 * QUARTER
}

/**
 * The triad sequence ascends a full octave, so a left hand starting on the
 * drill's own tonic would finish a fifth above middle C — a register no
 * Preparatory left hand plays in. The syllabus fixes the notes and the
 * direction ("C major", "HS", "1 octave, ascending") and says nothing about
 * register, so the left hand takes the pattern an octave down, where it sits
 * inside the bass staff instead of climbing out of it. This is NOT
 * `library.ts`'s `handTonic` two-octave hands-together offset: these drills
 * are hands separately only.
 */
const LEFT_OCTAVE_OFFSET = -1

/**
 * What `triadSequenceScore` needs to engrave one drill. Deliberately NOT a
 * `TechniqueDrill`: this module is imported BY `library.ts`, so taking the
 * drill type back would make the two mutually dependent for no gain.
 */
export type TriadSequenceScoreInput = {
  readonly id: string
  readonly title: string
  readonly tonic: SpelledPitch
  readonly scaleType: ScaleType
  readonly hand: Hand
  readonly form: TriadForm
  readonly bpm: number
  readonly keyFifths: number
}

/** The drill as an engravable, playable `Score` — the tick layout above, in bars. */
export function triadSequenceScore(input: TriadSequenceScoreInput): Score {
  const { tonic, hand, form } = input
  const start =
    hand === 'left'
      ? spell(tonic.letter, tonic.alter, tonic.octave + LEFT_OCTAVE_OFFSET)
      : tonic
  const notes = triadSequenceNotes(start, input.scaleType, hand, form)
  const measureCount = Math.ceil(triadSequenceDurationTicks(form) / WHOLE)
  const measures = Array.from({ length: measureCount }, (_, i) =>
    i === 0 ? { keyFifths: input.keyFifths } : {},
  )
  return makeScore({
    id: input.id,
    meta: { title: input.title },
    measures,
    notes: [...notes],
    tempos: [{ tick: 0, bpm: input.bpm }],
  })
}
