/**
 * Standalone metronome screen (roadmap 2.28, REQ-3.9.1): tempo, time
 * signature, subdivision and accent controls plus a live beat readout, all
 * driven by `useMetronome` — this file only renders its state and forwards
 * the user's actions. Runs with no score loaded, unlike the in-practice
 * `MetronomeControl`.
 */
import type { AudioOutput, Clock } from '@core/ports/index.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { MAX_BPM, MIN_BPM, SUBDIVISIONS, type Subdivision } from '@core/timing/metronome.ts'
import { useId, useState } from 'react'
import { AccentEditor } from './AccentEditor.tsx'
import { useMetronome } from './useMetronome.ts'

export type MetronomeScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
}

const BEAT_TYPES = [1, 2, 4, 8, 16] as const

export function MetronomeScreen(props: MetronomeScreenProps) {
  const metronome = useMetronome({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audioOutput === undefined ? {} : { audioOutput: props.audioOutput }),
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
  })

  const bpmId = useId()
  const beatsId = useId()
  const beatTypeId = useId()
  const subdivisionId = useId()

  // Held as raw text and only committed on blur/Enter: a controlled input
  // bound directly to the clamped `metronome.bpm` rewrites mid-keystroke
  // every time the clamp kicks in (typing "8" toward "80" clamps to MIN_BPM
  // after the first digit, then the next keystroke produces "200"), making
  // most tempi impossible to type.
  const [bpmText, setBpmText] = useState(() => String(metronome.bpm))
  const [bpmEditing, setBpmEditing] = useState(false)
  const displayedBpm = bpmEditing ? bpmText : String(metronome.bpm)

  function commitBpm(): void {
    setBpmEditing(false)
    const parsed = Number(bpmText)
    if (Number.isFinite(parsed)) metronome.setBpm(parsed)
  }

  return (
    <div className="metronome-screen">
      <h2>Metronome</h2>

      {metronome.error !== undefined && (
        <p role="alert" data-testid="metronome-error">
          {metronome.error}
        </p>
      )}

      <div className="field-row" role="group" aria-label="Tempo and metre">
        <div className="field">
          <label htmlFor={bpmId}>BPM</label>
          <input
            id={bpmId}
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            value={displayedBpm}
            onChange={(event) => {
              setBpmEditing(true)
              setBpmText(event.target.value)
            }}
            onBlur={commitBpm}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitBpm()
            }}
          />
        </div>

        <div className="field">
          <label htmlFor={beatsId}>Beats</label>
          <input
            id={beatsId}
            type="number"
            min={1}
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

      <button
        type="button"
        className="btn-primary"
        onClick={metronome.running ? metronome.stop : metronome.start}
      >
        {metronome.running ? 'Stop' : 'Start'}
      </button>

      <p role="status" data-testid="metronome-beat-readout">
        {metronome.running
          ? metronome.lastClick !== undefined
            ? `Bar ${metronome.lastClick.bar + 1}, beat ${metronome.lastClick.beat + 1}${
                metronome.lastClick.accented ? ' (accent)' : ''
              }`
            : 'Starting…'
          : 'Stopped'}
      </p>

      <div className="metronome-beats" aria-hidden="true">
        {Array.from({ length: metronome.timeSignature.beats }, (_, i) => {
          const isActive = metronome.running && metronome.lastClick?.beat === i
          return (
            <span
              key={i}
              className={metronome.accents[i] === true ? 'beat is-accent' : 'beat'}
              data-state={isActive ? 'active' : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}
