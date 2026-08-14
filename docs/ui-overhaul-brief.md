# UI overhaul — standing brief for every builder agent

Read this file once. Do NOT read `CLAUDE.md`. Do NOT explore the codebase beyond the files
your prompt names as YOUR FILES and READ-ONLY DEPENDENCIES. Everything an implementer needs
is here.

## Non-negotiables

- **TypeScript strict.** No `any`, no non-null `!`. `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are on — narrow properly.
- **Architecture boundary (eslint enforces it).** `src/app/**` is React UI: it must contain no
  music logic, no `@adapters/*` import chains it does not already have, and it reads core
  through stores/hooks that already exist. You are doing presentation work — if you find
  yourself computing music theory, timing or matching, you are in the wrong layer: stop and
  report it.
- **All styling flows from `src/design-system/`.** No raw hex. No raw px spacing. No ad-hoc
  controls. Use tokens and primitives. If you need a token or primitive that does not exist,
  **stop and report it** — do not invent one. Foundation tasks UI-01…UI-06 own the design
  system; screen tasks do not edit `docs/DESIGN.md`, `src/design-system/tokens/**`,
  `primitives.css`, `base.css`, `domain.css`, `responsive.css`, `styles.css`, `Shell.tsx`,
  routes, or `src/app/state/**`.
- **Imports use `@core/ @app/ @adapters/ @content/ @test/` aliases only.** Never deep relative
  chains.
- **Co-located tests.** A component you meaningfully restructure keeps its `*.test.tsx`
  passing, updated where the structure legitimately changed. UI tests stay thin: render,
  wiring, roles, accessibility. Behaviour lives in core and is already tested there.
- **Files under 500 code lines** (eslint `max-lines`). Split by concept if you approach it.

## The design tokens that exist (use these names, do not invent)

Color: `--bg-0 --bg-1 --bg-2 --bg-3`, `--paper --paper-edge --paper-fg --paper-muted`,
`--text-1 --text-2 --text-3 --text-inverse`, `--border-1 --border-2`,
`--accent --accent-hover --accent-down --on-accent --accent-dim`, `--ok --warn --error`,
feedback `--fb-correct --fb-wrong --fb-late --fb-early --fb-missed --fb-extra --fb-playing
--fb-upcoming --fb-out` (+ `-dim` and `-ink` variants), key colors `--key-*`,
`--focus-ring --focus-ring-paper`.

Type: `--font-ui --font-mono`; sizes `--text-xs`(13px) `--text-sm`(14) `--text-md`(16)
`--text-lg`(19) `--text-xl`(24) `--text-2xl`(32) `--text-glance`(44); `--leading-tight
--leading-normal --leading-loose`; `--weight-normal --weight-medium --weight-semibold
--weight-bold`; `--tracking-caps`.

Space: `--space-1`(4) `--space-2`(8) `--space-3`(12) `--space-4`(16) `--space-5`(24)
`--space-6`(32) `--space-7`(48) `--space-8`(64); `--radius-1 --radius-2 --radius-3
--radius-round`; `--border-w --border-w-strong`; `--control-h`(36, grows to `--touch-min` 44
at ≤1024px) `--touch-min --control-pad-x`; `--nav-w --content-max --content-pad`.

Elevation: `--elev-1 --elev-2 --elev-3 --elev-paper`.
Motion: `--dur-1`(120ms) `--dur-2`(200ms) `--dur-3`(320ms) `--ease-out --ease-in-out`.
Z-index: see `tokens/z-index.css`.

**All three text tokens are AA.** `--text-3` is the quiet tertiary reading tone (upcoming
state, chart axis label), NOT an AA exemption. Never introduce a low-contrast text color; for
a genuinely decorative non-text element use `--paper-muted` or opacity on an icon/border.

## The nine screen rules (DESIGN.md — the visual pass judges against these)

1. **One primary action per screen.** Exactly one `.btn-primary`, where the eye lands first.
   Everything else secondary, ghost, or hidden. Start / Play / Begin count as primaries.
2. **Progressive disclosure.** At most ~6 interactive controls visible before disclosure.
   Configuration collapses into `<details>`, tabs, or a drawer. Advanced/diagnostic controls
   are never open by default.
3. **Adding means demoting.** Adding a visible control means naming what you demoted, grouped
   or hid. State it in your report.
4. **Hierarchy reads top-down:** what am I doing → the content (score, staff, prompt) → how I
   act on it. Status and readouts sit *with* the thing they describe, never in a separate pile.
5. **Feedback within 100ms.** Every press acknowledges instantly. Use motion tokens.
6. **Empty states teach.** Say what the learner will get and offer the one action that gets
   them there. Never a blank region, never a raw "no items", never a row of zeros.
7. **Learner language.** No internal vocabulary on screen: no MIDI numbers, no SRS jargon
   (ease, lapses, intervals-as-scheduler-terms), no 0-based indices, no parameter names, no
   "0 day(s)"-style plurals. Sentence case, short, speaks piano.
8. **Both themes are first-class.** Dark is the base. Notation always sits on `--paper`. Color
   is never the only signal — every feedback state keeps a glyph cue.
9. **Every touch target clears 44px at tablet and up.** Primitives get this free via
   `--control-h`. A checkbox/radio must be written as `<label><input type="checkbox" />text
   </label>` — that exact shape is what `primitives.css` sizes. Do not wrap it any other way.

## Accessibility is acceptance criteria, not follow-up

Keyboard reachable in visual order; visible `--focus-ring` on every interactive element;
correct roles and labels; AA contrast in both themes; overlays trap focus, close on Escape,
and restore focus to their trigger. Icons are always `aria-hidden` — text carries meaning.

## Motion

Use `--dur-*` / `--ease-*` only. The global `prefers-reduced-motion: reduce` rule in
`tokens/motion.css` already disables animation — never fight it with `!important`. Nothing
animates inside the notation paper frame except the playback cursor.

## How you verify (and what you must NOT run)

- Run **only** your scoped tests: `npx vitest run <your directory>`. **Never run the full
  suite** — other agents are editing files concurrently and you will see their half-written
  state and report a false failure.
- Then run `npm run typecheck` and fix every error **in files you own**. Ignore errors in
  files you do not own — another agent is mid-edit. It must be `npm run typecheck`;
  `npx tsc --noEmit` silently checks nothing here (the root tsconfig is a solution file of
  project references only) and has previously let nine type errors ship.
- Then `npx eslint <your files>` and fix what it reports in your files.
- **Do not run `npm run dev`, Playwright, or `scripts/visual-pass.mjs`.** The orchestrator
  owns the dev server and the browser-driven visual pass; concurrent servers collide. Your
  job ends at green scoped tests + clean typecheck + clean lint on your files.
- **Do not commit.** The orchestrator commits.

## What to report back

1. Files written (paths).
2. Scoped test output: count and time. Typecheck result. Lint result.
3. Per acceptance criterion in your task: met / not met, and how you know.
4. Anything you demoted, grouped or hid (rule 3), and anything you deleted.
5. Every place you wanted a design-system change and did not make one (you must escalate,
   not improvise).
6. Any contract ambiguity or defect you found and did not fix. Never resolve one silently.
