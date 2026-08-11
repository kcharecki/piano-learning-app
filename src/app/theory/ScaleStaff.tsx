/**
 * `ScaleStaff` — engraves the currently looked-up scale as real staff
 * notation (roadmap 3.14, REQ-3.5.3/3.5.4's "see it on staff and keyboard").
 * One octave ascending, quarter notes, a single treble staff, reusing the
 * exact OSMD pipeline `ExerciseScore` already drives for the Technique
 * screen (`src/app/technique/TechniqueScreen.tsx`) — this file only turns a
 * root + `ScaleType` into a `Score`; it never touches the engraver.
 *
 * ## Key signature
 *
 * Scale types that map onto a real major or (natural) minor key — major,
 * ionian, naturalMinor, aeolian, harmonicMinor, melodicMinor — are engraved
 * with THAT key's own signature. Harmonic and melodic minor's raised
 * degrees are written as accidentals against the *natural*-minor signature
 * (standard notation practice — nobody prints a distinct "harmonic minor"
 * key signature; see `harmony.ts`/`ChordScaleReference.tsx`'s
 * `RAISED_SEVENTH_SCALE_TYPES` for the same convention applied to chords).
 *
 * The five remaining diatonic modes (dorian, phrygian, lydian, mixolydian,
 * locrian) are engraved under their **parent major key's** signature — the
 * standard convention (D dorian -> C major's 0 sharps, Bb dorian -> Ab
 * major's 4 flats) — because it is also the only choice that makes
 * `musicxmlwriter.ts`'s `preferFlats` (derived solely from `keyFifths < 0`)
 * come out with the right sign for the scale's own spelling; fifths = 0
 * forces every accidental to print as a sharp, which is simply wrong for a
 * flat scale (see the roadmap 3.14 review). The parent major's fifths is
 * plain circle-of-fifths arithmetic on the tonic (no key lookup needed,
 * since the parent tonic itself is never engraved) via `rawMajorFifths` +
 * a fixed per-mode offset (`MODAL_FIFTHS_OFFSET`).
 *
 * The remaining scale types (pentatonics, blues, chromatic, whole tone)
 * still have no settled key-signature convention at all, so there is no
 * "parent major" to borrow. For these, `keyFifths` is chosen purely to get
 * `preferFlats` right: **-1** if any of the scale's own spelled degrees
 * carries a flat, **0** otherwise. -1 is not a real one-flat key signature
 * that gets rendered (`accidentalsOf`/the note-level accidentals still
 * print explicitly on every degree that needs one) — it exists solely to
 * flip `preferFlats` to `true` so `fromMidi` picks flat spellings instead
 * of sharp ones.
 *
 * ## Spelling
 *
 * `scaleNotes` (`@core/theory/scales.ts`) spells each degree correctly —
 * including cases like F# major's leading tone E# ("the letter that many
 * steps up, carrying whatever accidental makes the semitone count come out
 * right", never "the nearest convenient enharmonic": see that file's module
 * doc). That `SpelledPitch` is carried straight onto each `ScoreNote` as
 * `spelling` (roadmap 3.14a), so `musicxmlwriter.ts`'s `pitchXml` engraves it
 * as written — E#/B#/Cb/Fb included — instead of re-deriving a spelling from
 * the sounding midi number and the measure's single sharps-vs-flats bit,
 * which cannot represent either. `ScaleStaff.test.tsx` checks both: every
 * note sounds exactly what `scaleNotes` said, and — for F# major and G
 * harmonic minor, the two cases that used to mis-spell — the engraved
 * `<step>`/`<alter>` match `scaleNotes`' spelling too.
 */
