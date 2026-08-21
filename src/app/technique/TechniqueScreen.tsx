/**
 * The technique drill screen (roadmap 4.4a, REQ-3.7.1/3.7.2/3.7.3) — a thin
 * view over `useTechniqueDrill`. Picking a level and a drill (kind, tonic,
 * octaves and hands are all baked into each drill's title — see
 * `@core/technique/library.ts`) selects what gets engraved and clicked
 * through; Start/Stop runs it against the metronome and, on Stop, shows the
 * evenness score, whether the run was clean at this tempo, and the drill's
 * clean-tempo history (REQ-3.7.3).
 *
 * Roadmap 5.23: this screen also carries a standing statement of what the
 * scoring above cannot see, always rendered (see `technique-safety-note`
 * below), and a periodic posture-check prompt gated by
 * `useTechniqueDrill`'s `posturePromptDue` — the schedule itself lives in
 * `posturePromptSchedule.ts` and is driven by the injected `Clock`, never
 * real time. Both are styled from
 * `design-system/css/feature-technique-safety.css`, reached through the
 * shared stylesheet index like every other screen's styling.
 *
 * Redesigned roadmap UI-15 (2026-08-12 UI audit): `.page`/`.page-header`
 * scaffold, the drill picker and level stepper move into the header's
 * `.page-header-actions`, the safety callout restyles onto `.card--sunken`
 * (still first, still unconditional — REQ-5.23), the engraving/keyboard/
 * transport collapse into one compact `.card`, and the clean-tempo history
 * becomes a flex row of dot tokens instead of `TrendChart` (no chart
 * library needed for a handful of points).
 *
 * Roadmap T.12: the result line names the wrong notes. It used to read
 * "Evenness 88% — Not yet clean" and nothing else, so a learner who played
 * all eight triads minor saw a number close to 90 and no way to find the
 * note. The sentence itself is built in `@core/technique/verdict.ts` — which
 * note stands in for which degree is music theory, not presentation — and
 * this file only decides how many of them fit on screen at once.
 *
 * Roadmap T.11: it also carries the roll line. Presses inside the drill's
 * chord window are collapsed into one onset before evenness sees them, and
 * that window is now wide enough to hold a chord struck with one mouse
 * pointer — so how far the chords were actually rolled is reported in words
 * beside the verdict instead of disappearing into the score.
 */
