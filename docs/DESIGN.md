# DESIGN.md — the UX bar

The token/primitive layer already exists and is good: `src/design-system/` (color, spacing,
typography, elevation, motion, z-index tokens; primitives styled off native elements and ARIA
attributes; domain and responsive css). **Never** raw hex, raw px spacing, or ad-hoc button
styles at point of use — always tokens and primitives.

**All three text tokens are AA text (roadmap 5.51).** `--text-1`/`--text-2`/`--text-3` all hold
≥4.5:1 against every `--bg-0`…`--bg-3` surface in their own theme — `--text-3` is the quiet
tertiary tone (e.g. an upcoming/inactive state, a chart axis label), not a "decorative, contrast
doesn't matter" tone. There is no token in this system whose comment says it's exempt from AA;
if you're tempted to add one, use `--paper-muted`/opacity on a non-text element (icon stroke,
border, placeholder hint) instead of inventing a low-contrast text color. Verify any new text
token or reused one with `node scripts/review-probe.mjs contrast --url <dev-server>` before
shipping — it measures the live CSSOM, not the token file, so it catches what the pair actually
renders as, not what it was intended to be.

What has been missing is not tokens but *composition*: screens accreted controls with no
hierarchy (the Practice screen reached 30 controls in 13 groups over ~5100px of scroll).
These rules govern composition, and the checklist below is the experience gate's visual pass
(`docs/PROCESS.md` step 3).

## Form primitives

The "label + control" unit (roadmap UI-01): a label never touches its control — if you typed a
label as bare text next to an input, you skipped a primitive.

- **`.field`** — the default: label above control, `--space-1` gap. One labelled input, select,
  or textarea.
- **`.field-row`** — a horizontal run of `.field`s (BPM / Beats / Beat unit); wraps to one column
  at ≤640px.
- **`.field-inline`** — label and control on one line, `--space-2` gap; short inline cases only.
  Checkbox/radio still use their own `<label><input type="checkbox" />text</label>` shape (rule 9
  below), never `.field-inline`.
- **`.stepper`** — bordered `[−] value [+]` group. The label is never inside it — wrap the group
  in a `.field`/`.field-inline` instead.
- **`.seg-control`** — single-select segmented group (replaces ad-hoc button rows: 15/30/60 min,
  mode tabs). Selection reads `[aria-checked="true"]`, `[aria-current]`, or `.selected` —
  callers own the role (`radiogroup`/`radio`, `tablist`/`tab`, …).

## Page scaffold

A screen is `.page > .page-header + sections` — never a bare stack of controls (roadmap
UI-02, 2026-08-12 UI audit: no screen shared a layout skeleton before this — Flashcards
centered its column while every other screen left-aligned, and several screens rendered a
small clump of controls in ~80% void at 1280px).

- **`.page`** — the content column: centered, `--content-pad` padding, direct children
  separated by `--space-5` (the vertical rhythm — a screen never hand-rolls its own margin
  between sections). Two archetypes: **`.page--focus`** (48rem — single-task screens: drills,
  metronome, sight reading) and **`.page--wide`** (`--content-max`, 72rem — dashboards:
  progress, theory, repertoire, lessons).
- **`.page-header`** — the title row: `h1`, optional subtitle, optional right-aligned action
  slot. A screen title appears exactly once, here.

## Icons

`src/design-system/icons/icons.ts` holds one consistent glyph family (roadmap UI-03,
2026-08-12 UI audit: the app had no icons beyond the ☰ hamburger and Unicode clef glyphs —
nav was 13 text labels, Play/Pause/Stop/Record/Tap/Add were text-only, and MIDI connected/not
had no glyph at all, a color-only signal that breaks rule 8 below). 24x24 viewBox,
`stroke="currentColor"`, 1.75px stroke, round caps/joins, no fills — drawn by hand, not pulled
from a library. Render with `<Icon name="..." />` (`src/app/ui/Icon.tsx`); size defaults to
`1em` so it scales with the surrounding font size. The 24 names: `play, pause, stop, record,
metronome, keyboard, ear, rhythm, hand, book, cards, target, chart, settings, midi-plug,
bluetooth, check, x, chevron-down, chevron-right, plus, minus, clock, flame`.

**Icons are always `aria-hidden` and unfocusable.** An icon never carries its own accessible
name — the adjacent text does, or, for an icon-only `.btn-icon`, an explicit `aria-label` on
the button does. `button`/`.btn` already lay out `gap: --space-2` between children, so
`<button><Icon name="play" /> Start</button>` composes with no per-call CSS.

## Screen rules

1. **One primary action per screen.** Exactly one `.btn-primary`, positioned where the eye
   lands first. Everything else is secondary, ghost, or hidden. **Start / Play / Begin count
   as primaries** — a screen whose true entry point renders as a default-styled gray button
   has not satisfied this rule, even if some other control happens to carry `.btn-primary`.
