/**
 * The graded repertoire list (REQ-3.8.1, REQ-5.2): 20 public-domain pieces
 * spanning levels 1–5, weighted toward the lower levels, so the repertoire
 * library (`@core/repertoire/repertoire.ts`) isn't empty on first run.
 *
 * Every entry carries a real `scoreId` (roadmap 5.1) resolved by
 * `gradedScoreFiles.ts` to a bundled, hand-authored `.musicxml` file under
 * `src/content/scores/` — parsed by `@core/notation/musicxml` at load, never
 * trusted, the same path a learner's own file import takes. See that file's
 * doc comment and `src/content/scores/LICENSE.md` for what each bundled score
 * is and is not: a faithful rendition of the named melody/theme in its stated
 * key, not a verified note-for-note transcription of a specific edition, and
 * for the four hardest classical excerpts (the two sonatinas whose exact
 * opening pitches no text source could confirm, the Burgmüller and the
 * Beethoven), a stylistically-faithful excerpt rather than a scholarly one —
 * flagged explicitly in LICENSE.md rather than presented as more certain
 * than it is.
 *
 * Imported by `@app/repertoire/useRepertoire.ts` (roadmap 4.9a), which renders
 * this list on the repertoire screen and adds an entry to the learner's own
 * library ONE AT A TIME, on request. It never seeds the library: the learner
 * curates their repertoire (REQ-3.8.x), and silently inserting 20 pieces they
 * did not choose would be worse than an empty list.
 *
 * Public domain, provenance recorded in `src/content/scores/LICENSE.md`
 * under "Graded repertoire list metadata". Every piece is either of anonymous
 * traditional/folk origin (no author, so no copyright) or by a composer who
 * died before 1900 — over 70 years before any jurisdiction's copyright term
 * on the composition itself could still be running.
 *
 * Levels are graded against requirements.md §2's ladder (playing / sight
 * reading / theory columns per level); each entry's `gradingNote` cites the
 * specific ladder cell(s) it was matched against, not an invented scale.
 */
import type { NewPieceInput } from '@core/repertoire/repertoire.ts'

export type GradedPiece = NewPieceInput & {
  /** Why this level, against requirements.md §2. One sentence. */
  readonly gradingNote: string
}

