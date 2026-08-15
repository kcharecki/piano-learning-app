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
import { useState } from 'react'
import { defaultParamsForLevel } from '@core/generator/melody.ts'
import { chordQualitiesForLevel, scaleTypesForLevel } from '@core/eartraining/chords.ts'
import type { DictationGrade } from '@core/eartraining/dictation.ts'
import type { EarGrade, EarItemKind } from '@core/eartraining/item.ts'
import type { AudioOutput, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { assertNever } from '@core/shared/invariant.ts'
import { intervalLongName, parseInterval } from '@core/theory/intervals.ts'
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { SrsSummary } from '@app/srs/SrsSummary.tsx'
import { DictationAnswerPad } from './DictationAnswerPad.tsx'
import { IntervalAnswerButtons } from './IntervalAnswerButtons.tsx'
import { QualityAnswerButtons, humanize } from './QualityAnswerButtons.tsx'
import { RevealPanel } from './RevealPanel.tsx'
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
 * `'a' 'perfect fifth'` / `'an' 'augmented fourth'` — the indefinite article
 * `describeExpected` prepends to an interval's long name. Phonetic, not
 * orthographic: English picks the article by the SOUND the following word
 * starts with, not its spelling, and `intervalLongName`'s own vocabulary
 * (`@core/theory/intervals.ts`'s `QUALITY_LONG`/`NUMBER_NAMES`) contains
 * exactly one word where those disagree — "unison" is spelled with a leading
 * vowel letter but spoken with a leading /j/ ("YOO-ni-sn"), a consonant
 * sound, so it takes "a" like every consonant-initial word does ("a
 * unison"). Every other word this drill can ever produce — the quality
 * words ('perfect', 'major', 'minor', 'augmented', 'diminished', 'doubly
 * diminished', 'doubly augmented') and 'octave' when a bare number ever
 * leads — already gets the right answer from a plain vowel-letter check, so
 * "unison" is the one deliberate override, not a growing exception table.
 */
const CONSONANT_SOUNDING_VOWEL_WORDS = new Set(['unison'])

// eslint-disable-next-line react-refresh/only-export-components -- pure formatter, not a component; exported for direct unit test (mirrors `humanize` in QualityAnswerButtons.tsx)
export function articleFor(phrase: string): 'a' | 'an' {
  // Strip a trailing comma (a melodic answer reads "unison, ascending") so
  // the lookup key is the bare word, not "unison,".
  const firstWord = phrase.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
  if (CONSONANT_SOUNDING_VOWEL_WORDS.has(firstWord)) return 'a'
  return /^[aeiou]/.test(firstWord) ? 'an' : 'a'
}

/**
 * The wrong-answer feedback speaks the answer pads' own vocabulary — the
 * long interval name plus a direction word, or the humanized chord/scale
 * name — never the raw `EarGrade.expected` (an internal id like `-P5` or
 * `halfDiminished7`) a learner cannot map back to any button they saw.
 *
 * An interval name always gets its indefinite article prepended (roadmap
 * 5.33: "it was perfect fifth" read as a copy bug, missing the article every
 * other noun-phrase answer in English needs) — see `articleFor`'s own doc
 * for why that article is chosen phonetically rather than by first letter.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure formatter, not a component; exported for direct unit test (mirrors `humanize` in QualityAnswerButtons.tsx)
export function describeExpected(kind: EarItemKind, expected: string): string {
  if (kind === 'interval-melodic' || kind === 'interval-harmonic') {
    const descending = expected.startsWith('-')
    const parsed = parseInterval(descending ? expected.slice(1) : expected)
    if (!parsed.ok) return expected
    const name = intervalLongName(parsed.value)
    const phrase = kind === 'interval-melodic' ? `${name}, ${descending ? 'descending' : 'ascending'}` : name
    return `${articleFor(phrase)} ${phrase}`
  }
  return humanize(expected)
}

export function EarTrainingScreen(props: EarTrainingScreenProps) {
  // Roadmap 5.28: tonal context defaults ON (5.55: a real tonic TRIAD before
  // every item, not the original bare tonic+fifth) — this is the learner's
  // own opt-out, kept as screen-local state so toggling it never
  // regenerates or re-grades the current item, only changes what the NEXT
  // `start()`/`replay()` schedules.
  const [tonalContext, setTonalContext] = useState(true)
  const drill = useEarTraining({ ...props, tonalContext })
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

      {/* roadmap 5.32: every answer pad here is multiple-choice or MIDI
          playback — recognition, not the vocal reproduction ABRSM Grade 1
          aural, Kodály, Dalcroze and Berklee all actually test, and this
          drill has no microphone to grade singing even if it wanted to. RCM
          is the partial exception (it accepts keyboard playback as an
          equivalent response), so this both names the gap and says which
          part of it this screen already covers. */}
      <p className="eartraining-vocal-note">
        This screen has no microphone — it can't hear you sing, only what you
        click or play on a keyboard. RCM accepts keyboard playback like the
        answers here as an equivalent response, but ABRSM, Kodály, Dalcroze
        and Berklee all grade aural skills by having you sing back what you
        heard. Get the fuller benefit by singing the interval, chord or
        phrase back out loud — away from this screen — before you check the
        answer below.
      </p>

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
        <label>
          <input
            type="checkbox"
            checked={tonalContext}
            onChange={(e) => setTonalContext(e.target.checked)}
          />
          Play tonal context before each item
        </label>
      </div>

      {/* roadmap 5.55: names the key the way RCM's examiner does out loud
          ("The examiner will identify the key, play the tonic triad
          once…") — undefined (so nothing renders) exactly when the tonic
          triad itself would not sound: no item yet, no real key to
          establish (rhythmic dictation — rhythm has no scale; chord-quality
          and scale-mode, review finding F2b — their own answer IS a
          major/minor-style pair), or the learner has switched tonal context
          off. `role="status"` (review finding F5e) so a screen reader
          announces the key the same way it would hear an examiner speak it. */}
      {drill.contextKeyName !== undefined && (
        <p role="status" data-testid="eartraining-context-key">Key: {drill.contextKeyName}</p>
      )}

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
            {' A one-bar count-in plays first, so you can hear the pulse.'}
          </p>
          {drill.promptTempoBpm !== undefined && (
            <p data-testid="dictation-tempo">Tempo: {Math.round(drill.promptTempoBpm)} bpm</p>
          )}
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
          <dl className="dictation-accuracy accuracy-pair" aria-label="Dictation accuracy">
            <dt>Pitch accuracy</dt>
            <dd data-testid="dictation-pitch-accuracy">
              {Math.round(dictationGrade.pitchAccuracy * 100)}%
            </dd>
            <dt>Rhythm accuracy</dt>
            <dd data-testid="dictation-rhythm-accuracy">
              {Math.round(dictationGrade.rhythmAccuracy * 100)}%
            </dd>
          </dl>
          <div className="dictation-result">
            <ul aria-label="Dictation result" data-testid="dictation-result" className="note-row">
              {dictationGrade.notes.map((n, i) => (
                <li key={i}>
                  <span className="note-chip" data-state={n.status}>
                    {dictationNoteLabel(n)}
                    {DICTATION_NOTE_STATUS_LABEL[n.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* roadmap 5.29: shown for every graded item, correct or not — the
          defect this feature fixes is that a CORRECT guess taught nothing
          either, since nothing ever showed what was actually heard. Reuses
          the existing "Replay" control above (already wired, already
          tested) for "replay with the answer named": once this is on
          screen, Replay plays the same item again while the naming/staff/
          keyboard stay visible. */}
      {drill.item !== undefined && drill.grade !== undefined && (
        <RevealPanel
          key={drill.item.id}
          kind={kind}
          item={drill.item}
          {...(kind === 'interval-melodic' || kind === 'interval-harmonic'
            ? { onPlayReference: drill.playIntervalReference }
            : {})}
        />
      )}

      <SrsSummary stats={drill.stats} idPrefix="eartraining-stats" ariaLabel="Retention" />
    </div>
  )
}
