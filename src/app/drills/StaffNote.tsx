/**
 * Notes drawn on a five-line staff (roadmap 2.12/2.25, REQ-3.4.5). Not a
 * general notation renderer — `ScoreViewer`/OSMD is that, and needs MusicXML
 * this codebase has no way to build for a single ad-hoc prompt — just enough
 * real, computed staff geometry (`staffPosition.ts`) to make a flashcard's
 * prompt genuinely readable from its POSITION, not from text that would name
 * the answer outright.
 *
 * Two prompt shapes render here:
 *  - a single note (`{ midi, clef }`) for a `'staff-to-key'` card — the
 *    rendered pitch is `fromMidi(midi)`'s canonical spelling; flashcard
 *    grading is by MIDI number, so which enharmonic spelling is drawn does
 *    not change what counts as correct.
 *  - two spelled pitches (`{ low, high, clef }`) for an `'interval-on-staff'`
 *    card — both on the SAME staff, since that is what makes the interval
 *    readable by position. The deck does not currently distinguish melodic
 *    from harmonic intervals, so both noteheads always sit side by side, low
 *    then high (a harmonic/stacked rendering is a named future task, not
 *    dead code kept "for later" — see roadmap).
 *
 * Never renders a letter name anywhere in the SVG — only the clef glyph and
 * accidental symbols, neither of which is an ASCII letter — because a card
 * that named the note or the interval in the markup would not be testing
 * anything.
 */
import type { Clef, Flashcard } from '@core/drills/flashcards.ts'
import { fromMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, type Midi } from '@core/shared/units.ts'
import { ledgerSteps, staffStep } from './staffPosition.ts'

export type StaffNoteProps = (
  | { readonly midi: Midi; readonly clef: Clef }
  | {
      readonly low: SpelledPitch
      readonly high: SpelledPitch
      readonly clef: Clef
    }
) & {
  /** The fixed step range this render's viewBox must cover — see
   *  `fixedViewBox` below. Omit only when the caller has no deck to size
   *  against; every real deck-driven caller should pass `stepRangeForDeck`'s
   *  result instead (falling back to `DEFAULT_STEP_RANGE` silently would
   *  size a level-1 card for a note it will never draw). */
  readonly stepRange?: StaffStepRange
}

const LINE_GAP = 12
const STEP_GAP = LINE_GAP / 2
const BOTTOM_LINE_Y = 100
/** Shared by both variants so their viewBoxes have the same aspect ratio —
 *  `feature-flashcards.css` renders `.staff-note` at `width: 100%; height:
 *  auto`, so the browser derives the rendered height from viewBox
 *  width/height alone. A single-note and an interval card would still
 *  render at different heights if their viewBox widths differed, even with
 *  an identical viewBox height (see `fixedViewBox` below). */
const STAFF_WIDTH = 160
const SINGLE_NOTE_X = STAFF_WIDTH / 2
const MELODIC_LOW_X = 58
const MELODIC_HIGH_X = 94
const LEDGER_HALF_WIDTH = 12
const VIEWBOX_MARGIN = 20
const CLEF_GLYPH: Record<Clef, string> = { treble: '\u{1D11E}', bass: '\u{1D122}' }
const ACCIDENTAL_GLYPH: Record<number, string> = {
  [-2]: '\u{1D12B}',
  [-1]: '♭',
  [1]: '♯',
  [2]: '\u{1D12A}',
}

function y(step: number): number {
  return BOTTOM_LINE_Y - step * STEP_GAP
}

function isIntervalProps(
  props: StaffNoteProps,
): props is Extract<StaffNoteProps, { low: SpelledPitch }> {
  return 'low' in props
}

function StaffLines({ width, clef }: { readonly width: number; readonly clef: Clef }) {
  return (
    <>
      <text
        className="music-glyph"
        data-testid="clef-glyph"
        x="10"
        y={y(4) + 14}
        fontSize="34"
        aria-hidden="true"
      >
        {CLEF_GLYPH[clef]}
      </text>
      {[0, 2, 4, 6, 8].map((line) => (
        <line key={line} x1="0" x2={width} y1={y(line)} y2={y(line)} stroke="currentColor" />
      ))}
    </>
  )
}

