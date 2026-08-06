/**
 * A display-only piano keyboard (roadmap 3.8/3.9, REQ-3.5.3/REQ-3.5.4):
 * highlights an arbitrary set of pitch classes (a scale, a chord) across the
 * rendered range, with an optional per-key label (a degree name, a fingering
 * number).
 *
 * This is deliberately the *display* keyboard, not the *input* one —
 * `@app/drills/OnScreenKeyboard.tsx` answers "which key did the learner
 * press"; this one answers "which keys make up this scale/chord", so it takes
 * plain props and renders, with no click handling, no hooks and no ports.
 *
 * Highlighting is by **pitch class** (0=C .. 11=B), so it applies uniformly
 * across every octave drawn — a two-octave diagram highlighting C major lights
 * up both C4 and C5. `labels` is keyed by the absolute MIDI note instead,
 * because a fingering or a chord-tone label is a fact about one specific
 * rendered key, not about the pitch class in general (the same pitch class can
 * carry two different fingers across an octave span).
 *
 * DOM shape matches the design system's `.keyboard-diagram` spec
 * (`src/design-system/css/domain.css`) and `OnScreenKeyboard`'s markup as
 * closely as makes sense for a non-interactive reference diagram: a flex
 * `<div className="keyboard-diagram">` of `<div className="key key-white|key-black">`
 * children (plain `<div>`s, not `<button>`s — this diagram has never taken
 * clicks or focus), with the root note carrying `data-state="target"` (the
 * strongest visual treatment, for the one note that anchors the scale/chord)
 * and the rest of the highlighted tones carrying `data-state="in-scale"`.
 */
import { invariant } from '@core/shared/invariant.ts'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI, type Midi } from '@core/shared/units.ts'

export type KeyboardDiagramProps = {
  readonly low: Midi
  readonly high: Midi
  /** Pitch classes (0-11) to highlight, independent of octave. */
  readonly highlightedPitchClasses: ReadonlySet<number>
  /** The pitch class to mark as the root/tonic, drawn with its own styling. */
  readonly rootPitchClass?: number
  /** Per-key text, keyed by the absolute MIDI note number it labels. */
  readonly labels?: ReadonlyMap<number, string>
  readonly ariaLabel?: string
}

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

function isBlackKey(note: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

function pitchClassOf(note: number): number {
  return ((note % 12) + 12) % 12
}

/** The `data-state` domain.css keys its feedback styling off, or `undefined` for a plain key. */
function stateFor(isRoot: boolean, isHighlighted: boolean): 'target' | 'in-scale' | undefined {
  if (isRoot) return 'target'
  if (isHighlighted) return 'in-scale'
  return undefined
}

export function KeyboardDiagram({
  low,
  high,
  highlightedPitchClasses,
  rootPitchClass,
  labels,
  ariaLabel = 'Keyboard diagram',
}: KeyboardDiagramProps) {
  const clampedLow = midi(Math.max(PIANO_LOWEST_MIDI, low))
  const clampedHigh = midi(Math.min(PIANO_HIGHEST_MIDI, high))
  invariant(
    clampedLow <= clampedHigh,
    `KeyboardDiagram: low (${clampedLow}) must not exceed high (${clampedHigh})`,
  )
  const notes: number[] = []
  for (let n = clampedLow; n <= clampedHigh; n++) notes.push(n)

  return (
    <div
      className="keyboard-diagram"
      role="img"
      aria-label={ariaLabel}
      data-testid="keyboard-diagram"
    >
      {notes.map((note) => {
        const pc = pitchClassOf(note)
        const isRoot = rootPitchClass === pc
        const isHighlighted = highlightedPitchClasses.has(pc)
        const label = labels?.get(note)
        const black = isBlackKey(note)
        const state = stateFor(isRoot, isHighlighted)
        return (
          <div
            key={note}
            data-testid={`keyboard-key-${note}`}
            data-pitch-class={pc}
            data-highlighted={isHighlighted}
            data-root={isRoot}
            {...(state === undefined ? {} : { 'data-state': state })}
            className={black ? 'key key-black' : 'key key-white'}
          >
            {label !== undefined && <span aria-hidden="true">{label}</span>}
          </div>
        )
      })}
    </div>
  )
}
