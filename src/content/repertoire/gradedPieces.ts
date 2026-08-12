/**
 * The graded repertoire list (REQ-3.8.1, REQ-5.2): 40 public-domain pieces
 * spanning levels 1–5, weighted toward the lower levels (roadmap 5.3 widened
 * the original 20 toward Elissa Milne's "40 Piece Challenge" shape — mass
 * below the learner's level, not at it — by adding 20 more level 1–2 pieces),
 * so the repertoire library (`@core/repertoire/repertoire.ts`) isn't empty on
 * first run and a below-level learner has real options to choose from.
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
 *
 * Roadmap 5.52: `LICENSE.md` was always candid about what each bundled file
 * actually is — a source-verified transcription, a confirmed-shape rendition,
 * a stylistic excerpt, or this app's own from-memory rendition — but none of
 * that reached the learner: the Repertoire row showed only title/composer/
 * level. `provenance` (below) makes that ledger a real, per-piece field
 * instead of prose only a maintainer reads. Every value here is transcribed
 * FROM `LICENSE.md`'s own classification of the piece, never invented and
 * never upgraded past what LICENSE.md claims — where LICENSE.md groups a
 * piece as "this app's own rendition, not confirmed against an external
 * written source this session", `provenance.tier` is `'own-rendition'`, full
 * stop.
 */
import type { NewPieceInput } from '@core/repertoire/repertoire.ts'

/**
 * Four provenance classes, exactly matching `LICENSE.md`'s own groupings —
 * ordered here from strongest to weakest evidential claim:
 *
 * - `source-verified` — melody checked against a named written source
 *   (Wikipedia, IMSLP, a hymn-tune archive, or a letter-note transcription
 *   site) before transcribing.
 * - `confirmed-contour` — key/mode and general melodic shape confirmed
 *   against a source, but not the exact historical note sequence (no text
 *   source gives one); this app's own plausible rendition within that
 *   confirmed shape.
 * - `stylistic-excerpt` — only harmonic/textural facts (chord alternation,
 *   cadence shape, register, device) are confirmed; the exact opening
 *   pitches are explicitly NOT recoverable from any source checked. A short
 *   excerpt genuinely in the composer's idiom and era, but not a verified
 *   transcription of the actual notes.
 * - `own-rendition` — transcribed from memory of a tune with a single,
 *   widely-taught melody; attempted but not checked against an external
 *   written source this session.
 */
export type ProvenanceTier = 'source-verified' | 'confirmed-contour' | 'stylistic-excerpt' | 'own-rendition'

export type PieceProvenance = {
  readonly tier: ProvenanceTier
  /**
   * Present ONLY when this bundled file is a partial excerpt of a larger
   * work (an opening section, a chorus-only setting, a handful of bars) —
   * states what portion is bundled and what is not, per LICENSE.md/this
   * file's own `gradingNote`s. Absent means the file is the full remembered
   * tune, not a partial extract of a longer piece.
   */
  readonly excerptNote?: string
}

/** Learner-facing label for each tier — rendered on the Repertoire catalogue
 *  row and the Practice heading (roadmap 5.52). Sentence case, no internal
 *  vocabulary, honest without being alarming: DESIGN.md's "learner language"
 *  screen rule applies to this text same as any other. */
export const PROVENANCE_LABELS: Readonly<Record<ProvenanceTier, string>> = {
  'source-verified': 'Source-verified transcription',
  'confirmed-contour': 'Confirmed melody shape, not note-verified',
  'stylistic-excerpt': 'Stylistic excerpt, not a verified transcription',
  'own-rendition': "This app's own rendition, not source-verified",
}

export type GradedPiece = NewPieceInput & {
  /** Why this level, against requirements.md §2. One sentence. */
  readonly gradingNote: string
  /**
   * What this bundled file actually is, per `src/content/scores/LICENSE.md`
   * (roadmap 5.52). Required on every entry — see `gradedPieces.test.ts`'s
   * "every graded piece discloses its provenance" test, which fails the
   * build if any entry omits it.
   */
  readonly provenance: PieceProvenance
}

