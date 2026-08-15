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
 *
 * REWORKED (roadmap UI-12, 2026-08-12 UI audit): the standalone metronome
 * fieldset (roadmap 2.28a) is deleted outright, not just moved — a metronome
 * has its own screen (`@app/metronome/MetronomeScreen.tsx`), and this drill
 * grades single answers with no tempo involved, so the control never earned
 * its place here. The level stepper and drill picker move into the header's
 * action slot as labelled `.field`s, the level stepper migrates onto the
 * `.stepper` primitive (label outside the group, not between the +/- buttons
 * — see `MIN_DRILL_LEVEL`'s call site below), and the whole stage (staff card
 * → prompt → answer input) reads as one centered column instead of the old
 * centered-card/left-hanging-keyboard mismatch.
 */
import { Icon } from '@app/ui/Icon.tsx'
import { QwertyHint } from '@app/keyboardInput/QwertyHint.tsx'
import { defaultBaseNote } from '@app/keyboardInput/qwertyNoteMap.ts'
import { useQwertyNoteInput } from '@app/keyboardInput/useQwertyNoteInput.ts'
import type { ConnectMidi } from '@app/practice/useMidiConnection.ts'
import { SrsSummary } from '@app/srs/SrsSummary.tsx'
import type { GradeResult } from '@core/drills/flashcards.ts'
import type { Clock, DateSource, MidiInput, Rng } from '@core/ports/index.ts'
import { useEffect, useId, useRef, useState } from 'react'
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

/** Learner-language subtitle naming the deck currently open (rule 7: no
 *  internal vocabulary like "staff-to-key" or "interval-on-staff" on screen). */
const DECK_SUBTITLE: Record<DrillKind, string> = {
  'staff-to-key': 'Find the note on your keyboard',
  'interval-on-staff': 'Name the interval on the staff',
  'note-name': 'Name the note on the staff',
  'key-signature': 'Name the key from its signature',
}

function clampLevel(level: number): number {
  return Math.min(MAX_DRILL_LEVEL, Math.max(MIN_DRILL_LEVEL, Math.floor(level)))
}

/**
 * The graded-answer pill (rule 5: feedback within 100ms; rule 8: color is
 * never the only signal). Always rendered — even before the first answer —
 * so the stage never gains or loses this element's reserved line height; only
 * its content and the `is-ok`/`is-error` primitive class toggle, faded via
 * `--dur-1` (`feature-flashcards.css`). See `FlashcardScreen.test.tsx`'s
 * "no layout shift" test for the structural proof.
 *
 * The pop (roadmap UI-22, motion pass) is the shared `.fb-pop` class
 * (primitives.css's `fb-pop` keyframes) — but this pill is a single DOM node
 * reused across every card in the deck (never remounted; see the "same DOM
 * node" test), so two answers in a row that grade the same way (`is-ok`
 * twice) leave the className unchanged and a plain class toggle would not
 * replay the animation. `GradeResult` is a fresh object every answer
 * (`useFlashcardDrill.commitAnswer`), so this effect's dependency is a
 * reliable "a new answer landed" signal even when the visible state repeats:
 * it removes `.fb-pop`, forces a reflow (`el.offsetWidth`, discarded via
 * `void`) so the browser forgets the class was ever there, then re-adds it —
 * the standard way to restart a CSS animation on an unchanging node.
 */
function AnswerFeedback({ grade }: { readonly grade: GradeResult | undefined }) {
  const stateClass = grade === undefined ? '' : grade.correct ? ' is-ok' : ' is-error'
  const pillRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (grade === undefined) return
    const el = pillRef.current
    if (el === null) return
    el.classList.remove('fb-pop')
    void el.offsetWidth
    el.classList.add('fb-pop')
  }, [grade])

  return (
    <p
      ref={pillRef}
      role="status"
      data-testid="flashcard-feedback"
      className={`flashcard-feedback${stateClass}`}
      data-visible={grade !== undefined}
    >
      {grade !== undefined && (
        <>
          <Icon name={grade.correct ? 'check' : 'x'} />
          {grade.correct ? 'Correct' : 'Not quite — it comes back for review'}
        </>
      )}
    </p>
  )
}

