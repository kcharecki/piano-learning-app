/**
 * Standalone metronome screen (roadmap 2.28, REQ-3.9.1): tempo, time
 * signature, subdivision and accent controls plus a live beat readout, all
 * driven by `useMetronome` — this file only renders its state and forwards
 * the user's actions. Runs with no score loaded, unlike the in-practice
 * `MetronomeControl`.
 *
 * Redesigned (roadmap UI-16, 2026-08-14 UI audit) as an instrument panel:
 * BPM is the thing a practising pianist glances at from arm's length, so it
 * gets `--text-glance` on a centred stage instead of a 36px-tall form field.
 * A `.stepper` (±1) flanks the glance number and an `input[type=range]`
 * (drag, or arrow keys once focused) sits beneath it — see the stage's own
 * comment for why free-text BPM entry was dropped rather than kept alongside
 * these. Beat state is now readable from the dots plus the Start/Stop button
 * alone (rule: "adding means demoting" — the old full-width grey "Stopped"
 * box is gone); the bar/beat sentence a screen reader needs is still
 * announced, just moved into an accessible-only `role="status"` node instead
 * of a box every sighted user had to read past.
 *
 * Roadmap UI-25 (2026-08-15 UI audit): Beats, Beat unit, Subdivision and the
 * accent toggles moved behind a closed-by-default `<details>` disclosure —
 * see that element's own comment below. BPM and Start/Stop are the only
 * controls visible on load now; everything else is configuration set once,
 * not glanced at mid-practice.
 */
import type { AudioOutput, Clock } from '@core/ports/index.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { MAX_BPM, MIN_BPM, SUBDIVISIONS, type Subdivision } from '@core/timing/metronome.ts'
import { useEffect, useId, useState } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import { AccentEditor } from './AccentEditor.tsx'
import { useMetronome } from './useMetronome.ts'

export type MetronomeScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
}

const BEAT_TYPES = [1, 2, 4, 8, 16] as const

/**
 * No core-level ceiling on beats-per-bar exists — `validateMetronomeSettings`
 * only requires a positive integer — but the Beats field needs *a* `max` to
 * fix the defect the 2026-08-12 UI audit measured: without one, the number
 * input's intrinsic width ran 2.1x the BPM field's, because BPM alone had a
 * `max` attribute. 32 is generously past any metre this app's own irregular-
 * metre table (`ADDITIVE_GROUPS`, `@core/timing/metronome.ts`) ever produces
 * (it tops out at 7) — a soft ceiling on the field, not a musical limit.
 */
const MAX_BEATS = 32

function statusText(running: boolean, lastClick: { bar: number; beat: number; accented: boolean } | undefined): string {
  if (!running) return 'Stopped'
  if (lastClick === undefined) return 'Starting…'
  return `Bar ${lastClick.bar + 1}, beat ${lastClick.beat + 1}${lastClick.accented ? ' (accent)' : ''}`
}

