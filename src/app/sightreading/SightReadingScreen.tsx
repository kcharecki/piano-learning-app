/**
 * The sight-reading trainer screen (roadmap 2.12, REQ-3.4.1/3/4/6). A thin
 * view over `useSightReadingTrainer` — every decision (when the preview ends,
 * when the run is graded, how the level adapts) lives in that hook and the
 * core modules behind it; this file only renders the current phase and
 * forwards the two user actions (`start`, `skipPreview`).
 */
import type { Clock, DateSource, AudioOutput, MidiInput, Rng } from '@core/ports/index.ts'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useState } from 'react'
import { ExerciseScore } from './ExerciseScore.tsx'
import { SightReadingCustomizer } from './SightReadingCustomizer.tsx'
import type { SightReadingCustomization } from './customization.ts'
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
  const [customization, setCustomization] = useState<SightReadingCustomization>({})
  const trainer = useSightReadingTrainer({ ...props, metronomeEnabled, customization })

  return (
    <div className="page page--focus sight-reading-screen">
      <header className="page-header">
        <div>
          <h1>Sight reading</h1>
        </div>
      </header>

      {/* roadmap 5.57: named distinctly from the Progress screen's "sight-reading
          (curriculum track)" row — same word "level", two different numbers.
          This one is the trainer's own adaptive difficulty; the track number
          lives only on Progress and moves via advancement/manual override. Kept
          as one wrapper so the two closely-related lines stay next to each
          other rather than getting the .page's own --space-5 section gap
          between them. */}
      <div>
        <p data-testid="sight-reading-level">
          Sight-reading trainer level: <b>{trainer.level}</b>
        </p>
        <small data-testid="sight-reading-level-note">
          Adapts automatically from your recent run accuracy &mdash; separate from the curriculum
          track level on Progress, which only moves when you advance a level or set it by hand.
        </small>
      </div>

      <div className="card card--sunken">
        <label>
          <input
            type="checkbox"
            checked={metronomeEnabled}
            onChange={(event) => setMetronomeEnabled(event.target.checked)}
          />
          Metronome click
        </label>

        <SightReadingCustomizer
          customization={customization}
          onChange={setCustomization}
          disabled={trainer.phase !== 'idle'}
        />
      </div>

      {trainer.error !== undefined && (
        <p role="alert" data-testid="sight-reading-error">
          Could not generate an exercise: {trainer.error}
        </p>
      )}

      {trainer.phase === 'idle' && (
        <button type="button" className="btn-primary" onClick={trainer.start}>
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
              Sight-reading trainer level{' '}
              {trainer.previousLevel > trainer.level ? 'decreased' : 'increased'} to {trainer.level}
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
