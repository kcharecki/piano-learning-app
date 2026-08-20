# The panel token contract

`docs/panel/*.md` are byte-stable prompt templates for the `/improve-app` adversarial panel
(`docs/commands/improve-app.md` §5). The orchestrator substitutes `{{TOKEN}}`s and never edits
the prose, and `improve-run.mjs panel` records the **template file's** sha256
(`improve-run.mjs:703`, `sha256File(docs/panel/<role>.md)`) so a later round cannot quietly
soften its own prompt. It is deliberately *not* the rendered prompt: `{{ROUND}}` and
`{{PRIOR_FINDINGS}}` are required to differ each round, so hashing rendered text would refuse
every round 2 and make the §6 polish loop unrunnable. Each template ends with the list of tokens
it requires. Values come from here.

| Token | Value |
|---|---|
| `REPO_ROOT`, `RUN_ID`, `INSTRUMENT` | From `improve-run.mjs start`. |
| `DIFF_REF`, `BASE_SHA` | The slice sha from `slice --sha`, and the start commit `start` stamped. |
| `ROUND`, `PRIOR_FINDINGS`, `FIX_DIFF_REF` | Round 1: `1`, `none — this is round 1`, `n/a`. Later rounds: the previous rounds' verbatim findings and the diff of the fixes made since. |
| `CLAIM`, `REFUTATION_CONDITION` | The §3 claim block, unedited. |
| `DEV_URL`, `SEED_PROFILE`, `STATE_RECIPES` | The running dev server, the profile §1c seeded, and how to force empty / loading / error / no-MIDI. |
| `DRIVE_LOG_PATH` | `runs/<id>/drive.md`, written at §1c. |
| `LEARNER_PROFILE` | The persona: stage, current grade, this week's goal. |
| `BANNED_SOURCES` | `docs/ux-pedagogy-review-2026-08-12.md`, `docs/drums/research-2026-08-15.md`, and any other of this app's own digests. |
| `PICK_SOURCE` | The `--source` the §2 pick recorded. Teacher seat only: it decides whether the slice is citation-exempt. |
| `HARM_HYPOTHESIS` | Teacher seat only. The pick's stated harm hypothesis for a `1a`/`1e`/`reg`/`idea` pick, verbatim. For a cited pick, exactly `n/a — this pick carries citations`, never blank: a blank here is a stop under the rule below, and a Teacher given one would review a citation-exempt slice with nothing to judge. |

**A token the template requires and the run cannot supply is a stop, not a blank.** A seat given
an empty `{{STATE_RECIPES}}` reports the states as checked without ever forcing one, and a seat
given an empty `{{DRIVE_LOG_PATH}}` reviews the diff instead of the app. Fill it or do not run
that seat, and say in the log which seat did not run and why.

## Which seats run

Floor tier: Skeptic + Regression hunter. M adds the Teacher — one seat per instrument the slice
touches. L adds the Rival. Re-panel caps are 1 / 2 / 3 rounds respectively.
