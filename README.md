# Piano Learning App

A personal, offline-first app that teaches piano playing, sight reading and music theory together —
beginner through upper-intermediate (roughly ABRSM grade 5–6). Single user, no accounts, no
telemetry, all data local. Full spec in [requirements.md](requirements.md).

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and connect a MIDI keyboard over USB. Chrome or Edge is required —
Web MIDI is not available in Safari or Firefox.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Fast core suite — pure domain logic, node, no DOM. Run this constantly. |
| `npm run test:watch` | Same, in watch mode. |
| `npm run test:all` | Core + UI suites. |
| `npm run test:cov` | Coverage with the 90% gate on `src/core`. |
| `npm run test:e2e` | Playwright smoke tests. |
| `npm run verify` | Typecheck + lint + all tests. The gate before every commit. |
| `npm run checkpoint` | Verify, then commit. |
| `npm run dev` / `build` | Vite dev server / production build. |

## How it is built

Everything that matters is a pure function over data, kept in `src/core` with no DOM, no framework
and no IO. The browser lives behind narrow ports (`Clock`, `Rng`, `MidiInput`, `AudioOutput`,
`Store`), which is why the whole behavioural test suite runs in Node in well under a second with no
timers, no sleeps and no flake. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
src/core/      pure domain: theory, notation, timing, practice, srs, curriculum, progress
src/adapters/  Web MIDI, Web Audio, IndexedDB, OSMD rendering
src/app/       React UI
src/content/   curriculum data and public-domain scores
```

The layer boundary is enforced by eslint, not by convention: `src/core` cannot import React, touch
`window`, or call `Date.now()` / `Math.random()`.

## Working on it

[ROADMAP.md](ROADMAP.md) is the state of the project — the first unchecked box is what happens next.
[CLAUDE.md](CLAUDE.md) tells an agent how to pick that up, implement it, test it, review it and
commit it without further instruction.

## Licence and content

Bundled scores are public domain or openly licensed (IMSLP, Mutopia, OpenScore). Progress data is
plain JSON and exportable at any time.
