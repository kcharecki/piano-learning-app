/**
 * The ear-training screen (roadmap 3.10/3.11, REQ-3.6.1/3.6.2 — redesigned
 * roadmap UI-13, 2026-08-12 UI audit) — the only consumer `core/eartraining`'s
 * drills will ever have. A thin view over `useEarTraining`: the hook
 * generates, plays, grades and schedules every item; this file only renders
 * the current one and forwards an answer from whichever pad matches the
 * selected drill.
 *
 * UI-13's brief: "answers as the interface" — the six-line singing-pedagogy
 * wall that used to open this screen before any control collapses to one
 * `.card--sunken` callout (the original text survives verbatim behind a
 * "Why?" disclosure, never paraphrased away); Play becomes the screen's one
 * `.btn-primary`; and each interval/chord/scale option renders as a large
 * `.card` answer button — the actual point of an ear-training screen — instead
 * of a small gray chip. `IntervalAnswerButtons`/`QualityAnswerButtons` take an
 * optional `answered` prop (the picked option's key/value plus whether it
 * graded correct) so the picked card alone gets the feedback tokens plus a
 * glyph once `useEarTraining`'s own `grade` lands — color is never the only
 * signal (DESIGN.md rule 8). No ear-training logic changed: every generate/
 * grade/schedule call below is exactly what it was before this task, this
 * file only reshapes how the result is presented.
 *
 * Melodic and rhythmic dictation answer through `DictationAnswerPad`: the
 * learner plays the phrase back (on the pad's on-screen keyboard, or a real
 * MIDI keyboard wired one layer down in `useEarTraining.ts`'s
 * `pressDictationNote`), and `submitDictation` grades it with `gradeDictation`
 * and records the attempt exactly like every other kind. Rhythmic dictation
 * grades rhythm only — `gradeDictation` ignores pitch whenever
 * `item.kind === 'rhythmic-dictation'` — so its own stage caption says "any
 * key counts" rather than naming particular notes.
 */
