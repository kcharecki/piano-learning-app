# DESIGN.md — the UX bar

The token/primitive layer already exists and is good: `src/design-system/` (color, spacing,
typography, elevation, motion, z-index tokens; primitives styled off native elements and ARIA
attributes; domain and responsive css). **Never** raw hex, raw px spacing, or ad-hoc button
styles at point of use — always tokens and primitives.

What has been missing is not tokens but *composition*: screens accreted controls with no
hierarchy (the Practice screen reached 30 controls in 13 groups over ~5100px of scroll).
These rules govern composition, and the checklist below is the experience gate's visual pass
(`docs/PROCESS.md` step 3).

## Screen rules

1. **One primary action per screen.** Exactly one `.btn-primary`, positioned where the eye
   lands first. Everything else is secondary, ghost, or hidden.
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

## The visual pass checklist

Run on every changed screen: 1280px and ≤1024px, dark and light. Screenshot each; judge as a
picky stranger, then fix before ticking.

- [ ] The primary action is obvious within 3 seconds, and there is exactly one.
- [ ] ≤ ~6 interactive controls visible before disclosure; related controls grouped, groups
      titled, advanced ones collapsed.
- [ ] Spacing and alignment come from tokens; nothing visually floats or crowds an edge.
- [ ] Text contrast AA (`--text-3` is decorative-only by design); focus rings visible;
      the whole flow drivable by keyboard.
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
