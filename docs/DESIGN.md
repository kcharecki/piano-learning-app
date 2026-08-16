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
- **`.stepper`** value cell — a `.stepper-value` span, or an `<input type="number">` carrying that
  same class where an exact value has to be typeable (Metronome's BPM, roadmap UI-24). Both shapes
  render as one `[−] value [+]` group; the input is not an extra control, it is the same cell.
- **`.seg-control`** — single-select segmented group (replaces ad-hoc button rows: 15/30/60 min,
  mode tabs). Selection reads `[aria-checked="true"]`, `[aria-current]`, or `.selected` —
  callers own the role (`radiogroup`/`radio`, `tablist`/`tab`, …).
- **`.list`** — a bordered row list. **Its `.list > li` rule has specificity (0,1,1) and will beat
  a single-class feature rule (0,1,0) on the same `<li>`.** That is not theoretical: it silently
  won `display: flex` + `align-items: center` over `.level-track-row`'s `flex-direction: column`
  (collapsing every Progress level bar to 0px width) and over `.exit-criterion`'s
  `align-items: flex-start`, both shipped and both found by UI-24's visual pass, not by any test.
  If you style an `<li>` inside a `.list`, scope through the parent
  (`.level-track-list > .level-track-row`) or you are writing a rule that does not apply.

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

## Shell composition

The shell (`Shell.tsx`) is chrome, built like a screen: rail, topbar, main — never ad hoc.

- **Nav rail (`.app-nav`, `NavGroups.tsx`)** — Today stands alone at the top, visually
  primary; everything else groups into Practice / Learn / Drills / Progress, inside
  `.nav-scroll`, the rail's own scroll box (`flex: 1 1 auto; min-height: 0; overflow-y: auto`)
  — the only part of the rail that ever scrolls. Every item is a 16px `<Icon>` + left-aligned
  label. The active item gets a 2px `--accent` rail on its left edge plus `--accent-dim` fill —
  never accent-colored TEXT, which reads as "needs attention" on an item already selected; the
  rail is the non-color cue rule 8 requires.
- **Rail footer (`.nav-rail-footer`)** — a `flex: none` sibling of `.nav-scroll`, pinned to the
  bottom of the rail and never scrolled away regardless of how far the destination list runs.
  Holds two tiers, in order: at >1024px only, the shell's action cluster (`.nav-actions` — the
  input-status chip, then the Reference toggle); then, unconditionally, the current playing
  level and streak, display only, copy in the adjectival "N-day streak" form so it never needs
  a plural branch.
