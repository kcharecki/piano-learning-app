# Parallel round 10 — dispatch, deferrals and open questions

Started 2026-08-11 by the main-checkout session, at the user's instruction to implement the
whole listed backlog with one parallel worker per task. This file is the round's ledger: who
owns what, what was deliberately held back, and what still needs a human decision. The
integrator updates it as branches merge; it is deleted once the round closes.

## Before dispatch

- Merged `task/5.35` (minor scale fingering tables). It was branched before `task/5.37` landed
  and the two collided semantically, not textually: 5.37 merged the reference's two fingering
  cells into one for the eleven `NO_STANDARD_FINGERING_TYPES`, and 5.35 gave the three minor
  forms real numbers, which together leave no scale type rendering a bare dash in both cells.
  5.35's branch-local test asserted that now-unreachable state and read `cells[3]` as
  `undefined`. Deleted that one case; the 5.37 case in the same file is its superset and now
  also asserts the merged row has three cells. `npm run verify` green after the fix.
- Six worktrees from previous sessions (`t1`, `next-5-14`, `t-rhythm-5-20`,
  `t-progressive-disclosure`, `t-5-35-minor-fingerings`, `t-session-a`) are **locked by live
  `claude` processes** — all six PIDs were checked and are alive. Their branches are fully
  merged and their trees clean, so nothing is at risk, but they were left in place rather than
  force-removed. Whoever owns those sessions should close them; then
  `git worktree remove` and `git branch -d` will succeed.
- Pre-created seven feature stylesheets (`src/design-system/css/feature-*.css`) and pre-imported
  them from the barrel, so twelve concurrent sessions never append to `domain.css` or to
  `styles.css`. One owner each. Fold them back into `domain.css` once the round settles.
- Wrote `docs/agent-brief.md` — the rules digest every parallel session reads instead of
  `CLAUDE.md`, so the digest lives in one place rather than being re-pasted per prompt.

## Dispatched — 12 sessions, disjoint file ownership

| Branch | Tasks | Owns |
|---|---|---|
| `task/5.42-ia` | 5.42, 5.43, 5.39 | `src/app/shell/**`, nav CSS, existing e2e specs |
| `task/3.15a-theory-ref` | 3.15a, 5.36 | `ChordScaleReference`, `ChordLookup`, new audio leaf module |
| `task/5.29-eartraining` | 5.29, 5.30, 5.32, 5.33, 5.34 | `src/core/eartraining/**`, `src/app/eartraining/**` |
| `task/3.25-lessons` | 3.25, 3.24 | `src/app/lessons/**`, `src/content/curriculum/**` |
| `task/5.23-technique` | 5.23 | `src/app/technique/**` |
| `task/5.24-note-feedback` | 5.24 | `useNoteFeedback.ts`, `osmdEngraver.ts`, the `.note-*` rules |
| `task/5.26-music-font` | 5.26 | `StaffNote.tsx`, font assets, `LICENSE.md` |
| `task/5.18-practice` | 5.18, 5.48 | `src/app/practice/**` except `useNoteFeedback.ts`, `requirements.md` |
| `task/5.44-session` | 5.44, 5.45 | `src/app/session/**`, `core/curriculum/session.ts`, `core/progress/log.ts` |
| `task/5.47-practice-sheet` | 5.47 | `src/app/progress/**`, the Dashboard entry point only |
| `task/4.10-m4-acceptance` | 4.10 | one new doc; audits only, fixes nothing |
| `task/3.21-clapback` | 3.21, 5.21 | `src/app/rhythm/**`, new `src/core/rhythm/**` |

Ports 5301–5312, one per session. All 26 task ids claimed via `worktrees.mjs claim` so the six
live sessions above cannot pick the same work.

### Known cross-session seams the integrator must resolve at merge

1. **`ActivityKind` gains `'warmup'` back** (5.45) — roadmap 5.14 deleted it because nothing
   wrote it. Re-adding it breaks roadmap 5.16's type-level exhaustiveness check on the Progress
   screen's display-name mapping, in `DashboardScreen.tsx`, which belongs to the 5.47 session.
   The 5.45 session was told to report the required line rather than edit that file.
2. **`DashboardScreen.tsx` has two writers** — 5.47 adds the practice-sheet entry point, and
   round 2's 5.31 will replace the SRS jargon block. Different regions; 5.31 is deliberately
   not in this round for that reason.
3. **Routing (5.42) has the widest blast radius** — that session alone may update existing e2e
   specs; every other session may only add new ones. Expect its merge to be the noisy one and
   merge it early, while the rest are still building.
4. **`ROADMAP.md` line conflicts are expected and trivial** — each session edits only its own
   task's lines.

## Held for round 2 (with reasons)

| Task | Why held |
|---|---|
| 3.17 — reference available at all times | Needs `Shell.tsx`, which 5.42 is rewriting this round. Design decision commissioned; see below. |
| 5.31 — de-jargon the SRS panel | The jargon renders on four screens (`DashboardScreen`, `FlashcardScreen`, `EarTrainingScreen`, `TheoryDrillPanel`); three of the four have owners this round. |
| 5.40 — first-run onboarding | Needs the router from 5.42 and the Today-first default from 5.39. |
| 5.41 — empty states on all 12 screens | Touches every screen file; conflicts with the entire round by construction. |
| 5.27 — verify the ≤1024px drawer by hand | 5.43 is regrouping the nav; verifying the old drawer would prove nothing. |
| 5.10 — lesson quality gate | Blocked on 3.24 and 3.25, both in flight. |
| 5.38 — theory reference gaps | Blocked on 3.17. |
| 5.49 — M5 acceptance pass | Must be last; it re-scores the aspects this whole round is moving. |

