/**
 * The groove trainer (roadmap DR-09) — the first drums destination that
 * teaches anything, and the first one in the drums nav.
 *
 * A thin view over `useGrooveDrill`: it owns no timing and no grading, only
 * what is on screen. Three things are on screen on purpose, and each is a
 * teaching decision rather than a layout one.
 *
 * **The pattern is a grid, not a staff.** DR-05's `GrooveStaff` does not
 * exist yet (`notation/NotationDevGallery.tsx` is still its placeholder), and
 * a learner at this level reads a grid faster than drum notation anyway. When
 * the renderer lands, this is where it goes.
 *
 * **The tolerance is on screen.** It is stated where the learner reads it,
 * not left in the grader — and it is *this* groove's own number, not a
 * constant borrowed from a different pattern at a different tempo. See "The
 * tolerance is derived" below.
 *
 * **Every pad answers for itself.** One line per drum, each naming that pad's
 * own count and its own offset — the point of the whole feature is that a
 * learner is told WHICH drum was off, not that a run "was not clean". See
 * "The verdict is a word, not a green light" below.
 *
 * ## The pads make no sound
 *
 * The app has no drum samples: `AudioOutput` can play a pitched note or a
 * metronome click and nothing else. Pressing a pad therefore flashes and is
 * counted, but is silent — the click carries the pulse and the result carries
 * the verdict. A pitched piano note standing in for a kick drum would be
 * worse than the silence. Real pad sounds are their own roadmap item.
 *
 * ## Why pointerdown, not click
 *
 * A click fires on release. A drummer's hit is the moment the stick lands, so
 * the timestamp has to come from `pointerdown` — and the same for the keys,
 * which is the fallback for the (typical) learner with no e-kit.
 *
 * ## The hands are assigned, not just the keys (panel review defect #2)
 *
 * `PAD_KEY` puts the hi-hat on the RIGHT index finger's home key and the
 * snare on the LEFT — see that constant's own comment for why the opposite
 * assignment (the first cut of this screen) trained the wrong motor habit.
 * Naming the key is not enough to teach that on its own, so every pad also
 * carries a small visible label — "right hand", "left hand", "right foot" —
 * doubling as that pad's accessible description (`PAD_HAND`,
 * `aria-describedby` below), so a learner reads the assignment instead of
 * just absorbing it by repetition.
 *
 * ## Why `padKeyDown` never handles Space (panel review defect #1)
 *
 * A pad button takes DOM focus on `pointerdown` (browsers do this for any
 * clicked button). If a button's own keydown handler treated Space as an
 * activation key — the normal thing a `<button>` does — then one mouse click
 * on, say, the Hi-hat pad would silently rebind every later Space press to
 * the hi-hat, because a focused button's own handler runs first. `PAD_KEY`
 * puts the kick on Space specifically because a foot is a GLOBAL binding, not
 * a per-element one: it has to fire no matter which pad the mouse last
 * touched. So `padKeyDown` only ever answers to Enter; the window-level
 * `keydown` listener below already owns Space (and already calls
 * `preventDefault()` on it), so leaving Space unhandled here is not a gap in
 * this handler, it is what keeps the kick from being stolen by focus.
 *
 * ## The tolerance is derived, never a constant here
 *
 * The old subtitle said "100 ms" unconditionally. `useGrooveDrill` now
 * derives `toleranceMs` from the selected score, the tempo and the repeat
 * count (`grooveToleranceMs`), because a flat 100 ms is too wide for a
 * groove written in sixteenths at speed — see that hook's own module
 * comment. Printing anything other than `drill.toleranceMs` here would go
 * straight back to the bug: a number on screen that is not the number the
 * grader is actually using. And now that `grooveToleranceMs` caps the
 * window per pad (each drum's own note spacing), `toleranceMs` is the
 * tightest of those windows, not one blanket rule — the subtitle says so
 * ("the finest drum in this pattern") instead of implying every drum shares
 * the same window, which would be false for anything but the finest one.
 *
 * ## The teaches line never oversells what the app can hear
 *
 * `PRESS_VELOCITY` (`useGrooveDrill.ts`) is a hardcoded constant, and
 * `gradeGroovePerformance` reads pad and time only — dynamics are notated
 * but never sensed. `teachesLine` still names ghost notes when the score has
 * them, because the notation genuinely contains them and hiding that would
 * be its own lie, but `GHOST_NOTE_CAVEAT` sits right under it, in the
 * learner's own words, saying plainly that they are not graded. A skill the
 * app cannot measure must never be advertised as measured content.
 *
 * ## The verdict is a word, not a green light
 *
 * `drill.performance.clean` does not exist any more (`GroovePerformance` was
 * `complete`/`steady` from the start of this rewrite — see
 * `grooveGrader.ts`). The verdict shown here is always `verdictText`'s own
 * output, never a hand-written ternary re-deriving the same judgement with a
 * different vocabulary. "Clean" is gone from this screen on purpose: it
 * implied a certainty (perfect placement) this app has never been able to
 * measure once `TIMING_CAVEAT` is taken seriously — see that constant's own
 * comment in `attempt.ts`. It is rendered wherever this screen shows a
 * millisecond figure, in the Result section, sitting with the numbers rather
 * than filed away as a footnote.
 *
 * ## Repeats are a setting now, and every finished run gets one line of advice
 *
 * `drill.repeatChoices`/`drill.setRepeats` make the run length a control next
 * to tempo, built the same way tempo's own field sits in `.groove-setup` — a
 * `.field` wrapping a control, not a bespoke shape.
 *
 * A finished run earns exactly one of three lines, chosen off `steady` and
 * whether anything was matched at all — never off which sentence
 * `verdictText` happened to pick, because that keeps splitting (phase slip,
 * flam, plain uneven pulse) and every one of those is still "attempted, not
 * steady":
 *
 * - `!steady` and something matched: the single most useful thing a teacher
 *   says is "slower" — one concrete number (`slowerBpm`, 20% down, floored at
 *   the same `MIN_BPM` the tempo field itself enforces) as a button that sets
 *   the tempo directly, rather than leaving the learner to do that
 *   arithmetic themselves.
 * - `!steady` and *nothing* matched on any pad: "slower" is the wrong advice
 *   — a learner who never played is not told to play the same nothing again
 *   more slowly. `NOTHING_PLAYED_MESSAGE` says what actually happened
 *   instead, and no tempo control appears under it.
 * - `steady`: the mirror advice, `fasterBpm` (20% up, capped at `MAX_BPM`) —
 *   a shipping drum trainer ramps the tempo on a good take rather than
 *   leaving the learner to retype it by hand.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { Icon } from '@app/ui/Icon.tsx'
import type { AudioOutput, Clock, DateSource } from '@core/ports/index.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import { lastRunSummary, padLabel, padLineText, TIMING_CAVEAT, verdictText } from '@core/drums/practice/attempt.ts'
import { useGrooveDrill } from './useGrooveDrill.ts'

export type GrooveScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
  readonly date?: DateSource
}

const MIN_BPM = 40
const MAX_BPM = 200

/**
 * One key per pad, chosen by hand position AND by which hand actually leads
 * on a kit — not by mnemonic alone. A right-handed drummer's right hand
 * leads the hi-hat (crossing over the snare to reach it) while the left hand
 * plays the snare backbeat. The first cut of this screen put the hi-hat on
 * the LEFT index finger (`KeyF`) and the snare on the RIGHT (`KeyJ`) —
 * exactly backwards — which trains the mirror-image habit in the very week
 * it forms (panel review defect #2). Swapped here: hi-hat on the right
 * index finger's home key, snare on the left. The open hi-hat used to sit on
 * `KeyG`, next to the closed hi-hat's old `KeyF`, so "the same limb, opened"
 * still reads correctly on the keyboard — now that the closed hi-hat lives
 * on `KeyJ`, the open hi-hat follows it to `KeyK`, still the very next key.
 * The kick stays on Space: it is the thumb, and a foot has no "wrong side"
 * to get backwards.
 */
