/**
 * The clap/tap-back drill's view (roadmap 3.21/5.21, REQ-3.6.2; redesigned as
 * a tap instrument roadmap UI-14, 2026-08-12 UI audit): a mode of the
 * existing Rhythm screen (`RhythmScreen.tsx` picks between this and the
 * sight-reading tap drill and owns the shared header/mode tabs — see that
 * file), not a new nav destination, since `app/shell/Shell.tsx` is owned by
 * another session this round and cannot take a new route.
 *
 * This file deliberately never imports `ExerciseScore`/`ScoreViewer` — no
 * notation is rendered here, ever, in ANY phase, which is the whole point of
 * REQ-3.6.2's "hear a phrase, never see it" ("a learner who can read the
 * answer off the screen is doing sight-reading again" — task brief). Music
 * logic and playback sequencing live in `useClapbackDrill.ts`; this is a thin
 * view over its `phase`.
 *
 * The tap pad (shared visual language with `RhythmScreen.tsx`'s sight-tap
 * stage, deliberately re-declared rather than shared as a component — the two
 * files' hooks return different shapes and neither is in scope to introduce a
 * third shared file) follows the phase: "Listen…" while the phrase plays,
 * disabled, then "Now clap it back" once tapping opens.
 *
 * roadmap UI-04b removed `MidiDeviceStatus` from every other note-answered
 * screen and moved it to the shell's topbar input-status chip; this was the
 * last of the seven screens still rendering it in-flow (outside that task's
 * file list). Removed here — see this task's report for what that unblocks.
 */
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { Icon } from '@app/ui/Icon.tsx'
import type { ClapbackLevel } from '@core/rhythm/clapback.ts'
import type { AudioOutput, Clock, MidiInput, Rng } from '@core/ports/index.ts'
import type { TapVerdict } from '@core/rhythm/tapClassifier.ts'
import { useId, useState } from 'react'
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

/** Roadmap U.3: identical glyph vocabulary to `RhythmScreen.tsx`'s
 *  `TapFlashGlyph` — deliberately re-declared, not shared, mirroring this
 *  file's own "shared visual language... re-declared rather than shared as a
 *  component" precedent (see the module doc). See that function's comment
 *  for why each glyph is the one already documented for its `--fb-*` token,
 *  not a new one. */
function TapFlashGlyph({ verdict }: { readonly verdict: TapVerdict | undefined }) {
  if (verdict === 'hit') return <Icon name="check" />
  if (verdict === 'early') return <>‹</>
  if (verdict === 'late') return <>›</>
  return <>+</>
}

export function RhythmClapback(props: RhythmClapbackProps) {
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  // `level` is owned by the hook, not this view — sourced from and persisted to the
  // ear-training session store, so it survives a remount and adapts on its own
  // (see `useClapbackDrill.ts`'s module doc, "Level" section, MAJOR-1 review fix).
  const drill = useClapbackDrill({ ...props, bars: BARS, metronomeEnabled })
  const level = drill.level
  const busy = drill.phase === 'listening' || drill.phase === 'tapping'
  const levelLabelId = useId()

  return (
    <div className="rhythm-clapback">
      {drill.phase === 'idle' && (
        <div className="card">
          <div className="field-row">
            <div className="field">
              <label id={levelLabelId}>Level</label>
              <div className="stepper" role="group" aria-labelledby={levelLabelId}>
                <button
                  type="button"
                  aria-label="Decrease level"
                  disabled={level <= MIN_LEVEL || busy}
                  onClick={() => drill.setLevel(stepLevel(level, -1))}
                >
                  <Icon name="minus" />
                </button>
                <span className="stepper-value" data-testid="clapback-level">
                  {level}
                </span>
                <button
                  type="button"
                  aria-label="Increase level"
                  disabled={level >= MAX_LEVEL || busy}
                  onClick={() => drill.setLevel(stepLevel(level, 1))}
                >
                  <Icon name="plus" />
                </button>
              </div>
            </div>

            <label>
              <input
                type="checkbox"
                checked={metronomeEnabled}
                onChange={(event) => setMetronomeEnabled(event.target.checked)}
              />
              Metronome click while tapping
            </label>
          </div>
        </div>
      )}

      {drill.phase === 'idle' && (
        <button type="button" className="btn-primary" onClick={drill.start}>
          <Icon name="play" />
          Start
        </button>
      )}

      {(drill.phase === 'listening' || drill.phase === 'tapping') && (
        <section aria-label={drill.phase === 'listening' ? 'Listening' : 'Tapping'} className="rhythm-stage">
          <div className="stat-group">
            <div className="stat">
              <span className="stat-value" data-testid="clapback-position-measure">
                {drill.position?.measureNumber ?? '—'}
              </span>
              <span className="stat-label">Measure</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="clapback-position-beat">
                {drill.position?.beat ?? '—'}
              </span>
              <span className="stat-label">Beat</span>
            </div>
          </div>

          <button
            type="button"
            className="rhythm-tap-pad"
            aria-label={drill.phase === 'listening' ? 'Listen — a rhythm phrase is playing' : 'Now clap it back — or press Space'}
            disabled={drill.phase !== 'tapping'}
            onClick={drill.tap}
          >
            <span
              className="rhythm-tap-pad-label"
              role="status"
              data-testid={drill.phase === 'listening' ? 'clapback-listening-status' : 'clapback-tapping-status'}
            >
              {drill.phase === 'listening'
                ? 'Listen — a rhythm phrase is playing. No notation, no click; just the phrase.'
                : 'Now clap it back — on the pad, the spacebar, or your MIDI keyboard.'}
            </span>
            {drill.phase === 'tapping' && (
              <span className="rhythm-tap-pad-count" data-testid="clapback-tap-count" aria-hidden="true">
                {drill.tapCount}
              </span>
            )}
            {drill.tapCount > 0 && (
              <span
                key={drill.tapCount}
                className={`rhythm-tap-pad-flash rhythm-tap-pad-flash--${drill.lastTapVerdict ?? 'extra'}`}
                aria-hidden="true"
                data-testid="clapback-tap-verdict"
                data-verdict={drill.lastTapVerdict ?? 'extra'}
              >
                <TapFlashGlyph verdict={drill.lastTapVerdict} />
              </span>
            )}
          </button>

          {drill.phase === 'tapping' && (
            <button type="button" className="btn-ghost rhythm-stop-btn" onClick={drill.stop}>
              <Icon name="stop" />
              Stop
            </button>
          )}
        </section>
      )}

      {drill.phase === 'graded' && drill.grade !== undefined && (
        <section aria-label="Result">
          <div className="stat-group">
            <div className="stat">
              <span className="stat-value" data-testid="clapback-matched">
                {drill.grade.matched}
              </span>
              <span className="stat-label">Matched</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="clapback-missed">
                {drill.grade.missed}
              </span>
              <span className="stat-label">Missed</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="clapback-extra">
                {drill.grade.extra}
              </span>
              <span className="stat-label">Extra</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="clapback-accuracy">
                {percent(drill.grade.accuracy)}
              </span>
              <span className="stat-label">Accuracy</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="clapback-deviation">
                {Math.round(drill.grade.meanAbsDeviationMs)}ms
              </span>
              <span className="stat-label">Mean deviation</span>
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={drill.start}>
            <Icon name="play" />
            Again
          </button>
        </section>
      )}
    </div>
  )
}