const STYLISTIC_EXCERPT_NOTE =
  'Short excerpt (2–6 bars) in the confirmed key, meter and device — the exact opening pitches are not recoverable from any source checked.'

/** 40 public-domain pieces, ascending by level then title. */
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
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'frere-jacques',
    scoreId: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditional (French folk round, composer unknown)',
    level: 1,
    gradingNote:
      'Repeated stepwise five-finger motif with hands separately and a brief eighth-note turn — level 1 "five-finger positions... quarter/half/whole notes", roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'hot-cross-buns',
    scoreId: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    composer: 'Traditional (English street-vendor cry, composer unknown)',
    level: 1,
    gradingNote:
      "Three-note five-finger melody, quarter notes only — the canonical first five-finger-position piece in level 1's playing column.",
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'jolly-old-saint-nicholas',
    scoreId: 'jolly-old-saint-nicholas',
    title: 'Jolly Old Saint Nicholas',
    composer: 'Traditional (American, 19th c., composer unknown)',
    level: 1,
    gradingNote:
      'Stepwise five-finger melody, hands separately, quarter/half notes throughout — the exact level 1 shape method books use it for, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'lightly-row',
    scoreId: 'lightly-row',
    title: 'Lightly Row',
    composer: 'Traditional (German folk melody "Hänschen klein", composer unknown)',
    level: 1,
    gradingNote:
      'The canonical five-finger-position teaching tune (mi-re-do-re-mi), quarter/half notes, hands separately — level 1, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'london-bridge-is-falling-down',
    scoreId: 'london-bridge-is-falling-down',
    title: 'London Bridge Is Falling Down',
    composer: 'Traditional (English nursery rhyme, composer unknown)',
    level: 1,
    gradingNote:
      'Stepwise five-finger melody around middle C with simple quarter/half rhythm — level 1 "note names... around middle C, quarter/half/whole notes".',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'mary-had-a-little-lamb',
    scoreId: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional (American nursery rhyme, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger-position melody, hands separately, quarter notes throughout — textbook level 1 playing-column fit.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'merrily-we-roll-along',
    scoreId: 'merrily-we-roll-along',
    title: 'Merrily We Roll Along',
    composer: 'Traditional (American folk song, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger stepwise-plus-skip melody, quarter/half notes, simple hands-together phrase at the cadence — still level 1, no eighth notes or key-signature demands.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'ode-to-joy-theme',
    scoreId: 'ode-to-joy-theme',
    title: 'Ode to Joy (Theme)',
    composer: 'Ludwig van Beethoven (1770–1827)',
    level: 1,
    gradingNote:
      'The unadorned melodic theme (as universally published in beginner method books, not the full symphonic setting): five-finger stepwise motion with one small skip, quarter/half notes — level 1, and the "easy classics" half of REQ-3.8.1\'s level-1-2 guidance.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'old-macdonald-had-a-farm',
    scoreId: 'old-macdonald-had-a-farm',
    title: 'Old MacDonald Had a Farm',
    composer: 'Traditional (American folk song, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger melody built from repeated scale steps, hands separately, quarter/half notes — level 1 "note names around middle C", roadmap 5.3.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'rain-rain-go-away',
    scoreId: 'rain-rain-go-away',
    title: 'Rain, Rain, Go Away',
    composer: 'Traditional (English/American nursery rhyme, composer unknown)',
    level: 1,
    gradingNote:
      'Three-note (mi-re-do) five-finger chant in quarter notes, hands separately — the simplest tier of level 1\'s playing column, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'ring-around-the-rosie',
    scoreId: 'ring-around-the-rosie',
    title: 'Ring Around the Rosie',
    composer: 'Traditional (English/American nursery rhyme, composer unknown)',
    level: 1,
    gradingNote:
      'Three-note (mi-re-do) five-finger chant, quarter and whole notes, hands separately — level 1, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'row-row-row-your-boat',
    scoreId: 'row-row-row-your-boat',
    title: 'Row, Row, Row Your Boat',
    composer: 'Traditional (American folk round, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger stepwise-plus-skip melody reaching one note above the octave at its "merrily" peak, quarter/half notes — level 1, roadmap 5.3.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'the-farmer-in-the-dell',
    scoreId: 'the-farmer-in-the-dell',
    title: 'The Farmer in the Dell',
    composer: 'Traditional (German/American singing game, composer unknown)',
    level: 1,
    gradingNote:
      'Stepwise five-finger melody, hands separately, quarter/half notes with a repeated verse/refrain shape — level 1, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'this-old-man',
    scoreId: 'this-old-man',
    title: 'This Old Man',
    composer: 'Traditional (English folk song, composer unknown)',
    level: 1,
    gradingNote:
      'Short stepwise-plus-skip five-finger phrase, hands separately, quarter/half notes — level 1\'s playing column, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'twinkle-twinkle-little-star',
    scoreId: 'twinkle-twinkle-little-star',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional (French folk melody "Ah! vous dirai-je, Maman", composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger stepwise-plus-skip melody over a simple hands-together I/IV/V left hand, quarter notes — level 1, the app\'s own default score (roadmap 1.17), added to the catalogue by 5.3.',
    // LICENSE.md's own "Twinkle" section (roadmap 1.17, predates the 5.1/5.3
    // provenance classification) says only that the arrangement is this
    // app's own and reproduces no existing edition — it makes no claim of
    // having been checked against an external melodic source. Absent a
    // verification claim, this does not upgrade to `source-verified`.
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'when-the-saints-go-marching-in',
    scoreId: 'when-the-saints-go-marching-in',
    title: 'When the Saints Go Marching In',
    composer: 'Traditional (African-American spiritual, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger arpeggio-and-step melody (do-mi-fa-sol), hands separately, quarter/half notes — level 1, roadmap 5.3.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'yankee-doodle',
    scoreId: 'yankee-doodle',
    title: 'Yankee Doodle',
    composer: 'Traditional (American Revolutionary-era song, composer unknown)',
    level: 1,
    gradingNote:
      'Five-finger stepwise-plus-skip melody, hands separately, quarter/half notes — level 1, roadmap 5.3.',
    provenance: { tier: 'source-verified' },
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
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'auld-lang-syne',
    scoreId: 'auld-lang-syne',
    title: 'Auld Lang Syne',
    composer: 'Traditional Scottish melody; verses collected by Robert Burns (1759–1796)',
    level: 2,
    gradingNote:
      'Legato hands-together melody in G major (1 sharp), one-octave range, simple tonic/dominant harmony — level 2, roadmap 5.3.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'camptown-races',
    scoreId: 'camptown-races',
    title: 'Camptown Races (Chorus)',
    composer: 'Stephen Foster (1826–1864)',
    level: 2,
    gradingNote:
      'Hands-together chorus in G major (1 sharp) with dynamic contrast between verse and "doo-dah" refrain, one-octave range — level 2, roadmap 5.3.',
    provenance: { tier: 'own-rendition', excerptNote: 'Chorus only, not the verse.' },
  },
  {
    id: 'danny-boy',
    scoreId: 'danny-boy',
    title: 'Danny Boy (Londonderry Air, opening phrase)',
    composer: 'Traditional Irish air ("Londonderry Air"); lyrics by Frederic Weatherly (1848–1929)',
    level: 2,
    gradingNote:
      'Legato hands-together opening phrase in G major (1 sharp) with room for dynamic shaping, one-octave range — level 2, roadmap 5.3.',
    provenance: {
      tier: 'own-rendition',
      excerptNote: 'Opening phrase only — a famously intricate melody, no claim on the rest.',
    },
  },
  {
    id: 'home-on-the-range',
    scoreId: 'home-on-the-range',
    title: 'Home on the Range (Chorus)',
    composer: 'Daniel E. Kelley (1808–1905), traditional American cowboy song',
    level: 2,
    gradingNote:
      'Hands-together waltz-time chorus in F major (1 flat), one-octave range with a simple waltz-bass accompaniment — level 2, roadmap 5.3.',
    provenance: { tier: 'own-rendition', excerptNote: 'Chorus only, not the verse.' },
  },
  {
    id: 'jingle-bells',
    scoreId: 'jingle-bells',
    title: 'Jingle Bells (Chorus)',
    composer: 'James Lord Pierpont (1822–1893)',
    level: 2,
    gradingNote:
      'Hands-together chorus in G major (1 sharp) with a boom-chick accompaniment and one-octave melodic range — level 2, roadmap 5.3.',
    provenance: { tier: 'own-rendition', excerptNote: 'Chorus only, not the verse.' },
  },
  {
    id: 'long-long-ago',
    scoreId: 'long-long-ago',
    title: 'Long, Long Ago',
    composer: 'Thomas Haynes Bayly (1797–1839)',
    level: 2,
    gradingNote:
      'Gentle legato hands-together parlor song with eighth-note pickups and simple tonic-dominant harmony — level 2\'s "legato... basic dynamics" and "tonic and dominant chords".',
    provenance: { tier: 'confirmed-contour' },
  },
  {
    id: 'minuet-in-g-major-bwv-anh-114',
    scoreId: 'minuet-in-g-major-bwv-anh-114',
    title: 'Minuet in G major, BWV Anh. 114',
    composer: 'Attrib. Christian Petzold (1677–1733); from the Notebook for Anna Magdalena Bach',
    level: 2,
    gradingNote:
      'Key of G major (1 sharp), hands together throughout, mostly stepwise with some eighth-note motion within an octave — level 2\'s "simple key signatures (0–1 sharps/flats)" and "major scales C/G/F".',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'my-bonnie-lies-over-the-ocean',
    scoreId: 'my-bonnie-lies-over-the-ocean',
    title: 'My Bonnie Lies Over the Ocean',
    composer: 'Traditional (Scottish/American folk song, composer unknown)',
    level: 2,
    gradingNote:
      'Legato hands-together waltz in G major (1 sharp), one-octave range, simple tonic/dominant waltz bass — level 2, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'oh-susanna',
    scoreId: 'oh-susanna',
    title: 'Oh! Susanna',
    composer: 'Stephen Foster (1826–1864)',
    level: 2,
    gradingNote:
      'Hands-together folk song in G major (1 sharp) with a boom-chick accompaniment, one-octave range — level 2, roadmap 5.3.',
    provenance: { tier: 'source-verified' },
  },
  {
    id: 'scarborough-fair',
    scoreId: 'scarborough-fair',
    title: 'Scarborough Fair',
    composer: 'Traditional (English ballad, composer unknown)',
    level: 2,
    gradingNote:
      'Legato modal melody, hands together, one-octave range with a simple block-chord accompaniment — level 2\'s "legato... basic dynamics" playing column.',
    provenance: { tier: 'confirmed-contour' },
  },
  {
    id: 'simple-gifts',
    scoreId: 'simple-gifts',
    title: 'Simple Gifts',
    composer: 'Elder Joseph Brackett (1797–1873), Shaker hymn',
    level: 2,
    gradingNote:
      'Legato hands-together hymn in F major (1 flat), one-octave range, simple tonic/dominant harmony — level 2, roadmap 5.3.',
    provenance: { tier: 'own-rendition' },
  },
  {
    id: 'skip-to-my-lou',
    scoreId: 'skip-to-my-lou',
    title: 'Skip to My Lou',
    composer: 'Traditional (American play-party song, composer unknown)',
    level: 2,
    gradingNote:
      'Hands-together folk song with eighth-note pairs on the refrain and verse/chorus dynamic contrast, one-octave range each hand — level 2.',
    provenance: { tier: 'confirmed-contour' },
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
    provenance: {
      tier: 'source-verified',
      excerptNote: 'Opening A section only, not the full rondo.',
    },
  },
  {
    id: 'greensleeves',
    scoreId: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional (English, composer unknown, first printed 16th c.)',
    level: 3,
    gradingNote:
      'Natural-minor folk melody in simple triple meter, phrased across a two-octave range with hands-together dotted-rhythm accompaniment — level 3\'s "relative minors" and "dotted rhythms".',
    provenance: { tier: 'confirmed-contour' },
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
    provenance: { tier: 'stylistic-excerpt', excerptNote: STYLISTIC_EXCERPT_NOTE },
  },
  {
    id: 'bach-prelude-in-c-major-bwv-846',
    scoreId: 'bach-prelude-in-c-major-bwv-846',
    title: 'Prelude in C major, BWV 846',
    composer: 'Johann Sebastian Bach (1685–1750)',
    level: 4,
    gradingNote:
      'Continuous arpeggiated broken chords in both hands outlining a I–IV–V–I-and-beyond harmonic progression bar by bar, with sustained voicing/pedal control across the whole piece — level 4\'s "arpeggios" and "primary progressions (I–IV–V–I, ii–V–I)".',
    provenance: {
      tier: 'source-verified',
      excerptNote: '4-bar opening phrase only, not the full 35-bar piece.',
    },
  },
  {
    id: 'kuhlau-sonatina-op-20-no-1',
    scoreId: 'kuhlau-sonatina-op-20-no-1',
    title: 'Sonatina in C major, Op. 20 No. 1 (1st movement)',
    composer: 'Friedrich Kuhlau (1786–1832)',
    level: 4,
    gradingNote:
      'Alberti-bass broken-chord left hand under a scalar right-hand melody in C major, requiring genuine two-hand coordination at tempo — level 4\'s "easier sonatinas" playing-column example, named alongside Clementi sonatinas in requirements.md §1.3.',
    provenance: { tier: 'stylistic-excerpt', excerptNote: STYLISTIC_EXCERPT_NOTE },
  },
  {
    id: 'clementi-sonatina-op-36-no-1',
    scoreId: 'clementi-sonatina-op-36-no-1',
    title: 'Sonatina in C major, Op. 36 No. 1 (1st movement)',
    composer: 'Muzio Clementi (1752–1832)',
    level: 4,
    gradingNote:
      'The archetypal easier sonatina: Alberti-bass accompaniment, scale-run passages, and hands-together coordination in C major — level 4\'s "easier sonatinas" playing-column example, per requirements.md §1.3.',
    provenance: { tier: 'stylistic-excerpt', excerptNote: STYLISTIC_EXCERPT_NOTE },
  },
  {
    id: 'beethoven-sonatina-op-49-no-1',
    scoreId: 'beethoven-sonatina-op-49-no-1',
    title: 'Sonatina in G minor, Op. 49 No. 1 (1st movement)',
    composer: 'Ludwig van Beethoven (1770–1827)',
    level: 4,
    gradingNote:
      'Full sonata-allegro form in a minor key with syncopated accompaniment figures and wider leaps than the Kuhlau/Clementi sonatinas at the bottom of this level — level 4\'s "easier sonatinas", "syncopation" and "minor scale forms".',
    provenance: { tier: 'stylistic-excerpt', excerptNote: STYLISTIC_EXCERPT_NOTE },
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
    provenance: {
      tier: 'source-verified',
      excerptNote: 'Subject/answer/countersubject only, 2 bars, not the full piece.',
    },
  },
  {
    id: 'chopin-prelude-op-28-no-4',
    scoreId: 'chopin-prelude-op-28-no-4',
    title: 'Prelude in E minor, Op. 28 No. 4',
    composer: 'Frédéric Chopin (1810–1849)',
    level: 5,
    gradingNote:
      'Chromatic, sighing chordal accompaniment under a rubato-dependent singing melody, moving through secondary dominants toward the relative major before returning — level 5\'s "rubato basics" and "secondary dominants, modulation to close keys", and REQ-3.8.1\'s own "easier Chopin... pieces at level 5" example.',
    provenance: {
      tier: 'confirmed-contour',
      excerptNote:
        '2-bar excerpt reproducing the confirmed melodic shape and descending bass, not the full piece.',
    },
  },
]