const PAD_KEY: Partial<Record<MappedDrumPad, string>> = {
  hhClosed: 'KeyJ',
  hhOpen: 'KeyK',
  snare: 'KeyF',
  kick: 'Space',
}

/** The badge printed on the pad itself — a keycap, so the space bar gets its glyph. */
const KEY_BADGE: Readonly<Record<string, string>> = {
  KeyF: 'F',
  KeyJ: 'J',
  KeyK: 'K',
  Space: '␣',
}

/** The same keys spelled out, for the sentence under the pads. */
const KEY_WORD: Readonly<Record<string, string>> = {
  KeyF: 'F',
  KeyJ: 'J',
  KeyK: 'K',
  Space: 'Space',
}

/**
 * The hand or foot each key trains — see the module comment's "hands are
 * assigned" section on why this is shown, not just decided. Every pad
 * `PAD_KEY` names a key for has an entry here; a pad this screen has no key
 * for (never reached by the four bundled grooves) has none, and gets no
 * label rather than a guessed one.
 */
const PAD_HAND: Partial<Record<MappedDrumPad, string>> = {
  hhClosed: 'right hand',
  hhOpen: 'right hand',
  snare: 'left hand',
  kick: 'right foot',
}

function keyHint(pads: readonly MappedDrumPad[]): string {
  const parts = pads.flatMap((pad) => {
    const code = PAD_KEY[pad]
    if (code === undefined) return []
    return [`${KEY_WORD[code] ?? code} ${padLabel(pad).toLowerCase()}`]
  })
  return `Keys: ${parts.join(', ')}.`
}

