/**
 * The rhythm tapping drill screen (roadmap 2.13, REQ-3.9.1-adjacent). A thin
 * view over `useRhythmDrill` — pattern generation, silent-but-clicking
 * playback and grading all live there and in `core/generator/rhythm.ts`
 * behind it; this file only renders the current phase and forwards a tap
 * from whichever input the learner used (button, spacebar, MIDI — all wired
 * inside the hook).
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { AudioOutput, Clock, MidiInput, Rng } from '@core/ports/index.ts'
import { useState } from 'react'
import { PatternPreview } from './PatternPreview.tsx'
import { useRhythmDrill } from './useRhythmDrill.ts'

export type RhythmScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly rng?: Rng
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
}

const COMPLEXITIES = [1, 2, 3, 4, 5] as const
type Complexity = (typeof COMPLEXITIES)[number]
const MIN_COMPLEXITY: Complexity = 1
const MAX_COMPLEXITY: Complexity = 5
const BARS = 4

function stepComplexity(current: Complexity, delta: 1 | -1): Complexity {
  const next = COMPLEXITIES[COMPLEXITIES.indexOf(current) + delta]
  return next ?? current
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function RhythmScreen(props: RhythmScreenProps) {
  const [complexity, setComplexity] = useState<Complexity>(MIN_COMPLEXITY)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const drill = useRhythmDrill({ ...props, complexity, bars: BARS, metronomeEnabled })
  const tapDisabled = drill.phase !== 'tapping'

  return (
    <div className="rhythm-screen">
      <h2>Rhythm</h2>
      <MidiDeviceStatus
        connected={drill.midi.input !== undefined}
        devices={drill.midi.devices}
        selectedDeviceId={drill.midi.selectedDeviceId}
        connectionError={drill.midi.connectionError}
      />
      <div className="rhythm-complexity" role="group" aria-label="Complexity">
        <button
          type="button"
          aria-label="Decrease complexity"
          disabled={complexity <= MIN_COMPLEXITY || drill.phase === 'tapping'}
          onClick={() => setComplexity((c) => stepComplexity(c, -1))}
        >
          −
        </button>
        <span data-testid="rhythm-complexity">Complexity {complexity}</span>
        <button
          type="button"
          aria-label="Increase complexity"
          disabled={complexity >= MAX_COMPLEXITY || drill.phase === 'tapping'}
          onClick={() => setComplexity((c) => stepComplexity(c, 1))}
        >
          +
        </button>
      </div>

      <label>
        <input
          type="checkbox"
          checked={metronomeEnabled}
          onChange={(event) => setMetronomeEnabled(event.target.checked)}
        />
        Metronome click
      </label>

      {drill.phase === 'idle' && (
        <button type="button" onClick={drill.start}>
          Start
        </button>
      )}

      {drill.pattern !== undefined && <PatternPreview pattern={drill.pattern} />}

      {drill.phase === 'tapping' && (
        <section aria-label="Tapping">
          <p role="status" data-testid="rhythm-tapping-status">
            Tap the rhythm — on the button below, the spacebar, or your MIDI keyboard.
          </p>
          {drill.position !== undefined && (
            <p data-testid="rhythm-position">
              Measure {drill.position.measureNumber}, beat {drill.position.beat}
            </p>
          )}
          <p data-testid="rhythm-tap-count">Taps: {drill.tapCount}</p>
        </section>
      )}

      <button type="button" disabled={tapDisabled} onClick={drill.tap}>
        Tap
      </button>

      {drill.phase === 'graded' && drill.grade !== undefined && (
        <section aria-label="Result">
          <dl>
            <dt>Matched</dt>
            <dd data-testid="rhythm-matched">{drill.grade.matched}</dd>
            <dt>Missed</dt>
            <dd data-testid="rhythm-missed">{drill.grade.missed}</dd>
            <dt>Extra</dt>
            <dd data-testid="rhythm-extra">{drill.grade.extra}</dd>
            <dt>Accuracy</dt>
            <dd data-testid="rhythm-accuracy">{percent(drill.grade.accuracy)}</dd>
            <dt>Mean deviation</dt>
            <dd data-testid="rhythm-deviation">{Math.round(drill.grade.meanAbsDeviationMs)}ms</dd>
          </dl>
          <button type="button" onClick={drill.start}>
            Again
          </button>
        </section>
      )}
    </div>
  )
}
