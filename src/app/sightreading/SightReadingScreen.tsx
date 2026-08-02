/**
 * The sight-reading trainer screen (roadmap 2.12, REQ-3.4.1/3/4/6). A thin
 * view over `useSightReadingTrainer` — every decision (when the preview ends,
 * when the run is graded, how the level adapts) lives in that hook and the
 * core modules behind it; this file only renders the current phase and
 * forwards the two user actions (`start`, `skipPreview`).
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { Clock, DateSource, AudioOutput, MidiInput, Rng } from '@core/ports/index.ts'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useState } from 'react'
import { ExerciseScore } from './ExerciseScore.tsx'
import { useSightReadingTrainer } from './useSightReadingTrainer.ts'

export type SightReadingScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
  readonly rng?: Rng
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function SightReadingScreen(props: SightReadingScreenProps) {
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const trainer = useSightReadingTrainer({ ...props, metronomeEnabled })

  return (
    <div className="sight-reading-screen">
      <h2>Sight reading</h2>
      <MidiDeviceStatus
        connected={trainer.midi.input !== undefined}
        devices={trainer.midi.devices}
        selectedDeviceId={trainer.midi.selectedDeviceId}
        connectionError={trainer.midi.connectionError}
      />
      <p data-testid="sight-reading-level">Level {trainer.level}</p>

      <label>
        <input
          type="checkbox"
          checked={metronomeEnabled}
          onChange={(event) => setMetronomeEnabled(event.target.checked)}
        />
        Metronome click
      </label>

      {trainer.error !== undefined && (
        <p role="alert" data-testid="sight-reading-error">
          Could not generate an exercise: {trainer.error}
        </p>
      )}

      {trainer.phase === 'idle' && (
        <button type="button" onClick={trainer.start}>
          Start exercise
        </button>
      )}

      {trainer.phase === 'preview' && trainer.score !== undefined && (
        <section aria-label="Preview">
          <p role="status" data-testid="preview-countdown">
            Scan the piece — playing in {Math.ceil(trainer.previewRemainingMs / 1000)}s
          </p>
          <button type="button" onClick={trainer.skipPreview}>
            Begin now
          </button>
          <ExerciseScore score={trainer.score} />
        </section>
      )}

      {trainer.phase === 'playing' && trainer.score !== undefined && (
        <section aria-label="Playing">
          <p role="status" data-testid="playing-status">
            Playing — the metronome does not stop. Read and play along.
          </p>
          {trainer.position !== undefined && (
            <p data-testid="sight-reading-position">
              Measure {trainer.position.measureNumber}, beat {trainer.position.beat}
            </p>
          )}
          <ExerciseScore score={trainer.score} />
        </section>
      )}

      {trainer.phase === 'finished' && trainer.result !== undefined && (
        <section aria-label="Result">
          <dl>
            <dt>Accuracy</dt>
            <dd data-testid="sight-reading-accuracy">{percent(trainer.result.accuracy)}</dd>
            <dt>Timing consistency</dt>
            <dd data-testid="sight-reading-timing">{percent(trainer.result.timingConsistency)}</dd>
          </dl>
          {trainer.previousLevel !== undefined && trainer.previousLevel !== trainer.level && (
            <p data-testid="sight-reading-level-change">
              Level {trainer.previousLevel > trainer.level ? 'decreased' : 'increased'} to{' '}
              {trainer.level}
            </p>
          )}
          <button type="button" onClick={trainer.start}>
            Next exercise
          </button>
        </section>
      )}
    </div>
  )
}
