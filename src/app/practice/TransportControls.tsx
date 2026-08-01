/**
 * Play / pause / stop, plus the position readout in bars and beats
 * (roadmap 1.18). A thin, controlled component: all state lives in
 * `usePracticeEngine` and this only renders it.
 */
import type { TransportState } from '@core/timing/transport.ts'
import type { PositionDisplay } from './usePracticeEngine.ts'

export type TransportControlsProps = {
  readonly phase: TransportState
  readonly position: PositionDisplay | undefined
  readonly onPlay: () => void
  readonly onPause: () => void
  readonly onStop: () => void
}

export function TransportControls({
  phase,
  position,
  onPlay,
  onPause,
  onStop,
}: TransportControlsProps) {
  const running = phase === 'playing' || phase === 'waiting'
  return (
    <div className="transport-controls" role="group" aria-label="Transport">
      <button type="button" onClick={onPlay} disabled={running}>
        Play
      </button>
      <button type="button" onClick={onPause} disabled={!running}>
        Pause
      </button>
      <button type="button" onClick={onStop} disabled={phase === 'stopped'}>
        Stop
      </button>
      <output aria-label="Position">
        {position === undefined
          ? '—'
          : `Measure ${position.measureNumber}, beat ${position.beat} of ${position.beatsPerMeasure}`}
      </output>
      {phase === 'waiting' && <span role="status">Waiting for you…</span>}
    </div>
  )
}