- **Topbar (`.app-topbar`, roadmap UI-36) — ≤1024px only, not in the DOM above that.** It used
  to render unconditionally (a hamburger + screen title + the action cluster, every width) but
  its one real desktop cost — a permanent 56px band of nothing between the topbar and the
  sticky rail on any scrolled desktop page (roadmap UI-34's own measured argument) — turned out
  to have no fix that did not also delete it. Above 1024px the identical hamburger+title content
  has nothing to do (the rail is a static sidebar, not a drawer, and every screen's own
  `.page-header` already carries the title), so the whole element is gone, not just hidden.
  What remains at ≤1024px: a hamburger + screen title, and the SAME action-cluster JSX the rail
  footer holds above 1024px, right-aligned in `.topbar-actions`.
- **One action-cluster instance, ever** — `Shell.tsx` renders the input-status chip + Reference
  toggle as a single JSX expression, mounted into exactly one of `.topbar-actions` (≤1024px) or
  the rail footer's `.nav-actions` (>1024px), never both. This is what lets a single ref
  (`referenceToggleRef`) always point at a real, visible button: two independently rendered
  copies would leave it pointing at whichever mounted last, silently wrong the other half of
  the time. Crossing the breakpoint unmounts and remounts the cluster (its own popover-open
  state resets; nothing about a live Bluetooth MIDI pairing does — that lives in
  `useBluetoothMidi.ts`'s module-scope singleton, untouched by this remount) and costs two Tab
  stops: at >1024px, Tab from the rail's last destination lands on the chip, then Reference,
  before reaching `<main>` — `.app-nav` no longer ends at the last nav item, it ends at the
  action cluster.
- **Drawer (≤1024px only)** — `.app-nav` becomes an off-canvas panel; `.nav-scrim` dims the
  page behind it with the `--scrim` token, fading in over `--dur-2` on open (it unmounts
  instantly on close — no fade out — because the drawer's own e2e proof asserts the scrim is
  removed from the DOM, not merely hidden, once dismissed). Escape closes the drawer and
  returns focus to the hamburger, the same contract the Reference panel already proves for its
  own drawer.

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

## Motion

`--dur-1`(120ms)/`--dur-2`(200ms)/`--dur-3`(320ms) + `--ease-out`/`--ease-in-out`
(`tokens/motion.css`). Global `prefers-reduced-motion: reduce` already collapses every rule
below to 1ms — never fought with `!important`. Nothing animates inside the notation paper
frame except the playback cursor.

- **Press** (`--dur-1`) — every button, not just `.btn-primary`: a shade plus a 1px sink
  (`primitives.css`, base `button:active`/`.btn:active`). Every variant inherits it; none
  override `transform`.
- **Disclosure reveal** (`--dur-2`) — `<details>` content fades + rises in on open
  (`details[open] > :not(summary)`, `primitives.css`). One rule, every disclosure in the app.
  No exit animation — content leaves the tree the instant `[open]` is removed.
- **Overlay/popover enter** (`--dur-2`) — fade + rise, `dialog[open]` (`primitives.css`).
  Covers every native `<dialog>` (Practice's Change-piece/accuracy-info popovers, the
  Review/Assessment breakdown dialogs); a caller with its own `[open]` rule
  (`.review-overlay-dialog`, `.assessment-breakdown-dialog`) overrides it on specificity, not
  conflict. The Reference panel and the topbar input-status popover are neither `<details>` nor
  `<dialog>`, so each opts in by name: the Reference panel slides in
  (`feature-reference-panel.css`) and the input-status popover reuses the same `disclosure-in`
  keyframes (`feature-bluetooth-midi.css`, roadmap UI-24 — it was the last surface in the app
  with no entrance motion). **Every floating surface now has one.**
- **Answer-feedback pulse** (`--dur-2`) — `fb-pop` (`primitives.css`): scale 1 → 1.04 → 1 plus
  a brightness lift, `transform`/`filter` only so it can never shift layout. One keyframe pair,
  three callers: the Flashcards result pill, the Ear training answer cards
  (`.answer-card[data-state]`), the Rhythm tap pad's per-tap flash
  (`.rhythm-tap-pad-flash`). A caller whose graded state can repeat unchanged on the same DOM
  node (the Flashcards pill, reused across a whole deck) retriggers it itself — remove class,
  force reflow, re-add; callers that remount fresh per graded item/tap (Ear training, Rhythm)
  get it for free from the class simply starting to match.
- **Session-complete** (`--dur-3`, once) — a card raise plus a check-draw
  (`stroke-dasharray`/`stroke-dashoffset` on the check glyph) on Today's final run state
  (`feature-session-run.css`). Fires once because the whole card only mounts between "the run
  just finished" and the next "Plan a new session" click. No confetti.

## Screen rules

1. **At most one primary action per screen.** Never two `.btn-primary` on one screen. **Exactly
   one** on a screen that has a single dominant action, positioned where the eye lands first;
   everything else secondary, ghost, or hidden. **Start / Play / Begin count as primaries** — a
   screen whose true entry point renders as a default-styled gray button has not satisfied this
   rule, even if some other control happens to carry `.btn-primary`.
   **Zero is correct on a screen with no dominant action** (roadmap UI-24 settled this against
   the rule's earlier "exactly one per screen" wording, which four shipped screens contradicted).
   The test: finish the sentence *"the learner came here to ___"* with one control. If you can't,
   the screen has none, and **manufacturing one is worse than having none** — an arbitrary focal
   point teaches the learner to trust a signal that is lying. Repertoire has forty equally-valid
   *Add* buttons and no reason to promote one; Settings is configuration where every control
   commits itself; Progress is read-only evidence; Theory's Drills tab and Flashcards are
   answered by playing the keyboard, which is the action surface — a button beside it would be a
   decoy. Current state, measured at 1280px: **one** on Today (Start session), Practice (Play),
   Sight reading (Start exercise), Metronome (Start), Lessons (Next lesson: …), Ear training
   (Play item), Rhythm (Start), Technique (Start); **zero** on Repertoire, Flashcards, Theory,
   Progress, Settings. Lessons is a master/detail split at ≤1024px: the list view has none and
   the lesson view it opens into carries the primary. A screen moving from zero to one, or one to
   zero, is a design decision — say so in the slice, and update this list.
2. **Progressive disclosure.** Defaults visible; configuration collapsed. A learner-facing
   screen shows at most ~6 interactive controls before disclosure (`<details>`, tabs, or a
   settings drawer). Advanced/diagnostic controls (tempo ramp numbers, fingering entry,
   record/replay) are never open by default — **including on Practice**, which is the screen
   this whole rule set was written for (see the opening paragraph) and therefore the last screen
   that may hold an exception. Roadmap UI-24 settled that: `.practice-setup` shipped `open`,
   which put Practice at 21 visible controls and left Record — named in this rule — on screen at
   load; it now defaults closed, like "More tools". Roadmap 5.18's promise that a level-1 learner
   gets those controls without hunting is kept by the *level gate* (they are present and named at
   level 1), not by the default open state.
   **Count controls, not content.** A row in a list of lessons, catalogue pieces or flashcards is
   content the learner is scanning, not a control competing for the primary action, and it does
   not count against the ~6. Repertoire's 40 *Add* buttons and Lessons' 25 lesson buttons are
   lists; their filters, level tabs and search field are controls, and those are what the budget
   governs. Without this distinction every list screen fails the rule by construction, which is
   the same as the rule not existing.
   Measured 2026-08-15 at 1280px with `Element.checkVisibility()` (a closed `<details>` still
   reports a non-zero bounding rect in Chromium, so a rect-based count silently includes
   everything the learner cannot see — that mistake inflated Practice from 10 to 20 during this
   very pass): Sight reading 3, Repertoire 4, Flashcards 5, Ear training 6, Rhythm 6, Settings 6,
   Progress 7, Technique 8, Theory 8, **Practice 10**, Today 12, Metronome 12, Lessons 13 (9 at
   ≤1024px). **Today, Metronome and Lessons are over the bar and known to be** — see "Known gaps".
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

## States matrix (roadmap UI-21)

Every screen × {empty, loading, error, no-MIDI}, from a full states sweep (2026-08-15) —
**shipped** = drives correctly in the running app; **n/a** = the state cannot occur here, with
why. "No-MIDI" means the screen's own primary interaction still works with no MIDI keyboard
(the shell's topbar chip + Settings' own Input card cover the connection status itself, on
every screen, and are not re-listed per row).

| Screen | Empty | Loading | Error | No-MIDI |
|---|---|---|---|---|
| Today | n/a — plan always has ≥1 item | shipped — "Loading today's session…" | shipped — session-length validation alert | n/a — no note input, links out |
| Lessons | shipped — "No lessons for this level." | n/a — static bundled content | n/a — no failure mode | n/a — no note input |
| Practice | n/a — auto-loads the bundled sample | shipped — "Loading the bundled sample score…" | shipped — corrupt-import alert, learner language | shipped — on-screen keyboard |
| Sight reading | n/a — generated on demand | n/a — generation is synchronous | shipped — "Could not generate an exercise…" | shipped — on-screen keyboard (UI-21: was a dead end, now wired into the real matcher) |
| Flashcards | shipped — "No cards at this level yet…" | n/a — deck build is synchronous | n/a — no error surface | shipped — on-screen keyboard / button pads |
| Ear training | n/a — idle stage offers Play | n/a — generation is synchronous | n/a — no error surface | shipped — on-screen keyboard / button pads |
| Rhythm | n/a — tap pad always available | n/a — synchronous | n/a — no error surface | n/a — taps a button/Space, no note input |
| Technique | shipped — "your first is one Start away" | n/a — synchronous | n/a — no error surface | shipped — on-screen keyboard |
| Metronome | n/a — always has bpm/meter state | n/a — synchronous audio engine | shipped — engine error alert | n/a — no note input |
| Theory | n/a — a drill item is always seeded | shipped (defensive; seeding is synchronous so this cannot currently show) | n/a — no error surface | shipped — on-screen keyboard; drill counter now the `.stat` primitive (UI-21) |
| Repertoire | shipped — library/review/catalogue all teach + link out | n/a — store hydrates silently | shipped — add-piece alert (duplicate/cap) | n/a — no note input |
| Progress | shipped — every card branches to its own teach-copy | n/a — store hydrates silently | n/a — no error surface | n/a — no note input |
| Settings | n/a — always has theme/plan/audio content | n/a — synchronous | n/a — no error surface | shipped — its own always-visible Input card |

Fixed in the UI-21 states sweep: sight reading's missing no-MIDI fallback (the one screen with
genuinely no way to answer without hardware); the microphone path leaking raw browser exceptions
(`describeMicError`, mirroring `webmidi.ts`'s shape); Theory's bare `0 / N played` and the nav
rail's bare `0-day streak` (both zero-rows, rule 6); the "Audio recording" and "Adjust mix"
disclosures rendering as inert captions (missing chevron, global `summary` reset had dropped
the native marker); Practice's bare `Tempo: 100%` string; "From measure" / "to measure"
capitalisation.

Fixed in the UI-24 visual pass, which found the row above had missed one: **Progress' Streak card
still printed `0 days / 0 days`** on a never-practised profile — the last zero-row in the app, and
the only card on that screen with no empty branch while every one of its neighbours already had
one. The Empty column for Progress now means every card, Streak included.

## Fixed, and what replaced them

The five entries this section used to list as "known worst offenders" are all shipped. Kept as a
record of what the rules above are actually made of — each rule exists because one of these hurt.

| Was | Now |
|---|---|
| Practice: 30 controls in 13 groups over ~5100px of scroll | 10 controls, one score, two closed disclosures (5.17 / 5.18 / UI-09 / UI-10 / UI-24) |
| 12 flat nav items, no grouping, no routing | Today alone at the top + four titled groups, icons, real routes (5.42 / 5.43 / UI-04a) |
| First run landed on the densest screen with no guidance | Today is the entry point, with a one-minute setup offer (5.39 / 5.40 / 5.41) |
| MIDI-number key labels ("Key 48"), SRS jargon ("ease", "lapses"), raw category keys | Learner language throughout (5.25 / 5.31 / 5.16), enforced by rule 7 |
| No screen shared a layout skeleton; several rendered a clump of controls in ~80% void | `.page > .page-header + sections`, two archetypes, on all 13 screens (UI-02) |

## Known gaps

Open, measured, and deliberately not fixed in the pass that found them. Do not re-report these
as new findings; either fix one properly as a slice or leave it.

- **Today shows 12 controls** (rule 2's bar is ~6): the first-run banner's two buttons, the
  session-length segmented control (3), the custom-minutes field, the "Adjust mix" summary, one
  "Open …" button per plan item (4), and Start session. The per-item Open buttons are arguably
  content, but each is a real button and they are counted rather than argued away.
- **Metronome shows 12 controls.** BPM (field, −, +, slider), Start, and the Meter card's Beats /
  Beat unit / Subdivision / four accent buttons. The Meter card is configuration and belongs
  behind a disclosure; it is not there yet because collapsing it would change what several
  metronome specs reach without an expand step.
- **Lessons shows 13 at 1280px** (5 level tabs, 4 track chips, 3 "Open …" buttons, Next lesson);
  9 at ≤1024px, where the detail pane is a second view. The level tabs and track chips are a
  two-axis filter that would read better as one control.
- **Repertoire is 5000px of ungrouped catalogue** with no disclosure between the level headings.
  It passes rule 2 on the count-controls-not-content reading above, but "would a stranger call
  this clean?" is a hesitation, and hesitation is a fail.
- **`.app-main` and `.page` both declare `max-width`.** The padding half of the redundancy is
  fixed; the `max-width` half is still declared in both places.
