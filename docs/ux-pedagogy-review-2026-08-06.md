# UX & pedagogy review — 2026-08-06

Two perspectives, one pass:

- **Learner** — an adult beginner (0–18 months in) who owns a digital piano and wants to get better.
- **Teacher** — what a piano teacher would say about *how* each thing is taught.

Method: the running app was driven screen by screen at `localhost:5173` (all 12 nav destinations,
drills started and answered, contrast measured from the live CSSOM), cross-checked against source,
and the music-theory and pedagogy claims were verified by parallel web-research agents against
primary sources (RCM 2022 syllabus, ABRSM 2025–26 syllabus, Faber/Alfred scope-and-sequence,
Taubman/Golandsky, peer-reviewed sight-reading research). Sources are cited inline where a finding
rests on one.

Every finding below is marked with how it was established: **[driven]** in the browser,
**[code]** read/executed from source, **[cited]** verified against an external authority.

---

## Scores at a glance

| Aspect | Score | One-line verdict |
|---|---:|---|
| Breadth of features | **9/10** | Genuinely covers the whole beginner syllabus — practice, reading, ear, rhythm, technique, theory, SRS, progress. |
| Visual design system | **8/10** | Tokens, dual theme, paper-vs-shell surfaces, AA contrast everywhere it matters. Better than most hobby apps. |
| Engineering rigour | **9/10** | ~2750 unit tests, e2e with a fake MIDI keyboard, perf budgets, knip gates. Rare. |
| **First-run experience** | **2/10** | Lands on the densest screen in the app. No onboarding, no "start here", no explanation. |
| **Information architecture** | **3/10** | 12 flat nav items, no hierarchy, no URL routing, browser Back exits the app. |
| Practice screen usability | **3/10** | 30 controls / 13 groups / ~5100px of scroll, all equally prominent, no progressive disclosure. |
| **Playable content** | **2/10** | Exactly **one** bundled score. The 20-piece "graded library" is metadata with no music behind it. |
| Input accessibility | **3/10** | The core practice loop is **MIDI-only**. No on-screen keyboard, no computer-keyboard fallback, no mic. |
| Lesson content quality | **6/10** | Prose is accurate and well sequenced — but the G and F major lessons demonstrate the **C major** scale. |
| Sight-reading pedagogy | **5/10** | Right rules (30s preview, no stopping), wrong difficulty ladder (level 5 is D♯ minor). |
| Ear training pedagogy | **4/10** | Interval-first, no tonal context, no singing, feedback reveals nothing. |
| Rhythm drill | **2/10** | Shows the rhythm as **words**, not notation. Teaches no rhythm reading. |
| Technique | **5/10** | Correct fingerings, correct pentascale-first order — presented as an unreadable 58-number string. |
| Theory reference | **6/10** | Circle of fifths and diatonic chords correct; **no minor-scale fingerings**, no chord picker, no 7ths. |
| Progress & motivation | **4/10** | Rich dashboard, but only *one* of seven activities actually feeds the streak. |
| Accessibility (a11y) | **7/10** | Focus rings, roles, labels, AA contrast. Loses points for MIDI-number labels and colour-only score feedback. |
| **Overall as a teaching product** | **4.5/10** | An impressive engine wrapped around almost no content, aimed at nobody in particular. |

---

## The five things that matter most

### 1. There is one piece of music in the whole app — **[driven] [code]**

`src/content/scores/` contains exactly one score: `twinkle-twinkle-little-star.musicxml`.

The Repertoire screen advertises a 20-piece graded library (Ode to Joy, Minuet in G BWV Anh. 114,
Für Elise, Bach Prelude in C, Invention No. 1, Chopin Op. 28 No. 4). Adding *Für Elise (Theme A)*
was driven live: it appears in "Your library" with a status dropdown, a notes field, and
**no way to open, view, or play it**. There is no score, no link to the Practice screen, nothing.

For a beginner this is the whole product failing at the last step. Everything else — the matcher,
wait mode, assessment, read-ahead, loop practice, tempo ramping — exists to be used *on a piece*,
and there is one piece, at roughly a 3-year-old's level.

