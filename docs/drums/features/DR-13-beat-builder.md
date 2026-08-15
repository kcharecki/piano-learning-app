# DR-13 — Beat builder: GrooveScribe-style grid editor

**Phase:** D1 · **Effort:** M · **Depends on:** DR-04 (grid projection), DR-05, DR-06 ·
**Blocks:** nothing hard; feeds DR-09/DR-21 with learner-authored material

## Why

GrooveScribe is the tool drummers actually love (../research-2026-08-15.md §6): a
zero-friction grid sketchpad — build a groove in seconds, hear it, share it by URL. For a
learning app it is also the bridge from consuming grooves to *understanding* them: a
learner who can notate the money beat owns it. And it is the authoring tool for this app's
own content (DR-24's style library gets built in it).

## What it is

Screen `src/app/drums/builder/`:

- **Grid:** rows = pads (kick, snare, hats, toms, ride, crash), columns = subdivision
  (8th/16th/triplet per beat, switchable per measure), 1–4 measures, 4/4 + 3/4 + 6/8.
  Cell cycles: off → normal → accent → ghost (snare rows); hi-hat row cycles closed →
  open → off; flam toggle per cell.
- **Sticking row** under the grid (R/L/blank per column).
- **Swing slider** (0–67%), BPM, instant loop playback (DR-06).
- **Notation pane:** the same groove rendered by GrooveStaff (DR-05) live — grid and staff
  always in sync, teaching the mapping for free (grid projection in DR-04 makes this a
  pure function, not a second model).
- **Library:** save named grooves (Zustand slice + persistence like every other store);
  "Practice this" hands the groove to DR-09; "Add to review" registers it with DR-21.
- **Share/restore via URL fragment:** groove state encoded in the hash (GrooveScribe's
  killer convenience, trivially local — no server).

## Scope

In: above. Out: multi-section song arranging (DR-26's charts), export to MusicXML file
(cheap later via DR-04's serializer — backlog note), print stylesheet.

## Experience-gate proof

Build the money beat from an empty grid in the driven browser: playback sounds it,
notation pane matches the reference engraving, save→reload→identical, URL copied into a
fresh tab restores the exact groove, "Practice this" opens DR-09 with it loaded and
gradable. Both widths (grid scrolls horizontally inside its own container, page never
scrolls), both themes.
