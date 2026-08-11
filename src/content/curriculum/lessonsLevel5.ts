/**
 * Level 5 (Early Advanced) lessons — roadmap 3.24, REQ-3.5.1: the remaining
 * three of the six harmony topics that had no authored lesson at any level
 * (see `lessonsLevel4.ts` for seventh chords, cadences and the common
 * progressions; this file covers the minor scale forms, secondary dominants,
 * and modulation to closely related keys).
 *
 * Same authoring discipline as `lessonsLevel4.ts`: every quiz opens a real
 * `TheoryQuizKind`/`FlashcardKind` deck at a level that genuinely contains
 * what the title names, nothing here restates `@core/theory` by hand, and
 * every lesson carries a STAFF diagram (roadmap 3.25).
 */
import type { Exercise, Lesson } from '@core/curriculum/types.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import type { FlashcardKind } from '@core/drills/flashcards.ts'
import type { TheoryQuizKind } from '@core/drills/theory.ts'

function demo(id: string): string {
  if (demoScoreById(id) === undefined) {
    throw new Error(`lessonsLevel5: unknown demo score '${id}'`)
  }
  return id
}

function theoryQuizEx(
  id: string,
  title: string,
  drillKind: FlashcardKind | TheoryQuizKind,
  drillLevel: number,
  minutes = 8,
): Exercise {
  return { id, kind: 'theory-quiz', title, estimatedMinutes: minutes, params: { drillKind, drillLevel } }
}

function playEx(id: string, title: string, minutes = 8): Exercise {
  return { id, kind: 'play', title, estimatedMinutes: minutes }
}

const U_ADVANCED = 'l5-u1-minor-forms-secondary-modulation'