import { PracticeKeyboard } from '@app/practice/PracticeKeyboard.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { ExerciseScore } from '@app/sightreading/ExerciseScore.tsx'
import { Icon } from '@app/ui/Icon.tsx'
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import {
  describeTechniqueMistake,
  type TechniqueDiagnosis,
} from '@core/technique/verdict.ts'
import type { AudioOutput, Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { MAX_BPM, MIN_BPM } from '@core/timing/metronome.ts'
import { type ReactElement, useState } from 'react'
import { useTechniqueDrill } from './useTechniqueDrill.ts'

/**
 * How many named wrong notes fit on screen before the list stops being a
 * correction and starts being a report card. Three is what a teacher says out
 * loud after a run; the rest are counted, not spelled out, because a learner
 * who cannot hold three corrections cannot hold nine.
 */
const MAX_SHOWN_MISTAKES = 3

function TechniqueMistakes({
  diagnosis,
}: {
  readonly diagnosis: TechniqueDiagnosis | undefined
}): ReactElement | null {
  if (diagnosis === undefined) return null
  const shown = diagnosis.mistakes.slice(0, MAX_SHOWN_MISTAKES)
  const rest = diagnosis.mistakes.length - shown.length
  const uncounted = diagnosis.missed + diagnosis.extra
  if (shown.length === 0 && uncounted === 0) return null
  return (
    <>
      {shown.length > 0 && (
        <ul className="technique-result-mistakes" data-testid="technique-mistakes">
          {shown.map((mistake) => (
            <li key={`${String(mistake.expectedMidi)}:${String(mistake.playedMidi)}`}>
              {describeTechniqueMistake(mistake)}
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="technique-result-aside">
          {rest === 1 ? 'And 1 other wrong note.' : `And ${String(rest)} other wrong notes.`}
        </p>
      )}
      {uncounted > 0 && (
        <p className="technique-result-aside" data-testid="technique-uncounted">
          {countedText(diagnosis.missed, diagnosis.extra)}
        </p>
      )}
    </>
  )
}

/** "2 notes missed, 1 extra." — the part of the accuracy figure that has no
 *  wrong note to name, said in words rather than left inside the percentage. */
function countedText(missed: number, extra: number): string {
  const parts: string[] = []
  if (missed > 0) parts.push(`${String(missed)} ${missed === 1 ? 'note' : 'notes'} missed`)
  if (extra > 0) parts.push(`${String(extra)} extra`)
  return `${parts.join(', ')}.`
}

export type TechniqueScreenProps = {
  readonly initialLevel?: number
  readonly initialDrillId?: string
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
}

function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))
}

export function TechniqueScreen(props: TechniqueScreenProps) {
  const { initialLevel, initialDrillId, ...ports } = props
  const [level, setLevel] = useState(() => clampLevel(initialLevel ?? MIN_LEVEL))
  const drill = useTechniqueDrill({
    level,
    ...(initialDrillId === undefined ? {} : { initialDrillId }),
    ...ports,
  })

  // Held as raw text and only committed on blur/Enter — see MetronomeScreen's
  // own comment: a controlled input bound directly to the clamped
  // `drill.bpm` rewrites mid-keystroke every time the clamp kicks in (typing
  // "8" toward "80" clamps to MIN_BPM after the first digit, then the next
  // keystroke produces "200"), making most tempi impossible to type.
  const [bpmText, setBpmText] = useState(() => String(drill.bpm))
  const [bpmEditing, setBpmEditing] = useState(false)
  const displayedBpm = bpmEditing ? bpmText : String(drill.bpm)

  function commitBpm(): void {
    setBpmEditing(false)
    const parsed = Number(bpmText)
    if (Number.isFinite(parsed)) drill.setBpm(parsed)
  }

  // Same on-screen/qwerty fallback Practice renders (roadmap 5.4/5.5), and the
  // same "shown by default exactly when it is the learner's only way to play"
  // rule (roadmap 5.5a) — a chord-inversions drill needs the latch just as
  // much as a chord in a piece does.
  const deviceAttached =
    drill.midi.input !== undefined &&
    drill.midi.devices.some((device) => device.id === drill.midi.selectedDeviceId)
  const [showKeyboardChoice, setShowKeyboardChoice] = useState<boolean | undefined>(undefined)
  const showKeyboard = showKeyboardChoice ?? !deviceAttached
  const [latchKeys, setLatchKeys] = useState(false)

  return (
    <div className="page page--focus technique-screen">
      <div className="page-header">
        <div>
          <h1>Technique</h1>
        </div>
        <div className="page-header-actions">
          <div className="field">
            <label htmlFor="technique-drill-select">Drill</label>
            <select
              id="technique-drill-select"
              value={drill.drill?.id ?? ''}
              disabled={drill.running}
              onChange={(e) => drill.setDrillId(e.target.value)}
            >
              {drill.drills.length === 0 && <option value="">No drills at this level</option>}
              {drill.drills.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
          {/* roadmap UI-15 (canonicalised in the 2026-08 stepper sweep):
              migrated off the hand-rolled `role="group"` div that rendered
              its label BETWEEN the − and + buttons (the exact defect
              `.stepper` exists to fix — see primitives.css's own "HONEST
              STATUS" note naming this screen). The label sits OUTSIDE
              `.stepper` entirely, in a `.field`, and carries only the bare
              word "Level" — the canonical shape shared with Flashcards,
              Rhythm and Metronome. The bare numeral lives in the
              `.stepper-value` cell, under `data-testid="technique-level"`. */}
          <div className="field">
            <label id="technique-level-label">Level</label>
            <div className="stepper" role="group" aria-labelledby="technique-level-label">
              <button
                type="button"
                aria-label="Decrease level"
                disabled={level <= MIN_LEVEL || drill.running}
                onClick={() => setLevel((l) => Math.max(MIN_LEVEL, l - 1))}
              >
                −
              </button>
              <span className="stepper-value" data-testid="technique-level">
                {level}
              </span>
              <button
                type="button"
                aria-label="Increase level"
                disabled={level >= MAX_LEVEL || drill.running}
                onClick={() => setLevel((l) => Math.min(MAX_LEVEL, l + 1))}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* REQ-5.23: always visible, not behind a disclosure — this is a
          safety statement about what the scoring below cannot see, not a
          dismissible tip. Names the specific blind spots the Taubman/
          Golandsky literature calls out as tendonitis mechanisms, rather
          than a vague "consult a teacher" disclaimer nobody reads twice.
          Stays FIRST in the page, ahead of the drill card — never demoted
          behind a toggle, `<details>`, or moved lower on the page. */}
      <div className="card--sunken technique-safety-note" data-testid="technique-safety-statement">
        <span className="technique-safety-note-icon">
          <Icon name="hand" />
        </span>
        <p>
          MIDI hears pitch and timing only. It cannot see wrist height or collapse, forearm
          alignment, finger curl, which finger you actually used, shoulder tension, or bench
          height — a clean, rising tempo history is not a technique check.
        </p>
      </div>

      {drill.posturePromptDue && (
        <div className="technique-posture-prompt" role="status" data-testid="technique-posture-prompt">
          <p>
            Time for a human check: watch (or film) your wrist, forearm and shoulder for the
            next run — is the wrist level and loose, or dropped/braced?
          </p>
          <button type="button" onClick={drill.acknowledgePosturePrompt}>
            I checked
          </button>
        </div>
      )}

      <div className="card technique-drill-card">
        {drill.score !== undefined && (
          <section aria-label="Drill score">
            {/* REQ-3.7.1 (roadmap 5.22): `writeMusicXml` now emits each note's
                `fingering` as a `<technical><fingering>` notation, and OSMD
                renders it natively above/below its own notehead, per hand —
                no separate text readout needed. */}
            <ExerciseScore score={drill.score} chrome={{ compact: true }} />
          </section>
        )}
        {/* Directly under the engraving, same placement and reasoning as
            Practice (roadmap 5.4) — notes pressed here enter the drill's own
            `PlayableMidiInput` (roadmap 5.5a), the same seam a MIDI keyboard
            feeds, so they are scored by the real matcher a run is using. */}
        <PracticeKeyboard
          score={drill.score}
          onPress={drill.press}
          onRelease={drill.release}
          deviceConnected={deviceAttached}
          visible={showKeyboard}
          onVisibleChange={setShowKeyboardChoice}
          latch={latchKeys}
          onLatchChange={setLatchKeys}
        />

        {/* roadmap UI-15: target tempo and the transport share one footer
            row. Start and Stop are the SAME button element, swapped in
            place (icon + label change, nothing mounts/unmounts) so the one
            primary action on this screen never causes a layout shift —
            `.technique-transport-btn`'s reserved `min-width` (feature-
            technique.css) absorbs the "Start"/"Stop" width difference. */}
        <div className="technique-drill-footer">
          <div className="field">
            <label htmlFor="technique-bpm-input">Target tempo (bpm)</label>
            <input
              id="technique-bpm-input"
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              value={displayedBpm}
              disabled={drill.running}
              onChange={(e) => {
                setBpmEditing(true)
                setBpmText(e.target.value)
              }}
              onBlur={commitBpm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitBpm()
              }}
            />
          </div>
          <button
            type="button"
            className="btn-primary technique-transport-btn"
            data-testid="technique-transport-btn"
            disabled={!drill.running && drill.drill === undefined}
            onClick={drill.running ? drill.stop : drill.start}
          >
            <Icon name={drill.running ? 'stop' : 'play'} />
            {drill.running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {drill.lastAttempt !== undefined && (
        <div role="status" data-testid="technique-result" className="technique-result">
          <p className="technique-result-score">
            Evenness {(drill.lastAttempt.evenness * 100).toFixed(0)}% · Notes{' '}
            {(drill.lastAttempt.accuracy * 100).toFixed(0)}% —{' '}
            {drill.lastAttempt.clean ? `Clean at ${drill.lastAttempt.bpm}bpm` : 'Not yet clean'}
          </p>
          <TechniqueMistakes diagnosis={drill.lastDiagnosis} />
          {/* Roadmap T.11: the chord window is wide enough to hold a rolled
              chord now, so what it holds has to be said out loud rather than
              folded into the evenness figure where it reads as a timing
              fault. Absent when nothing was rolled — a line printed after
              every run is a line nobody reads. */}
          {drill.lastRoll !== undefined && (
            <p className="technique-result-aside" data-testid="technique-roll">
              {drill.lastRoll}
            </p>
          )}
        </div>
      )}

      {/* roadmap UI-15: "Clean runs" replaces the old "Clean tempo history —
          No clean run yet at this drill" two-bare-lines footer. Empty state
          teaches (DESIGN.md rule 6); a real history renders as a flex row of
          dot tokens — `role="img"`/`aria-label` exposes it as one summary to
          assistive tech (the same accessible-name contract the old
          `TrendChart` gave e2e, kept without pulling in a chart library for
          a handful of points). */}
      <div className="card technique-history-card">
        <h3>Clean runs</h3>
        {drill.history.length === 0 ? (
          <p className="technique-history-empty">
            A clean run at target tempo advances you — your first is one Start away.
          </p>
        ) : (
          <>
            <p data-testid="technique-best-bpm">Best clean tempo: {drill.bestBpm}bpm</p>
            <div
              className="technique-history-runs"
              role="img"
              aria-label="Clean tempo history"
              data-testid="technique-history"
            >
              {drill.history.map((point, i) => (
                <span
                  key={`${point.at}-${i}`}
                  className="technique-history-run"
                  data-testid="technique-history-point"
                >
                  <span className="technique-history-run-dot" aria-hidden="true" />
                  <span className="technique-history-run-value">{point.bpm}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