function runStateText(phase: string, bar: number, beat: number, repeats: number): string {
  if (phase === 'count-in') return `Count in — beat ${beat}`
  if (phase === 'playing') return `Playing — bar ${bar} of ${repeats}, beat ${beat}`
  if (phase === 'done') return 'Run finished'
  return 'Ready'
}

/**
 * One line naming what the selected groove teaches, so the picker (ordered
 * easiest-first — see `referenceGrooves`'s own comment) reads as a
 * progression rather than an arbitrary list. Built from the score's own
 * data — which pads it uses, how many notes it packs into a bar, and which
 * notated features it introduces — rather than a hand-written sentence per
 * groove id, so a fifth groove added to the bundle gets a true line for
 * free instead of a silently missing one.
 */
function scoreHasGhostNotes(score: GrooveScore): boolean {
  return score.notes.some((note) => note.dynamics === 'ghost')
}

function teachesLine(score: GrooveScore, pads: readonly MappedDrumPad[]): string {
  const drumNames = pads.map(padLabel).join(', ')
  const usesOpenHat = score.notes.some((note) => note.pad === 'hhOpen')
  const extras: string[] = []
  if (usesOpenHat) extras.push('opening the hi-hat on cue')
  if (scoreHasGhostNotes(score)) extras.push('ghost notes')
  const extraTail = extras.length === 0 ? '' : ` — plus ${extras.join(' and ')}`
  return `Teaches: ${drumNames}, ${score.notes.length} notes a bar${extraTail}.`
}

/**
 * Shown only under a `teachesLine` that just named ghost notes — see the
 * module comment's "teaches line never oversells" section. Deleting the
 * mention instead would be its own lie: the notation really does contain
 * ghost notes, this line just says, in the learner's own words, that hitting
 * them is not what is being scored.
 */
const GHOST_NOTE_CAVEAT =
  'This trainer hears when you hit, not how hard — the ghost notes are notated but not graded.'

/**
 * A concrete slower tempo to suggest after a run that came back `!steady` —
 * see the module comment's "one line of advice" section. 20% down, rounded
 * to a whole bpm, never suggested below `MIN_BPM` — the same floor the tempo
 * field itself enforces, so the suggestion is always one `setBpm` call away
 * from being valid.
 */
function slowerBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.round(bpm * 0.8))
}

/**
 * The mirror of `slowerBpm`, offered after a `steady` run instead — see the
 * module comment's "every finished run gets one line of advice" section. 20%
 * up, rounded to a whole bpm, capped at `MAX_BPM`, the same ceiling the tempo
 * field itself enforces.
 */
function fasterBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.round(bpm * 1.2))
}

/**
 * True when not one pad in the run has a single matched hit — the "never
 * played" case the module comment's advice section splits out from "played,
 * but not steady". Structural rather than `PadResult`-typed on purpose: this
 * only ever needs `expected`/`matched`, and typing it that narrowly means it
 * keeps working unchanged if `PadResult` grows fields this screen does not
 * read. A row the groove never asked for (`expected === 0`) has nothing to
 * be "not attempted" about, so it is excluded rather than counted as absence.
 */
function nothingMatched(rows: readonly { readonly expected: number; readonly matched: number }[]): boolean {
  const graded = rows.filter((row) => row.expected > 0)
  return graded.length > 0 && graded.every((row) => row.matched === 0)
}

/**
 * What a run says when it came back `!steady` because nothing landed on any
 * pad at all — see the module comment. Naming the actual event rather than
 * prescribing "slower" for a tempo that was never even tried.
 */
const NOTHING_PLAYED_MESSAGE =
  'Nothing registered on any pad this run — try the pattern before changing the tempo.'

export function GrooveScreen(props: GrooveScreenProps) {
  const drill = useGrooveDrill({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audioOutput === undefined ? {} : { audioOutput: props.audioOutput }),
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
    ...(props.date === undefined ? {} : { date: props.date }),
  })
  const running = drill.phase === 'count-in' || drill.phase === 'playing'
  // After a run, the next thing anyone wants is another run — so the same
  // button says so, rather than a second button appearing next to it.
  const transportLabel = running ? 'Stop' : drill.phase === 'done' ? 'Play again' : 'Start'
  const tempoId = useId()
  const grooveLabelId = useId()
  const repeatsLabelId = useId()
  const padHandBaseId = useId()

  // Same draft-string treatment as `MetronomeScreen`'s bpm cell, for the same
  // reason: typing "70" passes through "7", which is not a tempo, and an
  // empty field is a legal intermediate state. Commit on blur or Enter.
  const [bpmDraft, setBpmDraft] = useState(String(drill.bpm))
  useEffect(() => {
    setBpmDraft(String(drill.bpm))
  }, [drill.bpm])

  function commitBpmDraft(): void {
    const parsed = Number.parseInt(bpmDraft, 10)
    if (Number.isNaN(parsed)) {
      setBpmDraft(String(drill.bpm))
      return
    }
    drill.setBpm(parsed)
  }

  // The window listener is what makes the keyboard a real instrument here: a
  // learner playing with both hands is not going to keep a pad focused.
  const hitRef = useRef(drill.hit)
  hitRef.current = drill.hit
  const padsRef = useRef(drill.pads)
  padsRef.current = drill.pads
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // A pad button that already handled this key (see `padKeyDown`), a held
      // key repeating, or the learner typing a tempo — none of those are hits.
      if (event.defaultPrevented || event.repeat) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return
      // Space is the one code a browser also treats as "activate the focused
      // button". `PAD_KEY` puts the kick on Space (see the module comment),
      // so without this check every bundled groove's kick pad would swallow
      // that activation for every OTHER button too — Start, the groove
      // stepper, the repeat stepper — because this listener ran first and
      // already called preventDefault(). A focused *pad* button is exempt:
      // Space must still reach the kick even when a pad has focus (that is
      // the whole point of `padKeyDown` never handling Space itself).
      if (
        event.code === 'Space' &&
        target instanceof HTMLButtonElement &&
        !target.classList.contains('groove-pad')
      ) {
        return
      }
      const pad = padsRef.current.find((candidate) => PAD_KEY[candidate] === event.code)
      if (pad === undefined) return
      // Space would otherwise scroll the page, and would activate whichever
      // button has focus — including Stop.
      event.preventDefault()
      hitRef.current(pad)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Enter only — see the module comment's "why `padKeyDown` never handles
  // Space" section. Handling Space here as well as globally is exactly the
  // bug: a focused pad would steal every later kick.
  function padKeyDown(event: React.KeyboardEvent, pad: MappedDrumPad): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!event.repeat) drill.hit(pad)
  }

  const grooveIndex = drill.grooves.findIndex((groove) => groove.id === drill.score.id)
  const stepGroove = (delta: 1 | -1): void => {
    const next = drill.grooves[grooveIndex + delta]
    if (next !== undefined) drill.setGrooveId(next.id)
  }

  const repeatIndex = drill.repeatChoices.indexOf(drill.repeats)
  const stepRepeats = (delta: 1 | -1): void => {
    const next = drill.repeatChoices[repeatIndex + delta]
    if (next !== undefined) drill.setRepeats(next)
  }

  return (
    <div className="page page--focus groove-screen">
      <div className="page-header">
        <h1>Groove trainer</h1>
        <p className="page-header-subtitle">
          Play along on the pads. Each drum is timed on its own, and for {drill.score.title} at{' '}
          {drill.bpm} bpm, the finest drum in this pattern allows {drill.toleranceMs} ms either side of
          the beat.
        </p>
      </div>

      <div className="card groove-setup">
        <div className="field">
          <span className="field-label" id={grooveLabelId}>
            Groove
          </span>
          <div className="stepper groove-picker" role="group" aria-labelledby={grooveLabelId}>
            <button type="button" aria-label="Previous groove" disabled={running || grooveIndex <= 0} onClick={() => stepGroove(-1)}>
              <Icon name="minus" />
            </button>
            <span className="stepper-value groove-title">{drill.score.title}</span>
            <button
              type="button"
              aria-label="Next groove"
              disabled={running || grooveIndex >= drill.grooves.length - 1}
              onClick={() => stepGroove(1)}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>

        <div className="field groove-tempo">
          <label htmlFor={tempoId}>Tempo (bpm)</label>
          <input
            id={tempoId}
            type="number"
            inputMode="numeric"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            disabled={running}
            value={bpmDraft}
            onChange={(event) => setBpmDraft(event.target.value)}
            onBlur={commitBpmDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitBpmDraft()
              } else if (event.key === 'Escape') {
                setBpmDraft(String(drill.bpm))
              }
            }}
          />
        </div>

        {/* Same primitive as the groove picker above it — a `.field` wrapping
            a `.stepper` — because `repeatChoices` is a fixed, non-uniform
            menu (2/4/8), exactly the shape the groove picker already steps
            through, not a free number a plain numeric input would invite. */}
        <div className="field groove-repeats">
          <span className="field-label" id={repeatsLabelId}>
            Repeats
          </span>
          <div className="stepper" role="group" aria-labelledby={repeatsLabelId}>
            <button
              type="button"
              aria-label="Fewer repeats"
              disabled={running || repeatIndex <= 0}
              onClick={() => stepRepeats(-1)}
            >
              <Icon name="minus" />
            </button>
            <span className="stepper-value">{drill.repeats}</span>
            <button
              type="button"
              aria-label="More repeats"
              disabled={running || repeatIndex >= drill.repeatChoices.length - 1}
              onClick={() => stepRepeats(1)}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>
      </div>

      <p className="groove-key-hint groove-teaches">{teachesLine(drill.score, drill.pads)}</p>
      {scoreHasGhostNotes(drill.score) && <p className="groove-key-hint">{GHOST_NOTE_CAVEAT}</p>}

      {/* The pattern, one row per drum. Decorative: the pad buttons name
          themselves and the result names every count, so a screen reader is
          not walked through 24 empty cells. */}
      <div className="card groove-grid" aria-hidden="true">
        {drill.pads.map((pad) => (
          <div className="groove-grid-row" key={pad}>
            <span className="groove-grid-label">{padLabel(pad)}</span>
            <div className="groove-grid-cells">
              {drill.cellsFor(pad).map((sounds, index) => (
                <span
                  key={index}
                  className={sounds ? 'groove-cell is-note' : 'groove-cell'}
                  data-state={drill.activeCell === index ? 'active' : undefined}
                  data-beat={index % drill.cellsPerBar === 0 ? 'downbeat' : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="groove-pads">
        {drill.pads.map((pad) => {
          const hand = PAD_HAND[pad]
          const handId = hand === undefined ? undefined : `${padHandBaseId}-${pad}-hand`
          return (
            <button
              key={pad}
              type="button"
              className="groove-pad"
              aria-label={padLabel(pad)}
              {...(handId === undefined ? {} : { 'aria-describedby': handId })}
              onPointerDown={() => drill.hit(pad)}
              onKeyDown={(event) => padKeyDown(event, pad)}
            >
              <span className="groove-pad-name" aria-hidden="true">
                {padLabel(pad)}
              </span>
              <span className="groove-pad-key" aria-hidden="true">
                {KEY_BADGE[PAD_KEY[pad] ?? ''] ?? '—'}
              </span>
              {hand !== undefined && (
                <span className="groove-pad-hand" id={handId}>
                  {hand}
                </span>
              )}
              {(drill.flashes[pad] ?? 0) > 0 && (
                <span key={drill.flashes[pad]} className="groove-pad-flash" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      <p className="groove-key-hint">{keyHint(drill.pads)}</p>

      <div className="groove-transport">
        <button
          type="button"
          className="btn-primary groove-start-stop"
          // Named explicitly because the label swaps with the state: the
          // accessible name has to change with the visible one, not be
          // inferred from whatever text happens to be inside at the time.
          aria-label={transportLabel}
          aria-pressed={running}
          onClick={running ? drill.stop : drill.start}
        >
          <Icon name={running ? 'stop' : 'play'} />
          {transportLabel}
        </button>
      </div>

      <p role="status" aria-label="Run state" className="groove-run-state">
        {runStateText(drill.phase, drill.bar, drill.beat, drill.repeats)}
      </p>

      {drill.performance !== undefined && (
        <section aria-label="Result" className="card groove-result">
          <p className="groove-verdict">{verdictText(drill.performance)}</p>
          <ul className="groove-result-lines">
            {drill.rows.map((row) => (
              <li key={row.pad}>{padLineText(row)}</li>
            ))}
          </ul>
          {/* Not a tooltip and not optional — see the module comment's "the
              verdict is a word, not a green light" section. It sits with the
              numbers it explains, every time those numbers are on screen. */}
          <p className="groove-key-hint groove-timing-caveat">{TIMING_CAVEAT}</p>
          {!drill.performance.steady &&
            (nothingMatched(drill.rows) ? (
              // Nothing landed on any pad — "slower" is not the advice for a
              // pattern that was never attempted. See the module comment.
              <p className="groove-last-run">{NOTHING_PLAYED_MESSAGE}</p>
            ) : (
              /* A sentence and then a button, never a button wedged inside a
                 sentence: the advice has to read as advice even if the
                 control is never pressed, and a mid-sentence control wraps
                 badly at 375px. The tempo is the first thing a teacher
                 changes. */
              <div className="groove-slow-down">
                <p className="groove-last-run">
                  An uneven pulse is a tempo problem before it is anything else.
                </p>
                <button
                  type="button"
                  className="btn-ghost groove-slow-down-btn"
                  onClick={() => drill.setBpm(slowerBpm(drill.bpm))}
                >
                  Try it at {slowerBpm(drill.bpm)} bpm
                </button>
              </div>
            ))}
          {drill.performance.steady && (
            // The mirror of the advice above: a good take earns a push
            // forward, not silence. Same shape (sentence, then the control
            // that acts on it) for the same reason.
            <div className="groove-slow-down">
              <p className="groove-last-run">A steady run has room for a faster tempo.</p>
              <button
                type="button"
                className="btn-ghost groove-slow-down-btn"
                onClick={() => drill.setBpm(fasterBpm(drill.bpm))}
              >
                Try it at {fasterBpm(drill.bpm)} bpm
              </button>
            </div>
          )}
        </section>
      )}

      {drill.performance === undefined && drill.lastAttempt !== undefined && (
        <p className="groove-last-run">{lastRunSummary(drill.lastAttempt)}</p>
      )}
    </div>
  )
}
