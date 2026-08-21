/**
 * The groove trainer (roadmap DR-09) — the first drums destination that
 * teaches anything, and the first one in the drums nav.
 *
 * A thin view over `useGrooveDrill`: it owns no timing and no grading, only
 * what is on screen. Three things are on screen on purpose, and each is a
 * teaching decision rather than a layout one.
 *
 * **The pattern is a grid, not a staff.** DR-05's `GrooveStaff` does not
 * exist yet (`notation/NotationDevGallery.tsx` is still its placeholder), and
 * a learner at this level reads a grid faster than drum notation anyway. When
 * the renderer lands, this is where it goes.
 *
 * **The tolerance is on screen.** "Within 100 ms counts as on the beat" is
 * the difference between a trainer that teaches and one that just judges, so
 * it is stated where the learner reads it, not left in the grader.
 *
 * **Every pad answers for itself.** One line per limb, each naming that pad's
 * own count and its own offset — the point of the whole feature is that a
 * learner is told WHICH limb was off, not that a run "was not clean".
 *
 * ## The pads make no sound
 *
 * The app has no drum samples: `AudioOutput` can play a pitched note or a
 * metronome click and nothing else. Pressing a pad therefore flashes and is
 * counted, but is silent — the click carries the pulse and the result carries
 * the verdict. A pitched piano note standing in for a kick drum would be
 * worse than the silence. Real pad sounds are their own roadmap item.
 *
 * ## Why pointerdown, not click
 *
 * A click fires on release. A drummer's hit is the moment the stick lands, so
 * the timestamp has to come from `pointerdown` — and the same for the keys,
 * which is the fallback for the (typical) learner with no e-kit.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { Icon } from '@app/ui/Icon.tsx'
import type { AudioOutput, Clock, DateSource } from '@core/ports/index.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { lastRunSummary, padLabel, padLineText } from '@core/drums/practice/attempt.ts'
import { GRADED_REPEATS, useGrooveDrill } from './useGrooveDrill.ts'

export type GrooveScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
  readonly date?: DateSource
}

const MIN_BPM = 40
const MAX_BPM = 200

/**
 * One key per pad, chosen by hand position rather than by mnemonic: F and J
 * are the two index fingers' home keys (hands = hi-hat and snare) and the
 * space bar is the thumb (foot = kick). G sits under the same finger as F,
 * which is what an open hi-hat is on a real kit — the same limb, opened.
 */
const PAD_KEY: Partial<Record<MappedDrumPad, string>> = {
  hhClosed: 'KeyF',
  hhOpen: 'KeyG',
  snare: 'KeyJ',
  kick: 'Space',
}

/** The badge printed on the pad itself — a keycap, so the space bar gets its glyph. */
const KEY_BADGE: Readonly<Record<string, string>> = {
  KeyF: 'F',
  KeyG: 'G',
  KeyJ: 'J',
  Space: '␣',
}

/** The same keys spelled out, for the sentence under the pads. */
const KEY_WORD: Readonly<Record<string, string>> = {
  KeyF: 'F',
  KeyG: 'G',
  KeyJ: 'J',
  Space: 'Space',
}

function keyHint(pads: readonly MappedDrumPad[]): string {
  const parts = pads.flatMap((pad) => {
    const code = PAD_KEY[pad]
    if (code === undefined) return []
    return [`${KEY_WORD[code] ?? code} ${padLabel(pad).toLowerCase()}`]
  })
  return `Keys: ${parts.join(', ')}.`
}

function runStateText(phase: string, bar: number, beat: number): string {
  if (phase === 'count-in') return `Count in — beat ${beat}`
  if (phase === 'playing') return `Playing — bar ${bar} of ${GRADED_REPEATS}, beat ${beat}`
  if (phase === 'done') return 'Run finished'
  return 'Ready'
}

