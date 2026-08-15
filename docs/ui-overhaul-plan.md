# UI/UX overhaul plan

> **STATUS: executed 2026-08-14/15. All 24 tasks shipped.** This document is kept as the
> record of what was asked for and why — the audit evidence in it (measured control counts,
> the concatenated Repertoire rows, the 5,400px Theory page) describes the app BEFORE the
> overhaul and should be read as history, not as a description of the current app.
>
> What actually shipped, what it cost and what it found: see `ROADMAP.md`'s "UI/UX overhaul"
> section and the retro entry in `docs/retro-log.md`. The current design language is
> `docs/DESIGN.md` — that file, not this one, is the live contract.
>
> Deviations from this plan, all deliberate and all recorded in the commits: the work ran as
> parallel agents in the main checkout rather than one worktree session per task (file
> ownership was already disjoint by construction, so worktrees would have cost 19 merges for
> no extra safety); UI-04 was split into 04a/04b because five sub-areas in one task exceeded
> the sizing guidance; and several tasks' acceptance criteria were tightened mid-flight when a
> review measured something the plan had assumed.

Produced by a full audit on 2026-08-12: every screen driven in the running app (fresh
profile, real content), screenshotted at 1280px and 768px, dark and light, plus interactive
states (session run, mid-playback feedback, drills running, drawers open). Reference
screenshots live in `docs/ui-audit/` — filenames are cited per task. Console was clean on
every screen; the defects below are visual, structural, and experiential, not crashes.

**How to execute:** tasks are numbered and dependency-ordered. `serial: main-thread-only`
tasks touch shared files (design system, Shell, stores, DESIGN.md) and must run one at a
time on the main checkout. Tasks marked `parallelizable` own disjoint files — any set of
them can run concurrently in worktrees once their dependencies are merged. No task may
begin before every task it depends on is merged. Every task must end with `npm run verify`
green and the experience-gate evidence it names.

**Rules baked into every task (do not restate per task, do not skip):**

- All styling flows from `src/design-system/` tokens and primitives. No raw hex, no raw px
  spacing, no ad-hoc controls. A task needing a new token/primitive creates it in the
  design system first (foundation tasks own that; screen tasks escalate instead of
  inventing).
- Architecture boundary holds: no music logic in `src/app/`; eslint enforces it. Pitch is
  MIDI numbers in core only — screens show learner language (DESIGN.md rule 7).
- Screen tasks do **not** edit `docs/DESIGN.md`, `src/design-system/**`, `Shell.tsx`,
  routes, or stores. If a screen task discovers it needs a design-language change, it stops
  and reports rather than improvising. Foundation tasks (UI-01…UI-05) own those files.
- Accessibility is in the acceptance criteria, not a follow-up: keyboard reachable, visible
  focus ring (`--focus-ring`), correct roles/labels, AA contrast in both themes.
- Any motion uses the motion tokens (`--dur-*`, `--ease-*`) and respects
  `prefers-reduced-motion` (the global reduce rule already exists in `tokens/motion.css` —
  do not fight it).
- Evidence means: screenshots at 1280px and 768px × dark and light, the named interaction
  driven end-to-end in the running app (`npm run dev`), console clean, no layout shift
  while interacting.

## Systemic root causes (what the foundation tasks fix)

1. **No form/field primitives.** Every screen hand-rolls label+control rows, so labels
   crush against controls everywhere: `Drill[select]`, `From measure[1]to measure[12]`,
   `− Complexity 1 +` with the stepper buttons overlapping their own label, `Root[C]
   Scale[Major]`. See `technique--desktop--dark.png`, `metronome--desktop--dark.png`,
   `state--sightreading-running.png`.
2. **No page scaffold.** Screens are top-left stacks of controls in a void — Sight
   reading, Rhythm, Ear training and Metronome are ~80% dead space at 1280px
   (`sight-reading--desktop--dark.png`, `rhythm--desktop--dark.png`), while Theory is a
   5,400px single scroll (`theory--desktop--dark.png`). Alignment is inconsistent
   (Flashcards centers its column, every other screen left-aligns).
3. **The one-primary-action rule exists only on paper.** `.btn-primary` exists in
   `primitives.css` but the real primary of almost every screen — Start exercise, Play,
   Start, Tap, Begin now, Complete warm-up — is styled as a secondary button, while Today
   shows two competing blue primaries (onboarding banner + Start session).
4. **Shell chrome is misallocated.** The "No MIDI keyboard connected…" banner plus a "Pair
   Bluetooth MIDI" button render as in-flow content on six screens, pushing the actual
   task below them every time. The Reference toggle floats as a detached chip over the
   content. The nav is text-only, right-aligned, with no icons and no learner context
   (level, streak). Settings has no theme control at all.
5. **Numbers are presented as debug output.** The accuracy strip reads
   `Accuracy 100% Correct 0 Wrong pitch 0 Missed 0 Extra 0` as an ambiguous label/value
   soup (and shows a green "100%" before a single note has been played); SRS stats are a
   raw `0 0 0 0 0` row; Progress shows "0 day(s)", disabled radios as status icons, and a
   heading that collides with the Reference button (`progress--desktop--dark.png`);
   Repertoire concatenates title+composer+level with no separator: "Au Clair de la
   LuneTraditional (French folk melody…)Level 1" (`repertoire--desktop--dark.png`).

---

## Foundation

