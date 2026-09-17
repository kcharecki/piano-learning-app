/**
 * Drums metronome screen (roadmap DR-12): a click engine with subdivision
 * accents, click placement, a gap-click "keep time yourself" drill with
 * return-drift grading, random mute, a bar-stepped tempo ramp, and the drum
 * kit's own click sound — all state and scheduling live in
 * `useDrumsMetronome.ts`, this file only renders it.
 *
 * Layout follows the same "glance controls first, configuration behind a
 * disclosure" rule `MetronomeScreen.tsx` established (roadmap UI-25): tempo,
 * subdivision, placement and Start/Stop are always visible; gap, mute,
 * subdivision volume and the ramp — the "timing games", set once per drill,
 * not glanced at mid-practice — sit behind a closed-by-default `<details>`.
 */
import { useEffect, useId, useRef } from 'react'
import { Icon } from '@app/ui/Icon.tsx'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { ClickPlacement } from '@core/timing/clickFilters.ts'
import type { Clock, DrumAudioOutput, Rng } from '@core/ports/index.ts'
import {
  DRUMS_MAX_BPM,
  DRUMS_MIN_BPM,
  MAX_EVERY_N_BARS,
  MAX_GAP_BARS,
  MAX_RAMP_STEP_BPM,
  MIN_EVERY_N_BARS,
  MIN_GAP_BARS,
  MIN_RAMP_STEP_BPM,
  useDrumsMetronome,
  type DrumsMetronomeApi,
  type DrumSubdivision,
  type ReturnReport,
} from './useDrumsMetronome.ts'

export type DrumsMetronomeScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audio?: DrumAudioOutput
  readonly driver?: FrameDriver
  readonly rng?: Rng
}

const SUBDIVISIONS: readonly DrumSubdivision[] = [1, 2, 3, 4]

const PLACEMENT_OPTIONS: readonly {
  readonly label: string
  readonly short: string
  readonly value: ClickPlacement
}[] = [
  { label: 'All beats', short: 'All', value: { kind: 'all' } },
  { label: '2 & 4', short: '2 & 4', value: { kind: 'beats', beats: [1, 3] } },
  { label: 'Downbeat only', short: '1 only', value: { kind: 'downbeat' } },
  { label: 'Every 4 bars', short: 'Every 4', value: { kind: 'every-n-bars', n: 4 } },
]

function samePlacement(a: ClickPlacement, b: ClickPlacement): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'beats' && b.kind === 'beats') {
    return a.beats.length === b.beats.length && a.beats.every((v, i) => v === b.beats[i])
  }
  if (a.kind === 'every-n-bars' && b.kind === 'every-n-bars') return a.n === b.n
  return true
}

const MUTE_OPTIONS: readonly { readonly label: string; readonly value: number }[] = [
  { label: '0%', value: 0 },
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
]

function beatStatusText(m: DrumsMetronomeApi): string {
  if (!m.running) return 'Stopped'
  if (m.silentBar) return 'Silent bar — keep time'
  return `Bar ${m.bar + 1} · beat ${m.beat + 1}`
}

function returnStatusText(r: ReturnReport | undefined): string {
  if (r === undefined) return ''
  if (r.driftMs === undefined) return 'No tap near the return'
  const rounded = Math.round(r.driftMs)
  return rounded >= 0 ? `Back +${rounded} ms late` : `Back −${Math.abs(rounded)} ms early`
}