export function GrooveScreen(props: GrooveScreenProps) {
  const drill = useGrooveDrill({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(props.audioOutput === undefined ? {} : { audioOutput: props.audioOutput }),
    ...(props.frameDriver === undefined ? {} : { frameDriver: props.frameDriver }),
    ...(props.date === undefined ? {} : { date: props.date }),
  })
  const running = drill.phase === 'count-in' || drill.phase === 'playing'
  // After a run, the next thing anyone wants is another run — so the same
  // button says so, rather than a second button appearing next to it.
  const transportLabel = running ? 'Stop' : drill.phase === 'done' ? 'Play again' : 'Start'
  const tempoId = useId()
  const grooveLabelId = useId()

  // Same draft-string treatment as `MetronomeScreen`'s bpm cell, for the same
  // reason: typing "70" passes through "7", which is not a tempo, and an
  // empty field is a legal intermediate state. Commit on blur or Enter.
  const [bpmDraft, setBpmDraft] = useState(String(drill.bpm))
  useEffect(() => {
    setBpmDraft(String(drill.bpm))
  }, [drill.bpm])

  function commitBpmDraft(): void {
    const parsed = Number.parseInt(bpmDraft, 10)
    if (Number.isNaN(parsed)) {
      setBpmDraft(String(drill.bpm))
      return
    }
    drill.setBpm(parsed)
  }

  // The window listener is what makes the keyboard a real instrument here: a
  // learner playing with both hands is not going to keep a pad focused.
  const hitRef = useRef(drill.hit)
  hitRef.current = drill.hit
  const padsRef = useRef(drill.pads)
  padsRef.current = drill.pads
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // A pad button that already handled this key (see `padKeyDown`), a held
      // key repeating, or the learner typing a tempo — none of those are hits.
      if (event.defaultPrevented || event.repeat) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return
      const pad = padsRef.current.find((candidate) => PAD_KEY[candidate] === event.code)
      if (pad === undefined) return
      // Space would otherwise scroll the page, and would activate whichever
      // button has focus — including Stop.
      event.preventDefault()
      hitRef.current(pad)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function padKeyDown(event: React.KeyboardEvent, pad: MappedDrumPad): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!event.repeat) drill.hit(pad)
  }

  const grooveIndex = drill.grooves.findIndex((groove) => groove.id === drill.score.id)
  const stepGroove = (delta: 1 | -1): void => {
    const next = drill.grooves[grooveIndex + delta]
    if (next !== undefined) drill.setGrooveId(next.id)
  }

  return (
    <div className="page page--focus groove-screen">
      <div className="page-header">
        <h1>Groove trainer</h1>
        <p className="page-header-subtitle">
          Play along on the pads. Each limb is timed on its own, and anything within 100 ms of the
          beat counts as on the beat.
        </p>
      </div>

      <div className="card groove-setup">
        <div className="field">
          <span className="field-label" id={grooveLabelId}>
            Groove
          </span>
          <div className="stepper groove-picker" role="group" aria-labelledby={grooveLabelId}>
            <button type="button" aria-label="Previous groove" disabled={running || grooveIndex <= 0} onClick={() => stepGroove(-1)}>
              <Icon name="minus" />
            </button>
            <span className="stepper-value groove-title">{drill.score.title}</span>
            <button
              type="button"
              aria-label="Next groove"
              disabled={running || grooveIndex >= drill.grooves.length - 1}
              onClick={() => stepGroove(1)}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>

        <div className="field groove-tempo">
          <label htmlFor={tempoId}>Tempo (bpm)</label>
          <input
            id={tempoId}
            type="number"
            inputMode="numeric"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            disabled={running}
            value={bpmDraft}
            onChange={(event) => setBpmDraft(event.target.value)}
            onBlur={commitBpmDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitBpmDraft()
              } else if (event.key === 'Escape') {
                setBpmDraft(String(drill.bpm))
              }
            }}
          />
        </div>
      </div>

      {/* The pattern, one row per limb. Decorative: the pad buttons name
          themselves and the result names every count, so a screen reader is
          not walked through 24 empty cells. */}
      <div className="card groove-grid" aria-hidden="true">
        {drill.pads.map((pad) => (
          <div className="groove-grid-row" key={pad}>
            <span className="groove-grid-label">{padLabel(pad)}</span>
            <div className="groove-grid-cells">
              {drill.cellsFor(pad).map((sounds, index) => (
                <span
                  key={index}
                  className={sounds ? 'groove-cell is-note' : 'groove-cell'}
                  data-state={drill.activeCell === index ? 'active' : undefined}
                  data-beat={index % drill.cellsPerBar === 0 ? 'downbeat' : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="groove-pads">
        {drill.pads.map((pad) => (
          <button
            key={pad}
            type="button"
            className="groove-pad"
            aria-label={padLabel(pad)}
            onPointerDown={() => drill.hit(pad)}
            onKeyDown={(event) => padKeyDown(event, pad)}
          >
            <span className="groove-pad-name" aria-hidden="true">
              {padLabel(pad)}
            </span>
            <span className="groove-pad-key" aria-hidden="true">
              {KEY_BADGE[PAD_KEY[pad] ?? ''] ?? '—'}
            </span>
            {(drill.flashes[pad] ?? 0) > 0 && (
              <span key={drill.flashes[pad]} className="groove-pad-flash" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <p className="groove-key-hint">{keyHint(drill.pads)}</p>

      <div className="groove-transport">
        <button
          type="button"
          className="btn-primary groove-start-stop"
          // Named explicitly because the label swaps with the state: the
          // accessible name has to change with the visible one, not be
          // inferred from whatever text happens to be inside at the time.
          aria-label={transportLabel}
          aria-pressed={running}
          onClick={running ? drill.stop : drill.start}
        >
          <Icon name={running ? 'stop' : 'play'} />
          {transportLabel}
        </button>
      </div>

      <p role="status" aria-label="Run state" className="groove-run-state">
        {runStateText(drill.phase, drill.bar, drill.beat)}
      </p>

      {drill.performance !== undefined && (
        <section aria-label="Result" className="card groove-result">
          <p className="groove-verdict">{drill.performance.clean ? 'Clean run' : 'Not clean yet'}</p>
          <ul className="groove-result-lines">
            {drill.rows.map((row) => (
              <li key={row.pad}>{padLineText(row)}</li>
            ))}
          </ul>
        </section>
      )}

      {drill.performance === undefined && drill.lastAttempt !== undefined && (
        <p className="groove-last-run">{lastRunSummary(drill.lastAttempt)}</p>
      )}
    </div>
  )
}