### UI-01: Build the form and field primitives
**Problem:** No primitive exists for "label + control", so every screen improvises and
labels crush against their controls. Worst offenders: stepper labels rendered *between*
the − / + buttons and overlapping them (`technique--desktop--dark.png` "Level 1",
`rhythm--desktop--dark.png` "Complexity 1"); inline label/input runs with zero gap
(`metronome--desktop--dark.png` "BPM[100]Beats[4]Beat unit[/4]"; Practice's "From
measure[1]to measure[12]" in `practice--desktop--dark.png`).
**Target:** In `src/design-system/css/primitives.css`, add a documented set of form
primitives, all built on existing tokens:
- `.field` — vertical label-above-control unit: label in `--text-sm`/`--text-2`,
  `--space-1` gap to its control, block layout.
- `.field-row` — horizontal run of `.field`s with `--space-4` column gap, wrapping at
  narrow widths; controls align on a shared baseline.
- `.field-inline` — label and control on one line with `--space-2` gap, for checkbox-style
  and short inline cases.
- `.stepper` (rework the existing class) — a bordered group `[−] value [+]`: value cell
  min-width 3ch, centered, `--text-md`; buttons are `--control-h` square; the *label* is
  never inside the group — callers wrap it in a `.field`.
- `.seg-control` — a single-select segmented group (replaces ad-hoc button rows like
  15/30/60 min, Beat 1–4 accents, mode tabs): one bordered container, `--radius-1` inner
  segments, selected segment gets `--accent-dim` fill + `--accent` text + semibold, only
  the group has an outer border. Must be `role="radiogroup"`-compatible (callers supply
  roles; CSS supports `[aria-checked="true"]` and `[aria-current]` selectors as well as a
  `.selected` class).
Update `docs/DESIGN.md` with a short "Form primitives" section: when to use each, and the
rule *a label never touches its control — if you typed a label as bare text next to an
input, you skipped a primitive.* Add responsive behaviour in
`src/design-system/css/responsive.css`: `.field-row` wraps to a single column ≤640px;
steppers and segments grow with `--control-h` at ≤1024px (they must — verify with
`e2e/tablet-touch-targets.spec.ts` untouched and passing).
**Files:** `src/design-system/css/primitives.css`, `src/design-system/css/responsive.css`,
`docs/DESIGN.md` — all shared, serial.
**Depends on:** none.
**Acceptance criteria:**
- [ ] A demo usage of each primitive (temporary route not required — a vitest UI render
      test per primitive class asserting computed layout roles is enough, plus visual
      check on any one screen converted as a smoke test, e.g. the Metronome BPM field).
- [ ] No label in the converted smoke-test screen touches its control; gaps come from
      tokens only.
- [ ] Stepper: label outside the group, value centered, buttons ≥ `--control-h`, and at
      768px every hit target ≥44px.
- [ ] `.seg-control` selected state readable in both themes, AA contrast, and shows a
      visible focus ring when keyboard-focused.
- [ ] `npm run verify` green; `npm run test:e2e` tablet touch spec still green.
**Evidence required:** screenshots of the smoke-test screen (both widths × both themes);
keyboard-tab traversal across a `.field-row` + `.seg-control` driven in the browser with
focus rings visible in the shots; console clean.
`serial: main-thread-only`

### UI-02: Build the page scaffold and layout primitives, and stub per-screen stylesheets
**Problem:** No screen shares a layout skeleton. Flashcards centers its column while every
other screen left-aligns (`flashcards--desktop--dark.png` vs any other shot). Sight
reading, Rhythm, Ear training, Metronome render a small clump of controls and ~80% void at
1280px. Content width is `--content-max: 72rem` but nothing composes inside it: no header
band, no card rhythm, no section spacing scale. Also: every future screen task needs a
stylesheet to write into, and `styles.css` (the import aggregator) must not be touched by
parallel tasks.
**Target:** In `src/design-system/css/base.css` + `primitives.css`:
- `.page` — the content column: `max-width` per archetype via modifier (`.page--focus`
  48rem for single-task screens: drills, metronome, sight reading; `.page--wide` 72rem
  for dashboards: progress, theory, repertoire, lessons), centered, `--content-pad`
  padding, and a consistent vertical rhythm: direct children separated by `--space-5`.
- `.page-header` — title row: `h1` at `--text-2xl`, optional subtitle in
  `--text-sm`/`--text-2`, optional right-aligned action slot. Establishes that a screen
  title appears exactly once (kills the current duplicate title in topbar + h1).
- `.card` (rework existing) — `--bg-2`, `--radius-2`, `--elev-1`, `--space-5` padding;
  variant `.card--sunken` (`--bg-1`, no shadow) for de-emphasized regions like config.
- `.toolbar` — a horizontal control band that sits above content (used later by Practice
  transport, Metronome controls): `--bg-1`, full-bleed within the page column,
  `--space-3` padding, `--space-4` gaps, children vertically centered.
- `.stat-group` / `.stat` — the labeled-number primitive: value in `--text-xl`
  semibold `--text-1`, label under it in `--text-xs` caps `--text-2` with
  `--tracking-caps`. Fixes every "label 0 label 0" strip; value formats (color-coding a
  percentage) come from feedback tokens applied by callers.
- Create empty, commented stub files and register them in `styles.css` now so no later
  task edits the aggregator: `feature-today.css`, `feature-practice.css`,
  `feature-sightreading.css`, `feature-flashcards.css`, `feature-eartraining.css`,
  `feature-rhythm.css`, `feature-technique.css`, `feature-metronome.css`,
  `feature-theory.css`, `feature-repertoire.css`, `feature-progress.css`,
  `feature-lessons.css` (all under `src/design-system/css/`).
Update `docs/DESIGN.md`: add the two page archetypes (focus / wide), the vertical-rhythm
rule, and the rule *a screen is `.page > .page-header + sections`, never a bare stack.*
**Files:** `src/design-system/css/base.css`, `src/design-system/css/primitives.css`,
`src/design-system/css/styles.css`, 12 new `feature-*.css` stubs,
`src/design-system/css/responsive.css`, `docs/DESIGN.md` — all shared, serial.
**Depends on:** UI-01.
**Acceptance criteria:**
- [ ] One screen converted as smoke test (Sight reading — the emptiest): wrapped in
      `.page--focus` + `.page-header`, its controls in a `.card--sunken`; at 1280px the
      column is centered and the screen no longer reads as a top-left clump.
- [ ] `.stat` renders a value/label pair with the label under the value, caps, AA
      contrast both themes.
- [ ] All 12 stub files imported; `npm run verify` green (lint accepts empty-but-commented
      css files).
- [ ] No horizontal scroll at 768px on the converted screen; `.page` padding adapts via
      existing responsive rules.
**Evidence required:** before/after screenshots of Sight reading (both widths × both
themes); console clean.
`serial: main-thread-only`

### UI-03: Add the icon system and enforce the action hierarchy
**Problem:** The app has no icons except the ☰ hamburger and Unicode clef glyphs. Nav is
13 text labels; buttons like Play/Pause/Stop, Record, Tap, Add are text-only; status
(MIDI connected/not) has no glyph, breaking the "color is never the only signal" rule in
places. And the action hierarchy is inverted on most screens: the true primary (Start /
Play / Begin) is default-styled while `.btn-primary` sits unused (see
`sight-reading--desktop--dark.png`: "Start exercise" is gray; `metronome--desktop--dark.png`:
"Start" is gray).
**Target:**
- Create `src/design-system/icons/icons.ts`: a typed map of ~22 inline SVG path strings
  (24×24, `stroke="currentColor"`, 1.75px stroke, round caps — one consistent family,
  drawn in the Lucide style): `play, pause, stop, record, metronome, keyboard, ear,
  rhythm, hand, book, cards, target, chart, settings, midi-plug, bluetooth, check, x,
  chevron-down, chevron-right, plus, minus, clock, flame` (flame = streak).
- Create `src/app/ui/Icon.tsx`: `<Icon name size?>` rendering the SVG inline with
  `aria-hidden="true"` (icons are always decorative; text carries meaning), sized in `em`
  so it scales with the button's font size. Co-located `Icon.test.tsx` (renders, hides
  from AT, unknown name is a type error).
- In `primitives.css`: buttons get `display:inline-flex; align-items:center;
  gap: var(--space-2)` so icon+label compose; `.btn-icon` (icon-only) requires
  `aria-label` — add a UI test asserting the primitive's contract on one usage.
- Sharpen `.btn-primary` so a single glance finds it: `--accent` fill, `--on-accent`
  text, `--elev-1`, hover `--accent-hover`, active `--accent-down` + translateY(1px)
  with `--dur-1`; exactly one per screen (rule already in DESIGN.md — screens adopt it in
  their own tasks).
- Update `docs/DESIGN.md`: icon family, the aria-hidden rule, and "the screen's true
  primary action gets `.btn-primary`; Start/Play/Begin count as primaries."
**Files:** `src/design-system/icons/icons.ts` (new), `src/app/ui/Icon.tsx` + test (new
dir), `src/design-system/css/primitives.css`, `docs/DESIGN.md` — shared, serial.
**Depends on:** UI-01 (button metrics), UI-02 (nothing structural, but keep order).
**Acceptance criteria:**
- [ ] `<Icon>` renders any named icon, `aria-hidden`, inherits `currentColor` (verify by
      rendering inside a `.btn-primary` in both themes — stroke follows text color).
- [ ] Buttons with icon+label show a `--space-2` gap without per-call CSS.
- [ ] `.btn-primary` passes AA for `--on-accent` on `--accent` in both themes.
- [ ] If eslint's boundary config rejects `src/app/ui/` importing from
      `src/design-system/icons/`, stop and report — do not weaken the config silently.
      (Importing a TS constant from design-system into app is expected to be legal; the
      check is that no *core* import appears.)
- [ ] `npm run verify` green.
**Evidence required:** a screenshot of a test render (vitest UI snapshot or a temporary
story on any screen) showing icon buttons in both themes; console clean.
`serial: main-thread-only`

