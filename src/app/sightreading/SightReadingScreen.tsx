/**
 * The sight-reading trainer screen (roadmap 2.12, REQ-3.4.1/3/4/6). A thin
 * view over `useSightReadingTrainer` — every decision (when the preview ends,
 * when the run is graded, how the level adapts) lives in that hook and the
 * core modules behind it; this file only renders the current phase and
 * forwards the two user actions (`start`, `skipPreview`).
 */
import type { Clock, DateSource, AudioOutput, MidiInput, Rng } from '@core/ports/index.ts'
import { PracticeKeyboard } from '@app/practice/PracticeKeyboard.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { ScoreChrome } from '@app/score/engraver.ts'
import { Icon } from '@app/ui/Icon.tsx'
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

/** Suppresses the engraved title/composer block on every piece of paper this
 *  screen shows (roadmap UI-11, 2026-08-12 UI audit finding: the exercise
 *  paper printed its own redundant "Sight Reading — C major" heading while
 *  the `.page-header` below already names the screen for the whole session).
 *  A stable object identity, not a literal at each call site, so it never
 *  forces `ScoreViewer`'s load effect to re-run — see that effect's own
 *  comment on why it depends on the primitive `chrome?.title`, not `chrome`. */
const PAPER_CHROME: ScoreChrome = { title: false }

export function SightReadingScreen(props: SightReadingScreenProps) {
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [customization, setCustomization] = useState<SightReadingCustomization>({})
  const trainer = useSightReadingTrainer({ ...props, metronomeEnabled, customization })

  // UI-21 (states sweep): this screen used to have no no-MIDI fallback at
  // all — see `useSightReadingTrainer.ts`'s "playableInput" comment. Same
  // "is there a keyboard to play?" predicate `PracticeScreen`/`MidiDeviceStatus`
  // already use, so this can never disagree with the shell's own input chip.
  const deviceAttached =
    trainer.midi.input !== undefined &&
    trainer.midi.devices.some((device) => device.id === trainer.midi.selectedDeviceId)
  const [showKeyboardChoice, setShowKeyboardChoice] = useState<boolean | undefined>(undefined)
  const showKeyboard = showKeyboardChoice ?? !deviceAttached
  const [latchKeys, setLatchKeys] = useState(false)

  return (
    <div className="page page--focus sight-reading-screen">
      <header className="page-header">
        <div>
          <h1>Sight reading</h1>
        </div>
      </header>

      <div className="card card--sunken">
        <div className="field-row sight-reading-status-row">
          <label>
            <input
              type="checkbox"
              checked={metronomeEnabled}
              onChange={(event) => setMetronomeEnabled(event.target.checked)}
            />
            Metronome click
          </label>

          {/* roadmap 5.57: named distinctly from the Progress screen's
              "sight-reading (curriculum track)" row — same word "level", two
              different numbers. This one is the trainer's own adaptive
              difficulty; the track number lives only on Progress and moves
              via advancement/manual override. Kept as one wrapper so the two
              closely-related lines stay together as a single flex item in
              the row above, rather than wrapping independently of each
              other. */}
          <div className="sight-reading-level-display">
            <p data-testid="sight-reading-level">
              Sight-reading trainer level: <b>{trainer.level}</b>
            </p>
            <small data-testid="sight-reading-level-note">
              Adapts automatically from your recent run accuracy &mdash; separate from the curriculum
              track level on Progress, which only moves when you advance a level or set it by hand.
            </small>
          </div>
        </div>

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
          <Icon name="play" />
          Start exercise
        </button>
      )}

      {trainer.phase === 'preview' && trainer.score !== undefined && (
        <section aria-label="Preview">
          <div className="sight-reading-paper">
            <ExerciseScore score={trainer.score} chrome={PAPER_CHROME} />
            <div className="sight-reading-countdown" role="status" data-testid="preview-countdown">
              <span className="sight-reading-countdown-number">
                {Math.ceil(trainer.previewRemainingMs / 1000)}s
              </span>
              <span className="sight-reading-countdown-caption">Scan the piece first</span>
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={trainer.skipPreview}>
            <Icon name="play" />
            Begin now
          </button>
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
          <ExerciseScore score={trainer.score} chrome={PAPER_CHROME} />
          <PracticeKeyboard
            score={trainer.score}
            onPress={trainer.press}
            onRelease={trainer.release}
            deviceConnected={deviceAttached}
            visible={showKeyboard}
            onVisibleChange={setShowKeyboardChoice}
            latch={latchKeys}
            onLatchChange={setLatchKeys}
          />
        </section>
      )}

      {trainer.phase === 'finished' && trainer.result !== undefined && (
        <section aria-label="Result">
          <div className="stat-group">
            <div className="stat">
              <span className="stat-value" data-testid="sight-reading-accuracy">
                {percent(trainer.result.accuracy)}
              </span>
              <span className="stat-label">Accuracy</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="sight-reading-timing">
                {percent(trainer.result.timingConsistency)}
              </span>
              <span className="stat-label">Timing consistency</span>
            </div>
          </div>
          {trainer.previousLevel !== undefined && trainer.previousLevel !== trainer.level && (
            <p data-testid="sight-reading-level-change">
              Sight-reading trainer level{' '}
              {trainer.previousLevel > trainer.level ? 'decreased' : 'increased'} to {trainer.level}
            </p>
          )}
          <button type="button" className="btn-primary" onClick={trainer.start}>
            <Icon name="play" />
            Next exercise
          </button>
        </section>
      )}
    </div>
  )
}
