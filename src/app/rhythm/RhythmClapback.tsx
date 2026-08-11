/**
 * The clap/tap-back drill's view (roadmap 3.21/5.21, REQ-3.6.2): a mode of
 * the existing Rhythm screen (`RhythmScreen.tsx` picks between this and the
 * sight-reading tap drill — see that file), not a new nav destination, since
 * `app/shell/Shell.tsx` is owned by another session this round and cannot
 * take a new route.
 *
 * This file deliberately never imports `ExerciseScore`/`ScoreViewer` — no
 * notation is rendered here, ever, in ANY phase, which is the whole point of
 * REQ-3.6.2's "hear a phrase, never see it" ("a learner who can read the
 * answer off the screen is doing sight-reading again" — task brief). Music
 * logic and playback sequencing live in `useClapbackDrill.ts`; this is a thin
 * view over its `phase`.
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { ClapbackLevel } from '@core/rhythm/clapback.ts'
import type { AudioOutput, Clock, MidiInput, Rng } from '@core/ports/index.ts'
import { useState } from 'react'
import { useClapbackDrill } from './useClapbackDrill.ts'

export type RhythmClapbackProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly rng?: Rng
  readonly audioOutput?: AudioOutput
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly frameDriver?: FrameDriver
}

const LEVELS = [1, 2, 3, 4, 5] as const satisfies readonly ClapbackLevel[]
const MIN_LEVEL: ClapbackLevel = 1
const MAX_LEVEL: ClapbackLevel = 5
const BARS = 2

function stepLevel(current: ClapbackLevel, delta: 1 | -1): ClapbackLevel {
  const next = LEVELS[LEVELS.indexOf(current) + delta]
  return next ?? current
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function RhythmClapback(props: RhythmClapbackProps) {
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  // `level` is owned by the hook, not this view — sourced from and persisted to the
  // ear-training session store, so it survives a remount and adapts on its own
  // (see `useClapbackDrill.ts`'s module doc, "Level" section, MAJOR-1 review fix).
  const drill = useClapbackDrill({ ...props, bars: BARS, metronomeEnabled })
  const level = drill.level
  const busy = drill.phase === 'listening' || drill.phase === 'tapping'
  const tapDisabled = drill.phase !== 'tapping'

  return (
    <div className="rhythm-clapback">
      <MidiDeviceStatus
        connected={drill.midi.input !== undefined}
        devices={drill.midi.devices}
        selectedDeviceId={drill.midi.selectedDeviceId}
        connectionError={drill.midi.connectionError}
      />
      <div className="rhythm-clapback-level" role="group" aria-label="Level">
        <button
          type="button"
          aria-label="Decrease level"
          disabled={level <= MIN_LEVEL || busy}
          onClick={() => drill.setLevel(stepLevel(level, -1))}
        >
          −
        </button>
        <span data-testid="clapback-level">Level {level}</span>
        <button
          type="button"
          aria-label="Increase level"
          disabled={level >= MAX_LEVEL || busy}
          onClick={() => drill.setLevel(stepLevel(level, 1))}
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
        Metronome click while tapping
      </label>

      {drill.phase === 'idle' && (
        <button type="button" onClick={drill.start}>
          Start
        </button>
      )}

      {drill.phase === 'listening' && (
        <section aria-label="Listening">
          <p role="status" data-testid="clapback-listening-status">
            Listen — a rhythm phrase is playing. No notation, no click; just the phrase.
          </p>
        </section>
      )}

      {drill.phase === 'tapping' && (
        <section aria-label="Tapping">
          <p role="status" data-testid="clapback-tapping-status">
            Now clap it back — on the button below, the spacebar, or your MIDI keyboard.
          </p>
          {drill.position !== undefined && (
            <p data-testid="clapback-position">
              Measure {drill.position.measureNumber}, beat {drill.position.beat}
            </p>
          )}
          <p data-testid="clapback-tap-count">Taps: {drill.tapCount}</p>
        </section>
      )}

      <button type="button" disabled={tapDisabled} onClick={drill.tap}>
        Tap
      </button>

      {drill.phase === 'graded' && drill.grade !== undefined && (
        <section aria-label="Result">
          <dl>
            <dt>Matched</dt>
            <dd data-testid="clapback-matched">{drill.grade.matched}</dd>
            <dt>Missed</dt>
            <dd data-testid="clapback-missed">{drill.grade.missed}</dd>
            <dt>Extra</dt>
            <dd data-testid="clapback-extra">{drill.grade.extra}</dd>
            <dt>Accuracy</dt>
            <dd data-testid="clapback-accuracy">{percent(drill.grade.accuracy)}</dd>
            <dt>Mean deviation</dt>
            <dd data-testid="clapback-deviation">{Math.round(drill.grade.meanAbsDeviationMs)}ms</dd>
          </dl>
          <button type="button" onClick={drill.start}>
            Again
          </button>
        </section>
      )}
    </div>
  )
}
