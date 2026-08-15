# DR-24 — Styles library: the groove vocabulary, graded

**Phase:** D3 · **Effort:** L (content-heavy) · **Depends on:** DR-04/05/06, DR-09, DR-13
(authoring) · **Blocks:** DR-14 context grooves, DR-26 song styles, DR-27

## Why

Styles are the drummer's repertoire. The verified order (../research-2026-08-15.md §1):
rock 8ths → half-time/16th rock → blues shuffle (first swing) → funk (needs ghosts) →
jazz swing → latin. Drum School's 300-groove library and DrumGenius's 500 loops prove the
"browsable, style-organized groove library" is a loved product shape — ours adds grading
and curriculum placement.

## What it is

Authored groove sets (`src/content/drums/styles/`), each groove a `GrooveScore` with
level, target BPM band, style lineage note, and listen→learn→apply wiring:

- **Rock (D1–D3):** money beat family, 8th variations, four-on-the-floor, half-time,
  16th-hat grooves (~15 grooves).
- **Blues & shuffle (D3–D5):** 12/8 slow blues, medium shuffle, two-hand shuffle intro,
  Texas shuffle marked D6/stretch (RS Grade 5 calibration) (~8).
- **Funk & R&B (D4–D6):** ghosted 16th grooves, syncopated kicks, open-hat barks,
  linear-lite intro (~10).
- **Jazz (D6):** swing ride + hats 2&4, two comp patterns, brushes noted as out of MIDI
  scope (~5).
- **Latin (D6):** bossa (cross-stick + clave), samba foot pattern intro, labeled
  "introduction — a lifetime lives here" (~5).
- **Compound & feels (D5):** 6/8 rock, 12/8 ballad, train beat (~5).

Per groove: reference playback with feel (swing % where relevant), the DR-09 practice
loop at three checkpoint BPMs (learn/target/stretch), and "where you'll use it" prose one
line long. Style landing pages explain the feel in one paragraph + one listen example.

Authoring happens in DR-13, committed as reviewed data with the digest as the calibration
source for level placement (every placement claim traceable — the Phase-5 content rule).

## Experience-gate proof

Content test: every groove validates, has a level, BPM band, and renders+plays (schedule
asserted). Driven: browse rock → open money beat → practice at learn BPM → record
appears in DR-23's coverage grid; shuffle groove audibly swings (schedule asserts swung
placement); bossa engraves cross-stick per notation conventions. Visual pass on 3 style
pages, both widths/themes.
