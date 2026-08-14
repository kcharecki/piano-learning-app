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
 */
import type { AudioOutput, Clock } from '@core/ports/index.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { MAX_BPM, MIN_BPM, SUBDIVISIONS, type Subdivision } from '@core/timing/metronome.ts'
import { useId } from 'react'
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

  const bpmSliderId = useId()
  const beatsId = useId()
  const beatTypeId = useId()
  const subdivisionId = useId()
  const meterHeadingId = useId()

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
          <label htmlFor={bpmSliderId}>BPM</label>
          <div className="stepper metronome-bpm-stepper">
            <button
              type="button"
              aria-label="Decrease BPM"
              disabled={metronome.bpm <= MIN_BPM}
              onClick={() => metronome.setBpm(metronome.bpm - 1)}
            >
              <Icon name="minus" />
            </button>
            <span className="stepper-value">{metronome.bpm}</span>
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

      <section className="card--sunken metronome-meter" aria-labelledby={meterHeadingId}>
        <h2 id={meterHeadingId}>Meter</h2>

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
      </section>
    </div>
  )
}