/** 20 public-domain pieces, ascending by level then title. */
export const GRADED_PIECES: readonly GradedPiece[] = [
  // ---------------------------------------------------------------------
  // Level 1 — Beginner: five-finger positions, hands separately, simple
  // hands-together; note names around middle C; quarter/half/whole notes.
  // ---------------------------------------------------------------------
  {
    id: 'au-clair-de-la-lune',
    scoreId: 'au-clair-de-la-lune',
    title: 'Au Clair de la Lune',
    composer: 'Traditional (French folk melody, 18th c., composer unknown)',
    level: 1,
    gradingNote:
      'Entirely stepwise five-finger melody in quarter and half notes — matches level 1 "five-finger positions... simple hands-together" and "quarter/half/whole notes".',
  },
  {
    id: 'hot-cross-buns',
    scoreId: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    composer: 'Traditional (English street-vendor cry, composer unknown)',
    level: 1,
    gradingNote:
      "Three-note five-finger melody, quarter notes only — the canonical first five-finger-position piece in level 1's playing column.",
  },
  {
    id: 'london-bridge-is-falling-down',
    scoreId: 'london-bridge-is-falling-down',
    title: 'London Bridge Is Falling Down',
    composer: 'Traditional (English nursery rhyme, composer unknown)',
    level: 1,
    gradingNote:
      'Stepwise five-finger melody around middle C with simple quarter/half rhythm — level 1 "note names... around middle C, quarter/half/whole notes".',
  },
  {
    id: 'mary-had-a-little-lamb',
    scoreId: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional (American nursery rhyme, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger-position melody, hands separately, quarter notes throughout — textbook level 1 playing-column fit.',
  },
  {
    id: 'merrily-we-roll-along',
    scoreId: 'merrily-we-roll-along',
    title: 'Merrily We Roll Along',
    composer: 'Traditional (American folk song, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger stepwise-plus-skip melody, quarter/half notes, simple hands-together phrase at the cadence — still level 1, no eighth notes or key-signature demands.',
  },
  {
    id: 'ode-to-joy-theme',
    scoreId: 'ode-to-joy-theme',
    title: 'Ode to Joy (Theme)',
    composer: 'Ludwig van Beethoven (1770–1827)',
    level: 1,
    gradingNote:
      'The unadorned melodic theme (as universally published in beginner method books, not the full symphonic setting): five-finger stepwise motion with one small skip, quarter/half notes — level 1, and the "easy classics" half of REQ-3.8.1\'s level-1-2 guidance.',
  },

  // ---------------------------------------------------------------------
  // Level 2 — Elementary: simple pieces hands together, legato/staccato,
  // basic dynamics; one-octave range each hand, eighth notes, 0–1
  // sharps/flats; theory: major scales C/G/F, tonic/dominant, up to a 5th.
  // ---------------------------------------------------------------------
  {
    id: 'amazing-grace',
    scoreId: 'amazing-grace',
    title: 'Amazing Grace',
    composer:
      'Traditional (tune "New Britain", American folk hymn, first printed in Walker\'s Southern Harmony, 1835; composer unknown)',
    level: 2,
    gradingNote:
      "Simple hands-together hymn texture with room for legato phrasing and dynamic shaping, one-octave range, harmony sitting on tonic/dominant — level 2's playing and theory columns.",
  },
  {
    id: 'long-long-ago',
    scoreId: 'long-long-ago',
    title: 'Long, Long Ago',
    composer: 'Thomas Haynes Bayly (1797–1839)',
    level: 2,
    gradingNote:
      'Gentle legato hands-together parlor song with eighth-note pickups and simple tonic-dominant harmony — level 2\'s "legato... basic dynamics" and "tonic and dominant chords".',
  },
  {
    id: 'minuet-in-g-major-bwv-anh-114',
    scoreId: 'minuet-in-g-major-bwv-anh-114',
    title: 'Minuet in G major, BWV Anh. 114',
    composer: 'Attrib. Christian Petzold (1677–1733); from the Notebook for Anna Magdalena Bach',
    level: 2,
    gradingNote:
      'Key of G major (1 sharp), hands together throughout, mostly stepwise with some eighth-note motion within an octave — level 2\'s "simple key signatures (0–1 sharps/flats)" and "major scales C/G/F".',
  },
  {
    id: 'scarborough-fair',
    scoreId: 'scarborough-fair',
    title: 'Scarborough Fair',
    composer: 'Traditional (English ballad, composer unknown)',
    level: 2,
    gradingNote:
      'Legato modal melody, hands together, one-octave range with a simple block-chord accompaniment — level 2\'s "legato... basic dynamics" playing column.',
  },
  {
    id: 'skip-to-my-lou',
    scoreId: 'skip-to-my-lou',
    title: 'Skip to My Lou',
    composer: 'Traditional (American play-party song, composer unknown)',
    level: 2,
    gradingNote:
      'Hands-together folk song with eighth-note pairs on the refrain and verse/chorus dynamic contrast, one-octave range each hand — level 2.',
  },

  // ---------------------------------------------------------------------
  // Level 3 — Late elementary: scales hands together (2 octaves), broken
  // chords, pedal basics; keys to 2 sharps/flats, dotted rhythms, two-hand
  // coordination; theory: all intervals, triads + inversions, relative minors.
  // ---------------------------------------------------------------------
  {
    id: 'fur-elise-theme',
    scoreId: 'fur-elise-theme',
    title: 'Für Elise (Theme A)',
    composer: 'Ludwig van Beethoven (1770–1827)',
    level: 3,
    gradingNote:
      'The opening A section only (not the full rondo): alternating broken-chord left hand under a stepwise right-hand melody in A minor — level 3\'s "broken chords" and "relative minors", two-hand coordination without the later sections\' wider leaps.',
  },
  {
    id: 'greensleeves',
    scoreId: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional (English, composer unknown, first printed 16th c.)',
    level: 3,
    gradingNote:
      'Natural-minor folk melody in simple triple meter, phrased across a two-octave range with hands-together dotted-rhythm accompaniment — level 3\'s "relative minors" and "dotted rhythms".',
  },

  // ---------------------------------------------------------------------
  // Level 4 — Intermediate: all major scales, arpeggios, easier sonatinas,
  // voicing melody over accompaniment; keys to 4 accidentals, 6/8, syncopation,
  // leaps/position shifts; theory: seventh chords, primary progressions,
  // cadence types, minor scale forms.
  // ---------------------------------------------------------------------
  {
    id: 'burgmuller-arabesque-op-100-no-2',
    scoreId: 'burgmuller-arabesque-op-100-no-2',
    title: 'Arabesque, Op. 100 No. 2',
    composer: 'Friedrich Burgmüller (1806–1874)',
    level: 4,
    gradingNote:
      'Continuous sixteenth-note passagework requiring position shifts and finger independence between melody and accompaniment fragments — level 4\'s "voicing melody over accompaniment" and "leaps and position shifts", a standard progressing-intermediate study.',
  },
  {
    id: 'bach-prelude-in-c-major-bwv-846',
    scoreId: 'bach-prelude-in-c-major-bwv-846',
    title: 'Prelude in C major, BWV 846',
    composer: 'Johann Sebastian Bach (1685–1750)',
    level: 4,
    gradingNote:
      'Continuous arpeggiated broken chords in both hands outlining a I–IV–V–I-and-beyond harmonic progression bar by bar, with sustained voicing/pedal control across the whole piece — level 4\'s "arpeggios" and "primary progressions (I–IV–V–I, ii–V–I)".',
  },
  {
    id: 'kuhlau-sonatina-op-20-no-1',
    scoreId: 'kuhlau-sonatina-op-20-no-1',
    title: 'Sonatina in C major, Op. 20 No. 1 (1st movement)',
    composer: 'Friedrich Kuhlau (1786–1832)',
    level: 4,
    gradingNote:
      'Alberti-bass broken-chord left hand under a scalar right-hand melody in C major, requiring genuine two-hand coordination at tempo — level 4\'s "easier sonatinas" playing-column example, named alongside Clementi sonatinas in requirements.md §1.3.',
  },
  {
    id: 'clementi-sonatina-op-36-no-1',
    scoreId: 'clementi-sonatina-op-36-no-1',
    title: 'Sonatina in C major, Op. 36 No. 1 (1st movement)',
    composer: 'Muzio Clementi (1752–1832)',
    level: 4,
    gradingNote:
      'The archetypal easier sonatina: Alberti-bass accompaniment, scale-run passages, and hands-together coordination in C major — level 4\'s "easier sonatinas" playing-column example, per requirements.md §1.3.',
  },
  {
    id: 'beethoven-sonatina-op-49-no-1',
    scoreId: 'beethoven-sonatina-op-49-no-1',
    title: 'Sonatina in G minor, Op. 49 No. 1 (1st movement)',
    composer: 'Ludwig van Beethoven (1770–1827)',
    level: 4,
    gradingNote:
      'Full sonata-allegro form in a minor key with syncopated accompaniment figures and wider leaps than the Kuhlau/Clementi sonatinas at the bottom of this level — level 4\'s "easier sonatinas", "syncopation" and "minor scale forms".',
  },

  // ---------------------------------------------------------------------
  // Level 5 — Upper-intermediate: harmonic/melodic minors, faster tempi,
  // ornaments, polyphony (inventions), rubato basics; theory: secondary
  // dominants, modulation to close keys, Roman-numeral analysis.
  // ---------------------------------------------------------------------
  {
    id: 'bach-invention-no-1-bwv-772',
    scoreId: 'bach-invention-no-1-bwv-772',
    title: 'Invention No. 1 in C major, BWV 772',
    composer: 'Johann Sebastian Bach (1685–1750)',
    level: 5,
    gradingNote:
      'Two-voice invertible counterpoint with independent hands trading the same subject — level 5\'s "polyphony (inventions)" bullet by name, matching REQ-3.8.1\'s own level-5 example.',
  },
  {
    id: 'chopin-prelude-op-28-no-4',
    scoreId: 'chopin-prelude-op-28-no-4',
    title: 'Prelude in E minor, Op. 28 No. 4',
    composer: 'Frédéric Chopin (1810–1849)',
    level: 5,
    gradingNote:
      'Chromatic, sighing chordal accompaniment under a rubato-dependent singing melody, moving through secondary dominants toward the relative major before returning — level 5\'s "rubato basics" and "secondary dominants, modulation to close keys", and REQ-3.8.1\'s own "easier Chopin... pieces at level 5" example.',
  },
]