## Open questions

### Q1 — 3.16 is probably already done and should be closed, not built

3.16's own text was re-scoped by 5.37: the mode half is deliberately **not** shipped (RCM's 2022
chart has zero hits for any mode, so the reference now says so), and the minor half was
"tracked and shipped by 5.35", which merged this session. That appears to leave nothing in
3.16 that is not either shipped or deliberately dropped.

**Proposed resolution:** at integration, verify against the merged code that (a) the three minor
forms return real fingerings and (b) the eleven other types render the "not in the graded
syllabi" sentence, then close 3.16 as `[x]` citing 5.35 and 5.37 rather than re-opening the
16-type derivation that was attempted and reverted once. Not actioned yet because 3.16's
roadmap block sits adjacent to 3.15a's, which a session is editing right now.

### Q2 — the mechanism for 3.17 (decision commissioned, not yet returned)

"Available at all times" has at least five defensible shapes (modal, non-modal side drawer,
dockable split pane, cheap-navigation-plus-restored-state, peek popover), and the choice is
constrained by three things at once: the Practice screen must not unmount (it holds the loaded
score, the matcher and the transport), two live `AudioContext`s would collide, and a second
OpenSheetMusicDisplay engraving is not free. **RESOLVED 2026-08-11** — a non-modal Shell-level overlay side panel.

`src/app/reference/ReferencePanel.tsx` (new) wraps the existing `ChordScaleReference` — which is
already fully controlled — in an `<aside id="reference-panel" role="complementary">` with a
heading and a close button, owning the `root`/`scaleType` state itself. `Shell.tsx` gets a
persistent topbar toggle (`aria-expanded`, `aria-controls`) and renders the panel as a **sibling
after `app-main`**, never as a wrapper around it and never as a layout column.

Why that shape rather than the two obvious alternatives:

- **Not a modal.** The use case is glancing at a fingering *while the transport is running and
  hands are on the keys*. `aria-modal` plus a focus trap means the learner cannot reach pause
  without closing first, which is "available instead of your work", not "available at all times".
- **Not cheap-navigation-with-restored-state.** Restoring Practice losslessly means serialising
  the loaded score, matcher run state, transport position, loop range, recording buffer and a
  gesture-gated `AudioContext` — a large change inside a screen file the implementer may not
  edit — and even done perfectly the learner still cannot see the reference and the score at the
  same time, which is the whole point of a reference.
- **Not a split pane.** Narrowing `app-main` resizes the Practice OSMD engraving on every open,
  close and divider drag. The overlay is `position: fixed`, so `app-main`'s box never changes and
  the practice engraving never re-engraves.

Specified behaviours the implementer must hold to: mount nothing until first open, then
**hide on close rather than unmount**, so the selected root/scale and the panel's own OSMD
engraving survive; never change the type, position or keys of the routed screen's JSX when
toggling, so React keeps the screen instance alive; panel state is ephemeral chrome and stays
**out of the router and out of history**, so Back never toggles it mid-practice; focus moves to
the close button on open, there is no focus trap, Tab continues out into the page so the
transport stays reachable, and Escape or the scrim closes and returns focus to the toggle; at
≤1024px it becomes a right-edge drawer with a scrim, mutually exclusive with the nav drawer so
the two scrims never stack. Two live `AudioContext`s are fine — browsers mix them, panel
playback is a few seconds and self-cancels on re-press or selection change, so no cancellation
plumbing into a hidden component.

*Proof action:* on Practice, load a score, set a loop range, start the transport with the
metronome and match a note. Open the panel and, in one continuous run, confirm the metronome is
still audible on the same measure; the panel's own Play sounds over it; Tab reaches the
transport's pause and toggles it with the panel still open; Escape closes, focus lands on the
toggle, and loop range, transport position and matched-note state are all unchanged; reopening
shows the previous selection with no re-engrave flash of the practice score at any point. Repeat
at 1024px against the drawer nav, both themes, console clean.

`src/design-system/css/feature-reference-panel.css` was created and imported on master ahead of
time, so the implementing session needs no out-of-scope edit to the barrel.

### Q3 — for the user, not resolvable here

- **Levels 4–5 of the curriculum do not exist**, and 3.24's six theory topics (sevenths,
  cadences, progressions, minor scale forms, secondary dominants, modulation) belong there. The
  3.24 session was authorised to create them if the six lessons need them. If you would rather
  those topics sit at level 3 than have the curriculum grow two levels, say so before that
  branch merges.
- **`WORKTREES.md` states a practical ceiling of "2–3 parallel sessions worth supervising"**,
  on the evidence that past three, merge review becomes the bottleneck and quality drops back to
  what the old process shipped. This round runs twelve, at your explicit instruction. The
  mitigation is the disjoint-ownership table above plus `npm run verify` between every merge,
  but the doc's warning is recorded here rather than silently overridden. If the merges turn out
  noisy, the process change this round earns is a lower ceiling, enforced in
  `worktrees.mjs` rather than in prose.