export const LEVEL_5_LESSONS: readonly Lesson[] = [
  {
    id: 'l5-minor-scale-forms',
    unitId: U_ADVANCED,
    track: 'theory',
    title: 'The Three Minor Scale Forms',
    explanation:
      'Natural minor is the plain relative-minor scale — the same key signature as its relative ' +
      'major, no added accidentals. Harmonic minor raises the 7th degree by a semitone (in A minor, ' +
      'G becomes G#), so the v chord becomes a proper major V and the music gets a real leading tone ' +
      'to resolve to the tonic. Melodic minor raises BOTH the 6th and 7th when ascending (F and G ' +
      'become F# and G#), to smooth out the awkward step-and-a-half gap harmonic minor leaves between ' +
      "the 6th and 7th degrees — then traditionally falls back to the plain natural-minor spelling " +
      "when descending.\n\n" +
      "Play all three forms of A minor back to back, ascending, and listen for exactly where each " +
      'one departs from natural minor: nowhere, the 7th only, or both the 6th and 7th.\n\n' +
      '[diagram:staff-minor-scale-forms]',
    // No demo plays a minor scale directly (the closest existing content is
    // the C major / A minor relative-key triad demo — raised as a gap, not
    // fixed here, since src/content/scores/demoScores.ts belongs to another
    // task).
    demoScoreId: demo('demo-c-major-and-a-minor-triads'),
    exercises: [
      // SCALE_TYPES_BY_LEVEL[3] (level 4) is the first tier that includes
      // ALL FOUR scale types this quiz can then draw — melodicMinor only
      // joins at level 4 (core/drills/theory.ts). Major stays in the pool
      // too; the title names it honestly rather than implying the deck only
      // ever draws a minor scale.
      theoryQuizEx(
        'l5-minor-scale-forms-ex1',
        'Quiz: play a major, natural minor, harmonic minor or melodic minor scale, ascending',
        'build-scale',
        4,
      ),
      playEx('l5-minor-scale-forms-ex2', 'Play A natural, harmonic and melodic minor, ascending, back to back', 6),
    ],
  },
  {
    id: 'l5-secondary-dominants',
    unitId: U_ADVANCED,
    track: 'theory',
    title: 'Secondary Dominants',
    explanation:
      'A secondary (or "applied") dominant borrows the V-I pull and points it at a chord other than ' +
      'the tonic: V/V is the dominant OF the dominant — in C major, that is D major (not diatonic to ' +
      "C) resolving to G. It works because ANY major or minor triad can briefly be treated as its own " +
      "temporary tonic, tonicised by ITS OWN dominant a fifth above it, before the music returns to " +
      "the home key.\n\n" +
      'Play V/V-V-I in C major (D major, then G major, then C major) and listen for the extra push ' +
      'the borrowed D major chord adds — it makes the arrival on G sound like a small destination of ' +
      "its own, not just another stop along the way to C.\n\n" +
      '[diagram:staff-secondary-dominant]',
    // No demo isolates a secondary dominant (a real gap — flagged, not
    // fixed here). The I-V-I demo is the closest on-topic content: the same
    // dominant-to-tonic relationship this lesson relocates onto a
    // non-tonic target.
    demoScoreId: demo('demo-i-v-i-c-major'),
    exercises: [
      // No quiz kind tests the APPLIED relationship (which chord is being
      // tonicised) directly — `build-chord` tests the actual skill a
      // secondary dominant needs: constructing the major/dominant-7th chord
      // shape on demand, on whatever root the applied-dominant relationship
      // calls for. Level 4 is the widest tier (every quality and inversion
      // build-chord offers), so the title stays general rather than
      // claiming a narrower pool than the deck actually draws from.
      theoryQuizEx(
        'l5-secondary-dominants-ex1',
        'Quiz: build a chord on the keyboard (secondary dominants use the same major/dominant-7th shapes, just on a different root)',
        'build-chord',
        4,
      ),
      playEx('l5-secondary-dominants-ex2', 'Play V/V-V-I (D major, G major, C major) in the key of C', 6),
    ],
  },
  {
    id: 'l5-modulation-closely-related-keys',
    unitId: U_ADVANCED,
    track: 'theory',
    title: 'Modulation to Closely Related Keys',
    explanation:
      'Modulation is a piece changing its home key partway through. The easiest modulations move to a ' +
      "closely related key — one whose key signature differs by at most one sharp or flat, such as " +
      'the dominant (C major to G major) or the subdominant (C major to F major) — because a chord ' +
      'that is diatonic in the first key is very often ALSO diatonic in the second, giving the music a ' +
      'shared "pivot" chord to modulate through without a jarring jump.\n\n' +
      'Play a short phrase in C major that ends on its V chord (G major), then continue as though G ' +
      'were the new I: that single reinterpreted chord — the same notes, a different function — is a ' +
      "pivot modulation, and it is exactly why closely related keys are the easiest place to start.\n\n" +
      '[diagram:staff-modulation-c-to-g]',
    // No demo modulates mid-score with a genuine key-signature change on a
    // progression (a real gap — flagged, not fixed here). The circle-of-
    // fifths demo is the closest on-topic content: it already plays the
    // exact neighbouring keys (C, then G, then F) this lesson calls
    // "closely related".
    demoScoreId: demo('demo-circle-of-fifths-c-g-f'),
    exercises: [
      // No quiz kind tests modulation directly. `name-key-signature` tests
      // the prerequisite skill this lesson depends on: recognising a
      // closely related key's own signature. fifthsRangeForLevel(2) = 1, so
      // level 2 draws only fifths -1..1 (F, C, G) — exactly the "one sharp
      // or flat away" closely-related-key range this lesson is about, never
      // straying into a distantly related key the deck could draw at a
      // higher level.
      theoryQuizEx(
        'l5-modulation-closely-related-keys-ex1',
        "Quiz: name a key's signature by playing its tonic (one sharp or flat away — the closely related keys)",
        'name-key-signature',
        2,
      ),
      playEx(
        'l5-modulation-closely-related-keys-ex2',
        'Play a phrase in C major ending on V, then continue as though G were the new I',
        6,
      ),
    ],
  },
]