function Notehead({
  x,
  step,
  spelled,
  testId,
}: {
  readonly x: number
  readonly step: number
  readonly spelled: SpelledPitch
  readonly testId: string
}) {
  const accidental = ACCIDENTAL_GLYPH[spelled.alter]
  return (
    <g data-testid={testId} data-step={step}>
      {accidental !== undefined && (
        <text className="music-glyph" x={x - 22} y={y(step) + 6} fontSize="20" aria-hidden="true">
          {accidental}
        </text>
      )}
      <ellipse cx={x} cy={y(step)} rx="7" ry="5.5" fill="currentColor" />
    </g>
  )
}

function ledgerEntries(
  step: number,
  x: number,
): ReadonlyArray<{ readonly step: number; readonly x: number }> {
  return ledgerSteps(step).map((s) => ({ step: s, x }))
}

/** A step range every card in some group must fit inside — see
 *  `fixedViewBox`/`stepRangeForDeck` below. */
export type StaffStepRange = { readonly min: number; readonly max: number }

/**
 * Fallback used only when a caller renders `StaffNote` without a
 * `stepRange` prop. Every note `buildDeck` (`core/drills/flashcards.ts`)
 * can EVER draw across the whole app falls inside it — the piano's own
 * extremes, read through this module's own `staffStep`, not a hard-coded
 * margin: `buildDeck` never prompts a note outside the 88-key piano, and
 * always pairs the piano's lowest key with the bass clef and its highest
 * key with the treble clef (middle C is the deck's own clef boundary —
 * `clefForMidi`). (Verified against every deck `buildDeck` can build,
 * levels 1-8, both single-note and interval kinds: the true min/max step
 * across the WHOLE app is exactly [-13, 26], reached only at level 5+.)
 *
 * This is deliberately NOT what `FlashcardScreen` uses card to card — a
 * box sized for the whole app's worst case is much taller than a low-level
 * deck ever needs (typical levels 1-3 stay inside roughly [-3, 10]), so
 * using it for every render would fix the page-height jitter (roadmap
 * UI-32) by permanently shrinking the staff to a fraction of its natural
 * size instead. `FlashcardScreen` computes a tighter range from the actual
 * deck on screen via `stepRangeForDeck`, and passes it down, so the box
 * only grows as wide as answering that particular deck ever requires. This
 * constant only exists so a caller that skips that step still never clips
 * a note, rather than silently reproducing the pre-fix bug.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure fallback constant, not a component; exported for unit test and for callers with no deck to size against
export const DEFAULT_STEP_RANGE: StaffStepRange = {
  min: staffStep(fromMidi(midi(PIANO_LOWEST_MIDI)), 'bass'),
  max: staffStep(fromMidi(midi(PIANO_HIGHEST_MIDI)), 'treble'),
}

/** A viewBox fixed to `range` (with margin), identical for every render
 *  that is given the same `range` — see `DEFAULT_STEP_RANGE` and
 *  `stepRangeForDeck` above/below. Every note a caller passing a correctly
 *  computed `range` can ever ask this component to draw falls inside it,
 *  so nothing gets clipped. */
function fixedViewBox(range: StaffStepRange): string {
  const top = y(range.max) - VIEWBOX_MARGIN
  const bottom = y(range.min) + VIEWBOX_MARGIN
  return `0 ${top} ${STAFF_WIDTH} ${bottom - top}`
}

