# UX & pedagogy review — 2026-08-12 (M5 acceptance pass, roadmap 5.49)

A re-run of [ux-pedagogy-review-2026-08-06.md](ux-pedagogy-review-2026-08-06.md)'s method, adversarially:
the running app driven as an adult beginner from an **empty IndexedDB**, contrast measured from the
**live CSSOM** at both themes, and every pedagogy claim re-checked against the **same primary sources**
(RCM 2022 syllabus + technical requirements charts, ABRSM 2025–26 practical syllabus and aural guides,
Faber Piano Adventures' own scope-and-sequence, the Golandsky/Taubman material, Elissa Milne).

**M5's exit condition is every one of the 17 aspects at ≥ 9/10. It is not met.** Nine aspects reach 9
or better; **eight do not**. Each of those eight has a task proposed below and appended to Phase 5.

Method and tooling, so the next pass re-runs rather than rebuilds it:

- `npm run verify` — green. `npx playwright test` (E2E_PORT=5280) — **123/123 green**.
  `npm run verify:full` — **exit 1**, at the `knip` step only; see "What I could not verify".
- `node scripts/review-probe.mjs walk|contrast|claims --url http://localhost:5280` (**new this pass**,
  kept deliberately — the 2026-08-06 review's method existed only as prose). `walk` reads the nav
  destination list *off the running app* so a destination added since cannot be silently skipped;
  `contrast` computes the ratio of **every** visible text-bearing element against its own effective
  background at both themes on every destination, which is deliberately broader than the original's
  six-token table; `claims` seeds IndexedDB behind the app's back and reads engraved output.
- `node scripts/visual-pass.mjs <destination> --url http://localhost:5280` — screenshots at both
  widths and both themes, console-clean check. Screenshots in `visual-pass/5-49*`.

Findings are marked **[driven]** in the browser, **[measured]** as a number off the live page,
**[code]** read from source, **[cited]** verified against an external authority this pass.

**The nav has 13 destinations now, not 12** — Settings was added by 5.40. All 13 were driven
**[driven]**: Today · Practice · Sight reading · Repertoire · Metronome · Lessons · Flashcards ·
Ear training · Rhythm · Technique · Theory · Progress · Settings. Console clean on all 13.

---

## Scores at a glance

| # | Aspect | 2026-08-06 | 2026-08-12 | Δ | One-line verdict |
|---|---|---:|---:|---:|---|
| 1 | Breadth of features | 9 | **10** | +1 | 13 destinations; mic, Bluetooth MIDI, piano roll, session runner, practice sheet all real. |
| 2 | Visual design system | 8 | **7** | −1 | Real gains, but 27 measured AA failures on every screen — the system broke its own written rule. |
| 3 | Engineering rigour | 9 | **9** | 0 | 3900 unit tests, 123 e2e green. Two ticked boxes still missed a screen each. |
| 4 | **First-run experience** | 2 | **9** | **+7** | Lands on Today with an onboarding callout, a real plan, warm-up first, one obvious action. |
| 5 | Information architecture | 3 | **8** | +5 | Real routing, grouped nav — but the group labels are the least legible text on screen, and "level" means two different numbers. |
| 6 | **Practice screen usability** | 3 | **9** | **+6** | 1895px, not 5100px. Transport pinned, disclosure genuinely gated by level. |
| 7 | Playable content | 2 | **7** | +5 | 1 score → 40. But the screen claims "Für Elise / Beethoven" for content the repo's own ledger says is not a verified transcription. |
| 8 | **Input accessibility** | 3 | **9** | **+6** | On-screen keyboard, QWERTY, mic, Bluetooth MIDI, honest capability banner. |
| 9 | **Lesson content quality** | 6 | **9** | +3 | The G major lesson now demonstrates the G major scale. 46 lessons re-audited. |
| 10 | Sight-reading pedagogy | 5 | **7** | +2 | D♯ minor gone; level 1 genuinely stepwise. Level 2 still jumps to a minor 7th, and level 1 reads whole notes before quarters. |
| 11 | Ear training pedagogy | 4 | **7** | +3 | Interval staging now matches RCM exactly. The "tonal context" is an open fifth, not the tonic triad RCM specifies. |
| 12 | Rhythm drill | 2 | **8** | +6 | Really engraved, really quarters-first. Titled "Untitled Score". |
| 13 | **Technique** | 5 | **9** | +4 | Fingerings on the staff; the blind-spot statement is on screen and is accurate. |
| 14 | **Theory reference** | 6 | **9** | +3 | Minor fingerings shipped, chords engraved, the modes' `—` replaced by a sentence that checks out. |
| 15 | **Progress & motivation** | 4 | **9** | +5 | Passes the behind-the-back seed test exactly. All seven screens log. |
| 16 | Accessibility (a11y) | 7 | **7** | 0 | Shape cues and Bravura landed; AA regressed on every screen. Net flat. |
| 17 | **Overall as a teaching product** | **4.5** | **8** | **+3.5** | It is now a real teaching product with real content. It is not yet an honest one everywhere. |

**Nine aspects at ≥ 9** (1, 3, 4, 6, 8, 9, 13, 14, 15). **Eight below** (2, 5, 7, 10, 11, 12, 16, 17).
**M5 does not exit.**

---

## The seven things that hold M5 below its bar

### 1. The design system violates its own written rule, on every screen, in both themes — **[measured]**

`src/design-system/tokens/colors.css:26` documents the token in its own comment:

> `--text-3: #7b838e;` `/* decorative only — fails AA on purpose */`

Two features shipped *during M5* then used it for load-bearing text. Measured from the live CSSOM
across all 13 destinations, **27 AA failures**, every one of them this token:

| Element | Owner | Dark | Light | Needs |
|---|---|---:|---:|---:|
| `.nav-group-title` — the `PRACTICE`/`LEARN`/`DRILLS`/`PROGRESS` labels | `feature-nav-groups.css:37` (roadmap **5.43**) | 4.36 | **3.12** | 4.5 |
| `.session-plan-warmup-note` — "opens as a checklist" | `feature-session-run.css` (roadmap **5.45**) | pass | **2.90** | 4.5 |

The irony is exact: 5.43's group labels are *the* fix for aspect 5 (information architecture), and they
are now the least legible text in the product. `feature-ear-reveal.css`'s own comment shows the rule was
understood elsewhere — *"`--text-2` is the AA-compliant secondary tone; `--text-3` is…"* — so this is
drift, not disagreement.

Confirmed visually as well as numerically in `visual-pass/5-49/today-light-1280.png`.

**Also found, not fixed (minor):** on a page taller than the viewport the `.app-nav` column's background
stops at ~897px rather than filling the scroll height — visible in `practice-dark-1280.png`.

→ **task 5.51**

### 2. The Repertoire screen makes a claim the repo's own ledger does not support — **[driven] [code]**

Driven, catalogue row read verbatim:

```
Für Elise (Theme A)  Ludwig van Beethoven (1770–1827)  Level 3  [Add]
```

The screen says nothing else. Probed for any provenance wording anywhere in `<main>`
(`/rendition|excerpt|not a verified|approximation|arrangement/i`) — **false** **[driven]**.

`src/content/scores/LICENSE.md` and `gradedPieces.ts`'s own module doc are candid about what these files
are **[code]**: "a faithful rendition of the named melody/theme in its stated key, **not a verified
note-for-note transcription** of a specific edition", with four of the classical pieces "a
**stylistically-faithful excerpt** rather than a scholarly one", most files 2–6 bars, and 14 of the 20
level-1–2 pieces added by 5.3 flagged as "this app's own rendition" rather than source-verified.

None of that reaches the learner. Roadmap 5.1/5.3 were scrupulous in the ledger and silent on screen,
which is the worst of both: the honesty exists and does no work. A beginner practising this believes
they are learning Beethoven's Für Elise.

**Teacher's view:** this is the one finding here that a teacher would call a straightforward
misrepresentation. Volume was the 2026-08-06 problem and it is solved — 1 → 40 pieces, all resolving to
real bundled MusicXML, "Open in Practice" working **[driven]**. Accuracy is now the problem, and the fix
is a label, not a re-transcription.

→ **task 5.52**

### 3. Sight reading: level 2 leaps a minor seventh, one step after a stepwise level 1 — **[measured] [cited]**

The ladder's headline bug is genuinely gone: **D♯ minor is no longer in it** (`levelDefaults.ts`), and
level 1 is a real stepwise-one-direction line. Measured off the *engraved output*, not the table — the
right-hand line's consecutive intervals, 5 draws per level, level seeded straight into
`sightReadingHistory` **[measured]**:

| Seeded level | Intervals sampled | Max leap | Distribution |
|---|---:|---:|---|
| 1 | 15 | **2 st** | 1×5, 2×10 — genuinely stepwise |
| 2 | 55 | **10 st** | includes 6, 7, 9, and 10 st ×4 |
| 3 | 153 | 10 st | |
| 4 | 144 | 10 st | |
| 5 | 243 | 11 st | |
| 6 | 228 | 12 st | |

A learner goes from "never larger than a whole step" to "may be handed a **minor seventh**" in one
level. Faber's own site says Level 1 prepares reading "with intervals **up through the 5th**"
([Faber Level 1 Q&A](https://pianoadventures.com/piano-books/basic-piano-adventures/level-1/q-and-a/)) **[cited]**;
RCM Level 1–2 sight playing is "a four-measure melody… divided between the hands"
([RCM 2022 syllabus](https://rcmusic-kentico-cdn.s3.amazonaws.com/rcm/media/main/about%20us/rcm%20publishing/piano-syllabus-2022-edition.pdf)) **[cited]**.
The 2026-08-06 review's "level 1 → 2 is a cliff" finding therefore still stands, and in leap terms the
cliff is *wider* than the P5 it originally objected to.

Levels 2, 3 and 4 all share `maxLeap: 10`, so the column the ladder grades on is flat across three
levels — and `levelDefaults.ts`'s own comment explains why: `maxLeap` is sized so the cadence walk can
reach the row's range, i.e. **for generator reachability, not for pedagogy** **[code]**.

Credit where due, all re-verified this pass: the 30-second preview is real and on screen ("Scan the
piece — playing in 28s"), matching ABRSM's *"half a minute to look through"* exactly **[driven] [cited]**;
the top level is E major (4♯), and ABRSM introduces four sharps at Grade 5 with six sharps appearing at
no grade at all **[cited]** — so a six-level ladder topping out at E major is defensible.

→ **task 5.53**

### 4. Sight reading level 1 reads whole notes before quarters — **[code] [cited]**

`levelDefaults.ts` level 1 is `rhythm: 'whole-half'`; level 2 is the first `'quarters'`. Driven: a
level-1 exercise engraves four whole notes **[driven]**, `sight-reading-dark-1280.png`.

This is the *identical* defect roadmap 5.20 fixed for the Rhythm drill and never applied here. The
primary source is unambiguous: Faber Piano Adventures Primer introduces **the quarter note, then the
half, then the whole — all inside Unit 2**, with the dotted half in Unit 3
([official Primer Teacher Guide](https://primerguide.pianoadventures.com/)) **[cited]**. 5.20's own
justification cites this order; the sight-reading ladder still inverts it.

→ **task 5.54**

### 5. Ear training's "tonal context" is an open fifth, and both cited syllabi specify a triad — **[code] [cited]**

Roadmap 5.28 shipped a context sound before every item, defaulted on and visible on screen ("Play tonal
context before each item") **[driven]**. What it plays is documented in its own code as **"a drone:
tonic + fifth"** (`useEarTraining.ts:157`, `CONTEXT_BEATS`/`scheduleContext`) **[code]**.

An open fifth has no third, so it **cannot establish major or minor**. Both cited authorities specify
something that can:

- **RCM 2022:** "The examiner will identify the key, **play the tonic triad once**, and play the melody
  twice." **[cited]**
- **ABRSM 2025–26 (aural, p.45):** "The examiner will **play a tonic chord** (to establish the key) and
  then play the test once." **[cited]**

The app's level 1 interval set is exactly **{major 3rd, minor 3rd}** — driven, two buttons and no others
**[driven]**, `ear-training-dark-1280.png`. Mode is precisely the information a bare fifth withholds and
precisely what distinguishes those two answers. Second, smaller point: the drone anchors on *the item's
own lower sounding note* (`chords.ts:221` — "establishes the ROOT") rather than on a key, so for an
interval item it arguably hands over the bottom note rather than supplying tonal context.

**Correction to the 2026-08-06 review, in the app's favour.** That review stated, cited: *"ABRSM's aural
tests contain **no interval-identification test at any grade**."* Re-checked against the syllabus this
pass: **false.** Interval identification is Test 3 at **Grades 6, 7 and 8** ("identify two intervals
played separately" at 6–7, four at Grade 8) **[cited]**. The app's interval drill is better supported
than the original review allowed.

Also verified against the source and **correct**: 5.30's staging is RCM's, level for level **[cited]** —
RCM Level 1 = {m3, M3}, Level 2 adds P5, Level 3 adds P4, Level 4 adds the octave; the app does exactly
this. A genuine, checkable win.

One residual, smaller than the drone: RCM's melodic playback is **4 notes at Preparatory A and 5 at
Level 1** **[cited]**; 5.34 set the app's level 1 to **2–3**. The app is systematically shorter than the
syllabus it cites at the bottom of the ladder.

→ **task 5.55** (drone), **task 5.58** (dictation length)

### 6. The rhythm drill engraves beautifully and calls it "Untitled Score" — **[driven]**

`visual-pass/5-49/rhythm-dark-1280.png`: a real staff, real quarters and halves, no rests at complexity
1 — exactly what 5.19/5.20 promised, and exactly what Faber's verified Unit 2 order and Unit 10
quarter-rest-last placement call for **[cited]**. The text stand-in is gone.

The engraving's title reads **"Untitled Score"**. That is verbatim the cosmetic defect the 2026-08-06
review named, and roadmap **5.13 is ticked as having fixed it** — 5.13 gave titles to `generateMelody`
and `techniqueScore` (both confirmed fixed this pass: "Sight Reading — C major", "C major five-finger
pattern, right hand" **[driven]**) and never touched `rhythmToScore`. A ticked box that covered two of
three call sites.

→ **task 5.56**

### 7. One skill, two numbers, both called "level" — **[driven]**

In a single driven session **[driven]**: the Progress screen read **"Sight-reading: level 4
(overridden)"** while the Sight reading screen read **"Level 1"**, and Progress's own accuracy-trend
panel read "Level 1" beside its own level-4 selector.

These are two different stores and both are legitimate — the track level in `settings/levelState`
(learner- and curriculum-facing, adjustable on Progress) and the trainer's adaptive level in
`sightReadingHistory` (REQ-3.4.6's 80–90% band, deliberately not learner-settable). Nothing is broken.
But the same word labels both, on two screens, with no explanation of either, and a beginner setting
"Sight-reading: level 4" on Progress and then finding level 1 exercises has been told something false by
omission. I found this only because seeding one did nothing to the other.

→ **task 5.57**

---

## Aspect-by-aspect evidence

### Breadth of features — 9 → **10**
13 destinations driven, console clean on all 13 **[driven]**. Since the original: real bundled scores
(40), on-screen/QWERTY/microphone/Bluetooth-MIDI input, progressive disclosure, sight-reading
customizer, engraved rhythm + clap-back, practice logging from all seven activity screens, theory chord
lookup and chord-on-staff, a non-modal reference panel, first-run onboarding, milestones, piano roll,
audio recording, a runnable session with warm-up, a printable practice sheet, Settings. Nothing named in
the original as missing-in-kind is still missing.

### Visual design system — 8 → **7**
See finding 1. Offsetting genuine gains, all re-verified: Bravura bundled and self-hosted, shape cues
now actually applied to noteheads (5.24 — the original's "dead CSS"), 44px touch targets asserted by
e2e at 768×1024 and 1024×1366, and the tablet nav drawer genuinely fixed (5.27 found it was *really*
broken). Score falls anyway because the measurable property the aspect is scored on — contrast from the
live CSSOM — got worse: 0 failures on the pairs the original measured, **27** across everything the
learner actually reads.

### Engineering rigour — 9 → **9**
`npm run verify` green: docs budget, `tsc -b --noEmit`, eslint `--max-warnings 0`, **190 test files /
3900 tests** in 10.4s. `npx playwright test` **123/123 green** against the real dev server. Property
tests on theory/timing, injected `Clock`/`Rng`, perf budget spec present and passing. Held at 9 rather
than raised because two ticked boxes were found this pass to have missed a call site each (5.13 →
finding 6; and 5.43/5.45 shipped the contrast regression under a green suite) — the project's own
stated failure mode, still live.

### First-run experience — 2 → **9**
From a genuinely empty IndexedDB **[driven]**: lands on `/today`, not Practice. An onboarding callout —
"New here? Set up your practice in under a minute" with "Set up my practice" / "Not now" — sits above a
real 30-minute plan that already has content in it (warm-up 5 min first, technique, sight-reading,
lesson, theory/ear), an honest note that no score is loaded yet and what to do about it, and a single
"Start session". Re-runnable from Settings, which is its own destination now. All 13 destinations have
honest empty states (5.41). A beginner can tell what to do first. `today-light-1280.png`.
Not 10: the goal answer is captured but does not yet bias the mix, and one experience answer sets all
three tracks together — both stated openly in 5.40 rather than hidden.

### Information architecture — 3 → **8**
Real routing verified by driving: the URL changed at every one of the 13 destinations
(`/today`, `/practice`, `/sight-reading`, …) **[driven]**; deep links and Back are covered by
`e2e/routing.spec.ts`, green. Nav is grouped — Today standalone, then Practice / Learn / Drills /
Progress as `role="group"` landmarks. Held to 8 by finding 7 (two meanings of "level") and finding 1
(the group labels themselves fail AA at 3.12:1 — an IA fix that is hard to read is only half a fix),
plus the known gap that a lesson body is still not deep-linkable (flagged in 5.42, not re-litigated).

### Practice screen usability — 3 → **9**
**[measured]** `main.scrollHeight` = **1895px** at 1280px wide, against the original's ~5100px. Level-1
learner sees, in order: import, title, Play/Pause/Stop + tempo, MIDI status, accuracy strip, a
one-click "What this screen doesn't check", the score, the on-screen keyboard with its QWERTY hint, and
one **open** "Practice setup" disclosure holding loop/hands/metronome/piano-roll/record. Wait mode,
assessment, tempo ramp, read-ahead and annotations are **absent**, not merely collapsed, until the
`playing` track level earns them. `practice-dark-1280.png`. The 59 raw control count is 37 piano keys
plus 22 real controls.

### Playable content — 2 → **7**
40 catalogue rows render, every one resolving to a bundled `.musicxml`; "Below my level" filter works;
"Open in Practice" loads and grades a chosen piece (`e2e/repertoire-open-practice.spec.ts`, green). The
40 Piece Challenge shape is the right target and is correctly cited — Milne's own post confirms ~40
pieces a year at mixed difficulty including below level **[cited]**. Held to 7 entirely by finding 2.

### Input accessibility — 3 → **9**
Driven with **no MIDI hardware and Web MIDI permission denied**, which is the exact case the original
scored 3 for. Practice renders the on-screen keyboard by default with "Play the notes here — they are
graded exactly as a MIDI keyboard would be", plus the QWERTY mapping legend. "Pair Bluetooth MIDI" and
"Use microphone" both present. The `MidiDeviceStatus` line states the real reason ("MIDI access request
failed: Permission to use Web MIDI API was not granted"). Technique has the same keyboard now (5.5a).

### Lesson content quality — 6 → **9**
The original's headline content bug is fixed and was re-driven end to end: Lessons → Level 2 → *The G
Major Scale* → "Open demonstration" navigates to Practice showing **"G Major Scale, One Octave — Right
Hand"** **[driven]**, `visual-pass/5-49-gmajor/`. 46 `demoScoreId` lessons re-audited on five dimensions
by 5.10, with 6 further defects found and fixed there rather than argued away.

### Sight-reading pedagogy — 5 → **7**
Findings 3 and 4. Everything the original praised survives and was re-checked: 30s silent preview
matching ABRSM's stated allowance, forced start, unrepeatable exercises, adaptive band, real engraving,
and now a customization panel exposing key/hands/accidentals (5.12). The "Untitled Score" half of the
original's cosmetic complaint is fixed here specifically ("Sight Reading — C major").

### Ear training pedagogy — 4 → **7**
Finding 5. Genuine, source-verified wins: RCM-exact interval staging, a reveal panel naming the real
sounding pitches with staff and keyboard, the singing limitation stated permanently on screen in plain
language, SRS jargon replaced by New/Learning/Mastered with the scheduler's own words one click away,
and the "it was perfect fifth" article bug fixed.

### Rhythm drill — 2 → **8**
Finding 6. Content is right and now verified against the primary source rather than asserted.

### Technique — 5 → **9**
The 58-number string is gone; fingerings are engraved above their own noteheads, per hand, position-
asserted against each notehead in `e2e/technique-fingering.spec.ts` (green). The blind-spot statement is
permanently on screen, read verbatim in the walk **[driven]**: *"MIDI hears pitch and timing only. It
cannot see wrist height or collapse, forearm alignment, finger curl, which finger you actually used,
shoulder tension, or bench height — a clean, rising tempo history is not a technique check."* Checked
against the Golandsky material: low/dropped wrist and isolated, raised-finger technique are named there
as contributors to tension and injury **[cited]**, so the statement is accurate and not overclaimed.
Notably the app does **not** assert the "Taubman rejects Hanon" line on screen — see "could not verify".

### Theory reference — 6 → **9**
Minor-scale fingerings shipped as a table (the original's "real gap"); minor scales confirmed required
from **RCM Preparatory B** **[cited]**, so the gap was real and is closed. The modes' bare `—` is now
"no standard fingering — modes are not in the graded syllabi", and that sentence checks out
independently: **zero** hits for dorian/phrygian/lydian/mixolydian/aeolian/locrian/whole-tone/blues/
pentatonic in the RCM 2022 technical requirements chart *and* zero in the ABRSM classical piano
syllabus; modes appear only in ABRSM's Jazz syllabus **[cited]**. Chord lookup covers all 13 qualities
incl. sevenths and diminished sevenths, and chords are now engraved on a staff with core's own spelling
(`e2e/theory-chord-staff.spec.ts` reads midi off each notehead — green). Major/Ionian merged.
**Flagged, not deducted:** Theory is now the longest screen in the app at **5407px** of scroll
**[measured]** — more than the ~5100px that earned Practice a 3/10 in 2026-08-06. It is a reference
rather than a task screen, so the same objection does not transfer cleanly, but it is the next screen
that will need 5.17's treatment.

### Progress & motivation — 4 → **9**
Passes the project's own hardest standard. Seeded **5 days × 41 minutes of `eartraining`** directly into
IndexedDB behind the app's back, reloaded, and read the screen **[driven] [measured]**:

> Current streak **0 day(s)** · Longest streak **5 day(s)** · This week **205 min** ·
> Warm-up 0 · Technique 0 · Sight reading 0 · Repertoire 0 · Lesson 0 · Theory 0 · **Ear training 205 min**

5 × 41 = 205 exactly, attributed to the one seeded category, with the streak correctly reading 0 today
(the seeded days end yesterday) and 5 as the longest. The screen follows stored data; it is not
re-deriving a plausible number. Category display names are real words, not raw keys. All seven activity
screens log (`e2e/practice-log-all-screens.spec.ts`, green), and `warmup` is written now rather than
being a permanent zero.

### Accessibility — 7 → **7**
Up: `.note-correct`/`.note-wrong`/`.note-missed` are actually applied now, so notehead feedback carries
shape as well as hue (the original's one real a11y defect); keys read "C4" rather than "Key 48"; Bravura
is bundled so clef glyphs no longer depend on OS fallback; 44px targets and the tablet drawer verified.
Down: 27 measured AA failures across every destination in both themes, worst **2.90:1**, on text that
carries the navigation's own structure. Net flat.

### Overall as a teaching product — 4.5 → **8**
The 2026-08-06 verdict was "an impressive engine wrapped around almost no content, aimed at nobody in
particular". Both halves are answered: there are 40 pieces and a curriculum that runs, and the app now
has an obvious front door aimed squarely at an adult beginner. What keeps it off 9 is a different
problem from the original one — not absence, but **unearned precision**: a catalogue that names
Beethoven for an approximation, a "tonal context" that cites RCM for something RCM does not specify,
navigation labels below AA, and a second-rung sight-reading exercise that can leap a minor seventh.
Every one is small. None is hidden in a place a learner will not reach.

---

## What I could not verify — stated rather than assumed

- **`npm run verify:full` exits 1.** The failure is entirely at the **`knip`** step ("Unused
  devDependencies: @stryker-mutator/core, @testing-library/dom" + 8 "Unlisted binaries"), and it is an
  artefact of this worktree: `node_modules/` here is an **empty directory** shadowing the repo-root
  install, so knip resolves nothing. `npm run verify` (docs budget + typecheck + lint + all 3900 tests)
  is green, and `npx playwright test` — the step `verify:full` never reached because `&&` short-
  circuited — is **123/123 green** when run directly. I did not run `npm ci` (the brief forbids it), so
  **I have not proven knip passes on a clean install**; I have only localised the failure.
- **Microphone input end to end.** No microphone hardware in this environment. 5.7's algorithm and
  state machine are property-tested; the "a sung note grades" path remains unproven by driving, exactly
  as 5.7 itself said.
- **Bluetooth MIDI and real MIDI hardware.** No BLE or MIDI device available. The controls render and
  the capability banner tells the truth; the pairing path is unproven here.
- **Whether any bundled score matches a published edition.** I did not have the editions. The repo's own
  ledger says several do not, which is the basis of finding 2 — but "Für Elise is wrong" is *not* a
  claim I am making; "the screen does not say what the ledger says" is.
- **Alfred's Basic Piano Library scope and sequence** — every official and third-party PDF was
  image-only or unreachable. The original review cited Faber *and Alfred* for the quarter→half→whole
  order and steps-before-skips; **only the Faber half is verified this pass.**
- **Faber/Alfred on hands-together timing** — NOT PROVEN. No scope-and-sequence text found that pins
  where genuinely independent hands-together playing appears, so roadmap 5.46's recalibration of level
  1's exit criterion is reasonable but is **not** source-backed by this pass.
- **"Taubman rejects Hanon"** — NOT PROVEN as a citation. The rejection of *isolated finger technique*
  is well attested; no source reached names Hanon and gives a stated rationale. The app does not make
  this claim on screen, so nothing needs fixing — but ROADMAP.md's 5.23 prose asserts it.
- **The warm-up's jaw claim.** `warmups.ts` renders "Drop your jaw open… Piano tension hides in the jaw
  first." Juilliard's Basic Warm-Up Guide verifies **shoulders and posture** but is an at-the-bench
  routine and **does not mention the jaw at all** **[cited]**; no other source was found for it. A small
  unearned claim on screen — folded into 5.52's "say only what you can support" rather than its own task.
- **RCM ear-test intervals at Level 5, and RCM dictation length at Level 6** — extraction truncated
  before those pages. Levels 1–4 (intervals) and Prep A–Level 5 (dictation) are quoted and reliable.
- **Sight-reading leap samples at levels 3–6 are contaminated downward.** The probe abandons each
  exercise to draw the next, which grades it 0% and steps the adaptive level down, so those rows mix
  levels. The maxima still match `levelDefaults.ts`'s ceilings exactly, and **level 2's 10-semitone
  result is sound regardless**, because level 1 can only produce ≤ 2.
- **A full-page screenshot of a scrolled page renders `position: sticky` elements offset** (visible in
  `visual-pass/5-49-gmajor/`). That is a Playwright artefact, **not** an app defect — the same screens
  are correct in the unscrolled captures.

---

## Proposed tasks — one per aspect still under 9

Written the way ROADMAP.md's entries are, and appended to Phase 5 as **5.51–5.58**. Aspect 17 (overall)
has no task of its own: it rises when the other seven do.

| Aspect | Score | Task(s) |
|---|---:|---|
| Visual design system | 7 | 5.51 |
| Information architecture | 8 | 5.51 (its labels), 5.57 |
| Playable content | 7 | 5.52 |
| Sight-reading pedagogy | 7 | 5.53, 5.54 |
| Ear training pedagogy | 7 | 5.55, 5.58 |
| Rhythm drill | 8 | 5.56 |
| Accessibility | 7 | 5.51 |
| Overall | 8 | — |
