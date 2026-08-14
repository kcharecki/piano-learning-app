/**
 * Play / pause / stop, plus the position readout in bars and beats
 * (roadmap 1.18). A thin, controlled component: all state lives in
 * `usePracticeEngine` and this only renders it.
 *
 * UI-09 (2026-08-12 UI audit): Play is icon+label and the screen's one
 * `.btn-primary` — the eye lands there first. Pause/Stop are icon-only
 * `.btn-icon`s, each carrying the `aria-label` that primitive requires
 * since neither has visible text. All three buttons always mount (only
 * their `disabled` state changes with `phase`), so toggling between
 * Play/Pause/Stop never changes this group's width — no layout shift.
 */
import { Icon } from '@app/ui/Icon.tsx'
import type { TransportState } from '@core/timing/transport.ts'
import type { PositionDisplay } from './usePracticeEngine.ts'

export type TransportControlsProps = {
  readonly phase: TransportState
  readonly position: PositionDisplay | undefined
  readonly onPlay: () => void
  readonly onPause: () => void
  readonly onStop: () => void
  /**
   * Disables Pause and Stop specifically — e.g. while an assessment run is in
   * progress (REQ-3.3.4: a run cannot be paused or stopped). Play is already
   * disabled whenever `running` is true, which covers it too since a run is
   * always playing.
   */
  readonly disabled?: boolean
}

export function TransportControls({
  phase,
  position,
  onPlay,
  onPause,
  onStop,
  disabled = false,
}: TransportControlsProps) {
  const running = phase === 'playing' || phase === 'waiting'
  return (
    <div className="transport-controls" role="group" aria-label="Transport">
      <button type="button" className="btn-primary" onClick={onPlay} disabled={running}>
        <Icon name="play" />
        Play
      </button>
      <button
        type="button"
        className="btn-icon"
        aria-label="Pause"
        onClick={onPause}
        disabled={!running || disabled}
      >
        <Icon name="pause" />
      </button>
      <button
        type="button"
        className="btn-icon"
        aria-label="Stop"
        onClick={onStop}
        disabled={phase === 'stopped' || disabled}
      >
        <Icon name="stop" />
      </button>
      <output aria-label="Position" className="transport-position">
        {position === undefined ? '—' : `Measure ${position.measureNumber} · beat ${position.beat}`}
      </output>
      {phase === 'waiting' && <span role="status">Waiting for you…</span>}
    </div>
  )
}