/**
 * The step range every card in `cards` needs, so a caller (`FlashcardScreen`)
 * can size one shared `StaffNote` viewBox per deck instead of per app
 * (`DEFAULT_STEP_RANGE`) or per card (the pre-fix bug, roadmap UI-32):
 * within one deck every card renders the same box, so answering a card
 * never changes the staff's size — but a deck of easy, near-middle-C notes
 * still gets a box close to its own natural size, not the whole piano's.
 *
 * Includes both notes of an interval card, the ledger lines every included
 * step needs (`ledgerSteps`, belt-and-suspenders — a note's own step is
 * always at least as far out as any ledger line it needs, but this stays
 * correct even if that ever stopped being true), and steps 0/8 so the
 * staff itself is always in frame even for a deck whose notes never reach
 * it. A `'key-signature'` card has no staff prompt, so it contributes
 * nothing (its deck is never actually passed here — `FlashcardScreen`
 * renders a plain-text prompt for that kind instead of a `StaffNote`).
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure deck->range computation, not a component; exported for FlashcardScreen and for unit test
export function stepRangeForDeck(cards: readonly Flashcard[]): StaffStepRange {
  let min = 0
  let max = 8
  const include = (step: number): void => {
    for (const s of [step, ...ledgerSteps(step)]) {
      if (s < min) min = s
      if (s > max) max = s
    }
  }
  for (const card of cards) {
    switch (card.kind) {
      case 'note-name':
      case 'staff-to-key':
        include(staffStep(fromMidi(card.prompt.midi), card.prompt.clef))
        break
      case 'interval-on-staff':
        include(staffStep(card.prompt.low, card.prompt.clef))
        include(staffStep(card.prompt.high, card.prompt.clef))
        break
      case 'key-signature':
        break
    }
  }
  return { min, max }
}

function SingleStaffNote({
  midi,
  clef,
  stepRange,
}: {
  readonly midi: Midi
  readonly clef: Clef
  readonly stepRange: StaffStepRange | undefined
}) {
  const spelled = fromMidi(midi)
  const step = staffStep(spelled, clef)
  const ledgers = ledgerSteps(step)
  const accidental = ACCIDENTAL_GLYPH[spelled.alter]

  return (
    <svg
      className="staff-note"
      viewBox={fixedViewBox(stepRange ?? DEFAULT_STEP_RANGE)}
      role="img"
      aria-label={`A note on the ${clef} staff`}
      data-testid="staff-note"
      data-step={step}
    >
      <StaffLines width={STAFF_WIDTH} clef={clef} />
      {ledgers.map((ledgerStep) => (
        <line
          key={ledgerStep}
          data-testid={`ledger-${ledgerStep}`}
          x1={SINGLE_NOTE_X - LEDGER_HALF_WIDTH}
          x2={SINGLE_NOTE_X + LEDGER_HALF_WIDTH}
          y1={y(ledgerStep)}
          y2={y(ledgerStep)}
          stroke="currentColor"
        />
      ))}
      {accidental !== undefined && (
        <text
          className="music-glyph"
          x={SINGLE_NOTE_X - 22}
          y={y(step) + 6}
          fontSize="20"
          aria-hidden="true"
        >
          {accidental}
        </text>
      )}
      <ellipse cx={SINGLE_NOTE_X} cy={y(step)} rx="7" ry="5.5" fill="currentColor" />
    </svg>
  )
}

function IntervalStaffNote({
  low,
  high,
  clef,
  stepRange,
}: {
  readonly low: SpelledPitch
  readonly high: SpelledPitch
  readonly clef: Clef
  readonly stepRange: StaffStepRange | undefined
}) {
  const lowStep = staffStep(low, clef)
  const highStep = staffStep(high, clef)
  const lowX = MELODIC_LOW_X
  const highX = MELODIC_HIGH_X
  const ledgers = [...ledgerEntries(lowStep, lowX), ...ledgerEntries(highStep, highX)]

  return (
    <svg
      className="staff-note staff-note-interval"
      viewBox={fixedViewBox(stepRange ?? DEFAULT_STEP_RANGE)}
      role="img"
      aria-label={`An interval on the ${clef} staff`}
      data-testid="staff-note"
    >
      <StaffLines width={STAFF_WIDTH} clef={clef} />
      {ledgers.map(({ step, x }) => (
        <line
          key={`${step}-${x}`}
          data-testid={`ledger-${step}-${x}`}
          x1={x - LEDGER_HALF_WIDTH}
          x2={x + LEDGER_HALF_WIDTH}
          y1={y(step)}
          y2={y(step)}
          stroke="currentColor"
        />
      ))}
      <Notehead x={lowX} step={lowStep} spelled={low} testId="staff-note-low" />
      <Notehead x={highX} step={highStep} spelled={high} testId="staff-note-high" />
    </svg>
  )
}

export function StaffNote(props: StaffNoteProps) {
  if (isIntervalProps(props)) {
    return (
      <IntervalStaffNote
        low={props.low}
        high={props.high}
        clef={props.clef}
        stepRange={props.stepRange}
      />
    )
  }
  return <SingleStaffNote midi={props.midi} clef={props.clef} stepRange={props.stepRange} />
}
