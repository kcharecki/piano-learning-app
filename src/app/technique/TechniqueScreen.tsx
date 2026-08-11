/**
 * The technique drill screen (roadmap 4.4a, REQ-3.7.1/3.7.2/3.7.3) — a thin
 * view over `useTechniqueDrill`. Picking a level and a drill (kind, tonic,
 * octaves and hands are all baked into each drill's title — see
 * `@core/technique/library.ts`) selects what gets engraved and clicked
 * through; Start/Stop runs it against the metronome and, on Stop, shows the
 * evenness score, whether the run was clean at this tempo, and the drill's
 * clean-tempo history (REQ-3.7.3).
 *
 * Roadmap 5.23: this screen also carries a standing statement of what the
 * scoring above cannot see, always rendered (see `technique-safety-note`
 * below), and a periodic posture-check prompt gated by
 * `useTechniqueDrill`'s `posturePromptDue` — the schedule itself lives in
 * `posturePromptSchedule.ts` and is driven by the injected `Clock`, never
 * real time. Both read from `technique-safety.css`, a file this screen
 * imports directly rather than through the shared stylesheet index, since
 * this task does not own that index.
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import { PracticeKeyboard } from '@app/practice/PracticeKeyboard.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { TrendChart } from '@app/dashboard/TrendChart.tsx'
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { MAX_BPM, MIN_BPM } from '@core/timing/metronome.ts'
import { useState } from 'react'
import { useTechniqueDrill } from './useTechniqueDrill.ts'
import './technique-safety.css'

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

  // Same on-screen/qwerty fallback Practice renders (roadmap 5.4/5.5), and the
  // same "shown by default exactly when it is the learner's only way to play"
  // rule (roadmap 5.5a) — a chord-inversions drill needs the latch just as
  // much as a chord in a piece does.
  const deviceAttached =
    drill.midi.input !== undefined &&
    drill.midi.devices.some((device) => device.id === drill.midi.selectedDeviceId)
  const [showKeyboardChoice, setShowKeyboardChoice] = useState<boolean | undefined>(undefined)
  const showKeyboard = showKeyboardChoice ?? !deviceAttached
  const [latchKeys, setLatchKeys] = useState(false)

  return (
    <div className="technique-screen">
      <h2>Technique</h2>

      {/* REQ-5.23: always visible, not behind a disclosure — this is a
          safety statement about what the scoring below cannot see, not a
          dismissible tip. Names the specific blind spots the Taubman/
          Golandsky literature calls out as tendonitis mechanisms, rather
          than a vague "consult a teacher" disclaimer nobody reads twice. */}
      <p className="technique-safety-note" data-testid="technique-safety-statement">
        MIDI hears pitch and timing only. It cannot see wrist height or collapse, forearm
        alignment, finger curl, which finger you actually used, shoulder tension, or bench
        height — a clean, rising tempo history is not a technique check.
      </p>

      {drill.posturePromptDue && (
        <div className="technique-posture-prompt" role="status" data-testid="technique-posture-prompt">
          <p>
            Time for a human check: watch (or film) your wrist, forearm and shoulder for the
            next run — is the wrist level and loose, or dropped/braced?
          </p>
          <button type="button" onClick={drill.acknowledgePosturePrompt}>
            I checked
          </button>
        </div>
      )}

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
          {/* REQ-3.7.1 (roadmap 5.22): `writeMusicXml` now emits each note's
              `fingering` as a `<technical><fingering>` notation, and OSMD
              renders it natively above/below its own notehead, per hand —
              no separate text readout needed. */}
          <ExerciseScore score={drill.score} />
        </section>
      )}
      {/* Directly under the engraving, same placement and reasoning as
          Practice (roadmap 5.4) — notes pressed here enter the drill's own
          `PlayableMidiInput` (roadmap 5.5a), the same seam a MIDI keyboard
          feeds, so they are scored by the real matcher a run is using. */}
      <PracticeKeyboard
        score={drill.score}
        onPress={drill.press}
        onRelease={drill.release}
        deviceConnected={deviceAttached}
        visible={showKeyboard}
        onVisibleChange={setShowKeyboardChoice}
        latch={latchKeys}
        onLatchChange={setLatchKeys}
      />

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
