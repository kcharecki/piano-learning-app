/**
 * The ear-training screen (roadmap 3.10, REQ-3.6.1/3.6.2) — the only
 * consumer `core/eartraining`'s drills will ever have. A thin view over
 * `useEarTraining`: the hook generates, plays, grades and schedules every
 * item; this file only renders the current one and forwards an answer from
 * whichever pad matches the selected drill.
 *
 * Melodic and rhythmic dictation are listed in the drill selector as
 * "(not yet answerable)" and disabled — `useEarTraining` can already
 * generate and play both (REQ-3.6.2's phrases are real `EarItem`s exactly
 * like the other four kinds), but grading a played-back phrase needs a
 * timed, multi-note answer capture this task's budget did not reach. See the
 * module's report for the follow-up.
 */
import { chordQualitiesForLevel, scaleTypesForLevel } from '@core/eartraining/chords.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import type { AudioOutput, DateSource, Rng } from '@core/ports/index.ts'
import { intervalLongName, parseInterval } from '@core/theory/intervals.ts'
import { IntervalAnswerButtons } from './IntervalAnswerButtons.tsx'
import { QualityAnswerButtons, humanize } from './QualityAnswerButtons.tsx'
import { useEarTraining } from './useEarTraining.ts'

export type EarTrainingScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly rng?: Rng
}

// All six kinds are selectable — melodic/rhythmic dictation can already be
// generated and played (see useEarTraining.ts's module comment), they just
// have no answer pad yet, which is why the fallback status message below
// exists and must stay reachable rather than dead. See the review finding
// this fixes.
const DRILL_OPTIONS: readonly { readonly kind: EarItemKind; readonly label: string }[] = [
  { kind: 'interval-melodic', label: 'Interval (melodic)' },
  { kind: 'interval-harmonic', label: 'Interval (harmonic)' },
  { kind: 'chord-quality', label: 'Chord quality' },
  { kind: 'scale-mode', label: 'Scale / mode' },
  { kind: 'melodic-dictation', label: 'Melodic dictation (not yet answerable)' },
  { kind: 'rhythmic-dictation', label: 'Rhythmic dictation (not yet answerable)' },
]

/**
 * The wrong-answer feedback speaks the answer pads' own vocabulary — the
 * long interval name plus a direction word, or the humanized chord/scale
 * name — never the raw `EarGrade.expected` (an internal id like `-P5` or
 * `halfDiminished7`) a learner cannot map back to any button they saw.
 */
function describeExpected(kind: EarItemKind, expected: string): string {
  if (kind === 'interval-melodic' || kind === 'interval-harmonic') {
    const descending = expected.startsWith('-')
    const parsed = parseInterval(descending ? expected.slice(1) : expected)
    if (!parsed.ok) return expected
    const name = intervalLongName(parsed.value)
    return kind === 'interval-melodic' ? `${name}, ${descending ? 'descending' : 'ascending'}` : name
  }
  return humanize(expected)
}

export function EarTrainingScreen(props: EarTrainingScreenProps) {
  const drill = useEarTraining(props)
  const kind = drill.kind
  const level = drill.levels[kind]
  // The pad must offer the vocabulary of the item actually on screen, not the
  // (possibly higher, after a promotion, or lower, after a demotion) current
  // session level — otherwise a due item generated at a different level can
  // be unanswerable correctly. See the review finding this fixes.
  const padLevel = drill.item?.level ?? level

  return (
    <div className="eartraining-screen">
      <h2>Ear Training</h2>

      <div className="eartraining-drill" role="group" aria-label="Drill selector">
        <label htmlFor="eartraining-drill-select">Drill</label>
        <select
          id="eartraining-drill-select"
          value={kind}
          onChange={(e) => drill.setKind(e.target.value as EarItemKind)}
        >
          {DRILL_OPTIONS.map((opt) => (
            <option key={opt.kind} value={opt.kind}>
              {opt.label}
            </option>
          ))}
        </select>
        <span data-testid="eartraining-level">Level {level}</span>
      </div>

      <div className="eartraining-controls" role="group" aria-label="Playback">
        <button
          type="button"
          onClick={drill.start}
          disabled={drill.phase === 'playing' || drill.phase === 'answering'}
        >
          {drill.phase === 'graded' ? 'Next' : 'Play'}
        </button>
        <button type="button" onClick={drill.replay} disabled={drill.item === undefined}>
          Replay
        </button>
      </div>

      {drill.item === undefined ? (
        <p role="status">Press Play to hear the first item.</p>
      ) : kind === 'interval-melodic' || kind === 'interval-harmonic' ? (
        <section aria-label="Answer">
          <IntervalAnswerButtons
            key={drill.item.id}
            level={padLevel}
            showDirection={kind === 'interval-melodic' && padLevel > 1}
            onAnswer={(interval, direction) => drill.answer({ kind, interval, direction })}
          />
        </section>
      ) : kind === 'chord-quality' ? (
        <section aria-label="Answer">
          <QualityAnswerButtons
            key={drill.item.id}
            groupLabel="Chord quality answer"
            options={chordQualitiesForLevel(padLevel)}
            onAnswer={(quality) => drill.answer({ kind, quality })}
          />
        </section>
      ) : kind === 'scale-mode' ? (
        <section aria-label="Answer">
          <QualityAnswerButtons
            key={drill.item.id}
            groupLabel="Scale/mode answer"
            options={scaleTypesForLevel(padLevel)}
            onAnswer={(type) => drill.answer({ kind, type })}
          />
        </section>
      ) : (
        <p role="status">This drill plays back, but answering it is not yet implemented.</p>
      )}

      {drill.grade !== undefined && (
        <p role="status" data-testid="eartraining-feedback">
          {drill.grade.correct
            ? 'Correct'
            : `Not quite — it was ${describeExpected(kind, drill.grade.expected)}`}
        </p>
      )}

      <dl className="eartraining-stats" aria-label="Retention">
        <dt>Cards</dt>
        <dd data-testid="eartraining-stats-total">{drill.stats.total}</dd>
        <dt>Due</dt>
        <dd data-testid="eartraining-stats-due">{drill.stats.due}</dd>
        <dt>Young</dt>
        <dd data-testid="eartraining-stats-young">{drill.stats.young}</dd>
        <dt>Mature</dt>
        <dd data-testid="eartraining-stats-mature">{drill.stats.mature}</dd>
        <dt>Average ease</dt>
        <dd data-testid="eartraining-stats-ease">{drill.stats.averageEase.toFixed(2)}</dd>
      </dl>
    </div>
  )
}
