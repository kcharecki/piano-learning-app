# agent-brief.md — the complete rules digest for a parallel worktree session

You are one of several sessions working this repo **at the same time**, each in its own git
worktree on its own branch and its own port. This file is your whole context. Read it, then
read only the files your task names. Do **not** read `CLAUDE.md`, do not read `ROADMAP.md`
whole, do not go exploring.

## The file boundary (the rule that makes parallelism safe)

Create or edit **only** the paths listed under YOUR FILES in your task. Every other file in the
repo is being edited by another live session *right now*; touching one destroys their work at
merge time. If your task genuinely needs a file you do not own, **stop and report it** — the
integrator will wire it. Reading any file is fine; writing is not.

Never edit, whoever you are: `docs/PROCESS.md`, `docs/retro-log.md`, `docs/agent-brief.md`,
`.claude/**`, `package.json`, `src/design-system/styles.css`, `src/design-system/css/domain.css`
(unless your task lists it), and any `ROADMAP.md` line other than your own task's.

## Architecture and language rules

- **TypeScript strict.** No `any`. No non-null `!` assertions — narrow properly.
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on, so an indexed read is
  `T | undefined` and an optional property cannot be assigned `undefined` explicitly.
- **`src/core` is pure**: no DOM, no React, no IO, no `Date.now()`, no `Math.random()`.
  `Clock` and `Rng` are injected ports (`src/core/ports/`); tests use the deterministic fakes in
  `@test/fakes`. `eslint.config.js` fails the build if core touches `window`, `Date.now`,
  `Math.random`, React or `@adapters/*`. If you feel the need to break that, the logic belongs
  in a different layer.
- **`src/app`** is React UI: it reads core through stores and contains no music logic.
  **`src/adapters`** is the impure edge (Web MIDI, Web Audio, IndexedDB, OSMD).
  **`src/content`** is curriculum, lessons, repertoire metadata and MusicXML.
  **`src/design-system`** is tokens plus primitives; all styling flows from there.
- **Pitch** is always a MIDI note number inside core (`60` = middle C); convert at the edges.
- **Musical time** is always ticks inside core (`TICKS_PER_QUARTER = 480`); milliseconds live
  only in adapters and the transport. Never store BPM-dependent milliseconds in a domain object.
- **Errors**: parsers and validators return `Result<T, E>` from `@core/shared/result`; `throw`
  only for programmer error.
- **Imports** use the `@core/ @app/ @adapters/ @content/ @test/` aliases, never deep relative
  chains.
- **File size** is capped by eslint `max-lines`. Split by concept, not by line count.
- **UI**: tokens and primitives from `src/design-system/` only. No raw hex, no ad-hoc controls.

## Testing rules

- Every module in `src/core/**` has a co-located `*.test.ts`. No exceptions.
- Music-theory and timing invariants get **`fast-check` property tests**, not only examples.
  A property that passes for fingerings no pianist would play is not a property — see the
  fingering post-mortem in the roadmap for what that costs.
- Never real time, real randomness or real IO in a test.
- UI tests stay thin: render, wiring, accessibility roles. Behaviour belongs in core.
  E2E asserts feature-specific observables, never mere presence.
- Do not delete an existing test without naming the superset test that replaces it.

## Commands

Your task names your port. Substitute it for `<PORT>` below.

```bash
npx vitest run <your dirs>        # SCOPED only — never the full suite, other sessions are live
npm run typecheck                 # tsc -b --noEmit
npx eslint <your files>
npm run dev -- --port <PORT> --strictPort
node scripts/visual-pass.mjs <Destination> --url http://localhost:<PORT>
```

`npm run typecheck` is mandatory and cannot be substituted: bare `npx tsc --noEmit` checks
**nothing** here, because the root `tsconfig.json` is a solution file holding only project
references, so `tsc` compiles an empty program and exits 0. A previous round reported "tsc
clean" and landed nine type errors. Fix every error in files you own; ignore errors in files
you do not own, because another session is mid-edit in them.

`vitest` does not typecheck. A green scoped run says nothing about types.

`visual-pass.mjs` shoots every named destination at 1280px and 1024px, dark and light, and
exits 1 on any console error. Useful flags: `--level track=n` to seed a track level first,
`--select sel=label` to choose a dropdown value, `--click <label>` to reach a post-interaction
state. Extend that script if it cannot reach your state; never hand-roll a second driver.

For end-to-end: `$env:E2E_PORT=<PORT>; npx playwright test e2e/<your-spec>.spec.ts`.

If the interactive Browser pane will not composite (a screenshot times out, or `document.hidden`
reads true), do not troubleshoot it — go straight to `visual-pass.mjs` for screenshots and a
driven Playwright spec for the interaction proof. Playwright does not share that dependency.

## Definition of done

This project has shipped more than a dozen features that were dead in the browser under a fully
green test suite. **Green tests are not done.** A slice is done when all of this holds:

1. Scoped `vitest` green, `npm run typecheck` green, `eslint` clean on your files.
2. **Driven proof in the running app on real content** — your task's stated proof action,
   performed against a real piece or a full drill flow, never only a six-bar fixture. Capture
   the evidence: a screenshot, the console, or a driven e2e asserting behaviour.
3. **Visual pass** on every screen you changed, both widths, both themes, console clean. Judge
   the four screenshots against the checklist in `docs/DESIGN.md` as a picky user, and **fix
   what you find before ticking** — do not file it for later.
4. Empty, loading, error and no-MIDI states each handled or explicitly marked N/A.
5. No performance regression: if you touched score rendering, playback or anything on those
   paths, `e2e/perf-large-score.spec.ts` budgets are still green.
6. Committed on your branch, Conventional Commits (`feat(core/theory): …`), one commit per
   slice, and the commit body says what you deleted — "deleted nothing" is a valid outcome but
   must be stated.
7. Your own ROADMAP task line ticked `[x]` with its proof recorded — that line and no other.

## Find the class, not the instance

A task's stated scope is a hypothesis, not a specification: it records what one person noticed,
which is rarely all that is wrong. Before fixing the reported defect, spend bounded effort
finding every instance of it **within the files you own**, and state the count in the commit
body — "2 reported, 11 found" and "1 reported, 1 found" are both results. If the count is above
one, your assertion must cover the class, not the instances you happened to fix.

## When something is ambiguous

Do not guess silently and do not stall. State the ambiguity explicitly in your final report,
name the options, pick the one you can argue for, and say why. If proceeding either way would
waste the work, stop and report instead.

## What to return

Files written. Scoped test counts and time. The driven-proof evidence, concretely. Screenshots
taken. Anything you could not do, and why. Every ambiguity you hit.
