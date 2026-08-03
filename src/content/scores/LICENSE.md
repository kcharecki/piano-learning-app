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

## Graded repertoire list metadata (`src/content/repertoire/gradedPieces.ts`)

Roadmap 4.9 (REQ-5.2, REQ-3.8.1) ships 20 graded repertoire *entries* — title,
composer, level, grading rationale — not scores. No MusicXML is bundled for
any of them, so none carries a `scoreId`; see that file's module doc.

Every entry is one of two provenance classes, same test as the melody above:

- **Anonymous traditional/folk melody** (e.g. "Mary Had a Little Lamb", "Au
  Clair de la Lune", "Greensleeves", "Amazing Grace", "Scarborough Fair",
  "Skip to My Lou"): no known author, so no copyright holder in any
  jurisdiction.
- **Composition by a composer who died well before 1900** (Bach 1750,
  Petzold 1733, Clementi 1832, Kuhlau 1832, Beethoven 1827,
  Bayly 1839, Burgmüller 1874, Chopin 1849): the composition itself has been
  public domain for over a century in every jurisdiction with a life+70 (or
  shorter) copyright term. This concerns the *composition* only — the app
  bundles no particular published edition or engraving of these works, so no
  edition's separate typographical/editorial copyright is implicated.

No 20th-century work, and nothing with an unclear or disputed public-domain
status, was included; where a piece's difficulty was uncertain it was left
out in favor of a clearly-graded alternative rather than guessed at.