**Teacher's view:** a teacher's first act is assigning repertoire. Elissa Milne's 40 Piece
Challenge — ~40 mostly-below-level pieces a year — is the single highest-leverage sight-reading
intervention in the literature ([composecreate.com](https://composecreate.com/interview-with-elissa-milne-40-piece-challenge/)) **[cited]**.
This app can support exactly 1/40th of that out of the box.

**Fix:** bundle public-domain MusicXML for the 20 pieces already listed (all are PD; MuseScore and
IMSLP have them). Wire the Repertoire "Add" button to load the score into Practice.

---

### 2. Without a MIDI keyboard, the app cannot hear you at all — **[code]**

`PracticeScreen` takes `midiInput` and nothing else. There is no on-screen keyboard, no
computer-keyboard mapping (the only `keydown` listener in the app is the Rhythm drill's spacebar
tap), and microphone pitch detection is backlog item B.1.

So on Safari, Firefox, or an iPad — no Web MIDI — the Practice screen degrades to
*"you can still listen and read along"*. Note matching, feedback colouring, wait mode, assessment,
timing feedback, recording and the tempo ramp are all inert.

The inconsistency makes it worse: Flashcards, Theory drills and Dictation **do** render a
37-key clickable `OnScreenKeyboard` **[driven]**. The one screen where playing actually matters is
the one that refuses non-MIDI input.

**Fix:** render `OnScreenKeyboard` on the Practice screen when no MIDI device is present. The
component already exists and is already wired to the same note pipeline.

---

### 3. The G major and F major lessons demonstrate the C major scale — **[driven]**

Opened live in the browser:

> **The G Major Scale** — "…lands on one black key: F♯. That single sharp becomes G major's key signature…"
> **Open demonstration → "Demonstration: C Major Scale, One Octave — Right Hand"**

Same for **The F Major Scale** (which teaches B♭). Confirmed in source: all three scale lessons set
`demoScoreId: demo('demo-c-major-scale-one-octave-rh')`, and `demoScores.ts` contains no G or F
major scale at all — 14 demos, all in C except the two rhythm ones **[code]**.

**Teacher's view:** this is the worst class of content bug. The lesson says "one sharp"; the
demonstration shows and *plays* a scale with no sharps. A beginner cannot tell which one is wrong,
and the audio wins. The prose itself is good — the F major explanation ("the half step would fall
between the fourth and fifth notes instead of the third and fourth") is exactly right — which makes
the mismatch more damaging, not less.

**Fix:** author `demo-g-major-scale-one-octave-rh` and `demo-f-major-scale-one-octave-rh`. Add a
content test asserting every lesson's demo score is in the lesson's own key.

---

### 4. The rhythm drill shows words instead of rhythm — **[driven]**

Starting a complexity-1 drill produces:

```
Bar 1: half, half
Bar 2: whole
Bar 3: whole rest
Bar 4: half rest, half
```

No notation. This is the identical defect that roadmap 2.20 fixed for sight-reading (a text note
list replaced by a real engraving) and never applied here. A rhythm drill that never shows a note
value trains no rhythm reading — it trains reading the word "half".

**Teacher's view:** two further problems in that one screenshot. At the *lowest* complexity, one
bar of four is a whole rest and another opens on a half rest. Counting through rests is genuinely
hard for beginners and every method introduces it after note values are secure (Faber Primer puts
the quarter rest at unit 10, last) **[cited]**. And the whole notion of "complexity 1 = whole and
half notes" inverts the standard order: Faber and Alfred both teach **quarter → half → whole**,
because a beginner counts a quarter before they can hold four beats.

**Fix:** engrave the pattern (the MusicXML writer from roadmap 2.20 already exists). Reorder
complexity so level 1 is quarters and halves with no rests.

---

### 5. Six of seven practice activities record no practice time — **[code]**

`practiceLog.start(...)` has **exactly one call site** in the entire app:
`PracticeScreen.tsx:267`, hardcoded to category `'repertoire'`.

Sight reading, Flashcards, Ear training, Rhythm, Technique, Theory and Lessons log nothing. So the
Progress screen's *Current streak*, *This week*, and per-category breakdown reflect only time spent
on the Practice screen. A learner who follows the Today plan — technique, sight-reading, theory,
ear training — and skips the repertoire segment records **0 minutes and breaks their streak**.

Related: `'warmup'` is a declared `PracticeCategory`, is rendered on the Progress screen, and is
written by nothing anywhere. It will read `warmup: 0 min` forever.

**Teacher's view:** the practice log is the single most useful artefact a teacher gets from a
student. One that silently drops 6/7 of the work is worse than none, because it will be trusted.

---

## Learner's walkthrough — what the first ten minutes feel like

**[driven] throughout.**

You open the app. You land on **Practice**, showing Twinkle Twinkle. Below it, in one flat column,
are 30 controls in 13 labelled groups across ~5100px of scroll:

> Transport · Tempo · Tempo ramp (from/to/step) · MIDI status · Note feedback · Timing feedback ·
> Fingering (finger 1–5 / set / clear) · Highlight · Measure note · Assessment · Loop range · Hands ·
> Metronome (+ subdivision) · Wait mode · Read ahead · Record and replay

Nothing is collapsed. Nothing is marked "start here". *Tempo ramp*, *Read ahead*, *Assessment* and
the annotation editors are advanced tools sitting at the same visual weight as Play.

There is no onboarding, no first-run state, and the default screen is `'practice'` (`Shell.tsx:185`)
rather than Today or Lessons **[code]**. The nav is 12 flat `<button>`s with no grouping — a learner
has no way to know that *Today* is the intended entry point, or that *Flashcards*, *Ear training*,
*Rhythm*, *Technique* and *Theory* are all drill screens.

**Also:** navigation is `useState`, not routing. The URL never changes, there are no deep links, a
refresh returns you to Practice, and **the browser Back button exits the app** **[code]**.

### Scoring
- First-run experience: **2/10**
- Information architecture: **3/10**
- Practice screen usability: **3/10**

### What a teacher would do instead
Progressive disclosure, driven by level. A level-1 learner sees Play/Pause/Stop, tempo, hands, and
the metronome. Wait mode appears when the curriculum introduces it. Assessment, tempo ramp,
read-ahead and annotations live behind "More tools". The app already tracks a per-track level —
it just doesn't use it to decide what to show. (It does exactly this, correctly, for the roman-numeral
analysis panel, which is gated to theory level 4+ **[code]** — that pattern should be the rule, not
the exception.)

---

## Sight reading — right rules, wrong ladder

**What it gets right [driven] [cited]:**
- 30-second silent preview then a forced start. ABRSM allows "up to half a minute" to look through
  and try out — the app matches the exam standard exactly
  ([ABRSM 2025–26 piano syllabus](https://www.abrsm.org/sites/default/files/2024-06/Piano%202025%20&%202026%20Prac%20syllabus%2020240524_access.pdf)).
- The run cannot be stopped, and navigating away now grades and retires the piece. This enforces
  pillar 1 of every sight-reading handout — *whatever you do, don't stop*
  ([TopMusic](https://topmusic.co/whatever-you-do-dont-stop-5-sight-reading-tips-for-piano-teachers/)).
- The preview is real engraved notation with key and time signature, not a note list.
- Exercises are unrepeatable by design and the level adapts to an 80–90% accuracy band.

**The difficulty ladder is wrong.** Executed from source (`melody.ts:626` `LEVEL_ROWS`, resolved
through `keyFromFifths`) **[code]**:

| Level | Key | Bars | Metre | Hands | Rhythm | Max leap | Accidentals |
|---|---|---|---|---|---|---|---|
| 1 | C major | 4 | 4/4 | RH only | whole/half | **7 st (P5)** | 0% |
| 2 | G major | 4 | 4/4 | both | quarters | 8 st | 5% |
| 3 | D major | 8 | 3/4 | both, parallel | eighths | 9 st | 10% |
| 4 | **E major (4♯)** | 8 | 6/8 | blocked chords | dotted | 11 st | 15% |
| 5 | **D♯ minor (6♯)** | 8 | 4/4 | independent | syncopated | 12 st | 25% |

Three problems, in order of severity:

1. **Level 5 is D♯ minor.** Six sharps. Nobody sight-reads D♯ minor — it is a key most
   *professionals* avoid reading at sight, and its enharmonic twin E♭ minor is the conventional
   spelling. ABRSM does not sight-read four sharps until around Grade 5, let alone six
   ([cited](https://www.abrsm.org/sites/default/files/2024-06/Piano%202025%20&%202026%20Prac%20syllabus%2020240524_access.pdf)).
   This is almost certainly an off-by-intent in the fifths column rather than a decision.
2. **Level 1 permits a perfect-fifth leap.** RCM Preparatory A sight-playing is *"two four-note
   melodies… moving by step in one direction only"* ([RCM 2022 syllabus](https://rcmusic-kentico-cdn.s3.amazonaws.com/rcm/media/main/about%20us/rcm%20publishing/piano-syllabus-2022-edition.pdf)) **[cited]**.
   Faber and Alfred both teach steps before skips. `maxLeapSemitones: 7` at level 1 inverts the
   sequence every method agrees on.
3. **Level 1 → 2 is a cliff.** RH-only whole/half notes in C becomes hands-together quarters in G
   with accidentals in a single step. RCM spends two full grades on that transition.

**No exposed parameters.** The generator supports key, range, rhythm, hands, accidentals and
independence (REQ-3.4.2). The screen exposes a level number and a metronome toggle — nothing else
**[driven]**. A teacher cannot say "3/4 in G, left hand only, no leaps"; a learner cannot drill
their own weak spot.

**Cosmetic but repeated:** generated exercises engrave with the title **"Untitled Score"** and the
part name "Piano" printed above the staff **[driven]**. The Technique screen does the same. It reads
as unfinished.

### Scoring: **5/10**

---

## Ear training — interval-first, context-free

**[driven]:** Level 1 melodic interval drill offers *perfect fifth / perfect octave / major third /
minor third* as four buttons. Answering wrong gives *"Not quite — it was perfect fifth, ascending"*.
Answering right gives *"Correct"*.

**Teacher's view — three problems:**

1. **No tonal context, and this is the one that matters.** The interval is played cold. Both exam
   boards do the opposite, explicitly **[cited]**:
   - **RCM**: the examiner *states the key, plays the tonic triad once*, then plays the melody twice
     ([RCM 2022 syllabus](https://rcmusic-kentico-cdn.s3.amazonaws.com/rcm/media/main/about%20us/rcm%20publishing/piano-syllabus-2022-edition.pdf)).
   - **ABRSM**: "will play the key-chord and the starting note (the tonic) and then count in two bars"
     — at **Grade 1** ([e-musicmaestro ABRSM Grade 1 guide](https://www.e-musicmaestro.com/auraltests/guides/abrsm-grade-1-guide)).
   - Karpinski's standard formulation: *"the first and most fundamental process listeners carry out
     is tonic inference"* ([MTO 27.2](https://mtosmt.org/issues/mto.21.27.2/mto.21.27.2.karpinski.html)).
   - Berklee's Ear Training 1 is built on movable-do solfège and **tonal function** — there is no
     isolated interval-identification unit ([ET-111](https://college.berklee.edu/courses/et-111)).
   - ABRSM's aural tests contain **no interval-identification test at any grade**.

   Playing a tonic drone or a I–V–I before each item costs almost nothing and changes which skill is
   being trained. (Honest counterweight: functional hearing degrades on non-tonal or
   fast-modulating music, so interval skill is complementary, not obsolete.)

2. **The interval ordering is broader than any syllabus at level 1.** RCM introduces m3 and M3 at
   Level 1, adds P5 at Level 2, P4 at Level 3, and the octave only at Level 4 **[cited]**. The app
   offers all four — m3, M3, P5, P8 — in its level 1. Not wrong, but it front-loads four intervals
   where the syllabus spends four levels. (Worth knowing that sources genuinely disagree on
   ordering: Trinity introduces 2nd–6th all at once by number; Musical U argues 2nds first, which
   is nearly the reverse of RCM.)

3. **No singing.** Vocal reproduction is the response modality in ABRSM (Grade 1 aural *is*
   echo-singing), Kodály, Dalcroze and Berklee **[cited]**. A multiple-choice button is recognition,
   not internalisation — you can click a correct answer you cannot imagine. The app has no mic path
   (backlog B.1), so this is structural, not an oversight — but it should be *said* on screen.
   (RCM is the partial exception: it accepts keyboard playback as an equivalent response, so a
   MIDI-answered drill is not unprecedented.)

4. **Feedback reveals nothing.** "Correct" doesn't tell you what you heard. There is no
   replay-with-the-answer, no pitch names, no reference tune. A learner who guesses right learns
   exactly as much as one who guesses wrong.

**Dictation is right-sized, and worth crediting [code]:** prompts are bounded to **2–8 notes**
(`MIN_DICTATION_NOTES` / `MAX_DICTATION_NOTES`). RCM's playback spec runs 3 notes at Preparatory A
to 9 at Level 6 **[cited]** — so the app sits squarely in the real range. The one refinement worth
making is scaling that bound with level instead of using one 2–8 window for everything.

**Also:** the SRS panel exposes Anki's internal vocabulary directly to a piano beginner —
*Cards / Due / **Young** / **Mature** / **Average ease** 2.50* **[driven]**. Nobody learning piano
knows what a "mature card" is or what ease 2.50 means. Same panel appears on Flashcards and Theory.

**Copy bug:** *"it was perfect fifth"* — missing article.

### Scoring: **4/10**

---

## Technique — correct content, unreadable presentation

**Correct, and verified:**
- Level 1 is five-finger patterns in C, G, F (both hands); level 2 is one-octave scales; level 3 is
  two-octave hands-together plus triad inversions **[driven]**. This matches RCM's
  pentascales-at-Preparatory-A ordering **[cited]** and correctly puts the thumb-under crossing
  after the five-finger stage.
- Fingerings are right. Decoded from the live screen **[driven]**: C major 2-octave hands-together
  gives RH `1 2 3 1 2 3 4 1 2 3 1 2 3 4 5` and LH `5 4 3 2 1 3 2 1 4 3 2 1 3 2 1` — the standard
  fingering exactly, descending included. B♭ major gives RH `4 1 2 3 1 2 3 4…` and LH
  `3 2 1 4 3 2 1 3…` — also exactly standard, and B♭ is one of the ones implementations get wrong.

**The presentation destroys it.** That C major fingering is rendered as a single flat line of
**58 numbers with both hands interleaved and unlabelled**:

```
Fingering: 5 - 1 - 4 - 2 - 3 - 3 - 2 - 1 - 1 - 2 - 3 - 3 - 2 - 4 - 1 - 1 - 4 - 2 - 3 - 3 - …
```

No learner will ever parse that. Fingering numbers belong **above the noteheads on the staff** —
that is where they appear in every printed edition, and OSMD renders them natively. The engraving
is already on screen directly above this string.

**What no MIDI app can see, and this one doesn't say [cited]:** wrist height and collapse, forearm
alignment, finger curl, *which* finger was actually used, shoulder tension, bench height, posture.
The Taubman/Golandsky literature names dropped wrists and isolated finger motion as the direct
causes of tendonitis and RSI. MIDI velocity is not a proxy — a note struck by a tense isolated
finger and one played with balanced arm weight are byte-identical. A technique screen that reports
a clean tempo history implies technical validation it cannot perform. It should say so, and prompt
periodically for a human check.

(Credit where due: the app assigns **pentascales and syllabus scales**, not Hanon. That is the
right call — no exam board requires Hanon, and Taubman's rejection of isolated finger motion
directly contradicts its premise **[cited]**.)

### Scoring: **5/10**

---

## Theory reference — accurate, half-finished

**Verified correct [driven]:**
- Circle of fifths, both rings, including enharmonic spellings: outer `Db/C# Ab Eb Bb F C G D A E B/Cb F#/Gb`
  against inner `Bb/A# F C G D A E B F# C# G#/Ab D#/Eb`. Every relative-minor pairing checks out,
  including Cb↔Ab minor and Gb↔Eb minor.
- C major fingering table: RH `1 2 3 1 2 3 4 5`, LH `5 4 3 2 1 3 2 1`. Correct.
- Degree names are mode-aware: C Dorian correctly shows **subtonic** B♭, not "leading tone".
- Diatonic triads of C: I ii iii IV V vi vii°. Correct.

**Half-finished [driven]:**
- **Minor scales have no fingering.** A natural / harmonic / melodic minor all show `—` in both
  fingering columns. The notes are right (A melodic minor correctly gives A B C D E F♯ G♯) — only
  the fingering is missing. **This is the real gap**, because minor scales are required from RCM
  Preparatory B onward and are drilled constantly.
- Select **Dorian** (or any of the 10 modal/exotic types) and the fingering columns become `—` *and*
  the **entire Diatonic chords section disappears**. (Minor scales do still get chords — the chord
  section vanishing is specific to the modal/exotic types.)
- No seventh chords anywhere (`diatonicChords` is called without `seventh`).
- No chord picker — you can only see the 7 diatonic triads of the currently selected key. You
  cannot look up "D♭ diminished seventh", which is what a reference is *for*.
- **Major** and **Ionian** are separate dropdown entries, as are **Natural minor** and **Aeolian**.
  They are the same scales. A beginner reads two entries as two different things.

### Two corrections to how roadmap 3.16 frames the fingering gap **[cited]**

**(a) The missing *mode* fingerings are defensible; the missing *minor* fingerings are not.**
There is no canonical fingering standard for the modes. RCM's 2022 technical requirements chart
(Preparatory–Level 10) was text-searched for dorian/phrygian/lydian/mixolydian/aeolian/locrian/
whole-tone/blues/pentatonic and returns **zero hits at any level**
([RCM chart](https://colorinmypiano.com/download/RCM_2022_Technical_Requirements_Charts_Prep-10.pdf));
the published mode charts that do exist are self-published and disagree with each other. Modes only
appear in ABRSM's **Jazz** syllabus, and whole-tone only at classical Grade 8. So `—` for Dorian is
an honest answer. `—` for A harmonic minor is not — and **harmonic minor uses the natural minor
fingering**, structurally, because the raised 7th is never a thumb note (it is RH 4 / LH 2). Only
*melodic* minor ascending is a genuine exception, and only where the raised 6th would put the thumb
on a black key (C♯ and F♯ minor). That makes minor fingerings cheap to ship.

**(b) Roadmap 3.16 was right to revert the algorithmic attempt — here is the reason, with a
counterexample.** A "thumb never on a black key" rule is *descriptively true* across all 12 majors
and both hands, but it is a **filter, not a generator**: it eliminates candidates without selecting
one. Applied as the full four-rule set (123/1234 cycle · thumb on white · 4th on black · 5th only at
turnarounds), it reproduces the **right hand correctly in all 12 keys** and gets the **left hand
wrong in C, G, D, A and F** — those scales don't have enough black keys to pin the cycle's phase, so
the algorithm picks a legal-but-untraditional one. A published source ran exactly this experiment and
conceded the mismatch ([From the Woodshed](http://fromthewoodshed.com/2010/04/26/piano-scale-fingerings/));
compare [Robert Kelley's chart](https://robertkelleyphd.com/home/teaching/keyboard/keyboard-scale-fingering-chart/).
Rule 3 makes it worse, not better: traditional LH G, D, A and F major put finger 4 on a *white* key.

Two implementation notes that follow:
- **Ship a lookup table, not a rule.** ABRSM's own position is that fingering is not prescriptive —
  candidates "may use any fingering that produces a successful musical outcome" — so a table of
  *suggested* fingerings is exactly the right shape.
- **Key colour must come from pitch class, never from spelling.** E♯, B♯, C♭ and F♭ all appear in
  standard fingerings *on white keys*, several under the thumb (F♯ major RH thumb on E♯; A♭ harmonic
  minor RH thumb on C♭ and F♭). Test `pitchClass ∈ {1,3,6,8,10}`, never the accidental.

### Scoring: **6/10**

---

## Visual design & accessibility

**The design system is genuinely good.** Tokens with no raw hex at point of use; dark as the base
theme (explicitly "evening practice"); a constant `--paper` surface for notation so scores stay
black-on-light by convention while the shell is dark; a documented feedback ramp with separate
*shell* and *ink* variants; a responsive strategy with a written rationale for choosing a drawer
over a bottom bar; 44px touch targets below 1024px.

**Contrast, measured live from the CSSOM [driven]** — every ratio passes AA, and the one that
doesn't is documented as intentional:

| Pair | Ratio |
|---|---:|
| `--text-1` on `--bg-0` | 14.54 |
| `--text-2` on `--bg-2` | 7.15 |
| `--text-3` on `--bg-2` | 3.91 *(commented "decorative only — fails AA on purpose")* |
| `--accent` on `--bg-2` | 6.20 |
| `--paper-fg` on `--paper` | 16.43 |
| `--fb-correct-ink` / `--fb-wrong-ink` on `--paper` | 4.82 / 5.16 |

**One real accessibility defect — colour is the only signal on the score. [code]**

`colors.css` states the rule in its own comment: *"Color is NEVER the only signal: each state has a
mandatory glyph/shape cue."* `domain.css` even implements it —
`.notation-frame .note-missed { fill: none; stroke-dasharray: 2 2 }`.

**Nothing ever applies those classes.** `osmdEngraver` writes `NoteheadColor`/`StemColor` only, from
three hardcoded hexes duplicated out of the token file (`useNoteFeedback.ts:136-138`). So
`.note-correct`, `.note-wrong` and `.note-missed` are dead CSS, and on the engraved score
correct (#1c7c3c green) vs wrong (#c22f2c red) is distinguished **by hue alone** — the single
worst pair for the ~8% of men with red-green colour vision deficiency.

The dashed-outline treatment for "missed" already exists in the stylesheet. It just needs to be
reached.

**Smaller a11y points [driven]:**
- On-screen keyboard keys are labelled `"Key 48"`, `"Key 49"` — MIDI numbers. A screen-reader user
  hears "Key 48" instead of "C3".
- Clef glyphs on flashcards are Unicode `U+1D11E`/`U+1D122` rendered in `system-ui` **[code]**. No
  music font is bundled, so this depends entirely on OS font fallback. (Ledger lines, by contrast,
  are properly computed and drawn — that part is right.)
- Progress screen prints raw category keys: `warmup / technique / sightreading / repertoire /
  lesson / theory / eartraining` rather than display names.

### Scoring: design system **8/10** · accessibility **7/10**

---

## Curriculum & session planning

**Good [driven] [cited]:** the lesson sequence is sound and matches the methods. Level 1 —
posture and finding middle C → hand positions → staff and clefs → note names → note values → time
signatures → steps vs skips → hands together. That is close to Faber Primer's order, including the
deliberate choice to put reading *after* keyboard geography and rhythm. Level 2 adds dynamics,
articulation, the C/G/F scales, I–V–I and IV, intervals to a 5th. Level 3 adds two-octave
hands-together, broken chords, pedal, circle of fifths, relative minors, inversions.

**Session planner [driven]:** 15/30/60-minute presets with editable shares. The 30-minute default
splits 20% technique / 20% sight-reading / 40% lesson-repertoire / 20% theory-ear. That is a
defensible synthesis — though worth knowing that no source gives an evidence-based split; these
are conventions, not findings **[cited]**.

**What's missing:**
- **No warm-up segment.** Every source puts warm-up first, and Juilliard's own guide starts it
  *away from the keys* — jaw, shoulders, posture, stretch — before any note **[cited]**. The app
  tracks a `warmup` category and never schedules or writes one.
- **The plan doesn't run.** Each item is an "Open" button that navigates away. There is no timer,
  no "next item", no completion state, no way to see you're 3 of 5 through today's session.
- **Level 1's playing exit criterion is "play a simple hands-together piece at 75% accuracy."**
  Faber and Alfred take most of a first year to reach genuine hands-together independence
  **[cited]**. As a *level 1* gate that will stall beginners early.
- **No teacher/parent output.** No printable practice sheet, no assignment view, no share link.
  Export is JSON/CSV of raw logs.

### Scoring: **6/10**

---

## Where this app stands against the commercial competition

The teacher critique of Simply Piano / Flowkey / Yousician / Skoove / Piano Marvel is well
documented, and it is a useful mirror **[cited]**.

**This app already avoids the biggest ones:**
- **MIDI, not microphone.** Reviewers call mic detection "very inconsistent" and it is the single
  most-complained-about feature across every app. Piano Marvel's MIDI path "captures your
  performance precisely as you play" — that is this app's default and only path.
- **No falling-note crutch.** The "functional illiteracy" critique (learners follow colour-coded
  bars and never transfer to notation) does not apply — this app reads real engraved notation
  throughout. A piano-roll view is deliberately parked in the backlog (B.3).
- **Rests are judged.** Competitors "often ignore rests entirely"; here a note played during a rest
  is scored as `extra`.
- **Wait mode + chunked looping + tempo scaling** are the features reviewers rate most
  pedagogically sound in Flowkey — and this app's versions are more capable (per-loop tempo,
  worst-measure detection, one-click suggested loops).
- **SRS is applied only to declarative facts**, never to playing passages. That happens to be
  correct: the one direct trial of spacing on piano motor learning (Wiseheart et al. 2017, n=100)
  found **no significant spacing effect** on accuracy, timing or pressure consistency. What *is*
  supported for motor skill is day-level distribution across sleep, and interleaving — and the
  Today planner does interleave categories, which has direct piano evidence behind it
  (Abushanab & Bishara, random vs fixed order on piano melodies, **d = 1.24**).

**It shares one blind spot with all of them [code]:** `matcher.ts` judges **onsets only**. Its own
comment is explicit — *"`durationTicks` is never read: a note released early or held over still
counts as its written value."* This is exactly the hole reviewers name in Skoove ("I could release
each of them early and still earn a perfect score") and Yousician. The decision is documented and
defensible for a first pass, but legato vs staccato, note-holding and pedalling are unassessed, and
the app currently implies otherwise by reporting a bare accuracy percentage.

**And one it cannot fix:** everything under *technique* above. Posture, wrist collapse, forearm
alignment, tension, which finger was actually used. Every teacher source says the same thing —
supplement, not replacement — and the app should say it too, once, somewhere visible.

---

## What is genuinely excellent

Worth stating plainly, because the criticism above is dense:

- **Engineering discipline is exceptional** for a personal project — ~2750 unit tests, e2e specs
  driving a *fake MIDI keyboard*, property tests on theory primitives, a measured performance
  budget (p95 frame gap 551ms → 18ms on a 1603-note Canon in D), dead-code gates in CI, and a
  roadmap that records what was tried and reverted and why.
- **Music theory in `core` is correct** everywhere it was checked: scale fingerings for the majors
  including B♭, mode-aware degree names, the circle of fifths with enharmonic pairs, diatonic
  triads, roman numerals.
- **Real notation everywhere it counts** — OSMD engraving for practice, sight-reading, technique,
  with cursor tracking, live note colouring and read-ahead occlusion.
- **The design system is a real design system**, with reasoning written into the CSS.
- **The sight-reading rules are the correct ones** — timed silent preview, forced start, no
  stopping, unrepeatable exercises, adaptive difficulty band.

The gap is not capability. It is that the machine has almost nothing to run on, and no path in for
a person who has never used it.

---

## Recommended order of work

Ranked by learner impact per unit of effort.

| # | Change | Why |
|---|---|---|
| 1 | Bundle MusicXML for the 20 library pieces; make Repertoire "Add" open the score | Turns a demo into a usable app. Everything else already works. |
| 2 | Render `OnScreenKeyboard` on Practice when no MIDI is present | Unlocks the entire feedback loop for Safari/Firefox/iPad. Component already exists. |
| 3 | Fix the G/F major lesson demonstrations | Actively teaching the wrong thing. Small content fix. |
| 4 | Fix sight-reading levels 4–5 (E major → A/D minor-ish; D♯ minor → E minor) and drop level 1 max leap to a step | One table edit. Currently unusable at the top and misordered at the bottom. |
| 5 | Log practice time from all seven screens; add a warm-up segment | The streak and dashboard are currently fiction. |
| 6 | Progressive disclosure on Practice, gated by track level | The pattern already exists (analysis panel gated to theory 4+). |
| 7 | Engrave the rhythm drill pattern; reorder complexity to quarters-first | The MusicXML writer already exists. |
| 8 | Fingering numbers on the staff, not as a 58-number string | OSMD supports it natively. |
| 9 | Apply `.note-correct/.note-wrong/.note-missed` classes so shape carries the signal | Dead CSS already written. Colour-blind users currently get nothing. |
| 10 | Ear training: tonic reference before each item, reveal the answer's pitches, hide SRS jargon | Changes what skill is being trained, not just the polish. Both exam boards give a key chord first. |
| 11 | Ship minor-scale fingerings as a **table** (harmonic reuses natural; melodic ascending is the only exception) | Required from RCM Prep B on. Do not re-attempt the algorithm — see the theory section. |
| 12 | Onboarding: land on Today, add a first-run "start here" | Currently the app's front door is its most intimidating screen. |
| 13 | Real routing (URL per screen) so Back works | 12 nav buttons and no history is disorienting. |
| 14 | Say once, visibly, that the app cannot assess technique or note-holding | Both are real blind spots (`matcher.ts` judges onsets only). Every teacher source says supplement, not replacement. |

---

## Note on one thing I could **not** verify

The responsive drawer (`≤1024px`) could not be checked visually. The browser pane does not
composite frames, which freezes CSS transitions at t=0 — the nav's `translateX(-100%)` transition
sits permanently in `playState: "running"` at offset 0, and a running transition overrides even
`!important` inline styles. That is an artefact of the automation environment, **not** an app
defect; a control element in the same page transformed normally. The responsive CSS itself reads
as well-constructed (drawer + scrim + sticky topbar, 44px touch targets, full-bleed keyboard at
768px). **It should be confirmed by hand in a real browser at tablet width.**
