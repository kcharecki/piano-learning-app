/**
 * `ChordStaff` — engraves a chord as a real staff simultaneity (roadmap 5.50,
 * REQ-3.5.3/3.5.4's "see it on staff and keyboard"). Reuses the exact pipeline
 * `ScaleStaff` (roadmap 3.14) already built: turn core data into a `Score`,
 * hand it to `ExerciseScore` -> `ScoreViewer` -> `createOsmdEngraver({
 * presentation: 'reference' })`. Nothing here talks to OSMD directly.
 *
 * A chord is a single simultaneity — every tone shares `startTick: 0` and the
 * same `durationTicks`, which is what `musicxmlwriter.ts`'s `voiceStreamXml`
 * requires to mark every note after the first with `<chord/>` instead of
 * advancing the cursor (see that file's own comment on the `chord` flag).
 * Engraved as a single whole note filling one 4/4 measure — the reference is
 * read, not played, so there is no "right" shorter duration to pick, same
 * reasoning `ScaleStaff` gives for its own note values.
 *
 * ## Why `notes`/`title`, not a `Chord`
 *
 * This takes the already-built, already-ordered `notes: SpelledPitch[]` and a
 * `title` rather than a `@core/theory/chords.ts` `Chord`, because both call
 * sites need it for tone lists that are not always a `Chord`:
 *  - `ChordLookup` has a real `Chord` (`buildChord(root, quality, inversion)`)
 *    and passes `chord.notes` — already correctly voiced for the picked
 *    inversion (bass tone first).
 *  - `ChordScaleReference`'s `ScaleDegreeChords` (roadmap 3.15's fallback for
 *    scale types with no diatonic key — modes, pentatonics, blues, chromatic,
 *    whole tone) stacks tones directly off a `Scale`'s own degrees
 *    (`scaleDegreeStacks`), which is never a `Chord` at all: there is no key
 *    to read a `ChordQuality` against. Taking the caller's own tone order
 *    (never re-deriving it from a `Chord`) is what lets `ChordRow` — the
 *    presentational component both `DiatonicChords` and `ScaleDegreeChords`
 *    render through — pass the exact same `tones` it already computed for the
 *    keyboard diagram and the Play button straight through to this component
 *    too, one source of truth for what a row's chord actually is.
 *
 * ## Spelling
 *
 * Every tone carries its own `SpelledPitch` (`ScoreNote.spelling`, roadmap
 * 3.14a) through to the engraved output untouched — never re-derived from the
 * sounding MIDI number and a key signature, which cannot represent a written
 * chord like Db diminished 7th (Db Fb Abb Cbb: two double-flats) at all. The
 * measure's `keyFifths` is fixed at 0 (no key signature printed) rather than
 * inferred, on purpose: an arbitrary root x quality x inversion chord implies
 * no real major/minor key, so there is no honest signature to draw, and a
 * bare staff with every altered tone spelled out via its own explicit
 * accidental is exactly how a chord chart is engraved in real notation.
 * `ChordStaff.test.tsx` checks this directly for Db diminished 7th's two
 * double-flats.
 */
import { useMemo } from 'react'
import type { JSX } from 'react'
import { createOsmdEngraver } from '@app/score/osmdEngraver.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { makeScore, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { toMidi, type SpelledPitch } from '@core/theory/pitch.ts'

export type ChordStaffProps = {
  /** The chord's tones, sounding order (lowest first) — e.g. `chord.notes`
   *  from `buildChord`, or a raw scale-degree stack. Carries its own written
   *  spelling through unchanged; see the module doc. */
  readonly notes: readonly SpelledPitch[]
  /** Used for the score title and the region's accessible label, e.g. a
   *  chord symbol (`"Dbdim7"`) or a scale-degree stack's tone-name label. */
  readonly title: string
}

/** One measure, one beat: every tone at tick 0, filling the whole bar. */
const CHORD_DURATION_TICKS = TICKS_PER_QUARTER * 4

/**
 * The whole-note-chord `Score` for `notes`/`title` — exported so its exact
 * pitch content is unit-testable without mounting OSMD, mirroring
 * `ScaleStaff.ts`'s `buildScaleScore`. A single treble staff, right hand,
 * same as `ScaleStaff` — this reference has never engraved a grand staff.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure Score builder, not a component; exported for unit test
export function buildChordScore(notes: readonly SpelledPitch[], title: string): Score {
  const scoreNotes: ScoreNoteInput[] = notes.map((pitch) => ({
    midi: toMidi(pitch),
    spelling: pitch,
    startTick: 0,
    durationTicks: CHORD_DURATION_TICKS,
    hand: 'right',
  }))
  return makeScore({
    id: `chord-staff-${title}`,
    meta: { title },
    measures: [{ timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0 }],
    notes: scoreNotes,
    staves: [{ staff: 1, clef: 'treble', hand: 'right' }],
  })
}

/** See `ScaleStaff.tsx`'s identical `createReferenceEngraver` for why this is
 *  module-level (a stable engraver-factory identity across renders) and why
 *  `presentation: 'reference'` (read, not played: no cursor, no tempo mark,
 *  tight margins). */
const createReferenceEngraver = (): ReturnType<typeof createOsmdEngraver> =>
  createOsmdEngraver({ presentation: 'reference' })

/** Engraves a chord's tones as a real staff simultaneity. */
export function ChordStaff({ notes, title }: ChordStaffProps): JSX.Element {
  const score = useMemo(() => buildChordScore(notes, title), [notes, title])
  return (
    <div className="chord-staff" role="img" aria-label={`${title} staff notation`}>
      <ExerciseScore score={score} createEngraver={createReferenceEngraver} />
    </div>
  )
}
