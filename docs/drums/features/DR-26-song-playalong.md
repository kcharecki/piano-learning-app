# DR-26 — Song play-along: full charts, full length, with a band

**Phase:** D3 · **Effort:** L · **Depends on:** DR-05 (OSMD surface), DR-04 MusicXML
bridge, DR-07, DR-09 transport, DR-24 · **Blocks:** the "apply" block of DR-22; D4+ exit
criteria

## Why

Playing music is the point. Every syllabus is performance-first (3 songs per grade);
"plays full songs" separates practicing from drumming. Licensing reality: commercial
recordings are out for a bundled personal app — the piano app's answer (public-domain +
own-rendition content with provenance tiers) adapts: **authored etudes in real styles +
synthesized backing**, plus import for whatever charts the user owns.

## What it is

- **Song etudes** (`src/content/drums/songs/`): ~12 authored 2–4 minute pieces, one per
  style×level cell (D2 rock 8ths … D6 jazz/latin), each a full drum chart (MusicXML,
  multi-section: intro/verse/chorus/fill turns/outro) + a synthesized backing track
  (bass+comp riff loops from the existing synth stack, tempo-locked to the transport —
  no audio assets, no drift). Provenance: `own-rendition`, stylistic labels honest
  ("in the style of 70s funk", never a band name).
- **Chart surface:** OSMD renders the full chart (this is DR-05's OSMD lane, with the
  notehead escape hatch); transport cursor, section markers, loop-a-section, BPM scale
  (backing re-synthesizes at tempo — the synth advantage), count-in.
- **Grading:** DR-07 over the whole take; per-section results (worst section → one-tap
  loop); song "passed" at level-dependent accuracy → repertoire-style record (piece
  status, best take, history — the piano repertoire model shape, including the T.5
  lesson: the record must actually be written from the session end).
- **Import:** user-supplied MusicXML drum charts through the same untrusted parse path
  (DR-04 bridge); user-supplied audio backing out of scope v1 (sync without a tempo map
  is its own project — backlog DR-B6 with Moises-style tooling noted).
- **Decision gate lives here:** if OSMD chart rendering hits the #887 wall on real
  content, the alphaTab evaluation triggers (DR-05's contingency).

## Experience-gate proof

Drive a full D2 etude: chart scrolls with the cursor, backing audibly tempo-locked at 80
and 100 BPM (schedule asserted), a section loop wraps verdicts correctly, the take lands
in history and flips piece status, worst-section reopen preloads that section. Import a
hand-made MusicXML chart: renders and grades, or fails with a real error message
(Result path). Perf: chart engrave within the piano app's score budget on a 100-measure
chart. Both widths/themes.