import { useState } from 'react'
import { defaultParamsForLevel } from '@core/generator/melody.ts'
import { chordQualitiesForLevel, scaleTypesForLevel } from '@core/eartraining/chords.ts'
import type { DictationGrade } from '@core/eartraining/dictation.ts'
import type { EarGrade, EarItemKind } from '@core/eartraining/item.ts'
import type { AudioOutput, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { assertNever } from '@core/shared/invariant.ts'
import type { ChordQuality } from '@core/theory/chords.ts'
import { intervalLongName, parseInterval } from '@core/theory/intervals.ts'
import type { ScaleType } from '@core/theory/scales.ts'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { SrsSummary } from '@app/srs/SrsSummary.tsx'
import { Icon } from '@app/ui/Icon.tsx'
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

type DrillMeta = {
  /** The `<option>` label in the drill `<select>`. */
  readonly label: string
  /** The `.page-header-subtitle` clause, before " — level N" is appended. */
  readonly subtitle: string
  /** The persistent stage caption naming what is about to sound — shown
   *  whether or not an item has been played yet (rule 6: empty states teach). */
  readonly caption: string
}

const DRILL_KINDS: readonly EarItemKind[] = [
  'interval-melodic',
  'interval-harmonic',
  'chord-quality',
  'scale-mode',
  'melodic-dictation',
  'rhythmic-dictation',
]

const DRILL_META: Readonly<Record<EarItemKind, DrillMeta>> = {
  'interval-melodic': {
    label: 'Interval (melodic)',
    subtitle: 'Intervals, played melodically',
    caption: 'This is a melodic interval — two notes, one after another.',
  },
  'interval-harmonic': {
    label: 'Interval (harmonic)',
    subtitle: 'Intervals, played together',
    caption: 'This is a harmonic interval — two notes at once.',
  },
  'chord-quality': {
    label: 'Chord quality',
    subtitle: 'Chord quality',
    caption: 'This is a chord — listen for its quality.',
  },
  'scale-mode': {
    label: 'Scale / mode',
    subtitle: 'Scale or mode',
    caption: 'This is a scale or mode.',
  },
  'melodic-dictation': {
    label: 'Melodic dictation',
    subtitle: 'Melodic dictation',
    caption:
      'This is a short melodic phrase — play it back on the keyboard below, in order. ' +
      'A one-bar count-in plays first, so you can hear the pulse.',
  },
  'rhythmic-dictation': {
    label: 'Rhythmic dictation',
    subtitle: 'Rhythmic dictation',
    caption:
      'This is a rhythmic phrase — tap back the rhythm; any key counts, only the timing is graded. ' +
      'A one-bar count-in plays first, so you can hear the pulse.',
  },
}

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
  // Roadmap 5.28: tonal context defaults ON (a tonic drone before every
  // item) — this is the learner's own opt-out, kept as screen-local state so
  // toggling it never regenerates or re-grades the current item, only
  // changes what the NEXT `start()`/`replay()` schedules.
  const [tonalContext, setTonalContext] = useState(true)
  const drill = useEarTraining({ ...props, tonalContext })
  const kind = drill.kind
  const level = drill.levels[kind]
  const meta = DRILL_META[kind]
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

  const playLabel = drill.phase === 'graded' ? 'Next' : 'Play item'
  const playDisabled = drill.phase === 'playing' || drill.phase === 'answering'

  return (
    <div className="page page--focus eartraining-screen">
      <div className="page-header">
        <div>
          <h1>Ear training</h1>
          <p className="page-header-subtitle">{`${meta.subtitle} — level ${level}`}</p>
        </div>
        <div className="page-header-actions">
          <div className="field">
            <label htmlFor="eartraining-drill-select">Drill</label>
            <select
              id="eartraining-drill-select"
              value={kind}
              onChange={(e) => drill.setKind(e.target.value as EarItemKind)}
            >
              {DRILL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DRILL_META[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="eartraining-level-label">Level</span>
            <span data-testid="eartraining-level">{level}</span>
          </div>
        </div>
      </div>

      {/* roadmap UI-13: the singing-pedagogy prose (roadmap 5.32) collapses
          to one line; the original wording survives VERBATIM behind "Why?"
          instead of being paraphrased away. */}
      <div className="card--sunken eartraining-sing-callout">
        <p className="eartraining-sing-callout-lead">
          Sing what you hear back before answering — it trains twice as much.
        </p>
        <details>
          <summary>Why?</summary>
          <p className="eartraining-vocal-note">
            This screen has no microphone — it can&apos;t hear you sing, only what you
            click or play on a keyboard. RCM accepts keyboard playback like the
            answers here as an equivalent response, but ABRSM, Kodály, Dalcroze
            and Berklee all grade aural skills by having you sing back what you
            heard. Get the fuller benefit by singing the interval, chord or
            phrase back out loud — away from this screen — before you check the
            answer below.
          </p>
        </details>
      </div>

      <div className="card eartraining-stage">
        <p className="eartraining-stage-caption">{meta.caption}</p>

        <div className="eartraining-stage-transport">
          <button
            type="button"
            className="btn-primary eartraining-play-btn"
            onClick={drill.start}
            disabled={playDisabled}
          >
            <Icon name={drill.phase === 'graded' ? 'chevron-right' : 'play'} />
            {playLabel}
          </button>
          <button type="button" onClick={drill.replay} disabled={drill.item === undefined}>
            <Icon name="play" />
            Replay
          </button>
        </div>

        <label className="eartraining-context-toggle">
          <input
            type="checkbox"
            checked={tonalContext}
            onChange={(e) => setTonalContext(e.target.checked)}
          />
          Play tonal context before each item
        </label>

        {isDictation && drill.promptTempoBpm !== undefined && (
          <p data-testid="dictation-tempo" className="eartraining-stage-meta">
            Tempo: {Math.round(drill.promptTempoBpm)} bpm
          </p>
        )}

        {drill.item !== undefined &&
          (kind === 'interval-melodic' || kind === 'interval-harmonic' ? (
            <IntervalAnswerButtons
              key={drill.item.id}
              level={padLevel}
              showDirection={kind === 'interval-melodic' && padLevel > 1}
              onAnswer={(interval, direction) => drill.answer({ kind, interval, direction })}
              {...(drill.grade === undefined
                ? {}
                : {
                    answered: {
                      pickedKey: drill.grade.given,
                      // Roadmap UI-24: the pad needs to be able to mark what
                      // the answer WAS, not only what the learner said. Same
                      // encoding on both fields (`item.answerKey`).
                      expectedKey: drill.grade.expected,
                      correct: drill.grade.correct,
                    },
                  })}
            />
          ) : kind === 'chord-quality' ? (
            <QualityAnswerButtons
              key={drill.item.id}
              groupLabel="Chord quality answer"
              options={chordQualitiesForLevel(padLevel)}
              onAnswer={(quality) => drill.answer({ kind, quality })}
              {...(drill.grade === undefined
                ? {}
                : {
                    // `given` is exactly the `ChordQuality` the learner picked —
                    // `gradeChordQualityAnswer` returns `given: answer` untouched
                    // (core/eartraining/chords.ts), never a re-encoded string, so
                    // this narrows a value already known to be one, not a cast
                    // across an actual type boundary.
                    answered: {
                      picked: drill.grade.given as ChordQuality,
                      expected: drill.grade.expected as ChordQuality,
                      correct: drill.grade.correct,
                    },
                  })}
            />
          ) : kind === 'scale-mode' ? (
            <QualityAnswerButtons
              key={drill.item.id}
              groupLabel="Scale/mode answer"
              options={scaleTypesForLevel(padLevel)}
              onAnswer={(type) => drill.answer({ kind, type })}
              {...(drill.grade === undefined
                ? {}
                : {
                    // Same reasoning as chord-quality above: `gradeScaleModeAnswer`
                    // also returns `given: answer` untouched.
                    answered: {
                      picked: drill.grade.given as ScaleType,
                      expected: drill.grade.expected as ScaleType,
                      correct: drill.grade.correct,
                    },
                  })}
            />
          ) : kind === 'melodic-dictation' || kind === 'rhythmic-dictation' ? (
            <DictationAnswerPad
              key={drill.item.id}
              notes={drill.dictationNotes}
              onPress={drill.pressDictationNote}
              onClear={drill.clearDictation}
              onSubmit={drill.submitDictation}
              low={dictationRange.low}
              high={dictationRange.high}
            />
          ) : (
            assertNever(kind)
          ))}
      </div>

      {drill.grade !== undefined && (
        <p
          role="status"
          data-testid="eartraining-feedback"
          className="eartraining-feedback"
          data-state={drill.grade.correct ? 'correct' : 'wrong'}
        >
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
          keyboard stay visible. Renders below the (unchanged) answer grid —
          never inside it — so answering never resizes or reflows the grid
          itself (DESIGN.md rule 5/no-jump — see EarTrainingScreen.test.tsx). */}
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