export function MetronomeScreen(props: MetronomeScreenProps) {
  const metronome = useMetronome({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audioOutput === undefined ? {} : { audioOutput: props.audioOutput }),
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
  })

  // Roadmap UI-24 (2026-08-15 final visual pass). The glance number was a
  // static `<span class="stepper-value">`, leaving three ways to set the tempo
  // and none of them exact: the slider is 179px across a 20-300 range (0.64px
  // per bpm, so it cannot be landed on a value), arrow-keying that slider to
  // 132 from the default 100 is 32 presses, and the ±1 buttons are the same 32
  // clicks. On the one screen where an exact number is the whole point, there
  // was no way to say "132". The cell is now the same cell, typeable — the
  // `.stepper input[type="number"]` shape `primitives.css` already documents,
  // NOT a fourth control: the group still renders as `[−] 132 [+]` and nothing
  // new appears on screen (DESIGN.md rule 3).
  //
  // Held as a draft string rather than driving `setBpm` per keystroke: typing
  // "132" passes through "1" (clamped to MIN_BPM=20 by `useMetronome`, which
  // would rewrite the field under the caret mid-word) and an empty field is a
  // legal intermediate state, not a tempo. Commit is blur or Enter; Escape and
  // any unparseable value revert to the live bpm. The effect resyncs the draft
  // whenever the tempo changes from anywhere else — the ± buttons, the slider,
  // or a future caller.
  const [bpmDraft, setBpmDraft] = useState(String(metronome.bpm))
  useEffect(() => {
    setBpmDraft(String(metronome.bpm))
  }, [metronome.bpm])

  function commitBpmDraft(): void {
    const parsed = Number.parseInt(bpmDraft, 10)
    if (Number.isNaN(parsed)) {
      setBpmDraft(String(metronome.bpm))
      return
    }
    const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, parsed))
    setBpmDraft(String(clamped))
    metronome.setBpm(clamped)
  }

  const bpmInputId = useId()
  const bpmSliderId = useId()
  const beatsId = useId()
  const beatTypeId = useId()
  const subdivisionId = useId()

  const currentBeat =
    metronome.running && metronome.lastClick !== undefined ? metronome.lastClick.beat + 1 : undefined

  return (
    <div className="page page--focus metronome-screen">
      <div className="page-header">
        <h1>Metronome</h1>
      </div>

      {metronome.error !== undefined && (
        <p role="alert" data-testid="metronome-error">
          {metronome.error}
        </p>
      )}

      <div className="card metronome-stage">
        <div className="field metronome-bpm-field">
          <label htmlFor={bpmInputId}>BPM</label>
          <div className="stepper metronome-bpm-stepper">
            <button
              type="button"
              aria-label="Decrease BPM"
              disabled={metronome.bpm <= MIN_BPM}
              onClick={() => metronome.setBpm(metronome.bpm - 1)}
            >
              <Icon name="minus" />
            </button>
            <input
              id={bpmInputId}
              className="stepper-value"
              type="number"
              inputMode="numeric"
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              value={bpmDraft}
              onChange={(event) => setBpmDraft(event.target.value)}
              onBlur={commitBpmDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitBpmDraft()
                } else if (event.key === 'Escape') {
                  setBpmDraft(String(metronome.bpm))
                }
              }}
            />
            <button
              type="button"
              aria-label="Increase BPM"
              disabled={metronome.bpm >= MAX_BPM}
              onClick={() => metronome.setBpm(metronome.bpm + 1)}
            >
              <Icon name="plus" />
            </button>
          </div>
          <input
            id={bpmSliderId}
            className="metronome-bpm-slider"
            aria-label="BPM slider"
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={metronome.bpm}
            onChange={(event) => metronome.setBpm(Number(event.target.value))}
          />
        </div>

        <div className="metronome-beat-row">
          <div className="metronome-beats" aria-hidden="true">
            {Array.from({ length: metronome.timeSignature.beats }, (_, i) => {
              const isAccent = metronome.accents[i] === true
              const isActive = metronome.running && metronome.lastClick?.beat === i
              return (
                <span
                  key={i}
                  className={isAccent ? 'beat is-accent' : 'beat'}
                  data-state={isActive ? 'active' : undefined}
                >
                  {isAccent && <span className="beat-ring" />}
                </span>
              )
            })}
          </div>
          <span className="metronome-beat-number">{currentBeat ?? ''}</span>
        </div>
      </div>

      <div className="metronome-transport">
        <button
          type="button"
          className="btn-primary metronome-start-stop"
          aria-pressed={metronome.running}
          onClick={metronome.running ? metronome.stop : metronome.start}
        >
          <Icon name={metronome.running ? 'stop' : 'play'} />
          {metronome.running ? 'Stop' : 'Start'}
        </button>
      </div>

      <p role="status" className="metronome-status-sr" data-testid="metronome-beat-readout">
        {statusText(metronome.running, metronome.lastClick)}
      </p>

      {
        // Roadmap UI-25 (2026-08-15 UI audit): with BPM's stage plus Start/Stop,
        // this section used to bring the visible control count on this screen to
        // 12 (rule 2 — at most ~6 before disclosure). BPM and Start ARE the
        // screen; beats, beat unit, subdivision and the per-beat accents are
        // configuration set once per piece, not glanced at mid-practice, so they
        // collapse behind a closed-by-default `<details>` — the same disclosure
        // treatment `docs/ui-overhaul-brief.md` points at (styled once, for every
        // screen, in primitives.css's `summary` rule; nothing added here). The
        // old `<h2>Meter</h2>` is gone: the summary text now carries that naming
        // job itself, in the sentence a learner reads before opening it, rather
        // than a heading nobody sees until after they already have.
        //
        // The chevron is not decoration. `summary` is `display: flex` in
        // primitives.css, which suppresses the browser's own disclosure
        // triangle, so a summary with no icon renders as a plain line of text
        // inside a card — measured in the 1024px dark visual pass, where this
        // block was indistinguishable from a static panel and gave a learner no
        // reason to click it. Every other disclosure in the app supplies its own
        // glyph for exactly this reason (`.lessons-track-filter`,
        // `.repertoire-level-header`, `.srs-summary-details`); this one now does
        // too, pointing at the content it reveals and flipping when open.
      }
      <details className="card--sunken metronome-meter metronome-config">
        <summary>
          <Icon name="chevron-down" />
          Beats, meter and accents
        </summary>
        <div className="metronome-config-body">
          <div className="field-row metronome-meter-row">
            <div className="field">
              <label htmlFor={beatsId}>Beats</label>
              <input
                id={beatsId}
                type="number"
                min={1}
                max={MAX_BEATS}
                value={metronome.timeSignature.beats}
                onChange={(event) =>
                  metronome.setTimeSignature({
                    beats: Number(event.target.value),
                    beatType: metronome.timeSignature.beatType,
                  })
                }
              />
            </div>

            <div className="field">
              <label htmlFor={beatTypeId}>Beat unit</label>
              <select
                id={beatTypeId}
                value={metronome.timeSignature.beatType}
                onChange={(event) =>
                  metronome.setTimeSignature({
                    beats: metronome.timeSignature.beats,
                    beatType: Number(event.target.value),
                  })
                }
              >
                {BEAT_TYPES.map((value) => (
                  <option key={value} value={value}>{`/${value}`}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor={subdivisionId}>Subdivision</label>
              <select
                id={subdivisionId}
                value={metronome.subdivision}
                onChange={(event) => metronome.setSubdivision(Number(event.target.value) as Subdivision)}
              >
                {SUBDIVISIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === 1 ? 'Beat' : `${value} clicks / beat`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <AccentEditor
            timeSignature={metronome.timeSignature}
            accents={metronome.accents}
            onChange={metronome.setAccents}
          />
        </div>
      </details>
    </div>
  )
}