import { useMemo } from 'react'
import type { JSX } from 'react'
import { createOsmdEngraver } from '@app/score/osmdEngraver.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { makeScore, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { keyOf, SHARP_ORDER, type Mode } from '@core/theory/keys.ts'
import { toMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { buildScale, scaleName, scaleNotes, type ScaleType } from '@core/theory/scales.ts'

export type ScaleStaffProps = {
  readonly root: SpelledPitch
  readonly scaleType: ScaleType
}

/** Scale types with a real major/natural-minor key, and which mode each implies. */
const KEYED_SCALE_MODE: Readonly<Partial<Record<ScaleType, Mode>>> = {
  major: 'major',
  ionian: 'major',
  naturalMinor: 'minor',
  aeolian: 'minor',
  harmonicMinor: 'minor',
  melodicMinor: 'minor',
}

/**
 * Fifths added to a mode's tonic's own (unclamped) major-key fifths to reach
 * its parent major scale's fifths — e.g. dorian is the parent major's 2nd
 * degree, so its tonic sits 2 fifths above the parent: subtract 2 to go back.
 * Standard modal-degree arithmetic; see the module doc's "Key signature"
 * section.
 */
const MODAL_FIFTHS_OFFSET: Readonly<Partial<Record<ScaleType, number>>> = {
  dorian: -2,
  phrygian: -4,
  lydian: 1,
  mixolydian: -1,
  locrian: -5,
}

/**
 * Fifths of the *major* key with this tonic, without `keyOf`'s -7..7 range
 * check — a mode's tonic can lie outside that range even when its parent
 * major (tonic + offset) does not, e.g. G# dorian's parent is F# major. Only
 * used as an intermediate value for `MODAL_FIFTHS_OFFSET` arithmetic; the
 * result is never itself engraved as a signature.
 */
function rawMajorFifths(root: SpelledPitch): number {
  return SHARP_ORDER.indexOf(root.letter) - 1 + 7 * root.alter
}

const MAX_WRITABLE_FIFTHS = 7

/** The key signature to engrave — see the module doc's "Key signature" section. */
function keyFifthsFor(root: SpelledPitch, scaleType: ScaleType, pitches: readonly SpelledPitch[]): number {
  const mode = KEYED_SCALE_MODE[scaleType]
  if (mode !== undefined) {
    const key = keyOf(root, mode)
    return key.ok ? key.value.signature.fifths : 0
  }
  const modalOffset = MODAL_FIFTHS_OFFSET[scaleType]
  if (modalOffset !== undefined) {
    const fifths = rawMajorFifths(root) + modalOffset
    return Math.abs(fifths) <= MAX_WRITABLE_FIFTHS ? fifths : 0
  }
  const wantsFlats = pitches.some((p) => p.alter < 0)
  return wantsFlats ? -1 : 0
}

/**
 * The one-octave-ascending `Score` for `root`/`scaleType` — exported so its
 * exact pitch content is unit-testable without mounting OSMD. Quarter
 * notes; a single measure sized to the scale's own note count (scales have
 * no natural barline structure, so there is no "right" place to split one
 * across bars); one treble staff, right hand.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure Score builder, not a component; exported for unit test
export function buildScaleScore(root: SpelledPitch, scaleType: ScaleType): Score {
  const pitches = scaleNotes(root, scaleType, 1)
  const keyFifths = keyFifthsFor(root, scaleType, pitches)
  const notes: ScoreNoteInput[] = pitches.map((pitch, i) => ({
    midi: toMidi(pitch),
    spelling: pitch,
    startTick: i * TICKS_PER_QUARTER,
    durationTicks: TICKS_PER_QUARTER,
    hand: 'right',
  }))
  return makeScore({
    id: `scale-staff-${root.letter}${root.alter}${root.octave}-${scaleType}`,
    meta: { title: scaleName(buildScale(root, scaleType)) },
    measures: [{ timeSignature: { beats: pitches.length, beatType: 4 }, keyFifths }],
    notes,
    staves: [{ staff: 1, clef: 'treble', hand: 'right' }],
  })
}

/**
 * This scale is READ, not played: no playback cursor parked on its first note,
 * no `♩= 120` above a scale that has no tempo, no engraved title duplicating
 * the heading the reference already shows, and tight page margins so eight
 * quarter notes do not sit in a page of empty paper. See `ScorePresentation`
 * in `osmdEngraver.ts`. Module-level so its identity is stable across renders
 * — `ScoreViewer` re-engraves whenever its engraver factory changes.
 */
const createReferenceEngraver = (): ReturnType<typeof createOsmdEngraver> =>
  createOsmdEngraver({ presentation: 'reference' })

/** Engraves the looked-up scale next to the reference's keyboard diagram. */
export function ScaleStaff({ root, scaleType }: ScaleStaffProps): JSX.Element {
  const score = useMemo(() => buildScaleScore(root, scaleType), [root, scaleType])
  return (
    <div className="scale-staff" role="img" aria-label={`${score.meta.title} staff notation`}>
      <ExerciseScore score={score} createEngraver={createReferenceEngraver} />
    </div>
  )
}
