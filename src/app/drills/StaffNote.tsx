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
import type { Clef } from '@core/drills/flashcards.ts'
import { fromMidi, type SpelledPitch } from '@core/theory/pitch.ts'
import type { Midi } from '@core/shared/units.ts'
import { ledgerSteps, staffStep } from './staffPosition.ts'

export type StaffNoteProps =
  | { readonly midi: Midi; readonly clef: Clef }
  | {
      readonly low: SpelledPitch
      readonly high: SpelledPitch
      readonly clef: Clef
    }

const LINE_GAP = 12
const STEP_GAP = LINE_GAP / 2
const BOTTOM_LINE_Y = 100
const SINGLE_NOTE_X = 70
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
      <text x="10" y={y(4) + 14} fontSize="34" aria-hidden="true">
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
        <text x={x - 22} y={y(step) + 6} fontSize="20" aria-hidden="true">
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

/** A viewBox tight enough to always show every drawn step, staff included. */
function viewBoxFor(width: number, steps: readonly number[]): string {
  const top = y(Math.max(...steps)) - VIEWBOX_MARGIN
  const bottom = y(Math.min(...steps)) + VIEWBOX_MARGIN
  return `0 ${top} ${width} ${bottom - top}`
}

function SingleStaffNote({ midi, clef }: { readonly midi: Midi; readonly clef: Clef }) {
  const spelled = fromMidi(midi)
  const step = staffStep(spelled, clef)
  const ledgers = ledgerSteps(step)
  const accidental = ACCIDENTAL_GLYPH[spelled.alter]
  const width = 140

  return (
    <svg
      className="staff-note"
      viewBox={viewBoxFor(width, [step, ...ledgers, 0, 8])}
      role="img"
      aria-label={`A note on the ${clef} staff`}
      data-testid="staff-note"
      data-step={step}
    >
      <StaffLines width={width} clef={clef} />
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
        <text x={SINGLE_NOTE_X - 22} y={y(step) + 6} fontSize="20" aria-hidden="true">
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
}: {
  readonly low: SpelledPitch
  readonly high: SpelledPitch
  readonly clef: Clef
}) {
  const lowStep = staffStep(low, clef)
  const highStep = staffStep(high, clef)
  const lowX = MELODIC_LOW_X
  const highX = MELODIC_HIGH_X
  const ledgers = [...ledgerEntries(lowStep, lowX), ...ledgerEntries(highStep, highX)]
  const width = 160

  return (
    <svg
      className="staff-note staff-note-interval"
      viewBox={viewBoxFor(width, [lowStep, highStep, ...ledgers.map((l) => l.step), 0, 8])}
      role="img"
      aria-label={`An interval on the ${clef} staff`}
      data-testid="staff-note"
    >
      <StaffLines width={width} clef={clef} />
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
    return <IntervalStaffNote low={props.low} high={props.high} clef={props.clef} />
  }
  return <SingleStaffNote midi={props.midi} clef={props.clef} />
}
