/**
 * The flashcard drill screen (roadmap 2.12/2.25, REQ-3.4.5). A thin view over
 * `useFlashcardDrill` — the deck, grading and SRS scheduling all live there
 * and in the core modules behind it; this file only renders the current card
 * and forwards an answer from whichever input the learner used.
 *
 * The drill-kind selector (labelled "Drill") switches between the two kinds
 * the hook can drive: a `'staff-to-key'` card renders the on-screen keyboard,
 * an `'interval-on-staff'` card renders `IntervalAnswerPad`. Both share the
 * same feedback/stats testids below.
 */
import { MidiDeviceStatus } from '@app/practice/MidiDeviceStatus.tsx'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import type { GradeResult } from '@core/drills/flashcards.ts'
import type { Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { useState } from 'react'
import { IntervalAnswerPad } from './IntervalAnswerPad.tsx'
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
}

const MIN_DRILL_LEVEL = 1
const MAX_DRILL_LEVEL = 6

function AnswerFeedback({ grade }: { readonly grade: GradeResult | undefined }) {
  if (grade === undefined) return null
  return (
    <p role="status" data-testid="flashcard-feedback">
      {grade.correct ? 'Correct' : 'Not quite'} — graded {grade.grade}
    </p>
  )
}

export function FlashcardScreen(props: FlashcardScreenProps) {
  const [level, setLevel] = useState(MIN_DRILL_LEVEL)
  const [kind, setKind] = useState<DrillKind>('staff-to-key')
  const drill = useFlashcardDrill({ level, kind, ...props })

  return (
    <div className="flashcard-screen">
      <h2>Flashcards</h2>
      <MidiDeviceStatus
        connected={drill.midi.input !== undefined}
        devices={drill.midi.devices}
        selectedDeviceId={drill.midi.selectedDeviceId}
        connectionError={drill.midi.connectionError}
      />
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
      ) : (
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
