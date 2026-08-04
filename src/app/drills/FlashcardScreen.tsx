/**
 * The flashcard drill screen (roadmap 2.12/2.25/3.11, REQ-3.4.5/REQ-3.5.2). A
 * thin view over `useFlashcardDrill` — the deck, grading and SRS scheduling
 * all live there and in the core modules behind it; this file only renders
 * the current card and forwards an answer from whichever input the learner
 * used.
 *
 * The drill-kind selector (labelled "Drill") switches between the four kinds
 * the hook can drive: a `'staff-to-key'` card renders the on-screen keyboard,
 * an `'interval-on-staff'` card renders `IntervalAnswerPad`, a `'note-name'`
 * card renders `NoteNameAnswerPad`, and a `'key-signature'` card renders a
 * plain-text fifths readout plus `KeySignatureAnswerPad`. All four share the
 * same feedback/stats testids below.
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useMetronome } from '@app/metronome/useMetronome.ts'
import type { GradeResult } from '@core/drills/flashcards.ts'
import type { AudioOutput, Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { MAX_BPM, MIN_BPM } from '@core/timing/metronome.ts'
import { useId, useState } from 'react'
import { IntervalAnswerPad } from './IntervalAnswerPad.tsx'
import { KeySignatureAnswerPad } from './KeySignatureAnswerPad.tsx'
import { NoteNameAnswerPad } from './NoteNameAnswerPad.tsx'
import { OnScreenKeyboard } from './OnScreenKeyboard.tsx'
import { StaffNote } from './StaffNote.tsx'
import { useFlashcardDrill, type DrillKind } from './useFlashcardDrill.ts'

export type FlashcardScreenProps = {
  /** Injection seams for tests; each defaults to the real browser adapter. */
  readonly clock?: Clock
  /** Epoch-ms source for SRS scheduling — see `useFlashcardDrill`'s module comment. */
  readonly date?: DateSource
  readonly midiInput?: MidiInput
  readonly connectMidi?: ConnectMidi
  readonly rng?: Rng
  /** Injection seams for the standalone metronome (roadmap 2.28a, REQ-3.9.1); each defaults to the real browser adapter. */
  readonly audioOutput?: AudioOutput
  readonly frameDriver?: FrameDriver
  /** Which deck to open first. Defaults to `'staff-to-key'`. The learner's own
   *  picker owns the kind after the first render — this only seeds it. Read
   *  once at mount — the shell must `key` this element by the kind to
   *  re-seed it on a second navigation (see Shell.tsx's TechniqueScreen). */
  readonly initialKind?: DrillKind
  /** Which level to open first. Defaults to `MIN_DRILL_LEVEL`, clamped to
   *  [`MIN_DRILL_LEVEL`, `MAX_DRILL_LEVEL`]. Same seeding rule as
   *  `initialKind`: the learner's own +/- control owns it after the first
   *  render, so a caller wanting to re-seed a second navigation must `key`
   *  this element. */
  readonly initialLevel?: number
}

export const MIN_DRILL_LEVEL = 1
// 7, not 6: `buildKeySignatureDeck` caps at `min(MAX_ACCIDENTALS, level)` and
// `MAX_ACCIDENTALS` (core/drills/flashcards.ts) is 7 — the full writable
// circle of fifths, matching KeySignatureAnswerPad's 15 buttons. Capping this
// at 6 left the ±7 buttons (Cb/Ab minor, C#/A# minor) permanently unreachable.
export const MAX_DRILL_LEVEL = 7

function clampLevel(level: number): number {
  return Math.min(MAX_DRILL_LEVEL, Math.max(MIN_DRILL_LEVEL, Math.floor(level)))
}

function AnswerFeedback({ grade }: { readonly grade: GradeResult | undefined }) {
  if (grade === undefined) return null
  return (
    <p role="status" data-testid="flashcard-feedback">
      {grade.correct ? 'Correct' : 'Not quite'} — graded {grade.grade}
    </p>
  )
}

