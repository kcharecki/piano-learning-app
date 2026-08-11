# Third-party assets — licensing

This file is the repo-root ledger for bundled third-party assets that are not
this app's own code, following the same per-asset breakdown convention as
`src/content/scores/LICENSE.md` (which covers bundled MusicXML pieces
specifically). Add an entry here whenever a session bundles a binary or
otherwise non-authored asset — a font, an audio sample, an icon set — rather
than writing/generating it for this app.

## `src/design-system/fonts/bravura/` — Bravura (roadmap 5.26)

**What:** `Bravura.woff2`, the SMuFL-compliant music font by Steinberg Media
Technologies GmbH (used by MuseScore, VexFlow, OpenSheetMusicDisplay, and
most of the open-source music-notation ecosystem as the de facto standard
engraving font).

**Why bundled:** `src/app/drills/StaffNote.tsx` renders clef and accidental
glyphs as plain Unicode text (`U+1D11E` treble clef, `U+1D122` bass clef,
`U+266D`/`U+266F` flat/sharp, `U+1D12A`/`U+1D12B` double sharp/flat). Before
this task nothing in the repo bundled a font that maps those codepoints, so
the glyphs rendered from whatever the OS happened to provide — tofu on a
machine with no music font installed. `node_modules` was checked first, per
the task brief: `opensheetmusicdisplay`/`vexflow` reference the string
"Bravura" as a font-family fallback name and ship SVG glyph-path data
(`vexflow/src/fonts/*.js`) for their own canvas/SVG engraving, but neither
package bundles an actual font file (woff/woff2/otf) anywhere in
`node_modules`. No suitable asset existed in-repo, so this session fetched
one.

**Fetched from:** the official upstream GitHub release —
`https://github.com/steinbergmedia/bravura/releases/download/bravura-1.481/Bravura.woff2`
(release `bravura-1.481`, published 2026-08-07 by the `steinbergmedia/bravura`
repo's own release automation). The accompanying licence text was fetched
from the same release: `.../bravura-1.481/OFL.txt`, and is committed
unmodified as `src/design-system/fonts/bravura/OFL.txt`.

**Variant chosen:** the plain `Bravura.woff2` (not `BravuraText.woff2`).
Verified with `fontTools` before committing that `Bravura`'s cmap already
covers every codepoint this app uses as plain text (`U+1D11E`, `U+1D122`,
`U+266D`, `U+266F`, `U+1D12A`, `U+1D12B`) with real, non-placeholder advance
widths — `BravuraText` exists to additionally match body-text glyph
proportions when music symbols are mixed inline with prose, which does not
apply here (the glyphs sit alone inside an SVG at an explicit `fontSize`).
`Bravura.woff2` is the smaller of the two (~316 KiB vs. ~439 KiB) for
identical glyph coverage of what this app needs, so it is the one shipped.

**Not subset.** Subsetting to the ~6 codepoints actually used would need a
font-subsetting tool (e.g. `fonttools`/`pyftsubset`, or an npm package such as
`subset-font`); the task scope explicitly disallows adding a new build-time
dependency (`package.json` is not a file this session owns). The full
unsubsetted file is committed: **323,528 bytes (≈316 KiB)** for
`Bravura.woff2`, plus a 4,420-byte licence file. Subsetting is a legitimate
follow-up if a future session can justify the new dependency.

**Licence:** SIL Open Font License, Version 1.1. Full text:
`src/design-system/fonts/bravura/OFL.txt` (fetched verbatim from the release
above, committed unmodified — the OFL requires the licence to ship alongside
the font, satisfied by co-locating the two files). Copyright © 2015 Steinberg
Media Technologies GmbH, with Reserved Font Name "Bravura". The OFL permits
bundling, embedding, and redistribution as part of a larger software
application (this app) without royalty, provided the font itself is not sold
on its own and the licence text travels with it — both conditions are met
here.
