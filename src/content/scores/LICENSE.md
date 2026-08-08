# Licensing — `src/content/scores/`

## `twinkle-twinkle-little-star.musicxml`

**Melody:** "Twinkle, Twinkle, Little Star" is the English-language setting of
the traditional French folk tune "Ah! vous dirai-je, Maman" (published in the
18th century, composer unknown/anonymous). A tune of anonymous folk origin
this old carries no copyright in any jurisdiction — there is no author to hold
one.

**This file:** the MusicXML transcription itself — the specific choice of
key (C major), the left-hand accompaniment (root-position I/IV/V triads, one
per measure), voicing, and fingering — was written by hand for this app by the
agent implementing roadmap task 1.17. It reproduces no existing edition,
engraving, or arrangement, so there is no third-party rights holder to credit
beyond the traditional melody itself.

Bundled here so the app is useful with no file of the user's own on hand
(REQ-3.2.5), satisfying REQ-5.1 (bundled scores must be public domain or
openly licensed).

## Graded repertoire list scores (`src/content/repertoire/gradedPieces.ts`, roadmap 5.1)

Roadmap 4.9 (REQ-5.2, REQ-3.8.1) shipped 20 graded repertoire _entries_ —
title, composer, level, grading rationale. Roadmap 5.1 bundled a real
`.musicxml` file for every one, resolved by `gradedScoreFiles.ts`.

As with the Twinkle transcription above, **the specific arrangement in each
file — key choice among historically attested options, left-hand
accompaniment, voicing, register, and excerpt length — is this app's own**,
written for this task, not a reproduction of any particular published edition
(no edition's separate typographical/editorial copyright is implicated). What
each file claims to be _that piece_ rests on:

- **Verified against a named source before transcribing** (Wikipedia, IMSLP,
  hymn-tune archives, or note-letter listings quoted by a secondary source —
  see the roadmap 5.1 commit body for the full source list): Au Clair de la
  Lune, Hot Cross Buns, London Bridge, Mary Had a Little Lamb, Ode to Joy,
  Amazing Grace, Minuet in G BWV Anh. 114, Merrily We Roll Along, Für Elise
  (Theme A), Bach's Prelude in C BWV 846 (the confirmed 4-bar I–ii65–V43–I
  opening phrase only, not the full 35-bar piece), and Bach's Invention No. 1
  BWV 772 (the confirmed subject/answer/countersubject, 2 bars only).
- **Confirmed key/mode and general melodic contour, but not the exact
  historical note sequence** (no text source gives one): Long Long Ago,
  Scarborough Fair (A Dorian), Skip to My Lou and Greensleeves. The bundled
  melody is this app's own plausible rendition in the confirmed mode.
- **Confirmed harmonic/textural facts only (chord alternation, cadence
  shape, register), with the exact opening pitches explicitly NOT
  recoverable from any text source checked**: Kuhlau's Sonatina Op. 20 No. 1,
  Clementi's Sonatina Op. 36 No. 1, Burgmüller's Arabesque Op. 100 No. 2, and
  Beethoven's Sonatina in G minor Op. 49 No. 1 (itself actually the genuine,
  if easy, Piano Sonata No. 19 — Anh. 5 No. 1, the piece often sold as "the"
  Beethoven sonatina, is unrelated and in G _major_). Each of these four
  bundles a short, stylistically faithful excerpt in the confirmed key,
  meter, and device (Alberti bass, i–iv alternation, etc.) — genuinely in
  that composer's idiom and era, but **not a verified transcription of the
  actual notes**, and it should not be presented to a learner as one.
  Chopin's Prelude Op. 28 No. 4 sits between these two groups: the melody's
  narrow B–A motion and the chromatically descending bass are confirmed by
  analysis sources, so the 2-bar excerpt reproduces that specific confirmed
  shape rather than a generic stand-in.

Every file is short (2–6 bars for the four "stylistic excerpt" pieces and the
two confirmed Bach excerpts; the full remembered phrase for everything else)
precisely because a short excerpt only needs to be right, not guessed long.

Every entry's melody/composition is one of two provenance classes, same test
as the Twinkle melody above:

- **Anonymous traditional/folk melody** (e.g. "Mary Had a Little Lamb", "Au
  Clair de la Lune", "Greensleeves", "Amazing Grace", "Scarborough Fair",
  "Skip to My Lou"): no known author, so no copyright holder in any
  jurisdiction.
- **Composition by a composer who died well before 1900** (Bach 1750,
  Petzold 1733, Clementi 1832, Kuhlau 1832, Beethoven 1827,
  Bayly 1839, Burgmüller 1874, Chopin 1849): the composition itself has been
  public domain for over a century in every jurisdiction with a life+70 (or
  shorter) copyright term. This concerns the _composition_ only — the app
  bundles no particular published edition or engraving of these works, so no
  edition's separate typographical/editorial copyright is implicated.

No 20th-century work, and nothing with an unclear or disputed public-domain
status, was included; where a piece's difficulty was uncertain it was left
out in favor of a clearly-graded alternative rather than guessed at.
