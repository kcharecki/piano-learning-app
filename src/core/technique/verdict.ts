/**
 * Turning a technique run's raw match results into something that TEACHES
 * (roadmap T.12).
 *
 * `evennessOf` and the matcher's accuracy between them already knew a run had
 * gone wrong; the screen said "Evenness 88% — Not yet clean" and stopped, so a
 * learner who played all eight triads minor read the 88% as near-success and
 * had no way to find the wrong note. Naming it is the whole point of the drill:
 * accuracy is a score, a named note is a correction.
 *
 * This lives in core because deciding what a wrong note IS — which letter to
 * spell it with, which degree of the drill's own key it stands in for — is
 * music theory, not presentation. The screen renders the sentence; it does not
 * work out what to say.
 *
 * ## Spelling a note nobody wrote down
 *
 * The expected note usually carries its own written spelling (`ScoreNote.
 * spelling`); the played note is a bare MIDI number off a keyboard, so it has
 * none. Spelling it in isolation gets it wrong in the case that matters most:
 * `fromMidi(63)` is D#, but a learner flattening the third of a C major triad
 * played E-flat, and telling them they played "D#4 instead of E4" is a
 * different, more confusing sentence than "E♭4 instead of E4".
 *
 * So a played note within two semitones of the one expected is spelled as an
 * ALTERATION of it — same letter, adjusted accidental — which is what a
 * substitution actually is. Anything further away has no such relationship and
 * falls back to `fromMidi`. The letter-preserving spelling is still exact:
 * C♭4 sounds as B3, and that is the correct name for a flattened C4.
 */
import type { MatchResult } from '@core/practice/matcher.ts'
import { buildScale, degreeOf, type ScaleType } from '@core/theory/scales.ts'
import {
  fromMidi,
  pitchDisplayName,
  spell,
  toMidi,
  type Alter,
  type SpelledPitch,
} from '@core/theory/pitch.ts'
import type { Midi } from '@core/shared/units.ts'

/** One wrong-note substitution the learner made, and how often. */
export type TechniqueMistake = {
  readonly expectedMidi: Midi
  readonly playedMidi: Midi
  /** e.g. `E4` — the written spelling when the score carried one. */
  readonly expectedName: string
  /** e.g. `E♭4` — spelled as an alteration of the expected note where it is one. */
  readonly playedName: string
  /** 1-based degree of the EXPECTED pitch in the drill's key, or null when the
   *  expected pitch is not a member of that scale (a chromatic drill). */
  readonly degree: number | null
  /** How many times this exact substitution happened in the run. */
  readonly count: number
}

export type TechniqueDiagnosis = {
  /** Most frequent first; ties broken by where they first appear in the run. */
  readonly mistakes: readonly TechniqueMistake[]
  /** Expected notes never played at all. */
  readonly missed: number
  /** Notes played where none was expected. */
  readonly extra: number
}

/** The drill's key — enough to place a pitch on a degree. */
export type TechniqueKey = {
  readonly tonic: SpelledPitch
  readonly scaleType: ScaleType
}

/** How far a played note may sit from the expected one and still be named as
 *  an alteration of it. Two semitones covers every single- and double-flat or
 *  sharp substitution; beyond that the two notes are not the same note played
 *  wrong, they are different notes. */
const MAX_ALTERATION_SEMITONES = 2

function spellPlayed(playedMidi: Midi, expected: SpelledPitch): SpelledPitch {
  const delta = playedMidi - toMidi(expected)
  if (delta === 0 || Math.abs(delta) > MAX_ALTERATION_SEMITONES) return fromMidi(playedMidi)
  const alter = expected.alter + delta
  if (alter < -2 || alter > 2) return fromMidi(playedMidi)
  return spell(expected.letter, alter as Alter, expected.octave)
}

function expectedSpelling(result: MatchResult): SpelledPitch | undefined {
  const note = result.expected
  if (note === undefined) return undefined
  return note.spelling ?? fromMidi(note.midi)
}

/**
 * Every wrong-note substitution in a run, plus the plain counts of notes never
 * played and notes played that were not asked for.
 *
 * Only `wrongPitch` results carry both halves of a substitution, so those are
 * what get named; `missed` and `extra` are counted but not named, because
 * "you missed a note" and "you played an extra note" have no second pitch to
 * contrast against and reduce to the accuracy figure the screen already shows.
 */
export function diagnoseTechnique(
  results: readonly MatchResult[],
  key: TechniqueKey,
): TechniqueDiagnosis {
  const scale = buildScale(key.tonic, key.scaleType)
  const order: string[] = []
  const byPair = new Map<string, TechniqueMistake>()
  let missed = 0
  let extra = 0

  for (const result of results) {
    if (result.verdict === 'missed') {
      missed += 1
      continue
    }
    if (result.verdict === 'extra') {
      extra += 1
      continue
    }
    if (result.verdict !== 'wrongPitch') continue
    const expected = expectedSpelling(result)
    const playedMidi = result.playedMidi
    if (expected === undefined || playedMidi === undefined) continue

    const pairKey = `${String(toMidi(expected))}:${String(playedMidi)}`
    const seen = byPair.get(pairKey)
    if (seen !== undefined) {
      byPair.set(pairKey, { ...seen, count: seen.count + 1 })
      continue
    }
    order.push(pairKey)
    byPair.set(pairKey, {
      expectedMidi: toMidi(expected),
      playedMidi,
      expectedName: pitchDisplayName(expected),
      playedName: pitchDisplayName(spellPlayed(playedMidi, expected)),
      degree: degreeOf(scale, expected),
      count: 1,
    })
  }

  const mistakes = order
    .map((k) => byPair.get(k))
    .filter((m): m is TechniqueMistake => m !== undefined)
    .sort((a, b) => b.count - a.count)

  return { mistakes, missed, extra }
}

const ORDINALS: readonly string[] = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th']

/**
 * One sentence naming a mistake, in the terms the learner asked for: the
 * degree they were reaching for, the note that degree actually is, and the
 * note they played instead.
 */
export function describeTechniqueMistake(mistake: TechniqueMistake): string {
  const ordinal = mistake.degree === null ? undefined : ORDINALS[mistake.degree - 1]
  const target =
    ordinal === undefined ? mistake.expectedName : `the ${ordinal} (${mistake.expectedName})`
  const times = mistake.count === 1 ? '' : ` — ${String(mistake.count)} times`
  return `You played ${mistake.playedName} where ${target} belongs${times}.`
}