### UI-04: Redesign the shell — navigation, topbar, and one home for input status
**Problem:** Four defects, all in `docs/ui-audit/` shots: (a) nav labels are right-aligned
text with no icons, the active item is a faint wash, groups read as floating words, and
the rail carries zero learner context; (b) the topbar shows only a duplicate screen title
at ≤1024px and nothing at desktop, while the Reference toggle floats as a detached chip
over content at top-right (every desktop shot); (c) the "No MIDI keyboard connected…"
banner + "Pair Bluetooth MIDI" button repeat as in-flow content on Practice, Sight
reading, Flashcards, Ear training, Rhythm, Technique and Theory, pushing the task down on
every one (compare any two of those shots — it is the first thing on all of them);
(d) the narrow-width drawer scrim barely dims content (`state--narrow-drawer.png`).
**Target:**
- **Nav rail** (`NavGroups.tsx`, `feature-nav-groups.css`): left-aligned items, each with
  a 16px `<Icon>` (today→target, practice→keyboard, sight-reading→book, repertoire→cards
  …pick sensible ones from UI-03's set) and label; active item gets a 2px `--accent` left
  rail + `--accent-dim` fill + `--text-1` (not accent text — calmer); group titles stay
  `--text-xs` caps `--text-3`. Today keeps its visually-primary slot at top. Add a rail
  footer pinned to the bottom: current playing level + streak (`flame` icon + "Level 1 ·
  0-day streak", reading `useLevelStore`/`progressStore` — display only, no logic).
- **Topbar** (`Shell.tsx`, `base.css`): at all widths render: screen title (only place a
  title appears — screens keep their `h1` in `.page-header`; the topbar shows it only
  ≤1024px where the rail is hidden, as today), a right-aligned cluster: **input status
  chip** + **Reference button** (the chip and button become normal topbar citizens, no
  floating). Kill the separate `.reference-toggle` positioning.
- **Input status chip**: one compact chip, always present: `midi-plug` icon + "MIDI
  connected" / "No MIDI — using on-screen keys" (learner language). Click opens a small
  popover (reuse `.card`, `--elev-3`, `--z` from z-index tokens) containing what
  `InputCapabilityBanner`/`MidiDeviceStatus` say today: device name, the
  listen-and-read-along explanation, the *why* of the failed permission, and the Pair
  Bluetooth MIDI action + mic toggle entry point. `InputCapabilityBanner.tsx` becomes
  this chip+popover; `MidiDeviceStatus.tsx` and `useBluetoothMidi.ts` move their UI here
  (screens stop rendering them in their own tasks — this task removes the render from
  none of the screens yet, it only builds the home; expect the banner to appear twice on
  some screens until their tasks land, and say so in the task report).
- **Drawer**: scrim to `rgba(0,0,0,.5)` dark / `rgba(29,33,38,.35)` light (as tokens in
  `colors.css`: `--scrim`), `--dur-2` fade, focus trapped in the drawer while open,
  Escape closes (verify existing behaviour still holds).
- **Reference panel chrome** (`ReferencePanel.tsx`, `feature-reference-panel.css`): the
  slide-over itself gets the same treatment — `--bg-1` surface, `--elev-3`, `--scrim`
  underlay at ≤1024px, `--dur-2` slide via motion tokens, a `.page-header`-styled panel
  header with the close button as `.btn-icon`. Its *content* (the chord/scale reference)
  is owned by UI-17 — do not restyle the tables here, chrome only.
**Files:** `src/app/shell/Shell.tsx`, `src/app/shell/NavGroups.tsx` (+ their tests),
`src/app/reference/ReferencePanel.tsx` (+ test),
`src/design-system/css/feature-reference-panel.css`,
`src/app/shell/InputCapabilityBanner.tsx` (+ test), `src/app/practice/MidiDeviceStatus.tsx`
(+ test), `src/app/practice/useBluetoothMidi.ts` (+ test),
`src/design-system/css/feature-nav-groups.css`, `src/design-system/css/base.css`,
`src/design-system/css/feature-bluetooth-midi.css`, `src/design-system/tokens/colors.css`
(scrim token), `docs/DESIGN.md` (shell composition rules) — shared, serial.
**Depends on:** UI-01, UI-02, UI-03.
**Acceptance criteria:**
- [ ] Nav: icons + left-aligned labels; active item shows rail+fill in both themes; rail
      footer shows level + streak; whole nav keyboard-traversable with visible focus.
- [ ] Topbar shows the status chip + Reference at 1280px and 768px; nothing floats over
      content; Progress screen's heading no longer collides with Reference (verify on
      that screen specifically — `progress--desktop--dark.png` shows the collision).
- [ ] Chip popover opens on click and Enter, closes on Escape with focus returned to the
      chip, and contains the pairing action; no MIDI-jargon sentence longer than one line
      of the popover (learner language pass).
- [ ] Drawer at 768px: scrim visibly dims, Escape closes, focus returns to hamburger.
- [ ] `npm run verify` green including shell tests updated with the new structure.
**Evidence required:** screenshots at both widths × both themes of: nav rail, chip popover
open, drawer open; a keyboard-only traversal (Tab through topbar → nav → content) driven
in the browser; console clean.
`serial: main-thread-only`

### UI-05: Make Settings a real settings screen (theme, audio, input, plan)
**Problem:** `settings--desktop--dark.png`: Settings is nothing but the onboarding
questionnaire re-rendered, titled "Set up your practice", plus a MIDI support note. There
is no theme control anywhere in the app (the token system supports
`data-theme="dark|light"` — `colors.css` — but no UI sets it), no audio output info, and
no home for input management.
**Target:** Rebuild `SettingsScreen.tsx` as `.page--focus` with `.page-header` "Settings"
and four `.card` sections:
1. **Appearance** — theme: a 3-option `.seg-control` (System / Dark / Light). Selecting
   writes `data-theme` on `<html>` (removes it for System) and persists. Persist via the
   existing store mechanism: add `theme: 'system' | 'dark' | 'light'` to
   `persistedShapes.ts` + `persistence.ts` (follow the existing versioned-shape pattern
   in those files exactly; restore applies the attribute before first paint — hook into
   `restoreSession`'s existing flow).
2. **Practice plan** — the current onboarding questionnaire content (experience, goal,
   minutes) presented as a collapsed summary line ("New to piano · A bit of everything ·
   30 min/day") with an Edit button expanding the existing `OnboardingFlow` form inline.
3. **Input** — MIDI status (same data as the UI-04 chip popover, fuller layout), Pair
   Bluetooth action, mic toggle.
4. **Audio** — output route in learner language ("Sound: your piano over MIDI" / "Sound:
   built-in piano sounds").
Exactly one `.btn-primary` on the screen (Save/Finish in the expanded plan editor;
otherwise none — theme applies instantly, instant-apply controls are not primaries).
**Files:** `src/app/onboarding/SettingsScreen.tsx` + test,
`src/app/onboarding/OnboardingFlow.tsx` + test (embed/expand mode),
`src/app/onboarding/useOnboardingGate.ts` + test (only if the rerun wiring needs it),
`src/app/state/persistedShapes.ts` + test, `src/app/state/persistence.ts` (+ its tests),
`src/design-system/css/feature-onboarding.css` — stores are shared, serial.
**Depends on:** UI-01, UI-02, UI-03 (primitives it composes), UI-04 (chip popover content
it mirrors).
**Acceptance criteria:**
- [ ] Theme switches instantly with `--dur-3` surface transition, persists across reload
      (drive: set Light, reload, still Light; set System, OS dark → dark).
- [ ] All four sections render as cards; the questionnaire is collapsed by default and
      expands inline; completing it still writes the same plan data it does today
      (existing tests keep passing).
- [ ] Every control reachable by keyboard; radios/segments show focus; AA in both themes.
- [ ] No regression to first-run onboarding from Today's banner (drive it once).
- [ ] `npm run verify` green.
**Evidence required:** screenshots of Settings (both widths × both themes); a driven
theme-switch + reload; console clean.
`serial: main-thread-only`

### UI-06: Give the score frame presentation options (title, size, chrome)
**Problem:** Every engraved surface prints whatever title the score model holds, at full
engraving scale, inside the same paper card. Rhythm prints the internal placeholder
"Untitled Score" above a clap-along pattern (`state--rhythm-running.png`); Sight reading
prints a redundant "Sight Reading — C major" heading inside the paper while the screen
already has a title; drill staves sit in oversized paper cards with dead margins
(`state--sightreading-running.png`). Screens need to opt out of engraved titles and
choose a compact frame, but `engraver.ts`/`osmdEngraver.ts`/`ScoreViewer.tsx` expose no
such option and are shared by four screens, so this must land before those screen tasks.
**Target:** Extend the app-layer engraving seam (no core changes):
- `ScoreViewer` (and the engraver call behind it) accepts
  `chrome?: { title?: boolean; compact?: boolean }`. `title: false` sets the OSMD
  drawing options to skip title/composer rendering. `compact: true` uses a tighter
  paper padding variant (`.paper--compact` in `domain.css`: `--space-4` padding instead
  of the current large margins) intended for single-staff drill frames.
- Default behaviour unchanged (Practice keeps full title chrome) — all current callers
  render pixel-identical until they opt in.
**Files:** `src/app/score/ScoreViewer.tsx` + test, `src/app/score/engraver.ts`,
`src/app/score/osmdEngraver.ts` + test, `src/design-system/css/domain.css` (compact paper
variant — design-system file, but this task is serialized before all consumers anyway;
run it on the main thread). 
**Depends on:** UI-02.
**Acceptance criteria:**
- [ ] `title:false` produces an engraving with no title/composer block (assert via OSMD
      options in a UI test + drive Rhythm manually to confirm no "Untitled Score").
- [ ] `compact:true` paper uses the tighter padding; normal paper unchanged.
- [ ] All existing callers unchanged visually (screenshot Practice before/after — identical).
- [ ] `npm run verify` green.
**Evidence required:** before/after Practice screenshots (unchanged) + a Rhythm drive
showing the title gone once wired (wiring itself lands in UI-14; here a temporary local
opt-in drive is enough as proof, then reverted).
`serial: main-thread-only`

### UI-07: Redesign the SRS stats strip shared by the drill screens
**Problem:** `flashcards--desktop--dark.png`, `ear-training--desktop--dark.png`: after
every drill sits a full-width row of five zeros — `0 CARDS · 0 DUE NOW · 0 NEW · 0
LEARNING · 0 MASTERED` — plus a "Nothing recorded yet." box plus a "Scheduler details"
disclosure. Three stacked elements of raw scheduler internals, dominating screens whose
star is the drill. On Progress the same component wraps into a broken 2-2-1 grid
(`progress--desktop--dark.png`, "Theory retention").
**Target:** Rebuild `SrsSummary.tsx` on UI-02's `.stat-group`:
- Compact single-line presentation: `cards` icon + "12 cards · 3 to review" as the
  headline (learner language, counts only when nonzero), with the five-way breakdown
  (new/learning/mastered) inside a `chevron` disclosure that also swallows "Scheduler
  details". Empty state: one sentence — "Answers you give here come back for review at
  the right moment — play the first card to start." — no zero-row, no second empty box.
- Layout contained: it renders as a `.card--sunken` footer of its parent column, never
  full-bleed; wraps cleanly at 768px (no 2-2-1 orphan grid).
**Files:** `src/app/srs/SrsSummary.tsx` + `SrsSummary.test.tsx`,
`src/design-system/css/feature-srs-summary.css`. Parallelizable (no other task lists
these files).
**Depends on:** UI-02, UI-03.
**Acceptance criteria:**
- [ ] Zero-data state is one teaching sentence; no row of zeros anywhere.
- [ ] Non-zero state (seed by answering ≥1 flashcard in the running app) shows the
      headline counts; breakdown behind disclosure; scheduler jargon (ease, lapses,
      intervals) never visible before disclosure.
- [ ] Wraps to a clean stack at 768px; AA both themes; disclosure keyboard-operable.
- [ ] Consumers (Flashcards, Ear training, Progress) render it without style overrides —
      verify all three in the running app.
- [ ] `npm run verify` green.
**Evidence required:** screenshots of empty + non-zero states on Flashcards, and of the
Progress usage, both widths × both themes; console clean.
`parallelizable`

---

## Screens

### UI-08: Redesign Today — the plan, and the running session
**Problem:** `today--desktop--dark.png`, `state--session-run-1.png`: (a) the plan renders
as a ragged definition list — "Total: 30 minutes", then segment names with their minutes
indented on the next line, then em-dash-joined item rows with lowercase "Open" links at
inconsistent x-positions; (b) two competing primaries (banner "Set up my practice" +
"Start session"); (c) the whole column hugs the left half leaving the right half of a
1280px screen empty; (d) during a running session the onboarding banner stays visible
and "Complete warm-up" is a washed-out blue; (e) the queue is decent but items say
"Upcoming" in `--text-3` (decorative-only token used for real information).
**Target:** `.page--focus` layout.
- **Header:** `.page-header` "Today's session" + subtitle with the date and total ("30
  minutes planned").
- **Duration:** the 15/30/60/custom row becomes a `.field` "Session length" over a
  `.seg-control` + a compact custom input; "Adjust mix" stays a disclosure, its content
  laid out with `.field-row`s.
- **The plan:** one `.card` per segment, in order, each: leading icon (segment kind →
  UI-03 icons), title ("Sight-reading practice · level 1"), right-aligned duration badge
  ("6 min"), and the whole card clickable to open (kill the bare "Open" links; card gets
  hover `--bg-3`, `aria-label` naming the destination). The advisory note ("No score
  loaded…") becomes one `.card--sunken` with the `book` icon, not a bordered box in the
  middle of the list.
- **One primary:** "Start session" as the only `.btn-primary`, pinned directly under the
  plan. The onboarding banner (rendered via `OnboardingGateway`) restyles as a
  `.card--sunken` callout whose action is a plain secondary button — visible, but no
  longer competing — and it hides entirely while a session is running.
- **Running session:** keep the existing step structure (badge, elapsed, checklist,
  queue) but: "Complete warm-up" / the current step's advance action becomes the
  screen's single `.btn-primary`; queue statuses use `--text-2` with per-state icons
  (check = done, play = current, clock = upcoming) instead of `--text-3` text; the whole
  run fits `.page--focus` with the queue as a `.card--sunken` under the active step card.
**Files:** `src/app/session/SessionPlanScreen.tsx` + test,
`src/app/session/WarmupChecklist.tsx` + test, `src/app/session/useSessionPlan.ts` +
test / `src/app/session/useSessionRun.ts` + test (only if presentation needs new derived
state — no scheduling logic changes), `src/app/onboarding/OnboardingGateway.tsx` + test,
`src/design-system/css/feature-today.css`, `src/design-system/css/feature-session-run.css`.
**Depends on:** UI-01…UI-04.
**Acceptance criteria:**
- [ ] Exactly one `.btn-primary` visible in each state (plan: Start session; running:
      the step's advance action; banner demoted).
- [ ] Plan renders as segment cards with icons and duration badges; no em-dash-joined
      strings; no bare "Open" links; every card keyboard-activatable with visible focus.
- [ ] At 1280px the column is centered with balanced margins; at 768px cards stack with
      no horizontal scroll.
- [ ] Running session: banner hidden; queue states use icon+`--text-2`; completing the
      warm-up advances to item 2 (drive it).
- [ ] Copy check: no "0 day(s)"-style plurals, sentence case throughout.
- [ ] `npm run verify` green.
**Evidence required:** screenshots plan + running states, both widths × both themes; a
driven flow: land on Today → adjust duration → Start session → complete warm-up →
open item 2 (screenshot each step); console clean.
`parallelizable`

### UI-09: Practice I — screen structure, transport, and honest feedback readouts
**Problem:** `practice--desktop--dark.png`, `state--practice-playing.png`: (a) the first
element on the practice screen is a raw file-import row ("Import a score (.musicxml,
.xml, .mxl, .mid, .midi) [Choose File] No file chosen") — chrome before content; (b) the
transport row mixes Play/Pause/Stop, measure readout, a tempo slider and a triple-format
tempo string "100% — 100 bpm (written 100)"; (c) the accuracy strip reads as label/value
soup and shows a green "100%" before a note has been played; (d) "What this screen
doesn't check" floats between controls and score; (e) at 768px the strip wraps awkwardly
("avg 0 ms" orphan box, `practice--narrow--light.png`).
**Target:** Restructure `PracticeScreen`/`ScoreScreen` top-to-bottom as: title → transport
toolbar → score. 
- **Import demoted:** score title + composer in `.page-header`; a secondary "Change
  piece…" button in the header's action slot opens the import UI (existing `ImportPanel`)
  in a disclosure/popover — the file input never renders bare at the top.
- **Transport toolbar** (`.toolbar`, sticky below the topbar while the score scrolls):
  Play (icon+label, `.btn-primary` — THE primary of this screen), Pause/Stop as icon
  buttons, then measure position as "Measure 1 · beat 1" in `--text-sm`, then one tempo
  control: the slider + a single "100 bpm" value in `--text-lg` (the "% of written"
  detail moves into the tempo popover/field label: "100% of written 100"). Toolbar wraps
  to two rows at 768px by design, not by accident.
- **Honest feedback strip:** rebuild on `.stat-group`: Accuracy (em-dash "—" until ≥1
  note played, never a fake 100%), Correct, Wrong, Missed, Extra, avg timing. Each
  `.stat` label under value. The strip renders *under the score* (status sits with the
  thing it describes) and only once playback or input has started; before that it is
  absent.
- **"What this screen doesn't check"** becomes an info icon-button beside the accuracy
  strip's "Accuracy" label opening the same text as a popover (still one click away,
  REQ-honesty preserved, no longer a floating band).
**Files:** `src/app/score/ScoreScreen.tsx` + test, `src/app/score/ImportPanel.tsx` + test,
`src/app/practice/PracticeScreen.tsx` + test, `src/app/practice/TransportControls.tsx` +
test, `src/app/practice/TempoControl.tsx` + test, `src/app/practice/TimingFeedback.tsx` +
test, `src/design-system/css/feature-practice.css`,
`src/design-system/css/feature-practice-sections.css`.
**Depends on:** UI-01…UI-04, UI-06.
**Acceptance criteria:**
- [ ] Screen order: header → toolbar → score; import UI only after "Change piece…";
      Play is the only `.btn-primary`.
- [ ] Accuracy shows "—" before any input; after playing 2 wrong notes on the on-screen
      keyboard the strip shows real counts (drive it).
- [ ] Toolbar sticky while scrolling the score; no layout shift when Play/Pause toggle
      (buttons keep width).
- [ ] 768px: toolbar wraps to its designed two-row layout; no orphan boxes.
- [ ] The "doesn't check" text reachable via the info button, keyboard included.
- [ ] `npm run verify` green.
**Evidence required:** screenshots idle + mid-playback (drive Play + type two notes),
both widths × both themes; sticky-toolbar scroll capture; console clean.
`parallelizable` (but see UI-10 — same files, so UI-10 must not run concurrently)

### UI-10: Practice II — setup drawer, keyboard region, recording and review
**Problem:** `practice--desktop--dark.png` lower half: "Practice setup" is an always-open
bordered box with crammed measure fields, a Loop checkbox, "Tempo: 100%" as bare text,
three hand buttons, Metronome checkbox with a disabled Subdivision select exposed, Piano
roll checkbox, then a row of four record/replay buttons (three disabled), then another
"Audio recording" disclosure. ~14 controls visible below the keyboard. The on-screen
keyboard block (checkboxes + hint text + keyboard) is un-grouped and its typing hint is a
full-width text run.
**Target:**
- **Setup drawer:** one `.card--sunken` "Practice setup" `<details>` (collapsed by
  default at level 1, matching the 5.17 gate) reorganized with UI-01 primitives into
  three titled `.field-row`s: *Range* (from/to measure + Loop toggle), *Hands* (a
  3-option `.seg-control` for Left/Right/Both), *Sound* (metronome toggle + subdivision
  select that only renders when metronome is on — a disabled select is never shown).
  Tempo ramp / wait mode / read-ahead stay in their existing "More tools" home.
- **Keyboard region:** keyboard checkboxes become a single compact row above the
  keyboard: "On-screen keyboard" toggle + "Hold for chords" toggle (`.field-inline`);
  the QWERTY hint collapses to one line ending in a "Show keys" disclosure (the full
  A–; map only on demand).
- **Record/replay:** the four-button row becomes one Record toggle button (icon swaps to
  stop-square while recording, label "Record"/"Stop") + a Replay button enabled only
  when a take exists; "Audio recording" merges into the same group as a secondary
  action. Disabled buttons that can never be enabled in the current state are hidden,
  not grayed.
- **Review/assessment overlays** (`ReviewOverlay`, `AssessmentPanel`): restyle onto
  `.card` + `--elev-3` + motion tokens (fade+rise `--dur-2`); verify focus moves into
  the overlay and returns on close.
**Files:** `src/app/practice/PracticeScreen.tsx` + test (again — hence the serialization
with UI-09), `src/app/practice/LoopRangeControl.tsx` + test,
`src/app/practice/HandMuteControl.tsx` + test, `src/app/practice/MetronomeControl.tsx` +
test, `src/app/practice/RecordPanel.tsx` + test, `src/app/practice/ReviewOverlay.tsx` +
test, `src/app/practice/AssessmentPanel.tsx` + test,
`src/app/practice/PracticeKeyboard.tsx` + test, `src/app/keyboardInput/QwertyHint.tsx`,
`src/app/annotations/AnnotationPanel.tsx` + test (restyle onto card),
`src/design-system/css/feature-practice-sections.css`,
`src/design-system/css/feature-audio-recording.css`.
**Depends on:** UI-09.
**Acceptance criteria:**
- [ ] ≤6 interactive controls visible before disclosure on the default level-1 practice
      screen (count them in the screenshot).
- [ ] No disabled control visible that the current state can never enable; subdivision
      only appears when metronome is on.
- [ ] Setup drawer uses field primitives — no crammed labels ("From measure[1]" gone).
- [ ] Record toggle drives a record→stop→replay cycle end-to-end with the on-screen
      keyboard (drive it).
- [ ] Overlay focus management verified by keyboard-only drive.
- [ ] `npm run verify` green.
**Evidence required:** screenshots collapsed + expanded setup, recording active, replay,
both widths × both themes; the driven record/replay flow; console clean.
`parallelizable` (files overlap UI-09: run strictly after it, never concurrently)

### UI-11: Redesign Sight reading around the exercise
**Problem:** `sight-reading--desktop--dark.png`, `state--sightreading-running.png`: idle
state is five small controls stranded top-left in a void; "Start exercise" is
secondary-styled; the customize row crams five labels against five selects; during the
scan countdown the status is a full-width gray box ("Scan the piece — playing in 29s")
with a separate secondary "Begin now" button; the exercise paper prints its own redundant
"Sight Reading — C major" heading inside the sheet.
**Target:** `.page--focus`.
- **Idle:** `.page-header` "Sight reading" + subtitle "Level 1 — notes around middle C"
  (pull the level's short description from the existing level data the screen already
  has). One `.card` holds: a `.field-row` (Metronome toggle · level display) and a
  collapsed "Customize" disclosure whose selects sit in labeled `.field`s in a wrapping
  `.field-row`. "Start exercise" is the `.btn-primary`, directly under the card, before
  any customization.
- **Countdown:** replace the gray box with an in-card state on the paper itself: the
  engraved exercise (chrome `{title:false, compact:false}` via UI-06 — the screen header
  already names the key) with a countdown ring/number overlay top-right of the paper in
  `--text-glance`, caption "Scan the piece first". "Begin now" becomes the
  `.btn-primary` (Start is gone while counting).
- **Playing/afterward:** feedback stays on the paper (ink tokens, unchanged); after the
  exercise the existing result summary (if any) presents via `.stat-group`. If the
  screen has no result summary today, add none — presentation task only.
**Files:** `src/app/sightreading/SightReadingScreen.tsx` + test,
`src/app/sightreading/SightReadingCustomizer.tsx` + test,
`src/app/sightreading/ExerciseScore.tsx`,
`src/design-system/css/feature-sightreading.css`.
**Depends on:** UI-01…UI-04, UI-06.
**Acceptance criteria:**
- [ ] Idle: one primary (Start exercise); controls in one card; column centered at
      1280px — no top-left clump.
- [ ] Customize labels all use `.field` — no label touches a select.
- [ ] Countdown shows on-paper glance-size count; engraved sheet no longer prints its
      own title; Begin now is the primary during countdown.
- [ ] Full flow driven: customize → start → countdown → exercise plays with metronome
      click → completes.
- [ ] `npm run verify` green.
**Evidence required:** screenshots idle/countdown/playing, both widths × both themes; the
driven flow; console clean.
`parallelizable`

### UI-12: Redesign Flashcards as a focused drill stage
**Problem:** `flashcards--desktop--dark.png`, `state--flashcards-answered.png`: a
metronome fieldset (with a literal browser default legend) sits at the top of a
flashcards screen; the level stepper and drill select float centered with crammed
labels; the answer keyboard is a small box hanging left-of-center below a huge card; the
typing hint wraps mid-list; the graded feedback ("✕ Not quite — graded again") is a
full-width bar whose copy is cryptic; the screen mixes center and left alignment.
**Target:** `.page--focus`, everything on one centered axis.
- **Header:** `.page-header` "Flashcards", subtitle names the deck in learner language
  ("Find the note on your keyboard"). Right slot: deck select + level stepper as
  labeled `.field`s (drill config belongs in the header, not floating mid-column).
- **Remove the metronome block entirely** — a metronome has its own screen; flashcards
  gains nothing from tempo (it grades single answers). If a use exists (timed drill),
  it is not visible today; deleting states what it deletes in the commit body.
- **Stage:** the staff card (compact paper via UI-06) centered; under it the prompt
  sentence; under that the answer keyboard centered at the same width as the card, so
  the whole stage reads as one column. QWERTY hint: one line + "Show keys" disclosure
  (same pattern as UI-10 — copy the pattern, not the file).
- **Feedback:** graded result renders as a compact pill on the stage (check icon +
  "Correct" / x icon + "Not quite — it comes back for review"), feedback tokens, enters
  with `--dur-1` fade, never shifts layout (reserve the pill's line height).
- **Footer:** `SrsSummary` (UI-07) as the card-sunken footer.
**Files:** `src/app/drills/FlashcardScreen.tsx` + test,
`src/app/drills/NoteNameAnswerPad.tsx` + test, `src/app/drills/KeySignatureAnswerPad.tsx`
+ test, `src/app/drills/IntervalAnswerPad.tsx` + test, `src/app/drills/StaffNote.tsx` +
test (only if the staff card layout needs it), `src/design-system/css/feature-flashcards.css`.
**Depends on:** UI-01…UI-04, UI-06, UI-07.
**Acceptance criteria:**
- [ ] No metronome UI on the screen; commit body states the deletion.
- [ ] One centered column: card, prompt, answer input all share an axis at 1280px; clean
      stack at 768px.
- [ ] Answering right and wrong (drive both via typed keys) shows the pill with glyph +
      color, zero layout shift (compare screenshots), and next card appears.
- [ ] Deck switch + level stepper in the header work (drive: switch to Key signature
      deck, answer once).
- [ ] `npm run verify` green.
**Evidence required:** screenshots idle/correct/wrong states, both widths × both themes;
driven deck switch; console clean.
`parallelizable`

### UI-13: Redesign Ear training — answers as the interface
**Problem:** `ear-training--desktop--dark.png`, `state--eartraining-item.png`: the screen
opens with a six-line wall of prose about singing pedagogy before any control; Play is
secondary-styled; the answer options ("major third" / "minor third") are small gray
chips — the core interaction of the whole screen is its least visible element; the
status line ("Press Play to hear the first item.") is a full-width gray box.
**Target:** `.page--focus`.
- **Header:** "Ear training" + subtitle naming drill + level ("Intervals, played
  melodically — level 1"). Drill select + level as `.field`s in the header slot.
- **The singing prose** collapses to a one-line `.card--sunken` callout: "🎤 Sing what
  you hear back before answering — it trains twice as much." with a "Why?" disclosure
  containing the current full text verbatim.
- **Stage:** a large Play/Replay control as the `.btn-primary` (icon + "Play item"),
  centered; the persistent what-am-I-hearing statement ("This is a melodic interval…")
  as the stage caption in `--text-lg`.
- **Answers:** each option becomes a large answer card (min `--space-8` tall, `--text-lg`
  label, `.card` with hover raise `--elev-2`), laid out in a wrapping grid; correct/
  incorrect resolve with feedback tokens + glyphs on the card itself (check/x), and the
  existing `RevealPanel` content slots under the answered card, restyled on `.card`.
  This is the Duolingo moment — the answer must feel like the screen's purpose.
- **Footer:** `SrsSummary` (UI-07).
**Files:** `src/app/eartraining/EarTrainingScreen.tsx` + test,
`src/app/eartraining/IntervalAnswerButtons.tsx` + test,
`src/app/eartraining/QualityAnswerButtons.tsx` + test,
`src/app/eartraining/DictationAnswerPad.tsx` + test,
`src/app/eartraining/RevealPanel.tsx` + test, `src/app/eartraining/useEarTraining.ts` +
test (presentation-driven derived state only),
`src/design-system/css/feature-eartraining.css`,
`src/design-system/css/feature-ear-reveal.css`.
**Depends on:** UI-01…UI-04, UI-07.
**Acceptance criteria:**
- [ ] Above the fold at 1280×800: header, callout (one line), Play primary, answer
      cards. No wall of text.
- [ ] Answer cards ≥44px targets at 768px, keyboard-activatable, focus visible; correct
      and wrong states show glyph + color (drive one of each).
- [ ] Reveal content appears under the answered card without layout jump of the grid.
- [ ] Dictation drill (switch to it) renders its pad inside the same stage layout.
- [ ] `npm run verify` green.
**Evidence required:** screenshots idle/answered-correct/answered-wrong + dictation,
both widths × both themes; driven answer flow with audio playing; console clean.
`parallelizable`

### UI-14: Redesign Rhythm — a tap instrument, not a form
**Problem:** `rhythm--desktop--dark.png`, `state--rhythm-running.png`: idle is five
controls in a void; running shows the engraved pattern titled "Untitled Score", then
status as bare text ("Measure 1, beat 4", "Taps: 0"), then a small "Tap" button
bottom-left — the one control the learner must hit repeatedly, rendered at minimum
size in the corner.
**Target:** `.page--focus`.
- **Idle:** header "Rhythm" + subtitle per mode; mode tabs as `.seg-control`; complexity
  stepper + metronome toggle in one `.field-row` card; Start as the `.btn-primary`.
- **Running:** pattern engraved with `chrome:{title:false, compact:true}` (UI-06 — kills
  "Untitled Score"); beat/measure position as `.stat` pair in glance size beside the
  paper; and a **tap pad**: a full-width card-height region (min 160px tall) under the
  paper, `--bg-2` with `--radius-2`, label "Tap here — or press Space", that flashes
  `--accent-dim` on each hit (`--dur-1`) and shows the tap count in `--text-glance` in
  its corner. Space keeps working; the pad is the touch/mouse surface.
- **Clap-back mode** gets the same stage (its listen/respond states label the pad
  "Listen…" → "Now clap it back").
- Feedback per tap (early/late/hit) uses the existing feedback tokens as a glyph+color
  flash on the pad edge, never color alone.
**Files:** `src/app/rhythm/RhythmScreen.tsx` + test, `src/app/rhythm/RhythmClapback.tsx`
+ test, `src/app/rhythm/useRhythmDrill.ts` + test / `src/app/rhythm/useClapbackDrill.ts`
+ test (derived presentation state only), `src/design-system/css/feature-rhythm.css`.
**Depends on:** UI-01…UI-04, UI-06.
**Acceptance criteria:**
- [ ] No "Untitled Score" anywhere (drive both modes).
- [ ] Tap pad ≥160px tall, responds to click/tap and Space identically (drive 4 taps,
      count updates in glance type), flash uses motion tokens.
- [ ] One primary per state (Start idle; the pad is the interface while running — Stop
      is secondary).
- [ ] Both modes driven end-to-end; 768px layout keeps pad full-width thumb-reachable.
- [ ] `npm run verify` green.
**Evidence required:** screenshots idle/running/clap-back both widths × both themes; the
driven tap sequence; console clean.
`parallelizable`

### UI-15: Redesign Technique — the drill card and its history
**Problem:** `technique--desktop--dark.png`: the safety callout is good, but then: level
stepper with overlapping label, "Drill" crammed against a long select, target tempo as a
bare labeled input, Start/Stop secondary, the engraved pattern in an oversized paper
card, keyboard block repeated, and "Clean tempo history — No clean run yet at this
drill." as two bare text lines at the very bottom.
**Target:** `.page--focus`.
- Header "Technique" + drill select and level stepper as header `.field`s.
- Safety callout stays first (restyle on `.card--sunken` + `hand` icon).
- **Drill card:** compact paper (UI-06), target tempo as a `.field` beside the Start
  `.btn-primary` in the card footer; Stop replaces Start in-place while running (no
  width shift).
- **Tempo history:** a `.card` "Clean runs" with either the teaching empty state ("A
  clean run at target tempo advances you — your first is one Start away.") or a simple
  bar/dot sequence of the recorded clean tempos (existing data via
  `useTechniqueDrill`) using accent + `--fb-correct` tokens; numbers in `--text-sm`
  mono. No chart library — a flex row of tokens is enough.
- Keyboard region: same compact pattern as UI-10 (toggle row + one-line hint).
**Files:** `src/app/technique/TechniqueScreen.tsx` + test,
`src/app/technique/useTechniqueDrill.ts` + test (derived display data only),
`src/design-system/css/feature-technique.css`,
`src/design-system/css/feature-technique-safety.css`.
**Depends on:** UI-01…UI-04, UI-06.
**Acceptance criteria:**
- [ ] All labels via field primitives; stepper label outside the group.
- [ ] Start is the single primary; Start→Stop swap has zero layout shift.
- [ ] History card shows the empty state teach-copy, and after one driven clean run (use
      the on-screen keyboard at 60bpm on the five-finger pattern — feasible; if a clean
      run is not achievable by hand, simulate via the fake-input path used by its tests
      and screenshot the populated card from the test harness) shows the run.
- [ ] Safety callout icon + AA in both themes.
- [ ] `npm run verify` green.
**Evidence required:** screenshots idle/running/history states, both widths × both
themes; driven start/stop; console clean.
`parallelizable`

### UI-16: Redesign Metronome as an instrument panel
**Problem:** `metronome--desktop--dark.png`: a settings-form in a void. BPM — the number
a practicing pianist glances at from arm's length — is a 36px-tall input; the beat dots
are 16px circles; "Stopped" is a gray full-width box; Start is secondary; accent chips
are plain buttons; the typography "glance" tier (`--text-glance`, built for exactly
this) is unused.
**Target:** `.page--focus`, instrument-panel composition:
- **Center stage card:** current BPM in `--text-glance` (44px+) with − / + steppers
  flanking it and the slider beneath; tap-adjust by keyboard arrows when focused. Under
  it the beat dots at 24px, active beat fills `--accent` with a `--dur-1` pulse (the
  accent beat gets the stronger `--elev-1` ring), current beat number beside them in
  `--text-xl`.
- **Start/Stop:** one `.btn-primary` toggling in place (icon play/stop + label),
  directly under the stage. The "Stopped" status box dies — the dots + button state
  *are* the status.
- **Meter controls:** beats, beat unit, subdivision, and the accent editor in one
  `.card--sunken` "Meter" `.field-row` (accent editor becomes a `.seg-control`-style
  row of beat toggles).
**Files:** `src/app/metronome/MetronomeScreen.tsx` + test,
`src/app/metronome/AccentEditor.tsx` + test, `src/app/metronome/useMetronome.ts` + test
(only for derived display state), `src/design-system/css/feature-metronome.css`.
**Depends on:** UI-01…UI-04.
**Acceptance criteria:**
- [ ] BPM readable at arm's length: `--text-glance`, centered stage.
- [ ] Start/Stop toggles in place; running state visible from dots alone (drive 2 bars;
      confirm the accent beat is visually distinct beyond color — size/ring).
- [ ] Beats/unit/subdivision/accents grouped in the Meter card with field primitives.
- [ ] Keyboard: slider and steppers adjust BPM; all controls focus-visible.
- [ ] `npm run verify` green.
**Evidence required:** screenshots stopped + running (catch the pulse), both widths ×
both themes; driven tempo change + accent edit while running; console clean.
`parallelizable`

### UI-17: Restructure Theory into tabbed tools
**Problem:** `theory--desktop--dark.png`: one 5,400px page stacking four unrelated tools —
drill panel, circle of fifths, chord & scale reference (with seven diatonic-chord blocks
each rendering a keyboard + staff), and chord lookup. The degree table uses mono
uppercase internal vocabulary styling; "Play the X chord" buttons right-float per row;
nothing above tells you the page has four tools.
**Target:** `.page--wide` with an in-page tab bar (local `useState`, **no route changes**
— routes stay as-is so deep-linked drills keep working; the drill deep-link param simply
preselects the Drills tab):
- Tabs: **Drills** (existing `TheoryDrillPanel` + keyboard), **Circle of fifths**
  (the SVG centered, with its existing interactivity), **Scales & chords** (the
  reference: root/scale pickers as header fields; the scale card; then the diatonic
  chords as a **grid of compact cards** (keyboard diagram + play button per card,
  staff engraving behind a "Show notation" toggle per card — the seven stacked
  keyboard+staff pairs collapse to one screenful), **Chord lookup** (existing lookup,
  fields via primitives).
- Tab bar is a `.seg-control` under the page header; selected tab persists in
  `useState` only.
- Degree table: restyle as a normal `.card` table — degree names in sentence case
  (`--text-md`), no mono caps; fingering columns labeled "Right hand"/"Left hand".
**Files:** `src/app/theory/TheoryScreen.tsx` + test,
`src/app/theory/ChordScaleReference.tsx` + test, `src/app/theory/ChordLookup.tsx` + test,
`src/app/theory/TheoryDrillPanel.tsx` + test, `src/app/theory/CircleOfFifths.tsx` + test
(sizing/layout only), `src/app/theory/KeyboardDiagram.tsx` + test (compact-card sizing
prop only — this file is consumed by Lessons: change must be additive-prop only, default
rendering identical), `src/app/theory/ScaleStaff.tsx` / `ChordStaff.tsx` + tests (compact
framing), `src/design-system/css/feature-theory.css`,
`src/design-system/css/feature-chord-staff.css`.
**Depends on:** UI-01…UI-04, UI-06.
**Acceptance criteria:**
- [ ] Four tabs; each tab's content fits within ~2 screenfuls at 1280×800 (diatonic
      grid collapses the seven blocks).
- [ ] Deep link `/theory/<drill-kind>` still opens the drill (drive one from Today).
- [ ] Tab bar keyboard-operable (arrow keys or tab+enter), selected tab AA in both
      themes.
- [ ] `KeyboardDiagram` default rendering unchanged (Lessons screenshots identical —
      verify one lesson before/after).
- [ ] Degree table: no mono-caps internal vocabulary; learner-language headers.
- [ ] `npm run verify` green.
**Evidence required:** screenshots of all four tabs, both widths × both themes; driven
deep-link from Today → theory drill; Lessons keyboard-diagram before/after; console
clean.
`parallelizable`

### UI-18: Redesign Repertoire — a browsable graded library
**Problem:** `repertoire--desktop--dark.png`: the worst screen in the app. Every row
concatenates title+attribution+level with no separators ("Au Clair de la
LuneTraditional (French folk melody, 18th c., composer unknown)Level 1"), rendered as
40 bullet items with "Add" buttons at 40 different x-positions. The two library
sections ("Review due", "Graded library") and the loaded-score panel have no visual
distinction. No search, no level grouping beyond the sort.
**Target:** `.page--wide`.
- Header "Repertoire" + subtitle ("Pieces graded to your level — add them to practice").
- **My pieces / Review due** as the first section: `.card` list rows (title, level
  badge, last-practiced, review-due badge using `--warn` + clock icon); teaching empty
  state per DESIGN rule 6.
- **Library:** grouped by level — a `.section-header` per level ("Level 1 — five-finger
  patterns"; short label from existing level data if present, else just "Level N")
  with the piece rows as a **table-like list**: title (`--text-md`, `--text-1`),
  attribution (`--text-sm`, `--text-2`, separated by real spacing, not concatenated),
  right-aligned level badge + ghost "Add" button aligned in a fixed column. A filter
  row above: text search (client-side, over title/composer) + the existing "Below my
  level" toggle.
- Fix the string concatenation at its source in the row markup (the data has the
  fields; the JSX just runs them together).
**Files:** `src/app/repertoire/RepertoireScreen.tsx` + test,
`src/app/repertoire/useRepertoire.ts` + test (search filter derived state),
`src/design-system/css/feature-repertoire.css`.
**Depends on:** UI-01…UI-04.
**Acceptance criteria:**
- [ ] No concatenated strings — title/attribution/level visually separated in distinct
      type roles (read one row aloud test).
- [ ] Add buttons aligned in one column; rows are ≥44px targets at 768px.
- [ ] Level group headers present; search narrows the list live (drive "twinkle" → 1
      row); "Below my level" toggle still works.
- [ ] Empty states for My pieces and Review due teach the next action.
- [ ] `npm run verify` green.
**Evidence required:** screenshots full library + search-filtered + empty my-pieces,
both widths × both themes; driven search + add-piece flow (add one, see it in My
pieces); console clean.
`parallelizable`

### UI-19: Redesign Progress as a dashboard
**Problem:** `progress--desktop--dark.png`: the title column is empty while content
starts in column 2; "Practice streak & weekly time" collides with the Reference button;
levels show as a big numeral *plus* a redundant select dropdown right under it; exit
criteria render disabled radio buttons as status icons with "Not met" as their label;
three disabled "Advance" buttons each followed by a full-width explainer box; "0
day(s)"; the trend/assessment/tempo panels are three gray empty boxes; Theory retention
wraps 2-2-1; Milestones is an orphaned disclosure; Export is a dark card bottom-left.
**Target:** `.page--wide`, a real dashboard grid (CSS grid in `feature-progress.css`,
12-col at 1280px, stacking at 768px):
- **Row 1 — the learner's status:** three `.card`s: *Streak* (flame icon, "0 days" —
  fixed plural — current + longest in `.stat-group`), *This week* (minutes in
  `--text-glance` + the per-category minutes as a compact list), *Levels* (three
  tracks as "Playing · Level 1" rows with a small progress affordance; **remove the
  redundant level selects** — manual level override moves behind a "Adjust level…"
  ghost button opening the selects in a popover; overriding is an escape hatch, not
  the primary UI).
- **Row 2 — advancement:** one `.card` per track: criteria as a checklist (check icon
  `--fb-correct` when met / hollow circle when not — never radio inputs), each with
  its progress % in `--text-sm`; the Advance button only renders when enabled
  (`.btn-primary` — at most one can be actionable at a time realistically; if
  multiple, they're all enabled and that's acceptable: they are separate cards).
  The "Not every exit criterion is met yet." box dies — the checklist says it.
- **Row 3 — evidence:** trend charts (`TrendChart`) and assessment/tempo panels as
  cards with teaching empty states; Theory retention embeds `SrsSummary` (UI-07 —
  fixes the 2-2-1 wrap); Milestones becomes a card with achieved/total shown on the
  face (`MilestonePanel` restyle).
- **Row 4:** Practice sheet + Export as two side-by-side cards (Export keeps JSON/CSV
  + restore; restore's destructive nature gets a confirm step if it lacks one —
  presentation-level confirm only).
**Files:** `src/app/dashboard/DashboardScreen.tsx` + test,
`src/app/dashboard/TrendChart.tsx` + test, `src/app/dashboard/MilestonePanel.tsx` +
test, `src/app/dashboard/useDashboard.ts` + test (derived display data),
`src/app/progress/ExportPanel.tsx` + test, `src/app/progress/PracticeSheet.tsx` + test
(entry card only — the printable sheet itself is out of scope),
`src/app/progress/activityKindLabels.ts`,
`src/design-system/css/feature-progress.css`,
`src/design-system/css/feature-milestones.css`.
**Depends on:** UI-01…UI-04, UI-07.
**Acceptance criteria:**
- [ ] No radio inputs as status; no disabled Advance buttons; no redundant level
      selects on the card face.
- [ ] Grid balanced at 1280px (no empty first column, no heading collisions) and
      stacks cleanly at 768px.
- [ ] Copy: "0 days", sentence case, no "(s)" anywhere on the screen.
- [ ] Empty states teach (each names the screen/action that will populate it).
- [ ] With seeded data (answer 2 flashcards, run 1 sight-reading exercise via the
      app), This week + retention update (drive it).
- [ ] `npm run verify` green.
**Evidence required:** screenshots empty + seeded states, both widths × both themes;
console clean.
`parallelizable`

### UI-20: Redesign Lessons as master–detail
**Problem:** `lessons--desktop--dark.png`: sixteen full-width lesson buttons stack
above the selected lesson's body — reading a lesson means scrolling past the whole
catalog; the em-dash "— playing — 11 min" metadata repeats on every row; no
completed/current state on rows; the level tabs + track chips are two unaligned filter
rows; the lesson body's demo/technique rows are more em-dash strings with stray "Open"
buttons.
**Target:** `.page--wide`, master–detail:
- **Desktop (≥1024px):** left column (~20rem) is the lesson list: level `.seg-control`
  + track filter chips at top, then lesson rows (title, track badge + minutes in
  `--text-xs`, check icon when completed — completion data exists in
  `useLessons`/progress; if it does not, show no state rather than inventing one),
  selected row highlighted like the nav (rail + `--accent-dim`). Right column is the
  lesson body on a `.card`: title, duration, prose at `--text-lg`/`--leading-loose`,
  diagrams centered, and the lesson's exercise links as proper item cards (icon +
  title + minutes + chevron — same pattern as Today's plan cards).
- **Narrow (<1024px):** list collapses to a select-like drawer: choosing a lesson
  shows the body full-width with a back control.
- "Next lesson: …" becomes a `.btn-primary` card footer at the end of the body.
**Files:** `src/app/lessons/LessonsScreen.tsx` + test, `src/app/lessons/LessonBody.tsx`
+ test, `src/app/lessons/useLessons.ts` + test (selection/completed derived state),
`src/design-system/css/feature-lessons.css`,
`src/design-system/css/feature-lesson-diagrams.css`.
**Depends on:** UI-01…UI-04.
**Acceptance criteria:**
- [ ] Desktop: list + body side by side; selecting a lesson never scrolls the catalog
      out from under you; selected row visibly active.
- [ ] Narrow: list→body→back flow driven by touch-size targets.
- [ ] Lesson exercise links are cards, keyboard-activatable, and still open the right
      destinations (drive "Find middle C" → technique).
- [ ] Body prose uses the lesson type tier (`--text-lg`, loose leading).
- [ ] `npm run verify` green.
**Evidence required:** screenshots desktop master–detail + narrow list and body, both
themes; driven lesson-switch + exercise-open; console clean.
`parallelizable`

---

## Cross-cutting polish (after all screen tasks merge)

### UI-21: Empty, loading, and error states sweep
**Problem:** Foundations and screen tasks fix the states they touch, but nobody owns
the full matrix. Known gaps from the audit: several screens have no loading state at
all (score parsing, soundfont fetch); error states (failed import, failed audio) are
untested visually; the `.empty-state` primitive exists but adoption is partial.
**Target:** Build the matrix: for each of the 13 screens × {empty, loading, error,
no-MIDI} determine applicable states, drive each one in the app (deny MIDI permission,
import a corrupt file, throttle to see loading, wipe IndexedDB for empty), fix every
state that renders as a blank region, raw text, or dead end to use `.empty-state` /
`.card--sunken` + teach-copy + the one next action. Record the matrix as a table in
`docs/DESIGN.md` (which state exists where, what it says).
**Files:** any `src/app/**` screen/component file needing a state fix (this task runs
alone — cross-file by design), `src/design-system/css/feature-empty-states.css`,
`docs/DESIGN.md`.
**Depends on:** UI-08…UI-20 (all screen tasks).
**Acceptance criteria:**
- [ ] The matrix table exists in DESIGN.md with every cell marked shipped/n-a.
- [ ] No screen state renders a blank region, bare "no items" text, or a dead end.
- [ ] Corrupt-file import shows a learner-language error with recovery (drive it with
      a text file renamed .musicxml).
- [ ] `npm run verify` green.
**Evidence required:** screenshots of every fixed state (both themes; width where
layout-relevant); the corrupt-import drive; console clean.
`serial: main-thread-only`

### UI-22: Motion and micro-interaction pass
**Problem:** Motion tokens exist but the app is static: button presses don't
acknowledge (DESIGN rule 5's 100ms), cards appear/disappear with hard cuts, graded
answers and completed sessions — the emotional peaks of a learning app — have no
moment. The one animation rule ("nothing animates inside the notation frame except
the cursor") must survive.
**Target:** A catalog pass, not per-screen improvisation. In `primitives.css` +
`motion.css`: press states on all buttons (translate+shade, `--dur-1`); disclosure
open/close (`--dur-2` height/opacity where cheap); overlay/popover enter (fade+rise
`--dur-2`); answer-feedback pulse (one shared keyframe pair: `fb-pop` scale
1→1.04→1 + color, `--dur-2`) applied to flashcard pill, ear-training cards, rhythm
pad; session-complete: a one-time card raise + check-draw on the Today run's final
state (`--dur-3`, once, no confetti — this app's voice is calm). Document each in a
DESIGN.md "Motion" section with its trigger. Verify reduced-motion collapses all of
it (the global rule already does — confirm nothing opts out with `!important`).
**Files:** `src/design-system/css/primitives.css`, `src/design-system/tokens/motion.css`
(only if a new duration/ease is genuinely needed), the specific component files listed
per micro-interaction above (flashcard pill in `drills/`, answer cards in
`eartraining/`, pad in `rhythm/`, session-complete in `session/`), matching
`feature-*.css` files, `docs/DESIGN.md`.
**Depends on:** UI-21.
**Acceptance criteria:**
- [ ] Every visible button acknowledges press within 100ms (spot-check with slow-mo
      screen recording or devtools).
- [ ] Graded-answer pulse on flashcards + ear training; session-complete moment on
      Today (drive all three).
- [ ] Nothing animates inside the paper frame except the cursor (inspect Practice
      while playing).
- [ ] With `prefers-reduced-motion: reduce` emulated, no animation runs (drive one
      graded answer under emulation).
- [ ] `npm run verify` green.
**Evidence required:** screen recording or sequenced screenshots of the three moments;
the reduced-motion drive; console clean.
`serial: main-thread-only`

### UI-23: Accessibility and keyboard sweep
**Problem:** Screen tasks each carry a11y criteria, but only a whole-app pass catches
the seams: focus order across shell→page, focus restoration after overlays, AA
contrast of every token pairing actually used, roles on the composed primitives, and
whole-flow keyboard drives.
**Target:** For each screen: Tab from the top of the document through to the end —
order must follow visual order; every interactive element shows `--focus-ring`; drive
each screen's core flow keyboard-only (start a session, play+stop practice, answer a
flashcard, answer ear training, run the metronome, tap rhythm with Space, add a
repertoire piece, switch theory tabs, open a lesson, change a setting). Fix what
fails. Run a contrast audit over the used token pairs in both themes (script it:
computed styles via Playwright + a contrast function in the script — tooling lives in
`scripts/`, not shipped); `--text-3` may fail only in its documented decorative
usages — flag any informational use found and fix by promoting to `--text-2`.
**Files:** any `src/app/**` file with a violation; `scripts/a11y-contrast-audit.mjs`
(new, dev-only); `docs/DESIGN.md` (append audit result note).
**Depends on:** UI-22.
**Acceptance criteria:**
- [ ] All ten keyboard flows above driven end-to-end without a mouse.
- [ ] Contrast script reports zero AA failures for informational text in both themes;
      `--text-3` appears only decoratively.
- [ ] No focus trap except intentional (drawer, overlays), all with Escape + restore.
- [ ] `npm run verify` green.
**Evidence required:** the script's output table; screenshots of focus rings on the
worst three offenders found (before/after); console clean.
`serial: main-thread-only`

### UI-24: Final visual QA against DESIGN.md, and make the doc true
**Problem:** After 23 tasks by different workers, drift is certain: spacing
inconsistencies between sibling screens, copy tone wobble, a stray unconverted
control, and a DESIGN.md whose "known worst offenders" section still describes the
old app.
**Target:** Run the full DESIGN.md visual-pass checklist on all 13 screens at 1280px
and 768px in both themes (52 passes) *as a picky stranger*. Fix small deviations
inline (spacing, alignment, copy); file anything slice-sized as a new ROADMAP entry
rather than expanding this task. Then rewrite DESIGN.md's worst-offenders section to
describe the *current* truth, update the screenshot set in `docs/ui-audit/` with
"after" images (same filenames, so diffs tell the story), and add the two page
archetypes + form/motion/icon sections if any foundation task's documentation
drifted from what actually shipped.
**Files:** any `src/app/**` or `src/design-system/css/feature-*.css` file with a nit
(runs alone); `docs/DESIGN.md`; `docs/ui-audit/*.png` (refreshed); `ROADMAP.md` (new
entries only).
**Depends on:** UI-23.
**Acceptance criteria:**
- [ ] All 52 checklist passes recorded (a simple pass/fail table per screen in the
      task report), every fail either fixed or filed.
- [ ] Every screen: exactly one primary action, ≤6 controls before disclosure,
      learner language throughout (read every visible string aloud).
- [ ] DESIGN.md describes the shipped system — a new reader finds no stale claims.
- [ ] `docs/ui-audit/` holds current screenshots.
- [ ] `npm run verify` green.
**Evidence required:** the pass/fail table; refreshed screenshot set; console clean.
`serial: main-thread-only`

---

## Execution notes

- **Order:** UI-01→02→03→04→05→06→07 (foundation, serial except 07), then UI-08…UI-20
  in any order / in parallel (UI-10 strictly after UI-09), then UI-21→22→23→24.
- **Parallel-collision check:** among parallelizable tasks, file ownership is disjoint
  by construction — each owns its screen directory + its own `feature-*.css` stub
  (created in UI-02). Shared components are pinned: `OnScreenKeyboard.tsx` (no task
  edits it), `KeyboardDiagram.tsx` (UI-17 only, additive prop), `SrsSummary` (UI-07
  only), engraver/`ScoreViewer` (UI-06 only), `QwertyHint.tsx` (UI-10 only — UI-12
  copies the pattern, not the file).
- **Worktree workers** follow `docs/WORKTREES.md`: branch `task/UI-<nn>`, own port,
  main checkout merges serially with `npm run verify` between merges.
- Screenshots for comparison: `docs/ui-audit/` (2026-08-12 baseline, fresh profile).
