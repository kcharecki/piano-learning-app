/**
 * The Rhythm screen (roadmap 2.13, 3.21/5.21, REQ-3.9.1-adjacent, REQ-3.6.2).
 * A mode switch over two drills, not a new nav destination — `app/shell/Shell.tsx`
 * is owned by another session this round and cannot take a new route, so this
 * is the option that ships today (see roadmap 3.21's own note):
 *
 *  - **"Sight-reading mode"** (the original drill, unchanged, still the
 *    default so every existing test and habit keeps working): the pattern is
 *    engraved on the staff for the whole run and the audio is deliberately
 *    silenced — reading notation while tapping a silent click, i.e. rhythm
 *    SIGHT-READING. Lives in `useRhythmDrill.ts`.
 *  - **"Clap-back mode"** (new): the pattern is HEARD, never shown, then
 *    tapped back from memory once playback ends — real call-and-response,
 *    REQ-3.6.2. Lives in `RhythmClapback.tsx`/`useClapbackDrill.ts`, entirely
 *    separate from the sight-read view below (it never imports
 *    `ExerciseScore`, on purpose).
 *
 * The two mode buttons are deliberately NOT labelled with the word "tap"
 * (`e2e/metronome-drills.spec.ts`, which this file may not edit, looks up
 * the drill's own Tap button with a bare `{ name: 'Tap' }` — Playwright's
 * default name match is substring, so any mode label containing "tap" would
 * make that lookup ambiguous).
 *
 * This file only renders the chosen mode; pattern generation, playback and
 * grading all live in the two drills' own hooks behind it.
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import type { AudioOutput, Clock, MidiInput, Rng } from '@core/ports/index.ts'
import { useState } from 'react'
import { RhythmClapback } from './RhythmClapback.tsx'
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

/** 'sight-tap' (the original drill) stays the default so every existing habit
 *  and test keeps working unchanged — see the module doc. */
type RhythmMode = 'sight-tap' | 'clap-back'

function stepComplexity(current: Complexity, delta: 1 | -1): Complexity {
  const next = COMPLEXITIES[COMPLEXITIES.indexOf(current) + delta]
  return next ?? current
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function RhythmScreen(props: RhythmScreenProps) {
  const [mode, setMode] = useState<RhythmMode>('sight-tap')
  const [complexity, setComplexity] = useState<Complexity>(MIN_COMPLEXITY)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const drill = useRhythmDrill({ ...props, complexity, bars: BARS, metronomeEnabled })
  const tapDisabled = drill.phase !== 'tapping'

  return (
    <div className="rhythm-screen">
      <h2>Rhythm</h2>
      <div className="rhythm-mode" role="group" aria-label="Rhythm mode">
        <button
          type="button"
          aria-pressed={mode === 'sight-tap'}
          onClick={() => setMode('sight-tap')}
        >
          Sight-reading mode
        </button>
        <button
          type="button"
          aria-pressed={mode === 'clap-back'}
          onClick={() => setMode('clap-back')}
        >
          Clap-back mode
        </button>
      </div>

      {mode === 'clap-back' && <RhythmClapback {...props} />}

      {mode === 'sight-tap' && (
        <>
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

          {drill.score !== undefined && <ExerciseScore score={drill.score} />}

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
        </>
      )}
    </div>
  )
}