2. **Progressive disclosure.** Defaults visible; configuration collapsed. A learner-facing
   screen shows at most ~6 interactive controls before disclosure (`<details>`, tabs, or a
   settings drawer). Advanced/diagnostic controls (tempo ramp numbers, fingering entry,
   record/replay) are never open by default.
3. **Adding means demoting.** A slice that adds a visible control to an existing screen must
   name what it demotes, groups, or hides. Screens only ever get denser by explicit decision.
4. **Hierarchy reads top-down:** what am I doing → the content (score, staff, prompt) → how I
   act on it. Status/readouts sit with the thing they describe, not in a separate pile.
5. **Feedback within 100ms.** Every press acknowledges instantly (state change, motion token,
   or sound). Anything slower gets a pending state.
6. **Empty states teach.** A screen with no data says what the learner will get and offers
   the one action that gets them there — never a blank region or a raw "no items".
7. **Learner language.** No internal vocabulary on screen: no MIDI numbers ("Key 48"), no
   SRS jargon ("ease", "lapses"), no 0-based measure indices, no parameter names. Copy is
   sentence case, short, and speaks piano.
8. **Both themes are first-class.** Dark is the base (evening practice); notation always sits
   on `--paper`. Color is never the only signal — every feedback state keeps its glyph cue.
9. **Every touch target clears 44px, tablet and up (roadmap B.6).** `--control-h` already
   grows to `--touch-min` (44px) at `≤1024px` (`tokens/spacing.css` / `responsive.css`) and
   every primitive tracks it — new controls get this for free by using a primitive rather than
   a bare styled element. Two things `--control-h` does NOT cover on its own:
   - **Checkbox/radio.** The native box stays its small unstyled size by design; the `<label>`
     wrapping it (every consumer already writes `<label><input type="checkbox/radio" />text
     </label>`) is the real tap target, and `primitives.css`'s `label:has(> input[type=
     "checkbox"], > input[type="radio"])` rule is what sizes THAT to `--control-h`. Do not
     wrap a checkbox/radio any other way, or it falls outside this rule.
   - **The on-screen keyboard.** A key is not a generic control — width comes from
     `--white-key-w`/`--black-key-w` (`domain.css`), floored to 44px for `--black-key-w` at
     tablet widths (`responsive.css`) since a real piano's black keys are narrower than its
     white ones and never clear 44px at a reasonable white-key size otherwise. The
     `.chord-scale-reference` diagram resets that floor: its keys are plain, non-interactive
     `<div>`s (`KeyboardDiagram.tsx`), not a touch target, and flooring them too would draw a
     black key wider than the tiny white key next to it.
   A keyboard wide enough to need horizontal scroll (the full practice/technique range) must
   actually scroll, not shrink: `.keyboard-diagram .key` is `flex-shrink: 0` for exactly this
   reason — losing it silently reintroduces sub-44px keys with no visible diff to catch it.

## The visual pass checklist

Run on every changed screen: 1280px and ≤1024px, dark and light. Screenshot each; judge as a
picky stranger, then fix before ticking. A screen with touch input also gets the tablet pass:
768x1024 and 1024x1366, real touch emulation (not just a narrow mouse viewport) — see
`e2e/tablet-touch-targets.spec.ts`.

- [ ] The primary action is obvious within 3 seconds, and there is exactly one.
- [ ] ≤ ~6 interactive controls visible before disclosure; related controls grouped, groups
      titled, advanced ones collapsed.
- [ ] Spacing and alignment come from tokens; nothing visually floats or crowds an edge.
- [ ] Text contrast AA on every text role, including `--text-3` (roadmap 5.51: it is the
      quiet tertiary reading tone, not an AA exemption — ≥4.5:1 against every surface tone
      in its own theme; verify with `node scripts/review-probe.mjs contrast`); focus rings
      visible; the whole flow drivable by keyboard.
- [ ] Empty / loading / error / no-MIDI states all render intentionally.
- [ ] No layout shift or jank while interacting; motion uses the motion tokens.
- [ ] Copy passes rule 7 (learner language) — read every visible string aloud.
- [ ] Honest question: *would a stranger call this screen clean?* Hesitation = fail.

## Known worst offenders (fix as slices, per ROADMAP Phase 5)

- Practice screen density and flatness — roadmap 5.17 / 5.18 (progressive disclosure,
  control hierarchy).
- 12 flat nav items, no grouping, no routing — roadmap 5.42 / 5.43.
- First-run lands on the densest screen with no guidance — roadmap 5.39 / 5.40 / 5.41.
- MIDI-number key labels — roadmap 5.25; SRS jargon — 5.31; raw category keys — 5.16.
