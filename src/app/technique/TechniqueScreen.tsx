/**
 * The technique drill screen (roadmap 4.4a, REQ-3.7.1/3.7.2/3.7.3) — a thin
 * view over `useTechniqueDrill`. Picking a level and a drill (kind, tonic,
 * octaves and hands are all baked into each drill's title — see
 * `@core/technique/library.ts`) selects what gets engraved and clicked
 * through; Start/Stop runs it against the metronome and, on Stop, shows the
 * evenness score, whether the run was clean at this tempo, and the drill's
 * clean-tempo history (REQ-3.7.3).
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { TrendChart } from '@app/dashboard/TrendChart.tsx'
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { MAX_BPM, MIN_BPM } from '@core/timing/metronome.ts'
import { useState } from 'react'
import { useTechniqueDrill } from './useTechniqueDrill.ts'

export type TechniqueScreenProps = {
  readonly initialLevel?: number
  readonly initialDrillId?: string
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
}

function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))
}

export function TechniqueScreen(props: TechniqueScreenProps) {
  const { initialLevel, initialDrillId, ...ports } = props
  const [level, setLevel] = useState(() => clampLevel(initialLevel ?? MIN_LEVEL))
  const drill = useTechniqueDrill({
    level,
    ...(initialDrillId === undefined ? {} : { initialDrillId }),
    ...ports,
  })

  // Held as raw text and only committed on blur/Enter — see MetronomeScreen's
  // own comment: a controlled input bound directly to the clamped
  // `drill.bpm` rewrites mid-keystroke every time the clamp kicks in (typing
  // "8" toward "80" clamps to MIN_BPM after the first digit, then the next
  // keystroke produces "200"), making most tempi impossible to type.
  const [bpmText, setBpmText] = useState(() => String(drill.bpm))
  const [bpmEditing, setBpmEditing] = useState(false)
  const displayedBpm = bpmEditing ? bpmText : String(drill.bpm)

  function commitBpm(): void {
    setBpmEditing(false)
    const parsed = Number(bpmText)
    if (Number.isFinite(parsed)) drill.setBpm(parsed)
  }

  return (
    <div className="technique-screen">
      <h2>Technique</h2>
      <MidiDeviceStatus
        connected={drill.midi.input !== undefined}
        devices={drill.midi.devices}
        selectedDeviceId={drill.midi.selectedDeviceId}
        connectionError={drill.midi.connectionError}
      />

      <div className="technique-level" role="group" aria-label="Level">
        <button
          type="button"
          aria-label="Decrease level"
          disabled={level <= MIN_LEVEL || drill.running}
          onClick={() => setLevel((l) => Math.max(MIN_LEVEL, l - 1))}
        >
          −
        </button>
        <span data-testid="technique-level">Level {level}</span>
        <button
          type="button"
          aria-label="Increase level"
          disabled={level >= MAX_LEVEL || drill.running}
          onClick={() => setLevel((l) => Math.min(MAX_LEVEL, l + 1))}
        >
          +
        </button>
      </div>

      <div className="technique-drill-picker">
        <label htmlFor="technique-drill-select">Drill</label>
        <select
          id="technique-drill-select"
          value={drill.drill?.id ?? ''}
          disabled={drill.running}
          onChange={(e) => drill.setDrillId(e.target.value)}
        >
          {drill.drills.length === 0 && <option value="">No drills at this level</option>}
          {drill.drills.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>

      <div className="technique-tempo">
        <label htmlFor="technique-bpm-input">Target tempo (bpm)</label>
        <input
          id="technique-bpm-input"
          type="number"
          min={MIN_BPM}
          max={MAX_BPM}
          value={displayedBpm}
          disabled={drill.running}
          onChange={(e) => {
            setBpmEditing(true)
            setBpmText(e.target.value)
          }}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitBpm()
          }}
        />
      </div>

      <div className="technique-transport">
        <button type="button" disabled={drill.drill === undefined || drill.running} onClick={drill.start}>
          Start
        </button>
        <button type="button" disabled={!drill.running} onClick={drill.stop}>
          Stop
        </button>
      </div>

      {drill.score !== undefined && (
        <section aria-label="Drill score">
          <ExerciseScore score={drill.score} />
          {/* REQ-3.7.1: recommended fingerings shown alongside the engraving.
              `writeMusicXml` (frozen, owned elsewhere) drops the `fingering`
              notation, so the engraving itself carries no finger numbers yet
              — surface the sequence as text so the requirement is visibly
              met without touching that file. */}
          <p data-testid="technique-fingering">
            Fingering:{' '}
            {drill.score.notes
              .filter((n) => n.fingering !== undefined)
              .map((n) => n.fingering)
              .join(' - ')}
          </p>
        </section>
      )}

      {drill.lastAttempt !== undefined && (
        <p role="status" data-testid="technique-result">
          Evenness {(drill.lastAttempt.evenness * 100).toFixed(0)}% —{' '}
          {drill.lastAttempt.clean ? `Clean at ${drill.lastAttempt.bpm}bpm` : 'Not yet clean'}
        </p>
      )}

      <section aria-label="Tempo history">
        <h3>Clean tempo history</h3>
        {drill.history.length === 0 ? (
          <p>No clean run yet at this drill.</p>
        ) : (
          <>
            <p data-testid="technique-best-bpm">Best clean tempo: {drill.bestBpm}bpm</p>
            <div data-testid="technique-history">
              <TrendChart
                points={drill.history.map((point, i) => ({
                  label: `${new Date(point.at).toLocaleDateString()}-${i}`,
                  value: point.bpm,
                }))}
                ariaLabel="Clean tempo history"
                valueSuffix="bpm"
              />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