export function DrumsMetronomeScreen(props: DrumsMetronomeScreenProps) {
  const metronome = useDrumsMetronome({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audio === undefined ? {} : { audio: props.audio }),
    ...(props.driver === undefined ? {} : { driver: props.driver }),
    ...(props.rng === undefined ? {} : { rng: props.rng }),
  })

  const bpmId = useId()
  const gapOnId = useId()
  const gapOffId = useId()
  const subVolumeId = useId()
  const rampToggleId = useId()
  const rampStepId = useId()
  const rampEveryId = useId()
  const rampTargetId = useId()

  // Space bar taps time during a gap's silent bar (the whole point of the
  // drill) — but only when focus is not already on a control, so pressing
  // Space to activate Start/Stop or a segmented option does not ALSO record
  // a tap. Read through a ref, not `metronome.tap` in the dependency array:
  // `metronome` is a fresh object every render, and re-subscribing the
  // listener every render just to keep this closure fresh would be pure
  // churn for a callback that never actually goes stale in a way that matters.
  const tapRef = useRef(metronome.tap)
  tapRef.current = metronome.tap

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code !== 'Space') return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      event.preventDefault()
      tapRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const gap = metronome.gap
  const ramp = metronome.ramp

  return (
    <div className="page page--focus drums-metronome-screen">
      <div className="page-header">
        <h1>Metronome</h1>
      </div>

      {metronome.error !== undefined && (
        <p role="alert" data-testid="drums-metronome-error">
          {metronome.error}
        </p>
      )}

      <div className="card drums-metronome-stage">
        <div className="field drums-metronome-bpm-field">
          <label htmlFor={bpmId}>BPM</label>
          <div className="stepper">
            <button
              type="button"
              aria-label="Decrease BPM"
              disabled={metronome.bpm <= DRUMS_MIN_BPM}
              onClick={() => metronome.setBpm(metronome.bpm - 1)}
            >
              <Icon name="minus" />
            </button>
            <span id={bpmId} className="stepper-value">
              {metronome.bpm}
            </span>
            <button
              type="button"
              aria-label="Increase BPM"
              disabled={metronome.bpm >= DRUMS_MAX_BPM}
              onClick={() => metronome.setBpm(metronome.bpm + 1)}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>

        <div className="drums-metronome-seg-field">
          <span className="drums-metronome-field-label" aria-hidden="true">
            Subdivision
          </span>
          <div className="seg-control" role="radiogroup" aria-label="Subdivision">
            {SUBDIVISIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={metronome.subdivision === value}
                aria-label={`${value} click${value === 1 ? '' : 's'} per beat`}
                onClick={() => metronome.setSubdivision(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="drums-metronome-seg-field">
          <span className="drums-metronome-field-label" aria-hidden="true">
            Click on
          </span>
          <div className="seg-control" role="radiogroup" aria-label="Click on">
            {PLACEMENT_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={samePlacement(metronome.placement, option.value)}
                aria-label={option.label}
                onClick={() => metronome.setPlacement(option.value)}
              >
                {option.short}
              </button>
            ))}
          </div>
        </div>

        <p role="status" aria-label="Beat" className="drums-metronome-beat-status">
          {beatStatusText(metronome)}
        </p>
      </div>

      <div className="drums-metronome-transport">
        <button
          type="button"
          className="btn-primary drums-metronome-start-stop"
          aria-pressed={metronome.running}
          onClick={metronome.running ? metronome.stop : metronome.start}
        >
          <Icon name={metronome.running ? 'stop' : 'play'} />
          {metronome.running ? 'Stop' : 'Start'}
        </button>
        <button
          type="button"
          className="btn-icon drums-metronome-tap"
          aria-label="Tap"
          onClick={metronome.tap}
        >
          <Icon name="hand" />
        </button>
      </div>

      <p role="status" aria-label="Return" className="drums-metronome-return-status">
        {returnStatusText(metronome.lastReturn)}
      </p>

      <details className="card--sunken drums-metronome-games">
        <summary>
          <Icon name="chevron-down" />
          Timing games
        </summary>
        <div className="drums-metronome-games-body">
          <div className="field-row drums-metronome-gap-fields">
            <div className="field">
              <label htmlFor={gapOnId}>Bars on</label>
              <input
                id={gapOnId}
                type="number"
                min={MIN_GAP_BARS}
                max={MAX_GAP_BARS}
                value={gap.onBars}
                onChange={(event) =>
                  metronome.setGap({ onBars: Number(event.target.value), offBars: gap.offBars })
                }
              />
            </div>
            <div className="field">
              <label htmlFor={gapOffId}>Bars off</label>
              <input
                id={gapOffId}
                type="number"
                min={0}
                max={MAX_GAP_BARS}
                value={gap.offBars}
                onChange={(event) =>
                  metronome.setGap({ onBars: gap.onBars, offBars: Number(event.target.value) })
                }
              />
            </div>
          </div>

          <div className="field drums-metronome-mute-field">
            <span className="drums-metronome-field-label">Random mute</span>
            <div className="seg-control" role="radiogroup" aria-label="Random mute probability">
              {MUTE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={metronome.muteProbability === option.value}
                  onClick={() => metronome.setMuteProbability(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field drums-metronome-volume-field">
            <label htmlFor={subVolumeId}>Subdivision volume</label>
            <input
              id={subVolumeId}
              type="range"
              aria-label="Subdivision volume"
              min={0}
              max={1}
              step={0.05}
              value={metronome.subdivisionVolume}
              onChange={(event) => metronome.setSubdivisionVolume(Number(event.target.value))}
            />
          </div>

          <div className="field-inline drums-metronome-ramp-toggle">
            <input
              id={rampToggleId}
              type="checkbox"
              checked={ramp !== undefined}
              onChange={(event) => {
                if (event.target.checked) {
                  metronome.setRamp({
                    stepBpm: 5,
                    everyBars: 4,
                    targetBpm: Math.min(DRUMS_MAX_BPM, metronome.bpm + 20),
                  })
                } else {
                  metronome.setRamp(undefined)
                }
              }}
            />
            <label htmlFor={rampToggleId}>Tempo ramp</label>
          </div>

          {ramp !== undefined && (
            <div className="field-row drums-metronome-ramp-fields">
              <div className="field">
                <label htmlFor={rampStepId}>+bpm</label>
                <input
                  id={rampStepId}
                  type="number"
                  min={MIN_RAMP_STEP_BPM}
                  max={MAX_RAMP_STEP_BPM}
                  value={ramp.stepBpm}
                  onChange={(event) =>
                    metronome.setRamp({ ...ramp, stepBpm: Number(event.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={rampEveryId}>every N bars</label>
                <input
                  id={rampEveryId}
                  type="number"
                  min={MIN_EVERY_N_BARS}
                  max={MAX_EVERY_N_BARS}
                  value={ramp.everyBars}
                  onChange={(event) =>
                    metronome.setRamp({ ...ramp, everyBars: Number(event.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={rampTargetId}>up to bpm</label>
                <input
                  id={rampTargetId}
                  type="number"
                  min={DRUMS_MIN_BPM}
                  max={DRUMS_MAX_BPM}
                  value={ramp.targetBpm}
                  onChange={(event) =>
                    metronome.setRamp({ ...ramp, targetBpm: Number(event.target.value) })
                  }
                />
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