export function FlashcardScreen(props: FlashcardScreenProps) {
  const [level, setLevel] = useState(clampLevel(props.initialLevel ?? MIN_DRILL_LEVEL))
  const [kind, setKind] = useState<DrillKind>(props.initialKind ?? 'staff-to-key')
  const { initialKind: _initialKind, initialLevel: _initialLevel, ...drillProps } = props
  const drill = useFlashcardDrill({ level, kind, ...drillProps })
  // Only the 'staff-to-key' card answers with a note at all — the other
  // three kinds have their own answer pads (roadmap 5.5).
  useQwertyNoteInput({
    enabled: drill.card?.kind === 'staff-to-key',
    low: drill.range.low,
    high: drill.range.high,
    baseNote: defaultBaseNote(drill.range.low, drill.range.high),
    onPress: drill.answerNote,
  })
  const levelLabelId = useId()

  return (
    <div className="page page--focus">
      <header className="page-header">
        <div>
          <h1>Flashcards</h1>
          <p className="page-header-subtitle">{DECK_SUBTITLE[kind]}</p>
        </div>
        <div className="page-header-actions">
          <div className="field">
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
          <div className="field">
            {/* The label lives OUTSIDE `.stepper` — the exact defect the
                primitive was built to fix (see primitives.css's file header)
                is a label rendered BETWEEN the +/- buttons, which is what
                this screen's own hand-rolled `role="group"` used to do. */}
            <label id={levelLabelId}>Level</label>
            <div className="stepper" role="group" aria-labelledby={levelLabelId}>
              <button
                type="button"
                aria-label="Decrease level"
                disabled={level <= MIN_DRILL_LEVEL}
                onClick={() => setLevel((l) => Math.max(MIN_DRILL_LEVEL, l - 1))}
              >
                −
              </button>
              <span className="stepper-value" data-testid="flashcard-level">
                {level}
              </span>
              <button
                type="button"
                aria-label="Increase level"
                disabled={level >= MAX_DRILL_LEVEL}
                onClick={() => setLevel((l) => Math.min(MAX_DRILL_LEVEL, l + 1))}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </header>

      {drill.card === undefined ? (
        <p role="status" className="empty-state">
          No cards at this level yet — try a lower level or a different drill.
        </p>
      ) : drill.card.kind === 'staff-to-key' ? (
        <section className="flashcard-stage" aria-label="Flashcard">
          <div className="card flashcard-stage-card">
            <StaffNote midi={drill.card.prompt.midi} clef={drill.card.prompt.clef} />
          </div>
          <p className="flashcard-prompt-text">
            Play the note shown, on the keyboard below or your MIDI keyboard.
          </p>
          <div className="flashcard-answer">
            <OnScreenKeyboard
              low={drill.range.low}
              high={drill.range.high}
              onPress={drill.answerNote}
            />
          </div>
          <details className="flashcard-qwerty-hint">
            <summary>
              <Icon name="chevron-down" />
              Show keys
            </summary>
            <QwertyHint />
          </details>
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      ) : drill.card.kind === 'interval-on-staff' ? (
        <section className="flashcard-stage" aria-label="Flashcard">
          <div className="card flashcard-stage-card">
            <StaffNote
              low={drill.card.prompt.low}
              high={drill.card.prompt.high}
              clef={drill.card.prompt.clef}
            />
          </div>
          <p className="flashcard-prompt-text">Name the interval shown.</p>
          <div className="flashcard-answer">
            <IntervalAnswerPad onAnswer={drill.answerInterval} />
          </div>
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      ) : drill.card.kind === 'note-name' ? (
        <section className="flashcard-stage" aria-label="Flashcard">
          <div className="card flashcard-stage-card">
            <StaffNote midi={drill.card.prompt.midi} clef={drill.card.prompt.clef} />
          </div>
          <p className="flashcard-prompt-text">Name the note shown.</p>
          <div className="flashcard-answer">
            <NoteNameAnswerPad onAnswer={drill.answerNoteName} />
          </div>
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      ) : (
        <section className="flashcard-stage" aria-label="Flashcard">
          <div className="card flashcard-stage-card">
            <p data-testid="key-signature-prompt" className="flashcard-key-signature-prompt">
              {drill.card.prompt.fifths === 0
                ? 'No sharps or flats'
                : `${Math.abs(drill.card.prompt.fifths)} ${
                    drill.card.prompt.fifths > 0 ? 'sharp' : 'flat'
                  }${Math.abs(drill.card.prompt.fifths) === 1 ? '' : 's'}`}
            </p>
          </div>
          <p className="flashcard-prompt-text">
            Name the major key and its relative minor for this key signature.
          </p>
          <div className="flashcard-answer">
            <KeySignatureAnswerPad onAnswer={drill.answerKeySignature} />
          </div>
          <AnswerFeedback grade={drill.lastGrade} />
        </section>
      )}

      <SrsSummary stats={drill.stats} idPrefix="flashcard-stats" ariaLabel="Retention" />
    </div>
  )
}
