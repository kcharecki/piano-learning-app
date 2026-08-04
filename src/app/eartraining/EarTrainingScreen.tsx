/**
 * The ear-training screen (roadmap 3.10/3.11, REQ-3.6.1/3.6.2) — the only
 * consumer `core/eartraining`'s drills will ever have. A thin view over
 * `useEarTraining`: the hook generates, plays, grades and schedules every
 * item; this file only renders the current one and forwards an answer from
 * whichever pad matches the selected drill.
 *
 * Melodic and rhythmic dictation answer through `DictationAnswerPad`: the
 * learner plays the phrase back (on the pad's on-screen keyboard, or a real
 * MIDI keyboard wired one layer down in `useEarTraining.ts`'s
 * `pressDictationNote`), and `submitDictation` grades it with `gradeDictation`
 * and records the attempt exactly like every other kind. Rhythmic dictation
 * grades rhythm only — `gradeDictation` ignores pitch whenever
 * `item.kind === 'rhythmic-dictation'` — so its instructions say "any key"
 * rather than naming particular notes.
 */
import { defaultParamsForLevel } from '@core/generator/melody.ts'
import { chordQualitiesForLevel, scaleTypesForLevel } from '@core/eartraining/chords.ts'
import type { DictationGrade } from '@core/eartraining/dictation.ts'
import type { EarGrade, EarItemKind } from '@core/eartraining/item.ts'
import type { AudioOutput, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { assertNever } from '@core/shared/invariant.ts'
import { intervalLongName, parseInterval } from '@core/theory/intervals.ts'
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { DictationAnswerPad } from './DictationAnswerPad.tsx'
import { IntervalAnswerButtons } from './IntervalAnswerButtons.tsx'
import { QualityAnswerButtons, humanize } from './QualityAnswerButtons.tsx'
import { useEarTraining } from './useEarTraining.ts'

export type EarTrainingScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly date?: DateSource
  readonly audioOutput?: AudioOutput
  readonly rng?: Rng
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
}

const DRILL_OPTIONS: readonly { readonly kind: EarItemKind; readonly label: string }[] = [
  { kind: 'interval-melodic', label: 'Interval (melodic)' },
  { kind: 'interval-harmonic', label: 'Interval (harmonic)' },
  { kind: 'chord-quality', label: 'Chord quality' },
  { kind: 'scale-mode', label: 'Scale / mode' },
  { kind: 'melodic-dictation', label: 'Melodic dictation' },
  { kind: 'rhythmic-dictation', label: 'Rhythmic dictation' },
]

/**
 * `useEarTraining`'s `grade` is typed `EarGrade | undefined` because every
 * other drill's grader only ever returns exactly that; `gradeDictation`
 * returns a `DictationGrade`, a strict superset (`EarGrade & {...}`), so this
 * is a safe narrowing of what is already there, not a cast — the extra
 * `notes` field is what `gradeDictation` alone ever attaches.
 */
function isDictationGrade(grade: EarGrade): grade is DictationGrade {
  return 'notes' in grade
}

const DICTATION_NOTE_STATUS_LABEL: Record<DictationGrade['notes'][number]['status'], string> = {
  correct: 'correct',
  'wrong-pitch': 'wrong pitch',
  'wrong-rhythm': 'wrong rhythm',
  missing: 'missing',
  extra: 'extra',
}

/**
 * `expectedIndex`/`givenIndex` had no production reader (review finding) —
 * this is that reader. `expectedIndex` is preferred when both exist: it is a
 * position in the prompt's own note order, which is what a learner comparing
 * the feedback against what they just heard actually wants numbered. Only a
 * pure `'extra'` note has no `expectedIndex`, so it falls back to its
 * position in the learner's own answer.
 */
function dictationNoteLabel(n: DictationGrade['notes'][number]): string {
  const index = n.expectedIndex ?? n.givenIndex
  return index === undefined ? '' : `Note ${index + 1}: `
}

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
  const isDictation = kind === 'melodic-dictation' || kind === 'rhythmic-dictation'
  // The same range `generateMelodicDictation`/`generateRhythmicDictation`
  // draw the item's own notes from by default (dictation.ts's `opts.range ??
  // defaults.rightRange`) — always wide enough to press back what was heard,
  // and generous for rhythmic dictation, where any key counts.
  const dictationRange = defaultParamsForLevel(padLevel).rightRange
  const dictationGrade =
    isDictation && drill.grade !== undefined && isDictationGrade(drill.grade) ? drill.grade : undefined

  return (
    <div className="eartraining-screen">
      <h2>Ear Training</h2>

      <MidiDeviceStatus
        connected={drill.midi.input !== undefined}
        devices={drill.midi.devices}
        selectedDeviceId={drill.midi.selectedDeviceId}
        connectionError={drill.midi.connectionError}
      />

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
      ) : kind === 'melodic-dictation' || kind === 'rhythmic-dictation' ? (
        <section aria-label="Answer">
          <p>
            {kind === 'rhythmic-dictation'
              ? 'Tap back the rhythm — any key counts, only the timing is graded.'
              : 'Play back the phrase on the keyboard below, in order.'}
          </p>
          <DictationAnswerPad
            key={drill.item.id}
            notes={drill.dictationNotes}
            onPress={drill.pressDictationNote}
            onClear={drill.clearDictation}
            onSubmit={drill.submitDictation}
            low={dictationRange.low}
            high={dictationRange.high}
          />
        </section>
      ) : (
        assertNever(kind)
      )}

      {drill.grade !== undefined && (
        <p role="status" data-testid="eartraining-feedback">
          {drill.grade.correct
            ? 'Correct'
            : isDictation
              ? 'Not quite — see the note-by-note result below'
              : `Not quite — it was ${describeExpected(kind, drill.grade.expected)}`}
        </p>
      )}

      {dictationGrade !== undefined && (
        <>
          {/* pitchAccuracy/rhythmAccuracy had no production reader (review
              finding) even though ROADMAP.md names "pitch and rhythm scored
              separately" as this feature's own proof — this renders both. */}
          <dl className="dictation-accuracy" aria-label="Dictation accuracy">
            <dt>Pitch accuracy</dt>
            <dd data-testid="dictation-pitch-accuracy">
              {Math.round(dictationGrade.pitchAccuracy * 100)}%
            </dd>
            <dt>Rhythm accuracy</dt>
            <dd data-testid="dictation-rhythm-accuracy">
              {Math.round(dictationGrade.rhythmAccuracy * 100)}%
            </dd>
          </dl>
          <ul aria-label="Dictation result" data-testid="dictation-result">
            {dictationGrade.notes.map((n, i) => (
              <li key={i}>
                {dictationNoteLabel(n)}
                {DICTATION_NOTE_STATUS_LABEL[n.status]}
              </li>
            ))}
          </ul>
        </>
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