export function FlashcardScreen(props: FlashcardScreenProps) {
  const [level, setLevel] = useState(clampLevel(props.initialLevel ?? MIN_DRILL_LEVEL))
  const [kind, setKind] = useState<DrillKind>(props.initialKind ?? 'staff-to-key')
  // Metronome-only seams pulled out first: `useFlashcardDrill` declares
  // neither `audioOutput` nor `frameDriver`, so leaving them in the spread
  // would rely on TypeScript's excess-property-check exemption for spreads.
  const {
    audioOutput,
    frameDriver,
    initialKind: _initialKind,
    initialLevel: _initialLevel,
    ...drillProps
  } = props
  const drill = useFlashcardDrill({ level, kind, ...drillProps })
  const metronome = useMetronome({
    ...(props.clock === undefined ? {} : { clock: props.clock }),
    ...(audioOutput === undefined ? {} : { audioOutput }),
    ...(frameDriver === undefined ? {} : { frameDriver }),
  })
  const tempoId = useId()

  // Held as raw text and only committed on blur/Enter: a controlled input
  // bound directly to the clamped `metronome.bpm` rewrites mid-keystroke
  // every time the clamp kicks in (typing "8" toward "80" clamps to MIN_BPM
  // after the first digit, then the next keystroke produces "200"), making
  // most tempi impossible to type. Same fix as MetronomeScreen.tsx.
  const [bpmText, setBpmText] = useState(() => String(metronome.bpm))
  const [bpmEditing, setBpmEditing] = useState(false)
  const displayedBpm = bpmEditing ? bpmText : String(metronome.bpm)

  function commitBpm(): void {
    setBpmEditing(false)
    const parsed = Number(bpmText)
    if (Number.isFinite(parsed)) metronome.setBpm(parsed)
  }

  return (
    <div className="flashcard-screen">
      <h2>Flashcards</h2>
      <MidiDeviceStatus
        connected={drill.midi.input !== undefined}
        devices={drill.midi.devices}
        selectedDeviceId={drill.midi.selectedDeviceId}
        connectionError={drill.midi.connectionError}
      />

      <fieldset>
        <legend>Metronome</legend>
        <button type="button" onClick={metronome.running ? metronome.stop : metronome.start}>
          {metronome.running ? 'Stop' : 'Start'}
        </button>
        <label htmlFor={tempoId}>Tempo (BPM)</label>
        <input
          id={tempoId}
          type="number"
          min={MIN_BPM}
          max={MAX_BPM}
          value={displayedBpm}
          onChange={(event) => {
            setBpmEditing(true)
            setBpmText(event.target.value)
          }}
          onBlur={commitBpm}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitBpm()
          }}
        />
        <p data-testid="flashcard-metronome-beat">
          {metronome.lastClick === undefined ? '—' : `beat ${metronome.lastClick.beat + 1}`}
        </p>
      </fieldset>
      <div className="flashcard-level" role="group" aria-label="Level">
        <button
          type="button"
          aria-label="Decrease level"
          disabled={level <= MIN_DRILL_LEVEL}
          onClick={() => setLevel((l) => Math.max(MIN_DRILL_LEVEL, l - 1))}
        >
          −
        </button>
        <span data-testid="flashcard-level">Level {level}</span>
        <button
          type="button"
          aria-label="Increase level"
          disabled={level >= MAX_DRILL_LEVEL}
          onClick={() => setLevel((l) => Math.min(MAX_DRILL_LEVEL, l + 1))}
        >
          +
        </button>
      </div>

      <div className="flashcard-kind">
        <label htmlFor="flashcard-kind-select">Drill</label>
        <select
          id="flashcard-kind-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as DrillKind)}
        >
          <option value="staff-to-key">Note → key</option>
          <option value="interval-on-staff">Interval</option>
          <option value="note-name">Name the note</option>
          <option value="key-signature">Key signature</option>
        </select>
      </div>

      {drill.card === undefined ? (
        <p role="status">No cards at this level yet.</p>
      ) : drill.card.kind === 'staff-to-key' ? (
        <section aria-label="Flashcard">
          <StaffNote midi={drill.card.prompt.midi} clef={drill.card.prompt.clef} />
          <p>Play the note shown, on the keyboard below or your MIDI keyboard.</p>
          <OnScreenKeyboard
            low={drill.range.low}
            high={drill.range.high}
            onPress={drill.answerNote}
          />
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      ) : drill.card.kind === 'interval-on-staff' ? (
        <section aria-label="Flashcard">
          <StaffNote
            low={drill.card.prompt.low}
            high={drill.card.prompt.high}
            clef={drill.card.prompt.clef}
          />
          <p>Name the interval shown.</p>
          <IntervalAnswerPad onAnswer={drill.answerInterval} />
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      ) : drill.card.kind === 'note-name' ? (
        <section aria-label="Flashcard">
          <StaffNote midi={drill.card.prompt.midi} clef={drill.card.prompt.clef} />
          <p>Name the note shown.</p>
          <NoteNameAnswerPad onAnswer={drill.answerNoteName} />
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      ) : (
        <section aria-label="Flashcard">
          <p data-testid="key-signature-prompt">
            {drill.card.prompt.fifths === 0
              ? 'No sharps or flats'
              : `${Math.abs(drill.card.prompt.fifths)} ${
                  drill.card.prompt.fifths > 0 ? 'sharp' : 'flat'
                }${Math.abs(drill.card.prompt.fifths) === 1 ? '' : 's'}`}
          </p>
          <p>Name the major key and its relative minor for this key signature.</p>
          <KeySignatureAnswerPad onAnswer={drill.answerKeySignature} />
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      )}

      <dl className="flashcard-stats" aria-label="Retention">
        <dt>Cards</dt>
        <dd data-testid="flashcard-stats-total">{drill.stats.total}</dd>
        <dt>Due</dt>
        <dd data-testid="flashcard-stats-due">{drill.stats.due}</dd>
        <dt>Young</dt>
        <dd data-testid="flashcard-stats-young">{drill.stats.young}</dd>
        <dt>Mature</dt>
        <dd data-testid="flashcard-stats-mature">{drill.stats.mature}</dd>
        <dt>Average ease</dt>
        <dd data-testid="flashcard-stats-ease">{drill.stats.averageEase.toFixed(2)}</dd>
      </dl>
    </div>
  )
}
